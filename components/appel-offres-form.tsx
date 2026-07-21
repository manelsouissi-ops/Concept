"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import {
  suggestNewAppelOffresCode,
  validateCreateAppelOffresDraft,
  getPdfFileSelectionError
} from "@/lib/appels-offres/create-form.ts";
import type { AppelOffresDetail, AppelOffresInput } from "@/lib/appels-offres/types.ts";
import { AiBadge } from "./ai-badge.tsx";
import { EmptyState } from "./empty-state.tsx";
import { UploadIcon } from "./app-icons.tsx";

type Props = {
  mode: "create" | "edit";
  initialValue?: AppelOffresInput;
  current?: AppelOffresDetail | null;
};

type SubmitPhase = "idle" | "creating" | "launching";

function createInitialFormState(mode: Props["mode"], initialValue?: AppelOffresInput) {
  return {
    code:
      initialValue?.code ??
      (mode === "create" ? suggestNewAppelOffresCode() : ""),
    title: initialValue?.title ?? "",
    reference: initialValue?.reference ?? "",
    buyer: initialValue?.buyer ?? "",
    country: initialValue?.country ?? "",
    dueDate: initialValue?.dueDate ?? "",
    notes: initialValue?.notes ?? "",
    priorite: initialValue?.priorite ?? "normale",
    responsableCommercial: initialValue?.responsableCommercial ?? ""
  };
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo`;
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} Ko`;
  }

  return `${new Intl.NumberFormat("fr-FR").format(sizeBytes)} octets`;
}

function getSubmitLabel(mode: Props["mode"], submitPhase: SubmitPhase, isWorking: boolean) {
  if (!isWorking) {
    return mode === "edit"
      ? "Enregistrer les modifications"
      : "Generer la Fiche CDC";
  }

  if (submitPhase === "launching") {
    return "Lancement de l'analyse...";
  }

  return mode === "edit" ? "Enregistrement..." : "Creation du dossier...";
}

