import { StatusBadge } from "@/components/status-badge.tsx";
import type { FciModuleSummaryPresentation } from "@/lib/appels-offres/fci/presentation.ts";
import type { FciModuleDefinition } from "@/lib/appels-offres/fci/rendering.ts";
import {
  formatFciDateTime,
  getFciContributionStatusKey,
  getOtherContributionStatusPresentation
} from "@/lib/appels-offres/fci/ui.ts";

export function FciContributionRow({
  definition,
  summary,
  assigneeName,
  onConsult
}: {
  definition: FciModuleDefinition;
  summary?: FciModuleSummaryPresentation;
  assigneeName?: string | null;
  onConsult: () => void;
}) {
  const statusKey = getFciContributionStatusKey({
    status: summary?.status ?? "not_started",
    hasData: summary?.has_data ?? false,
    readyForCompletion: summary?.completion.ready_for_completion ?? false,
    staleSource: summary?.stale_source ?? false,
    hasFailedGeneration: summary?.current_error?.code != null
  });
  const status = getOtherContributionStatusPresentation(statusKey);
  const isConsultable = statusKey === "validated" || statusKey === "stale_validated";

  return (
    <article className="fci-contribution-row">
      <div className="fci-contribution-identity">
        <strong>{definition.departmentLabel}</strong>
        <span>{assigneeName || "Responsable à affecter"}</span>
      </div>
      <StatusBadge label={status.label} tone={status.tone} />
      <span className="fci-contribution-date">
        {summary?.validated_at ? formatFciDateTime(summary.validated_at) : "—"}
      </span>
      {isConsultable ? (
        <button type="button" className="button button-ghost button-small" onClick={onConsult}>
          Consulter
        </button>
      ) : (
        <span className="fci-contribution-spacer" aria-hidden="true" />
      )}
    </article>
  );
}
