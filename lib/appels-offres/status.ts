import type { AppelOffresStatus } from "./types.ts";

export const APPEL_OFFRES_STORED_STATUSES = [
  "draft",
  "processing",
  "ready",
  "error",
  "archived"
] as const satisfies readonly AppelOffresStatus[];

export function isAppelOffresStatus(value: string): value is AppelOffresStatus {
  return APPEL_OFFRES_STORED_STATUSES.includes(value as AppelOffresStatus);
}

export function getAppelOffresStatusLabel(status: AppelOffresStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "processing":
      return "En traitement";
    case "ready":
      return "Prêt";
    case "error":
      return "Erreur";
    case "archived":
      return "Archivé";
  }
}
