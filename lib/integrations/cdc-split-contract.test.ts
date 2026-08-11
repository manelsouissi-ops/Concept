import test from "node:test";
import assert from "node:assert/strict";
import { validateDocumentProcessingCallback } from "./cdc-split-contract.ts";

const success = {
  event: "document.processing.completed",
  contract_version: "1.0",
  processing_job_id: "pj_test",
  appel_offre_id: "ao_1",
  code_interne: "AO-TEST",
  correlation_id: "corr_test",
  execution_id: "123",
  status: "COMPLETED",
  parser: { provider: "docling", job_id: "parser-1" },
  started_at: "2026-08-11T10:00:00.000Z",
  finished_at: "2026-08-11T10:01:00.000Z",
  duration_ms: 60_000,
  metadata: {},
  result: {
    markdown: "# CDC",
    byte_size: 5,
    content_hash: `sha256:${"a".repeat(64)}`,
    mime_type: "text/markdown"
  }
};

test("accepts the exact W1 success callback", () => {
  assert.deepEqual(validateDocumentProcessingCallback(success, "1.0"), success);
});

test("rejects a W1 callback with a malformed digest", () => {
  assert.throws(
    () => validateDocumentProcessingCallback({ ...success, result: { ...success.result, content_hash: "bad" } }, "1.0"),
    /content_hash/
  );
});

test("accepts the exact W1 failure callback", () => {
  const failure = {
    ...success,
    event: "document.processing.failed",
    status: "FAILED",
    error: { stage: "PARSER", code: "PARSER_FAILED", message: "conversion failed", retryable: true }
  };
  delete (failure as Partial<typeof success>).parser;
  delete (failure as Partial<typeof success>).result;
  assert.equal(validateDocumentProcessingCallback(failure, "1.0").status, "FAILED");
});

test("rejects incoherent event/status combinations", () => {
  assert.throws(() => validateDocumentProcessingCallback({ ...success, status: "FAILED" }, "1.0"), /event\/status/);
});
