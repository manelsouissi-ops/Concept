import { XMLBuilder, XMLParser } from "fast-xml-parser";
import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS,
  type ControleResolution,
  type ControleResolutionSection,
  type ControleResolutionStatus,
  type ControleSection,
  type EvaluationField,
  type EvaluationFieldKey,
  type ExtractionField,
  type FichePayload
} from "./types.ts";

type ParsedNode = string | number | boolean | null | undefined | ParsedRecord | ParsedNode[];

interface ParsedRecord {
  [key: string]: ParsedNode;
}

const CONTROL_SECTION_MAPPINGS = [
  { xmlKey: "champs_non_trouves", payloadKey: "champsNonTrouves" },
  { xmlKey: "incoherences", payloadKey: "incoherences" },
  { xmlKey: "a_verifier", payloadKey: "aVerifier" }
] as const satisfies ReadonlyArray<{
  xmlKey: ControleResolutionSection;
  payloadKey: keyof Pick<ControleSection, "champsNonTrouves" | "incoherences" | "aVerifier">;
}>;

const CONTROL_RESOLUTION_STATUSES = new Set<ControleResolutionStatus>([
  "unresolved",
  "resolved",
  "ignored",
  "commented"
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  suppressEmptyNode: false
});

function asRecord(value: ParsedNode): ParsedRecord | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  return value as ParsedRecord;
}

function readText(value: ParsedNode): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return value.map((item) => readText(item)).filter(Boolean).join("\n");
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  if (typeof record["#text"] === "string") {
    return record["#text"].trim();
  }

  return Object.entries(record)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, child]) => readText(child))
    .filter(Boolean)
    .join("\n");
}

function readScore(value: ParsedNode): number | null {
  const text = readText(value);
  if (!text) {
    return null;
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    throw new Error(`Note d'evaluation invalide: "${text}".`);
  }

  return parsed;
}

function requireRoot(xml: string) {
  const parsed = parser.parse(xml) as ParsedRecord;
  const root = asRecord(parsed.fiche_projet);
  const keys = Object.keys(parsed).filter((key) => key !== "?xml");

  if (!root || keys.length !== 1 || keys[0] !== "fiche_projet") {
    throw new Error("Le XML doit contenir une racine unique <fiche_projet>.");
  }

  return root;
}

function requireSection(root: ParsedRecord, key: "extraction" | "evaluation" | "controle") {
  const section = asRecord(root[key]);
  if (!section) {
    throw new Error(`Section <${key}> manquante ou invalide.`);
  }
  return section;
}

function requireElement(section: ParsedRecord, key: string) {
  if (!(key in section)) {
    throw new Error(`Element <${key}> manquant dans la fiche projet.`);
  }

  const value = section[key];
  const record = asRecord(value);

  if (record) {
    return record;
  }

  return {
    "#text": readText(value)
  } satisfies ParsedRecord;
}

function parseExtraction(root: ParsedRecord): ExtractionField[] {
  const section = requireSection(root, "extraction");

  return EXTRACTION_FIELD_DEFINITIONS.map((definition) => {
    const node = requireElement(section, definition.key);

    if (!("@_source" in node)) {
      throw new Error(`L'attribut source est obligatoire sur <${definition.key}>.`);
    }

    return {
      key: definition.key,
      label: definition.label,
      value: readText(node),
      source: readText(node["@_source"])
    };
  });
}

function parseEvaluationEntry(
  section: ParsedRecord,
  key: EvaluationFieldKey
): EvaluationField {
  const node = requireElement(section, key);

  if (!("@_note" in node)) {
    throw new Error(`L'attribut note est obligatoire sur <${key}>.`);
  }

  if (!("justification" in node)) {
    throw new Error(`L'element <justification> est obligatoire dans <${key}>.`);
  }

  if (key === "risque_sous_dimensionnement" && !("charge_estimee" in node)) {
    throw new Error("L'element <charge_estimee> est obligatoire dans <risque_sous_dimensionnement>.");
  }

  return {
    key,
    label: key,
    score: readScore(node["@_note"]),
    chargeEstimee:
      key === "risque_sous_dimensionnement" ? readText(node.charge_estimee) : undefined,
    justification: readText(node.justification)
  };
}

function parseEvaluation(root: ParsedRecord): EvaluationField[] {
  const section = requireSection(root, "evaluation");

  return EVALUATION_FIELD_DEFINITIONS.map((definition) =>
    parseEvaluationEntry(section, definition.key)
  );
}

function parseControlList(value: ParsedNode): string[] {
  const text = readText(value);

  if (!text) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s*-]+/, "").trim())
    .filter(Boolean);
}

function createDefaultResolutions(
  lists: Pick<ControleSection, "champsNonTrouves" | "incoherences" | "aVerifier">
) {
  const resolutions: ControleResolution[] = [];

  for (const mapping of CONTROL_SECTION_MAPPINGS) {
    const items = lists[mapping.payloadKey];

    items.forEach((_, index) => {
      resolutions.push({
        section: mapping.xmlKey,
        index,
        status: "unresolved",
        comment: ""
      });
    });
  }

  return resolutions;
}

