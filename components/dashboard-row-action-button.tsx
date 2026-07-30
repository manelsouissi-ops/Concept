import Link from "next/link";
import type { DashboardRowAction } from "@/lib/appels-offres/dashboard-status.ts";

export function DashboardRowActionButton({ action }: { action: DashboardRowAction }) {
  if (action.kind === "processing" || !action.href || !action.label) {
    return (
      <span className="dashboard-row-processing" aria-label="En cours de traitement">
        <span className="dashboard-row-spinner" aria-hidden="true" />
        En cours…
      </span>
    );
  }

  const buttonClass =
    action.tone === "primary"
      ? "button button-primary button-small"
      : action.tone === "secondary"
        ? "button button-secondary button-small"
        : "button button-ghost button-small";

  return (
    <Link href={action.href} className={buttonClass}>
      {action.label}
    </Link>
  );
}
