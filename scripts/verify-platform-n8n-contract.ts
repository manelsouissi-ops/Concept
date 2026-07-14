import assert from "node:assert/strict";
import {
  buildCallbackIdempotencyKey,
  toInternalErrorStage,
  validateCallbackPayload,
  validateLaunchAcceptance,
  validateLaunchRequest
} from "../lib/integrations/n8n-contract.ts";
import {
  buildN8nCallbackSignature,
  verifyN8nCallbackAuthentication
} from "../lib/integrations/n8n-callback-auth.ts";
import { buildCanonicalCallbackUrl } from "../lib/integrations/n8n-config.ts";
import { parseFiche, serializeFiche } from "../lib/fiche-xml.ts";
import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS,
  type FichePayload
} from "../lib/types.ts";

const CONTRACT_VERSION = "1.0";

function createSampleFichePayload(): FichePayload {
  return {
    codeInterne: "AO-TEST-001",
    extraction: EXTRACTION_FIELD_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      value: definition.key === "reference_officielle" ? "REF-001" : "",
      source: "Section 1"
    })),
    evaluation: EVALUATION_FIELD_DEFINITIONS.map((definition) => ({
      key: definition.key,
      label: definition.label,
      score: definition.key === "complexite_technique" ? 3 : null,
      justification: "",
      ...(definition.key === "risque_sous_dimensionnement"
        ? { chargeEstimee: "" }
        : {})
    })),
    controle: {
      champsNonTrouves: [],
      incoherences: [],
      aVerifier: [],
      resolutions: []
    }
  };
}

function expectThrows(label: string, callback: () => void) {
  let thrown = false;

  try {
    callback();
  } catch {
    thrown = true;
  }

  assert.equal(thrown, true, `${label} should throw.`);
}

function verifyLaunchContract() {
  const launchRequest = {
    contract_version: CONTRACT_VERSION,
    processing_job_id: "pj_test_001",
    appel_offre_id: "ao_123",
    code_interne: "AO-TEST-001",
    correlation_id: "corr_test_001",
    callback_url: buildCanonicalCallbackUrl("https://platform.example.com/"),
    pdf_path: "C:/data/AO-TEST-001/cdc.pdf",
    requested_at: "2026-07-14T10:15:31.102Z"
  };

  const validatedLaunch = validateLaunchRequest(launchRequest, CONTRACT_VERSION);
  assert.equal(validatedLaunch.processing_job_id, launchRequest.processing_job_id);
  assert.equal(
    validatedLaunch.callback_url,
    "https://platform.example.com/api/fiche/callbacks/n8n"
  );

  const accepted = validateLaunchAcceptance(
    {
      contract_version: CONTRACT_VERSION,
      accepted: true,
      processing_job_id: launchRequest.processing_job_id,
      correlation_id: launchRequest.correlation_id,
      execution_id: "194",
      received_at: "2026-07-14T10:15:33.000Z",
      processing_status: "RUNNING"
    },
    CONTRACT_VERSION
  );

  assert.equal(accepted.execution_id, "194");

  expectThrows("launch acceptance without execution_id", () => {
    validateLaunchAcceptance(
      {
        contract_version: CONTRACT_VERSION,
        accepted: true,
        processing_job_id: launchRequest.processing_job_id,
        correlation_id: launchRequest.correlation_id,
        received_at: "2026-07-14T10:15:33.000Z",
        processing_status: "RUNNING"
      },
      CONTRACT_VERSION
    );
  });
}

function verifySuccessCallbackContract() {
  const xml = serializeFiche(createSampleFichePayload(), {
    referenceInterne: "AO-TEST-001"
  });

  const payload = validateCallbackPayload(
    {
      contract_version: CONTRACT_VERSION,
      processing_job_id: "pj_test_001",
      appel_offre_id: "ao_123",
      code_interne: "AO-TEST-001",
      correlation_id: "corr_test_001",
      execution_id: "194",
      status: "COMPLETED",
      started_at: "2026-07-14T10:15:31.102Z",
      finished_at: "2026-07-14T10:18:44.900Z",
      duration_ms: 193798,
      metadata: {},
      result: {
        markdown: "# CDC\n\nContenu",
        xml
      }
    },
    CONTRACT_VERSION
  );

  assert.equal(payload.status, "COMPLETED");
  assert.equal(payload.result.markdown.includes("Contenu"), true);

  const reparsed = parseFiche(payload.result.xml);
  assert.equal(reparsed.codeInterne, "AO-TEST-001");
}

function verifyFailureCallbackContract() {
  const payload = validateCallbackPayload(
    {
      contract_version: CONTRACT_VERSION,
      processing_job_id: "pj_test_001",
      appel_offre_id: "ao_123",
      code_interne: "AO-TEST-001",
      correlation_id: "corr_test_001",
      execution_id: "194",
      status: "FAILED",
      started_at: "2026-07-14T10:15:31.102Z",
      finished_at: "2026-07-14T10:18:44.900Z",
      duration_ms: 193798,
      metadata: {},
      error: {
        stage: "LLM",
        code: "MODEL_TIMEOUT",
        message: "Provider timeout",
        retryable: true,
        provider: "gemini"
      }
    },
    CONTRACT_VERSION
  );

  assert.equal(payload.status, "FAILED");
  assert.equal(toInternalErrorStage(payload.error.stage), "llm");
}

function verifyIdempotencyAndAuth() {
  const duplicateKeyA = buildCallbackIdempotencyKey({
    processing_job_id: "pj_test_001",
    correlation_id: "corr_test_001",
    execution_id: "194",
    status: "COMPLETED"
  });
  const duplicateKeyB = buildCallbackIdempotencyKey({
    processing_job_id: "pj_test_001",
    correlation_id: "corr_test_001",
    execution_id: "194",
    status: "COMPLETED"
  });
  const duplicateKeyC = buildCallbackIdempotencyKey({
    processing_job_id: "pj_test_001",
    correlation_id: "corr_test_001",
    execution_id: "194",
    status: "FAILED"
  });

  assert.equal(duplicateKeyA, duplicateKeyB);
  assert.notEqual(duplicateKeyA, duplicateKeyC);

  const timestamp = new Date().toISOString();
  const rawBody = JSON.stringify({
    processing_job_id: "pj_test_001",
    status: "COMPLETED"
  });
  const secret = "callback-secret";
  const token = "callback-token";
  const signature = buildN8nCallbackSignature(secret, timestamp, rawBody);

  verifyN8nCallbackAuthentication({
    authorizationHeader: `Bearer ${token}`,
    expectedToken: token,
    timestampHeader: timestamp,
    signatureHeader: `sha256=${signature}`,
    rawBody,
    secret
  });

  expectThrows("stale callback timestamp", () => {
    verifyN8nCallbackAuthentication({
      authorizationHeader: `Bearer ${token}`,
      expectedToken: token,
      timestampHeader: "2026-07-14T00:00:00.000Z",
      signatureHeader: `sha256=${buildN8nCallbackSignature(
        secret,
        "2026-07-14T00:00:00.000Z",
        rawBody
      )}`,
      rawBody,
      secret
    });
  });
}

function main() {
  verifyLaunchContract();
  verifySuccessCallbackContract();
  verifyFailureCallbackContract();
  verifyIdempotencyAndAuth();

  console.log("verify-platform-n8n-contract: OK");
  console.log(
    "Coverage: contract validation, acceptance rules, callback auth, duplicate keys, provider-neutral stage mapping, XML parser compatibility."
  );
  console.log(
    "Limitation: no live PostgreSQL-backed end-to-end launch/callback scenario was executed in this script."
  );
}

main();
