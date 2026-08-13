// Local, deterministic, regex-based pseudonymisation. Runs entirely in the
// caller's process (browser or a plain function call in tests) - no network
// call, no external AI provider, no database access. Detected values are
// replaced by stable aliases (e.g. PERSONNE_001) so the mapping can be
// reviewed before sharing text with an external AI service.

export type PseudonymisationCategory =
  | "PERSONNE"
  | "EMAIL"
  | "TELEPHONE"
  | "ORGANISATION"
  | "ADRESSE"
  | "REFERENCE"
  | "CONTRAT";

export type PseudonymisationDetection = {
  key: string;
  category: PseudonymisationCategory;
  originalValue: string;
  alias: string;
  occurrences: number;
  included: boolean;
};

export type PseudonymisationResult = {
  pseudonymisedText: string;
  detections: PseudonymisationDetection[];
};

export const MAX_PSEUDONYMISATION_INPUT_LENGTH = 20000;

export class PseudonymisationInputError extends Error {}

export const CATEGORY_LABELS: Record<PseudonymisationCategory, string> = {
  PERSONNE: "Personnes",
  EMAIL: "Adresses e-mail",
  TELEPHONE: "Telephones",
  ORGANISATION: "Organisations / clients",
  ADRESSE: "Adresses",
  REFERENCE: "References d'appel d'offres",
  CONTRAT: "Comptes / contrats"
};

type RawMatch = {
  category: PseudonymisationCategory;
  priority: number;
  start: number;
  end: number;
  value: string;
};

const NAME_STOPWORDS = new Set(
  [
    "Le",
    "La",
    "Les",
    "Un",
    "Une",
    "Des",
    "Ce",
    "Cette",
    "Ces",
    "Son",
    "Sa",
    "Ses",
    "Notre",
    "Nos",
    "Votre",
    "Vos",
    "Leur",
    "Leurs",
    "Nous",
    "Vous",
    "Ils",
    "Elles",
    "Il",
    "Elle",
    "Bonjour",
    "Merci",
    "Cordialement",
    "Monsieur",
    "Madame",
    "Mademoiselle",
    "Cher",
    "Chere",
    "Chers",
    "Cheres",
    "Veuillez",
    "Concernant",
    "Objet",
    "Suite",
    "Pour",
    "Avec",
    "Sans",
    "Dans",
    "Sur",
    "Sous",
    "Entre",
    "Ministere",
    "Direction",
    "Republique",
    "Projet",
    "Appel",
    "Offre",
    "Offres",
    "Dossier",
    "Contrat",
    "Compte",
    "Rapport",
    "Annexe",
    "Article",
    "Fiche"
  ].map((word) => word.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
);

const ORGANISATION_STOPWORDS = new Set([
  "CDC",
  "FCI",
  "PDF",
  "DOC",
  "DOCX",
  "XML",
  "HTML",
  "URL",
  "API",
  "TTC",
  "TVA",
  "RFP",
  "QCBS",
  "CS",
  "NB"
]);

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findAll(text: string, regex: RegExp) {
  const matches: Array<{ start: number; end: number; value: string }> = [];
  for (const match of text.matchAll(regex)) {
    if (match.index === undefined) continue;
    matches.push({ start: match.index, end: match.index + match[0].length, value: match[0] });
  }
  return matches;
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const PHONE_REGEX =
  /\+\d{1,3}(?:[ .-]?\d{1,2}){4,5}\b|\b0\d(?:[ .-]?\d{2}){4}\b/g;

const REFERENCE_REGEX = /\b[A-Z]{2,}(?:[-/][A-Z0-9]+){2,}\b/g;

const ADDRESS_REGEX =
  /\b\d{1,4}[,]?\s+(?:rue|avenue|av\.|boulevard|bd|impasse|all[ée]e|place|route|quartier|cit[ée])\s+[^\n,.;]{2,60}/gi;

const CONTRAT_REGEX =
  /\b(?:contrat|compte|dossier|march[ée])\s*(?:n°|no\.?|num[ée]ro)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-/]{3,})/gi;

