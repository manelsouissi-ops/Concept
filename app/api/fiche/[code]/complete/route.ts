import { NextResponse } from "next/server";
import {
  appendAuditLog,
  finishLatestProcessingJobByCode,
  setAppelOffresStatus,
  syncStoredDocumentsMetadata
} from "@/lib/appels-offres/repository.ts";
import { syncFicheIndexSafely } from "@/lib/db";
import { parseFiche, serializeFiche } from "@/lib/fiche-xml";
import {
  finalizeProcessingSuccess,
  markProcessingError,
  readFicheBundle,
  readFicheIndexSourceForSync,
  readFicheStatus
} from "@/lib/storage";
import type { FicheErrorStage } from "@/lib/types";

export const runtime = "nodejs";

type SuccessBody = {
  xml: string;
  markdown: string;
  executionId: string;
};

type FailureBody = {
  error: string;
  stage: FicheErrorStage;
  executionId: string;
};

function isSuccessBody(value: unknown): value is SuccessBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.xml === "string" &&
    typeof record.markdown === "string" &&
    typeof record.executionId === "string"
  );
}

function isFailureBody(value: unknown): value is FailureBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.error === "string" &&
    typeof record.stage === "string" &&
    typeof record.executionId === "string"
  );
}

async function syncCurrentState(codeInterne: string, context: string) {
  const indexed = await readFicheIndexSourceForSync(codeInterne);
  await syncFicheIndexSafely(
    codeInterne,
    indexed.xml,
    indexed.fiche,
    indexed.status,
    context
  );
}

async function syncAppelOffresSafely(
  codeInterne: string,
  context: string,
  callback: () => Promise<void>
) {
  try {
    await callback();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[appels-offres] Sync skipped after ${context} for ${codeInterne}: ${reason}`
    );
  }
}

function isAuthorized(request: Request) {
  const expected = process.env.N8N_COMPLETE_SECRET?.trim();
  if (!expected) {
    return false;
  }

  const provided = request.headers.get("X-Complete-Secret")?.trim();
  return provided === expected;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code } = await params;
    const body = (await request.json()) as unknown;
    const currentStatus = await readFicheStatus(code);

    if (currentStatus.status !== "processing") {
      return NextResponse.json(
        { error: "La fiche n'est plus en attente de completion." },
        { status: 409 }
      );
    }

    const executionId =
      isSuccessBody(body) || isFailureBody(body) ? body.executionId.trim() : "";
    if (!executionId) {
      return NextResponse.json(
        { error: "executionId manquant dans le callback." },
        { status: 400 }
      );
    }

    if (
      currentStatus.n8nExecutionId &&
      currentStatus.n8nExecutionId !== executionId
    ) {
      return NextResponse.json(
        { error: "executionId inattendu pour cette fiche." },
        { status: 409 }
      );
    }

    if (isFailureBody(body)) {
      await markProcessingError(code, body.error, body.stage);
      await syncAppelOffresSafely(code, "complete:error", async () => {
        await setAppelOffresStatus(code, "error");
        await finishLatestProcessingJobByCode(
          code,
          "fiche_generation",
          "failed",
          body.error
        );
        await appendAuditLog(code, "fiche.complete.failed", {
          stage: body.stage,
          error: body.error
        });
      });
      await syncCurrentState(code, "complete:error");
      return NextResponse.json({ ok: true });
    }

    if (!isSuccessBody(body)) {
      return NextResponse.json(
        { error: "Payload de completion invalide." },
        { status: 400 }
      );
    }

    let normalizedXml: string;

    try {
      const parsed = parseFiche(body.xml);
      normalizedXml = serializeFiche(parsed, { referenceInterne: "" });
    } catch {
      await markProcessingError(
        code,
        "XML malforme retourne par le pipeline",
        "groq"
      );
      await syncAppelOffresSafely(code, "complete:invalid-xml", async () => {
        await setAppelOffresStatus(code, "error");
        await finishLatestProcessingJobByCode(
          code,
          "fiche_generation",
          "failed",
          "XML malforme retourne par le pipeline"
        );
        await appendAuditLog(code, "fiche.complete.invalid_xml");
      });
      await syncCurrentState(code, "complete:invalid-xml");

      return NextResponse.json(
        { error: "XML malforme retourne par le pipeline." },
        { status: 422 }
      );
    }

    await finalizeProcessingSuccess({
      codeInterne: code,
      xml: normalizedXml,
      markdown: body.markdown
    });
    await syncAppelOffresSafely(code, "complete:success", async () => {
      await setAppelOffresStatus(code, "ready");
      await syncStoredDocumentsMetadata(code);
      await finishLatestProcessingJobByCode(
        code,
        "fiche_generation",
        "completed"
      );
      await appendAuditLog(code, "fiche.complete.succeeded", {
        executionId: body.executionId
      });
    });
    await syncCurrentState(code, "complete:success");

    const fiche = await readFicheBundle(code);
    return NextResponse.json(fiche);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de terminer la fiche.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
