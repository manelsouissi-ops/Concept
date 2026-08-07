import type { FciModuleAssignmentDetail, TenderWorkflowEventRecord } from "./types.ts";
import type { TenderWorkflowStateView } from "./service.ts";
import type { UserRecord } from "../../users/types.ts";

type WorkflowErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class WorkflowClientError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(status: number, payload: WorkflowErrorPayload) {
    super(payload.message);
    this.name = "WorkflowClientError";
    this.code = payload.code;
    this.status = status;
    this.details = payload.details ?? {};
  }
}

async function parseResponse<TData>(response: Response) {
  const payload = (await response.json()) as
    | { ok: true; data: TData }
    | { ok: false; error: WorkflowErrorPayload };

  if (!response.ok || !payload.ok) {
    const error = "error" in payload
      ? payload.error
      : {
          code: "WORKFLOW_HTTP_ERROR",
          message: "Erreur workflow inattendue.",
          details: {}
        };
    throw new WorkflowClientError(response.status, error);
  }

  return payload.data;
}

export async function getTenderWorkflow(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/workflow`, {
    cache: "no-store"
  });

  return parseResponse<{
    workflow: TenderWorkflowStateView;
    events: TenderWorkflowEventRecord[];
  }>(response);
}

export async function prepareTenderGoNoGo(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/workflow/prepare`, {
    method: "POST"
  });

  return parseResponse<Record<string, unknown> | null>(response);
}

export async function submitTenderToDg(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/workflow/submit`, {
    method: "POST"
  });

  return parseResponse<Record<string, unknown> | null>(response);
}

export async function getTenderAssignments(code: string) {
  const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/assignments`, {
    cache: "no-store"
  });

  return parseResponse<FciModuleAssignmentDetail[]>(response);
}

export async function getAssignableUsers(code: string, moduleCode: "B" | "C") {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/assignments/${encodeURIComponent(moduleCode)}/assignees`,
    {
      cache: "no-store"
    }
  );

  return parseResponse<UserRecord[]>(response);
}

export async function assignTenderModule(
  code: string,
  moduleCode: "B" | "C",
  assignedUserId: number
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/assignments/${encodeURIComponent(moduleCode)}/assign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_user_id: assignedUserId })
    }
  );

  return parseResponse<FciModuleAssignmentDetail>(response);
}

export async function reassignTenderModule(
  code: string,
  moduleCode: "B" | "C",
  assignedUserId: number
) {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/assignments/${encodeURIComponent(moduleCode)}/reassign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_user_id: assignedUserId })
    }
  );

  return parseResponse<FciModuleAssignmentDetail>(response);
}

export async function remindTenderAssignment(code: string, moduleCode: "B" | "C") {
  const response = await fetch(
    `/api/appels-offres/${encodeURIComponent(code)}/assignments/${encodeURIComponent(moduleCode)}/remind`,
    {
      method: "POST"
    }
  );

  return parseResponse<FciModuleAssignmentDetail>(response);
}
