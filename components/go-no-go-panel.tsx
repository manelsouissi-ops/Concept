"use client";

import { useEffect, useMemo, useState } from "react";
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
  formatFciDateTime,
  getFciModuleStatusPresentation
} from "@/lib/appels-offres/fci/ui.ts";
import {
  GoNoGoClientError,
  decideGoNoGo,
  getGoNoGoView,
  reopenGoNoGo
} from "@/lib/appels-offres/go-no-go/client.ts";
import type { GoNoGoView } from "@/lib/appels-offres/go-no-go/service.ts";

type PendingChoice = "go" | "no_go" | null;
type ContributingModuleCode = "A" | "B" | "C";
type ReviewModuleState = {
  moduleCode: ContributingModuleCode;
  modulePresentation: FciModulePresentation | null;
  payload: FciFormPayload | null;
  error: string | null;
};

const CONTRIBUTING_MODULE_CODES: ContributingModuleCode[] = ["A", "B", "C"];

function getErrorMessage(error: unknown) {
  if (error instanceof GoNoGoClientError || error instanceof FciClientError) {
    return error.message;
  }

  return "Une erreur est survenue sur le Go/No-Go.";
}

function DecisionReviewModules({
  code,
  onOpenModule
}: {
  code: string;
  onOpenModule?: ((moduleCode: ContributingModuleCode) => void) | null;
}) {
  const [modules, setModules] = useState<ReviewModuleState[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function loadModules() {
      setIsLoading(true);
      try {
        const nextModules = await Promise.all(
          CONTRIBUTING_MODULE_CODES.map(async (moduleCode) => {
            try {
              const modulePresentation = await getFciModule(code, moduleCode);
              const payload = isRecognizedFciModulePayload(modulePresentation.latest_data?.data, moduleCode)
                ? (modulePresentation.latest_data?.data as FciFormPayload)
                : null;

              return {
                moduleCode,
                modulePresentation,
                payload,
                error: null
              } satisfies ReviewModuleState;
            } catch (error) {
              return {
                moduleCode,
                modulePresentation: null,
                payload: null,
                error: getErrorMessage(error)
              } satisfies ReviewModuleState;
            }
          })
        );

        if (isActive) {
          setModules(nextModules);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadModules();

    return () => {
      isActive = false;
    };
  }, [code]);

  if (isLoading && modules.length === 0) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement des contributions A, B et C...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <h3>Contributions a relire</h3>
          <p className="meta">
            Vue consolidee en lecture seule des FCI Commerciale, Finance et Operations.
          </p>
        </div>
      </div>
      <div className="section-body stack">
        {modules.map((moduleState) => {
          const definition = getFciModuleDefinition(moduleState.moduleCode);
          const statusPresentation = moduleState.modulePresentation
            ? getFciModuleStatusPresentation(moduleState.modulePresentation.module.status)
            : null;

          return (
            <details key={moduleState.moduleCode} className="section-card" open>
              <summary className="markdown-summary">
                <span>
                  {definition?.departmentLabel ?? `Module ${moduleState.moduleCode}`}
                </span>
                {statusPresentation ? (
                  <span style={{ marginLeft: 8 }}>
                    <StatusBadge label={statusPresentation.label} tone={statusPresentation.tone} />
                  </span>
                ) : null}
              </summary>
              <div className="section-body stack">
                {moduleState.modulePresentation ? (
                  <div className="workspace-info-list">
                    <div className="workspace-info-row">
                      <span>Validation</span>
                      <strong>
                        {moduleState.modulePresentation.module.validated_by
                          ? `${moduleState.modulePresentation.module.validated_by} - ${formatFciDateTime(moduleState.modulePresentation.module.validated_at)}`
                          : "Non validee"}
                      </strong>
                    </div>
                    <div className="workspace-info-row">
                      <span>Source Fiche CDC</span>
                      <strong>{moduleState.modulePresentation.source_fiche.version ?? "Indisponible"}</strong>
                    </div>
                  </div>
                ) : null}

                {moduleState.error ? (
                  <div className="callout warning">{moduleState.error}</div>
                ) : null}

                {moduleState.payload && definition ? (
                  <FciModuleEditor
                    definition={definition}
                    payload={moduleState.payload}
                    validationErrors={[]}
                    readOnly
                    onChange={() => undefined}
                  />
                ) : !moduleState.error ? (
                  <EmptyState
                    compact
                    title="Contribution indisponible"
                    description="La derniere version du module n'est pas exploitable dans le contrat FCI actuel."
                  />
                ) : null}

                {onOpenModule ? (
                  <div className="workspace-card-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => onOpenModule(moduleState.moduleCode)}
                    >
                      Ouvrir le module en lecture seule
                    </button>
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

export function GoNoGoPanel({
  code,
  onOpenFci,
  onOpenFciModule,
  decisionCenter = false
}: {
  code: string;
  onOpenFci: () => void;
  onOpenFciModule?: (moduleCode: ContributingModuleCode) => void;
  decisionCenter?: boolean;
}) {
  const [view, setView] = useState<GoNoGoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice>(null);
  const [rationale, setRationale] = useState("");
  const [reserves, setReserves] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isReopening, setIsReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);

  async function loadView() {
    try {
      const nextView = await getGoNoGoView(code);
      setView(nextView);
      setError(null);
    } catch (nextError) {
      setError(getErrorMessage(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setIsLoading(true);
    void loadView();
  }, [code]);

  const contributingModules = useMemo(
    () =>
      (view?.fci.modules ?? []).filter((module) =>
        CONTRIBUTING_MODULE_CODES.includes(module.module_code as ContributingModuleCode)
      ),
    [view]
  );

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
      await decideGoNoGo(code, {
        decision: pendingChoice,
        rationale: rationale.trim(),
        reserves: reserves.trim() || null,
        expectedVersion: view.decision?.version ?? null
      });
      setPendingChoice(null);
      setRationale("");
      setReserves("");
      await loadView();
    } catch (nextError) {
      setSubmitError(getErrorMessage(nextError));
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
      await reopenGoNoGo(code, {
        reason: reopenReason.trim(),
        expectedVersion: view.decision?.version ?? null
      });
      setIsReopening(false);
      setReopenReason("");
      await loadView();
    } catch (nextError) {
      setReopenError(getErrorMessage(nextError));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading && !view) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement du Go/No-Go...</p>
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

  const isValidated = view.fci.overall_status === "validated";
  const decision = view.decision;
  const isDecided = decision != null && (decision.status === "go" || decision.status === "no_go");

  if (!isValidated) {
    return (
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Go/No-Go</h3>
            <p className="meta">
              La decision Go/No-Go n&apos;est disponible qu&apos;une fois les contributions A, B et C validees.
            </p>
          </div>
        </div>
        <div className="section-body">
          <EmptyState
            compact
            title="Disponible une fois les FCI A, B et C validees"
            description="Suivez l'avancement des contributions departementales avant l'arbitrage final."
          />
          <div className="workspace-card-actions">
            <button type="button" className="button button-secondary" onClick={onOpenFci}>
              Suivre les FCI
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Synthese des contributions</h3>
            <p className="meta">
              Les FCI contributives A, B et C validees avant la decision finale.
            </p>
          </div>
        </div>
        <div className="section-body">
          <div className="workspace-info-list">
            {contributingModules.map((module) => {
              const statusPresentation = getFciModuleStatusPresentation(
                module.status as Parameters<typeof getFciModuleStatusPresentation>[0]
              );
              return (
                <div className="workspace-info-row" key={module.module_code}>
                  <span>{module.department_label}</span>
                  <strong>
                    <StatusBadge label={statusPresentation.label} tone={statusPresentation.tone} />
                    {module.validated_by ? (
                      <small style={{ marginLeft: 8 }}>
                        {module.validated_by} - {formatFciDateTime(module.validated_at)}
                      </small>
                    ) : null}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {decisionCenter ? (
        <DecisionReviewModules
          code={code}
          onOpenModule={onOpenFciModule ?? null}
        />
      ) : null}

      {isDecided ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Decision Go/No-Go</h3>
              <p className="meta">
                {decision?.status === "go" ? "Offre autorisee." : "Offre rejetee."}
              </p>
            </div>
            <StatusBadge
              label={decision?.status === "go" ? "Autorise" : "Rejete"}
              tone={decision?.status === "go" ? "success" : "neutral"}
            />
          </div>
          <div className="section-body stack">
            <div className="workspace-info-list">
              <div className="workspace-info-row">
                <span>Decide par</span>
                <strong>{decision?.decided_by ?? "—"}</strong>
              </div>
              <div className="workspace-info-row">
                <span>Date de decision</span>
                <strong>{formatFciDateTime(decision?.decided_at)}</strong>
              </div>
              <div className="workspace-info-row">
                <span>Justification</span>
                <strong>{decision?.rationale ?? "—"}</strong>
              </div>
              {decision?.reserves ? (
                <div className="workspace-info-row">
                  <span>Reserves</span>
                  <strong>{decision.reserves}</strong>
                </div>
              ) : null}
            </div>

            {view.permissions.can_reopen ? (
              isReopening ? (
                <div className="stack">
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
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Decision Go/No-Go</h3>
              <p className="meta">
                {decision?.status === "reouvert"
                  ? "Le dossier a ete reouvert et attend une nouvelle decision."
                  : "Les contributions A, B et C sont validees. La Direction generale peut decider."}
              </p>
            </div>
          </div>
          <div className="section-body stack">
            {!view.permissions.can_decide ? (
              <EmptyState
                compact
                title="En attente de la Direction generale"
                description="Seule la Direction generale peut enregistrer la decision Go/No-Go."
              />
            ) : pendingChoice ? (
              <div className="stack">
                <p className="meta">
                  Vous vous appretez a enregistrer : <strong>{pendingChoice === "go" ? "Go (offre autorisee)" : "No-Go (offre rejetee)"}</strong>
                </p>
                <div className="field">
                  <label htmlFor="go-no-go-rationale">Justification (obligatoire)</label>
                  <textarea
                    id="go-no-go-rationale"
                    className="textarea"
                    value={rationale}
                    onChange={(event) => setRationale(event.target.value)}
                    rows={3}
                    placeholder="Motivez la decision."
                  />
                </div>
                <div className="field">
                  <label htmlFor="go-no-go-reserves">Reserves (optionnel)</label>
                  <textarea
                    id="go-no-go-reserves"
                    className="textarea"
                    value={reserves}
                    onChange={(event) => setReserves(event.target.value)}
                    rows={2}
                    placeholder="Reserves ou conditions eventuelles."
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
                    {isSubmitting ? "Enregistrement..." : "Confirmer"}
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
                <button type="button" className="button button-primary" onClick={() => startChoice("go")}>
                  Go
                </button>
                <button
                  type="button"
                  className="button button-danger-ghost"
                  onClick={() => startChoice("no_go")}
                >
                  No-Go
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
