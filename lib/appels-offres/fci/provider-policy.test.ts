import test from "node:test";
import assert from "node:assert/strict";
import { resolveFciProvider } from "./provider-policy.ts";

const env = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

test("FCI A defaults to local qwen3:14b", () => {
  assert.deepEqual(resolveFciProvider("A", "AO-SAFE", env({})), {
    provider: "local",
    model: "qwen3:14b"
  });
});

test("FCI A external generation is fail-closed and allowlisted", () => {
  assert.throws(() => resolveFciProvider("A", "AO-SAFE", env({
    FCI_A_GENERATION_PROVIDER: "gemini",
    CONFIDENTIAL_MODE: "true",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-SAFE"
  })));
  assert.throws(() => resolveFciProvider("A", "AO-SAFE", env({
    FCI_A_GENERATION_PROVIDER: "gemini",
    CONFIDENTIAL_MODE: "false",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: ""
  })));
});

test("FCI B defaults to local qwen3:14b", () => {
  assert.deepEqual(resolveFciProvider("B", "AO-SAFE", env({})), {
    provider: "local",
    model: "qwen3:14b"
  });
});

test("FCI B external generation is fail-closed and allowlisted", () => {
  assert.throws(() => resolveFciProvider("B", "AO-SAFE", env({
    FCI_B_GENERATION_PROVIDER: "gemini",
    CONFIDENTIAL_MODE: "true",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-SAFE"
  })));
  assert.throws(() => resolveFciProvider("B", "AO-SAFE", env({
    FCI_B_GENERATION_PROVIDER: "gemini",
    CONFIDENTIAL_MODE: "false",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: ""
  })));
});

test("FCI B external generation succeeds only when explicitly allowlisted and non-confidential", () => {
  assert.deepEqual(resolveFciProvider("B", "AO-SAFE", env({
    FCI_B_GENERATION_PROVIDER: "gemini",
    CONFIDENTIAL_MODE: "false",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-SAFE",
    FCI_GENERATION_MODEL: "gemini-existing"
  })), { provider: "gemini", model: "gemini-existing" });
});

test("FCI A and B providers are resolved independently of each other", () => {
  assert.deepEqual(resolveFciProvider("A", "AO-SAFE", env({
    FCI_A_GENERATION_PROVIDER: "local",
    FCI_B_GENERATION_PROVIDER: "gemini",
    CONFIDENTIAL_MODE: "false",
    EXTERNAL_AI_COMPARISON_ENABLED: "true",
    EXTERNAL_AI_AUTHORIZED_CDC_IDS: "AO-SAFE"
  })), { provider: "local", model: "qwen3:14b" });
});

test("FCI C and D retain the existing Gemini provider and cannot be routed local", () => {
  for (const moduleCode of ["C", "D"] as const) {
    assert.deepEqual(resolveFciProvider(moduleCode, "AO-SAFE", env({
      FCI_GENERATION_MODEL: "gemini-existing"
    })), { provider: "gemini", model: "gemini-existing" });
  }
});
