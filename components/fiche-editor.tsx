"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertIcon } from "@/components/app-icons.tsx";
import { CdcProcessingPanel } from "@/components/cdc-processing-panel.tsx";
import type { AppelOffresDetail } from "@/lib/appels-offres/types.ts";
import {
  deriveDeadlinePresentation,
  prefillDraftDossierIdentity,
  type DeadlinePresentation
} from "@/lib/appels-offres/extraction-identity.ts";
import { deriveCdcProcessingPresentation } from "@/lib/appels-offres/cdc-processing-presentation.ts";
import { StatusBadge } from "@/components/status-badge.tsx";
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
  appel: AppelOffresDetail;
  readOnly?: boolean;
  onReviewStateChange?: (state: "saved" | "validated" | null) => void;
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

type DossierFormState = {
  code: string;
  title: string;
  buyer: string;
  country: string;
  dueDate: string;
  responsableCommercial: string;
  priorite: AppelOffresDetail["priorite"];
  reference: string;
  notes: string;
};

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

const DOCUMENT_SECTION_ORDER = [
  "informations_generales",
  "client_et_projet",
  "donnees_commerciales",
  "besoins_techniques",
  "contraintes",
  "delais"
] as const;

const DOCUMENT_SECTION_TITLES: Record<(typeof DOCUMENT_SECTION_ORDER)[number], string> = {
  informations_generales: "Informations generales",
  client_et_projet: "Client et projet",
  donnees_commerciales: "Cadre commercial",
  besoins_techniques: "Besoins techniques",
  contraintes: "Contraintes",
  delais: "Delais"
};

const EXTRACTION_SECTION_BY_KEY: Record<
  ExtractionField["key"],
  (typeof DOCUMENT_SECTION_ORDER)[number]
> = {
  reference_officielle: "informations_generales",
  intitule_mission: "informations_generales",
  secteur: "informations_generales",
  nature_prestation: "informations_generales",
  client_maitre_ouvrage: "client_et_projet",
  pays: "client_et_projet",
  zone_execution: "client_et_projet",
  projet_rattachement: "client_et_projet",
  source_financement: "client_et_projet",
  credit_financement: "client_et_projet",
  type_procedure: "donnees_commerciales",
  methode_selection: "donnees_commerciales",
  type_proposition: "donnees_commerciales",
  type_contrat: "donnees_commerciales",
  langue_offre: "donnees_commerciales",
  ponderation_technique_financiere: "donnees_commerciales",
  note_technique_minimale: "donnees_commerciales",
  duree_totale: "delais",
  date_emission: "delais",
  date_limite_depot: "delais",
  volume_hommes_mois: "besoins_techniques",
  nombre_profils_experts: "besoins_techniques",
  phases_mission: "besoins_techniques",
  livrables_principaux: "besoins_techniques",
  nombre_livrables_structurants: "besoins_techniques",
  profils_cles: "besoins_techniques",
  disciplines_techniques: "besoins_techniques",
  outils_methodes: "besoins_techniques",
  moyens_materiels: "besoins_techniques",
  points_techniques_structurants: "besoins_techniques",
  nombre_sites: "contraintes",
  contraintes_site: "contraintes",
  exigences_es: "contraintes",
  normes_referentiels: "contraintes"
};

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
      return "En cours de generation";
    case "validated":
      return "Validee";
    case "error":
      return "Erreur de traitement";
    default:
      return "A verifier";
  }
}

function statusTone(status: FicheResponse["status"]["status"]) {
  switch (status) {
    case "processing":
      return "ai" as const;
    case "validated":
      return "success" as const;
    case "error":
      return "danger" as const;
    default:
      return "warning" as const;
  }
}

