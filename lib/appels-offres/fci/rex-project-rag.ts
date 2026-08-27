import type { ExtractionField, FichePayload } from "../../types.ts";

/**
 * Targeted local RAG pilot for FCI C's `rex_projet_reference` evidence gap.
 *
 * Scope (see docs/FCI_C_TARGETED_RAG_PILOT.md for the full design):
 * - Retrieves candidate HISTORICAL PROJECT records (project/offer-level, not
 *   arbitrary chunks) similar to the CURRENT validated tender.
 * - Never calls anything but local infrastructure (Ollama embeddings, local
 *   Qdrant). No Gemini/Claude/OpenAI/external embedding/external vector DB
 *   call exists anywhere in this module.
 * - Produces SUGGESTIONS with mandatory provenance, never a persisted FCI C
 *   value. Nothing here writes to `FciOperationsData`, the raw FCI C AI
 *   schema, or `fci_module_data`. A human decides whether to use a
 *   suggestion; this module has no autofill path.
 * - This is a SEPARATE retrieval problem from the deterministic 21-feature
 *   "closest CDC" algorithm: that finds the closest CURRENT/past CDC by
 *   coverage/count/proximity/recency; this finds a semantically similar
 *   HISTORICAL PROJECT for return-of-experience evidence. Neither replaces
 *   the other.
 */

// ---------------------------------------------------------------------------
// Local-only infrastructure endpoints (loopback-enforced, see assertLoopback)
// ---------------------------------------------------------------------------

export const LOCAL_EMBEDDING_MODEL = "qwen3-embedding:0.6b" as const;
export const LOCAL_EMBEDDING_URL = "http://127.0.0.1:11434/api/embed" as const;
export const LOCAL_QDRANT_URL = "http://127.0.0.1:6333" as const;

/**
 * Not yet created. The pilot deliberately does not create Qdrant
 * collections or ingest data (see docs/FCI_C_TARGETED_RAG_PILOT.md,
 * "What is still needed before real historical rollout"). Naming it here
 * documents the intended parallel to the existing `concept_historical_cdc`
 * collection so a future ingestion batch has a fixed target.
 */
export const HISTORICAL_PROJECTS_QDRANT_COLLECTION = "concept_historical_projects" as const;

