"use server";

import { getAdministrationDashboardPool } from "@/lib/administration/dashboard.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import {
  buildCandidateFilterClause,
  mapCandidateRow,
  mapImportBatchRow,
  sanitizeCandidateLimit,
  sanitizeCandidatePage,
  sanitizeCandidateSortField,
  sanitizeCandidateSortOrder,
  sanitizeRepositoryError,
  SORTABLE_CANDIDATE_COLUMNS,
  RECENT_YEAR_MIN,
  RECENT_YEAR_MAX,
  type CdcCandidatePage,
  type CdcCandidateQuery,
  type CdcCandidateRecord,
  type CdcImportBatchRecord,
  type CdcReviewSummary
} from "@/lib/archive-cartography/cdc-review.ts";

// CDC human-review dashboard is READ-ONLY: every function in this file is a
// SELECT against knowledge_base.historical_technical_source_candidates /
// knowledge_base.historical_technical_source_import_batches. There is no
// INSERT/UPDATE/DELETE/TRUNCATE/DDL anywhere here, no document is ever
// opened, and no Ollama/Docling/n8n/Qdrant call is ever made. Uses the same
// shared administration dashboard pool as the rest of /administration -
// never closed here (see app/administration/knowledge/actions.ts).
//
// requireAreaAccessForPage("archive") is re-checked in EVERY exported
// function, independently of the page-level check - the same defense-in-
// depth pattern already used throughout app/administration/knowledge/
// actions.ts. Authentication happens first, inside that helper, before any
// authorization decision or database query runs; a missing session/user/
// area fails closed (redirects to /login or /forbidden) rather than ever
// falling through to a query.

const CANDIDATE_COLUMNS = `
  c.id, c.year, c.project_reference, c.detected_role, c.structural_band,
  c.confidence, c.review_priority, c.validation_status, c.extraction_status,
  c.reviewed_at, c.human_review_import_batch_id
`;

export async function loadCdcReviewSummary(): Promise<CdcReviewSummary> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  try {
    const result = await pool.query<{
      total: string;
      validated: string;
      rejected: string;
      unresolved: string;
      recent_usable: string;
      older_usable: string;
      linked_to_completed_batch: string;
    }>(
      `
      select
        count(*) as total,
        count(*) filter (where c.validation_status = 'HUMAN_VALIDATED_CDC') as validated,
        count(*) filter (where c.validation_status = 'HUMAN_REJECTED_CDC') as rejected,
        count(*) filter (where c.validation_status not in ('HUMAN_VALIDATED_CDC', 'HUMAN_REJECTED_CDC')) as unresolved,
        count(*) filter (
          where c.validation_status = 'HUMAN_VALIDATED_CDC' and c.year between $1 and $2
        ) as recent_usable,
        count(*) filter (
          where c.validation_status = 'HUMAN_VALIDATED_CDC' and (c.year is null or c.year < $1)
        ) as older_usable,
        count(*) filter (where c.human_review_import_batch_id is not null) as linked_to_completed_batch
      from knowledge_base.historical_technical_source_candidates c
      `,
      [RECENT_YEAR_MIN, RECENT_YEAR_MAX]
    );

    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      validated: Number(row?.validated ?? 0),
      rejected: Number(row?.rejected ?? 0),
      unresolved: Number(row?.unresolved ?? 0),
      recentUsable: Number(row?.recent_usable ?? 0),
      olderUsable: Number(row?.older_usable ?? 0),
      linkedToCompletedBatch: Number(row?.linked_to_completed_batch ?? 0)
    };
  } catch (error) {
    throw new Error(sanitizeRepositoryError(error));
  }
}

export async function loadCdcCandidates(query: CdcCandidateQuery = {}): Promise<CdcCandidatePage> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  const page = sanitizeCandidatePage(query.page);
  const limit = sanitizeCandidateLimit(query.limit);
  const offset = (page - 1) * limit;
  const sortField = sanitizeCandidateSortField(query.sortField);
  const sortOrder = sanitizeCandidateSortOrder(query.sortOrder);
  const sortColumn = SORTABLE_CANDIDATE_COLUMNS[sortField]; // strict allowlist - never the raw field name

  const { whereClause, params } = buildCandidateFilterClause(query);

  try {
    const countResult = await pool.query<{ total: string }>(
      `select count(*) as total from knowledge_base.historical_technical_source_candidates c ${whereClause}`,
      params
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const limitParamIndex = params.length + 1;
    const offsetParamIndex = params.length + 2;

    const candidatesResult = await pool.query<Record<string, unknown>>(
      `
      select ${CANDIDATE_COLUMNS}
      from knowledge_base.historical_technical_source_candidates c
      ${whereClause}
      order by ${sortColumn} ${sortOrder} nulls last, c.id asc
      limit $${limitParamIndex} offset $${offsetParamIndex}
      `,
      [...params, limit, offset]
    );

    return {
      items: candidatesResult.rows.map(mapCandidateRow),
      total
    };
  } catch (error) {
    throw new Error(sanitizeRepositoryError(error));
  }
}

export async function loadCdcCandidateDetail(candidateId: string): Promise<CdcCandidateRecord | null> {
  await requireAreaAccessForPage("archive");
  if (typeof candidateId !== "string" || candidateId.trim().length === 0) {
    return null;
  }
  const pool = getAdministrationDashboardPool();

  try {
    const result = await pool.query<Record<string, unknown>>(
      `
      select ${CANDIDATE_COLUMNS}
      from knowledge_base.historical_technical_source_candidates c
      where c.id = $1
      `,
      [candidateId]
    );
    const row = result.rows[0];
    return row ? mapCandidateRow(row) : null;
  } catch (error) {
    throw new Error(sanitizeRepositoryError(error));
  }
}

export async function loadCdcImportBatches(): Promise<CdcImportBatchRecord[]> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  try {
    const result = await pool.query<Record<string, unknown>>(
      `
      select
        b.id, b.status, b.reviewer_type, b.external_reviewer_label,
        b.started_at, b.completed_at, b.total_count, b.usable_count,
        b.excluded_count, b.skipped_uncertain_count, b.updated_count,
        b.source_workbook_sha256
      from knowledge_base.historical_technical_source_import_batches b
      order by b.started_at desc
      limit 20
      `
    );
    return result.rows.map(mapImportBatchRow);
  } catch (error) {
    throw new Error(sanitizeRepositoryError(error));
  }
}
