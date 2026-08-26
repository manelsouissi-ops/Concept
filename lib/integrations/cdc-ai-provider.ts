export type CdcAiProvider = "gemini" | "local";

export type CdcAiPolicyErrorCode =
  | "CONFIDENTIAL_MODE_INVALID"
  | "BOOLEAN_CONFIGURATION_INVALID"
  | "CDC_AI_PROVIDER_INVALID"
  | "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED"
  | "CONFIDENTIAL_LOCAL_PROVIDER_NOT_READY"
  | "EXTERNAL_AI_COMPARISON_DISABLED"
  | "EXTERNAL_AI_CDC_NOT_AUTHORIZED";

export type CdcAiResolution = {
  confidentialMode: boolean;
  provider: CdcAiProvider;
  providerSource: "explicit" | "default";
  externalAiAllowed: boolean;
  launchAllowed: boolean;
  shadowAllowed: boolean;
  blockCode: CdcAiPolicyErrorCode | null;
};

function parseAuthorizedCodes(raw: string | undefined) {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

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
  if (normalized === "gemini" || normalized === "local") {
    return normalized;
  }
  throw new CdcAiPolicyError(
    "CDC_AI_PROVIDER_INVALID",
    "CDC_AI_PROVIDER doit valoir gemini ou local."
  );
}

export function resolveCdcAiProvider(
  env: NodeJS.ProcessEnv = process.env,
  codeInterne?: string
): CdcAiResolution {
  const confidentialMode = parseStrictBoolean("CONFIDENTIAL_MODE", env.CONFIDENTIAL_MODE, false);
  const explicitProvider = parseProvider(env.CDC_AI_PROVIDER);
  const provider = explicitProvider ?? "local";
  const providerSource = explicitProvider ? "explicit" as const : "default" as const;

  if (provider === "local") {
    return {
      confidentialMode,
      provider,
      providerSource,
      externalAiAllowed: false,
      launchAllowed: true,
      shadowAllowed: false,
      blockCode: null
    };
  }

  if (confidentialMode) {
    return {
      confidentialMode,
      provider,
      providerSource,
      externalAiAllowed: false,
      launchAllowed: false,
      shadowAllowed: false,
      blockCode: "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED"
    };
  }

  const comparisonEnabled = parseStrictBoolean(
    "EXTERNAL_AI_COMPARISON_ENABLED",
    env.EXTERNAL_AI_COMPARISON_ENABLED,
    false
  );
  if (!comparisonEnabled) {
    return {
      confidentialMode,
      provider,
      providerSource,
      externalAiAllowed: false,
      launchAllowed: false,
      shadowAllowed: false,
      blockCode: "EXTERNAL_AI_COMPARISON_DISABLED"
    };
  }

  const authorized = Boolean(codeInterne) && parseAuthorizedCodes(
    env.EXTERNAL_AI_AUTHORIZED_CDC_IDS
  ).has(codeInterne!);
  if (!authorized) {
    return {
      confidentialMode,
      provider,
      providerSource,
      externalAiAllowed: false,
      launchAllowed: false,
      shadowAllowed: false,
      blockCode: "EXTERNAL_AI_CDC_NOT_AUTHORIZED"
    };
  }

  return {
    confidentialMode,
    provider,
    providerSource,
    externalAiAllowed: true,
    launchAllowed: true,
    shadowAllowed: false,
    blockCode: null
  };
}

export function assertCdcAiLaunchAllowed(
  env: NodeJS.ProcessEnv = process.env,
  codeInterne?: string
) {
  const resolution = resolveCdcAiProvider(env, codeInterne);
  if (!resolution.launchAllowed || resolution.blockCode) {
    throw new CdcAiPolicyError(
      resolution.blockCode ?? "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED",
      resolution.blockCode === "EXTERNAL_AI_COMPARISON_DISABLED"
        ? "Le fournisseur externe CDC exige une activation explicite du mode de comparaison."
        : resolution.blockCode === "EXTERNAL_AI_CDC_NOT_AUTHORIZED"
          ? "Ce CDC n'est pas autorise pour une comparaison avec un fournisseur externe."
          : "Le mode confidentiel interdit tout lancement CDC vers un fournisseur externe."
    );
  }
  return resolution;
}

export function assertExternalCdcCallbackAllowed(
  env: NodeJS.ProcessEnv = process.env,
  codeInterne?: string,
  callbackProvider?: unknown
) {
  const resolution = resolveCdcAiProvider(env, codeInterne);
  if (callbackProvider === "local" && resolution.provider === "local") {
    return resolution;
  }
  if (!resolution.externalAiAllowed) {
    throw new CdcAiPolicyError(
      resolution.blockCode ?? "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED",
      "Ce callback CDC externe n'est pas autorise par la politique de confidentialite."
    );
  }
  return resolution;
}