const ORGANISATION_REGEX = /\b[A-ZÀ-Ý]{3,}(?:\s+[A-ZÀ-Üa-zà-ÿ][\wÀ-ÿ'-]*){0,2}\b/g;

const PERSON_REGEX =
  /\b[A-ZÀ-Ý][a-zà-ÿ]+(?:-[A-ZÀ-Ý][a-zà-ÿ]+)?\s+[A-ZÀ-Ý][a-zà-ÿ]+(?:-[A-ZÀ-Ý][a-zà-ÿ]+)?\b/g;

function detectEmails(text: string): RawMatch[] {
  return findAll(text, EMAIL_REGEX).map((match) => ({ ...match, category: "EMAIL", priority: 1 }));
}

function detectContrats(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const match of text.matchAll(CONTRAT_REGEX)) {
    if (match.index === undefined || !match[1]) continue;
    const end = match.index + match[0].length;
    const start = end - match[1].length;
    matches.push({ category: "CONTRAT", priority: 2, start, end, value: match[1] });
  }
  return matches;
}

function detectReferences(text: string): RawMatch[] {
  return findAll(text, REFERENCE_REGEX).map((match) => ({
    ...match,
    category: "REFERENCE",
    priority: 3
  }));
}

function detectPhones(text: string): RawMatch[] {
  return findAll(text, PHONE_REGEX).map((match) => ({
    ...match,
    category: "TELEPHONE",
    priority: 4
  }));
}

function detectAddresses(text: string): RawMatch[] {
  return findAll(text, ADDRESS_REGEX).map((match) => ({
    ...match,
    category: "ADRESSE",
    priority: 5
  }));
}

function detectOrganisations(text: string): RawMatch[] {
  return findAll(text, ORGANISATION_REGEX)
    .filter((match) => !ORGANISATION_STOPWORDS.has(stripAccents(match.value.split(/\s+/)[0] ?? "")))
    .map((match) => ({ ...match, category: "ORGANISATION", priority: 6 }));
}

function detectPersons(text: string): RawMatch[] {
  return findAll(text, PERSON_REGEX)
    .filter((match) => {
      const firstWord = match.value.split(/\s+/)[0] ?? "";
      return !NAME_STOPWORDS.has(stripAccents(firstWord));
    })
    .map((match) => ({ ...match, category: "PERSONNE", priority: 7 }));
}

function collectMatches(text: string): RawMatch[] {
  const all = [
    ...detectEmails(text),
    ...detectContrats(text),
    ...detectReferences(text),
    ...detectPhones(text),
    ...detectAddresses(text),
    ...detectOrganisations(text),
    ...detectPersons(text)
  ];

  const byPriority = [...all].sort((a, b) => a.priority - b.priority || a.start - b.start);
  const accepted: RawMatch[] = [];

  for (const candidate of byPriority) {
    const overlaps = accepted.some(
      (existing) => candidate.start < existing.end && existing.start < candidate.end
    );
    if (!overlaps) {
      accepted.push(candidate);
    }
  }

  return accepted.sort((a, b) => a.start - b.start);
}

// Pure function: same input text always produces the same detections and
// aliases, in the order values first appear in the text. `excludedKeys`
// only controls which detections are substituted in the output text - it
// never changes alias numbering, so toggling a detection on/off in the
// review step cannot renumber the others.
export function pseudonymiseText(
  input: string,
  excludedKeys: ReadonlySet<string> = new Set()
): PseudonymisationResult {
  if (!input || !input.trim()) {
    throw new PseudonymisationInputError("Aucun texte à pseudonymiser.");
  }

  if (input.length > MAX_PSEUDONYMISATION_INPUT_LENGTH) {
    throw new PseudonymisationInputError("Le document est trop volumineux.");
  }

  const matches = collectMatches(input);

  const counters: Partial<Record<PseudonymisationCategory, number>> = {};
  const detectionByKey = new Map<string, PseudonymisationDetection>();

  for (const match of matches) {
    const key = `${match.category}::${match.value}`;
    const existing = detectionByKey.get(key);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }

    const nextIndex = (counters[match.category] ?? 0) + 1;
    counters[match.category] = nextIndex;

    detectionByKey.set(key, {
      key,
      category: match.category,
      originalValue: match.value,
      alias: `${match.category}_${String(nextIndex).padStart(3, "0")}`,
      occurrences: 1,
      included: !excludedKeys.has(key)
    });
  }

  let output = "";
  let cursor = 0;

  for (const match of matches) {
    const key = `${match.category}::${match.value}`;
    const detection = detectionByKey.get(key);
    output += input.slice(cursor, match.start);
    output += detection && !excludedKeys.has(key) ? detection.alias : match.value;
    cursor = match.end;
  }
  output += input.slice(cursor);

  return {
    pseudonymisedText: output,
    detections: [...detectionByKey.values()]
  };
}
