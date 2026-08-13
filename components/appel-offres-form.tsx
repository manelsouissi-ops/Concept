"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import {
  formatCreateAppelOffresFileSize,
  getPdfFileSelectionError
} from "@/lib/appels-offres/create-form.ts";
import type { AppelOffresDetail, AppelOffresInput } from "@/lib/appels-offres/types.ts";
import { FileTextIcon, UploadIcon } from "./app-icons.tsx";

// Edit-only: tender creation now goes through AppelOffresCreateWizard
// (upload -> analyse -> review extracted fields -> confirm), which reuses
// the same PUT endpoint this component uses for edits.
type Props = {
  mode: "edit";
  initialValue?: AppelOffresInput;
  current?: AppelOffresDetail | null;
};

type SubmitPhase = "idle" | "creating";

function createInitialFormState(initialValue?: AppelOffresInput) {
  return {
    code: initialValue?.code ?? "",
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

function getSubmitLabel(submitPhase: SubmitPhase, isWorking: boolean) {
  if (!isWorking) {
    return "Enregistrer les modifications";
  }

  return "Enregistrement...";
}

export function AppelOffresForm({ initialValue, current }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(createInitialFormState(initialValue));
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase>("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isWorking = submitPhase !== "idle";

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

    if (!form.title.trim()) {
      setError("L'intitule de l'appel d'offres est obligatoire.");
      return;
    }

    const targetCode = (current?.code ?? "").trim();
    if (!targetCode) {
      setError("Le code interne est obligatoire.");
      return;
    }

    const payload = new FormData();
    payload.append("code", targetCode);
    payload.append("title", form.title.trim());
    payload.append("reference", form.reference.trim());
    payload.append("buyer", form.buyer.trim());
    payload.append("country", form.country.trim());
    payload.append("dueDate", form.dueDate.trim());
    payload.append("notes", form.notes.trim());
    payload.append("priorite", form.priorite);
    payload.append("responsable_commercial", form.responsableCommercial.trim());

    if (file) {
      payload.append("file", file);
    }

    setSubmitPhase("creating");

    try {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(targetCode)}`, {
        method: "PUT",
        body: payload
      });

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Enregistrement impossible.");
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
    <div className="upload-selected-file compact">
      <div className="upload-selected-leading">
        <span className="upload-selected-icon" aria-hidden="true">
          <FileTextIcon className="upload-icon" />
        </span>
        <div>
          <strong>{file.name}</strong>
          <span>{formatCreateAppelOffresFileSize(file.size)}</span>
        </div>
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
              {getSubmitLabel(submitPhase, isWorking)}
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
