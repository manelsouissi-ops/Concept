import { DEFAULT_N8N_CONTRACT_VERSION } from "./n8n-contract.ts";

export type N8nIntegrationConfig = {
  webhookUrl: string;
  webhookToken: string;
  callbackToken: string;
  callbackSecret: string;
  platformPublicBaseUrl: string;
  contractVersion: string;
  launchTimeoutMs: number;
  maxCdcUploadBytes: number;
};

function requireNonEmptyEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`La variable d'environnement ${name} est obligatoire.`);
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

export function getN8nIntegrationConfig(): N8nIntegrationConfig {
  return {
    webhookUrl: requireNonEmptyEnv("N8N_WEBHOOK_URL"),
    webhookToken: requireNonEmptyEnv("N8N_WEBHOOK_TOKEN"),
    callbackToken: requireNonEmptyEnv("PLATFORM_CALLBACK_TOKEN"),
    callbackSecret: requireNonEmptyEnv("N8N_CALLBACK_SECRET"),
    platformPublicBaseUrl: normalizeBaseUrl(requireNonEmptyEnv("PLATFORM_PUBLIC_BASE_URL")),
    contractVersion:
      process.env.N8N_CONTRACT_VERSION?.trim() || DEFAULT_N8N_CONTRACT_VERSION,
    launchTimeoutMs: readPositiveIntegerEnv("N8N_LAUNCH_TIMEOUT_MS", 10_000),
    maxCdcUploadBytes: readPositiveIntegerEnv("MAX_CDC_UPLOAD_BYTES", 50 * 1024 * 1024)
  };
}

export function buildCanonicalCallbackUrl(baseUrl: string) {
  return `${normalizeBaseUrl(baseUrl)}/api/fiche/callbacks/n8n`;
}
