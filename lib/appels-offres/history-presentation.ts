import type { AuditLogRecord } from "./types.ts";
import type { FciAuditEventRecord } from "./fci/types.ts";
import type { BadgeTone } from "./presentation.ts";

// Centralized raw-event -> business-facing presentation for the Commercial
// "Historique" workspace. Keeps technical/infrastructure audit rows (n8n
// launches, callbacks, workflow state mirrors, report bookkeeping...) out of
// the default business view without deleting them from the persisted audit
// trail - they simply map to `null` here and get filtered out by callers.

export type HistoryEventCategory = "general" | "fiche" | "fci" | "gonogo" | "decision";

export type HistoryEventPresentation = {
  category: HistoryEventCategory;
  title: string;
  description: string | null;
  result: string | null;
  tone: BadgeTone;
};

function truncate(value: unknown, maxLength = 140): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function fileDescription(details: Record<string, unknown> | null) {
  const fileName = details && typeof details.fileName === "string" ? details.fileName : null;
  return fileName ? `Fichier : ${fileName}` : null;
}

function moduleCodeOf(payload: Record<string, unknown> | null) {
  return payload && typeof payload.moduleCode === "string" ? payload.moduleCode : null;
}

const MODULE_DEPARTMENT_LABEL: Record<string, string> = {
  A: "FCI Commerciale",
  B: "FCI Financière",
  C: "FCI Opérationnelle",
  D: "FCI Direction Générale"
};

function moduleLabel(payload: Record<string, unknown> | null) {
  const code = moduleCodeOf(payload);
  return (code && MODULE_DEPARTMENT_LABEL[code]) || "FCI";
}

/**
 * Maps a tender-level audit_logs row (`AppelOffresDetail.auditLogs`) to a
 * business-facing presentation. Returns null for technical/infrastructure
 * events, which should be hidden from the default Commercial history view.
 */
export function mapTenderAuditEvent(entry: AuditLogRecord): HistoryEventPresentation | null {
  const details = entry.details ?? null;

  switch (entry.action) {
    case "appel_offres.created":
      return { category: "general", title: "Appel d'offres créé", description: null, result: null, tone: "neutral" };
    case "appel_offres.cdc_uploaded":
      return { category: "fiche", title: "Document CDC déposé", description: fileDescription(details), result: null, tone: "neutral" };
    case "appel_offres.archived":
      return { category: "general", title: "Dossier archivé", description: null, result: null, tone: "neutral" };
    case "appel_offres.unarchived":
      return { category: "general", title: "Dossier réactivé", description: null, result: null, tone: "success" };
    case "fiche_cdc_generated":
      return { category: "fiche", title: "Fiche CDC générée", description: null, result: null, tone: "ai" };
    case "fiche_cdc.validated":
      return { category: "fiche", title: "Fiche CDC validée", description: null, result: null, tone: "success" };
    case "analysis_failed":
    case "n8n_launch_failed":
      return { category: "fiche", title: "Fiche CDC à vérifier", description: "La génération n'a pas pu être terminée.", result: null, tone: "warning" };
    case "go_no_go.decided_go":
      return { category: "decision", title: "Décision GO", description: truncate(details?.rationale), result: "GO", tone: "success" };
    case "go_no_go.decided_no_go":
      return { category: "decision", title: "Décision NO-GO", description: truncate(details?.rationale), result: "NO-GO", tone: "danger" };
    case "go_no_go.reopened":
      return { category: "decision", title: "Décision réouverte", description: null, result: null, tone: "warning" };
    case "workflow.gonogo_prepared":
      return { category: "gonogo", title: "Rapport Go/No-Go préparé", description: null, result: null, tone: "info" };
    case "workflow.submitted_to_dg":
      return { category: "gonogo", title: "Soumis à la Direction Générale", description: null, result: null, tone: "info" };
    case "workflow.under_dg_review":
      return { category: "gonogo", title: "Dossier en revue à la Direction Générale", description: null, result: null, tone: "neutral" };
    case "go_no_go_report.generated":
      return { category: "gonogo", title: "Rapport Go/No-Go généré", description: null, result: null, tone: "ai" };
    case "go_no_go_report.edited":
      return { category: "gonogo", title: "Rapport Go/No-Go modifié", description: null, result: null, tone: "neutral" };
    case "go_no_go_report.prepared":
      return { category: "gonogo", title: "Rapport marqué comme prêt", description: null, result: null, tone: "info" };
    case "go_no_go_report.submitted":
      return { category: "gonogo", title: "Rapport soumis à la Direction Générale", description: null, result: null, tone: "info" };
    case "commercial_owner.assigned":
    case "commercial_owner.transferred":
      return { category: "general", title: "Responsable commercial modifié", description: null, result: null, tone: "neutral" };
    default:
      return null;
  }
}

/**
 * Maps an FCI-level audit event (`FciDetail.auditEvents`) to a business-facing
 * presentation. Returns null for technical/infrastructure events.
 */
export function mapFciAuditEvent(entry: FciAuditEventRecord): HistoryEventPresentation | null {
  const payload = entry.payloadJson ?? null;

  switch (entry.eventType) {
    case "fci.generation.completed":
      return { category: "fci", title: `${moduleLabel(payload)} créée`, description: null, result: null, tone: "ai" };
    case "fci.module_data.saved":
      // Only the first save is a meaningful business milestone ("commencée");
      // every subsequent autosave would otherwise spam the history with one
      // row per click.
      if (payload && payload.version === 1) {
        return { category: "fci", title: `${moduleLabel(payload)} commencée`, description: null, result: null, tone: "neutral" };
      }
      return null;
    case "fci.module.validated":
      return { category: "fci", title: `${moduleLabel(payload)} validée`, description: null, result: null, tone: "success" };
    case "fci.assignment.created":
      return { category: "fci", title: `${moduleLabel(payload)} attribuée`, description: null, result: null, tone: "neutral" };
    case "fci.assignment.changed":
      return { category: "fci", title: `${moduleLabel(payload)} réaffectée`, description: null, result: null, tone: "warning" };
    case "fci.reminder.sent":
      return { category: "fci", title: "Rappel envoyé", description: moduleLabel(payload), result: null, tone: "neutral" };
    case "fci.generation.failed":
      return { category: "fci", title: `${moduleLabel(payload)} à reprendre`, description: "La génération n'a pas pu être terminée.", result: null, tone: "warning" };
    default:
      return null;
  }
}
