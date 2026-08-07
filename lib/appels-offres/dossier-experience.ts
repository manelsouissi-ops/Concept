import type { UserRole } from "../auth/rbac.ts";
import type { WorkspaceTabKey } from "./workspace.ts";

export type WorkspaceTabDefinition = {
  key: WorkspaceTabKey;
  label: string;
  countKey?: "documents" | "history";
};

const DEFAULT_WORKSPACE_TABS: WorkspaceTabDefinition[] = [
  { key: "overview", label: "Apercu" },
  { key: "documents", label: "Documents", countKey: "documents" },
  { key: "fiche", label: "Fiche CDC" },
  { key: "fci", label: "FCI" },
  { key: "go-no-go", label: "Go/No-Go" },
  { key: "history", label: "Historique", countKey: "history" }
];

const DECISION_CENTER_TABS: WorkspaceTabDefinition[] = [
  { key: "go-no-go", label: "Decision" },
  { key: "history", label: "Historique", countKey: "history" }
];

export function isDecisionCenterRole(role?: UserRole | null) {
  return role === "DIRECTION_GENERALE";
}

export function getAppelOffresWorkspaceTabs(role?: UserRole | null) {
  if (isDecisionCenterRole(role)) {
    return DECISION_CENTER_TABS;
  }

  return DEFAULT_WORKSPACE_TABS;
}

export function resolveAppelOffresWorkspaceView(input: {
  requestedView?: WorkspaceTabKey;
  role?: UserRole | null;
}) {
  if (!isDecisionCenterRole(input.role)) {
    return input.requestedView;
  }

  if (
    input.requestedView === "documents"
    || input.requestedView === "fiche"
    || input.requestedView === "history"
    || input.requestedView === "go-no-go"
  ) {
    return input.requestedView;
  }

  return "go-no-go" as const;
}
