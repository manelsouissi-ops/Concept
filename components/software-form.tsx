"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type { SoftwareRecord } from "@/lib/administration/logiciels/types.ts";
import { serializeAliasesInput } from "@/lib/administration/logiciels/validation.ts";

type Props = {
  mode: "create" | "edit";
  software?: SoftwareRecord | null;
};

function createInitialState(software?: SoftwareRecord | null) {
  return {
    name: software?.name ?? "",
    descriptionRaw: software?.descriptionRaw ?? "",
    aliases: software ? serializeAliasesInput(software.aliases.map((alias) => alias.alias)) : ""
  };
}

export function SoftwareForm({ mode, software }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(createInitialState(software));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isWorking) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsWorking(true);

    try {
      const payload = new FormData();
      payload.append("name", form.name);
      payload.append("description_raw", form.descriptionRaw);
      payload.append("aliases", form.aliases);

      const response = await fetch(
        mode === "create"
          ? "/api/administration/logiciels"
          : `/api/administration/logiciels/${software?.id ?? ""}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          body: payload
        }
      );

      const body = (await response.json()) as {
        error?: string;
        software?: SoftwareRecord;
      };

      if (!response.ok) {
        setError(body.error ?? "Enregistrement impossible.");
        return;
      }

      if (mode === "create" && body.software) {
        router.push(`/administration/logiciels/${body.software.id}`);
        return;
      }

      setSuccess("Logiciel mis a jour.");
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Enregistrement impossible."
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <form className="grid" onSubmit={handleSubmit}>
      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Informations du logiciel</h3>
            <p className="meta">
              Centralisez le nom de reference, l'utilisation brute et les alias utiles au matching.
            </p>
          </div>
        </div>

        <div className="section-body stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="software-name">Logiciel</label>
              <input
                id="software-name"
                className="input"
                value={form.name}
                disabled={isWorking}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value
                  }))
                }
              />
            </div>

            <div className="field field-span-full">
              <label htmlFor="software-description">Utilisation</label>
              <textarea
                id="software-description"
                className="textarea"
                value={form.descriptionRaw}
                disabled={isWorking}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    descriptionRaw: event.target.value
                  }))
                }
              />
              <span className="hint">
                Ce champ conserve le texte brut issu du catalogue interne ou d'une saisie manuelle.
              </span>
            </div>

            <div className="field field-span-full">
              <label htmlFor="software-aliases">Alias</label>
              <textarea
                id="software-aliases"
                className="textarea logiciels-alias-textarea"
                value={form.aliases}
                disabled={isWorking}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    aliases: event.target.value
                  }))
                }
              />
              <span className="hint">Un alias par ligne ou separe par des virgules.</span>
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="callout warning">{error}</div> : null}
      {success ? <div className="callout info">{success}</div> : null}

      <div className="actions">
        <button className="button button-primary" type="submit" disabled={isWorking}>
          {mode === "create" ? "Ajouter le logiciel" : "Enregistrer les modifications"}
        </button>
        <Link
          href={
            mode === "create"
              ? "/administration/logiciels"
              : `/administration/logiciels/${software?.id ?? ""}`
          }
          className="button button-ghost"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
