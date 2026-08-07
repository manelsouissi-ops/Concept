import Link from "next/link";
import { StatusBadge } from "@/components/status-badge.tsx";
import type { FinanceDossierRow } from "@/lib/appels-offres/finance-workspace.ts";

export function FinanceDossiersTable({
  rows,
  departmentLabel
}: {
  rows: FinanceDossierRow[];
  departmentLabel: string;
}) {
  return (
    <div className="finance-dossiers-table-shell">
      <div className="finance-dossiers-table finance-dossiers-table-header" aria-hidden="true">
        <span>AO</span>
        <span>Client</span>
        <span>Module {departmentLabel}</span>
        <span>Priorite / Echeance</span>
        <span>Action</span>
      </div>

      <div className="finance-dossiers-table-list">
        {rows.map((row) => (
          <article key={row.code} className="finance-dossiers-table finance-dossiers-row">
            <div className="finance-dossiers-cell finance-dossiers-primary">
              <span className="mono finance-dossiers-code">{row.code}</span>
              <strong title={row.title}>{row.title}</strong>
            </div>
            <span className="finance-dossiers-cell finance-dossiers-client" title={row.client}>
              {row.client}
            </span>
            <div className="finance-dossiers-cell finance-dossiers-module">
              <StatusBadge label={row.statusLabel} tone={row.statusTone} />
              <small title={row.moduleDetail}>{row.moduleDetail}</small>
            </div>
            <div className="finance-dossiers-cell finance-dossiers-priority-deadline">
              <StatusBadge label={row.priorityLabel} tone={row.priorityTone} />
              <small title={`${row.deadlineLabel} - ${row.deadlineMeta}`}>
                {row.deadlineLabel} · {row.deadlineMeta}
              </small>
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
