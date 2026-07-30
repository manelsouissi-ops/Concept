"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  CheckCircleIcon,
  ClockIcon,
  DatabaseIcon,
  FileTextIcon,
  LibraryIcon,
  UploadIcon
} from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { findSoftwareMatchCandidate } from "@/lib/appels-offres/software-analysis-matching.ts";
import {
  getCoverageStatusLabel,
  getCoverageStatusTone,
  getExplicitnessLabel,
  getMatchTypeLabel,
  getRowStatusLabel,
  getRowStatusTone,
  getSoftwareAnalysisStatusLabel,
  getSoftwareAnalysisStatusTone
} from "@/lib/appels-offres/software-analysis-presentation.ts";
import type {
  AnalysisConfirmationRecord,
  AnalysisSourceRecord,
  GapMutationInput,
  MatchMutationInput,
  RequirementMutationInput,
  SoftwareAnalysisDetail,
  SoftwareAnalysisImportPreview,
  SoftwareAnalysisImportSummary,
  SourceMutationInput,
  TenderSoftwareGapRecord,
  TenderSoftwareMatchRecord,
  TenderSoftwareRequirementRecord
} from "@/lib/appels-offres/software-analysis-types.ts";
import type { SoftwareRecord } from "@/lib/administration/logiciels/types.ts";

function formatDateTime(value: string | null) {
  if (!value) {
    return "Non disponible";
  }
  return new Date(value).toLocaleString("fr-FR");
}

function createRequirementForm(
  requirement?: TenderSoftwareRequirementRecord | null
): RequirementMutationInput {
  return {
    id: requirement?.id,
    requirementText: requirement?.requirementText ?? "",
    explicitness: requirement?.explicitness ?? "explicit",
    softwareNamesRaw: requirement?.softwareNamesRaw ?? "",
    necessityLevel: requirement?.necessityLevel ?? "",
    justification: requirement?.justification ?? "",
    riskIfMissing: requirement?.riskIfMissing ?? "",
    alternativePossible: requirement?.alternativePossible ?? "",
    sourceExcerpt: requirement?.sourceExcerpt ?? "",
    status: requirement?.status ?? "draft"
  };
}

function createMatchForm(match?: TenderSoftwareMatchRecord | null): MatchMutationInput {
  return {
    id: match?.id,
    requirementId: match?.requirementId ?? null,
    logicielId: match?.logicielId ?? null,
    softwareNameRaw: match?.softwareNameRaw ?? "",
    matchType: match?.matchType ?? "none",
    coverageStatus: match?.coverageStatus ?? "to_confirm",
    necessityLevel: match?.necessityLevel ?? "",
    utilityText: match?.utilityText ?? "",
    recommendedDecision: match?.recommendedDecision ?? "",
    comment: match?.comment ?? "",
    validatedByUser: match?.validatedByUser ?? false,
    status: match?.status ?? "draft"
  };
}

function createGapForm(gap?: TenderSoftwareGapRecord | null): GapMutationInput {
  return {
    id: gap?.id,
    requirementId: gap?.requirementId ?? null,
    missingNeed: gap?.missingNeed ?? "",
    softwareTypeNeeded: gap?.softwareTypeNeeded ?? "",
    whyNeeded: gap?.whyNeeded ?? "",
    urgencyLevel: gap?.urgencyLevel ?? "",
    exampleSoftwareOrCategory: gap?.exampleSoftwareOrCategory ?? "",
    recommendedAction: gap?.recommendedAction ?? "",
    status: gap?.status ?? "draft"
  };
}

function createConfirmationForm(confirmation?: AnalysisConfirmationRecord | null) {
  return {
    id: confirmation?.id,
    topic: confirmation?.topic ?? "",
    questionText: confirmation?.questionText ?? "",
    status: confirmation?.status ?? "open",
    resolutionNote: confirmation?.resolutionNote ?? ""
  } as const;
}

function createSourceForm(source?: AnalysisSourceRecord | null): SourceMutationInput {
  return {
    id: source?.id,
    sourceLabel: source?.sourceLabel ?? "",
    fileName: source?.fileName ?? "",
    sheetName: source?.sheetName ?? "",
    sourceExcerpt: source?.sourceExcerpt ?? "",
    comment: source?.comment ?? ""
  };
}

