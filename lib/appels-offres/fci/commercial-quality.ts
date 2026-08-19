import { promises as fs } from "node:fs";
import { markdownPath } from "../../storage.ts";
import type {
  FciAiField,
  FciCommercialPayload,
  FciCommercialCompetitorRow
} from "./ai-contracts.ts";

export type FciCommercialShortlistEntry = {
  name: string;
  country: string | null;
  sourceExcerpt: string;
};

export type FciCommercialSourceContext = {
  shortlistedConsultants: FciCommercialShortlistEntry[];
};

function cleanCell(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isShortlistHeading(line: string) {
  const normalized = line.toLocaleLowerCase("fr-FR");
  return normalized.includes("liste restreinte")
    && (normalized.includes("noms figurent") || normalized.includes("consultant"));
}

/**
 * Extract only explicit shortlist table facts from persisted CDC Markdown.
 * It deliberately ignores generic template tables and never infers a firm.
 */
export function extractCommercialShortlistFromMarkdown(
  markdown: string
): FciCommercialShortlistEntry[] {
  const lines = markdown.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => isShortlistHeading(line) ? index : -1)
    .filter((index) => index >= 0);

  for (const headingIndex of headingIndexes) {
    const entries: FciCommercialShortlistEntry[] = [];
    let tableStarted = false;

    for (const line of lines.slice(headingIndex + 1, headingIndex + 80)) {
      if (!line.trim()) {
        if (tableStarted && entries.length > 0) break;
        continue;
      }
      if (!line.trimStart().startsWith("|")) {
        if (tableStarted && entries.length > 0) break;
        continue;
      }

      tableStarted = true;
      const cells = line.split("|").slice(1, -1).map(cleanCell);
      if (cells.length < 3) continue;
      if (!/^\d+$/.test(cells[0])) continue;

      const name = cells[1];
      const country = cells[2] || null;
      if (!name) continue;
      entries.push({
        name,
        country,
        sourceExcerpt: [name, country].filter(Boolean).join(" — ")
      });
    }

    if (entries.length > 0) return entries;
  }

  return [];
}

export async function readFciCommercialSourceContext(
  code: string
): Promise<FciCommercialSourceContext> {
  try {
    const markdown = await fs.readFile(markdownPath(code), "utf8");
    return { shortlistedConsultants: extractCommercialShortlistFromMarkdown(markdown) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { shortlistedConsultants: [] };
    }
    throw error;
  }
}

function sourceField(
  value: string | null,
  field: string,
  excerpt: string
): FciAiField<string | null> {
  return {
    value,
    source_type: "fiche_cdc",
    confidence: "high",
    requires_human_input: false,
    justification: "Information explicitement présente dans la liste restreinte du CDC.",
    source_references: [{ section: "Liste restreinte", field, excerpt }]
  };
}

function humanField(justification: string): FciAiField<string | null> {
  return {
    value: null,
    source_type: "internal_required",
    confidence: "none",
    requires_human_input: true,
    justification,
    source_references: []
  };
}

function unavailableField(justification: string): FciAiField<string | null> {
  return {
    value: null,
    source_type: "unavailable",
    confidence: "none",
    requires_human_input: false,
    justification,
    source_references: []
  };
}

export function buildCommercialCompetitorRows(
  context: FciCommercialSourceContext
): FciCommercialCompetitorRow[] {
  return context.shortlistedConsultants.map((entry) => ({
    nom_du_concurrent: sourceField(entry.name, "consultant_ou_groupement", entry.sourceExcerpt),
    pays: sourceField(entry.country, "pays", entry.sourceExcerpt),
    points_forts_connus: humanField("Les points forts relèvent de la veille commerciale interne."),
    historique_avec_le_client: humanField("L'historique client doit être confirmé par l'équipe commerciale."),
    avantage_principal_pour_ce_cdc: unavailableField("Le CDC ne permet pas d'établir cet avantage."),
    risque_qu_il_represente: unavailableField("Le CDC ne permet pas d'évaluer le risque concurrentiel propre à ce consultant.")
  }));
}

function sanitizeTransitDays(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** Deterministic safety layer applied after schema validation and before persistence. */
export function applyCommercialGenerationGuardrails(
  payload: FciCommercialPayload,
  context: FciCommercialSourceContext
): FciCommercialPayload {
  const transit = payload.data.points_logistiques_internes.delai_de_transit_necessaire;
  const transitValue = sanitizeTransitDays(transit.value);
  const competitors = context.shortlistedConsultants.length > 0
    ? buildCommercialCompetitorRows(context)
    : [];

  return {
    ...payload,
    data: {
      ...payload.data,
      concurrents_premiere_lecture: competitors,
      positionnement_offre: {
        ...payload.data.positionnement_offre,
        notre_avantage_differentiel_principal: humanField(
          "À confirmer par l'équipe commerciale à partir des références internes approuvées."
        )
      },
      points_logistiques_internes: {
        ...payload.data.points_logistiques_internes,
        delai_de_transit_necessaire: {
          ...transit,
          value: transitValue,
          source_type: transitValue == null ? "internal_required" : transit.source_type,
          confidence: transitValue == null ? "none" : transit.confidence,
          requires_human_input: transitValue == null,
          justification: transitValue == null
            ? "Durée de transit en jours à renseigner par l'équipe commerciale."
            : transit.justification,
          source_references: transitValue == null ? [] : transit.source_references
        }
      }
    }
  };
}
