import { CdcAiPolicyError, parseStrictBoolean } from "../../integrations/cdc-ai-provider.ts";
import type { FciModuleCode } from "./types.ts";

export type FciProviderResolution = {
  provider: "local" | "gemini";
  model: string;
};

function authorizedCodes(raw: string | undefined) {
  return new Set((raw ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

const LOCAL_ELIGIBLE_MODULES: Partial<Record<FciModuleCode, { envVar: string; label: string }>> = {
  A: { envVar: "FCI_A_GENERATION_PROVIDER", label: "FCI A" },
  B: { envVar: "FCI_B_GENERATION_PROVIDER", label: "FCI B" }
};

/** FCI A and B are local by default. The legacy C/D provider remains unchanged. */
export function resolveFciProvider(
  moduleCode: FciModuleCode,
  codeInterne: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): FciProviderResolution {
  const localEligible = LOCAL_ELIGIBLE_MODULES[moduleCode];
  if (!localEligible) {
    return {
      provider: "gemini",
      model: env.FCI_GENERATION_MODEL?.trim() || "gemini-3.6-flash"
    };
  }

  const requested = env[localEligible.envVar]?.trim().toLowerCase() || "local";
  if (requested !== "local" && requested !== "gemini") {
    throw new CdcAiPolicyError(
      "CDC_AI_PROVIDER_INVALID",
      `${localEligible.envVar} doit valoir local ou gemini.`
    );
  }

  if (requested === "local") {
    return {
      provider: "local",
      model: env.LOCAL_FCI_MODEL?.trim() || "qwen3:14b"
    };
  }

  if (parseStrictBoolean("CONFIDENTIAL_MODE", env.CONFIDENTIAL_MODE, false)) {
    throw new CdcAiPolicyError(
      "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED",
      `Le mode confidentiel interdit ${localEligible.label} sur un fournisseur externe.`
    );
  }
  if (!parseStrictBoolean(
    "EXTERNAL_AI_COMPARISON_ENABLED",
    env.EXTERNAL_AI_COMPARISON_ENABLED,
    false
  )) {
    throw new CdcAiPolicyError(
      "EXTERNAL_AI_COMPARISON_DISABLED",
      `La comparaison externe ${localEligible.label} exige une activation explicite.`
    );
  }
  if (!codeInterne || !authorizedCodes(env.EXTERNAL_AI_AUTHORIZED_CDC_IDS).has(codeInterne)) {
    throw new CdcAiPolicyError(
      "EXTERNAL_AI_CDC_NOT_AUTHORIZED",
      `Ce CDC n'est pas autorise pour une comparaison ${localEligible.label} externe.`
    );
  }

  return {
    provider: "gemini",
    model: env.FCI_GENERATION_MODEL?.trim() || "gemini-3.6-flash"
  };
}
