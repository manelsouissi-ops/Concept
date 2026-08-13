import type {
  FciModulePresentation,
  FciWorkspacePresentation
} from "./presentation.ts";
import type { FciAiSupportedModuleCode } from "./ai-contracts.ts";
import type { FciFormPayload } from "./rendering.ts";

export type FciModuleHistoryEntry = {
  id: number;
  version: number;
  data: Record<string, unknown>;
  source_summary: Record<string, unknown> | null;
  confidence: Record<string, unknown> | null;
  ai_notes: Record<string, unknown> | null;
  generated_from_fiche_version: string | null;
  generated_from_fiche_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type FciGenerationHistoryEntry = {
  id: number;
  trigger_type: "manual" | "automatic" | "regeneration";
  provider: string;
  model: string;
  status:
    | "pending_integration"
    | "created"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  contract_version: string | null;
  schema_version: string | null;
  prompt_version: string | null;
  generation_parameters: Record<string, unknown> | null;
  source_fiche_version: string | null;
  source_fiche_hash: string | null;
  execution_id: string | null;
  correlation_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  callback_received_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

export type FciAuditHistoryEntry = {
  id: number;
  event_type: string;
  actor: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type FciModuleHistoryPresentation = {
  module_code: string;
  versions: FciModuleHistoryEntry[];
  generation_jobs: FciGenerationHistoryEntry[];
  audit_events: FciAuditHistoryEntry[];
};

export type FciApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class FciClientError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, payload: FciApiErrorPayload) {
    super(payload.message);
    this.name = "FciClientError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details ?? {};
  }
}

type FciApiSuccessResponse<TData> = {
  ok: true;
  data: TData;
};

type FciApiErrorResponse = {
  ok: false;
  error: FciApiErrorPayload;
};

async function parseResponse<TData>(response: Response) {
  const payload = (await response.json()) as
    | FciApiSuccessResponse<TData>
    | FciApiErrorResponse;

  if (!response.ok || !payload.ok) {
    const errorPayload =
      "error" in payload
        ? payload.error
        : {
            code: "FCI_HTTP_ERROR",
            message: "Erreur FCI inattendue.",
            details: {}
          };
    throw new FciClientError(response.status, errorPayload);
  }

  return payload.data;
}

export async function getFciWorkspace(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/fci`, {
    cache: "no-store"
  });
  return parseResponse<FciWorkspacePresentation>(response);
}

export async function initializeFci(code: string) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/initialize`,
    {
      method: "POST"
    }
  );
  return parseResponse<FciWorkspacePresentation>(response);
}

export async function getFciModule(
  code: string,
  moduleCode: FciAiSupportedModuleCode
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}`,
    {
      cache: "no-store"
    }
  );
  return parseResponse<FciModulePresentation>(response);
}

export async function saveFciModule(
  code: string,
  moduleCode: FciAiSupportedModuleCode,
  input: {
    data: FciFormPayload | Record<string, unknown>;
    sourceSummary: Record<string, unknown> | null;
    confidence: Record<string, unknown> | null;
    aiNotes: Record<string, unknown> | null;
    editor: string | null;
    expectedVersion: number | null;
  }
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: input.data,
        source_summary: input.sourceSummary,
        confidence: input.confidence,
        ai_notes: input.aiNotes,
        editor: input.editor,
        expected_version: input.expectedVersion
      })
    }
  );

  return parseResponse<FciModulePresentation>(response);
}

export async function prepareFciGeneration(
  code: string,
  moduleCode: FciAiSupportedModuleCode
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}/generate`,
    {
      method: "POST"
    }
  );

  return parseResponse<Record<string, unknown>>(response);
}

export async function prepareFciRegeneration(
  code: string,
  moduleCode: FciAiSupportedModuleCode
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}/regenerate`,
    {
      method: "POST"
    }
  );

  return parseResponse<Record<string, unknown>>(response);
}

export async function prepareFciManualCompletion(
  code: string,
  moduleCode: FciAiSupportedModuleCode
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}/manual`,
    {
      method: "POST"
    }
  );

  return parseResponse<FciModulePresentation>(response);
}

export async function validateFciModule(
  code: string,
  moduleCode: FciAiSupportedModuleCode,
  input: {
    validatedBy: string;
    comment: string | null;
    expectedVersion: number | null;
    acknowledgeStaleSource: boolean;
  }
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}/validate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        validated_by: input.validatedBy,
        comment: input.comment,
        expected_version: input.expectedVersion,
        acknowledge_stale_source: input.acknowledgeStaleSource
      })
    }
  );

  return parseResponse<FciModulePresentation>(response);
}

export async function getFciModuleHistory(
  code: string,
  moduleCode: FciAiSupportedModuleCode
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}/history`,
    {
      cache: "no-store"
    }
  );
  return parseResponse<FciModuleHistoryPresentation>(response);
}

function parseDownloadFileName(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const basicMatch = contentDisposition.match(/filename="([^"]+)"/i);
  return basicMatch?.[1] ?? null;
}

export async function downloadFciModuleExport(
  code: string,
  moduleCode: FciAiSupportedModuleCode,
  format: "docx" | "pdf"
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/fci/${encodeURIComponent(moduleCode)}/export?format=${encodeURIComponent(format)}`,
    {
      method: "GET"
    }
  );

  if (!response.ok) {
    const payload = (await response.json()) as FciApiErrorResponse;
    const errorPayload =
      "error" in payload
        ? payload.error
        : {
            code: "FCI_EXPORT_ERROR",
            message: "Export FCI impossible.",
            details: {}
          };
    throw new FciClientError(response.status, errorPayload);
  }

  const blob = await response.blob();
  return {
    blob,
    fileName:
      parseDownloadFileName(response.headers.get("Content-Disposition"))
      ?? `fci-${moduleCode}.${format}`
  };
}
