import type { ExtractionField } from "../types.ts";

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  "février": "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  "août": "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  "décembre": "12"
};

function isValidCalendarDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export type DeadlineSemanticState =
  | "CONFIRMED"
  | "NOT_FOUND"
  | "PENDING_CONFIRMATION"
  | "AMBIGUOUS";

export type DeadlinePresentation = {
  state: DeadlineSemanticState;
  rawValue: string;
  parsedDate: string | null;
  helperText: string;
};

const DEADLINE_HELPERS: Record<DeadlineSemanticState, string> = {
  CONFIRMED: "Date extraite du CDC.",
  NOT_FOUND: "Aucune date limite de dépôt n’a été identifiée dans le CDC.",
  PENDING_CONFIRMATION: "La date limite de dépôt n’est pas encore définie dans le CDC.",
  AMBIGUOUS: "Plusieurs dates possibles ont été détectées. Vérification nécessaire."
};

function normalizeForDeadlineSemantics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function collectDeadlineCandidates(value: string) {
  const candidates = new Set<string>();
  const add = (year: string, month: string, day: string) => {
    const paddedMonth = month.padStart(2, "0");
    const paddedDay = day.padStart(2, "0");
    if (isValidCalendarDate(year, paddedMonth, paddedDay)) {
      candidates.add(`${year}-${paddedMonth}-${paddedDay}`);
    }
  };

  for (const match of value.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    add(match[1], match[2], match[3]);
  }
  for (const match of value.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) {
    add(match[3], match[2], match[1]);
  }
  for (const match of value.matchAll(
    /\b(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})\b/gi
  )) {
    const month = FRENCH_MONTHS[match[2].toLowerCase()];
    if (month) add(match[3], month, match[1]);
  }
  return [...candidates];
}

export function deriveDeadlinePresentation(raw: string | null | undefined): DeadlinePresentation {
  const rawValue = raw?.trim() ?? "";
  const normalized = normalizeForDeadlineSemantics(rawValue);
  const finish = (state: DeadlineSemanticState, parsedDate: string | null = null) => ({
    state,
    rawValue,
    parsedDate,
    helperText: DEADLINE_HELPERS[state]
  });

  if (!normalized || /^(non trouve|non renseigne|n\/?a|aucun|absent)$/.test(normalized)) {
    return finish("NOT_FOUND");
  }
  const candidates = collectDeadlineCandidates(rawValue);
  if (candidates.length > 1) return finish("AMBIGUOUS");
  if (/\b(a confirmer|a definir|tbd|sera communique[e]? ulterieurement|communique[e]? plus tard|pas encore definie?)\b/.test(normalized)) {
    return finish("PENDING_CONFIRMATION");
  }

  const mentionsSubmission = /\b(depot|soumission|proposition|offre)s?\b/.test(normalized);
  const onlyUnrelatedContext = /\b(emission|publication|publiee?|clarification|visite|ouverture|demarrage|debut du contrat)\b/.test(normalized)
    && !mentionsSubmission;
  if (onlyUnrelatedContext) return finish("NOT_FOUND");
  if (candidates.length === 1) return finish("CONFIRMED", candidates[0]);
  return finish("AMBIGUOUS");
}

export function parseExtractedDeadline(raw: string | null | undefined) {
  const presentation = deriveDeadlinePresentation(raw);
  return presentation.state === "CONFIRMED" ? presentation.parsedDate : null;
}

export function normalizeExtractedOptionalText(raw: string | null | undefined) {
  const value = raw?.trim();
  if (!value) return null;

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return normalized === "non trouve" ? null : value;
}

export function pickIdentityFieldsFromExtraction(extraction: ExtractionField[]) {
  const find = (key: string) => extraction.find((field) => field.key === key)?.value ?? null;
  return {
    title: find("intitule_mission"),
    buyer: find("client_maitre_ouvrage"),
    country: find("pays"),
    deadline: find("date_limite_depot"),
    reference: find("reference_officielle")
  };
}

export type ExtractionIdentityPreviewField = { value: string; detected: boolean };
export type ExtractionIdentityPreview = {
  title: ExtractionIdentityPreviewField;
  buyer: ExtractionIdentityPreviewField;
  country: ExtractionIdentityPreviewField;
  reference: ExtractionIdentityPreviewField;
  dueDate: ExtractionIdentityPreviewField & DeadlinePresentation;
};

export function buildExtractionIdentityPreview(
  extraction: ExtractionField[]
): ExtractionIdentityPreview {
  const raw = pickIdentityFieldsFromExtraction(extraction);
  const deadline = deriveDeadlinePresentation(raw.deadline);
  const asField = (value: string | null): ExtractionIdentityPreviewField => {
    const normalized = normalizeExtractedOptionalText(value);
    return { value: normalized ?? "", detected: normalized != null };
  };

  return {
    title: asField(raw.title),
    buyer: asField(raw.buyer),
    country: asField(raw.country),
    reference: asField(raw.reference),
    dueDate: {
      value: deadline.rawValue,
      detected: deadline.state === "CONFIRMED",
      ...deadline
    }
  };
}

export type DossierIdentity = {
  code: string;
  title: string;
  buyer: string;
  country: string;
  dueDate: string;
  reference: string;
};

export function prefillDraftDossierIdentity<T extends DossierIdentity>(
  dossier: T,
  extraction: ExtractionField[],
  ficheStatus: "draft" | "validated"
): T {
  // A validated Fiche must never change the editor implicitly. Draft values
  // remain suggestions until the Commercial explicitly saves or validates.
  if (ficheStatus !== "draft") return dossier;

  const preview = buildExtractionIdentityPreview(extraction);
  const titleIsReplaceable =
    !dossier.title.trim() || dossier.title.trim().toLowerCase() === dossier.code.trim().toLowerCase();

  return {
    ...dossier,
    title: titleIsReplaceable && preview.title.detected ? preview.title.value : dossier.title,
    buyer: !dossier.buyer.trim() && preview.buyer.detected ? preview.buyer.value : dossier.buyer,
    country:
      !dossier.country.trim() && preview.country.detected ? preview.country.value : dossier.country,
    dueDate:
      !dossier.dueDate.trim() && preview.dueDate.parsedDate
        ? preview.dueDate.parsedDate
        : dossier.dueDate,
    reference:
      !dossier.reference.trim() && preview.reference.detected
        ? preview.reference.value
        : dossier.reference
  };
}
