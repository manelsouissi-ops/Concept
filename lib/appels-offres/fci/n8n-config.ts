import { getFciContractRegistry } from "./contract-registry.ts";
import { resolveFciProvider } from "./provider-policy.ts";
import type { FciModuleCode } from "./types.ts";

export type FciN8nIntegrationConfig = {
  webhookUrl: string;
  webhookToken: string;
  callbackToken: string;
  callbackSecret: string;
  callbackMaxAgeMs: number;
  platformPublicBaseUrl: string;
  contractVersion: string;
  provider: string;
  model: string;
  launchTimeoutMs: number;
};

function requireNonEmptyEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`La variable d'environnement ${name} est obligatoire.`);
  }

  return value;
}

function readFirstNonEmptyEnv(names: readonly string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function requireOneOfEnv(...names: string[]) {
  const value = readFirstNonEmptyEnv(names);
  if (!value) {
    throw new Error(
      `L'une des variables d'environnement ${names.join(" ou ")} est obligatoire.`
    );
  }

  return value;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`La variable d'environnement ${name} doit etre un entier positif.`);
  }

  return parsed;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

export function getFciN8nContractVersion() {
  return process.env.FCI_N8N_CONTRACT_VERSION?.trim()
    || getFciContractRegistry().contractVersion;
}

export function getFciWebhookToken() {
  return requireOneOfEnv("FCI_N8N_WEBHOOK_TOKEN", "N8N_WEBHOOK_TOKEN");
}

export function getFciCallbackToken() {
  return requireOneOfEnv("FCI_CALLBACK_BEARER_TOKEN", "PLATFORM_CALLBACK_TOKEN");
}

export function getFciN8nIntegrationConfig(
  moduleCode?: FciModuleCode,
  codeInterne?: string
): FciN8nIntegrationConfig {
  const provider = moduleCode
    ? resolveFciProvider(moduleCode, codeInterne)
    : {
        provider: process.env.FCI_GENERATION_PROVIDER?.trim() || "gemini",
        model: requireNonEmptyEnv("FCI_GENERATION_MODEL")
      };
  return {
    webhookUrl: requireNonEmptyEnv("FCI_N8N_WEBHOOK_URL"),
    webhookToken: getFciWebhookToken(),
    callbackToken: getFciCallbackToken(),
    callbackSecret: requireNonEmptyEnv("FCI_CALLBACK_HMAC_SECRET"),
    callbackMaxAgeMs:
      readPositiveIntegerEnv("FCI_CALLBACK_MAX_AGE_SECONDS", 300) * 1000,
    platformPublicBaseUrl: normalizeBaseUrl(
      requireNonEmptyEnv("PLATFORM_PUBLIC_BASE_URL")
    ),
    contractVersion: getFciN8nContractVersion(),
    provider: provider.provider,
    model: provider.model,
    launchTimeoutMs: readPositiveIntegerEnv("FCI_N8N_LAUNCH_TIMEOUT_MS", 10_000)
  };
}

export function buildFciCallbackUrl(baseUrl: string) {
  return `${normalizeBaseUrl(baseUrl)}/api/fci/callbacks/n8n`;
}
