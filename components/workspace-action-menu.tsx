import Link from "next/link";
import { MoreHorizontalIcon } from "./app-icons.tsx";
import type { WorkspaceAction } from "@/lib/appels-offres/workspace.ts";

export type WorkspaceActionMenuLink = {
  label: string;
  href: string;
};

export function WorkspaceActionMenu({
  actions,
  links = [],
  onAction
}: {
  actions: WorkspaceAction[];
  links?: WorkspaceActionMenuLink[];
  onAction: (action: WorkspaceAction) => void;
}) {
  if (!actions.length && !links.length) {
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
            disabled={action.disabled}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        ))}
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="row-menu-link">
            {link.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