function humanizeIdentifierLabel(value: string) {
  const normalized = value.replace(/_/g, " ").trim();
  if (!normalized) {
    return value;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getFieldReviewState({
  value,
  initialValue,
  ficheStatus
}: {
  value: string;
  initialValue: string;
  ficheStatus: FicheResponse["status"]["status"];
}) {
  if (ficheStatus === "validated") {
    return { label: "Valide", tone: "success" as const };
  }

  if (!value.trim()) {
    return { label: "Non renseigne", tone: "neutral" as const };
  }

  if (value !== initialValue) {
    return { label: "Modifie", tone: "warning" as const };
  }

  return { label: "Genere", tone: "ai" as const };
}

function createDossierFormState(appel: AppelOffresDetail): DossierFormState {
  return {
    code: appel.code,
    title: appel.title,
    buyer: appel.buyer,
    country: appel.country,
    dueDate: appel.dueDate ?? "",
    responsableCommercial: appel.responsableCommercial,
    priorite: appel.priorite,
    reference: appel.reference,
    notes: appel.notes
  };
}

function hasDossierChanges(current: DossierFormState, baseline: DossierFormState) {
  return (
    current.title !== baseline.title ||
    current.buyer !== baseline.buyer ||
    current.country !== baseline.country ||
    current.dueDate !== baseline.dueDate ||
    current.responsableCommercial !== baseline.responsableCommercial ||
    current.priorite !== baseline.priorite ||
    current.reference !== baseline.reference ||
    current.notes !== baseline.notes
  );
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

function getUnavailableReason(errorStage: string | null, errorReason: string | null) {
  if (errorStage === "upload") {
    return "Le document source n'a pas pu etre prepare pour l'analyse.";
  }

  if (
    errorStage &&
    ["webhook", "marker", "markdown", "anonymization", "llm", "xml", "callback"].includes(
      errorStage
    )
  ) {
    return "L'analyse a ete interrompue avant la fin du traitement.";
  }

  if (errorReason && /(annul|cancel|interromp)/i.test(errorReason)) {
    return "L'analyse a ete interrompue avant la fin du traitement.";
  }

  return null;
}

function FicheUnavailableState({
  isError,
  errorStage,
  errorReason,
  isPending,
  onRetry
}: {
  isError: boolean;
  errorStage: string | null;
  errorReason: string | null;
  isPending: boolean;
  onRetry: () => void;
}) {
  const reason = isError ? getUnavailableReason(errorStage, errorReason) : null;

  return (
    <section className="panel fiche-document-panel">
      <div className="panel-inner stack fiche-editor-stack fiche-unavailable-stack">
        <div className="fiche-document-intro fiche-unavailable-intro">
          <div className="fiche-unavailable-header">
            <div className={`fiche-unavailable-icon${isError ? " is-error" : ""}`} aria-hidden="true">
              <AlertIcon className="upload-icon" />
            </div>
          <div className="fiche-unavailable-copy">
  <h3>
    {isError
      ? "Le traitement du CDC a été interrompu."
      : "La Fiche CDC est en cours de génération"}
  </h3>

  <p className="meta">
    {isError
      ? "Le document n'a pas pu être traité correctement."
      : "L'analyse du CDC est en cours. La fiche sera disponible automatiquement à la fin du traitement."}
  </p>

  {reason ? (
    <p className="meta fiche-unavailable-reason">{reason}</p>
  ) : null}
</div>
          </div>
        </div>

        {isError ? (
  <div className="actions fiche-unavailable-actions">
    <button
      className="button button-primary"
      type="button"
      onClick={onRetry}
      disabled={isPending}
    >
      {isPending ? "Relance..." : "Réessayer l'analyse"}
    </button>
  </div>
) : null}

<div className="fiche-unavailable-explainer">
  <p>
    {isError
      ? "Après une nouvelle analyse réussie, vous pourrez vérifier, compléter et valider la Fiche CDC."
      : "Les informations extraites apparaîtront ici dès que l'analyse sera terminée."}
  </p>
</div>
      </div>
    </section>
  );
}

function DossierFieldsSection({
  form,
  deadlinePresentation,
  isLocked,
  isPending,
  onUpdateField
}: {
  form: DossierFormState;
  deadlinePresentation: DeadlinePresentation;
  isLocked: boolean;
  isPending: boolean;
  onUpdateField: <Key extends keyof DossierFormState>(
    key: Key,
    value: DossierFormState[Key]
  ) => void;
}) {
  return (
    <div className="stack fiche-document-section">
      <div className="subsection-title">Informations du dossier</div>
      <div className="fiche-dossier-groups">
        <div className="stack fiche-document-subsection">
          <div className="fiche-section-heading">General</div>
          <div className="form-grid fiche-dossier-grid">
            <div className="field">
              <label htmlFor="fiche-dossier-code">Code interne</label>
              <input
                id="fiche-dossier-code"
                className="input mono"
                value={form.code}
                readOnly
                disabled
              />
            </div>
            <div className="field">
              <label htmlFor="fiche-dossier-title">Intitule de l'appel d'offres</label>
              <input
                id="fiche-dossier-title"
                className="input"
                value={form.title}
                disabled={isLocked || isPending}
                onChange={(event) => onUpdateField("title", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="fiche-dossier-buyer">Client</label>
              <input
                id="fiche-dossier-buyer"
                className="input"
                value={form.buyer}
                disabled={isLocked || isPending}
                onChange={(event) => onUpdateField("buyer", event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="fiche-dossier-country">Pays</label>
              <input
                id="fiche-dossier-country"
                className="input"
                value={form.country}
                disabled={isLocked || isPending}
                onChange={(event) => onUpdateField("country", event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="stack fiche-document-subsection">
          <div className="fiche-section-heading">Pilotage</div>
          <div className="form-grid fiche-dossier-grid">
            <div className="field">
              <label htmlFor="fiche-dossier-owner">Responsable commercial</label>
              <input
                id="fiche-dossier-owner"
                className="input"
                value={form.responsableCommercial}
                disabled={isLocked || isPending}
                onChange={(event) =>
                  onUpdateField("responsableCommercial", event.target.value)
                }
              />
            </div>
            <div className="field">
              <label htmlFor="fiche-dossier-priority">Priorite</label>
              <select
                id="fiche-dossier-priority"
                className="select"
                value={form.priorite}
                disabled={isLocked || isPending}
                onChange={(event) =>
                  onUpdateField(
                    "priorite",
                    event.target.value as AppelOffresDetail["priorite"]
                  )
                }
              >
                <option value="basse">Basse</option>
                <option value="normale">Normale</option>
                <option value="haute">Haute</option>
                <option value="critique">Critique</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="fiche-dossier-due-date">Date limite</label>
              <input
                id="fiche-dossier-due-date"
                className="input"
                type="date"
                value={form.dueDate}
                disabled={isLocked || isPending}
                onChange={(event) => onUpdateField("dueDate", event.target.value)}
              />
              {!form.dueDate ? (
                <span className="hint">{deadlinePresentation.helperText}</span>
              ) : deadlinePresentation.state === "CONFIRMED" ? (
                <span className="hint">{deadlinePresentation.helperText}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="stack fiche-document-subsection">
          <div className="fiche-section-heading">References</div>
          <div className="form-grid fiche-dossier-grid">
            <div className="field">
              <label htmlFor="fiche-dossier-reference">Reference ou description courte</label>
              <input
                id="fiche-dossier-reference"
                className="input"
                value={form.reference}
                disabled={isLocked || isPending}
                onChange={(event) => onUpdateField("reference", event.target.value)}
              />
            </div>
            <div className="field field-span-full">
              <label htmlFor="fiche-dossier-notes">Notes internes</label>
              <textarea
                id="fiche-dossier-notes"
                className="textarea"
                value={form.notes}
                disabled={isLocked || isPending}
                onChange={(event) => onUpdateField("notes", event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FicheEditor({ code, appel, readOnly = false, onReviewStateChange }: Props) {
  const router = useRouter();
  const [data, setData] = useState<FicheResponse | null>(null);
  const [statusData, setStatusData] = useState<FicheStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [isPending, startTransition] = useTransition();
  const [dossierForm, setDossierForm] = useState<DossierFormState>(() =>
    createDossierFormState(appel)
  );
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [markdownHighlightIndex, setMarkdownHighlightIndex] = useState<number | null>(null);
  const [markdownFlashToken, setMarkdownFlashToken] = useState(0);
  const [sourceFeedbackKey, setSourceFeedbackKey] = useState<string | null>(null);
  const [sourceFeedbackMessage, setSourceFeedbackMessage] = useState<string | null>(null);
  const [pdfJumpPage, setPdfJumpPage] = useState<number | null>(null);
  const [pdfFlashToken, setPdfFlashToken] = useState(0);
  const markdownLineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const initialExtractionRef = useRef<Map<string, string>>(new Map());
  const initialDossierRef = useRef<DossierFormState>(createDossierFormState(appel));

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    async function fetchStatus() {
      const response = await fetch(`/api/fiche/${encodeURIComponent(code)}/status`);
      const body = (await response.json()) as FicheStatusResponse | { error: string };

      if (!active) {
        return;
      }

      if (response.status === 404) {
        setStatusData(null);
        setData(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      if (!response.ok || isErrorResponse(body)) {
        setError("Impossible de charger cette fiche.");
        setIsLoading(false);
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
          setIsLoading(false);
          return;
        }

        setData(ficheBody);
        initialExtractionRef.current = new Map(
          ficheBody.extraction.map((field) => [field.key, field.value])
        );
        setError(null);
        setIsLoading(false);
        return;
      }

      setData(null);
      setError(null);
      setIsLoading(false);
    }

    void fetchStatus();

    return () => {
      active = false;
    };
  }, [code]);

  useEffect(() => {
    const nextState = createDossierFormState(appel);
    setDossierForm(nextState);
    initialDossierRef.current = nextState;
  }, [
    appel.code,
    appel.title,
    appel.buyer,
    appel.country,
    appel.dueDate,
    appel.responsableCommercial,
    appel.priorite,
    appel.reference,
    appel.notes
  ]);

  useEffect(() => {
    if (!data || data.status.status !== "draft") {
      return;
    }

    setDossierForm((current) =>
      prefillDraftDossierIdentity(current, data.extraction, "draft")
    );
  }, [data]);

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
          initialExtractionRef.current = new Map(
            ficheBody.extraction.map((field) => [field.key, field.value])
          );
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
    onReviewStateChange?.(null);
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
    onReviewStateChange?.(null);
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
    onReviewStateChange?.(null);
  }

  function updateDossierField<Key extends keyof DossierFormState>(
    key: Key,
    value: DossierFormState[Key]
  ) {
    setDossierForm((current) => ({
      ...current,
      [key]: value
    }));
    setSaveState("idle");
    onReviewStateChange?.(null);
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

  async function persistDossier(current: DossierFormState) {
    const payload = new FormData();
    payload.append("code", current.code);
    payload.append("title", current.title.trim());
    payload.append("reference", current.reference.trim());
    payload.append("buyer", current.buyer.trim());
    payload.append("country", current.country.trim());
    payload.append("dueDate", current.dueDate.trim());
    payload.append("notes", current.notes.trim());
    payload.append("priorite", current.priorite);
    payload.append("responsable_commercial", current.responsableCommercial.trim());

    const response = await fetch(`/api/appels-offres/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: payload
    });
    const body = (await response.json()) as AppelOffresDetail | { error?: string };

    if (!response.ok || isErrorResponse(body)) {
      throw new Error(
        isErrorResponse(body)
          ? body.error ?? "La sauvegarde du dossier a echoue."
          : "La sauvegarde du dossier a echoue."
      );
    }

    return body;
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
    if (method === "POST" && !data) {
      return;
    }

    const snapshot = data;
    const dossierSnapshot = dossierForm;
    const shouldPersistDossier = hasDossierChanges(dossierSnapshot, initialDossierRef.current);

    startTransition(async () => {
      let dossierSaved = false;
      let ficheSaved = false;

      try {
        if (!dossierSnapshot.title.trim()) {
          throw new Error("L'intitule de l'appel d'offres est obligatoire.");
        }

        if (shouldPersistDossier) {
          const savedDossier = await persistDossier(dossierSnapshot);
          const nextDossierState = createDossierFormState(savedDossier);
          setDossierForm(nextDossierState);
          initialDossierRef.current = nextDossierState;
          dossierSaved = true;
        }

        if (!snapshot) {
          setError(null);
          setSaveState("saved");
          onReviewStateChange?.("saved");
          router.refresh();
          return;
        }

        if (method === "PUT") {
          const saved = await persistDraft(snapshot);
          setData(saved);
          initialExtractionRef.current = new Map(
            saved.extraction.map((field) => [field.key, field.value])
          );
          ficheSaved = true;
          setError(null);
          setSaveState("saved");
          onReviewStateChange?.("saved");
          router.refresh();
          return;
        }

        const saved = await persistDraft(snapshot);
        ficheSaved = true;
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
        initialExtractionRef.current = new Map(
          body.extraction.map((field) => [field.key, field.value])
        );
        setError(null);
        setSaveState("validated");
        onReviewStateChange?.("validated");
        router.refresh();
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : "L'operation a echoue.";

        if (dossierSaved && !ficheSaved) {
          setError(
            `Les informations du dossier ont ete enregistrees, mais la Fiche CDC n'a pas pu etre sauvegardee. ${message}`
          );
          router.refresh();
          return;
        }

        if (dossierSaved && ficheSaved && method === "POST") {
          setError(
            `Les modifications ont ete enregistrees, mais la validation finale a echoue. ${message}`
          );
          router.refresh();
          return;
        }

        setError(message);
      }
    });
  }

  function handleValidate() {
    if (!window.confirm("Confirmer la validation finale de la Fiche CDC ?")) {
      return;
    }

    void persist("POST", `/api/fiche/${encodeURIComponent(code)}/validate`);
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
        onReviewStateChange?.(null);
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

  if (isLoading) {
    return (
      <section className="panel">
        <div className="panel-inner">
          <div className="hint">Chargement de la fiche...</div>
        </div>
      </section>
    );
  }

  if (statusData?.status === "processing") {
    const processingPresentation = deriveCdcProcessingPresentation(appel);
    return (
      <section className="panel">
        <div className="panel-inner stack fiche-processing-state">
          <CdcProcessingPanel
            state="processing"
            step={processingPresentation.step}
            startedAt={statusData.processingStartedAt ?? processingPresentation.startedAt}
            isLongRunning={processingPresentation.isLongRunning}
            readyHref={`/appels-offres/${encodeURIComponent(code)}/fiche-cdc`}
          />
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <FicheUnavailableState
        isError={statusData?.status === "error"}
        errorStage={statusData?.errorStage ?? null}
        errorReason={statusData?.errorReason ?? null}
        isPending={isPending}
        onRetry={() => void retryGeneration()}
      />
    );
  }

  if (data.status.status === "error") {
    return (
      <FicheUnavailableState
        isError
        errorStage={data.status.errorStage ?? null}
        errorReason={data.status.errorReason ?? null}
        isPending={isPending}
        onRetry={() => void retryGeneration()}
      />
    );
  }

  const isLocked = readOnly || data.status.status !== "draft";
  const unresolvedCount = data.controle.resolutions.filter(
    (resolution) => resolution.status === "unresolved"
  ).length;
  const canValidate = data.status.status === "draft" && !isPending && unresolvedCount === 0;
  const extractionEntries = new Map(
    data.extraction.map((field, index) => [field.key, { field, index }] as const)
  );
  const deadlinePresentation = deriveDeadlinePresentation(
    extractionEntries.get("date_limite_depot")?.field.value
  );
  const groupedExtraction = DOCUMENT_SECTION_ORDER.map((section) => ({
    section,
    fields: EXTRACTION_FIELD_DEFINITIONS.map((definition) => ({
      definition,
      entry: extractionEntries.get(definition.key)
    })).filter((item) => EXTRACTION_SECTION_BY_KEY[item.definition.key] === section)
  }));
  const ficheHeaderTitle =
    data.status.status === "validated" ? "Fiche CDC validee" : "Fiche CDC generee par l'IA";
  const ficheHeaderDescription =
    data.status.status === "validated"
      ? "La fiche a ete validee. Elle reste consultable pour reference."
      : "Verifiez les informations extraites, corrigez ou completez les champs si necessaire, puis validez la fiche.";
  const modifiedAtLabel = data.status.modifiedAt
    ? `Derniere mise a jour le ${new Date(data.status.modifiedAt).toLocaleString("fr-FR")}`
    : null;

  return (
    <section className="panel fiche-document-panel">
      <div className="panel-inner stack fiche-editor-stack">
        <div className="fiche-document-intro">
          <div className="fiche-document-copy">
            <span className="card-kicker">
              {data.status.status === "validated"
                ? "Document valide"
                : "Version initiale generee par l'IA"}
            </span>
            <h3>{ficheHeaderTitle}</h3>
            <p className="meta">{ficheHeaderDescription}</p>
          </div>
          <div className="fiche-document-meta">
            <StatusBadge
              label={statusLabel(data.status.status)}
              tone={statusTone(data.status.status)}
            />
            <span className="meta">
              Creee le {new Date(data.status.createdAt).toLocaleString("fr-FR")}
            </span>
            {modifiedAtLabel ? <span className="meta">{modifiedAtLabel}</span> : null}
            {data.status.validatedAt ? (
              <span className="meta">
                Validee le {new Date(data.status.validatedAt).toLocaleString("fr-FR")}
              </span>
            ) : null}
          </div>
        </div>

        {isLocked ? (
          <div className="fiche-inline-feedback fiche-inline-feedback-readonly">
            Cette Fiche CDC est maintenant en lecture seule. Les informations validees restent consultables.
          </div>
        ) : null}

        <section className="section-card fiche-document-shell">
          <div className="section-body stack fiche-document-body">
            <DossierFieldsSection
              form={dossierForm}
              deadlinePresentation={deadlinePresentation}
              isLocked={isLocked}
              isPending={isPending}
              onUpdateField={updateDossierField}
            />

            <div className="stack fiche-document-section">
              <div className="subsection-title">Informations extraites par l'IA</div>
              <p className="meta fiche-section-description">
                Verifiez les informations extraites du CDC, corrigez-les ou completez-les si necessaire.
              </p>
              {data.extraction.length ? (
                groupedExtraction.map(({ section, fields }) => (
                  <div className="stack fiche-document-subsection" key={section}>
                    <div className="fiche-section-heading">
                      {DOCUMENT_SECTION_TITLES[section]}
                    </div>
                    {fields.map(({ entry, definition }) => {
                      const field = entry?.field;
                      const index = entry?.index ?? -1;
                      const reviewState = getFieldReviewState({
                        value: field?.value ?? "",
                        initialValue: initialExtractionRef.current.get(definition.key) ?? "",
                        ficheStatus: data.status.status
                      });

                      return (
                        <article className="fiche-review-field" key={definition.key}>
                          <div className="field-topline">
                            <label htmlFor={`extraction-${definition.key}`} className="mono">
                              {humanizeIdentifierLabel(definition.label)}
                            </label>
                            <StatusBadge label={reviewState.label} tone={reviewState.tone} />
                          </div>

                          <div className="fiche-review-field-actions">
                            {field?.source ? (
                              <>
                                <button
                                  type="button"
                                  className="badge source-badge"
                                  title={field.source}
                                  onClick={() => handleSourceJump(field)}
                                >
                                  Source : {field.source}
                                </button>
                                {sourceFeedbackKey === field.key && sourceFeedbackMessage ? (
                                  <span className="meta source-feedback">
                                    {sourceFeedbackMessage}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="badge" title="Aucune source fournie">
                                Aucune source fournie
                              </span>
                            )}
                          </div>

                          {!field?.value.trim() ? (
                            <div className="empty-inline-note">Aucune information detectee</div>
                          ) : null}

                          <textarea
                            id={`extraction-${definition.key}`}
                            className="textarea"
                            value={field?.value ?? ""}
                            onChange={(event) => updateExtraction(index, event.target.value)}
                            disabled={isLocked || isPending}
                            placeholder="Ajouter une valeur"
                          />
                        </article>
                      );
                    })}
                  </div>
                ))
              ) : (
                <div className="empty-note">Aucun champ d'extraction detecte.</div>
              )}
            </div>

            <div className="stack fiche-document-section">
              <div className="subsection-title">Donnees commerciales</div>
              {EVALUATION_FIELD_DEFINITIONS.map((definition, index) => {
                const field = data.evaluation[index];

                return (
                  <div className="field-row fiche-evaluation-field" key={definition.key}>
                    <div className="field-topline">
                      <label htmlFor={`evaluation-score-${definition.key}`} className="mono">
                        {humanizeIdentifierLabel(definition.label)}
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
                          <label htmlFor={`evaluation-charge-${definition.key}`}>
                            Charge estimee
                          </label>
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
                          Justification
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

            <div className="stack fiche-document-section">
              <div className="subsection-title">Contraintes et points a verifier</div>
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
          </div>
        </section>

        <details className="workspace-disclosure fiche-sources-disclosure">
          <summary className="markdown-summary">Sources et remarques IA</summary>
          <div className="workspace-disclosure-body stack">
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
                        className={
                          isHighlighted
                            ? "markdown-line markdown-line-highlight"
                            : "markdown-line"
                        }
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

            <div className="stack">
              <div>
                <strong>PDF source</strong>
                <p className="meta">
                  Le PDF du CDC reste consultable pour verifier les informations extraites.
                </p>
              </div>
              <PdfViewerPanel
                code={code}
                open={pdfOpen}
                onOpenChange={setPdfOpen}
                targetPage={pdfJumpPage}
                flashToken={pdfFlashToken}
              />
            </div>
          </div>
        </details>

        <div className="fiche-document-footer">
          {!isLocked ? (
            <div className="actions fiche-document-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => persist("PUT", `/api/fiche/${encodeURIComponent(code)}`)}
                disabled={isLocked || isPending}
              >
                {isPending ? "Sauvegarde..." : "Enregistrer les modifications"}
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={handleValidate}
                disabled={!canValidate}
              >
                {isPending ? "Validation..." : "Valider la Fiche CDC"}
              </button>
            </div>
          ) : null}

          <div className="fiche-document-footer-meta">
            {saveState === "saved" ? (
              <span className="fiche-inline-feedback">Modifications enregistrees</span>
            ) : null}
            {saveState === "validated" ? (
              <span className="fiche-inline-feedback">Fiche CDC validee</span>
            ) : null}
            {!isLocked && unresolvedCount > 0 ? (
              <span className="meta">
                Traitez les {unresolvedCount} element(s) de controle restant(s) avant de valider.
              </span>
            ) : null}
          </div>
        </div>
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