function assertLoopbackUrl(rawUrl: string, label: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error(`${label} doit rester en loopback (http://127.0.0.1 ou http://localhost).`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Query construction from CURRENT validated tender evidence only
// ---------------------------------------------------------------------------

const QUERY_EXTRACTION_KEYS = [
  "secteur",
  "nature_prestation",
  "pays",
  "zone_execution",
  "disciplines_techniques",
  "livrables_principaux",
  "profils_cles",
  "duree_totale",
  "volume_hommes_mois",
  "type_contrat",
  "source_financement",
  "points_techniques_structurants"
] as const;

export type RexProjectQueryFields = Partial<Record<(typeof QUERY_EXTRACTION_KEYS)[number], string>>;

export type RexProjectQuery = {
  queryText: string;
  fields: RexProjectQueryFields;
};

function extractionValue(extraction: ExtractionField[], key: string): string | null {
  const field = extraction.find((item) => item.key === key);
  const value = field?.value?.trim();
  return value ? value : null;
}

/**
 * Builds a targeted retrieval query from the current VALIDATED Fiche only —
 * never from raw/unvalidated FCI C draft data, never from historical KB
 * content, never broadened to the whole Fiche/FCI payload. Fields are the
 * real extraction keys already used for closest-CDC/FCI generation (see
 * lib/types.ts EXTRACTION_FIELD_DEFINITIONS), chosen because they carry
 * sector, scope, discipline, geography, scale and contract-type signal —
 * exactly what docs/FCI_TARGETED_RAG_ANALYSIS.md's "reference project"
 * opportunity calls for. Fields absent from the current Fiche are simply
 * omitted, never guessed or defaulted.
 */
export function buildRexProjectQuery(fiche: FichePayload): RexProjectQuery {
  const fields: RexProjectQueryFields = {};
  for (const key of QUERY_EXTRACTION_KEYS) {
    const value = extractionValue(fiche.extraction, key);
    if (value) {
      fields[key] = value;
    }
  }

  const queryText = QUERY_EXTRACTION_KEYS
    .map((key) => fields[key])
    .filter((value): value is string => Boolean(value))
    .join(" | ");

  return { queryText, fields };
}

// ---------------------------------------------------------------------------
// Local embeddings (Ollama qwen3-embedding:0.6b)
// ---------------------------------------------------------------------------

export async function embedTextLocally(
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<number[]> {
  const url = assertLoopbackUrl(LOCAL_EMBEDDING_URL, "LOCAL_EMBEDDING_URL");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: LOCAL_EMBEDDING_MODEL, input: [text] })
  });
  if (!response.ok) {
    throw new Error(`Le service d'embedding local a repondu HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { embeddings?: number[][] };
  const embedding = body.embeddings?.[0];
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Le service d'embedding local n'a retourne aucun vecteur.");
  }
  return embedding;
}

// ---------------------------------------------------------------------------
// Retrieval unit: one historical PROJECT/OFFER record, never a bare chunk
// ---------------------------------------------------------------------------

export type HistoricalProjectMetadata = {
  title: string | null;
  country: string | null;
  client: string | null;
  fundingInstitution: string | null;
  sector: string | null;
  projectType: string | null;
  year: string | null;
};

export type HistoricalProjectCandidate = {
  historicalProjectId: string;
  embedding: number[];
  metadata: HistoricalProjectMetadata;
  sourceDocumentId: string;
  sourceDocumentVersionId: string;
  sourceReference: string;
  sourceSection: string | null;
};

/**
 * Real local retrieval backend: queries the (currently empty, not yet
 * created) `concept_historical_projects` Qdrant collection. Never called
 * with real traffic in this task - see docs/FCI_C_TARGETED_RAG_PILOT.md.
 * Kept loopback-enforced and schema-shaped so it is ready the day the
 * collection is populated, without any further contract change.
 */
export async function queryHistoricalProjectsInQdrant(
  embedding: number[],
  options: { limit?: number; fetchImpl?: typeof fetch; collection?: string } = {}
): Promise<HistoricalProjectCandidate[]> {
  const collection = options.collection ?? HISTORICAL_PROJECTS_QDRANT_COLLECTION;
  const url = assertLoopbackUrl(
    `${LOCAL_QDRANT_URL}/collections/${collection}/points/query`,
    "LOCAL_QDRANT_URL"
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: embedding,
      limit: options.limit ?? 10,
      with_payload: true
    })
  });
  if (!response.ok) {
    throw new Error(`Qdrant local a repondu HTTP ${response.status}.`);
  }
  const body = (await response.json()) as {
    result?: { points?: Array<{ id: string; score: number; payload?: Record<string, unknown> }> };
  };
  const points = body.result?.points ?? [];
  return points.map((point) => {
    const payload = point.payload ?? {};
    return {
      historicalProjectId: String(point.id),
      embedding,
      metadata: {
        title: typeof payload.title === "string" ? payload.title : null,
        country: typeof payload.country === "string" ? payload.country : null,
        client: typeof payload.client === "string" ? payload.client : null,
        fundingInstitution:
          typeof payload.funding_institution === "string" ? payload.funding_institution : null,
        sector: typeof payload.sector === "string" ? payload.sector : null,
        projectType: typeof payload.project_type === "string" ? payload.project_type : null,
        year: typeof payload.year === "string" ? payload.year : null
      },
      sourceDocumentId: String(payload.document_id ?? ""),
      sourceDocumentVersionId: String(payload.document_version_id ?? ""),
      // Deliberately does NOT fall back to a raw `source_path`: a future
      // ingestion pipeline must populate a safe, path-free `source_reference`
      // label for every point, exactly like the existing historical-CDC
      // catalog's convention. A missing safe reference must surface as an
      // empty string, never as a raw filesystem path.
      sourceReference: typeof payload.source_reference === "string" ? payload.source_reference : "",
      sourceSection: typeof payload.section === "string" ? payload.section : null
    };
  });
}

// ---------------------------------------------------------------------------
// Ranking (pure, no network) — cosine similarity over injected candidates
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type RankedHistoricalProject = {
  candidate: HistoricalProjectCandidate;
  similarity: number;
};

/**
 * No-result and low-confidence are both valid, safe outcomes: this never
 * lowers a threshold to force a match (see docs/FCI_C_TARGETED_RAG_PILOT.md,
 * "zero-result behavior").
 */
export const REX_PROJECT_MIN_SIMILARITY = 0.55;
export const REX_PROJECT_CONFIDENT_SIMILARITY = 0.75;

export function rankHistoricalProjectCandidates(
  queryEmbedding: number[],
  candidates: HistoricalProjectCandidate[],
  minSimilarity: number = REX_PROJECT_MIN_SIMILARITY
): RankedHistoricalProject[] {
  return candidates
    .map((candidate) => ({ candidate, similarity: cosineSimilarity(queryEmbedding, candidate.embedding) }))
    .filter((ranked) => ranked.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Suggestion assembly — provenance-first, autofill-free
// ---------------------------------------------------------------------------

export type RexProjectSuggestionSource = {
  historicalProjectId: string;
  sourceDocumentId: string;
  sourceDocumentVersionId: string;
  sourceReference: string;
  sourceSection: string | null;
  retrievalScore: number;
  retrievedAt: string;
};

export type RexProjectSuggestion = {
  historicalProjectId: string;
  similarity: number;
  confidence: "high" | "medium" | "low";
  matchedFeatures: string[];
  differences: string[];
  sources: RexProjectSuggestionSource[];
  /**
   * This is the ENTIRE human-boundary state model for the pilot: a
   * suggestion is always "suggested" until a human explicitly acts on it.
   * No code path in this module (or anywhere in FCI C generation) ever sets
   * this to "accepted" - that is a future human-facing UI/API action,
   * intentionally not built in this discovery/pilot task (see
   * docs/FCI_C_TARGETED_RAG_PILOT.md, "human review boundary").
   */
  reviewStatus: "suggested";
};

export type RexProjectRetrievalStatus = "ok" | "no_evidence" | "low_confidence";

export type RexProjectRetrievalResult = {
  status: RexProjectRetrievalStatus;
  query: RexProjectQuery;
  suggestions: RexProjectSuggestion[];
};

// Historical evidence proves what was true THEN, never what is available
// NOW. Any candidate metadata resembling current staffing/availability must
// never reach a suggestion, even if a malformed upstream record carried it.
const PROHIBITED_METADATA_KEY_PATTERN =
  /disponib|availability|staffing|assignment|assigne|consultant|expert_dispo|cv_|current_resource/i;

function sanitizeMetadataForDifferences(metadata: HistoricalProjectMetadata): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!value) continue;
    if (PROHIBITED_METADATA_KEY_PATTERN.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Differences are a DETERMINISTIC structured comparison between the current
 * query's fields and the matched candidate's metadata - never an LLM
 * invention. This is deliberately simpler than an LLM-generated summary for
 * this first pilot (see docs/FCI_C_TARGETED_RAG_PILOT.md): every difference
 * line is directly traceable to two concrete field values, so there is
 * nothing to hallucinate and nothing that needs its own grounding check.
 */
function computeDifferences(query: RexProjectQuery, metadata: HistoricalProjectMetadata): string[] {
  const differences: string[] = [];
  const safeMetadata = sanitizeMetadataForDifferences(metadata);

  const currentCountry = query.fields.pays;
  if (currentCountry && safeMetadata.country && currentCountry !== safeMetadata.country) {
    differences.push(`Pays different : actuel "${currentCountry}" vs reference "${safeMetadata.country}".`);
  }
  const currentSector = query.fields.secteur;
  if (currentSector && safeMetadata.sector && currentSector !== safeMetadata.sector) {
    differences.push(`Secteur different : actuel "${currentSector}" vs reference "${safeMetadata.sector}".`);
  }
  const currentFunder = query.fields.source_financement;
  if (currentFunder && safeMetadata.fundingInstitution && currentFunder !== safeMetadata.fundingInstitution) {
    differences.push(
      `Bailleur different : actuel "${currentFunder}" vs reference "${safeMetadata.fundingInstitution}".`
    );
  }
  return differences;
}

function computeMatchedFeatures(query: RexProjectQuery, metadata: HistoricalProjectMetadata): string[] {
  const safeMetadata = sanitizeMetadataForDifferences(metadata);
  const matched: string[] = [];
  if (query.fields.pays && safeMetadata.country === query.fields.pays) {
    matched.push(`pays: ${query.fields.pays}`);
  }
  if (query.fields.secteur && safeMetadata.sector === query.fields.secteur) {
    matched.push(`secteur: ${query.fields.secteur}`);
  }
  if (query.fields.source_financement && safeMetadata.fundingInstitution === query.fields.source_financement) {
    matched.push(`bailleur: ${query.fields.source_financement}`);
  }
  return matched;
}

function confidenceFromSimilarity(similarity: number): "high" | "medium" | "low" {
  if (similarity >= REX_PROJECT_CONFIDENT_SIMILARITY) return "high";
  if (similarity >= REX_PROJECT_MIN_SIMILARITY) return "medium";
  return "low";
}

function buildSuggestion(
  ranked: RankedHistoricalProject,
  query: RexProjectQuery,
  retrievedAt: string
): RexProjectSuggestion {
  const { candidate, similarity } = ranked;
  return {
    historicalProjectId: candidate.historicalProjectId,
    similarity,
    confidence: confidenceFromSimilarity(similarity),
    matchedFeatures: computeMatchedFeatures(query, candidate.metadata),
    differences: computeDifferences(query, candidate.metadata),
    sources: [
      {
        historicalProjectId: candidate.historicalProjectId,
        sourceDocumentId: candidate.sourceDocumentId,
        sourceDocumentVersionId: candidate.sourceDocumentVersionId,
        sourceReference: candidate.sourceReference,
        sourceSection: candidate.sourceSection,
        retrievalScore: similarity,
        retrievedAt
      }
    ],
    reviewStatus: "suggested"
  };
}

export type SuggestRexProjectReferencesInput = {
  query: RexProjectQuery;
  retrieveCandidates: (embedding: number[]) => Promise<HistoricalProjectCandidate[]>;
  embedText?: (text: string) => Promise<number[]>;
  minSimilarity?: number;
  now?: () => string;
};

/**
 * Orchestrates: embed query -> retrieve candidates -> rank -> build
 * suggestions. Never mutates any FCI C data - the caller receives a plain
 * result object and decides what, if anything, to show a human reviewer.
 * `retrieveCandidates` and `embedText` are injected so tests exercise this
 * with synthetic local fixtures and never touch a network socket (see
 * rex-project-rag.test.ts).
 */
export async function suggestRexProjectReferences(
  input: SuggestRexProjectReferencesInput
): Promise<RexProjectRetrievalResult> {
  const { query } = input;
  if (!query.queryText) {
    return { status: "no_evidence", query, suggestions: [] };
  }

  const embedText = input.embedText ?? ((text: string) => embedTextLocally(text));
  const minSimilarity = input.minSimilarity ?? REX_PROJECT_MIN_SIMILARITY;
  const now = input.now ?? (() => new Date().toISOString());

  const queryEmbedding = await embedText(query.queryText);
  const candidates = await input.retrieveCandidates(queryEmbedding);

  if (candidates.length === 0) {
    return { status: "no_evidence", query, suggestions: [] };
  }

  const ranked = rankHistoricalProjectCandidates(queryEmbedding, candidates, minSimilarity);
  if (ranked.length === 0) {
    return { status: "no_evidence", query, suggestions: [] };
  }

  const retrievedAt = now();
  const suggestions = ranked.map((entry) => buildSuggestion(entry, query, retrievedAt));
  // "low" confidence is structurally unreachable here: rankHistoricalProjectCandidates
  // already filtered out anything below REX_PROJECT_MIN_SIMILARITY, so a
  // surviving candidate is always "medium" or "high". A "medium" top result
  // is still explicitly downgraded to low_confidence status rather than
  // being presented as trusted evidence (see Step 18 of the pilot design).
  const status: RexProjectRetrievalStatus = suggestions[0].confidence === "high" ? "ok" : "low_confidence";

  return { status, query, suggestions };
}
