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

test("FCI B, C and D retain the existing Gemini provider", () => {
  for (const moduleCode of ["B", "C", "D"] as const) {
    assert.deepEqual(resolveFciProvider(moduleCode, "AO-SAFE", env({
      FCI_GENERATION_MODEL: "gemini-existing"
    })), { provider: "gemini", model: "gemini-existing" });
  }
});
