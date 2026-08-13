import Link from "next/link";
import { StatusBadge } from "@/components/status-badge.tsx";
import type { FinanceDossierRow } from "@/lib/appels-offres/finance-workspace.ts";

// Deliberately reuses the finance-dossiers-* cell classes from
// finance-dossiers-table.tsx (colors, truncation, mobile stacking) - only the
// grid-column count differs (4 here vs 5 there), via the department-tasks-table
// modifier class. Kept as a separate component so Direction Generale's fuller
// table (finance-dossiers-table.tsx) stays untouched.
export function DepartmentTasksTable({
  rows
}: {
  rows: FinanceDossierRow[];
}) {
  return (
    <div className="finance-dossiers-table-shell">
      <div
        className="finance-dossiers-table department-tasks-table finance-dossiers-table-header"
        aria-hidden="true"
      >
        <span>Appel d'offres</span>
        <span>Client</span>
        <span>Échéance</span>
        <span>Statut</span>
        <span>Action</span>
      </div>

      <div className="finance-dossiers-table-list">
        {rows.map((row) => (
          <article
            key={row.code}
            className="finance-dossiers-table department-tasks-table finance-dossiers-row"
          >
            <div className="finance-dossiers-cell finance-dossiers-primary">
              <span className="mono finance-dossiers-code">{row.code}</span>
              <strong title={row.title}>{row.title}</strong>
            </div>
            <span className="finance-dossiers-cell finance-dossiers-client" title={row.client}>
              {row.client}
            </span>
            <div className="finance-dossiers-cell finance-dossiers-deadline">
              <span>{row.deadlineLabel}</span>
              {row.isOverdue ? <small>Échéance dépassée</small> : null}
            </div>
            <div className="finance-dossiers-cell finance-dossiers-module">
              <StatusBadge label={row.statusLabel} tone={row.statusTone} />
            </div>
            <div className="finance-dossiers-cell finance-dossiers-action">
              <Link href={row.actionHref} className="button button-secondary button-small">
                {row.actionLabel}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
