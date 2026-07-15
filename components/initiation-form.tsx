"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";

export function InitiationForm() {
  const router = useRouter();
  const [codeInterne, setCodeInterne] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit(forceRegenerate = false) {
    setError(null);
    setConfirmationMessage(null);

    if (!codeInterne.trim()) {
      setError("Le code interne est obligatoire.");
      return;
    }

    if (!file) {
      setError("Veuillez selectionner un PDF.");
      return;
    }

    const payload = new FormData();
    payload.append("code_interne", codeInterne.trim());
    payload.append("file", file);
    if (forceRegenerate) {
      payload.append("force_regenerate", "true");
    }

    startTransition(async () => {
      const response = await fetch("/api/generate", {
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
            "Ce code possede deja une fiche validee. Regenerer ecrasera cette version."
        );
        return;
      }

      if (!response.ok) {
        setError(body.error ?? "La generation a echoue.");
        return;
      }

      const nextCode = body.code_interne ?? body.code;
      if (!nextCode) {
        setError("La reponse de generation est incomplete.");
        return;
      }

      router.push(`/fiche/${encodeURIComponent(nextCode)}`);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submit(false);
  }

  return (
    <form className="grid" onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="code_interne">Code interne</label>
          <input
            id="code_interne"
            className="input mono"
            placeholder="INT-2026-045"
            value={codeInterne}
            onChange={(event) => {
              setCodeInterne(event.target.value);
              setConfirmationMessage(null);
            }}
            disabled={isPending}
          />
          <span className="hint">
            Ce code structure aussi le stockage dans <span className="mono">/data</span>.
          </span>
        </div>

        <div className="field">
          <label htmlFor="pdf">CDC PDF</label>
          <input
            id="pdf"
            type="file"
            accept="application/pdf,.pdf"
            className="input"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setConfirmationMessage(null);
            }}
            disabled={isPending}
          />
          <span className="hint">
            Le PDF brut est conserve comme reference non traitee.
          </span>
        </div>
      </div>

      <div className="callout info">
        L'analyse démarre en mode asynchrone : le PDF est accepté, puis la Fiche CDC se complète en arrière-plan pendant que vous suivez son statut.
      </div>

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
              {isPending ? "Regeneration..." : "Confirmer et ecraser"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="actions">
        <button className="button button-primary" type="submit" disabled={isPending}>
          {isPending ? "Génération en cours..." : "Lancer la génération"}
        </button>
      </div>
    </form>
  );
}
