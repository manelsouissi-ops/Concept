// Phase 2 - contract for a FUTURE local semantic classifier. This file
// defines types and a verification helper only. It does not call Ollama,
// Docling, or any AI/embedding service, and it does not extract or read any
// document content itself - a future local processor is expected to supply
// already-extracted text/reference material as plain input.

import type { ClassificationMethod, ClassificationState, KnowledgeCategory } from "./classification.ts";

export type LocalSemanticClassificationInput = {
  /** Stable knowledge_base.archive_files.id - never a filename or path. */
  archiveFileId: number;
  /**
   * Text/reference material already extracted by a future LOCAL processor
   * (e.g. a local Docling pass). This module never fetches or reads it.
   */
  extractedText: string;
  /** Free-form label identifying which local extractor produced the text. */
  extractionSource: string;
};

export type LocalSemanticClassificationProposal = {
  /** Must equal the archiveFileId of the input this proposal was for. */
  archiveFileId: number;
  knowledgeCategory: KnowledgeCategory;
  /** 0..1 - never treat AI_PROPOSED as ground truth regardless of value. */
  confidence: number;
  reason: string;
  classificationMethod: Extract<ClassificationMethod, "LOCAL_AI">;
  classificationState: Extract<ClassificationState, "AI_PROPOSED" | "NEEDS_REVIEW">;
};

export class SemanticClassificationFileIdMismatchError extends Error {
  requestedFileId: number;
  proposalFileId: number;

  constructor(requestedFileId: number, proposalFileId: number) {
    super(
      `Local semantic classifier proposal file id (${proposalFileId}) does not match ` +
        `the requested file id (${requestedFileId}). Refusing to accept - this would be ` +
        `a cross-file classification mistake.`
    );
    this.name = "SemanticClassificationFileIdMismatchError";
    this.requestedFileId = requestedFileId;
    this.proposalFileId = proposalFileId;
  }
}

/**
 * CRITICAL safety check: a proposal must be verified against the exact input
 * it claims to answer before it is ever accepted or persisted. This is the
 * only defense against a future local classifier mixing up results between
 * files (e.g. batched calls returning answers out of order).
 */
export function assertProposalMatchesRequest(
  input: LocalSemanticClassificationInput,
  proposal: LocalSemanticClassificationProposal
): void {
  if (input.archiveFileId !== proposal.archiveFileId) {
    throw new SemanticClassificationFileIdMismatchError(input.archiveFileId, proposal.archiveFileId);
  }
}
