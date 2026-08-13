"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileTextIcon, UploadIcon } from "./app-icons.tsx";
import { ProcessingTimeline } from "./processing-timeline.tsx";
import {
  formatCreateAppelOffresFileSize,
  getPdfFileSelectionError,
  suggestNewAppelOffresCode
} from "@/lib/appels-offres/create-form.ts";
import { buildProcessingTimeline, buildWorkspaceFailureSummary } from "@/lib/appels-offres/workspace.ts";
import type { AppelOffresDetail, AppelOffresInput } from "@/lib/appels-offres/types.ts";
import type { ExtractionIdentityPreview } from "@/lib/appels-offres/repository.ts";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes

type WizardStep = "upload" | "analyzing" | "review" | "creating";

const WIZARD_STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: "upload", label: "Ajouter le CDC" },
  { key: "analyzing", label: "Analyse" },
  { key: "review", label: "Vérification" },
  { key: "creating", label: "Création" }
];
const STEP_ORDER: WizardStep[] = ["upload", "analyzing", "review", "creating"];

type ReviewFormState = {
  title: string;
  buyer: string;
  country: string;
  dueDate: string;
  reference: string;
  priorite: AppelOffresInput["priorite"];
};

function emptyReviewForm(): ReviewFormState {
  return { title: "", buyer: "", country: "", dueDate: "", reference: "", priorite: "normale" };
}

function DetectionHint({ detected }: { detected: boolean }) {
  return (
    <span className={detected ? "create-wizard-detection is-detected" : "create-wizard-detection"}>
      {detected ? "✓ Détecté dans le CDC" : "Non détecté"}
    </span>
  );
}

