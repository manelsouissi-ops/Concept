import { StatusBadge } from "@/components/status-badge.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { formatDate } from "@/lib/utils/format.ts";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";
import type { CdcImportBatchRecord } from "@/lib/archive-cartography/cdc-review.ts";

const STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "En cours",
  COMPLETED: "Termine",
  FAILED: "Echec",
  ROLLED_BACK: "Annule"
};

const STATUS_TONE: Record<string, BadgeTone> = {
  IN_PROGRESS: "info",
  COMPLETED: "success",
  FAILED: "danger",
  ROLLED_BACK: "neutral"
};

const REVIEWER_TYPE_LABEL: Record<string, string> = {
  EXTERNAL_HUMAN: "Revue externe",
  INTERNAL_USER: "Utilisateur interne"
};

export default function CdcImportBatches({ batches }: { batches: CdcImportBatchRecord[] }) {
  if (batches.length === 0) {
    return (
      <EmptyState
        compact
        title="Aucun lot de revue"
        description="Aucun import de revue humaine n'a encore ete effectue."
      />
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Statut</th>
            <th>Type de revue</th>
            <th>Revu par</th>
            <th>Demarre</th>
            <th>Termine</th>
            <th>Total</th>
            <th>Utilisables</th>
            <th>Rejetes</th>
            <th>A revoir</th>
            <th>Mis a jour</th>
            <th>Empreinte source</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <td>
                <StatusBadge tone={STATUS_TONE[batch.status] ?? "neutral"} label={STATUS_LABEL[batch.status] ?? batch.status} />
              </td>
              <td className="table-secondary-cell">{REVIEWER_TYPE_LABEL[batch.reviewerType] ?? batch.reviewerType}</td>
              <td className="table-secondary-cell">{batch.externalReviewerLabel ?? "-"}</td>
              <td className="table-secondary-cell">{formatDate(batch.startedAt)}</td>
              <td className="table-secondary-cell">{batch.completedAt ? formatDate(batch.completedAt) : "-"}</td>
              <td>{batch.totalCount.toLocaleString("fr-FR")}</td>
              <td>{batch.usableCount.toLocaleString("fr-FR")}</td>
              <td>{batch.excludedCount.toLocaleString("fr-FR")}</td>
              <td>{batch.skippedUncertainCount.toLocaleString("fr-FR")}</td>
              <td>{batch.updatedCount.toLocaleString("fr-FR")}</td>
              <td className="table-secondary-cell">
                <code>{batch.sourceWorkbookFingerprint || "-"}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
