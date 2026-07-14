"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS,
  type ControleResolution,
  type ControleResolutionSection,
  type ControleResolutionStatus,
  type ControleSection,
  type EvaluationField,
  type ExtractionField,
  type FichePayload,
  type FicheResponse,
  type StatusPayload
} from "@/lib/types";

type Props = {
  code: string;
};

type SaveState = "idle" | "saved" | "validated";

type SourceJumpResult = {
  lineIndex: number | null;
  reason: string | null;
};

type FicheStatusResponse = Pick<
  StatusPayload,
  "status" | "processingStartedAt" | "errorReason" | "errorStage" | "n8nExecutionId"
>;

type PdfPageProxyLike = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageProxyLike>;
};

type PdfJsModuleLike = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (params: {
    url: string;
    cMapUrl?: string;
    standardFontDataUrl?: string;
  }) => { promise: Promise<PdfDocumentLike> };
};

const EXTRACTION_GROUP_ORDER = [
  "Identification",
  "Procedure",
  "Duree & volume",
  "Livrables & profils",
  "Site & contraintes"
] as const;

const CONTROL_SECTION_CONFIG = [
  {
    key: "champs_non_trouves",
    title: "Champs non trouves",
    emptyLabel: "Aucun champ manquant.",
    getItems: (control: ControleSection) => control.champsNonTrouves
  },
  {
    key: "incoherences",
    title: "Incoherences",
    emptyLabel: "Aucune incoherence detectee.",
    getItems: (control: ControleSection) => control.incoherences
  },
  {
    key: "a_verifier",
    title: "A verifier",
    emptyLabel: "Aucun point de vigilance.",
    getItems: (control: ControleSection) => control.aVerifier
  }
] as const satisfies ReadonlyArray<{
  key: ControleResolutionSection;
  title: string;
  emptyLabel: string;
  getItems: (control: ControleSection) => string[];
}>;

const RESOLUTION_STATUS_OPTIONS = [
  { value: "unresolved", label: "Non traite" },
  { value: "resolved", label: "Resolu" },
  { value: "ignored", label: "Ignore" },
  { value: "commented", label: "Commentaire" }
] as const satisfies ReadonlyArray<{
  value: ControleResolutionStatus;
  label: string;
}>;

const GENERIC_SOURCE_WORDS = new Set([
  "cdc",
  "md",
  "source",
  "page",
  "section",
  "field",
  "pdf",
  "reference",
  "officielle",
  "intitule",
  "mission",
  "client",
  "maitre",
  "ouvrage"
]);

function isErrorResponse(value: unknown): value is { error?: string } {
  return value !== null && typeof value === "object" && "error" in value;
}

function cloneControl(control: ControleSection): ControleSection {
  return {
    champsNonTrouves: [...control.champsNonTrouves],
    incoherences: [...control.incoherences],
    aVerifier: [...control.aVerifier],
    resolutions: control.resolutions.map((resolution) => ({ ...resolution }))
  };
}

function statusLabel(status: FicheResponse["status"]["status"]) {
  switch (status) {
    case "processing":
      return "Traitement";
    case "validated":
      return "Validee";
    case "error":
      return "Erreur";
    default:
      return "Brouillon";
  }
}