export function AppelOffresCreateWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<WizardStep>("upload");
  const [code, setCode] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmittingUpload, setIsSubmittingUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [detail, setDetail] = useState<AppelOffresDetail | null>(null);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const [preview, setPreview] = useState<ExtractionIdentityPreview | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [form, setForm] = useState<ReviewFormState>(emptyReviewForm());
  const [isCreating, setIsCreating] = useState(false);
  const previewRequestedRef = useRef(false);
  const resumedRef = useRef(false);

  // Resume an in-progress wizard (e.g. after a reload) from the code already
  // created, instead of creating a second tender.
  useEffect(() => {
    if (resumedRef.current) {
      return;
    }
    resumedRef.current = true;
    const resumeCode = searchParams.get("code");
    if (resumeCode) {
      setCode(resumeCode);
      setStep("analyzing");
    }
  }, [searchParams]);

  const loadDetail = useCallback(async (currentCode: string) => {
    const response = await fetch(`/api/appels-offres/${encodeURIComponent(currentCode)}`, {
      cache: "no-store"
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as AppelOffresDetail;
  }, []);

  // Poll while the CDC analysis is running.
  useEffect(() => {
    if (step !== "analyzing" || !code || analysisFailed || pollTimedOut) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function tick() {
      const nextDetail = await loadDetail(code!);
      if (cancelled || !nextDetail) {
        return;
      }

      setDetail(nextDetail);
      const ficheStatus = nextDetail.ficheStatus?.status ?? null;

      if (ficheStatus === "draft" || ficheStatus === "validated") {
        setStep("review");
        return;
      }

      if (ficheStatus === "error" || buildWorkspaceFailureSummary(nextDetail)) {
        setAnalysisFailed(true);
        return;
      }

      attempts += 1;
      if (attempts >= MAX_POLL_ATTEMPTS) {
        setPollTimedOut(true);
      }
    }

    void tick();
    const intervalId = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [step, code, analysisFailed, pollTimedOut, loadDetail]);

  // Once the review step is reached through a successful analysis (not the
  // manual fallback), fetch the extraction preview exactly once.
  useEffect(() => {
    if (step !== "review" || manualMode || !code || previewRequestedRef.current) {
      return;
    }
    previewRequestedRef.current = true;

    void (async () => {
      try {
        const response = await fetch(
          `/api/appels-offres/${encodeURIComponent(code)}/extraction-preview`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as ExtractionIdentityPreview;
        setPreview(data);
        setForm({
          title: data.title.detected ? data.title.value : "",
          buyer: data.buyer.detected ? data.buyer.value : "",
          country: data.country.detected ? data.country.value : "",
          dueDate: data.dueDate.parsedDate ?? "",
          reference: data.reference.detected ? data.reference.value : "",
          priorite: "normale"
        });
      } catch {
        // No preview available - the review form simply stays empty/manual.
      }
    })();
  }, [step, manualMode, code]);

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

  async function handleAnalyze() {
    if (isSubmittingUpload) {
      return;
    }

    if (!file) {
      setError("Ajoutez le CDC PDF avant de continuer.");
      return;
    }

    const fileError = getPdfFileSelectionError({ name: file.name, type: file.type, size: file.size });
    if (fileError) {
      setError(fileError);
      return;
    }

    setError(null);
    setIsSubmittingUpload(true);

    try {
      const newCode = suggestNewAppelOffresCode();
      const payload = new FormData();
      payload.append("code", newCode);
      payload.append("file", file);

      const response = await fetch("/api/appels-offres", { method: "POST", body: payload });
      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "La création du dossier a échoué.");
        return;
      }

      setCode(newCode);
      setStep("analyzing");
      router.replace(`/appels-offres/nouveau?code=${encodeURIComponent(newCode)}`, { scroll: false });
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "La création du dossier a échoué."
      );
    } finally {
      setIsSubmittingUpload(false);
    }
  }

  async function handleRetryAnalysis() {
    if (!code || isRetrying) {
      return;
    }

    setIsRetrying(true);
    setError(null);

    try {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/analyse`, {
        method: "POST",
        body: new FormData()
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        requiresConfirmation?: boolean;
      };

      if (!response.ok && !(response.status === 409 && body.requiresConfirmation)) {
        setError(body.error ?? "Le lancement de l'analyse a échoué.");
        return;
      }

      setAnalysisFailed(false);
      setPollTimedOut(false);
    } finally {
      setIsRetrying(false);
    }
  }

  function handleManualEntry() {
    setManualMode(true);
    setPreview(null);
    setForm(emptyReviewForm());
    setError(null);
    setStep("review");
  }

  async function handleConfirmCreate() {
    if (!code || isCreating) {
      return;
    }

    if (!form.title.trim()) {
      setError("L'intitulé de l'appel d'offres est obligatoire.");
      return;
    }

    setError(null);
    setIsCreating(true);
    setStep("creating");

    try {
      const payload = new FormData();
      payload.append("code", code);
      payload.append("title", form.title.trim());
      payload.append("reference", form.reference.trim());
      payload.append("buyer", form.buyer.trim());
      payload.append("country", form.country.trim());
      payload.append("dueDate", form.dueDate.trim());
      payload.append("notes", "");
      payload.append("priorite", form.priorite);
      payload.append("responsable_commercial", "");

      const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}`, {
        method: "PUT",
        body: payload
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(body.error ?? "La création du dossier a échoué.");
        setStep("review");
        return;
      }

      router.push(`/appels-offres/${encodeURIComponent(code)}`);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "La création du dossier a échoué."
      );
      setStep("review");
    } finally {
      setIsCreating(false);
    }
  }

  const currentStepIndex = STEP_ORDER.indexOf(step);
  const timeline = detail ? buildProcessingTimeline(detail) : [];
  const failureSummary = detail ? buildWorkspaceFailureSummary(detail) : null;

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
          disabled={isSubmittingUpload}
        >
          Remplacer
        </button>
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() => applyFile(null)}
          disabled={isSubmittingUpload}
        >
          Retirer
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="appel-offres-create-form">
      <nav className="appel-offres-create-steps" aria-label="Etapes de creation">
        {WIZARD_STEPS.map((stepDef, index) => (
          <div
            key={stepDef.key}
            className={
              index === currentStepIndex
                ? "appel-offres-create-step is-current"
                : index < currentStepIndex
                  ? "appel-offres-create-step is-done"
                  : "appel-offres-create-step"
            }
          >
            <span className="appel-offres-create-step-index">
              {index < currentStepIndex ? "✓" : index + 1}
            </span>
            <span>{stepDef.label}</span>
            {index < WIZARD_STEPS.length - 1 ? <i aria-hidden="true">→</i> : null}
          </div>
        ))}
      </nav>

      <section className="section-card appel-offres-create-card">
        <div className="section-body stack appel-offres-create-body">
          {step === "upload" ? (
            <div className="stack">
              <p className="meta">
                Importez le cahier des charges. Les informations principales de l&apos;appel
                d&apos;offres seront détectées automatiquement.
              </p>
              <div
                className={
                  dragActive
                    ? "upload-dropzone create-upload-dropzone active"
                    : "upload-dropzone create-upload-dropzone"
                }
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
                  disabled={isSubmittingUpload}
                  onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
                />
                <div className="upload-dropzone-icon create-upload-dropzone-icon">
                  <UploadIcon className="upload-icon" />
                </div>
                <div className="upload-dropzone-copy create-upload-dropzone-copy">
                  <strong>Deposez votre CDC PDF ici</strong>
                  <p>
                    ou{" "}
                    <button
                      type="button"
                      className="inline-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmittingUpload}
                    >
                      cliquez pour selectionner un fichier
                    </button>
                  </p>
                  <span>Format accepté : PDF uniquement.</span>
                </div>
              </div>

              {selectedFile}

              {error ? <div className="callout warning">{error}</div> : null}

              <div className="sticky-action-bar appel-offres-create-actions">
                <Link href="/appels-offres" className="button button-ghost">
                  Annuler
                </Link>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleAnalyze()}
                  disabled={!file || isSubmittingUpload}
                >
                  {isSubmittingUpload ? "Envoi en cours..." : "Analyser le CDC"}
                </button>
              </div>
            </div>
          ) : null}

          {step === "analyzing" ? (
            <div className="stack">
              {!analysisFailed && !pollTimedOut ? (
                <>
                  <p className="meta">
                    <strong>Analyse du CDC en cours.</strong>
                    <br />
                    Nous détectons les informations principales de l&apos;appel d&apos;offres.
                  </p>
                  <ProcessingTimeline steps={timeline} />
                </>
              ) : (
                <>
                  <div className="callout warning">
                    {pollTimedOut
                      ? "L'analyse prend plus de temps que prévu."
                      : failureSummary?.message ?? "L'analyse du CDC a échoué."}
                  </div>
                  <div className="workspace-card-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void handleRetryAnalysis()}
                      disabled={isRetrying}
                    >
                      {isRetrying ? "Relance en cours..." : "Réessayer l'analyse"}
                    </button>
                    <button type="button" className="button button-secondary" onClick={handleManualEntry}>
                      Saisir les informations manuellement
                    </button>
                  </div>
                </>
              )}

              {error ? <div className="callout warning">{error}</div> : null}
            </div>
          ) : null}

          {step === "review" ? (
            <div className="stack">
              <p className="meta">
                <strong>
                  {manualMode || !preview
                    ? "Informations du dossier"
                    : "Informations détectées dans le CDC"}
                </strong>
                <br />
                Vérifiez les informations avant de créer le dossier.
              </p>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="review-title">Intitulé</label>
                  <input
                    id="review-title"
                    className="input"
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  />
                  {preview ? <DetectionHint detected={preview.title.detected} /> : null}
                </div>
                <div className="field">
                  <label htmlFor="review-buyer">Client / maître d&apos;ouvrage</label>
                  <input
                    id="review-buyer"
                    className="input"
                    value={form.buyer}
                    onChange={(event) => setForm((current) => ({ ...current, buyer: event.target.value }))}
                  />
                  {preview ? <DetectionHint detected={preview.buyer.detected} /> : null}
                </div>
                <div className="field">
                  <label htmlFor="review-country">Pays</label>
                  <input
                    id="review-country"
                    className="input"
                    value={form.country}
                    onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))}
                  />
                  {preview ? <DetectionHint detected={preview.country.detected} /> : null}
                </div>
                <div className="field">
                  <label htmlFor="review-due-date">Date limite</label>
                  <input
                    id="review-due-date"
                    type="date"
                    className="input"
                    value={form.dueDate}
                    onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
                  />
                  {preview ? (
                    <DetectionHint detected={preview.dueDate.parsedDate != null} />
                  ) : null}
                  {preview && !preview.dueDate.parsedDate && preview.dueDate.value ? (
                    <span className="hint">
                      Détecté dans le CDC : « {preview.dueDate.value} » — vérifiez et sélectionnez la date.
                    </span>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="review-priority">Priorité</label>
                  <select
                    id="review-priority"
                    className="select"
                    value={form.priorite}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
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
                  <label htmlFor="review-reference">Référence de l&apos;appel d&apos;offres</label>
                  <input
                    id="review-reference"
                    className="input"
                    value={form.reference}
                    onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))}
                  />
                  {preview ? <DetectionHint detected={preview.reference.detected} /> : null}
                </div>
              </div>

              {error ? <div className="callout warning">{error}</div> : null}

              <div className="sticky-action-bar appel-offres-create-actions">
                <button
                  type="button"
                  className="button button-ghost"
                  onClick={() => setStep("upload")}
                  disabled={isCreating}
                >
                  Retour
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleConfirmCreate()}
                  disabled={isCreating || !form.title.trim()}
                >
                  Créer l&apos;appel d&apos;offres
                </button>
              </div>
            </div>
          ) : null}

          {step === "creating" ? (
            <div className="stack">
              <p className="meta">Création du dossier en cours...</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
