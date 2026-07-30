"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import type { FicheStatus } from "@/lib/types";

type Props = {
  code: string;
  hasSourcePdf: boolean;
  ficheStatus: FicheStatus | null;
  hasFicheXml: boolean;
  isRetryState: boolean;
};

export function AppelOffresAnalysisPanel({
  code,
  hasSourcePdf,
  ficheStatus,
  hasFicheXml,
  isRetryState
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [showReplaceInput, setShowReplaceInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const launchLabel =
    ficheStatus === "processing"
      ? "Analyse en cours"
      : file && hasSourcePdf
        ? "Remplacer le CDC et relancer"
        : file
          ? "Importer le CDC et lancer l'analyse"
          : isRetryState
            ? "Relancer l'analyse"
            : hasSourcePdf
              ? "Lancer l'analyse"
              : "Importer le CDC et lancer l'analyse";

  async function submit(forceRegenerate = false) {
    setError(null);
    setConfirmationMessage(null);

    if (!hasSourcePdf && !file) {
      setError("Veuillez importer un CDC PDF avant de lancer l'analyse.");
      return;
    }

    const payload = new FormData();
    payload.append("code_interne", code);
    if (file) {
      payload.append("file", file);
    }
    if (forceRegenerate) {
      payload.append("force_regenerate", "true");
    }

    startTransition(async () => {
      const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}/analyse`, {
        method: "POST",
        body: payload
      });

      const body = (await response.json()) as {
        code?: string;
        code_interne?: string;
        status?: "processing" | "error";
        error?: string;
        requiresConfirmation?: boolean;
      };

      if (response.status === 409 && body.requiresConfirmation) {
        setConfirmationMessage(
          body.error ??
            "Une fiche existe deja pour cet appel d'offres. Confirmez pour relancer l'analyse."
        );
        return;
      }

      if (!response.ok) {
        setError(body.error ?? "Le lancement de l'analyse a echoue.");
        return;
      }

      const nextCode = body.code_interne ?? body.code ?? code;
      setShowReplaceInput(false);
      router.push(
        `/appels-offres/${encodeURIComponent(nextCode)}?view=fci&flash=analysis-started`
      );
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(false);
  }

  return (
    <form className="grid workspace-analysis-panel" onSubmit={handleSubmit}>
      {hasSourcePdf && ficheStatus !== "processing" ? (
        <div className="workspace-analysis-inline-actions">
          <span className="hint">Le CDC actuel reste disponible dans l&apos;onglet Documents.</span>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setShowReplaceInput((current) => !current)}
            disabled={isPending}
          >
            {showReplaceInput ? "Annuler le remplacement" : "Remplacer le CDC"}
          </button>
        </div>
      ) : null}

      {!hasSourcePdf || showReplaceInput ? (
        <div className="field">
          <label htmlFor="cdc-import">
            {hasSourcePdf ? "Remplacer le CDC" : "Importer le CDC"}
          </label>
          <input
            id="cdc-import"
            type="file"
            accept="application/pdf,.pdf"
            className="input"
            disabled={isPending || ficheStatus === "processing"}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setConfirmationMessage(null);
            }}
          />
          <span className="hint">
            {hasSourcePdf
              ? "Le nouveau PDF sera utilise pour la prochaine analyse."
              : "Aucun CDC PDF n'est encore attache a cet appel d'offres."}
          </span>
        </div>
      ) : null}

      {error ? <div className="error-text">{error}</div> : null}
      {confirmationMessage ? (
        <div className="callout warning">
          <div>{confirmationMessage}</div>
          <div className="actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void submit(true)}
              disabled={isPending}
            >
              {isPending ? "Relance..." : "Confirmer et relancer l'analyse"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="actions">
        {ficheStatus !== "processing" ? (
          <button className="button button-ai" type="submit" disabled={isPending}>
            {isPending ? "Analyse en cours..." : launchLabel}
          </button>
        ) : null}
        {hasFicheXml ? (
          <Link className="button button-secondary" href={`/fiche/${encodeURIComponent(code)}`}>
            Ouvrir la Fiche CDC
          </Link>
        ) : null}
      </div>
    </form>
  );
}