function parseResolutionStatus(value: ParsedNode): ControleResolutionStatus {
  const text = readText(value);

  if (!CONTROL_RESOLUTION_STATUSES.has(text as ControleResolutionStatus)) {
    throw new Error(`Statut de resolution invalide: "${text}".`);
  }

  return text as ControleResolutionStatus;
}

function normalizeResolutions(
  lists: Pick<ControleSection, "champsNonTrouves" | "incoherences" | "aVerifier">,
  existing: ControleResolution[]
) {
  const existingByKey = new Map(
    existing.map((resolution) => [
      `${resolution.section}:${resolution.index}`,
      resolution
    ] as const)
  );

  return createDefaultResolutions(lists).map((resolution) => {
    const current = existingByKey.get(`${resolution.section}:${resolution.index}`);
    return current
      ? {
          section: resolution.section,
          index: resolution.index,
          status: current.status,
          comment: current.comment
        }
      : resolution;
  });
}

function parseResolutions(
  section: ParsedRecord,
  lists: Pick<ControleSection, "champsNonTrouves" | "incoherences" | "aVerifier">
) {
  const resolutionsNode = asRecord(section.resolutions);
  if (!resolutionsNode || !("item" in resolutionsNode)) {
    return createDefaultResolutions(lists);
  }

  const items = Array.isArray(resolutionsNode.item)
    ? resolutionsNode.item
    : [resolutionsNode.item];

  const parsed = items.map((item) => {
    const record = asRecord(item);
    if (!record) {
      throw new Error("Chaque resolution doit etre definie dans un element <item>.");
    }

    const sectionValue = readText(record["@_section"]);
    const indexText = readText(record["@_index"]);

    if (
      sectionValue !== "champs_non_trouves" &&
      sectionValue !== "incoherences" &&
      sectionValue !== "a_verifier"
    ) {
      throw new Error(`Section de resolution invalide: "${sectionValue}".`);
    }

    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Index de resolution invalide: "${indexText}".`);
    }

    return {
      section: sectionValue,
      index,
      status: parseResolutionStatus(record["@_status"]),
      comment: readText(record["@_comment"])
    } satisfies ControleResolution;
  });

  return normalizeResolutions(lists, parsed);
}

function parseControle(root: ParsedRecord): ControleSection {
  const section = requireSection(root, "controle");

  if (!("champs_non_trouves" in section) || !("incoherences" in section) || !("a_verifier" in section)) {
    throw new Error("La section <controle> doit contenir <champs_non_trouves>, <incoherences> et <a_verifier>.");
  }

  const lists = {
    champsNonTrouves: parseControlList(section.champs_non_trouves),
    incoherences: parseControlList(section.incoherences),
    aVerifier: parseControlList(section.a_verifier)
  };

  return {
    ...lists,
    resolutions: parseResolutions(section, lists)
  };
}

export function parseFiche(xml: string): FichePayload {
  const root = requireRoot(xml);

  if (!("reference_interne" in root)) {
    throw new Error("L'element <reference_interne> est obligatoire sous <fiche_projet>.");
  }

  return {
    codeInterne: readText(root.reference_interne),
    extraction: parseExtraction(root),
    evaluation: parseEvaluation(root),
    controle: parseControle(root)
  };
}

function joinControlItems(items: string[]) {
  return items.join("\n");
}

function serializeResolutions(resolutions: ControleResolution[]) {
  return {
    item: resolutions.map((resolution) => ({
      "@_section": resolution.section,
      "@_index": resolution.index,
      "@_status": resolution.status,
      "@_comment": resolution.comment ?? "",
      "#text": ""
    }))
  };
}

export function serializeFiche(
  fiche: FichePayload,
  options?: { referenceInterne?: string }
) {
  const extraction: Record<string, ParsedNode> = {};

  for (const definition of EXTRACTION_FIELD_DEFINITIONS) {
    const field = fiche.extraction.find((entry) => entry.key === definition.key);
    extraction[definition.key] = {
      "@_source": field?.source ?? "",
      "#text": field?.value ?? ""
    };
  }

  const evaluation: Record<string, ParsedNode> = {};

  for (const definition of EVALUATION_FIELD_DEFINITIONS) {
    const field = fiche.evaluation.find((entry) => entry.key === definition.key);

    evaluation[definition.key] =
      definition.key === "risque_sous_dimensionnement"
        ? {
            "@_note": field?.score ?? "",
            charge_estimee: field?.chargeEstimee ?? "",
            justification: field?.justification ?? ""
          }
        : {
            "@_note": field?.score ?? "",
            justification: field?.justification ?? ""
          };
  }

  const xmlObject = {
    "?xml": {
      "@_version": "1.0",
      "@_encoding": "UTF-8"
    },
    fiche_projet: {
      reference_interne: options?.referenceInterne ?? "",
      extraction,
      evaluation,
      controle: {
        champs_non_trouves: joinControlItems(fiche.controle.champsNonTrouves),
        incoherences: joinControlItems(fiche.controle.incoherences),
        a_verifier: joinControlItems(fiche.controle.aVerifier),
        resolutions: serializeResolutions(
          normalizeResolutions(
            {
              champsNonTrouves: fiche.controle.champsNonTrouves,
              incoherences: fiche.controle.incoherences,
              aVerifier: fiche.controle.aVerifier
            },
            fiche.controle.resolutions
          )
        )
      }
    }
  };

  return builder.build(xmlObject);
}
