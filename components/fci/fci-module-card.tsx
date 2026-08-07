import type { FciModuleSummaryPresentation } from "@/lib/appels-offres/fci/presentation.ts";
import type { FciModuleDefinition } from "@/lib/appels-offres/fci/rendering.ts";
import {
  formatFciDateTime,
  formatFciSafeErrorMessage,
  getFciFormStatusPresentation,
  getFciGenerationJobStatusPresentation
} from "@/lib/appels-offres/fci/ui.ts";
import { StatusBadge } from "@/components/status-badge.tsx";

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
  const safeErrorMessage = formatFciSafeErrorMessage(summary?.current_error?.message);
  const formStatus = summary ? getFciFormStatusPresentation(summary.form_status) : null;
  const openLabel =
    summary?.form_status && summary.form_status !== "not_started" ? "Continuer" : "Ouvrir";

  return (
    <article className={`workspace-card fci-module-card${disabled ? " is-disabled" : ""}`}>
      <div className="workspace-card-topline">
        <div>
          <span className="card-kicker">Module {definition.moduleCode}</span>
          <h3>{definition.departmentLabel}</h3>
        </div>
        {formStatus ? (
          <StatusBadge label={formStatus.label} tone={formStatus.tone} />
        ) : null}
      </div>
      <p className="workspace-card-description">{definition.description}</p>
      <div className="workspace-card-meta">
        <span>Progression : {summary?.completion.percentage ?? 0}%</span>
        <span>Obligatoires : {summary?.completion.filled ?? 0} / {summary?.completion.total ?? 0}</span>
        <span>Sauvegarde : {formatFciDateTime(summary?.last_saved_at ?? null)}</span>
      </div>
      {summary?.validated_at ? (
        <p className="meta">
          Valide par {summary.validated_by ?? "inconnu"} le {formatFciDateTime(summary.validated_at)}
        </p>
      ) : null}
      {summary?.status === "generating" ? (
        <p className="meta">
          {getFciGenerationJobStatusPresentation("running").label}
        </p>
      ) : null}
      {summary?.permissions.read_only_message ? (
        <p className="meta">{summary.permissions.read_only_message}</p>
      ) : null}
      {safeErrorMessage ? (
        <div className="callout warning">{safeErrorMessage}</div>
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
          {openLabel}
        </button>
        {availableActions.includes("regenerate") ? (
          <button
            type="button"
            className="button button-ai button-small"
            onClick={() => onAction("regenerate")}
            disabled={disabled}
            aria-disabled={disabled}
          >
            Regenerer
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
