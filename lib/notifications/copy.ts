import type { FciModuleCode } from "../appels-offres/fci/types.ts";
import type { BusinessNotificationEventType } from "./types.ts";

function getModuleLabel(moduleCode: FciModuleCode | null | undefined) {
  switch (moduleCode) {
    case "A":
      return "Commerciale";
    case "B":
      return "Finance";
    case "C":
      return "Operations";
    case "D":
      return "Direction generale";
    default:
      return "FCI";
  }
}

function getDecisionLabel(decision: unknown) {
  return decision === "no_go" ? "No-Go" : "Go";
}

export function buildNotificationCopy(input: {
  eventType: BusinessNotificationEventType;
  appelOffreCode: string;
  moduleCode?: FciModuleCode | null;
  metadata?: Record<string, unknown> | null;
}) {
  const moduleLabel = getModuleLabel(input.moduleCode ?? null);
  const actorName =
    typeof input.metadata?.actorName === "string" ? input.metadata.actorName : null;
  const assignedUserName =
    typeof input.metadata?.assignedUserName === "string"
      ? input.metadata.assignedUserName
      : null;
  const decision = getDecisionLabel(input.metadata?.decision);

  switch (input.eventType) {
    case "FCI_ASSIGNED":
      return {
        title: `Contribution ${moduleLabel} affectee`,
        message: assignedUserName
          ? `Le module ${moduleLabel} du dossier ${input.appelOffreCode} vous a ete affecte.`
          : `Le module ${moduleLabel} du dossier ${input.appelOffreCode} a ete affecte.`
      };
    case "FCI_REASSIGNED":
      return {
        title: `Contribution ${moduleLabel} reaffectee`,
        message: `Le module ${moduleLabel} du dossier ${input.appelOffreCode} a ete reaffecte.`
      };
    case "FCI_STARTED":
      return {
        title: `Contribution ${moduleLabel} en cours`,
        message: actorName
          ? `${actorName} a commence la contribution ${moduleLabel} pour ${input.appelOffreCode}.`
          : `La contribution ${moduleLabel} est en cours sur ${input.appelOffreCode}.`
      };
    case "FCI_COMPLETED":
      return {
        title: `Contribution ${moduleLabel} completee`,
        message: actorName
          ? `${actorName} a termine la contribution ${moduleLabel} pour ${input.appelOffreCode}.`
          : `La contribution ${moduleLabel} est completee sur ${input.appelOffreCode}.`
      };
    case "FCI_VALIDATED":
      return {
        title: `Contribution ${moduleLabel} validee`,
        message: actorName
          ? `${actorName} a valide la contribution ${moduleLabel} du dossier ${input.appelOffreCode}.`
          : `La contribution ${moduleLabel} du dossier ${input.appelOffreCode} est validee.`
      };
    case "FCI_RETURNED":
      return {
        title: `Contribution ${moduleLabel} a reprendre`,
        message: `La contribution ${moduleLabel} du dossier ${input.appelOffreCode} doit etre reprise.`
      };
    case "FCI_BLOCKED":
      return {
        title: `Contribution ${moduleLabel} bloquee`,
        message: `La contribution ${moduleLabel} du dossier ${input.appelOffreCode} requiert une attention.`
      };
    case "READY_FOR_GONOGO":
      return {
        title: "Dossier pret pour Go/No-Go",
        message: `Les contributions A, B et C du dossier ${input.appelOffreCode} sont validees.`
      };
    case "GONOGO_REPORT_GENERATED":
      return {
        title: "Rapport Go/No-Go genere",
        message: `Le dossier ${input.appelOffreCode} dispose d'un rapport Go/No-Go brouillon a relire.`
      };
    case "GONOGO_REPORT_READY_FOR_REVIEW":
      return {
        title: "Rapport Go/No-Go a relire",
        message: `Le rapport Go/No-Go du dossier ${input.appelOffreCode} est pret pour revue commerciale.`
      };
    case "GONOGO_REPORT_PREPARED":
      return {
        title: "Rapport Go/No-Go prepare",
        message: `Le rapport Go/No-Go du dossier ${input.appelOffreCode} est prepare pour soumission.`
      };
    case "GONOGO_REPORT_SUBMITTED":
      return {
        title: "Rapport Go/No-Go soumis",
        message: `Le rapport Go/No-Go du dossier ${input.appelOffreCode} a ete soumis a la Direction generale.`
      };
    case "GONOGO_REPORT_REOPENED":
      return {
        title: "Rapport Go/No-Go rouvert",
        message: `Une nouvelle version du rapport Go/No-Go est requise pour ${input.appelOffreCode}.`
      };
    case "GONOGO_REPORT_STALE":
      return {
        title: "Rapport Go/No-Go obsolete",
        message: `Le rapport Go/No-Go du dossier ${input.appelOffreCode} doit etre regenere avant soumission.`
      };
    case "GONOGO_REPORT_EXPORTED":
      return {
        title: "Rapport Go/No-Go exporte",
        message: `Un export officiel du rapport Go/No-Go du dossier ${input.appelOffreCode} a ete prepare.`
      };
    case "GONOGO_PREPARED":
      return {
        title: "Package Go/No-Go prepare",
        message: `Le dossier ${input.appelOffreCode} est pret a etre soumis a la Direction generale.`
      };
    case "SUBMITTED_TO_DG":
      return {
        title: "Dossier soumis a la DG",
        message: `Le dossier ${input.appelOffreCode} attend une decision Go/No-Go de la Direction generale.`
      };
    case "DG_DECISION_MADE":
      return {
        title: `Decision ${decision} enregistree`,
        message: `La Direction generale a rendu une decision ${decision} pour le dossier ${input.appelOffreCode}.`
      };
    case "COMMERCIAL_OWNER_ASSIGNED":
      return {
        title: "Responsable commercial attribue",
        message: `Vous etes desormais responsable du dossier ${input.appelOffreCode}.`
      };
    case "COMMERCIAL_OWNER_TRANSFERRED":
      return {
        title: "Responsabilite commerciale transferee",
        message: `La responsabilite du dossier ${input.appelOffreCode} a ete transferee.`
      };
    case "COMMERCIAL_OWNER_RECOVERY_REQUIRED":
      return {
        title: "Reaffectation commerciale requise",
        message: `Le dossier ${input.appelOffreCode} doit etre reattribue a un responsable commercial actif.`
      };
    case "COMMERCIAL_OWNER_TARGET_INACTIVE":
      return {
        title: "Responsable commercial inactif",
        message: `Le dossier ${input.appelOffreCode} depend d'un responsable commercial inactif.`
      };
    case "REMINDER_SENT":
      return {
        title: `Rappel ${moduleLabel} envoye`,
        message: `Un rappel a ete envoye pour la contribution ${moduleLabel} du dossier ${input.appelOffreCode}.`
      };
    default:
      return {
        title: "Notification dossier",
        message: `Une mise a jour est disponible pour le dossier ${input.appelOffreCode}.`
      };
  }
}
