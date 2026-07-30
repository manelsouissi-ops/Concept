"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  buildPreImportSummary,
  canConfirmImport,
  getCandidatePresentation,
  getImportSteps
} from "@/lib/administration/logiciels/import-presentation.ts";
import type {
  SoftwareImportPreview,
  SoftwareImportSummary
} from "@/lib/administration/logiciels/types.ts";
import { FileTextIcon, UploadIcon } from "./app-icons.tsx";
import { StatusBadge } from "./status-badge.tsx";

type ImportSourceMode = "local_catalogue" | "uploaded_file";

export function SoftwareImportWorkflow({
  showDevelopmentOptions
}: {
  showDevelopmentOptions: boolean;
}) {
  const router = useRouter();
  const [sourceMode, setSourceMode] = useState<ImportSourceMode>("uploaded_file");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SoftwareImportPreview | null>(null);
  const [summary, setSummary] = useState<SoftwareImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const canPreview = sourceMode === "local_catalogue" || file instanceof File;
  const canConfirm = canConfirmImport(preview) && !isPreviewing && !isImporting;
  const steps = getImportSteps({ preview, summary });
  const visibleCandidates = useMemo(
    () => preview?.candidates.slice(0, 50) ?? [],
    [preview]
  );

  function resetStateForNewSource(nextMode: ImportSourceMode) {
    setSourceMode(nextMode);
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  function buildPayload() {
    const payload = new FormData();
    payload.append("source", sourceMode);
    if (sourceMode === "uploaded_file" && file) {
      payload.append("file", file);
    }
    return payload;
  }

  async function handlePreview() {
    if (!canPreview || isPreviewing) {
      return;
    }

    setError(null);
    setSummary(null);
    setIsPreviewing(true);

    try {
      const response = await fetch("/api/administration/logiciels/import/preview", {
        method: "POST",
        body: buildPayload()
      });
      const body = (await response.json()) as {
        error?: string;
        preview?: SoftwareImportPreview;
      };

      if (!response.ok || !body.preview) {
        setError(body.error ?? "L'analyse du fichier a echoue.");
        return;
      }

      setPreview(body.preview);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "L'analyse du fichier a echoue."
      );
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleConfirmImport() {
    if (!canConfirm) {
      return;
    }

    setError(null);
    setIsImporting(true);

    try {
      const response = await fetch("/api/administration/logiciels/import/confirm", {
        method: "POST",
        body: buildPayload()
      });
      const body = (await response.json()) as {
        error?: string;
        summary?: SoftwareImportSummary;
      };

      if (!response.ok || !body.summary) {
        setError(body.error ?? "La mise a jour du catalogue a echoue.");
        return;
      }

      setSummary(body.summary);
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "La mise a jour du catalogue a echoue."
      );
    } finally {
      setIsImporting(false);
    }
  }

  function handleSelectedFile(nextFile: File | null) {
    setSourceMode("uploaded_file");
    setFile(nextFile);
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  function resetForAnotherImport() {
    setSourceMode("uploaded_file");
    setFile(null);
    setPreview(null);
    setSummary(null);
    setError(null);
  }

  return (
    <div className="stack">
      <section className="section-card">
        <div className="section-body stack">
          <div className="software-import-steps" aria-label="Etapes de mise a jour du catalogue">
            {steps.map((step) => (
              <div
                key={step.key}
                className={
                  step.active
                    ? "software-import-step active"
                    : step.completed
                      ? "software-import-step completed"
                      : "software-import-step"
                }
              >
                <span className="software-import-step-index" aria-hidden="true" />
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Selection du fichier</h3>
            <p className="meta">
              Chargez le catalogue Excel des logiciels de l'entreprise. La plateforme comparera le fichier avec les logiciels deja enregistres avant toute modification.
            </p>
          </div>
        </div>

        <div className="section-body stack">
          <div className="callout info">
            Cette operation est reservee a la mise a jour du catalogue interne. Elle n'est pas necessaire pour chaque appel d'offres.
          </div>

          <label className="upload-dropzone software-import-upload">
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => handleSelectedFile(event.target.files?.[0] ?? null)}
            />
            <div className="upload-dropzone-icon">
              <UploadIcon className="upload-icon" />
            </div>
            <div className="upload-dropzone-copy">
              <strong>Charger un catalogue Excel</strong>
              <p>Format accepte : `.xlsx`.</p>
              <span>
                {file ? file.name : "Selectionner un fichier Excel depuis votre ordinateur"}
              </span>
            </div>
          </label>

          {file ? (
            <div className="upload-selected-file compact">
              <div className="upload-selected-leading">
                <span className="upload-selected-icon" aria-hidden="true">
                  <FileTextIcon className="upload-icon" />
                </span>
                <div>
                  <strong>{file.name}</strong>
                  <span>Fichier pret pour verification</span>
                </div>
              </div>

              <div className="upload-selected-actions">
                <label className="button button-ghost button-small">
                  Selectionner un fichier Excel
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    onChange={(event) => handleSelectedFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={() => handleSelectedFile(null)}
                >
                  Retirer le fichier
                </button>
              </div>
            </div>
          ) : null}

          {showDevelopmentOptions ? (
            <details className="software-dev-options">
              <summary>Options de developpement</summary>
              <div className="software-dev-options-body">
                <p className="meta">
                  Cette option permet de tester l'import a partir du catalogue local de developpement.
                </p>
                <button
                  type="button"
                  className={
                    sourceMode === "local_catalogue"
                      ? "button button-secondary button-small"
                      : "button button-ghost button-small"
                  }
                  onClick={() => resetStateForNewSource("local_catalogue")}
                >
                  Utiliser le catalogue local
                </button>
              </div>
            </details>
          ) : null}

          {sourceMode === "local_catalogue" ? (
            <div className="software-import-local-card">
              <FileTextIcon className="upload-icon" />
              <div>
                <strong>Catalogue de developpement selectionne</strong>
                <p>La verification utilisera le catalogue local configure pour les tests.</p>
              </div>
            </div>
          ) : null}

          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => void handlePreview()}
              disabled={!canPreview || isPreviewing || isImporting}
            >
              {isPreviewing ? "Analyse en cours..." : "Analyser le fichier"}
            </button>
            <Link href="/administration/logiciels" className="button button-ghost">
              Retour aux logiciels
            </Link>
          </div>
        </div>
      </section>

      {error ? <div className="callout warning">{error}</div> : null}

      {preview ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Verification</h3>
              <p className="meta">
                {preview.sourceFileName} - feuille detectee : <span className="mono">{preview.worksheetName}</span>
              </p>
            </div>
          </div>

          <div className="section-body stack">
            <div className="software-preview-grid">
              <div className="software-preview-stat">
                <span>Lignes analysees</span>
                <strong>{preview.totalRowsInspected}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Logiciels detectes</span>
                <strong>{preview.validSoftwareCandidates}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Nouveaux logiciels</span>
                <strong>{preview.newRecords}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Deja enregistres</span>
                <strong>{preview.existingMatches}</strong>
              </div>
              <div className="software-preview-stat">
                <span>A verifier</span>
                <strong>{preview.possibleDuplicates}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Lignes ignorees</span>
                <strong>{preview.rowsSkipped}</strong>
              </div>
            </div>

            <div className="callout info">{buildPreImportSummary(preview)}</div>

            {preview.warnings.length ? (
              <div className="callout warning">
                {preview.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="table-scroll">
              <table className="data-table software-preview-table">
                <thead>
                  <tr>
                    <th>Ligne</th>
                    <th>Valeur du fichier</th>
                    <th>Logiciel propose</th>
                    <th>Utilisation</th>
                    <th>Resultat</th>
                    <th>Action prevue</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCandidates.map((candidate, index) => {
                    const presentation = getCandidatePresentation(candidate);
                    return (
                      <tr key={`${candidate.rowNumber}-${candidate.proposedName ?? "skipped"}-${index}`}>
                        <td>{candidate.rowNumber}</td>
                        <td>{candidate.originalCellValue || "Ligne vide"}</td>
                        <td>
                          <div className="table-primary-cell">
                            <strong>{candidate.proposedName ?? "Aucun logiciel retenu"}</strong>
                            {presentation.explanation ? <span>{presentation.explanation}</span> : null}
                            {candidate.existingSoftwareName ? (
                              <span>Correspondance conservee : {candidate.existingSoftwareName}</span>
                            ) : null}
                            {candidate.messages.map((message) => (
                              <span key={message}>
                                {message.includes("Valeur decoupee")
                                  ? "Cette cellule contient plusieurs logiciels et sera separee en plusieurs entrees."
                                  : message}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td title={candidate.rawUsage}>{candidate.rawUsage || "Non renseignee"}</td>
                        <td>
                          <StatusBadge
                            label={presentation.resultLabel}
                            tone={presentation.resultTone}
                          />
                        </td>
                        <td>{presentation.actionLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {preview.candidates.length > visibleCandidates.length ? (
              <p className="meta">
                Seuls les 50 premiers candidats sont affiches ici. La confirmation prend en compte l'ensemble du fichier.
              </p>
            ) : null}

            <div className="actions">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void handleConfirmImport()}
                disabled={!canConfirm}
              >
                {isImporting ? "Mise a jour en cours..." : "Confirmer la mise a jour"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {summary ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Catalogue mis a jour</h3>
              <p className="meta">
                La mise a jour du catalogue est terminee. Vous pouvez consulter la liste ou preparer un autre fichier.
              </p>
            </div>
          </div>

          <div className="section-body stack">
            <div className="software-preview-grid">
              <div className="software-preview-stat">
                <span>Logiciels crees</span>
                <strong>{summary.createdRecords}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Deja presents</span>
                <strong>{summary.existingMatches}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Alias ajoutes</span>
                <strong>{summary.addedAliases}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Lignes ignorees</span>
                <strong>{summary.skippedRows}</strong>
              </div>
              <div className="software-preview-stat">
                <span>Avertissements</span>
                <strong>{summary.warnings.length}</strong>
              </div>
            </div>

            {summary.warnings.length ? (
              <div className="callout warning">
                {summary.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}

            <div className="actions">
              <Link href="/administration/logiciels" className="button button-primary">
                Voir le catalogue
              </Link>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => resetForAnotherImport()}
              >
                Importer un autre fichier
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
