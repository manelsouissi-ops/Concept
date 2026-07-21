import { MoreHorizontalIcon } from "./app-icons.tsx";
import type { WorkspaceAction } from "@/lib/appels-offres/workspace.ts";

export function WorkspaceActionMenu({
  actions,
  onAction
}: {
  actions: WorkspaceAction[];
  onAction: (action: WorkspaceAction) => void;
}) {
  if (!actions.length) {
    return null;
  }

  return (
    <details className="row-menu">
      <summary className="row-menu-trigger" aria-label="Plus d'actions">
        <MoreHorizontalIcon className="table-menu-icon" />
      </summary>
      <div className="row-menu-content">
        {actions.map((action) => (
          <button
            key={action.kind}
            type="button"
            className="row-menu-link"
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </details>
  );
}
