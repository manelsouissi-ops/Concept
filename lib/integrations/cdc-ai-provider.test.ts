import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCdcAiLaunchAllowed,
  assertExternalCdcCallbackAllowed,
  CdcAiPolicyError,
  resolveCdcAiProvider
} from "./cdc-ai-provider.ts";

const env = (values: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({ ...values } as NodeJS.ProcessEnv);

test("local is the fail-closed default provider", () => {
  const resolution = resolveCdcAiProvider(env({}));
  assert.equal(resolution.provider, "local");
  assert.equal(resolution.launchAllowed, true);
  assert.equal(resolution.externalAiAllowed, false);
  assert.equal(resolution.shadowAllowed, false);
});

test("confidential local generation is allowed", () => {
  const resolution = assertCdcAiLaunchAllowed(env({ CONFIDENTIAL_MODE: "true" }), "AO-SAFE");
  assert.equal(resolution.provider, "local");
  assert.equal(resolution.launchAllowed, true);
});

test("local generation failure has no external fallback", () => {
  const resolution = resolveCdcAiProvider(env({ CDC_AI_PROVIDER: "local" }), "AO-SAFE");
  assert.equal(resolution.provider, "local");
  assert.equal(resolution.externalAiAllowed, false);
  assert.equal(resolution.shadowAllowed, false);
});

test("Gemini requires explicit comparison opt-in", () => {
  assert.throws(
    () => assertCdcAiLaunchAllowed(env({ CDC_AI_PROVIDER: "gemini" }), "AO-AUTHORIZED"),
    (error) => error instanceof CdcAiPolicyError && error.code === "EXTERNAL_AI_COMPARISON_DISABLED"
  );
});

test("non-allowlisted CDC cannot select Gemini", () => {
  assert.throws(
    () => assertCdcAiLaunchAllowed(env({
      CDC_AI_PROVIDER: "gemini",
      EXTERNAL_AI_COMPARISON_ENABLED: "true",
      EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-OTHER"
    }), "AO-NOT-AUTHORIZED"),
    (error) => error instanceof CdcAiPolicyError && error.code === "EXTERNAL_AI_CDC_NOT_AUTHORIZED"
  );
});

test("allowlisted CDC may use explicit Gemini comparison mode", () => {
  const resolution = assertCdcAiLaunchAllowed(env({
    CDC_AI_PROVIDER: "gemini",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-FIRST, AO-AUTHORIZED"
  }), "AO-AUTHORIZED");
  assert.equal(resolution.provider, "gemini");
  assert.equal(resolution.externalAiAllowed, true);
});

test("confidential mode blocks Gemini even when allowlisted", () => {
  assert.throws(
    () => assertCdcAiLaunchAllowed(env({
      CONFIDENTIAL_MODE: "true",
      CDC_AI_PROVIDER: "gemini",
      EXTERNAL_AI_COMPARISON_ENABLED: "true",
      EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-AUTHORIZED"
    }), "AO-AUTHORIZED"),
    (error) => error instanceof CdcAiPolicyError && error.code === "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED"
  );
});

test("legacy shadow flag no longer enables automatic comparison", () => {
  const resolution = resolveCdcAiProvider(env({ LOCAL_RAG_SHADOW_ENABLED: "true" }), "AO-SAFE");
  assert.equal(resolution.provider, "local");
  assert.equal(resolution.shadowAllowed, false);
});

test("strict boolean parsing rejects arbitrary values", () => {
  assert.throws(
    () => resolveCdcAiProvider(env({ CONFIDENTIAL_MODE: "yes" })),
    (error) => error instanceof CdcAiPolicyError && error.code === "CONFIDENTIAL_MODE_INVALID"
  );
});

test("local callback is accepted only while local is authoritative", () => {
  const resolution = assertExternalCdcCallbackAllowed(env({}), "AO-SAFE", "local");
  assert.equal(resolution.provider, "local");
});

test("unlabelled external callback fails closed under local authority", () => {
  assert.throws(
    () => assertExternalCdcCallbackAllowed(env({}), "AO-SAFE", undefined),
    CdcAiPolicyError
  );
});

test("authorized Gemini callback follows the same allowlist policy", () => {
  const resolution = assertExternalCdcCallbackAllowed(env({
    CDC_AI_PROVIDER: "gemini",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-AUTHORIZED"
  }), "AO-AUTHORIZED", "gemini");
  assert.equal(resolution.externalAiAllowed, true);
});