export function AppelOffresForm({ mode, initialValue, current }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(createInitialFormState(mode, initialValue));
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const launchPhaseTimerRef = useRef<number | null>(null);

  const isEdit = mode === "edit";
  const isWorking = submitPhase !== "idle";
  const createValidation = validateCreateAppelOffresDraft({
    code: form.code,
    file: file
      ? {
          name: file.name,
          type: file.type,
          size: file.size
        }
      : null
  });
  const selectedCodePreview = createValidation.normalizedCode || form.code.trim() || "...";

  function clearLaunchPhaseTimer() {
    if (launchPhaseTimerRef.current != null) {
      window.clearTimeout(launchPhaseTimerRef.current);
      launchPhaseTimerRef.current = null;
    }
  }

  function applyFile(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const fileError = getPdfFileSelectionError({
      name: nextFile.name,
      type: nextFile.type,
      size: nextFile.size
    });

    if (fileError) {
      setError(fileError);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setError(null);
    setFile(nextFile);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isWorking) {
      return;
    }

    setError(null);
    setSuccess(null);

    if (isEdit) {
      if (!form.title.trim()) {
        setError("L'intitule de l'appel d'offres est obligatoire.");
        return;
      }
    } else {
      if (!createValidation.isCodeValid) {
        setError("Le code interne est obligatoire.");
        return;
      }

      if (!file) {
        setError("Le CDC PDF est obligatoire.");
        return;
      }

      if (createValidation.fileError) {
        setError(createValidation.fileError);
        return;
      }
    }

    const targetCode = (isEdit ? current?.code ?? "" : createValidation.normalizedCode).trim();
    if (!targetCode) {
      setError("Le code interne est obligatoire.");
      return;
    }

    const payload = new FormData();
    payload.append("code", targetCode);

    if (isEdit) {
      payload.append("title", form.title.trim());
      payload.append("reference", form.reference.trim());
      payload.append("buyer", form.buyer.trim());
      payload.append("country", form.country.trim());
      payload.append("dueDate", form.dueDate.trim());
      payload.append("notes", form.notes.trim());
      payload.append("priorite", form.priorite);
      payload.append("responsable_commercial", form.responsableCommercial.trim());
    }

    if (file) {
      payload.append("file", file);
    }

    setSubmitPhase("creating");
    launchPhaseTimerRef.current = window.setTimeout(() => {
      setSubmitPhase((currentPhase) =>
        currentPhase === "creating" ? "launching" : currentPhase
      );
    }, 700);

    try {
      const response = await fetch(
        isEdit ? `/api/appels-offres/${encodeURIComponent(targetCode)}` : "/api/appels-offres",
        {
          method: isEdit ? "PUT" : "POST",
          body: payload
        }
      );

      const body = (await response.json()) as {
        error?: string;
        redirect_url?: string;
      };

      if (!response.ok) {
        setError(body.error ?? "Enregistrement impossible.");
        return;
      }

      if (!isEdit) {
        router.push(
          body.redirect_url ??
            `/appels-offres/${encodeURIComponent(targetCode)}?view=processing`
        );
        return;
      }

      setSuccess("Appel d'offres mis a jour.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Enregistrement impossible."
      );
    } finally {
      clearLaunchPhaseTimer();
      setSubmitPhase("idle");
    }
  }

  async function handleArchive() {
    if (!current || isWorking) {
      return;
    }

    const confirmed = window.confirm(
      "Archiver cet appel d'offres ? Les documents resteront disponibles sur disque."
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccess(null);
    setSubmitPhase("creating");

    try {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(current.code)}`, {
        method: "DELETE"
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Archivage impossible.");
        return;
      }

      router.push("/appels-offres");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Archivage impossible."
      );
    } finally {
      setSubmitPhase("idle");
    }
  }

  const selectedFile = file ? (
    <div className="upload-selected-file">
      <div>
        <strong>{file.name}</strong>
        <span>{formatFileSize(file.size)}</span>
      </div>
      <div className="upload-selected-actions">
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => fileInputRef.current?.click()}
          disabled={isWorking}
        >
          Remplacer
        </button>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => applyFile(null)}
          disabled={isWorking}
        >
          Retirer
        </button>
      </div>
    </div>
  ) : null;

  if (isEdit) {
    return (
      <form className="grid" onSubmit={handleSubmit}>
        <div className="stack">
          <section className="section-card">
            <div className="section-header">
              <div>
                <h3>Informations du dossier</h3>
                <p className="meta">
                  Modifiez les informations deja supportees par la plateforme.
                </p>
              </div>
            </div>

            <div className="section-body stack">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="appel-code">Code interne</label>
                  <input
                    id="appel-code"
                    className="input mono"
                    value={form.code}
                    placeholder="INT-2026-045"
                    disabled
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        code: event.target.value
                      }))
                    }
                  />
                  <span className="hint">
                    Le code pilote le dossier <span className="mono">data/{current?.code ?? "..."}</span>.
                  </span>
                </div>

                <div className="field">
                  <label htmlFor="appel-title">Intitule de l'appel d'offres</label>
                  <input
                    id="appel-title"
                    className="input"
                    value={form.title}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        title: event.target.value
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="appel-buyer">Client</label>
                  <input
                    id="appel-buyer"
                    className="input"
                    value={form.buyer}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        buyer: event.target.value
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="appel-country">Pays</label>
                  <input
                    id="appel-country"
                    className="input"
                    value={form.country}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        country: event.target.value
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="appel-due-date">Date limite de remise</label>
                  <input
                    id="appel-due-date"
                    type="date"
                    className="input"
                    value={form.dueDate}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        dueDate: event.target.value
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="appel-owner">Responsable commercial</label>
                  <input
                    id="appel-owner"
                    className="input"
                    value={form.responsableCommercial}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        responsableCommercial: event.target.value
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="appel-priority">Priorite</label>
                  <select
                    id="appel-priority"
                    className="select"
                    value={form.priorite}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        priorite: event.target.value as AppelOffresInput["priorite"]
                      }))
                    }
                  >
                    <option value="basse">Basse</option>
                    <option value="normale">Normale</option>
                    <option value="haute">Haute</option>
                    <option value="critique">Critique</option>
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="appel-reference">Description courte ou reference</label>
                  <input
                    id="appel-reference"
                    className="input"
                    value={form.reference}
                    placeholder="Reference interne, description courte ou contexte"
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        reference: event.target.value
                      }))
                    }
                  />
                  <span className="hint">
                    Ce champ reutilise le champ de reference existant pour rester compatible avec l'API actuelle.
                  </span>
                </div>

                <div className="field field-span-full">
                  <label htmlFor="appel-notes">Notes internes</label>
                  <textarea
                    id="appel-notes"
                    className="textarea"
                    value={form.notes}
                    disabled={isWorking}
                    onChange={(event) =>
                      setForm((currentForm) => ({
                        ...currentForm,
                        notes: event.target.value
                      }))
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <h3>Documents</h3>
                <p className="meta">
                  Remplacez le CDC PDF si une nouvelle version du document doit etre analysee.
                </p>
              </div>
            </div>

            <div className="section-body stack">
              <div
                className={dragActive ? "upload-dropzone active" : "upload-dropzone"}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  applyFile(event.dataTransfer.files?.[0] ?? null);
                }}
              >
                <input
                  ref={fileInputRef}
                  id="appel-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={isWorking}
                  onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
                />
                <div className="upload-dropzone-icon">
                  <UploadIcon className="upload-icon" />
                </div>
                <div className="upload-dropzone-copy">
                  <strong>Remplacer le CDC PDF</strong>
                  <p>
                    Glissez-deposez un fichier PDF ici ou
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isWorking}
                    >
                      parcourir vos fichiers
                    </button>
                    .
                  </p>
                  <span>Format accepte : PDF uniquement.</span>
                </div>
              </div>

              {selectedFile}

              <div className="placeholder-inline-card">
                <strong>Annexes</strong>
                <p>
                  L'import d'annexes sera ajoute dans une prochaine etape. Le flux actuel enregistre uniquement le CDC PDF.
                </p>
              </div>
            </div>
          </section>

          {error ? <div className="callout warning">{error}</div> : null}
          {success ? <div className="callout info">{success}</div> : null}

          <div className="actions">
            <button className="button button-primary" type="submit" disabled={isWorking}>
              {getSubmitLabel(mode, submitPhase, isWorking)}
            </button>
            {current ? (
              <>
                <Link
                  className="button button-secondary"
                  href={`/api/appels-offres/${encodeURIComponent(current.code)}/pdf`}
                  target="_blank"
                >
                  Voir le CDC
                </Link>
                <button
                  className="button button-ghost"
                  type="button"
                  onClick={() => void handleArchive()}
                  disabled={isWorking}
                >
                  Archiver
                </button>
              </>
            ) : null}
          </div>
        </div>
      </form>
    );
  }

  return (
    <form className="appel-form-layout minimal-create-layout" onSubmit={handleSubmit}>
      <div className="stack">
        <section className="section-card">
          <div className="section-header">
            <div>
              <AiBadge label="Analyse IA" />
              <h3>Import du CDC</h3>
              <p className="meta">
                Renseignez le minimum requis. Les informations metier seront extraites automatiquement depuis le document.
              </p>
            </div>
          </div>

          <div className="section-body stack">
            <div className="field">
              <label htmlFor="appel-code">Code interne</label>
              <input
                id="appel-code"
                className="input mono"
                value={form.code}
                placeholder="AO-20260715-1234"
                disabled={isWorking}
                onChange={(event) => {
                  setForm((currentForm) => ({
                    ...currentForm,
                    code: event.target.value
                  }));
                  setError(null);
                }}
              />
              <span className="hint">
                Ce code identifie le dossier et son espace de travail.
                {" "}
                <span className="mono">data/{selectedCodePreview}</span>
              </span>
            </div>

            <div className="field">
              <label htmlFor="appel-file">CDC PDF</label>
              <div
                className={dragActive ? "upload-dropzone active" : "upload-dropzone"}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  applyFile(event.dataTransfer.files?.[0] ?? null);
                }}
              >
                <input
                  ref={fileInputRef}
                  id="appel-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  disabled={isWorking}
                  onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
                />
                <div className="upload-dropzone-icon">
                  <UploadIcon className="upload-icon" />
                </div>
                <div className="upload-dropzone-copy">
                  <strong>Deposez le CDC ici</strong>
                  <p>
                    ou
                    {" "}
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isWorking}
                    >
                      cliquez pour selectionner un fichier PDF
                    </button>
                  </p>
                  <span>Format accepte : PDF uniquement.</span>
                </div>
              </div>
            </div>

            {selectedFile ?? (
              <EmptyState
                compact
                title="Aucun CDC selectionne"
                description="Ajoutez un PDF pour creer le dossier et lancer automatiquement l'analyse."
              />
            )}
          </div>
        </section>

        {error ? <div className="callout warning">{error}</div> : null}

        <div className="sticky-action-bar">
          <Link href="/appels-offres" className="button button-ghost">
            Annuler
          </Link>
          <button
            className="button button-ai"
            type="submit"
            disabled={!createValidation.canSubmit || isWorking}
          >
            {getSubmitLabel(mode, submitPhase, isWorking)}
          </button>
        </div>
      </div>

      <aside className="form-summary-panel">
        <section className="section-card">
          <div className="section-header">
            <div>
              <AiBadge label="Automatisation" />
              <h3>Ce qui va se passer</h3>
              <p className="meta">
                La plateforme prepare le dossier, lance l'analyse et vous redirige immediatement vers le workspace.
              </p>
            </div>
          </div>
          <div className="section-body stack">
            <ol className="workflow-preview-list">
              <li>Le dossier d'appel d'offres est cree.</li>
              <li>Le CDC est converti et analyse.</li>
              <li>Les informations principales sont extraites automatiquement.</li>
              <li>Une Fiche CDC est generee.</li>
              <li>Le Commercial verifie, corrige et valide les informations.</li>
            </ol>

            <div className="callout ai">
              L'analyse se lance en arriere-plan. Vous serez redirige vers le workspace des la creation du dossier.
            </div>
          </div>
        </section>
      </aside>
    </form>
  );
}