export function SoftwareAnalysisWorkspace({
  code,
  title,
  detail,
  catalogue,
  showDevelopmentImportOptions
}: {
  code: string;
  title: string;
  detail: SoftwareAnalysisDetail;
  catalogue: SoftwareRecord[];
  showDevelopmentImportOptions: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [importSource, setImportSource] = useState<"uploaded_file" | "local_example">(
    "uploaded_file"
  );
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<SoftwareAnalysisImportPreview | null>(null);
  const [importSummary, setImportSummary] = useState<SoftwareAnalysisImportSummary | null>(null);
  const [isPreviewingImport, setIsPreviewingImport] = useState(false);
  const [isConfirmingImport, setIsConfirmingImport] = useState(false);

  const [requirementForm, setRequirementForm] = useState(createRequirementForm());
  const [showRequirementForm, setShowRequirementForm] = useState(false);

  const [matchForm, setMatchForm] = useState(createMatchForm());
  const [showMatchForm, setShowMatchForm] = useState(false);

  const [gapForm, setGapForm] = useState(createGapForm());
  const [showGapForm, setShowGapForm] = useState(false);

  const [confirmationForm, setConfirmationForm] = useState(createConfirmationForm());
  const [showConfirmationForm, setShowConfirmationForm] = useState(false);

  const [sourceForm, setSourceForm] = useState(createSourceForm());
  const [showSourceForm, setShowSourceForm] = useState(false);

  const requirementOptions = useMemo(
    () =>
      detail.requirements.map((requirement) => ({
        id: requirement.id,
        label: requirement.requirementText
      })),
    [detail.requirements]
  );

  async function postMutation(payload: unknown, successMessage: string) {
    setError(null);
    setFeedback(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/analyse/logiciels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "La mise a jour a echoue.");
      }

      setFeedback(successMessage);
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "La mise a jour a echoue.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRequirementSubmit() {
    await postMutation(
      {
        action: "save_requirement",
        input: requirementForm
      },
      requirementForm.id ? "Besoin logiciel mis a jour." : "Besoin logiciel ajoute."
    );
    setRequirementForm(createRequirementForm());
    setShowRequirementForm(false);
  }

  async function handleMatchSubmit() {
    const selectedSoftware = catalogue.find((software) => software.id === matchForm.logicielId) ?? null;
    const suggestedMatch =
      selectedSoftware == null
        ? findSoftwareMatchCandidate(matchForm.softwareNameRaw, catalogue)
        : null;

    await postMutation(
      {
        action: "save_match",
        input: {
          ...matchForm,
          logicielId: selectedSoftware?.id ?? suggestedMatch?.software?.id ?? null,
          matchType: selectedSoftware
            ? "manual"
            : suggestedMatch?.matchType ?? matchForm.matchType,
          coverageStatus:
            selectedSoftware || suggestedMatch?.matchType !== "possible"
              ? matchForm.coverageStatus
              : "to_confirm",
          validatedByUser:
            selectedSoftware != null || suggestedMatch?.matchType === "exact" || suggestedMatch?.matchType === "alias"
        }
      },
      matchForm.id ? "Correspondance mise a jour." : "Correspondance ajoutee."
    );
    setMatchForm(createMatchForm());
    setShowMatchForm(false);
  }

  async function handleGapSubmit() {
    await postMutation(
      {
        action: "save_gap",
        input: gapForm
      },
      gapForm.id ? "Logiciel manquant mis a jour." : "Logiciel manquant ajoute."
    );
    setGapForm(createGapForm());
    setShowGapForm(false);
  }

  async function handleConfirmationSubmit() {
    await postMutation(
      {
        action: "save_confirmation",
        input: confirmationForm
      },
      confirmationForm.id ? "Point a confirmer mis a jour." : "Point a confirmer ajoute."
    );
    setConfirmationForm(createConfirmationForm());
    setShowConfirmationForm(false);
  }

  async function handleSourceSubmit() {
    await postMutation(
      {
        action: "save_source",
        input: sourceForm
      },
      sourceForm.id ? "Source mise a jour." : "Source ajoutee."
    );
    setSourceForm(createSourceForm());
    setShowSourceForm(false);
  }

  async function handleReviewTransition(transition: "submit" | "validate" | "reopen") {
    await postMutation(
      {
        action: "transition_review",
        transition
      },
      transition === "submit"
        ? "Analyse soumise pour validation."
        : transition === "validate"
          ? "Analyse validee."
          : "Analyse rouverte en brouillon."
    );
  }

  function buildImportPayload() {
    const formData = new FormData();
    formData.append("source", importSource);
    if (importSource === "uploaded_file" && importFile) {
      formData.append("file", importFile);
    }
    return formData;
  }

  async function handleImportPreview() {
    if (importSource === "uploaded_file" && !importFile) {
      setError("Selectionnez un fichier Excel .xlsx.");
      return;
    }

    setError(null);
    setImportSummary(null);
    setIsPreviewingImport(true);

    try {
      const response = await fetch(
        `/api/appels-offres/${encodeURIComponent(code)}/analyse/logiciels/import/preview`,
        {
          method: "POST",
          body: buildImportPayload()
        }
      );
      const body = (await response.json()) as { error?: string; preview?: SoftwareAnalysisImportPreview };
      if (!response.ok || !body.preview) {
        throw new Error(body.error ?? "La previsualisation a echoue.");
      }
      setImportPreview(body.preview);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "La previsualisation a echoue."
      );
    } finally {
      setIsPreviewingImport(false);
    }
  }

  async function handleImportConfirm() {
    if (!importPreview) {
      return;
    }

    setError(null);
    setIsConfirmingImport(true);

    try {
      const response = await fetch(
        `/api/appels-offres/${encodeURIComponent(code)}/analyse/logiciels/import/confirm`,
        {
          method: "POST",
          body: buildImportPayload()
        }
      );
      const body = (await response.json()) as { error?: string; summary?: SoftwareAnalysisImportSummary };
      if (!response.ok || !body.summary) {
        throw new Error(body.error ?? "L'import a echoue.");
      }
      setImportSummary(body.summary);
      setFeedback("Analyse Excel importee pour cet appel d'offres.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "L'import a echoue.");
    } finally {
      setIsConfirmingImport(false);
    }
  }

  return (
    <div className="stack">
      <section className="section-card">
        <div className="section-body stack">
          <div className="analysis-topbar">
            <Link href={`/appels-offres/${encodeURIComponent(code)}`} className="button button-ghost button-small">
              Retour au dossier
            </Link>
            <div className="analysis-status-line">
              <StatusBadge
                label={getSoftwareAnalysisStatusLabel(detail.review.status)}
                tone={getSoftwareAnalysisStatusTone(detail.review.status)}
              />
              <span className="meta">
                Derniere mise a jour: {formatDateTime(detail.review.updatedAt)}
              </span>
            </div>
          </div>

          <div className="analysis-header-grid">
            <div>
              <span className="page-eyebrow">Appel d&apos;offres {code}</span>
              <h1 className="analysis-page-title">Analyse des logiciels</h1>
              <p className="analysis-page-description">
                Comparez les besoins logiciels du cahier des charges avec le catalogue interne de l&apos;entreprise.
              </p>
              <p className="meta">{title}</p>
            </div>

            <div className="analysis-page-actions">
              {detail.review.status === "draft" ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleReviewTransition("submit")}
                  disabled={isSaving}
                >
                  Soumettre pour validation
                </button>
              ) : null}
              {detail.review.status === "submitted" ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleReviewTransition("validate")}
                  disabled={isSaving}
                >
                  Valider l&apos;analyse
                </button>
              ) : null}
              {detail.review.status !== "draft" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void handleReviewTransition("reopen")}
                  disabled={isSaving}
                >
                  Rouvrir
                </button>
              ) : null}
              {showDevelopmentImportOptions ? (
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setShowImportPanel((current) => !current)}
                >
                  Importer une analyse Excel
                </button>
              ) : null}
            </div>
          </div>

          <div className="analysis-subnav">
            <Link
              href={`/appels-offres/${encodeURIComponent(code)}/analyse/logiciels`}
              className="analysis-subnav-link active"
            >
              <LibraryIcon className="nav-icon" />
              Logiciels
            </Link>
            <span className="analysis-subnav-link disabled" aria-disabled="true">
              <FileTextIcon className="nav-icon" />
              Competences
              <small>Bientot</small>
            </span>
            <span className="analysis-subnav-link disabled" aria-disabled="true">
              <DatabaseIcon className="nav-icon" />
              Risques
              <small>Bientot</small>
            </span>
            <span className="analysis-subnav-link disabled" aria-disabled="true">
              <ClockIcon className="nav-icon" />
              Sources
              <small>Bientot</small>
            </span>
          </div>

          <div className="analysis-summary-grid">
            <article className="summary-card analysis-summary-card">
              <span>Besoins identifies</span>
              <strong>{detail.summary.requirementsCount}</strong>
            </article>
            <article className="summary-card analysis-summary-card">
              <span>Couverts</span>
              <strong>{detail.summary.coveredCount}</strong>
            </article>
            <article className="summary-card analysis-summary-card">
              <span>Partiellement couverts</span>
              <strong>{detail.summary.partiallyCoveredCount}</strong>
            </article>
            <article className="summary-card analysis-summary-card">
              <span>Non couverts</span>
              <strong>{detail.summary.notCoveredCount}</strong>
            </article>
            <article className="summary-card analysis-summary-card">
              <span>A confirmer</span>
              <strong>{detail.summary.toConfirmCount}</strong>
            </article>
          </div>

          {feedback ? <div className="callout info">{feedback}</div> : null}
          {error ? <div className="callout warning">{error}</div> : null}
        </div>
      </section>

      {showDevelopmentImportOptions && showImportPanel ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Importer une analyse Excel</h3>
              <p className="meta">
                Chargez un fichier d&apos;analyse logiciels pour previsualiser les lignes avant import.
              </p>
            </div>
          </div>
          <div className="section-body stack">
            <div className="software-import-source-toggle">
              <button
                type="button"
                className={
                  importSource === "uploaded_file"
                    ? "button button-secondary button-small"
                    : "button button-ghost button-small"
                }
                onClick={() => setImportSource("uploaded_file")}
              >
                Fichier .xlsx
              </button>
              <button
                type="button"
                className={
                  importSource === "local_example"
                    ? "button button-secondary button-small"
                    : "button button-ghost button-small"
                }
                onClick={() => setImportSource("local_example")}
              >
                Exemple local
              </button>
            </div>

            {importSource === "uploaded_file" ? (
              <label className="upload-dropzone software-import-upload">
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                />
                <div className="upload-dropzone-icon">
                  <UploadIcon className="upload-icon" />
                </div>
                <div className="upload-dropzone-copy">
                  <strong>Charger une analyse logiciels</strong>
                  <p>Format accepte: `.xlsx`.</p>
                  <span>{importFile ? importFile.name : "Selectionner un fichier depuis votre ordinateur"}</span>
                </div>
              </label>
            ) : (
              <div className="software-import-local-card">
                <FileTextIcon className="upload-icon" />
                <div>
                  <strong>Exemple local de developpement selectionne</strong>
                  <p>Le chemin prive reste masque et n&apos;est jamais expose a l&apos;interface.</p>
                </div>
              </div>
            )}

            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void handleImportPreview()}
                disabled={isPreviewingImport || isConfirmingImport}
              >
                {isPreviewingImport ? "Previsualisation..." : "Previsualiser"}
              </button>
              {importPreview ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void handleImportConfirm()}
                  disabled={isConfirmingImport || isPreviewingImport}
                >
                  {isConfirmingImport ? "Import en cours..." : "Confirmer l'import"}
                </button>
              ) : null}
            </div>

            {importPreview ? (
              <div className="stack">
                <div className="software-preview-grid">
                  <div className="software-preview-stat">
                    <span>Besoins</span>
                    <strong>{importPreview.sections.requirements.detected}</strong>
                  </div>
                  <div className="software-preview-stat">
                    <span>Correspondances</span>
                    <strong>{importPreview.sections.matches.detected}</strong>
                  </div>
                  <div className="software-preview-stat">
                    <span>Manquants</span>
                    <strong>{importPreview.sections.gaps.detected}</strong>
                  </div>
                  <div className="software-preview-stat">
                    <span>A confirmer</span>
                    <strong>{importPreview.sections.confirmations.detected}</strong>
                  </div>
                  <div className="software-preview-stat">
                    <span>Sources</span>
                    <strong>{importPreview.sections.sources.detected}</strong>
                  </div>
                </div>

                {importPreview.warnings.length ? (
                  <div className="callout warning">
                    {importPreview.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {importSummary ? (
              <div className="callout info">
                <div>
                  {importSummary.createdRecords} creation(s), {importSummary.updatedRecords} mise(s) a jour,
                  {` ${importSummary.unchangedRecords}`} ligne(s) conservee(s), {importSummary.skippedRecords} ignoree(s).
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Besoins</h3>
            <p className="meta">
              Besoins logiciels detectes ou saisis manuellement pour cet appel d&apos;offres.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setRequirementForm(createRequirementForm());
              setShowRequirementForm((current) => !current);
            }}
          >
            Ajouter
          </button>
        </div>
        <div className="section-body stack">
          {showRequirementForm ? (
            <div className="analysis-form-grid">
              <label className="toolbar-field field-span-2">
                <span>Besoin</span>
                <input
                  className="input"
                  value={requirementForm.requirementText}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      requirementText: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Explicite / implicite</span>
                <select
                  className="select"
                  value={requirementForm.explicitness}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      explicitness: event.target.value as RequirementMutationInput["explicitness"]
                    }))
                  }
                >
                  <option value="explicit">Explicite</option>
                  <option value="implicit">Implicite</option>
                </select>
              </label>
              <label className="toolbar-field">
                <span>Niveau de necessite</span>
                <input
                  className="input"
                  value={requirementForm.necessityLevel}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      necessityLevel: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Logiciel(s) concerne(s)</span>
                <input
                  className="input"
                  value={requirementForm.softwareNamesRaw}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      softwareNamesRaw: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Justification</span>
                <textarea
                  className="textarea"
                  value={requirementForm.justification}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      justification: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Risque en cas d&apos;absence</span>
                <textarea
                  className="textarea"
                  value={requirementForm.riskIfMissing}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      riskIfMissing: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Alternative possible</span>
                <textarea
                  className="textarea"
                  value={requirementForm.alternativePossible}
                  onChange={(event) =>
                    setRequirementForm((current) => ({
                      ...current,
                      alternativePossible: event.target.value
                    }))
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleRequirementSubmit()}
                  disabled={isSaving}
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setRequirementForm(createRequirementForm());
                    setShowRequirementForm(false);
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}

          {detail.requirements.length ? (
            <section className="data-card table-shell">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Besoin</th>
                      <th>Nature</th>
                      <th>Necessite</th>
                      <th>Logiciels concernes</th>
                      <th>Statut</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.requirements.map((requirement) => (
                      <tr key={requirement.id}>
                        <td>
                          <div className="table-primary-cell">
                            <strong>{requirement.requirementText}</strong>
                            {requirement.justification ? <small>{requirement.justification}</small> : null}
                          </div>
                        </td>
                        <td>{getExplicitnessLabel(requirement.explicitness)}</td>
                        <td>{requirement.necessityLevel}</td>
                        <td>{requirement.softwareNamesRaw || "A preciser"}</td>
                        <td>
                          <StatusBadge
                            label={getRowStatusLabel(requirement.status)}
                            tone={getRowStatusTone(requirement.status)}
                          />
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="button button-ghost button-small"
                              onClick={() => {
                                setRequirementForm(createRequirementForm(requirement));
                                setShowRequirementForm(true);
                              }}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              onClick={() =>
                                void postMutation(
                                  {
                                    action: "save_requirement",
                                    input: {
                                      ...createRequirementForm(requirement),
                                      status: "validated"
                                    }
                                  },
                                  "Besoin valide."
                                )
                              }
                            >
                              Valider
                            </button>
                            <button
                              type="button"
                              className="button button-danger-ghost button-small"
                              onClick={() =>
                                void postMutation(
                                  {
                                    action: "save_requirement",
                                    input: {
                                      ...createRequirementForm(requirement),
                                      status: "rejected"
                                    }
                                  },
                                  "Besoin rejete."
                                )
                              }
                            >
                              Rejeter
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState
              compact
              title="Aucun besoin logiciel"
              description="Ajoutez un premier besoin manuellement ou importez une analyse Excel de test."
            />
          )}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Correspondances</h3>
            <p className="meta">
              Rattachez les besoins logiciels au catalogue interne et confirmez les rapprochements proposes.
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setMatchForm(createMatchForm());
              setShowMatchForm((current) => !current);
            }}
          >
            Ajouter
          </button>
        </div>
        <div className="section-body stack">
          {showMatchForm ? (
            <div className="analysis-form-grid">
              <label className="toolbar-field">
                <span>Besoin rattache</span>
                <select
                  className="select"
                  value={matchForm.requirementId ?? ""}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      requirementId: event.target.value ? Number(event.target.value) : null
                    }))
                  }
                >
                  <option value="">Aucun</option>
                  {requirementOptions.map((requirement) => (
                    <option key={requirement.id} value={requirement.id}>
                      {requirement.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toolbar-field">
                <span>Logiciel brut</span>
                <input
                  className="input"
                  value={matchForm.softwareNameRaw}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      softwareNameRaw: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Catalogue interne</span>
                <select
                  className="select"
                  value={matchForm.logicielId ?? ""}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      logicielId: event.target.value ? Number(event.target.value) : null
                    }))
                  }
                >
                  <option value="">Suggestion automatique</option>
                  {catalogue.map((software) => (
                    <option key={software.id} value={software.id}>
                      {software.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toolbar-field">
                <span>Statut de couverture</span>
                <select
                  className="select"
                  value={matchForm.coverageStatus}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      coverageStatus: event.target.value as MatchMutationInput["coverageStatus"]
                    }))
                  }
                >
                  <option value="covered">Disponible</option>
                  <option value="partially_covered">Partiellement disponible</option>
                  <option value="not_covered">Manquant</option>
                  <option value="to_confirm">A confirmer</option>
                </select>
              </label>
              <label className="toolbar-field">
                <span>Niveau de necessite</span>
                <input
                  className="input"
                  value={matchForm.necessityLevel}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      necessityLevel: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Utilite</span>
                <textarea
                  className="textarea"
                  value={matchForm.utilityText}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      utilityText: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Decision recommandee</span>
                <textarea
                  className="textarea"
                  value={matchForm.recommendedDecision}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      recommendedDecision: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Commentaire</span>
                <textarea
                  className="textarea"
                  value={matchForm.comment}
                  onChange={(event) =>
                    setMatchForm((current) => ({
                      ...current,
                      comment: event.target.value
                    }))
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleMatchSubmit()}
                  disabled={isSaving}
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setMatchForm(createMatchForm());
                    setShowMatchForm(false);
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}

          {detail.matches.length ? (
            <section className="data-card table-shell">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Logiciel brut</th>
                      <th>Catalogue</th>
                      <th>Type</th>
                      <th>Couverture</th>
                      <th>Necessite</th>
                      <th>Validation</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.matches.map((match) => (
                      <tr key={match.id}>
                        <td>
                          <div className="table-primary-cell">
                            <strong>{match.softwareNameRaw}</strong>
                            {match.comment ? <small>{match.comment}</small> : null}
                          </div>
                        </td>
                        <td>
                          {match.matchedSoftware ? (
                            <div className="table-primary-cell">
                              <strong>{match.matchedSoftware.name}</strong>
                              {match.matchedSoftware.descriptionRaw ? (
                                <small>{match.matchedSoftware.descriptionRaw}</small>
                              ) : null}
                            </div>
                          ) : (
                            "Aucune correspondance"
                          )}
                        </td>
                        <td>{getMatchTypeLabel(match.matchType)}</td>
                        <td>
                          <StatusBadge
                            label={getCoverageStatusLabel(match.coverageStatus)}
                            tone={getCoverageStatusTone(match.coverageStatus)}
                          />
                        </td>
                        <td>{match.necessityLevel}</td>
                        <td>
                          <StatusBadge
                            label={getRowStatusLabel(match.status)}
                            tone={getRowStatusTone(match.status)}
                          />
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="button button-ghost button-small"
                              onClick={() => {
                                setMatchForm(createMatchForm(match));
                                setShowMatchForm(true);
                              }}
                            >
                              Modifier
                            </button>
                            {match.matchType === "possible" && !match.validatedByUser ? (
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                onClick={() =>
                                  void postMutation(
                                    {
                                      action: "save_match",
                                      input: {
                                        ...createMatchForm(match),
                                        matchType: match.logicielId ? "manual" : match.matchType,
                                        validatedByUser: true,
                                        status: "reviewed"
                                      }
                                    },
                                    "Correspondance confirmee."
                                  )
                                }
                              >
                                Confirmer
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="button button-danger-ghost button-small"
                              onClick={() =>
                                void postMutation(
                                  {
                                    action: "save_match",
                                    input: {
                                      ...createMatchForm(match),
                                      logicielId: null,
                                      matchType: "none",
                                      coverageStatus: "not_covered",
                                      validatedByUser: false,
                                      status: "reviewed"
                                    }
                                  },
                                  "Correspondance marquee comme manquante."
                                )
                              }
                            >
                              Marquer manquant
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState
              compact
              title="Aucune correspondance"
              description="Ajoutez une correspondance manuellement ou importez l'analyse Excel de test."
            />
          )}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Logiciels manquants</h3>
            <p className="meta">Besoins non couverts par le catalogue actuel de l&apos;entreprise.</p>
          </div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setGapForm(createGapForm());
              setShowGapForm((current) => !current);
            }}
          >
            Ajouter
          </button>
        </div>
        <div className="section-body stack">
          {showGapForm ? (
            <div className="analysis-form-grid">
              <label className="toolbar-field">
                <span>Besoin rattache</span>
                <select
                  className="select"
                  value={gapForm.requirementId ?? ""}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      requirementId: event.target.value ? Number(event.target.value) : null
                    }))
                  }
                >
                  <option value="">Aucun</option>
                  {requirementOptions.map((requirement) => (
                    <option key={requirement.id} value={requirement.id}>
                      {requirement.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toolbar-field">
                <span>Besoin non couvert</span>
                <input
                  className="input"
                  value={gapForm.missingNeed}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      missingNeed: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Type de logiciel necessaire</span>
                <input
                  className="input"
                  value={gapForm.softwareTypeNeeded}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      softwareTypeNeeded: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Niveau d&apos;urgence</span>
                <input
                  className="input"
                  value={gapForm.urgencyLevel}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      urgencyLevel: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Pourquoi ce besoin est necessaire</span>
                <textarea
                  className="textarea"
                  value={gapForm.whyNeeded}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      whyNeeded: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Exemple de logiciel ou categorie</span>
                <textarea
                  className="textarea"
                  value={gapForm.exampleSoftwareOrCategory}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      exampleSoftwareOrCategory: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Action recommandee</span>
                <textarea
                  className="textarea"
                  value={gapForm.recommendedAction}
                  onChange={(event) =>
                    setGapForm((current) => ({
                      ...current,
                      recommendedAction: event.target.value
                    }))
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleGapSubmit()}
                  disabled={isSaving}
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setGapForm(createGapForm());
                    setShowGapForm(false);
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}

          {detail.gaps.length ? (
            <section className="data-card table-shell">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Besoin non couvert</th>
                      <th>Type de logiciel</th>
                      <th>Urgence</th>
                      <th>Statut</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.gaps.map((gap) => (
                      <tr key={gap.id}>
                        <td>
                          <div className="table-primary-cell">
                            <strong>{gap.missingNeed}</strong>
                            {gap.whyNeeded ? <small>{gap.whyNeeded}</small> : null}
                          </div>
                        </td>
                        <td>{gap.softwareTypeNeeded || "A preciser"}</td>
                        <td>{gap.urgencyLevel}</td>
                        <td>
                          <StatusBadge
                            label={getRowStatusLabel(gap.status)}
                            tone={getRowStatusTone(gap.status)}
                          />
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="button button-ghost button-small"
                              onClick={() => {
                                setGapForm(createGapForm(gap));
                                setShowGapForm(true);
                              }}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              onClick={() =>
                                void postMutation(
                                  {
                                    action: "save_gap",
                                    input: {
                                      ...createGapForm(gap),
                                      status: "validated"
                                    }
                                  },
                                  "Logiciel manquant valide."
                                )
                              }
                            >
                              Valider
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState
              compact
              title="Aucun manque identifie"
              description="Les besoins non couverts apparaitront ici apres la revue."
            />
          )}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Points a confirmer</h3>
            <p className="meta">Questions a clarifier avant validation finale de l&apos;analyse.</p>
          </div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setConfirmationForm(createConfirmationForm());
              setShowConfirmationForm((current) => !current);
            }}
          >
            Ajouter
          </button>
        </div>
        <div className="section-body stack">
          {showConfirmationForm ? (
            <div className="analysis-form-grid">
              <label className="toolbar-field">
                <span>Sujet</span>
                <input
                  className="input"
                  value={confirmationForm.topic}
                  onChange={(event) =>
                    setConfirmationForm((current) => ({
                      ...current,
                      topic: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Statut</span>
                <select
                  className="select"
                  value={confirmationForm.status}
                  onChange={(event) =>
                    setConfirmationForm((current) => ({
                      ...current,
                      status: event.target.value as typeof confirmationForm.status
                    }))
                  }
                >
                  <option value="open">Ouvert</option>
                  <option value="resolved">Resolu</option>
                  <option value="not_applicable">Non applicable</option>
                </select>
              </label>
              <label className="toolbar-field field-span-2">
                <span>Question</span>
                <textarea
                  className="textarea"
                  value={confirmationForm.questionText}
                  onChange={(event) =>
                    setConfirmationForm((current) => ({
                      ...current,
                      questionText: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Note de resolution</span>
                <textarea
                  className="textarea"
                  value={confirmationForm.resolutionNote}
                  onChange={(event) =>
                    setConfirmationForm((current) => ({
                      ...current,
                      resolutionNote: event.target.value
                    }))
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleConfirmationSubmit()}
                  disabled={isSaving}
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setConfirmationForm(createConfirmationForm());
                    setShowConfirmationForm(false);
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}

          {detail.confirmations.length ? (
            <section className="data-card table-shell">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Sujet</th>
                      <th>Question</th>
                      <th>Statut</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.confirmations.map((confirmation) => (
                      <tr key={confirmation.id}>
                        <td>{confirmation.topic}</td>
                        <td>{confirmation.questionText}</td>
                        <td>
                          <StatusBadge
                            label={
                              confirmation.status === "open"
                                ? "Ouvert"
                                : confirmation.status === "resolved"
                                  ? "Resolu"
                                  : "Non applicable"
                            }
                            tone={
                              confirmation.status === "open"
                                ? "warning"
                                : confirmation.status === "resolved"
                                  ? "success"
                                  : "neutral"
                            }
                          />
                        </td>
                        <td>
                          <div className="table-actions">
                            <button
                              type="button"
                              className="button button-ghost button-small"
                              onClick={() => {
                                setConfirmationForm(createConfirmationForm(confirmation));
                                setShowConfirmationForm(true);
                              }}
                            >
                              Modifier
                            </button>
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              onClick={() =>
                                void postMutation(
                                  {
                                    action: "save_confirmation",
                                    input: {
                                      ...createConfirmationForm(confirmation),
                                      status: "resolved"
                                    }
                                  },
                                  "Point a confirmer resolu."
                                )
                              }
                            >
                              Resolu
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState
              compact
              title="Aucun point a confirmer"
              description="Les questions de validation metier apparaitront ici."
            />
          )}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Sources</h3>
            <p className="meta">Sources et preuves utiles pour justifier l&apos;analyse logicielle.</p>
          </div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setSourceForm(createSourceForm());
              setShowSourceForm((current) => !current);
            }}
          >
            Ajouter
          </button>
        </div>
        <div className="section-body stack">
          {showSourceForm ? (
            <div className="analysis-form-grid">
              <label className="toolbar-field">
                <span>Libelle</span>
                <input
                  className="input"
                  value={sourceForm.sourceLabel}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      sourceLabel: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Fichier</span>
                <input
                  className="input"
                  value={sourceForm.fileName}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      fileName: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field">
                <span>Feuille</span>
                <input
                  className="input"
                  value={sourceForm.sheetName}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      sheetName: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Extrait</span>
                <textarea
                  className="textarea"
                  value={sourceForm.sourceExcerpt}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      sourceExcerpt: event.target.value
                    }))
                  }
                />
              </label>
              <label className="toolbar-field field-span-2">
                <span>Commentaire</span>
                <textarea
                  className="textarea"
                  value={sourceForm.comment}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      comment: event.target.value
                    }))
                  }
                />
              </label>
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleSourceSubmit()}
                  disabled={isSaving}
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => {
                    setSourceForm(createSourceForm());
                    setShowSourceForm(false);
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}

          {detail.sources.length ? (
            <section className="data-card table-shell">
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Fichier</th>
                      <th>Feuille</th>
                      <th>Commentaire</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sources.map((source) => (
                      <tr key={source.id}>
                        <td>{source.sourceLabel}</td>
                        <td>{source.fileName || "Non renseigne"}</td>
                        <td>{source.sheetName || "Non renseignee"}</td>
                        <td>{source.comment || source.sourceExcerpt || "Sans commentaire"}</td>
                        <td>
                          <button
                            type="button"
                            className="button button-ghost button-small"
                            onClick={() => {
                              setSourceForm(createSourceForm(source));
                              setShowSourceForm(true);
                            }}
                          >
                            Modifier
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <EmptyState
              compact
              title="Aucune source"
              description="Ajoutez les passages, fichiers ou feuilles utiles a la validation."
            />
          )}
        </div>
      </section>
    </div>
  );
}
