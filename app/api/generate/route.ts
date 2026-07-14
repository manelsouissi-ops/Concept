import { NextResponse } from "next/server";
import { syncFicheIndexSafely } from "@/lib/db";
import {
  createProcessingBundle,
  markProcessingError,
  readExistingStatus,
  readFicheIndexSourceForSync,
  readStoredPdfFile,
  updateProcessingExecutionId
} from "@/lib/storage";

export const runtime = "nodejs";

const N8N_HANDSHAKE_TIMEOUT_MS = 10000;

type WebhookAcceptedPayload = {
  executionId: string | null;
};

function asNonEmptyString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function asTruthyFlag(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isPdfFile(value: FormDataEntryValue | null): value is File {
  return value instanceof File;
}

function pickExecutionIdFromJson(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directCandidates = [
    record.executionId,
    record.execution_id,
    record.id
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (record.data && typeof record.data === "object") {
    return pickExecutionIdFromJson(record.data);
  }

  if (record.execution && typeof record.execution === "object") {
    return pickExecutionIdFromJson(record.execution);
  }

  return null;
}

function pickExecutionIdFromHeaders(response: Response) {
  const candidates = [
    response.headers.get("x-n8n-execution-id"),
    response.headers.get("n8n-execution-id"),
    response.headers.get("x-execution-id"),
    response.headers.get("execution-id")
  ];

  for (const candidate of candidates) {
    if (candidate?.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function requestWebhookAcceptance(
  file: File,
  codeInterne: string
): Promise<WebhookAcceptedPayload> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
  const token = process.env.N8N_WEBHOOK_TOKEN?.trim();

  if (!webhookUrl) {
    throw new Error("N8N_WEBHOOK_URL n'est pas defini.");
  }

  const payload = new FormData();
  payload.append("code_interne", codeInterne);
  payload.append("file", file, file.name || "cdc.pdf");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_HANDSHAKE_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: payload,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Webhook n8n indisponible (${response.status})`);
    }

    const headerExecutionId = pickExecutionIdFromHeaders(response);
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("application/json")) {
      return {
        executionId: headerExecutionId
      };
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new Error("La reponse d'acceptation n8n n'est pas un JSON valide.");
    }

    return {
      executionId: pickExecutionIdFromJson(body) ?? headerExecutionId
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "Le workflow n8n n'a pas confirme le demarrage a temps. Verifiez qu'il accepte bien les jobs en mode asynchrone."
      );
    }

    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Impossible de contacter le workflow n8n (${webhookUrl}). Detail: ${detail}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function syncStatusOnly(codeInterne: string, context: string) {
  const indexed = await readFicheIndexSourceForSync(codeInterne);
  await syncFicheIndexSafely(
    codeInterne,
    indexed.xml,
    indexed.fiche,
    indexed.status,
    context
  );
}

async function resolvePdfFile(
  uploadedFile: FormDataEntryValue | null,
  codeInterne: string
) {
  if (isPdfFile(uploadedFile)) {
    if (uploadedFile.type && uploadedFile.type !== "application/pdf") {
      throw new Error("Seuls les fichiers PDF sont acceptes.");
    }

    return uploadedFile;
  }

  return readStoredPdfFile(codeInterne);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const codeInterne = asNonEmptyString(formData.get("code_interne"));
    const forceRegenerate = asTruthyFlag(formData.get("force_regenerate"));

    if (!codeInterne) {
      return NextResponse.json(
        { error: "Le code interne est obligatoire." },
        { status: 400 }
      );
    }

    const existingStatus = await readExistingStatus(codeInterne);

    if (!isPdfFile(formData.get("file")) && !existingStatus) {
      return NextResponse.json(
        { error: "Le PDF est obligatoire." },
        { status: 400 }
      );
    }

    if (existingStatus?.status === "validated" && !forceRegenerate) {
      return NextResponse.json(
        {
          error:
            "Ce projet a deja ete valide. Confirmez pour regenerer et ecraser la fiche validee.",
          requiresConfirmation: true,
          reason: "already_validated"
        },
        { status: 409 }
      );
    }

    if (existingStatus?.modifiedAt && !forceRegenerate) {
      return NextResponse.json(
        {
          error:
            "Cette fiche a ete modifiee depuis sa generation. La regenerer ecrasera vos modifications. Confirmer ?",
          requiresConfirmation: true,
          reason: "draft_modified"
        },
        { status: 409 }
      );
    }

    if (existingStatus?.status === "processing") {
      return NextResponse.json(
        {
          error:
            "Une generation est deja en cours pour ce code interne. Attendez sa fin ou relancez plus tard.",
          reason: "concurrent_create"
        },
        { status: 409 }
      );
    }

    const pdfFile = await resolvePdfFile(formData.get("file"), codeInterne);

    await createProcessingBundle({
      codeInterne,
      pdfFile
    });
    await syncStatusOnly(codeInterne, "generate:start");

    try {
      const accepted = await requestWebhookAcceptance(pdfFile, codeInterne);
      await updateProcessingExecutionId(codeInterne, accepted.executionId);
      await syncStatusOnly(codeInterne, "generate:accepted");

      return NextResponse.json(
        {
          code_interne: codeInterne,
          status: "processing",
          n8nExecutionId: accepted.executionId
        },
        { status: 202 }
      );
    } catch (error) {
      await markProcessingError(
        codeInterne,
        "Impossible de contacter n8n",
        "unknown"
      );
      await syncStatusOnly(codeInterne, "generate:error");

      return NextResponse.json(
        {
          code_interne: codeInterne,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Impossible de contacter n8n"
        },
        { status: 202 }
      );
    }
  } catch (error) {
    const reason = (error as { reason?: string } | undefined)?.reason;
    if (reason === "concurrent_create") {
      return NextResponse.json(
        {
          error: (error as Error).message,
          reason
        },
        { status: 409 }
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Impossible de generer la fiche projet.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
