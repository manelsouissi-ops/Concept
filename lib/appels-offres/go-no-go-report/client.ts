import type { GoNoGoReportWorkspaceView } from "./service.ts";

export type GoNoGoReportApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class GoNoGoReportClientError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, payload: GoNoGoReportApiErrorPayload) {
    super(payload.message);
    this.name = "GoNoGoReportClientError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details ?? {};
  }
}

type SuccessResponse<TData> = {
  ok: true;
  data: TData;
};

type ErrorResponse = {
  ok: false;
  error: GoNoGoReportApiErrorPayload;
};

async function parseResponse<TData>(response: Response) {
  const payload = (await response.json()) as SuccessResponse<TData> | ErrorResponse;
  if (!response.ok || !payload.ok) {
    const errorPayload =
      "error" in payload
        ? payload.error
        : {
            code: "GO_NO_GO_REPORT_HTTP_ERROR",
            message: "Erreur rapport Go/No-Go inattendue.",
            details: {}
          };
    throw new GoNoGoReportClientError(response.status, errorPayload);
  }

  return payload.data;
}

export async function getGoNoGoReportWorkspace(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go-report`, {
    cache: "no-store"
  });
  return parseResponse<GoNoGoReportWorkspaceView>(response);
}

export async function generateGoNoGoReportDraft(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go-report/generate`, {
    method: "POST"
  });
  return parseResponse<{ id: number; version: number; status: string }>(response);
}

export async function regenerateGoNoGoReportDraft(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go-report/regenerate`, {
    method: "POST"
  });
  return parseResponse<{ id: number; version: number; status: string }>(response);
}

export async function saveGoNoGoReportDraft(
  code: string,
  input: {
    executive_summary: string;
    project_overview: string;
    commercial_summary: string;
    financial_summary: string;
    operational_summary: string;
    key_strengths: string;
    key_risks: string;
    reservations: string;
    assumptions: string;
    unresolved_points: string;
    commercial_recommendation: string;
    ai_recommendation: string | null;
    recommended_decision: "go" | "no_go" | null;
    expectedVersion: number | null;
  }
) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...input,
      expected_version: input.expectedVersion
    })
  });
  return parseResponse<{ id: number; version: number; status: string }>(response);
}
