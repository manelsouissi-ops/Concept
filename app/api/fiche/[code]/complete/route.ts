import { NextResponse } from "next/server";
import { applyCanonicalN8nCallback } from "@/lib/appels-offres/analysis.ts";
import {
  getAppelOffresDetailByCode,
  getLatestProcessingJobByCode
} from "@/lib/appels-offres/repository.ts";
import { DEFAULT_N8N_CONTRACT_VERSION, type N8nCallbackPayload, type N8nErrorStage } from "@/lib/integrations/n8n-contract.ts";
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

function isAuthorized(request: Request) {
  const expected = process.env.N8N_COMPLETE_SECRET?.trim();
  if (!expected) {
    return false;
  }

  const provided = request.headers.get("x-complete-secret")?.trim();
  return provided === expected;
}

function toCanonicalErrorStage(stage: FicheErrorStage): N8nErrorStage {
  switch (stage) {
    case "webhook":
      return "WEBHOOK";
    case "upload":
      return "UPLOAD";
    case "marker":
      return "MARKER";
    case "markdown":
      return "MARKDOWN";
    case "anonymization":
      return "ANONYMIZATION";
    case "llm":
      return "LLM";
    case "xml":
      return "XML";
    case "callback":
      return "CALLBACK";
    default:
      return "UNKNOWN";
  }
}

function calculateDurationMs(startedAt: string, finishedAt: string) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    return 0;
  }

  return finish - start;
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

    if (!isSuccessBody(body) && !isFailureBody(body)) {
      return NextResponse.json(
        { error: "Payload de completion invalide." },
        { status: 400 }
      );
    }

    const appel = await getAppelOffresDetailByCode(code, { includeArchived: true });
    if (!appel) {
      return NextResponse.json(
        { error: "Appel d'offres introuvable." },
        { status: 404 }
      );
    }

    const latestJob = await getLatestProcessingJobByCode(code, "fiche_generation");
    if (
      !latestJob?.publicId ||
      !latestJob.correlationId ||
      !latestJob.executionId ||
      latestJob.executionId !== body.executionId.trim()
    ) {
      return NextResponse.json(
        { error: "executionId inattendu pour cet appel d'offres." },
        { status: 409 }
      );
    }

    const startedAt = latestJob.launchAcceptedAt ?? latestJob.startedAt;
    const finishedAt = new Date().toISOString();
    const commonEnvelope = {
      contract_version:
        latestJob.contractVersion ??
        process.env.N8N_CONTRACT_VERSION?.trim() ??
        DEFAULT_N8N_CONTRACT_VERSION,
      processing_job_id: latestJob.publicId,
      appel_offre_id: `ao_${appel.id}`,
      code_interne: code,
      correlation_id: latestJob.correlationId,
      execution_id: latestJob.executionId,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: calculateDurationMs(startedAt, finishedAt),
      metadata: {
        compatibilityRoute: "/api/fiche/[code]/complete"
      }
    };

    const payload: N8nCallbackPayload = isSuccessBody(body)
      ? {
          ...commonEnvelope,
          status: "COMPLETED",
          result: {
            xml: body.xml,
            markdown: body.markdown
          }
        }
      : {
          ...commonEnvelope,
          status: "FAILED",
          error: {
            stage: toCanonicalErrorStage(body.stage),
            code: "LEGACY_CALLBACK_FAILURE",
            message: body.error,
            retryable: true,
            provider: "legacy-complete-route"
          }
        };

    const result = await applyCanonicalN8nCallback(payload);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Impossible de terminer la fiche.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
