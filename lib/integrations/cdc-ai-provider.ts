export type CdcAiProvider = "gemini" | "shadow" | "local";

export type CdcAiPolicyErrorCode =
  | "CONFIDENTIAL_MODE_INVALID"
  | "BOOLEAN_CONFIGURATION_INVALID"
  | "CDC_AI_PROVIDER_INVALID"
  | "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED"
  | "CONFIDENTIAL_LOCAL_PROVIDER_NOT_READY"
  | "LOCAL_CANONICAL_CONTRACT_NOT_READY";

export type CdcAiResolution = {
  confidentialMode: boolean;
  provider: CdcAiProvider;
  providerSource: "explicit" | "legacy-shadow-flag" | "default";
  externalAiAllowed: boolean;
  launchAllowed: boolean;
  shadowAllowed: boolean;
  blockCode: CdcAiPolicyErrorCode | null;
};

export class CdcAiPolicyError extends Error {
  readonly code: CdcAiPolicyErrorCode;

  constructor(code: CdcAiPolicyErrorCode, message: string) {
    super(message);
    this.name = "CdcAiPolicyError";
    this.code = code;
  }
}

export function parseStrictBoolean(name: string, raw: string | undefined, fallback = false) {
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new CdcAiPolicyError(
    name === "CONFIDENTIAL_MODE" ? "CONFIDENTIAL_MODE_INVALID" : "BOOLEAN_CONFIGURATION_INVALID",
    `${name} doit valoir exactement true ou false.`
  );
}

function parseProvider(raw: string | undefined): CdcAiProvider | null {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "gemini" || normalized === "shadow" || normalized === "local") {
    return normalized;
  }
  throw new CdcAiPolicyError(
    "CDC_AI_PROVIDER_INVALID",
    "CDC_AI_PROVIDER doit valoir gemini, shadow ou local."
  );
}

export function resolveCdcAiProvider(env: NodeJS.ProcessEnv = process.env): CdcAiResolution {
  const confidentialMode = parseStrictBoolean("CONFIDENTIAL_MODE", env.CONFIDENTIAL_MODE, false);
  const explicitProvider = parseProvider(env.CDC_AI_PROVIDER);
  const legacyShadow = parseStrictBoolean(
    "LOCAL_RAG_SHADOW_ENABLED",
    env.LOCAL_RAG_SHADOW_ENABLED,
    false
  );
  const provider = explicitProvider ?? (legacyShadow ? "shadow" : "gemini");
  const providerSource = explicitProvider
    ? "explicit" as const
    : legacyShadow
      ? "legacy-shadow-flag" as const
      : "default" as const;

  if (confidentialMode) {
    return {
      confidentialMode,
      provider,
      providerSource,
      externalAiAllowed: false,
      launchAllowed: false,
      shadowAllowed: false,
      blockCode: provider === "local"
        ? "CONFIDENTIAL_LOCAL_PROVIDER_NOT_READY"
        : "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED"
    };
  }

  if (provider === "local") {
    return {
      confidentialMode,
      provider,
      providerSource,
      externalAiAllowed: false,
      launchAllowed: false,
      shadowAllowed: false,
      blockCode: "LOCAL_CANONICAL_CONTRACT_NOT_READY"
    };
  }

  return {
    confidentialMode,
    provider,
    providerSource,
    externalAiAllowed: true,
    launchAllowed: true,
    shadowAllowed: provider === "shadow",
    blockCode: null
  };
}

export function assertCdcAiLaunchAllowed(env: NodeJS.ProcessEnv = process.env) {
  const resolution = resolveCdcAiProvider(env);
  if (!resolution.launchAllowed || resolution.blockCode) {
    throw new CdcAiPolicyError(
      resolution.blockCode ?? "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED",
      resolution.blockCode === "CONFIDENTIAL_LOCAL_PROVIDER_NOT_READY"
        ? "Le mode confidentiel exige le fournisseur local, mais l'autorite locale CDC n'est pas prete."
        : resolution.blockCode === "LOCAL_CANONICAL_CONTRACT_NOT_READY"
          ? "Le fournisseur local CDC n'est pas encore autorise comme source officielle."
          : "Le mode confidentiel interdit tout lancement CDC vers un fournisseur externe."
    );
  }
  return resolution;
}

export function assertExternalCdcCallbackAllowed(env: NodeJS.ProcessEnv = process.env) {
  const resolution = resolveCdcAiProvider(env);
  if (resolution.confidentialMode) {
    throw new CdcAiPolicyError(
      "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED",
      "Un callback CDC externe est interdit lorsque CONFIDENTIAL_MODE=true."
    );
  }
  return resolution;
}
