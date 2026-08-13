"use client";

import { useState } from "react";
import {
  CATEGORY_LABELS,
  MAX_PSEUDONYMISATION_INPUT_LENGTH,
  PseudonymisationInputError,
  pseudonymiseText,
  type PseudonymisationCategory,
  type PseudonymisationDetection,
  type PseudonymisationResult
} from "@/lib/outils/pseudonymisation.ts";

const GENERIC_FAILURE_MESSAGE = "La pseudonymisation n'a pas pu être terminée. Réessayez.";

function groupDetectionsByCategory(detections: PseudonymisationDetection[]) {
  const groups = new Map<PseudonymisationCategory, PseudonymisationDetection[]>();
  for (const detection of detections) {
    const list = groups.get(detection.category) ?? [];
    list.push(detection);
    groups.set(detection.category, list);
  }
  return [...groups.entries()];
}

function toErrorMessage(caught: unknown) {
  return caught instanceof PseudonymisationInputError ? caught.message : GENERIC_FAILURE_MESSAGE;
}

export function PseudonymisationWorkspace() {
  const [originalText, setOriginalText] = useState("");
  const [processedText, setProcessedText] = useState<string | null>(null);
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<PseudonymisationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  function runPseudonymisation() {
    setError(null);
    setCopyState("idle");
    try {
      const outcome = pseudonymiseText(originalText, excludedKeys);
      setResult(outcome);
      setProcessedText(originalText);
    } catch (caught) {
      setResult(null);
      setProcessedText(null);
      setError(toErrorMessage(caught));
    }
  }

  function toggleDetection(key: string) {
    if (processedText === null) {
      return;
    }

    const nextExcludedKeys = new Set(excludedKeys);
    if (nextExcludedKeys.has(key)) {
      nextExcludedKeys.delete(key);
    } else {
      nextExcludedKeys.add(key);
    }

    setExcludedKeys(nextExcludedKeys);
    try {
      setResult(pseudonymiseText(processedText, nextExcludedKeys));
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  function handleReset() {
    setOriginalText("");
    setProcessedText(null);
    setExcludedKeys(new Set());
    setResult(null);
    setError(null);
    setCopyState("idle");
  }

  async function handleCopy() {
    if (!result) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.pseudonymisedText);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  function handleDownload() {
    if (!result) {
      return;
    }
    const blob = new Blob([result.pseudonymisedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "texte-pseudonymise.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const groupedDetections = result ? groupDetectionsByCategory(result.detections) : [];

  return (
    <div className="stack">
      <div className="callout info">
        Le contenu est traité localement dans l'environnement CONCEPT. Vérifiez toujours le résultat avant de le
        partager avec un service externe.
      </div>

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Texte original</h3>
            <p className="meta">
              Collez le texte contenant des informations sensibles avant de le partager avec un service d&apos;IA
              externe.
            </p>
          </div>
        </div>
        <div className="section-body stack">
          <div className="field">
            <label htmlFor="pseudonymisation-input">Texte original</label>
            <textarea
              id="pseudonymisation-input"
              className="textarea"
              rows={10}
              maxLength={MAX_PSEUDONYMISATION_INPUT_LENGTH}
              value={originalText}
              onChange={(event) => setOriginalText(event.target.value)}
              placeholder="Collez ici le texte a preparer..."
            />
          </div>

          {error ? <div className="callout warning">{error}</div> : null}

          <div className="actions">
            <button type="button" className="button button-primary" onClick={runPseudonymisation}>
              Pseudonymiser
            </button>
            <button type="button" className="button button-ghost" onClick={handleReset}>
              Réinitialiser
            </button>
          </div>
        </div>
      </section>

      {result ? (
        <>
          <section className="section-card">
            <div className="section-header">
              <div>
                <h3>Éléments détectés</h3>
                <p className="meta">
                  Décochez un élément pour le conserver tel quel dans le résultat pseudonymisé.
                </p>
              </div>
            </div>
            <div className="section-body stack">
              {groupedDetections.length === 0 ? (
                <p className="empty-inline-note">Aucun élément sensible détecté dans ce texte.</p>
              ) : (
                groupedDetections.map(([category, detections]) => (
                  <div key={category} className="stack">
                    <span className="badge">{CATEGORY_LABELS[category]}</span>
                    <div className="stack">
                      {detections.map((detection) => (
                        <label key={detection.key} className="toggle-field">
                          <input
                            type="checkbox"
                            checked={detection.included}
                            onChange={() => toggleDetection(detection.key)}
                          />
                          <span>
                            {detection.originalValue} → {detection.alias}
                            {detection.occurrences > 1 ? ` (${detection.occurrences} occurrences)` : ""}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <h3>Résultat pseudonymisé</h3>
              </div>
            </div>
            <div className="section-body stack">
              <div className="field">
                <label htmlFor="pseudonymisation-output">Résultat pseudonymisé</label>
                <textarea
                  id="pseudonymisation-output"
                  className="textarea"
                  rows={10}
                  value={result.pseudonymisedText}
                  readOnly
                />
              </div>

              <div className="actions">
                <button type="button" className="button button-secondary" onClick={handleCopy}>
                  {copyState === "copied" ? "Copié" : "Copier le résultat"}
                </button>
                <button type="button" className="button button-secondary" onClick={handleDownload}>
                  Télécharger en .txt
                </button>
              </div>

              {copyState === "error" ? (
                <div className="callout warning">
                  La copie a échoué. Sélectionnez et copiez le texte manuellement.
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
