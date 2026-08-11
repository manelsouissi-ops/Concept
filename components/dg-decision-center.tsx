"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { FciModuleEditor } from "@/components/fci/fci-module-editor.tsx";
import { getFciModule, FciClientError } from "@/lib/appels-offres/fci/client.ts";
import type { FciModulePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import {
  getFciModuleDefinition,
  isRecognizedFciModulePayload,
  type FciFormPayload
} from "@/lib/appels-offres/fci/rendering.ts";
import {
  buildDecisionCenterHeader,
  buildDecisionCenterReadiness,
  buildDecisionCenterReviewCard,
  sanitizeDecisionCenterModuleError,
  type DecisionCenterModuleCode
} from "@/lib/appels-offres/dg-decision-center.ts";
import { formatFciDateTime } from "@/lib/appels-offres/fci/ui.ts";
import {
  GoNoGoClientError,
  decideGoNoGo,
  getGoNoGoView,
  reopenGoNoGo
} from "@/lib/appels-offres/go-no-go/client.ts";
import type { GoNoGoView } from "@/lib/appels-offres/go-no-go/service.ts";
import {
  getGoNoGoReportWorkspace,
  GoNoGoReportClientError
} from "@/lib/appels-offres/go-no-go-report/client.ts";
import type { GoNoGoReportWorkspaceView } from "@/lib/appels-offres/go-no-go-report/service.ts";
import { deriveTenderStage } from "@/lib/appels-offres/tender-stage.ts";
import type { AppelOffresDetail } from "@/lib/appels-offres/types.ts";
import type { FciSetOverallStatus } from "@/lib/appels-offres/fci/types.ts";

type PendingChoice = "go" | "no_go" | null;
type ReviewModuleState = {
  moduleCode: DecisionCenterModuleCode;
  modulePresentation: FciModulePresentation | null;
  payload: FciFormPayload | null;
  safeErrorMessage: string | null;
};

const CONTRIBUTING_MODULE_CODES: DecisionCenterModuleCode[] = ["A", "B", "C"];

function getRootErrorMessage(error: unknown) {
  if (error instanceof GoNoGoClientError || error instanceof FciClientError) {
    return "Le centre de decision n'a pas pu etre charge pour le moment.";
  }

  return "Le centre de decision n'a pas pu etre charge pour le moment.";
}

function formatHeaderDate(value: string | null | undefined) {
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

export function DgDecisionCenter({
  appel,
  fciStatus,
  onOpenDocuments,
  onOpenHistory
}: {
  appel: AppelOffresDetail;
  fciStatus: FciSetOverallStatus | null;
  onOpenDocuments: () => void;
  onOpenHistory: () => void;
}) {
  const [view, setView] = useState<GoNoGoView | null>(null);
  const [reportWorkspace, setReportWorkspace] = useState<GoNoGoReportWorkspaceView | null>(null);
  const [modules, setModules] = useState<ReviewModuleState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice>(null);
  const [rationale, setRationale] = useState("");
  const [reserves, setReserves] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Record<DecisionCenterModuleCode, boolean>>({
    A: false,
    B: false,
    C: false
  });
  const contributionsRef = useRef<HTMLElement | null>(null);

  async function loadDecisionCenter() {
    setIsLoading(true);
    try {
      const [nextView, nextReportWorkspace] = await Promise.all([
        getGoNoGoView(appel.code),
        getGoNoGoReportWorkspace(appel.code)
      ]);
      const nextModules = await Promise.all(
        CONTRIBUTING_MODULE_CODES.map(async (moduleCode) => {
          try {
            const modulePresentation = await getFciModule(appel.code, moduleCode);
            const payload = isRecognizedFciModulePayload(modulePresentation.latest_data?.data, moduleCode)
              ? (modulePresentation.latest_data?.data as FciFormPayload)
              : null;

            return {
              moduleCode,
              modulePresentation,
              payload,
              safeErrorMessage:
                modulePresentation.module.error_code || modulePresentation.module.status === "failed"
                  ? sanitizeDecisionCenterModuleError(moduleCode, modulePresentation.module.error_message)
                  : null
            } satisfies ReviewModuleState;
          } catch (moduleError) {
            return {
              moduleCode,
              modulePresentation: null,
              payload: null,
              safeErrorMessage: sanitizeDecisionCenterModuleError(moduleCode, moduleError)
            } satisfies ReviewModuleState;
          }
        })
      );

      setView(nextView);
      setReportWorkspace(nextReportWorkspace);
      setModules(nextModules);
      setError(null);
    } catch (nextError) {
      setError(getRootErrorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadDecisionCenter();
  }, [appel.code]);

  const readiness = useMemo(
    () =>
      buildDecisionCenterReadiness({
        modules: CONTRIBUTING_MODULE_CODES.map((moduleCode) => ({
          moduleCode,
          summary: view?.fci.modules.find((module) => module.module_code === moduleCode) ?? null,
          modulePresentation: modules.find((module) => module.moduleCode === moduleCode)?.modulePresentation ?? null,
          loadError: modules.find((module) => module.moduleCode === moduleCode)?.safeErrorMessage != null
        }))
      }),
    [modules, view]
  );

  const statusDisplay = useMemo(() => {
    const stage = deriveTenderStage({ detail: appel, fciOverallStatus: fciStatus });
    return { label: stage.label, tone: stage.tone };
  }, [appel, fciStatus]);

  const header = useMemo(
    () =>
      buildDecisionCenterHeader({
        appel,
        dossierStatus: statusDisplay,
        decision: view?.decision ?? null,
        readiness
      }),
    [appel, readiness, statusDisplay, view?.decision]
  );

  const decision = view?.decision ?? null;
  const isDecided = decision != null && (decision.status === "go" || decision.status === "no_go");

  function toggleFullContribution(moduleCode: DecisionCenterModuleCode) {
    setExpandedModules((current) => ({
      ...current,
      [moduleCode]: !current[moduleCode]
    }));
  }

  function scrollToContributions() {
    contributionsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  function startChoice(choice: "go" | "no_go") {
    setPendingChoice(choice);
    setRationale("");
    setReserves("");
    setSubmitError(null);
  }

  function cancelChoice() {
    setPendingChoice(null);
    setRationale("");
    setReserves("");
    setSubmitError(null);
  }

  async function confirmChoice() {
    if (!pendingChoice || !view) {
      return;
    }

    if (!rationale.trim()) {
      setSubmitError("La justification est obligatoire.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await decideGoNoGo(appel.code, {
        decision: pendingChoice,
        rationale: rationale.trim(),
        reserves: reserves.trim() || null,
        expectedVersion: view.decision?.version ?? null
      });
      setPendingChoice(null);
      setRationale("");
      setReserves("");
      await loadDecisionCenter();
    } catch (nextError) {
      setSubmitError(
        nextError instanceof GoNoGoClientError
          ? nextError.message
          : "La decision finale n'a pas pu etre enregistree."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmReopen() {
    if (!view) {
      return;
    }

    if (!reopenReason.trim()) {
      setReopenError("Le motif de reouverture est obligatoire.");
      return;
    }

    setIsSubmitting(true);
    setReopenError(null);
    try {
      await reopenGoNoGo(appel.code, {
        reason: reopenReason.trim(),
        expectedVersion: view.decision?.version ?? null
      });
      setIsReopening(false);
      setReopenReason("");
      await loadDecisionCenter();
    } catch (nextError) {
      setReopenError(
        nextError instanceof GoNoGoClientError
          ? nextError.message
          : "La reouverture n'a pas pu etre enregistree."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading && !view) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement du centre de decision...</p>
        </div>
      </section>
    );
  }

  if (error && !view) {
    return (
      <section className="section-card">
        <div className="section-body">
          <div className="callout warning">{error}</div>
        </div>
      </section>
    );
  }

  if (!view) {
    return null;
  }

  return (
    <div className="stack decision-center-shell">
      <section className="workspace-identity-card decision-center-hero">
        <div className="workspace-backlink-row">
          <Link href="/appels-offres" className="button button-ghost button-small workspace-backlink">
            Retour a la liste
          </Link>
        </div>
        <div className="decision-center-hero-topline">
          <div className="decision-center-hero-copy">
            <span className="page-eyebrow">Centre de decision Go/No-Go</span>
            <h2>Centre de decision Go/No-Go</h2>
            <p className="meta">
              Analyse consolidee des contributions Commerciale, Financiere et Operationnelle.
            </p>
          </div>
          <div className="decision-center-hero-status">
            <StatusBadge label={header.decisionStatusLabel} tone={header.decisionStatusTone} />
            <div className="workspace-card-actions">
              <button type="button" className="button button-secondary button-small" onClick={onOpenDocuments}>
                Documents
              </button>
              <button type="button" className="button button-ghost button-small" onClick={onOpenHistory}>
                Historique
              </button>
            </div>
          </div>
        </div>
        <div className="decision-center-header-grid">
          <div className="workspace-info-row">
            <span>Code dossier</span>
            <strong>{header.dossierCode}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Projet</span>
            <strong>{header.projectTitle}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Client</span>
            <strong>{header.client}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Date limite</span>
            <strong>{formatHeaderDate(header.deadline)}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Statut du dossier</span>
            <strong>{header.dossierStatusLabel}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Statut Fiche CDC</span>
            <strong>{header.ficheStatusLabel}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Statut Go/No-Go</span>
            <strong>{header.decisionStatusLabel}</strong>
          </div>
          <div className="workspace-info-row">
            <span>Derniere mise a jour utile</span>
            <strong>{formatHeaderDate(header.lastRelevantUpdate)}</strong>
          </div>
        </div>
      </section>

      {reportWorkspace ? (
        <section className="section-card decision-center-decision-card">
          <div className="section-header">
            <div>
              <h3>Rapport soumis par le Commercial</h3>
              <p className="meta">
                Objet principal de revue avant la decision finale DG.
              </p>
            </div>
            <StatusBadge
              label={reportWorkspace.report.status ?? "Sans rapport"}
              tone={reportWorkspace.report.is_stale ? "warning" : "info"}
            />
          </div>
          <div className="section-body stack">
            {reportWorkspace.report.legacy_notice ? (
              <div className="callout info">{reportWorkspace.report.legacy_notice}</div>
            ) : null}
            {reportWorkspace.report.is_stale ? (
              <div className="callout warning">
                Le rapport soumis n'est plus a jour par rapport aux sources A/B/C. Une nouvelle version commerciale est requise.
              </div>
            ) : null}
            {reportWorkspace.report.editable_payload ? (
              <>
                <article className="workspace-card compact">
                  <span className="card-kicker">Synthese executive</span>
                  <p>{reportWorkspace.report.editable_payload.executive_summary || "Information non disponible"}</p>
                </article>
                <article className="workspace-card compact">
                  <span className="card-kicker">Recommandation commerciale</span>
                  <p>{reportWorkspace.report.editable_payload.commercial_recommendation || "Information non disponible"}</p>
                </article>
                <div className="decision-center-review-grid">
                  <article className="workspace-card compact">
                    <span className="card-kicker">Risques majeurs</span>
                    <p>{reportWorkspace.report.editable_payload.key_risks || "Information non disponible"}</p>
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Reserves et conditions</span>
                    <p>{reportWorkspace.report.editable_payload.reservations || "Information non disponible"}</p>
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Synthese commerciale</span>
                    <p>{reportWorkspace.report.editable_payload.commercial_summary || "Information non disponible"}</p>
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Synthese financiere</span>
                    <p>{reportWorkspace.report.editable_payload.financial_summary || "Information non disponible"}</p>
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Synthese operationnelle</span>
                    <p>{reportWorkspace.report.editable_payload.operational_summary || "Information non disponible"}</p>
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Points non resolus</span>
                    <p>{reportWorkspace.report.editable_payload.unresolved_points || "Information non disponible"}</p>
                  </article>
                </div>
                <article className="workspace-card compact">
                  <span className="card-kicker">Sources et validation</span>
                  <p>
                    Snapshot: {formatHeaderDate(reportWorkspace.source_readiness.source_snapshot_at)} ·
                    Fiche CDC: {reportWorkspace.source_readiness.fiche_cdc_version ?? "Information non disponible"}
                  </p>
                </article>
              </>
            ) : (
              <EmptyState
                compact
                title="Rapport soumis indisponible"
                description="Le rapport consolide n'est pas disponible en lecture pour le moment."
              />
            )}
          </div>
        </section>
      ) : null}

      <section className={`section-card decision-center-readiness ${readiness.ready ? "is-ready" : "is-waiting"}`}>
        <div className="section-header">
          <div>
            <h3>{readiness.statusTitle}</h3>
            <p className="meta">{readiness.statusDescription}</p>
          </div>
          <div className="decision-center-kpi">
            <strong>
              {readiness.validatedCount} / {readiness.totalCount}
            </strong>
            <span>contributions validees</span>
          </div>
        </div>
        <div className="section-body stack">
          <div className="decision-center-contribution-list">
            {readiness.entries.map((entry) => (
              <article key={entry.moduleCode} className="decision-center-contribution-row">
                <div>
                  <strong>
                    {entry.departmentLabel} - module {entry.moduleCode}
                  </strong>
                  <p className="meta">
                    {entry.validatedBy && entry.validatedAt
                      ? `Validee par ${entry.validatedBy} le ${formatFciDateTime(entry.validatedAt)}`
                      : entry.missingRequirement ?? "Contribution disponible."}
                  </p>
                </div>
                <StatusBadge label={entry.statusLabel} tone={entry.statusTone} />
              </article>
            ))}
          </div>

          {readiness.ready ? (
            <div className="callout info">
              Les contributions Commerciale, Financiere et Operationnelle sont validees.
            </div>
          ) : (
            <div className="callout warning">
              <strong>La decision sera disponible lorsque les trois contributions auront ete validees.</strong>
              <div>
                {readiness.validatedDepartments.length > 0
                  ? `Contributions validees : ${readiness.validatedDepartments.join(", ")}.`
                  : "Aucune contribution validee pour le moment."}
              </div>
              {readiness.pendingDepartments.length > 0 ? (
                <div>En attente : {readiness.pendingDepartments.join(", ")}.</div>
              ) : null}
              {readiness.blockingDepartments.length > 0 ? (
                <div>Blocages : {readiness.blockingDepartments.join(", ")}.</div>
              ) : null}
              <div className="workspace-card-actions">
                <button type="button" className="button button-secondary button-small" onClick={scrollToContributions}>
                  Voir les contributions
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section ref={contributionsRef} id="decision-center-contributions" className="stack">
        {modules.map((moduleState) => {
          const card = buildDecisionCenterReviewCard({
            moduleCode: moduleState.moduleCode,
            modulePresentation: moduleState.modulePresentation,
            payload: moduleState.payload,
            loadError: moduleState.safeErrorMessage != null
          });
          const definition = getFciModuleDefinition(moduleState.moduleCode);
          const isExpanded = expandedModules[moduleState.moduleCode];

          return (
            <section key={moduleState.moduleCode} className="section-card decision-center-review-card">
              <div className="section-header">
                <div>
                  <h3>{card.departmentLabel}</h3>
                  <p className="meta">
                    {card.validatedBy && card.validatedAt
                      ? `Contribution validee par ${card.validatedBy} le ${formatFciDateTime(card.validatedAt)}`
                      : "Contribution disponible en lecture seule."}
                  </p>
                </div>
                <StatusBadge label={card.statusLabel} tone={card.statusTone} />
              </div>
              <div className="section-body stack">
                {card.safeErrorMessage ? (
                  <div className="callout warning">{card.safeErrorMessage}</div>
                ) : null}

                <div className="decision-center-review-grid">
                  <article className="workspace-card compact">
                    <span className="card-kicker">Synthese</span>
                    <p>{card.executiveSummary}</p>
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Risques</span>
                    {card.keyRisks.length > 0 ? (
                      <ul className="decision-center-inline-list">
                        {card.keyRisks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Aucun risque explicite disponible.</p>
                    )}
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Reserves</span>
                    {card.reservations.length > 0 ? (
                      <ul className="decision-center-inline-list">
                        {card.reservations.map((reservation) => (
                          <li key={reservation}>{reservation}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Aucune reserve explicite disponible.</p>
                    )}
                  </article>
                  <article className="workspace-card compact">
                    <span className="card-kicker">Hypotheses importantes</span>
                    {card.assumptions.length > 0 ? (
                      <ul className="decision-center-inline-list">
                        {card.assumptions.map((assumption) => (
                          <li key={assumption}>{assumption}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Aucune hypothese explicite disponible.</p>
                    )}
                  </article>
                </div>

                <article className="workspace-card compact">
                  <span className="card-kicker">Recommendation / conclusion</span>
                  <p>{card.recommendation ?? "Aucune conclusion explicite disponible."}</p>
                </article>

                {definition && moduleState.payload ? (
                  <div className="workspace-card-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => toggleFullContribution(moduleState.moduleCode)}
                    >
                      {isExpanded
                        ? "Masquer la contribution complete"
                        : "Consulter la contribution complete"}
                    </button>
                  </div>
                ) : null}

                {isExpanded && definition && moduleState.payload ? (
                  <FciModuleEditor
                    definition={definition}
                    payload={moduleState.payload}
                    validationErrors={[]}
                    readOnly
                    onChange={() => undefined}
                  />
                ) : null}
              </div>
            </section>
          );
        })}
      </section>

      {isDecided ? (
        <section className="section-card decision-center-decision-card">
          <div className="section-header">
            <div>
              <h3>Decision finale</h3>
              <p className="meta">
                {decision.status === "go" ? "GO enregistre." : "NO-GO enregistre."}
              </p>
            </div>
            <StatusBadge
              label={decision.status === "go" ? "GO" : "NO-GO"}
              tone={decision.status === "go" ? "success" : "danger"}
            />
          </div>
          <div className="section-body stack">
            <div className="workspace-info-list">
              <div className="workspace-info-row">
                <span>Decision</span>
                <strong>{decision.status === "go" ? "GO" : "NO-GO"}</strong>
              </div>
              <div className="workspace-info-row">
                <span>Decidee par</span>
                <strong>{decision.decided_by ?? "Non renseigne"}</strong>
              </div>
              <div className="workspace-info-row">
                <span>Date de decision</span>
                <strong>{formatFciDateTime(decision.decided_at)}</strong>
              </div>
              <div className="workspace-info-row">
                <span>Version</span>
                <strong>{decision.version}</strong>
              </div>
              <div className="workspace-info-row">
                <span>Statut d'archivage</span>
                <strong>{appel.archivedAt ? "Archive" : "Actif"}</strong>
              </div>
            </div>

            <article className="workspace-card compact">
              <span className="card-kicker">Justification</span>
              <p>{decision.rationale ?? "Aucune justification renseignee."}</p>
            </article>

            <article className="workspace-card compact">
              <span className="card-kicker">Reserves et conditions</span>
              <p>{decision.reserves ?? "Aucune reserve renseignee."}</p>
            </article>

            {view.permissions.can_reopen ? (
              isReopening ? (
                <div className="stack">
                  <div className="callout info">
                    Vous etes sur le point de rouvrir la decision finale pour ce dossier.
                  </div>
                  <div className="field">
                    <label htmlFor="go-no-go-reopen-reason">Motif de reouverture</label>
                    <textarea
                      id="go-no-go-reopen-reason"
                      className="textarea"
                      value={reopenReason}
                      onChange={(event) => setReopenReason(event.target.value)}
                      rows={3}
                      placeholder="Expliquez pourquoi ce dossier doit etre reexamine."
                    />
                  </div>
                  {reopenError ? <div className="callout warning">{reopenError}</div> : null}
                  <div className="workspace-card-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void confirmReopen()}
                      disabled={isSubmitting}
                    >
                      Confirmer la reouverture
                    </button>
                    <button
                      type="button"
                      className="button button-ghost"
                      onClick={() => {
                        setIsReopening(false);
                        setReopenReason("");
                        setReopenError(null);
                      }}
                      disabled={isSubmitting}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <div className="workspace-card-actions">
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={() => setIsReopening(true)}
                  >
                    Rouvrir la decision
                  </button>
                </div>
              )
            ) : null}
          </div>
        </section>
      ) : (
        <section className="section-card decision-center-decision-card">
          <div className="section-header">
            <div>
              <h3>Decision finale</h3>
              <p className="meta">
                {readiness.ready
                  ? "Les trois contributions sont validees. La decision finale peut etre enregistree."
                  : "La decision finale sera disponible apres validation des trois contributions."}
              </p>
            </div>
          </div>
          <div className="section-body stack">
            {!readiness.ready || !view.permissions.can_decide ? (
              <article className="workspace-card compact">
                <span className="card-kicker">Arbitrage</span>
                <p>{readiness.explanation}</p>
                <div className="workspace-card-actions">
                  <button type="button" className="button button-secondary button-small" onClick={scrollToContributions}>
                    Voir les contributions
                  </button>
                </div>
              </article>
            ) : pendingChoice ? (
              <div className="stack">
                <div className="callout info">
                  <strong>Vous etes sur le point d'enregistrer une decision finale pour ce dossier.</strong>
                  <div>
                    La justification et les reserves seront enregistrees lors de la validation de la decision.
                  </div>
                </div>
                <p className="meta">
                  Decision preparee : <strong>{pendingChoice === "go" ? "GO" : "NO-GO"}</strong>
                </p>
                <div className="field">
                  <label htmlFor="go-no-go-rationale">Motif de la decision / justification</label>
                  <textarea
                    id="go-no-go-rationale"
                    className="textarea"
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                    rows={4}
                    placeholder="Motivez l'arbitrage final."
                  />
                </div>
                <div className="field">
                  <label htmlFor="go-no-go-reserves">Reserves et conditions</label>
                  <textarea
                    id="go-no-go-reserves"
                    className="textarea"
                    value={reserves}
                    onChange={(event) => setReserves(event.target.value)}
                    rows={3}
                    placeholder="Precisez les reserves ou conditions eventuelles."
                  />
                </div>
                {submitError ? <div className="callout warning">{submitError}</div> : null}
                <div className="workspace-card-actions">
                  <button
                    type="button"
                    className={pendingChoice === "go" ? "button button-primary" : "button button-danger-ghost"}
                    onClick={() => void confirmChoice()}
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? "Enregistrement..."
                      : pendingChoice === "go"
                        ? "Decider GO"
                        : "Decider NO-GO"}
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={cancelChoice}
                    disabled={isSubmitting}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <div className="workspace-card-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => startChoice("go")}
                >
                  Decider GO
                </button>
                <button
                  type="button"
                  className="button button-danger-ghost"
                  onClick={() => startChoice("no_go")}
                >
                  Decider NO-GO
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
