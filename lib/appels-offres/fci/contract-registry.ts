import type { FciAiSupportedModuleCode } from "./ai-contracts.ts";

export const FCI_CONTRACT_REGISTRY = {
  contractVersion: "1.0",
  schemaVersion: "1.1",
  promptVersion: "1.1",
  supportedModules: ["A", "B", "C", "D"] as const satisfies readonly FciAiSupportedModuleCode[]
};

export type FciContractRegistry = typeof FCI_CONTRACT_REGISTRY;

export function getFciContractRegistry() {
  return FCI_CONTRACT_REGISTRY;
}

export function isSupportedFciContractVersion(
  contractVersion: string | null | undefined
) {
  return contractVersion === FCI_CONTRACT_REGISTRY.contractVersion;
}

export function formatFciContractVersion(
  contractVersion: string | null | undefined
) {
  if (!contractVersion) {
    return "Version de contrat inconnue";
  }

  return `Contrat IA : v${contractVersion}`;
}
