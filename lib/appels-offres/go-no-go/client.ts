import type { GoNoGoView } from "./service.ts";

export type GoNoGoApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class GoNoGoClientError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, payload: GoNoGoApiErrorPayload) {
    super(payload.message);
    this.name = "GoNoGoClientError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details ?? {};
  }
}

type GoNoGoApiSuccessResponse<TData> = {
  ok: true;
  data: TData;
};

type GoNoGoApiErrorResponse = {
  ok: false;
  error: GoNoGoApiErrorPayload;
};

async function parseResponse<TData>(response: Response) {
  const payload = (await response.json()) as
    | GoNoGoApiSuccessResponse<TData>
    | GoNoGoApiErrorResponse;

  if (!response.ok || !payload.ok) {
    const errorPayload =
      "error" in payload
        ? payload.error
        : {
            code: "GO_NO_GO_HTTP_ERROR",
            message: "Erreur Go/No-Go inattendue.",
            details: {}
          };
    throw new GoNoGoClientError(response.status, errorPayload);
  }

  return payload.data;
}

export async function getGoNoGoView(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go`, {
    cache: "no-store"
  });
  return parseResponse<GoNoGoView>(response);
}

export async function decideGoNoGo(
  code: string,
  input: {
    decision: "go" | "no_go";
    rationale: string;
    reserves: string | null;
    expectedVersion: number | null;
  }
) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision: input.decision,
      rationale: input.rationale,
      reserves: input.reserves,
      expected_version: input.expectedVersion
    })
  });

  return parseResponse<{ decision: GoNoGoView["decision"]; applied: boolean; idempotent: boolean }>(
    response
  );
}

export async function reopenGoNoGo(
  code: string,
  input: { reason: string; expectedVersion: number | null }
) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/go-no-go/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: input.reason,
      expected_version: input.expectedVersion
    })
  });

  return parseResponse<{ decision: GoNoGoView["decision"] }>(response);
}
