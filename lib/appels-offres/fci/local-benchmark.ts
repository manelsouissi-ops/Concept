import type { FciAiSupportedModuleCode } from "./ai-contracts.ts";

export const LOCAL_FCI_MODEL = "qwen3:14b" as const;
export const LOCAL_FCI_OLLAMA_URL = "http://127.0.0.1:11434/api/chat" as const;

type JsonRecord = Record<string, unknown>;

export type LocalFciMetrics = {
  fieldCount: number;
  populated: number;
  humanRequired: number;
  humanBlockers: number;
  unsupportedClaims: number;
  internalClaimViolations: number;
  decisionLeakage: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isField(value: unknown): value is JsonRecord {
  return isRecord(value)
    && "value" in value
    && typeof value.source_type === "string"
    && typeof value.requires_human_input === "boolean"
    && Array.isArray(value.source_references);
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("fr-FR");
}

function collectScalars(value: unknown, sink: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectScalars(item, sink);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectScalars(item, sink);
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalized = normalize(value);
    if (normalized) sink.push(normalized);
  }
}

export function containsFinalDecisionLanguage(value: unknown) {
  const text = normalize(JSON.stringify(value));
  return /\bno[ -]?go\b|\bgo avec reserves\b|\bdecision finale\b|\brecommand(?:ation|e)[^.!?]{0,40}\bgo\b/.test(text);
}

const INTERNAL_PATHS: Record<"A" | "B" | "C", RegExp> = {
  A: /(?:prepare_par|valide_par|notre_avantage_differentiel_principal|notre_vulnerabilite_principale|niveau_de_prix_cible_estime|delai_de_transit_necessaire|responsable_depot|representation_locale_existante|points_forts_connus|historique_avec_le_client|avantage_principal_pour_ce_cdc|risque_qu_il_represente)$/,
  B: /(?:taux_de_change_applique_et_source|coefficient_de_charges_de_structure|marge_cible_visee)$/,
  C: /(?:volume_travail_reel_previsionnel|suppleant|volume_travail_previsionnel_suppleant|probabilite_disponibilite_experts|quantite_disponible|membre_du_groupement_qui_lapporte|disponible_au_demarrage|membre_responsable|experts_affectes|effort_estime_client_vs_concept)$/
};

export async function requestLocalFci(
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
) {
  const endpoint = new URL(LOCAL_FCI_OLLAMA_URL);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.port !== "11434") {
    throw new Error("Le benchmark FCI refuse tout endpoint Ollama non-loopback.");
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Ollama local a repondu HTTP ${response.status}.`);
  return await response.json() as Record<string, unknown>;
}

export function evaluateLocalFciPayload(
  moduleCode: "A" | "B" | "C",
  payload: unknown,
  sourceContext: unknown
): LocalFciMetrics {
  const sourceScalars: string[] = [];
  collectScalars(sourceContext, sourceScalars);
  const fields: Array<{ path: string; field: JsonRecord }> = [];

  function walk(value: unknown, path: string) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (isField(value)) {
      fields.push({ path, field: value });
      return;
    }
    if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        walk(item, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(isRecord(payload) ? payload.data : null, "data");
  let unsupportedClaims = 0;
  let internalClaimViolations = 0;

  for (const { path, field } of fields) {
    const populated = field.value !== null
      && field.value !== ""
      && (!Array.isArray(field.value) || field.value.length > 0);
    if (INTERNAL_PATHS[moduleCode].test(path) && populated) {
      internalClaimViolations += 1;
    }
    if (field.source_type !== "fiche_cdc" || !populated) continue;
    const references = field.source_references as unknown[];
    const grounded = references.some((reference) => {
      if (!isRecord(reference)) return false;
      const excerpt = normalize(reference.excerpt);
      return excerpt.length >= 3 && sourceScalars.some((source) => source.includes(excerpt) || excerpt.includes(source));
    });
    if (!grounded) unsupportedClaims += 1;
  }

  const humanRequired = fields.filter(({ field }) => field.requires_human_input === true).length;
  return {
    fieldCount: fields.length,
    populated: fields.filter(({ field }) => field.value !== null && field.value !== "" && (!Array.isArray(field.value) || field.value.length > 0)).length,
    humanRequired,
    humanBlockers: humanRequired,
    unsupportedClaims,
    internalClaimViolations,
    decisionLeakage: containsFinalDecisionLanguage(payload)
  };
}

export function buildLocalFciMessages(input: {
  moduleCode: "A" | "B" | "C";
  moduleType: string;
  promptText: string;
  schemaVersion: string;
  schemaJson: JsonRecord;
  sourceFiche: JsonRecord;
  ficheCdc: unknown;
  commercialContext?: unknown;
}) {
  const system = [
    input.promptText,
    "",
    "Contraintes systeme additionnelles:",
    "- Reponds uniquement avec un objet JSON valide.",
    "- N'ajoute aucun commentaire, aucun Markdown et aucune balise de code.",
    `- Respecte strictement module_code=${input.moduleCode} et module_type=${input.moduleType}.`,
    "- Utilise uniquement les informations de la Fiche CDC fournie.",
    "- Une information interne absente doit rester null, internal_required et requires_human_input=true.",
    "- Toute decision finale GO, NO-GO ou GO AVEC RESERVES est interdite.",
    "- La sortie doit rester concise, professionnelle et en francais."
  ].join("\n");
  const user = JSON.stringify({
    module_code: input.moduleCode,
    module_type: input.moduleType,
    trigger_type: "benchmark",
    source_fiche: input.sourceFiche,
    generation_metadata: {
      provider: "local",
      model: LOCAL_FCI_MODEL,
      schema_version: input.schemaVersion,
      ...(input.commercialContext ? { commercial_context: input.commercialContext } : {})
    },
    expected_schema_version: input.schemaVersion,
    expected_json_schema: input.schemaJson,
    fiche_cdc: input.ficheCdc
  });
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function assertLocalFciModule(moduleCode: string): asserts moduleCode is Exclude<FciAiSupportedModuleCode, "D"> {
  if (moduleCode !== "A" && moduleCode !== "B" && moduleCode !== "C") {
    throw new Error("Le benchmark local accepte uniquement les modules FCI A, B et C.");
  }
}
