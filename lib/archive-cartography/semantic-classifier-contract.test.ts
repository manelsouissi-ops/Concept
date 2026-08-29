import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProposalMatchesRequest,
  SemanticClassificationFileIdMismatchError,
  type LocalSemanticClassificationInput,
  type LocalSemanticClassificationProposal
} from "./semantic-classifier-contract.ts";

function buildInput(archiveFileId: number): LocalSemanticClassificationInput {
  return {
    archiveFileId,
    extractedText: "synthetic extracted text for testing only",
    extractionSource: "synthetic_local_extractor_v0"
  };
}

function buildProposal(archiveFileId: number): LocalSemanticClassificationProposal {
  return {
    archiveFileId,
    knowledgeCategory: "OTHER",
    confidence: 0.42,
    reason: "synthetic reason for testing only",
    classificationMethod: "LOCAL_AI",
    classificationState: "AI_PROPOSED"
  };
}

test("accepts a proposal whose file id matches the request", () => {
  const input = buildInput(101);
  const proposal = buildProposal(101);
  assert.doesNotThrow(() => assertProposalMatchesRequest(input, proposal));
});

test("rejects a proposal whose file id does not match the request", () => {
  const input = buildInput(101);
  const proposal = buildProposal(202);
  assert.throws(
    () => assertProposalMatchesRequest(input, proposal),
    SemanticClassificationFileIdMismatchError
  );
});

test("mismatch error carries both ids for diagnostics", () => {
  const input = buildInput(5);
  const proposal = buildProposal(9);
  try {
    assertProposalMatchesRequest(input, proposal);
    assert.fail("expected assertProposalMatchesRequest to throw");
  } catch (error) {
    assert.ok(error instanceof SemanticClassificationFileIdMismatchError);
    assert.equal(error.requestedFileId, 5);
    assert.equal(error.proposalFileId, 9);
  }
});
