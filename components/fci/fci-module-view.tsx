"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  FciClientError,
  downloadFciModuleExport,
  getFciModule,
  getFciModuleHistory,
  prepareFciManualCompletion,
  prepareFciRegeneration,
  saveFciModule,
  validateFciModule,
  type FciModuleHistoryPresentation
} from "@/lib/appels-offres/fci/client.ts";
import {
  calculateFciPayloadCompletion,
  createEmptyFciModulePayload,
  getFciModuleDefinition,
  getFciModulePayloadContractVersion,
  isRecognizedFciModulePayload,
  type FciFormPayload,
  type FciPayloadValidationError
} from "@/lib/appels-offres/fci/rendering.ts";
import type { FciAiSupportedModuleCode } from "@/lib/appels-offres/fci/ai-contracts.ts";
import type { FciModulePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import {
  formatFciClientErrorMessage,
  formatFciDateTime,
  formatFciSourceLabel,
  getFciGenerationFailurePresentation,
  getFciGenerationJobStatusPresentation,
  getFciSourceFreshnessPresentation
} from "@/lib/appels-offres/fci/ui.ts";
import { FciModuleHeader } from "./fci-module-header.tsx";
import { FciModuleEditor } from "./fci-module-editor.tsx";
import { FciModuleActions, type FciModuleActionKind } from "./fci-module-actions.tsx";
import { FciModuleHistory } from "./fci-module-history.tsx";
import { FciGenerationFailureCard } from "./fci-generation-failure-card.tsx";
import { FciConfirmDialog } from "./fci-confirm-dialog.tsx";
import { FciErrorState } from "./fci-error-state.tsx";
import { FciFormStatusBadge, FciGenerationJobStatusBadge } from "./fci-status-badge.tsx";

const FCI_POLL_INTERVAL_MS = 4_000;
const FCI_MAX_POLL_ATTEMPTS = 30;

type DialogState =
  | { kind: "validate" }
  | { kind: "regenerate" }
  | null;

function escapeSelectorValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildEmptyPayload(
  moduleCode: FciAiSupportedModuleCode,
  modulePresentation: FciModulePresentation
) {
  return createEmptyFciModulePayload(moduleCode, {
    codeInterne: modulePresentation.appel_offres.code,
    intituleOffre: modulePresentation.appel_offres.title,
    dateDepot: modulePresentation.appel_offres.due_date,
    sourceFiche: {
      code_interne: modulePresentation.appel_offres.code,
      version: modulePresentation.source_fiche.version ?? "unavailable",
      hash: modulePresentation.source_fiche.hash ?? null,
      status:
        (modulePresentation.source_fiche.status as
          | "processing"
          | "draft"
          | "validated"
          | "error")
        ?? "draft",
      validated_at: modulePresentation.source_fiche.is_validated
        ? modulePresentation.source_fiche.updated_at
        : null
    }
  });
}

export function FciModuleView({
  code,
  moduleCode,
  onBack,
  onWorkspaceRefresh
}: {
  code: string;
  moduleCode: FciAiSupportedModuleCode;
  onBack: () => void;
  onWorkspaceRefresh: () => Promise<void>;
}) {
  const definition = getFciModuleDefinition(moduleCode);
  const [modulePresentation, setModulePresentation] = useState<FciModulePresentation | null>(null);
  const [history, setHistory] = useState<FciModuleHistoryPresentation | null>(null);
  const [editablePayload, setEditablePayload] = useState<FciFormPayload | null>(null);
  const [originalPayload, setOriginalPayload] = useState<FciFormPayload | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<FciPayloadValidationError[]>([]);
  const [unsupportedPayload, setUnsupportedPayload] = useState<Record<string, unknown> | null>(null);
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<FciModuleActionKind | null>(null);
  const [isFailureActionPending, setIsFailureActionPending] = useState(false);

  async function loadModule() {
    setErrorMessage(null);
    try {
      const [moduleData, historyData] = await Promise.all([
        getFciModule(code, moduleCode),
        getFciModuleHistory(code, moduleCode)
      ]);

      setModulePresentation(moduleData);
      setHistory(historyData);

      const rawPayload = moduleData.latest_data?.data ?? null;
      if (rawPayload && isRecognizedFciModulePayload(rawPayload, moduleCode)) {
        const typedPayload = rawPayload as FciFormPayload;
        setEditablePayload(typedPayload);
        setOriginalPayload(typedPayload);
        setUnsupportedPayload(null);
      } else if (rawPayload) {
        setEditablePayload(null);
        setOriginalPayload(null);
        setUnsupportedPayload(rawPayload as Record<string, unknown>);
      } else {
        const emptyPayload = buildEmptyPayload(moduleCode, moduleData);
        setEditablePayload(emptyPayload);
        setOriginalPayload(emptyPayload);
        setUnsupportedPayload(null);
      }
    } catch (error) {
      const message =
        error instanceof FciClientError
          ? formatFciClientErrorMessage(error)
          : "Impossible de charger le module FCI.";
      setErrorMessage(message);
    }
  }

  useEffect(() => {
    void loadModule();
  }, [code, moduleCode]);

  const isPollingGeneration = useMemo(() => {
    const status = modulePresentation?.generation_job?.status ?? null;
    return status === "created" || status === "queued" || status === "running";
  }, [modulePresentation]);

  useEffect(() => {
    if (!isPollingGeneration) {
      setPollAttempts(0);
      return;
    }

    if (pollAttempts >= FCI_MAX_POLL_ATTEMPTS) {
      setInfoMessage((current) =>
        current
        ?? "La generation FCI est toujours en cours. Actualisez le module pour verifier l'avancement."
      );
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void reloadAll().finally(() => {
        setPollAttempts((current) => current + 1);
      });
    }, FCI_POLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isPollingGeneration, pollAttempts]);

  const isDirty = useMemo(() => {
    if (!editablePayload || !originalPayload) {
      return false;
    }

    return JSON.stringify(editablePayload) !== JSON.stringify(originalPayload);
  }, [editablePayload, originalPayload]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  useEffect(() => {
    const firstError = validationErrors[0];
    if (!firstError) {
      return;
    }

    const selectorValue = escapeSelectorValue(firstError.path);
    const fieldContainer = document.querySelector<HTMLElement>(
      `[data-fci-field-path="${selectorValue}"]`
    );

    if (!fieldContainer) {
      return;
    }

    const fieldRect = fieldContainer.getBoundingClientRect();
    const centeredTop =
      window.scrollY
      + fieldRect.top
      - Math.max(24, (window.innerHeight - fieldRect.height) / 2);
    window.scrollTo({
      top: Math.max(0, centeredTop),
      behavior: "smooth"
    });
    const focusTarget = fieldContainer.querySelector<HTMLElement>(
      "input, textarea, select, [tabindex='-1']"
    );
    focusTarget?.focus({ preventScroll: true });
  }, [validationErrors]);

  const completion = useMemo(
    () =>
      editablePayload
        ? calculateFciPayloadCompletion(editablePayload, moduleCode)
        : {
            filled: 0,
            total: 0,
            percentage: 0,
            humanInputsRequired: 0,
            satisfiedRepeatableRules: 0,
            totalRepeatableRules: 0
          },
    [editablePayload, moduleCode]
  );

  if (!definition) {
    return (
      <FciErrorState
        title="Module FCI introuvable"
        message={`Le module ${moduleCode} n'est pas supporte dans cette phase.`}
        onRetry={() => void loadModule()}
      />
    );
  }

  async function reloadAll() {
    await loadModule();
    await onWorkspaceRefresh();
  }

  // No existing data is at risk here (regeneration only appends a new
  // version), so retrying a failed generation fires immediately - unlike
  // "Régénérer" on a validated draft, it doesn't need a confirmation dialog.
  function handleRetryGeneration() {
    if (isFailureActionPending) {
      return;
    }

    setErrorMessage(null);
    setIsFailureActionPending(true);
    void (async () => {
      try {
        await prepareFciRegeneration(code, moduleCode);
        setPollAttempts(0);
        setInfoMessage("Nouvelle tentative de génération lancée.");
        await reloadAll();
      } catch (error) {
        setErrorMessage(
          error instanceof FciClientError
            ? formatFciClientErrorMessage(error)
            : "La nouvelle tentative de génération a échoué. Réessayez."
        );
      } finally {
        setIsFailureActionPending(false);
      }
    })();
  }

  function handleManualComplete() {
    if (isFailureActionPending) {
      return;
    }

    setErrorMessage(null);
    setIsFailureActionPending(true);
    void (async () => {
      try {
        const updated = await prepareFciManualCompletion(code, moduleCode);
        setModulePresentation(updated);
        setInfoMessage("Formulaire ouvert en saisie manuelle.");
        await onWorkspaceRefresh();
      } catch (error) {
        setErrorMessage(
          error instanceof FciClientError
            ? formatFciClientErrorMessage(error)
            : "Le passage en saisie manuelle a échoué. Réessayez."
        );
      } finally {
        setIsFailureActionPending(false);
      }
    })();
  }

  function handleAction(action: FciModuleActionKind) {
    if (!modulePresentation) {
      return;
    }

    switch (action) {
      case "reset":
        setEditablePayload(originalPayload);
        setInfoMessage("Modifications locales reinitialisees.");
        setConflictMessage(null);
        setValidationErrors([]);
        return;
      case "history":
        document.getElementById("fci-module-history")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
        return;
      case "refresh":
        void reloadAll();
        return;
      case "save":
        if (!editablePayload) {
          return;
        }

        startTransition(() => {
          void (async () => {
            setPendingAction("save");
            try {
              const saved = await saveFciModule(code, moduleCode, {
                data: editablePayload,
                sourceSummary: {
                  source_fiche_version: editablePayload.source_fiche.version,
                  source_fiche_hash: editablePayload.source_fiche.hash
                },
                confidence: {
                  completion_percentage: completion.percentage,
                  human_inputs_required: completion.humanInputsRequired
                },
                aiNotes: {
                  ai_notes: editablePayload.ai_notes,
                  validation_warnings: editablePayload.validation_warnings
                },
                editor: modulePresentation.current_user.name,
                expectedVersion: modulePresentation.latest_data?.version ?? null
              });

              setModulePresentation(saved);
              const nextPayload = isRecognizedFciModulePayload(saved.latest_data?.data, moduleCode)
                ? (saved.latest_data?.data as FciFormPayload)
                : editablePayload;
              setEditablePayload(nextPayload);
              setOriginalPayload(nextPayload);
              setInfoMessage("Brouillon enregistre.");
              setConflictMessage(null);
              setValidationErrors([]);
              await reloadAll();
            } catch (error) {
              if (error instanceof FciClientError && error.code === "VERSION_CONFLICT") {
                setConflictMessage(
                  "Une version plus recente existe deja sur le serveur. Rechargez la derniere version ou conservez vos modifications localement."
                );
                return;
              }

              setErrorMessage(
                error instanceof FciClientError
                  ? formatFciClientErrorMessage(error)
                  : "Echec de l'enregistrement du module."
              );
            } finally {
              setPendingAction(null);
            }
          })();
        });
        return;
      case "validate":
        setDialogState({ kind: "validate" });
        return;
      case "regenerate":
        setDialogState({ kind: "regenerate" });
        return;
      case "download-docx":
      case "download-pdf":
        setErrorMessage(null);
        setPendingAction(action);
        void (async () => {
          try {
            const format = action === "download-docx" ? "docx" : "pdf";
            const { blob, fileName } = await downloadFciModuleExport(code, moduleCode, format);
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = fileName;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
            setInfoMessage(format === "docx" ? "Export Word pret." : "Export PDF pret.");
          } catch (error) {
            setErrorMessage(
              error instanceof FciClientError
                ? formatFciClientErrorMessage(error)
                : "Export FCI impossible."
            );
          } finally {
            setPendingAction(null);
          }
        })();
        return;
    }
  }

  async function handleDialogConfirm(input: {
    acknowledged: boolean;
    comment: string | null;
  }) {
    if (!modulePresentation) {
      return;
    }

    const currentDialog = dialogState;
    setDialogState(null);

    startTransition(() => {
      void (async () => {
        setPendingAction(currentDialog?.kind ?? null);
        try {
          if (currentDialog?.kind === "validate") {
            if (isDirty) {
              setErrorMessage(
                "Enregistrez d'abord les modifications avant de marquer le module comme termine."
              );
              return;
            }

            await validateFciModule(code, moduleCode, {
              validatedBy: modulePresentation.current_user.name,
              comment: input.comment,
              expectedVersion: modulePresentation.latest_data?.version ?? null,
              acknowledgeStaleSource: input.acknowledged
            });
            setInfoMessage("Module marque comme termine.");
            setValidationErrors([]);
          } else if (currentDialog?.kind === "regenerate") {
            await prepareFciRegeneration(code, moduleCode);
            setPollAttempts(0);
            setInfoMessage("Regeneration lancee. Le module sera actualise automatiquement.");
          }

          await reloadAll();
        } catch (error) {
          if (
            error instanceof FciClientError &&
            error.code === "INVALID_PAYLOAD" &&
            Array.isArray(error.details.validation_errors)
          ) {
            setValidationErrors(error.details.validation_errors as FciPayloadValidationError[]);
          }

          setErrorMessage(
            error instanceof FciClientError
              ? formatFciClientErrorMessage(error)
              : "Action FCI impossible."
          );
        } finally {
          setPendingAction(null);
        }
      })();
    });
  }

  if (errorMessage && !modulePresentation) {
    return <FciErrorState message={errorMessage} onRetry={() => void loadModule()} />;
  }

  if (!modulePresentation) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement du module FCI...</p>
        </div>
      </section>
    );
  }

  const contractVersion =
    editablePayload != null
      ? editablePayload.contract_version
      : getFciModulePayloadContractVersion(modulePresentation.latest_data?.data);
  const sourceFreshness = getFciSourceFreshnessPresentation(
    modulePresentation.stale_source
      ? "stale"
      : modulePresentation.source_fiche.available
        ? "current"
        : "missing"
  );
  const hasFailedGeneration = modulePresentation.module.error_code != null;
  const failurePresentation = hasFailedGeneration
    ? getFciGenerationFailurePresentation({
        errorCode: modulePresentation.module.error_code,
        errorMessage: modulePresentation.module.error_message,
        lastAttemptAt: modulePresentation.generation_job?.completed_at ?? null
      })
    : null;

  return (
    <div className="workspace-stack">
      <FciModuleHeader
        definition={definition}
        modulePresentation={modulePresentation}
        contractVersion={contractVersion}
        onBack={onBack}
      />

      {errorMessage ? <div className="callout warning" role="alert">{errorMessage}</div> : null}
      {infoMessage ? <div className="callout info" aria-live="polite">{infoMessage}</div> : null}
      {modulePresentation.permissions.read_only_message ? (
        <div className="callout info">{modulePresentation.permissions.read_only_message}</div>
      ) : null}
      {modulePresentation.permissions.generation_blocked_reason ? (
        <div className="callout info">{modulePresentation.permissions.generation_blocked_reason}</div>
      ) : null}
      {conflictMessage ? (
        <div className="callout warning">
          <strong>Conflit de version</strong>
          <div>{conflictMessage}</div>
          <div className="workspace-route-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => void reloadAll()}
            >
              Recharger la derniere version
            </button>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => setConflictMessage(null)}
            >
              Conserver mes modifications
            </button>
          </div>
        </div>
      ) : null}
      {validationErrors.length ? (
        <div className="callout warning" role="alert">
          <strong>Le module ne peut pas encore etre marque comme termine.</strong>
          <ul className="fci-validation-list">
            {validationErrors.map((validationError) => (
              <li key={validationError.path}>
                <strong>{validationError.section}</strong> : {validationError.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!modulePresentation.source_fiche.is_validated ? (
        <div className="callout warning">
          La Fiche CDC source n'est pas encore validee. Certaines actions resteront en
          lecture ou en preparation.
        </div>
      ) : null}
      {modulePresentation.stale_source ? (
        <div className="callout warning">
          Ce module repose sur une version ancienne de la Fiche CDC. Une validation
          demandera un acquittement explicite.
        </div>
      ) : null}
      {modulePresentation.module.status === "validated" && isDirty ? (
        <div className="callout info">
          Ce module est deja termine. Toute nouvelle sauvegarde mettra a jour la version
          completee du formulaire.
        </div>
      ) : null}
      {unsupportedPayload ? (
        <div className="callout warning">
          Donnees historiques non reconnues par le contrat FCI actuel. Affichage brut en
          lecture seule.
        </div>
      ) : null}

      <div className="workspace-overview-grid fci-module-summary-grid">
        <section className="workspace-card compact">
          <div className="workspace-card-topline">
            <div>
              <span className="card-kicker">Progression</span>
              <h3>{completion.percentage}%</h3>
            </div>
            <strong>{completion.filled} / {completion.total}</strong>
          </div>
          <p className="workspace-card-description">
            {completion.humanInputsRequired} champs internes restent a relire ou completer.
          </p>
        </section>
        <section className="workspace-card compact">
          <div className="workspace-card-topline">
            <div>
              <span className="card-kicker">Statut formulaire</span>
              <h3>{definition.departmentLabel}</h3>
            </div>
            <FciFormStatusBadge status={modulePresentation.module.form_status} />
          </div>
          <p className="workspace-card-description">
            Dernier enregistrement :{" "}
            {formatFciDateTime(
              modulePresentation.latest_data?.updated_at ?? modulePresentation.module.updated_at
            )}
          </p>
        </section>
        <section className="workspace-card compact">
          <div className="workspace-card-topline">
            <div>
              <span className="card-kicker">Source</span>
              <h3>{formatFciSourceLabel(modulePresentation.source_fiche.version)}</h3>
            </div>
            <span className={`status-badge status-badge-${sourceFreshness.tone}`}>
              <span className="status-badge-dot" aria-hidden="true" />
              {sourceFreshness.label}
            </span>
          </div>
          <p className="workspace-card-description">
            Derniere mise a jour : {formatFciDateTime(modulePresentation.source_fiche.updated_at)}
          </p>
        </section>
        <section className="workspace-card compact">
          <div className="workspace-card-topline">
            <div>
              <span className="card-kicker">Assistance IA</span>
              <h3>
                {modulePresentation.generation_job
                  ? getFciGenerationJobStatusPresentation(modulePresentation.generation_job.status).label
                  : "Aucune"}
              </h3>
            </div>
            {modulePresentation.generation_job ? (
              <FciGenerationJobStatusBadge status={modulePresentation.generation_job.status} />
            ) : null}
          </div>
          <p className="workspace-card-description">
            {hasFailedGeneration
              ? "La dernière tentative de génération a été interrompue."
              : modulePresentation.generation_job
                ? modulePresentation.generation_job.status === "completed"
                  ? "La derniere generation IA a ete terminee."
                  : modulePresentation.generation_job.status === "running"
                    ? "La generation IA est en cours."
                    : modulePresentation.generation_job.status === "queued"
                      || modulePresentation.generation_job.status === "created"
                      ? "La generation IA a ete acceptee et sera traitee en arriere-plan."
                      : "Une execution IA a ete enregistree pour ce module."
                : "Aucune demande de generation enregistree."}
          </p>
        </section>
      </div>

      {hasFailedGeneration && failurePresentation ? (
        <div className="workspace-stack fci-module-content">
          <FciGenerationFailureCard
            presentation={failurePresentation}
            onRetry={handleRetryGeneration}
            onManualComplete={handleManualComplete}
            canRetry={modulePresentation.permissions.can_regenerate}
            canEdit={modulePresentation.permissions.can_edit}
            isBusy={isFailureActionPending}
          />
          <FciModuleHistory history={history} />
        </div>
      ) : (
        <>
          <div className="sticky-action-bar fci-sticky-action-bar">
            <div className="fci-action-bar-meta" aria-live="polite">
              <strong>
                {isDirty
                  ? "Modifications non enregistrees"
                  : `Dernier enregistrement : ${formatFciDateTime(
                    modulePresentation.latest_data?.updated_at ?? modulePresentation.module.updated_at
                  )}`}
              </strong>
              <span>
                {pendingAction === "save"
                  ? "Enregistrement en cours..."
                  : pendingAction === "download-docx"
                    ? "Preparation du document Word..."
                    : pendingAction === "download-pdf"
                      ? "Preparation du PDF..."
                      : "Les actions restent visibles pendant la saisie."}
              </span>
            </div>
            <FciModuleActions
              modulePresentation={modulePresentation}
              isDirty={isDirty}
              isBusy={isPending || pendingAction != null}
              pendingAction={pendingAction}
              onAction={handleAction}
            />
          </div>

          {editablePayload ? (
            <div className="workspace-stack fci-module-content">
              <FciModuleEditor
                definition={definition}
                payload={editablePayload}
                validationErrors={validationErrors}
                readOnly={modulePresentation.permissions.read_only}
                onChange={(nextPayload) => {
                  setValidationErrors([]);
                  setEditablePayload({
                    ...nextPayload,
                    summary: {
                      ...nextPayload.summary,
                      completion_percentage: calculateFciPayloadCompletion(
                        nextPayload,
                        moduleCode
                      ).percentage
                    }
                  });
                }}
              />
              <FciModuleHistory history={history} />
            </div>
          ) : (
            <section className="section-card">
              <div className="section-header">
                <div>
                  <h3>Donnees brutes</h3>
                  <p className="meta">
                    Aucun rendu specialise n'est disponible pour cette structure historique.
                  </p>
                </div>
              </div>
              <div className="section-body">
                <pre className="fci-raw-json">{JSON.stringify(unsupportedPayload, null, 2)}</pre>
              </div>
            </section>
          )}
        </>
      )}

      <FciConfirmDialog
        open={dialogState?.kind === "validate"}
        title={`Marquer ${definition.shortTitle} comme termine`}
        description="Confirmez que les champs obligatoires ont ete completes et verifies avant validation."
        confirmLabel="Marquer comme termine"
        commentLabel="Commentaire de validation"
        commentPlaceholder="Commentaire facultatif"
        requireAcknowledgement={modulePresentation.stale_source}
        acknowledgeLabel="Je confirme valider ce module malgre une source Fiche CDC obsolete."
        onCancel={() => setDialogState(null)}
        onConfirm={handleDialogConfirm}
      />
      <FciConfirmDialog
        open={dialogState?.kind === "regenerate"}
        title={`Relancer la generation du module ${definition.shortTitle}`}
        description="Cette action conserve les versions existantes et lance une nouvelle generation IA avec la source Fiche CDC courante."
        confirmLabel="Relancer la generation"
        onCancel={() => setDialogState(null)}
        onConfirm={handleDialogConfirm}
      />
    </div>
  );
}
