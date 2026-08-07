import test from "node:test";
import assert from "node:assert/strict";
import { buildLoginHref, getSafeRedirectTarget, getSafeRedirectTargetForRole } from "./paths.ts";
import { isDevelopmentUserSwitcherEnabled } from "./config.ts";

function withEnvValue(name: string, value: string | undefined, callback: () => void) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

test("safe redirect keeps only local non-authenticated application paths", () => {
  assert.equal(getSafeRedirectTarget("/appels-offres/AO-1", "/dashboard"), "/appels-offres/AO-1");
  assert.equal(getSafeRedirectTarget("//evil.example", "/dashboard"), "/dashboard");
  assert.equal(getSafeRedirectTarget("https://evil.example", "/dashboard"), "/dashboard");
  assert.equal(getSafeRedirectTarget("/login?next=/dashboard", "/dashboard"), "/dashboard");
  assert.equal(getSafeRedirectTarget("/api/secret", "/dashboard"), "/dashboard");
});

test("buildLoginHref preserves a safe local next parameter", () => {
  assert.equal(
    buildLoginHref("/appels-offres/AO-20260727-0945?view=fci"),
    "/login?next=%2Fappels-offres%2FAO-20260727-0945%3Fview%3Dfci"
  );
});

test("role-safe redirects fall back to the correct landing page when the next path is forbidden", () => {
  assert.equal(getSafeRedirectTargetForRole("ADMIN", "/dashboard"), "/administration");
  assert.equal(
    getSafeRedirectTargetForRole("ADMIN", "/appels-offres/AO-20260727-0945?view=fci"),
    "/administration"
  );
  assert.equal(getSafeRedirectTargetForRole("ADMIN", "/administration/utilisateurs"), "/administration/utilisateurs");
  assert.equal(
    getSafeRedirectTargetForRole("COMMERCIAL", "/appels-offres/AO-20260727-0945?view=fci"),
    "/appels-offres/AO-20260727-0945?view=fci"
  );
});

test("development user switcher stays disabled unless explicitly enabled in development", () => {
  withEnvValue("NODE_ENV", "development", () => {
    withEnvValue("CONCEPT_ENABLE_DEV_USER_SWITCHER", "true", () => {
      assert.equal(isDevelopmentUserSwitcherEnabled(), true);
    });

    withEnvValue("CONCEPT_ENABLE_DEV_USER_SWITCHER", "false", () => {
      assert.equal(isDevelopmentUserSwitcherEnabled(), false);
    });
  });

  withEnvValue("NODE_ENV", "production", () => {
    withEnvValue("CONCEPT_ENABLE_DEV_USER_SWITCHER", "true", () => {
      assert.equal(isDevelopmentUserSwitcherEnabled(), false);
    });
  });
});
