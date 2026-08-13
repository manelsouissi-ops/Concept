import type { FciModuleSummaryPresentation } from "@/lib/appels-offres/fci/presentation.ts";
import type { FciModuleDefinition } from "@/lib/appels-offres/fci/rendering.ts";
import {
  formatFciDateTime,
  getFciContributionStatusKey,
  getFciGenerationFailurePresentation,
  getFciGenerationJobStatusPresentation,
  getOwnContributionActionLabel,
  getOwnContributionStatusPresentation
} from "@/lib/appels-offres/fci/ui.ts";
import { StatusBadge } from "@/components/status-badge.tsx";

/**
 * "Ma FCI" - the current user's own, editable contribution. Not used for
 * other departments' contributions anymore; those render as compact
 * read-only tracking rows instead (see FciContributionRow).
 */
export function FciModuleCard({
  definition,
  summary,
  disabled = false,
  disabledMessage,
  onAction
}: {
  definition: FciModuleDefinition;
  summary?: FciModuleSummaryPresentation;
  disabled?: boolean;
  disabledMessage?: string;
  onAction: (action: "open" | "regenerate" | "validate" | "history") => void;
}) {
  const availableActions = summary?.available_actions ?? [];
  const statusKey = getFciContributionStatusKey({
    status: summary?.status ?? "not_started",
    hasData: summary?.has_data ?? false,
    readyForCompletion: summary?.completion.ready_for_completion ?? false,
    staleSource: summary?.stale_source ?? false,
    hasFailedGeneration: summary?.current_error?.code != null
  });
  const status = getOwnContributionStatusPresentation(statusKey);
  const actionLabel = getOwnContributionActionLabel(statusKey);
  const hasFields = (summary?.completion.total ?? 0) > 0;
  const failurePresentation =
    statusKey === "generation_failed"
      ? getFciGenerationFailurePresentation({
          errorCode: summary?.current_error?.code ?? null,
          errorMessage: summary?.current_error?.message ?? null,
          lastAttemptAt: summary?.current_error?.last_attempt_at ?? null
        })
      : null;

  return (
    <article className={`workspace-card fci-module-card${disabled ? " is-disabled" : ""}`}>
      <div className="workspace-card-topline">
        <div>
          <span className="card-kicker">Ma FCI</span>
          <h3>{definition.departmentLabel}</h3>
        </div>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <p className="workspace-card-description">{definition.description}</p>
      {hasFields ? (
        <div className="workspace-card-meta">
          <span>Progression : {summary?.completion.percentage ?? 0}%</span>
          <span>Champs complétés : {summary?.completion.filled ?? 0} / {summary?.completion.total ?? 0}</span>
        </div>
      ) : null}
      {summary?.last_saved_at ? (
        <p className="meta">Dernier enregistrement : {formatFciDateTime(summary.last_saved_at)}</p>
      ) : null}
      {summary?.validated_at ? (
        <p className="meta">
          Validée par {summary.validated_by ?? "un contributeur"} le {formatFciDateTime(summary.validated_at)}
        </p>
      ) : null}
      {summary?.status === "generating" ? (
        <p className="meta">{getFciGenerationJobStatusPresentation("running").label}</p>
      ) : null}
      {statusKey === "stale_validated" ? (
        <div className="callout warning">
          La Fiche CDC a été modifiée depuis la validation de ce module. Vérifiez que le contenu est toujours à jour.
        </div>
      ) : null}
      {failurePresentation ? (
        <div className="callout warning">
          <strong>{failurePresentation.title}</strong>
          <p>{failurePresentation.message}</p>
          {failurePresentation.lastAttemptLabel ? <p className="meta">{failurePresentation.lastAttemptLabel}</p> : null}
        </div>
      ) : null}
      {disabled ? <p className="meta">{disabledMessage}</p> : null}
      <div className="workspace-card-actions">
        <button
          type="button"
          className="button button-primary button-small"
          onClick={() => onAction("open")}
          disabled={disabled}
          aria-disabled={disabled}
        >
          {actionLabel}
        </button>
        {availableActions.includes("regenerate") && statusKey !== "generation_failed" ? (
          <button
            type="button"
            className="button button-ai button-small"
            onClick={() => onAction("regenerate")}
            disabled={disabled}
            aria-disabled={disabled}
          >
            Régénérer
          </button>
        ) : null}
        {availableActions.includes("validate") ? (
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onAction("validate")}
            disabled={disabled}
            aria-disabled={disabled}
          >
            Valider
          </button>
        ) : null}
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => onAction("history")}
          disabled={disabled}
          aria-disabled={disabled}
        >
          Historique
        </button>
      </div>
    </article>
  );
}
