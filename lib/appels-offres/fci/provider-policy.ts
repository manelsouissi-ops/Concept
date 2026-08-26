import { CdcAiPolicyError, parseStrictBoolean } from "../../integrations/cdc-ai-provider.ts";
import type { FciModuleCode } from "./types.ts";

export type FciProviderResolution = {
  provider: "local" | "gemini";
  model: string;
};

function authorizedCodes(raw: string | undefined) {
  return new Set((raw ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

/** FCI A is local by default. The legacy B/C/D provider remains unchanged. */
export function resolveFciProvider(
  moduleCode: FciModuleCode,
  codeInterne: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): FciProviderResolution {
  if (moduleCode !== "A") {
    return {
      provider: "gemini",
      model: env.FCI_GENERATION_MODEL?.trim() || "gemini-3.6-flash"
    };
  }

  const requested = env.FCI_A_GENERATION_PROVIDER?.trim().toLowerCase() || "local";
  if (requested !== "local" && requested !== "gemini") {
    throw new CdcAiPolicyError(
      "CDC_AI_PROVIDER_INVALID",
      "FCI_A_GENERATION_PROVIDER doit valoir local ou gemini."
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
      "Le mode confidentiel interdit FCI A sur un fournisseur externe."
    );
  }
  if (!parseStrictBoolean(
    "EXTERNAL_AI_COMPARISON_ENABLED",
    env.EXTERNAL_AI_COMPARISON_ENABLED,
    false
  )) {
    throw new CdcAiPolicyError(
      "EXTERNAL_AI_COMPARISON_DISABLED",
      "La comparaison externe FCI A exige une activation explicite."
    );
  }
  if (!codeInterne || !authorizedCodes(env.EXTERNAL_AI_AUTHORIZED_CDC_IDS).has(codeInterne)) {
    throw new CdcAiPolicyError(
      "EXTERNAL_AI_CDC_NOT_AUTHORIZED",
      "Ce CDC n'est pas autorise pour une comparaison FCI A externe."
    );
  }

  return {
    provider: "gemini",
    model: env.FCI_GENERATION_MODEL?.trim() || "gemini-3.6-flash"
  };
}