function formatElapsed(processingStartedAt: string | null) {
  if (!processingStartedAt) {
    return null;
  }

  const elapsedMs = Date.now() - new Date(processingStartedAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return null;
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeDistinctiveWords(...values: Array<string | undefined>) {
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeForSearch(value ?? "");
    if (!normalized) {
      continue;
    }

    for (const rawToken of normalized.split(" ")) {
      const token = rawToken.trim();
      if (
        !token ||
        token.length < 3 ||
        GENERIC_SOURCE_WORDS.has(token) ||
        /^\d+$/.test(token)
      ) {
        continue;
      }

      seen.add(token);
    }
  }

  return [...seen];
}

function parsePageReference(source: string) {
  const match = source.match(/\b(?:page|p\.)\s*(\d{1,4})\b/i);
  if (!match) {
    return null;
  }

  const page = Number(match[1]);
  return Number.isInteger(page) && page > 0 ? page : null;
}

function findBestMarkdownLine(
  markdown: string,
  field: ExtractionField
): SourceJumpResult {
  const lines = markdown.split(/\r?\n/);
  const sourceText = field.source ?? "";
  const normalizedSource = normalizeForSearch(sourceText);
  const normalizedValue = normalizeForSearch(field.value);

  const exactSourceLine = lines.findIndex((line) =>
    normalizeForSearch(line).includes(normalizedSource)
  );
  if (normalizedSource && exactSourceLine >= 0) {
    return { lineIndex: exactSourceLine, reason: null };
  }

  const exactValueLine = lines.findIndex((line) =>
    normalizeForSearch(line).includes(normalizedValue)
  );
  if (normalizedValue && exactValueLine >= 0) {
    return { lineIndex: exactValueLine, reason: null };
  }

  const keyWords = field.key.split("_");
  const tokens = tokenizeDistinctiveWords(sourceText, field.value, keyWords.join(" "));

  let bestIndex = -1;
  let bestScore = 0;

  lines.forEach((line, index) => {
    const normalizedLine = normalizeForSearch(line);
    if (!normalizedLine) {
      return;
    }

    let score = 0;
    for (const token of tokens) {
      if (normalizedLine.includes(token)) {
        score += token.length;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex >= 0 && bestScore > 0) {
    return { lineIndex: bestIndex, reason: null };
  }

  const headingTokens = tokenizeDistinctiveWords(
    EXTRACTION_FIELD_DEFINITIONS.find((definition) => definition.key === field.key)?.group
  );
  const headingMatch = lines.findIndex((line) => {
    const normalizedLine = normalizeForSearch(line);
    return headingTokens.some((token) => normalizedLine.includes(token));
  });

  if (headingMatch >= 0) {
    return { lineIndex: headingMatch, reason: null };
  }

  return {
    lineIndex: null,
    reason: "Correspondance non trouvee dans le Markdown"
  };
}

export function FicheEditor({ code }: Props) {
  const [data, setData] = useState<FicheResponse | null>(null);
  const [statusData, setStatusData] = useState<FicheStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isPending, startTransition] = useTransition();
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [markdownHighlightIndex, setMarkdownHighlightIndex] = useState<number | null>(null);
  const [markdownFlashToken, setMarkdownFlashToken] = useState(0);
  const [sourceFeedbackKey, setSourceFeedbackKey] = useState<string | null>(null);
  const [sourceFeedbackMessage, setSourceFeedbackMessage] = useState<string | null>(null);
  const [pdfJumpPage, setPdfJumpPage] = useState<number | null>(null);
  const [pdfFlashToken, setPdfFlashToken] = useState(0);
  const [elapsedLabel, setElapsedLabel] = useState<string | null>(null);
  const markdownLineRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    let active = true;

    async function fetchStatus() {
      const response = await fetch(`/api/fiche/${encodeURIComponent(code)}/status`);
      const body = (await response.json()) as FicheStatusResponse | { error: string };

      if (!active) {
        return;
      }

      if (!response.ok || isErrorResponse(body)) {
        setError("Impossible de charger cette fiche.");
        return;
      }

      setStatusData(body);

      if (body.status === "draft" || body.status === "validated") {
        const ficheResponse = await fetch(`/api/fiche/${encodeURIComponent(code)}`);
        const ficheBody = (await ficheResponse.json()) as FicheResponse | { error: string };

        if (!active) {
          return;
        }

        if (!ficheResponse.ok || isErrorResponse(ficheBody)) {
          setError("Impossible de charger cette fiche.");
          return;
        }

        setData(ficheBody);
        setError(null);
        return;
      }

      setData(null);
      setError(null);
    }

    void fetchStatus();

    return () => {
      active = false;
    };
  }, [code]);

  useEffect(() => {
    if (statusData?.status !== "processing") {
      return;
    }

    const updateElapsed = () => {
      setElapsedLabel(formatElapsed(statusData.processingStartedAt));
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [statusData]);

  useEffect(() => {
    if (statusData?.status !== "processing") {
      return;
    }

    let cancelled = false;

    const poll = window.setInterval(async () => {
      const response = await fetch(`/api/fiche/${encodeURIComponent(code)}/status`);
      const body = (await response.json()) as FicheStatusResponse | { error: string };

      if (cancelled || !response.ok || isErrorResponse(body)) {
        return;
      }

      setStatusData(body);

      if (body.status === "draft" || body.status === "validated" || body.status === "error") {
        const ficheResponse = await fetch(`/api/fiche/${encodeURIComponent(code)}`);
        const ficheBody = (await ficheResponse.json()) as FicheResponse | { error: string };

        if (cancelled) {
          return;
        }

        if (ficheResponse.ok && !isErrorResponse(ficheBody)) {
          setData(ficheBody);
        } else if (body.status !== "error") {
          setError("Impossible de charger cette fiche.");
        } else {
          setData(null);
        }

        window.clearInterval(poll);
      }
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [code, statusData?.status]);

  useEffect(() => {
    if (markdownHighlightIndex == null) {
      return;
    }

    const target = markdownLineRefs.current[markdownHighlightIndex];
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [markdownHighlightIndex, markdownFlashToken]);

  function updateExtraction(index: number, nextValue: string) {
    setData((current) => {
      if (!current) {
        return current;
      }

      const extraction = current.extraction.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, value: nextValue } : field
      );

      return { ...current, extraction };
    });
    setSaveState("idle");
  }

  function updateEvaluation(
    index: number,
    patch: Partial<Pick<EvaluationField, "score" | "justification" | "chargeEstimee">>
  ) {
    setData((current) => {
      if (!current) {
        return current;
      }

      const evaluation = current.evaluation.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field
      );

      return { ...current, evaluation };
    });
    setSaveState("idle");
  }

  function updateResolution(
    section: ControleResolutionSection,
    index: number,
    patch: Partial<Pick<ControleResolution, "status" | "comment">>
  ) {
    setData((current) => {
      if (!current) {
        return current;
      }

      const controle = cloneControl(current.controle);
      const resolutionIndex = controle.resolutions.findIndex(
        (resolution) => resolution.section === section && resolution.index === index
      );

      if (resolutionIndex === -1) {
        controle.resolutions.push({
          section,
          index,
          status: patch.status ?? "unresolved",
          comment: patch.comment ?? ""
        });
      } else {
        controle.resolutions[resolutionIndex] = {
          ...controle.resolutions[resolutionIndex],
          ...patch
        };
      }

      return { ...current, controle };
    });
    setSaveState("idle");
  }

  function handleSourceJump(field: ExtractionField) {
    setMarkdownOpen(true);
    const markdown = data?.markdown ?? "";
    const result = findBestMarkdownLine(markdown, field);
    const feedbackKey = field.key;

    if (result.lineIndex != null) {
      setMarkdownHighlightIndex(result.lineIndex);
      setMarkdownFlashToken((current) => current + 1);
      setSourceFeedbackKey(null);
      setSourceFeedbackMessage(null);
    } else {
      setSourceFeedbackKey(feedbackKey);
      setSourceFeedbackMessage(result.reason);
    }

    const pageReference = parsePageReference(field.source);
    if (pageReference != null) {
      setPdfOpen(true);
      setPdfJumpPage(pageReference);
      setPdfFlashToken((current) => current + 1);
    }
  }

  function buildPayload(from: FicheResponse): FichePayload {
    return {
      codeInterne: from.codeInterne,
      extraction: from.extraction,
      evaluation: from.evaluation,
      controle: cloneControl(from.controle)
    };
  }

  async function persistDraft(current: FicheResponse) {
    const response = await fetch(`/api/fiche/${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(current))
    });

    const body = (await response.json()) as FicheResponse | { error?: string };

    if (!response.ok || isErrorResponse(body)) {
      throw new Error(
        isErrorResponse(body) ? body.error ?? "La sauvegarde a echoue." : "La sauvegarde a echoue."
      );
    }

    return body;
  }

  async function persist(method: "PUT" | "POST", url: string) {
    if (!data) {
      return;
    }

    const snapshot = data;

    startTransition(async () => {
      try {
        if (method === "PUT") {
          const saved = await persistDraft(snapshot);
          setData(saved);
          setError(null);
          setSaveState("saved");
          return;
        }

        const saved = await persistDraft(snapshot);
        const response = await fetch(url, { method: "POST" });
        const body = (await response.json()) as FicheResponse | { error?: string };

        if (!response.ok || isErrorResponse(body)) {
          throw new Error(
            isErrorResponse(body)
              ? body.error ?? "La validation a echoue."
              : "La validation a echoue."
          );
        }

        setData(body);
        setError(null);
        setSaveState("validated");
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : "L'operation a echoue."
        );
      }
    });
  }

  async function retryGeneration() {
    startTransition(async () => {
      try {
        const payload = new FormData();
        payload.append("code_interne", code);
        payload.append("force_regenerate", "true");

        const response = await fetch("/api/generate", {
          method: "POST",
          body: payload
        });
        const body = (await response.json()) as
          | {
              status?: "processing" | "error";
              error?: string;
            }
          | { error?: string };

        if (!response.ok) {
          throw new Error(body.error ?? "La regeneration a echoue.");
        }

        const refreshed = await fetch(`/api/fiche/${encodeURIComponent(code)}/status`);
        const refreshedBody = (await refreshed.json()) as
          | FicheStatusResponse
          | { error?: string };

        if (!refreshed.ok || isErrorResponse(refreshedBody)) {
          throw new Error(
            isErrorResponse(refreshedBody)
              ? refreshedBody.error ?? "Impossible de relire le statut."
              : "Impossible de relire le statut."
          );
        }

        setStatusData(refreshedBody);
        setData(null);
        setError(null);
        setSaveState("idle");
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : "La regeneration a echoue."
        );
      }
    });
  }

  const markdownLines = useMemo(
    () => (data?.markdown ? data.markdown.split(/\r?\n/) : []),
    [data?.markdown]
  );

  if (error) {
    return (
      <section className="panel">
        <div className="panel-inner">
          <div className="error-text">{error}</div>
        </div>
      </section>
    );
  }

  if (statusData?.status === "processing") {
    return (
      <section className="panel">
        <div className="panel-inner stack">
          <div className="actions">
            <span className="status-pill processing">{statusLabel(statusData.status)}</span>
            <span className="badge mono">{code}</span>
            {statusData.n8nExecutionId ? (
              <span className="meta">Execution n8n {statusData.n8nExecutionId}</span>
            ) : null}
          </div>

          <div className="callout info">
            Traitement en cours (Marker - anonymisation - Groq).
            {elapsedLabel ? ` Temps ecoule: ${elapsedLabel}.` : ""}
          </div>

          <div className="hint">
            Cette page se met a jour automatiquement toutes les 5 secondes.
          </div>
        </div>
      </section>
    );
  }

  if (statusData?.status === "error" && !data) {
    return (
      <section className="panel">
        <div className="panel-inner stack">
          <div className="actions">
            <span className="status-pill error">{statusLabel(statusData.status)}</span>
            <span className="badge mono">{code}</span>
            {statusData.n8nExecutionId ? (
              <span className="meta">Execution n8n {statusData.n8nExecutionId}</span>
            ) : null}
          </div>

          <div className="callout warning">
            {statusData.errorReason ?? "Le pipeline a echoue."}
            {statusData.errorStage ? ` Etape: ${statusData.errorStage}.` : ""}
          </div>

          <div className="actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void retryGeneration()}
              disabled={isPending}
            >
              {isPending ? "Relance..." : "Reessayer"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel">
        <div className="panel-inner">
          <div className="hint">Chargement de la fiche...</div>
        </div>
      </section>
    );
  }

  const isLocked = data.status.status !== "draft";
  const unresolvedCount = data.controle.resolutions.filter(
    (resolution) => resolution.status === "unresolved"
  ).length;
  const canValidate = data.status.status === "draft" && !isPending && unresolvedCount === 0;
  const extractionByKey = new Map(data.extraction.map((field) => [field.key, field] as const));
  const groupedExtraction = EXTRACTION_GROUP_ORDER.map((group) => ({
    group,
    fields: EXTRACTION_FIELD_DEFINITIONS.map((definition, index) => ({
      definition,
      field: extractionByKey.get(definition.key),
      index
    })).filter((entry) => entry.definition.group === group)
  }));

  return (
    <section className="panel">
      <div className="panel-inner stack">
        <div className="actions">
          <span className={`status-pill ${data.status.status}`}>{statusLabel(data.status.status)}</span>
          <span className="badge mono">{data.codeInterne}</span>
          <span className="meta">
            Creee le {new Date(data.status.createdAt).toLocaleString("fr-FR")}
          </span>
          {data.status.validatedAt ? (
            <span className="meta">
              Validee le {new Date(data.status.validatedAt).toLocaleString("fr-FR")}
            </span>
          ) : null}
        </div>

        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Markdown source</h3>
              <p className="meta">
                Affiche le contenu reel de <span className="mono">cdc.md</span> enregistre sur disque.
              </p>
            </div>
          </div>
          <div className="section-body">
            <details
              className="markdown-details"
              open={markdownOpen}
              onToggle={(event) =>
                setMarkdownOpen((event.currentTarget as HTMLDetailsElement).open)
              }
            >
              <summary className="markdown-summary">Voir le Markdown source</summary>
              {data.markdown && data.markdown.trim() ? (
                <div className="markdown-preview">
                  {markdownLines.map((line, index) => {
                    const isHighlighted = markdownHighlightIndex === index;
                    return (
                      <div
                        key={isHighlighted ? `${index}-${markdownFlashToken}` : `${index}`}
                        ref={(element) => {
                          markdownLineRefs.current[index] = element;
                        }}
                        className={isHighlighted ? "markdown-line markdown-line-highlight" : "markdown-line"}
                      >
                        {line || " "}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="callout warning">Aucun contenu Markdown trouve.</div>
              )}
            </details>
          </div>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>PDF source</h3>
              <p className="meta">
                Le PDF stocke peut etre consulte ici. Les sources actuelles n'incluent pas de numeros de page,
                donc le saut automatique restera exceptionnel tant que ces metadonnees ne sont pas presentes.
              </p>
            </div>
          </div>
          <div className="section-body">
            <PdfViewerPanel
              code={code}
              open={pdfOpen}
              onOpenChange={setPdfOpen}
              targetPage={pdfJumpPage}
              flashToken={pdfFlashToken}
            />
          </div>
        </section>

        {isLocked ? (
          <div className="callout warning">
            Cette fiche n'est editable que lorsqu'elle est en brouillon.
            Vous pouvez toujours la consulter, mais les champs restent verrouilles dans cet etat.
          </div>
        ) : null}

        {data.status.status === "error" ? (
          <div className="callout warning">
            {data.status.errorReason ?? "Le pipeline a echoue."}
            {data.status.errorStage ? ` Etape: ${data.status.errorStage}.` : ""}
            <div className="actions">
              <button
                className="button button-primary"
                type="button"
                onClick={() => void retryGeneration()}
                disabled={isPending}
              >
                {isPending ? "Relance..." : "Reessayer"}
              </button>
            </div>
          </div>
        ) : null}

        {saveState === "saved" ? (
          <div className="callout info">Brouillon sauvegarde.</div>
        ) : null}

        {saveState === "validated" ? (
          <div className="callout info">La fiche a bien ete validee.</div>
        ) : null}

        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Extraction</h3>
              <p className="meta">Chaque champ affiche sa source pour faciliter la confiance.</p>
            </div>
          </div>
          <div className="section-body">
            {data.extraction.length ? (
              groupedExtraction.map(({ group, fields }) => (
                <div className="stack" key={group}>
                  <div className="subsection-title">{group}</div>
                  {fields.map(({ field, index, definition }) => (
                    <div className="field-row" key={definition.key}>
                      <div className="field-topline">
                        <label htmlFor={`extraction-${definition.key}`} className="mono">
                          {definition.label}
                        </label>
                        {field?.source ? (
                          <>
                            <button
                              type="button"
                              className="badge source-badge"
                              title={field.source}
                              onClick={() => handleSourceJump(field)}
                            >
                              Source: {field.source}
                            </button>
                            {sourceFeedbackKey === field.key && sourceFeedbackMessage ? (
                              <span className="meta source-feedback">{sourceFeedbackMessage}</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="badge" title="Aucune source fournie">
                            Source absente
                          </span>
                        )}
                      </div>
                      <textarea
                        id={`extraction-${definition.key}`}
                        className="textarea"
                        value={field?.value ?? ""}
                        onChange={(event) => updateExtraction(index, event.target.value)}
                        disabled={isLocked || isPending}
                      />
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className="empty-note">Aucun champ d'extraction detecte.</div>
            )}
          </div>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Evaluation</h3>
              <p className="meta">Trois scores sur 5 accompagnes de leurs justifications.</p>
            </div>
          </div>
          <div className="section-body">
            {EVALUATION_FIELD_DEFINITIONS.map((definition, index) => {
              const field = data.evaluation[index];

              return (
                <div className="field-row" key={definition.key}>
                  <div className="field-topline">
                    <label htmlFor={`evaluation-score-${definition.key}`} className="mono">
                      {definition.label}
                    </label>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={`evaluation-score-${definition.key}`}>Note</label>
                      <select
                        id={`evaluation-score-${definition.key}`}
                        className="select"
                        value={field?.score ?? ""}
                        disabled={isLocked || isPending}
                        onChange={(event) =>
                          updateEvaluation(index, {
                            score: event.target.value ? Number(event.target.value) : null
                          })
                        }
                      >
                        <option value="">Selectionner</option>
                        {[1, 2, 3, 4, 5].map((score) => (
                          <option key={score} value={score}>
                            {score}
                          </option>
                        ))}
                      </select>
                    </div>
                    {definition.key === "risque_sous_dimensionnement" ? (
                      <div className="field">
                        <label htmlFor={`evaluation-charge-${definition.key}`}>charge_estimee</label>
                        <input
                          id={`evaluation-charge-${definition.key}`}
                          className="input"
                          value={field?.chargeEstimee ?? ""}
                          disabled={isLocked || isPending}
                          onChange={(event) =>
                            updateEvaluation(index, {
                              chargeEstimee: event.target.value
                            })
                          }
                        />
                      </div>
                    ) : null}
                    <div className="field">
                      <label htmlFor={`evaluation-justification-${definition.key}`}>
                        justification
                      </label>
                      <textarea
                        id={`evaluation-justification-${definition.key}`}
                        className="textarea"
                        value={field?.justification ?? ""}
                        disabled={isLocked || isPending}
                        onChange={(event) =>
                          updateEvaluation(index, {
                            justification: event.target.value
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Controle</h3>
              <p className="meta">
                Chaque alerte doit maintenant etre traitee avant la validation finale.
              </p>
            </div>
          </div>
          <div className="section-body stack">
            {CONTROL_SECTION_CONFIG.map((section) => (
              <ControlList
                key={section.key}
                title={section.title}
                section={section.key}
                items={section.getItems(data.controle)}
                resolutions={data.controle.resolutions}
                emptyLabel={section.emptyLabel}
                isLocked={isLocked}
                isPending={isPending}
                onUpdateResolution={updateResolution}
              />
            ))}
          </div>
        </section>

        <div className="actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => persist("PUT", `/api/fiche/${encodeURIComponent(code)}`)}
            disabled={isLocked || isPending}
          >
            {isPending ? "Sauvegarde..." : "Save draft"}
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => persist("POST", `/api/fiche/${encodeURIComponent(code)}/validate`)}
            disabled={!canValidate}
          >
            {isPending ? "Validation..." : "Validate"}
          </button>
        </div>

        {!isLocked && unresolvedCount > 0 ? (
          <div className="callout warning">
            Traitez les {unresolvedCount} element(s) de controle restant(s) avant de valider.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ControlList({
  title,
  section,
  items,
  resolutions,
  emptyLabel,
  isLocked,
  isPending,
  onUpdateResolution
}: {
  title: string;
  section: ControleResolutionSection;
  items: string[];
  resolutions: ControleResolution[];
  emptyLabel: string;
  isLocked: boolean;
  isPending: boolean;
  onUpdateResolution: (
    section: ControleResolutionSection,
    index: number,
    patch: Partial<Pick<ControleResolution, "status" | "comment">>
  ) => void;
}) {
  const resolutionByIndex = new Map(
    resolutions
      .filter((resolution) => resolution.section === section)
      .map((resolution) => [resolution.index, resolution] as const)
  );

  return (
    <div className="stack">
      <strong>{title}</strong>
      {items.length ? (
        <ul className="control-list">
          {items.map((item, index) => {
            const resolution = resolutionByIndex.get(index);
            const status = resolution?.status ?? "unresolved";
            const comment = resolution?.comment ?? "";

            return (
              <li key={`${section}-${index}`} className="control-item">
                <div className="control-item-text">{item}</div>
                <div className="control-item-tools">
                  <select
                    className="select control-select"
                    value={status}
                    disabled={isLocked || isPending}
                    onChange={(event) =>
                      onUpdateResolution(section, index, {
                        status: event.target.value as ControleResolutionStatus
                      })
                    }
                  >
                    {RESOLUTION_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {status === "commented" ? (
                    <input
                      className="input"
                      value={comment}
                      placeholder="Ajouter un commentaire"
                      disabled={isLocked || isPending}
                      onChange={(event) =>
                        onUpdateResolution(section, index, {
                          comment: event.target.value
                        })
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-note">{emptyLabel}</div>
      )}
    </div>
  );
}

function PdfViewerPanel({
  code,
  open,
  onOpenChange,
  targetPage,
  flashToken
}: {
  code: string;
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  targetPage: number | null;
  flashToken: number;
}) {
  const [pdfDocument, setPdfDocument] = useState<PdfDocumentLike | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      if (!open && targetPage == null) {
        return;
      }

      setIsPdfLoading(true);
      setPdfError(null);

      try {
        // Loaded from /public to avoid Next dev bundling issues with pdfjs-dist.
        const loadPdfJs = new Function(
          "return import('/pdfjs/pdf.mjs');"
        ) as () => Promise<PdfJsModuleLike>;
        const pdfjs = await loadPdfJs();
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.mjs";

        const documentTask = pdfjs.getDocument({
          url: `/api/fiche/${encodeURIComponent(code)}/pdf`,
          cMapUrl: "/pdfjs/cmaps/",
          standardFontDataUrl: "/pdfjs/standard_fonts/"
        });
        const nextDocument = await documentTask.promise;

        if (!cancelled) {
          setPdfDocument(nextDocument);
          setCurrentPage((page) => Math.min(Math.max(page, 1), nextDocument.numPages));
        }
      } catch (error) {
        if (!cancelled) {
          setPdfError(
            error instanceof Error ? error.message : "Impossible de charger le PDF."
          );
        }
      } finally {
        if (!cancelled) {
          setIsPdfLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
    };
  }, [code, open, targetPage]);

  useEffect(() => {
    if (!pdfDocument || targetPage == null) {
      return;
    }

    const boundedPage = Math.min(Math.max(targetPage, 1), pdfDocument.numPages);
    setCurrentPage(boundedPage);
    setPageInput(String(boundedPage));
  }, [pdfDocument, targetPage, flashToken]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!pdfDocument || !canvasRef.current) {
        return;
      }

      const canvas = canvasRef.current;
      const page = await pdfDocument.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.2 });
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport
      }).promise;

      if (cancelled) {
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [currentPage, pdfDocument]);

  function clampPage(nextPage: number) {
    if (!pdfDocument) {
      return 1;
    }

    return Math.min(Math.max(nextPage, 1), pdfDocument.numPages);
  }

  function goToPage(nextPage: number) {
    const boundedPage = clampPage(nextPage);
    setCurrentPage(boundedPage);
    setPageInput(String(boundedPage));
  }

  return (
    <details
      className="pdf-details"
      open={open}
      onToggle={(event) => onOpenChange((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="markdown-summary">Voir le PDF source</summary>

      <div className="pdf-panel">
        <div className="actions pdf-toolbar">
          <button
            className="button button-ghost"
            type="button"
            onClick={() => goToPage(currentPage - 1)}
            disabled={!pdfDocument || currentPage <= 1}
          >
            Page precedente
          </button>
          <span className="meta">
            Page {currentPage}
            {pdfDocument ? ` / ${pdfDocument.numPages}` : ""}
          </span>
          <button
            className="button button-ghost"
            type="button"
            onClick={() => goToPage(currentPage + 1)}
            disabled={!pdfDocument || currentPage >= pdfDocument.numPages}
          >
            Page suivante
          </button>
          <label className="pdf-page-input">
            <span className="meta">Aller a la page</span>
            <input
              className="input"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  goToPage(Number(pageInput));
                }
              }}
            />
          </label>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => goToPage(Number(pageInput))}
            disabled={!pdfDocument}
          >
            Ouvrir
          </button>
        </div>

        {isPdfLoading ? <div className="hint">Chargement du PDF...</div> : null}
        {pdfError ? <div className="callout warning">{pdfError}</div> : null}

        <div
          className="pdf-canvas-shell"
          key={flashToken ? `pdf-shell-${flashToken}` : "pdf-shell"}
        >
          <canvas ref={canvasRef} className="pdf-canvas" />
        </div>
      </div>
    </details>
  );
}
