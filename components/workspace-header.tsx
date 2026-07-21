import { StatusBadge } from "./status-badge.tsx";
import { WorkspaceActionMenu } from "./workspace-action-menu.tsx";
import type {
  WorkspaceAction,
  WorkspaceIdentity
} from "@/lib/appels-offres/workspace.ts";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";

export function WorkspaceHeader({
  code,
  identity,
  statusLabel,
  statusTone,
  businessStatusDescription,
  lastUpdatedLabel,
  deadlineLabel,
  primaryAction,
  secondaryActions,
  onAction
}: {
  code: string;
  identity: WorkspaceIdentity;
  statusLabel: string;
  statusTone: BadgeTone;
  businessStatusDescription: string;
  lastUpdatedLabel: string;
  deadlineLabel: string;
  primaryAction: WorkspaceAction | null;
  secondaryActions: WorkspaceAction[];
  onAction: (action: WorkspaceAction) => void;
}) {
  return (
    <section className="workspace-identity-card">
      <div className="workspace-identity-topline">
        <div className="workspace-identity-copy">
          <div className="workspace-code mono">{code}</div>
          <h2>{identity.displayTitle}</h2>
          <p>{businessStatusDescription}</p>
        </div>
        <StatusBadge label={statusLabel} tone={statusTone} />
      </div>

      <div className="workspace-identity-grid">
        <div className="workspace-identity-meta">
          <span>Client : {identity.clientLabel}</span>
          <span>Pays : {identity.countryLabel}</span>
          <span>Responsable : {identity.responsibleLabel}</span>
          <span>Date limite : {deadlineLabel}</span>
          <span>Priorite : {identity.priorityLabel}</span>
          <span>Derniere mise a jour : {lastUpdatedLabel}</span>
        </div>

        <div className="workspace-identity-actions">
          {primaryAction ? (
            <button
              type="button"
              className={`button ${primaryAction.tone === "ai" ? "button-ai" : primaryAction.tone === "primary" ? "button-primary" : "button-secondary"}`}
              onClick={() => onAction(primaryAction)}
            >
              {primaryAction.label}
            </button>
          ) : null}
          <WorkspaceActionMenu actions={secondaryActions} onAction={onAction} />
        </div>
      </div>
    </section>
  );
}
