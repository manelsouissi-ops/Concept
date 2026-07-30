import Link from "next/link";
import { StatusBadge } from "./status-badge.tsx";
import { WorkspaceActionMenu, type WorkspaceActionMenuLink } from "./workspace-action-menu.tsx";
import type {
  WorkspaceAction,
  WorkspaceIdentity
} from "@/lib/appels-offres/workspace.ts";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";

export function WorkspaceHeader({
  backHref,
  code,
  identity,
  statusLabel,
  statusTone,
  deadlineLabel,
  secondaryActions,
  secondaryLinks,
  onAction
}: {
  backHref: string;
  code: string;
  identity: WorkspaceIdentity;
  statusLabel: string;
  statusTone: BadgeTone;
  deadlineLabel: string;
  secondaryActions: WorkspaceAction[];
  secondaryLinks?: WorkspaceActionMenuLink[];
  onAction: (action: WorkspaceAction) => void;
}) {
  return (
    <section className="workspace-identity-card">
      <div className="workspace-backlink-row">
        <Link href={backHref} className="button button-ghost button-small workspace-backlink">
          Retour a la liste
        </Link>
      </div>

      <div className="workspace-identity-topline compact">
        <div className="workspace-identity-copy">
          <div className="workspace-code mono">{code}</div>
          <h2>{identity.displayTitle}</h2>
        </div>
        <StatusBadge label={statusLabel} tone={statusTone} />
      </div>

      <div className="workspace-identity-grid compact">
        <div className="workspace-identity-meta compact">
          <span>Client : {identity.clientLabel}</span>
          <span>Date limite : {deadlineLabel}</span>
        </div>

        <div className="workspace-identity-actions">
          <WorkspaceActionMenu actions={secondaryActions} links={secondaryLinks} onAction={onAction} />
        </div>
      </div>
    </section>
  );
}
