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

test("non-confidential Gemini remains the default and permitted", () => {
  const resolution = resolveCdcAiProvider(env({ CONFIDENTIAL_MODE: "false", CDC_AI_PROVIDER: "gemini" }));
  assert.equal(resolution.provider, "gemini");
  assert.equal(resolution.launchAllowed, true);
  assert.equal(resolution.externalAiAllowed, true);
});

for (const provider of ["gemini", "shadow"] as const) {
  test(`confidential ${provider} is blocked before an external call`, () => {
    let geminiCalls = 0;
    assert.throws(
      () => {
        assertCdcAiLaunchAllowed(env({ CONFIDENTIAL_MODE: "true", CDC_AI_PROVIDER: provider }));
        geminiCalls += 1;
      },
      (error) => error instanceof CdcAiPolicyError && error.code === "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED"
    );
    assert.equal(geminiCalls, 0);
  });
}

test("confidential local fails closed while local authority is not ready", () => {
  let externalCalls = 0;
  assert.throws(
    () => {
      assertCdcAiLaunchAllowed(env({ CONFIDENTIAL_MODE: "true", CDC_AI_PROVIDER: "local" }));
      externalCalls += 1;
    },
    (error) => error instanceof CdcAiPolicyError && error.code === "CONFIDENTIAL_LOCAL_PROVIDER_NOT_READY"
  );
  assert.equal(externalCalls, 0);
});

test("legacy shadow flag cannot bypass confidentiality", () => {
  const resolution = resolveCdcAiProvider(env({
    CONFIDENTIAL_MODE: "true",
    LOCAL_RAG_SHADOW_ENABLED: "true"
  }));
  assert.equal(resolution.provider, "shadow");
  assert.equal(resolution.launchAllowed, false);
  assert.equal(resolution.shadowAllowed, false);
  assert.equal(resolution.externalAiAllowed, false);
});

test("explicit provider is authoritative over the legacy shadow flag", () => {
  const resolution = resolveCdcAiProvider(env({
    CONFIDENTIAL_MODE: "false",
    CDC_AI_PROVIDER: "gemini",
    LOCAL_RAG_SHADOW_ENABLED: "true"
  }));
  assert.equal(resolution.provider, "gemini");
  assert.equal(resolution.shadowAllowed, false);
  assert.equal(resolution.providerSource, "explicit");
});

test("legacy shadow flag remains compatible only when provider is unset", () => {
  const resolution = resolveCdcAiProvider(env({
    CONFIDENTIAL_MODE: "false",
    LOCAL_RAG_SHADOW_ENABLED: "true"
  }));
  assert.equal(resolution.provider, "shadow");
  assert.equal(resolution.shadowAllowed, true);
  assert.equal(resolution.providerSource, "legacy-shadow-flag");
});

test("strict boolean parsing rejects arbitrary non-empty values", () => {
  assert.throws(
    () => resolveCdcAiProvider(env({ CONFIDENTIAL_MODE: "yes" })),
    (error) => error instanceof CdcAiPolicyError && error.code === "CONFIDENTIAL_MODE_INVALID"
  );
});

test("confidential external callback is blocked before persistence", () => {
  let persistenceCalls = 0;
  assert.throws(() => {
    assertExternalCdcCallbackAllowed(env({ CONFIDENTIAL_MODE: "true", CDC_AI_PROVIDER: "gemini" }));
    persistenceCalls += 1;
  }, CdcAiPolicyError);
  assert.equal(persistenceCalls, 0);
});
