"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";
import type { AppelOffresDetail, AppelOffresInput } from "@/lib/appels-offres/types.ts";
import { EmptyState } from "./empty-state.tsx";
import { UploadIcon } from "./app-icons.tsx";

type Props = {
  mode: "create" | "edit";
  initialValue?: AppelOffresInput;
  current?: AppelOffresDetail | null;
};

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

function formatFileSize(sizeBytes: number) {
  return new Intl.NumberFormat("fr-FR").format(sizeBytes);
}

export function AppelOffresForm({ mode, initialValue, current }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(createInitialFormState(initialValue));
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isEdit = mode === "edit";
  const completionItems = [
    form.code.trim(),
    form.title.trim(),
    form.buyer.trim(),
    form.country.trim(),
    form.dueDate.trim(),
    isEdit ? "done" : file?.name ?? ""
  ];
  const completionCount = completionItems.filter(Boolean).length;
  const completionRatio = Math.round((completionCount / completionItems.length) * 100);

  function applyFile(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      return;
    }

    if (nextFile.type && nextFile.type !== "application/pdf") {
      setError("Seuls les fichiers PDF sont acceptés pour le CDC.");
      return;
    }

    setError(null);
    setFile(nextFile);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.title.trim()) {
      setError("L'intitulé de l'appel d'offres est obligatoire.");
      return;
    }

    if (!isEdit && !form.code.trim()) {
      setError("Le code interne est obligatoire.");
      return;
    }

    if (!isEdit && !file) {
      setError("Le CDC PDF est obligatoire.");
      return;
    }

    const targetCode = (isEdit ? current?.code ?? "" : form.code).trim();
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

    startTransition(async () => {
      const response = await fetch(
        isEdit ? `/api/appels-offres/${encodeURIComponent(targetCode)}` : "/api/appels-offres",
        {
          method: isEdit ? "PUT" : "POST",
          body: payload
        }
      );

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Enregistrement impossible.");
        return;
      }

      if (!isEdit) {
        router.push(`/appels-offres/${encodeURIComponent(targetCode)}`);
        return;
      }

      setSuccess("Appel d'offres mis à jour.");
      router.refresh();
    });
  }

  async function handleArchive() {
    if (!current) {
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

    startTransition(async () => {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(current.code)}`, {
        method: "DELETE"
      });
      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "Archivage impossible.");
        return;
      }

      router.push("/appels-offres");
    });
  }

  const selectedFile = file ? (
    <div className="upload-selected-file">
      <div>
        <strong>{file.name}</strong>
        <span>{formatFileSize(file.size)} octets</span>
      </div>
      <button
        type="button"
        className="button button-ghost button-small"
        onClick={() => applyFile(null)}
        disabled={isPending}
      >
        Retirer
      </button>
    </div>
  ) : null;

  return (
    <form className={isEdit ? "grid" : "appel-form-layout"} onSubmit={handleSubmit}>
      <div className="stack">
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>{isEdit ? "Informations du dossier" : "Informations générales"}</h3>
              <p className="meta">
                {isEdit
                  ? "Modifiez les informations déjà supportées par la plateforme."
                  : "Créez un nouvel appel d'offres à partir des informations actuellement disponibles."}
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
                  disabled={isPending || isEdit}
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      code: event.target.value
                    }))
                  }
                />
                <span className="hint">
                  Le code pilote le dossier <span className="mono">data/{isEdit ? current?.code : form.code || "..."}</span>.
                </span>
              </div>

              <div className="field">
                <label htmlFor="appel-title">Intitulé de l'appel d'offres</label>
                <input
                  id="appel-title"
                  className="input"
                  value={form.title}
                  disabled={isPending}
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
                  disabled={isPending}
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
                  disabled={isPending}
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
                  disabled={isPending}
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
                  disabled={isPending}
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
                  disabled={isPending}
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
                <label htmlFor="appel-reference">Description courte ou référence</label>
                <input
                  id="appel-reference"
                  className="input"
                  value={form.reference}
                  placeholder="Référence interne, description courte ou contexte"
                  disabled={isPending}
                  onChange={(event) =>
                    setForm((currentForm) => ({
                      ...currentForm,
                      reference: event.target.value
                    }))
                  }
                />
                <span className="hint">
                  Ce champ réutilise le champ de référence existant pour rester compatible avec l'API actuelle.
                </span>
              </div>

              <div className="field field-span-full">
                <label htmlFor="appel-notes">Notes internes</label>
                <textarea
                  id="appel-notes"
                  className="textarea"
                  value={form.notes}
                  disabled={isPending}
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
                {isEdit
                  ? "Remplacez le CDC PDF si une nouvelle version du document doit être analysée."
                  : "Importez le CDC PDF. Le support des annexes sera ajouté plus tard sans casser ce flux."}
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
                disabled={isPending}
                onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
              />
              <div className="upload-dropzone-icon">
                <UploadIcon className="upload-icon" />
              </div>
              <div className="upload-dropzone-copy">
                <strong>{isEdit ? "Remplacer le CDC PDF" : "Importer le CDC PDF"}</strong>
                <p>
                  Glissez-déposez un fichier PDF ici ou
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                  >
                    parcourir vos fichiers
                  </button>
                  .
                </p>
                <span>Format accepté : PDF uniquement.</span>
              </div>
            </div>

            {selectedFile}

            <div className="placeholder-inline-card">
              <strong>Annexes</strong>
              <p>
                L'import d'annexes sera ajouté dans une prochaine étape. Le flux actuel enregistre uniquement le CDC PDF.
              </p>
            </div>
          </div>
        </section>

        {error ? <div className="callout warning">{error}</div> : null}
        {success ? <div className="callout info">{success}</div> : null}

        {isEdit ? (
          <div className="actions">
            <button className="button button-primary" type="submit" disabled={isPending}>
              {isPending ? "Enregistrement..." : "Enregistrer les modifications"}
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
                  disabled={isPending}
                >
                  Archiver
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div className="sticky-action-bar">
            <Link href="/appels-offres" className="button button-ghost">
              Annuler
            </Link>
            <button type="button" className="button button-secondary" disabled>
              Enregistrer comme brouillon · bientôt disponible
            </button>
            <button className="button button-primary" type="submit" disabled={isPending}>
              {isPending ? "Création..." : "Enregistrer et importer le CDC"}
            </button>
          </div>
        )}
      </div>

      {!isEdit ? (
        <aside className="form-summary-panel">
          <section className="section-card">
            <div className="section-header">
              <div>
                <h3>Résumé</h3>
                <p className="meta">
                  Suivez la complétion du formulaire avant la création du dossier.
                </p>
              </div>
            </div>
            <div className="section-body stack">
              <div className="progress-label-row">
                <strong>Complétion</strong>
                <span>{completionRatio} %</span>
              </div>
              <div className="progress-bar large">
                <span style={{ width: `${completionRatio}%` }} />
              </div>

              <div className="summary-list">
                <div className="summary-list-row">
                  <span>Code interne</span>
                  <strong>{form.code.trim() || "À renseigner"}</strong>
                </div>
                <div className="summary-list-row">
                  <span>Client</span>
                  <strong>{form.buyer.trim() || "À renseigner"}</strong>
                </div>
                <div className="summary-list-row">
                  <span>Date limite</span>
                  <strong>{form.dueDate.trim() || "À renseigner"}</strong>
                </div>
                <div className="summary-list-row">
                  <span>Priorite</span>
                  <strong>{form.priorite}</strong>
                </div>
                <div className="summary-list-row">
                  <span>Responsable</span>
                  <strong>{form.responsableCommercial.trim() || "A renseigner"}</strong>
                </div>
              </div>

              {selectedFile ?? (
                <EmptyState
                  compact
                  title="Aucun fichier sélectionné"
                  description="Ajoutez le CDC PDF pour finaliser la création du dossier."
                />
              )}

              <div className="callout info">
                Après l'enregistrement, le dossier sera créé, le CDC sera stocké dans le répertoire existant, puis vous pourrez lancer l'analyse depuis le workspace.
              </div>
            </div>
          </section>
        </aside>
      ) : null}
    </form>
  );
}
