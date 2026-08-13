"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import {
  generateGoNoGoReportDraft,
  getGoNoGoReportWorkspace,
  GoNoGoReportClientError,
  regenerateGoNoGoReportDraft,
  saveGoNoGoReportDraft
} from "@/lib/appels-offres/go-no-go-report/client.ts";
import type { GoNoGoReportWorkspaceView } from "@/lib/appels-offres/go-no-go-report/service.ts";
import {
  prepareTenderGoNoGo,
  submitTenderToDg,
  WorkflowClientError
} from "@/lib/appels-offres/workflow/client.ts";

function getErrorMessage(error: unknown) {
  if (error instanceof GoNoGoReportClientError || error instanceof WorkflowClientError) {
    return error.message;
  }

  return "Le rapport Go/No-Go n'a pas pu etre traite.";
}

function buildEmptyForm() {
  return {
    executive_summary: "",
    project_overview: "",
    commercial_summary: "",
    financial_summary: "",
    operational_summary: "",
    key_strengths: "",
    key_risks: "",
    reservations: "",
    assumptions: "",
    unresolved_points: "",
    commercial_recommendation: "",
    ai_recommendation: "",
    recommended_decision: ""
  };
}

function getStatusBadge(status: string | null) {
  switch (status) {
    case "READY_FOR_REVIEW":
      return { label: "A relire", tone: "info" as const };
    case "PREPARED":
      return { label: "Prepare", tone: "success" as const };
    case "SUBMITTED_TO_DG":
      return { label: "Soumis a la DG", tone: "success" as const };
    case "SUPERSEDED":
      return { label: "Supersede", tone: "neutral" as const };
    case "ARCHIVED":
      return { label: "Archive", tone: "neutral" as const };
    case "DRAFT":
    default:
      return { label: "Brouillon", tone: "warning" as const };
  }
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function GoNoGoReportBuilder({
  code,
  onOpenFciModule,
  onOpenDocuments
}: {
  code: string;
  onOpenFciModule: (moduleCode: "A" | "B" | "C" | "D") => void;
  onOpenDocuments: () => void;
}) {
  const [workspace, setWorkspace] = useState<GoNoGoReportWorkspaceView | null>(null);
  const [form, setForm] = useState(buildEmptyForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  async function loadWorkspace() {
    setIsLoading(true);
    try {
      const data = await getGoNoGoReportWorkspace(code);
      setWorkspace(data);
      setForm(
        data.report.editable_payload
          ? {
              executive_summary: data.report.editable_payload.executive_summary,
              project_overview: data.report.editable_payload.project_overview,
              commercial_summary: data.report.editable_payload.commercial_summary,
              financial_summary: data.report.editable_payload.financial_summary,
              operational_summary: data.report.editable_payload.operational_summary,
              key_strengths: data.report.editable_payload.key_strengths,
              key_risks: data.report.editable_payload.key_risks,
              reservations: data.report.editable_payload.reservations,
              assumptions: data.report.editable_payload.assumptions,
              unresolved_points: data.report.editable_payload.unresolved_points,
              commercial_recommendation: data.report.editable_payload.commercial_recommendation,
              ai_recommendation: data.report.editable_payload.ai_recommendation ?? "",
              recommended_decision: data.report.editable_payload.recommended_decision ?? ""
            }
          : buildEmptyForm()
      );
      setError(null);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [code]);

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(successMessage);
      await loadWorkspace();
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading && !workspace) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement du rapport Go/No-Go...</p>
        </div>
      </section>
    );
  }

  if (error && !workspace) {
    return (
      <section className="section-card">
        <div className="section-body">
          <div className="callout warning">{error}</div>
        </div>
      </section>
    );
  }

  if (!workspace) {
    return null;
  }

  const badge = getStatusBadge(workspace.report.status);
  const hasReport = workspace.report.id != null;
  const canGenerate = workspace.permissions.can_generate;
  const canEdit = workspace.permissions.can_edit;
  const canPrepare = workspace.permissions.can_prepare;
  const canSubmit = workspace.permissions.can_submit;
  const canRegenerate = workspace.permissions.can_regenerate;
  const canExport = workspace.permissions.can_export && hasReport;

  const ficheCdcValidated =
    workspace.appel_offres.business_status === "fiche_validee"
    || workspace.appel_offres.business_status === "offre_autorisee"
    || workspace.appel_offres.business_status === "offre_rejetee";

  const DEPARTMENT_LABEL: Record<"A" | "B" | "C" | "D", string> = {
    A: "FCI Commerciale",
    B: "FCI Financière",
    C: "FCI Opérationnelle",
    D: "FCI Direction Générale"
  };
  const moduleReadiness = (["A", "B", "C", "D"] as const).map((moduleCode) => ({
    key: moduleCode,
    moduleCode,
    label: DEPARTMENT_LABEL[moduleCode],
    validated:
      workspace.source_readiness.modules.find((module) => module.module_code === moduleCode)
        ?.status === "validated"
  }));
  const readinessItems = [
    { key: "fiche", label: "Fiche CDC", validated: ficheCdcValidated },
    ...moduleReadiness
  ];
  const allReady = readinessItems.every((item) => item.validated);
  const missingCount = readinessItems.filter((item) => !item.validated).length;

  // Nothing to prepare yet: keep the page to a short readiness checklist
  // instead of a full editable report form with export controls that
  // cannot do anything useful until the Fiche CDC and all four FCI are
  // validated.
  if (!hasReport && !allReady) {
    return (
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Préparation du Go/No-Go</h3>
            <p className="meta">
              Le rapport sera généré à partir de la Fiche CDC et des contributions validées des
              quatre directions.
            </p>
          </div>
        </div>
        <div className="section-body stack">
          <div className="workspace-info-list">
            {readinessItems.map((item) => (
              <div className="workspace-info-row" key={item.key}>
                <span>{item.label}</span>
                <StatusBadge
                  label={item.validated ? "Validée" : "En cours"}
                  tone={item.validated ? "success" : "neutral"}
                />
              </div>
            ))}
          </div>
          <div className="callout info">
            {missingCount > 1
              ? `${missingCount} contributions sont encore attendues.`
              : "1 contribution est encore attendue."}
          </div>
          <div className="workspace-card-actions">
            <button type="button" className="button button-primary" disabled title="Toutes les contributions doivent être validées avant de générer le rapport.">
              Générer le rapport Go/No-Go
            </button>
            {(["A", "B", "C", "D"] as const).map((moduleCode) => (
              <button
                key={moduleCode}
                type="button"
                className="button button-ghost button-small"
                onClick={() => onOpenFciModule(moduleCode)}
              >
                Ouvrir {DEPARTMENT_LABEL[moduleCode]}
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // Everything is validated but the report hasn't been generated yet: one
  // dedicated "ready" screen with a single primary action, instead of
  // dropping straight into the full editable report form.
  if (!hasReport && allReady) {
    return (
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Prêt pour la génération</h3>
            <p className="meta">Tous les éléments nécessaires sont disponibles.</p>
          </div>
        </div>
        <div className="section-body stack">
          <div className="workspace-info-list">
            {readinessItems.map((item) => (
              <div className="workspace-info-row" key={item.key}>
                <span>{item.label}</span>
                <StatusBadge label="Validée" tone="success" />
              </div>
            ))}
          </div>
          {error ? <div className="callout warning">{error}</div> : null}
          <div className="workspace-card-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void runAction(() => generateGoNoGoReportDraft(code), "Le rapport a ete genere.")}
              disabled={!canGenerate || isSubmitting}
            >
              Générer le rapport Go/No-Go
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Progressive disclosure: one dominant primary action per state, other
  // controls only render when they are actually usable right now.
  const primaryActionKey = canGenerate && !hasReport
    ? "generate"
    : canPrepare
      ? "prepare"
      : canSubmit
        ? "submit"
        : canEdit && hasReport
          ? "save"
          : "none";

  return (
    <div className="stack">
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Statut du rapport</h3>
            <p className="meta">Le Commercial prepare le package officiel avant soumission a la DG.</p>
          </div>
          <StatusBadge label={badge.label} tone={badge.tone} />
        </div>
        <div className="section-body stack">
          <div className="workspace-info-list">
            <div className="workspace-info-row">
              <span>Version</span>
              <strong>{workspace.report.version ?? "Aucune"}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Snapshot source</span>
              <strong>{formatDateTime(workspace.source_readiness.source_snapshot_at)}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Prepare le</span>
              <strong>{formatDateTime(workspace.report.prepared_at)}</strong>
            </div>
            <div className="workspace-info-row">
              <span>Soumis le</span>
              <strong>{formatDateTime(workspace.report.submitted_at)}</strong>
            </div>
          </div>
          {workspace.report.is_stale ? (
            <div className="callout warning">
              Le snapshot source du rapport est obsolete. Regenerez une nouvelle version avant preparation ou soumission.
            </div>
          ) : null}
          {workspace.report.legacy_notice ? (
            <div className="callout info">{workspace.report.legacy_notice}</div>
          ) : null}
          {message ? <div className="callout info">{message}</div> : null}
          {error ? <div className="callout warning">{error}</div> : null}
          <div className="workspace-card-actions">
            {canGenerate && !hasReport ? (
              <button
                type="button"
                className={primaryActionKey === "generate" ? "button button-primary" : "button button-secondary"}
                onClick={() => void runAction(() => generateGoNoGoReportDraft(code), "Le rapport a ete genere.")}
                disabled={isSubmitting}
              >
                Generer le rapport
              </button>
            ) : null}
            {canEdit && hasReport ? (
              <button
                type="button"
                className={primaryActionKey === "save" ? "button button-primary" : "button button-secondary"}
                onClick={() =>
                  void runAction(
                    () =>
                      saveGoNoGoReportDraft(code, {
                        ...form,
                        ai_recommendation: form.ai_recommendation || null,
                        recommended_decision:
                          form.recommended_decision === "go" || form.recommended_decision === "no_go"
                            ? form.recommended_decision
                            : null,
                        expectedVersion: workspace.report.version
                      }),
                    "Le brouillon a ete enregistre."
                  )
                }
                disabled={isSubmitting}
              >
                Enregistrer le brouillon
              </button>
            ) : null}
            {canPrepare ? (
              <button
                type="button"
                className={primaryActionKey === "prepare" ? "button button-primary" : "button button-secondary"}
                onClick={() => void runAction(() => prepareTenderGoNoGo(code), "Le rapport a ete marque comme prepare.")}
                disabled={isSubmitting}
              >
                Marquer comme prepare
              </button>
            ) : null}
            {canSubmit ? (
              <button
                type="button"
                className={primaryActionKey === "submit" ? "button button-primary" : "button button-secondary"}
                onClick={() => void runAction(() => submitTenderToDg(code), "Le rapport a ete soumis a la DG.")}
                disabled={isSubmitting}
              >
                Soumettre a la Direction generale
              </button>
            ) : null}
            {hasReport ? (
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setShowPreview((current) => !current)}
              >
                {showPreview ? "Masquer la previsualisation" : "Previsualiser"}
              </button>
            ) : null}
            {canRegenerate ? (
              <button
                type="button"
                className="button button-ghost"
                onClick={() => void runAction(() => regenerateGoNoGoReportDraft(code), "Une nouvelle version du rapport a ete creee.")}
                disabled={isSubmitting}
              >
                Regenerer une nouvelle version
              </button>
            ) : null}
            {canExport ? (
              <>
                <a
                  className="button button-ghost"
                  href={`/api/appels-offres/${encodeURIComponent(code)}/go-no-go-report/export?format=docx`}
                >
                  Exporter DOCX
                </a>
                <a
                  className="button button-ghost"
                  href={`/api/appels-offres/${encodeURIComponent(code)}/go-no-go-report/export?format=pdf`}
                >
                  Exporter PDF
                </a>
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Readiness des sources</h3>
            <p className="meta">Les quatre contributions départementales doivent rester validées et alignées avec le snapshot source.</p>
          </div>
        </div>
        <div className="section-body">
          <div className="workspace-info-list">
            <div className="workspace-info-row">
              <span>Fiche CDC</span>
              <strong>{workspace.source_readiness.fiche_cdc_version ?? "Information non disponible"}</strong>
            </div>
            {workspace.source_readiness.modules.map((module) => (
              <div className="workspace-info-row" key={module.module_code}>
                <span>FCI {module.module_code}</span>
                <strong>
                  {module.status} · v{module.version ?? "?"} · {module.validated_by ?? "Non valide"}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Rapport editable</h3>
            <p className="meta">Le Commercial consolide, corrige et complete ce rapport avant soumission.</p>
          </div>
        </div>
        <div className="section-body stack">
          {([
            { fieldKey: "executive_summary", label: "Synthèse exécutive", rows: 5 },
            { fieldKey: "project_overview", label: "Présentation / contexte du projet", rows: 4 },
            { fieldKey: "commercial_summary", label: "Enjeux commerciaux", rows: 4 },
            { fieldKey: "financial_summary", label: "Analyse financière", rows: 4 },
            { fieldKey: "operational_summary", label: "Faisabilité / capacité opérationnelle", rows: 4 },
            { fieldKey: "key_strengths", label: "Opportunités", rows: 3 },
            { fieldKey: "key_risks", label: "Principaux risques", rows: 4 },
            { fieldKey: "reservations", label: "Conditions / réserves", rows: 3 },
            { fieldKey: "assumptions", label: "Hypothèses utilisées", rows: 3 },
            { fieldKey: "unresolved_points", label: "Points de vigilance", rows: 3 },
            { fieldKey: "commercial_recommendation", label: "Recommandation préparatoire", rows: 3 },
            { fieldKey: "ai_recommendation", label: "Recommandation IA", rows: 3 }
          ] as const).map(({ fieldKey, label, rows }) => (
            <div className="field" key={fieldKey}>
              <label htmlFor={fieldKey}>{label}</label>
              <textarea
                id={fieldKey}
                className="textarea"
                rows={Number(rows)}
                value={form[fieldKey as keyof typeof form]}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [fieldKey]: event.target.value
                  }))
                }
                disabled={!canEdit || !hasReport}
              />
            </div>
          ))}
          <div className="field">
            <label htmlFor="recommended-decision">Proposition GO / NO-GO</label>
            <select
              id="recommended-decision"
              className="input"
              value={form.recommended_decision}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  recommended_decision: event.target.value
                }))
              }
              disabled={!canEdit || !hasReport}
            >
              <option value="">Selectionner</option>
              <option value="go">GO</option>
              <option value="no_go">NO-GO</option>
            </select>
          </div>
        </div>
      </section>

      {showPreview ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Previsualisation</h3>
              <p className="meta">Lecture rapide du rapport tel qu'il sera transmis.</p>
            </div>
          </div>
          <div className="section-body stack">
            {[
              ["Synthèse exécutive", form.executive_summary],
              ["Présentation / contexte du projet", form.project_overview],
              ["Enjeux commerciaux", form.commercial_summary],
              ["Analyse financière", form.financial_summary],
              ["Faisabilité / capacité opérationnelle", form.operational_summary],
              ["Opportunités", form.key_strengths],
              ["Principaux risques", form.key_risks],
              ["Conditions / réserves", form.reservations],
              ["Hypothèses utilisées", form.assumptions],
              ["Points de vigilance", form.unresolved_points],
              ["Recommandation préparatoire", form.commercial_recommendation],
              ["Recommandation IA", form.ai_recommendation || "Information non disponible"],
              [
                "Proposition GO / NO-GO",
                form.recommended_decision === "go"
                  ? "GO"
                  : form.recommended_decision === "no_go"
                    ? "NO-GO"
                    : "A confirmer"
              ]
            ].map(([title, content]) => (
              <article key={title} className="workspace-card compact">
                <span className="card-kicker">{title}</span>
                <p>{content || "Information non disponible"}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Sources de support</h3>
            <p className="meta">Les FCI contributives restent consultables en lecture seule depuis leurs modules respectifs.</p>
          </div>
        </div>
        <div className="section-body">
          <div className="workspace-card-actions">
            <button type="button" className="button button-secondary" onClick={onOpenDocuments}>
              Ouvrir les documents
            </button>
            {(["A", "B", "C", "D"] as const).map((moduleCode) => (
              <button
                key={moduleCode}
                type="button"
                className="button button-ghost"
                onClick={() => onOpenFciModule(moduleCode)}
              >
                Ouvrir FCI {moduleCode}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Historique des versions</h3>
            <p className="meta">Les versions soumises restent immuables; une regeneration cree une nouvelle version.</p>
          </div>
        </div>
        <div className="section-body">
          {workspace.history.length > 0 ? (
            <div className="department-history-list">
              {workspace.history.map((entry) => (
                <article key={entry.id} className="department-history-item">
                  <div className="department-history-copy">
                    <strong>Version {entry.version}</strong>
                    <span>{entry.status}</span>
                  </div>
                  <span className="department-history-date">
                    {formatDateTime(entry.submitted_at ?? entry.prepared_at ?? entry.created_at)}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucun rapport genere"
              description="Générez d'abord un rapport consolidé à partir des quatre contributions départementales validées."
            />
          )}
        </div>
      </section>
    </div>
  );
}
