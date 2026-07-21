"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { AiBadge } from "@/components/ai-badge";
import type { FicheStatus } from "@/lib/types";

type Props = {
  code: string;
  hasSourcePdf: boolean;
  ficheStatus: FicheStatus | null;
  hasFicheXml: boolean;
};

export function AppelOffresAnalysisPanel({
  code,
  hasSourcePdf,
  ficheStatus,
  hasFicheXml
}: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const launchLabel = file
    ? "Importer le CDC et lancer l'analyse"
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
      router.push(
        `/appels-offres/${encodeURIComponent(nextCode)}?view=processing&flash=analysis-started`
      );
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(false);
  }

  return (
    <form className="grid" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="cdc-import">Importer le CDC</label>
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
            ? "Vous pouvez reutiliser le PDF deja enregistre ou en importer un nouveau avant l'analyse."
            : "Aucun CDC PDF n'est encore attache a cet appel d'offres."}
        </span>
      </div>

      {ficheStatus === "processing" ? (
        <div className="callout ai">
          <AiBadge label="Analyse IA" />
          Une analyse est deja en cours pour cet appel d&apos;offres. Suivez son avancement depuis ce workspace.
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
        <button
          className="button button-ai"
          type="submit"
          disabled={isPending || ficheStatus === "processing"}
        >
          {isPending ? "Analyse en cours..." : launchLabel}
        </button>
        {hasFicheXml ? (
          <Link className="button button-secondary" href={`/fiche/${encodeURIComponent(code)}`}>
            Ouvrir la Fiche CDC
          </Link>
        ) : null}
      </div>
    </form>
  );
}
