import { getLatestGoNoGoDecisionByAppelOffresId } from "./go-no-go/repository.ts";
import { getFciDetailByAppelOffresCode } from "./fci/repository.ts";
import type { FciDetail, FciModuleRecord } from "./fci/types.ts";
import { buildAppelOffresSummary, isTestTenderCode, type BadgeTone } from "./presentation.ts";
import { listAppelOffresDetails } from "./repository.ts";
import type { AppelOffresDetail } from "./types.ts";
import { buildWorkspaceIdentity } from "./workspace.ts";
import { deriveTenderWorkflowState, type TenderWorkflowStateView } from "./workflow/service.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import { mapFciAuditEvent, mapTenderAuditEvent, type HistoryEventCategory } from "./history-presentation.ts";

export type CommercialHistorySource = { detail: AppelOffresDetail; fci: FciDetail | null; workflow: TenderWorkflowStateView; decision: GoNoGoDecisionRecord | null };
type RecordView = CommercialHistorySource;
export type WorkspaceFilter = "all" | "review" | "processing" | "validated" | "todo" | "in_progress" | "ready" | "prepared" | "submitted" | "decided" | "fiche" | "fci" | "gonogo" | "decision";

export type CdcWorkspaceRow = { code: string; title: string; client: string; status: string; tone: BadgeTone; updatedAt: string; filter: "review" | "processing" | "validated"; action: string | null; href: string };
export type FciWorkspaceRow = { code: string; title: string; deadline: string; aStatus: string; aTone: BadgeTone; bStatus: string; cStatus: string; ficheAvailable: boolean; filter: "todo" | "in_progress" | "validated"; action: string; href: string };
export type GoNoGoWorkspaceRow = { code: string; title: string; client: string; readiness: number; reportStatus: string; submissionStatus: string; decision: string | null; filter: "ready" | "prepared" | "submitted" | "decided"; action: string; href: string };
export type HistoryWorkspaceRow = { id: string; createdAt: string; category: HistoryEventCategory; eventTitle: string; description: string | null; code: string; title: string; actor: string; result: string | null; tone: BadgeTone; href: string };

function date(value: string | null) { return value ? new Date(value).toLocaleDateString("fr-FR") : "Non renseignée"; }
function module(record: RecordView, code: "A" | "B" | "C") { return record.fci?.modules.find((item) => item.moduleCode === code) ?? null; }
function moduleLabel(item: FciModuleRecord | null) {
  if (!item) return "Non démarrée";
  return ({ not_started: "À démarrer", generating: "Génération", generated: "À compléter", needs_review: "À vérifier", validated: "Validée", failed: "À reprendre", unavailable: "Indisponible" } as const)[item.status] ?? "Indisponible";
}
function moduleTone(item: FciModuleRecord | null): BadgeTone { return item?.status === "validated" ? "success" : item?.status === "failed" ? "danger" : item?.status === "generating" ? "info" : "warning"; }
function owned(record: RecordView, user: CurrentUser) { return record.detail.commercialOwnerUserId === Number(user.id) && !record.detail.archivedAt; }

export function buildCdcWorkspace(records: RecordView[]) {
  const rows = records.flatMap<CdcWorkspaceRow>((record) => {
    const status = record.detail.ficheStatus?.status;
    if (!status && !record.detail.artifacts.hasFicheXml && !record.detail.latestJob) return [];
    const identity = buildWorkspaceIdentity(record.detail);
    const filter = status === "validated" ? "validated" : status === "draft" ? "review" : "processing";
    return [{ code: record.detail.code, title: identity.displayTitle, client: identity.clientLabel, status: filter === "validated" ? "Validée" : filter === "review" ? "À vérifier" : status === "error" ? "Échec du traitement" : "En traitement", tone: filter === "validated" ? "success" : status === "error" ? "danger" : filter === "review" ? "warning" : "info", updatedAt: date(record.detail.ficheStatus?.modifiedAt ?? record.detail.updatedAt), filter, action: filter === "review" ? "Vérifier la fiche" : filter === "validated" ? "Consulter" : null, href: `/appels-offres/${encodeURIComponent(record.detail.code)}/fiche-cdc` }];
  }).sort((a, b) => ({ review: 0, processing: 1, validated: 2 })[a.filter] - ({ review: 0, processing: 1, validated: 2 })[b.filter]);
  return { rows, counts: { review: rows.filter(r => r.filter === "review").length, processing: rows.filter(r => r.filter === "processing").length, validated: rows.filter(r => r.filter === "validated").length } };
}

export function buildFciWorkspace(records: RecordView[]) {
  const rows = records.flatMap<FciWorkspaceRow>((record) => {
    const a = module(record, "A"); if (!a) return [];
    const filter = a.status === "validated" ? "validated" : ["generating", "not_started"].includes(a.status) ? "in_progress" : "todo";
    const identity = buildWorkspaceIdentity(record.detail);
    return [{ code: record.detail.code, title: identity.displayTitle, deadline: date(record.detail.dueDate), aStatus: moduleLabel(a), aTone: moduleTone(a), bStatus: moduleLabel(module(record, "B")), cStatus: moduleLabel(module(record, "C")), ficheAvailable: record.detail.ficheStatus?.status === "validated", filter, action: filter === "validated" ? "Consulter" : "Compléter ma FCI", href: `/appels-offres/${encodeURIComponent(record.detail.code)}/fci?fciModule=A` }];
  });
  return { rows, counts: { todo: rows.filter(r => r.filter === "todo").length, inProgress: rows.filter(r => r.filter === "in_progress").length, validated: rows.filter(r => r.filter === "validated").length } };
}

export function buildGoNoGoWorkspace(records: RecordView[]) {
  const rows = records.flatMap<GoNoGoWorkspaceRow>((record) => {
    const state = record.workflow.explicit_state; let filter: GoNoGoWorkspaceRow["filter"] | null = null;
    if (state === "GO_DECIDED" || state === "NO_GO_DECIDED") filter = "decided";
    else if (state === "SUBMITTED_TO_DG" || state === "UNDER_DG_REVIEW") filter = "submitted";
    else if (state === "GONOGO_PREPARED") filter = "prepared";
    else if (record.workflow.ready_for_gonogo) filter = "ready";
    if (!filter) return [];
    const identity = buildWorkspaceIdentity(record.detail); const readiness = (["A", "B", "C"] as const).filter(c => module(record, c)?.status === "validated").length;
    return [{ code: record.detail.code, title: identity.displayTitle, client: identity.clientLabel, readiness, reportStatus: filter === "ready" ? "À préparer" : "Rapport préparé", submissionStatus: filter === "submitted" ? "Soumis à la DG" : filter === "decided" ? "Décision rendue" : "Non soumis", decision: filter === "decided" ? record.decision?.status === "go" ? "GO" : "NO-GO" : null, filter, action: filter === "ready" ? "Préparer le Go/No-Go" : filter === "prepared" ? "Continuer la préparation" : filter === "submitted" ? "Consulter" : "Voir la décision", href: `/appels-offres/${encodeURIComponent(record.detail.code)}/go-no-go` }];
  });
  return { rows, counts: { ready: rows.filter(r => r.filter === "ready").length, prepared: rows.filter(r => r.filter === "prepared").length, submitted: rows.filter(r => r.filter === "submitted").length, decided: rows.filter(r => r.filter === "decided").length } };
}

// Business-facing history: raw audit events are mapped through
// history-presentation.ts, which returns null for technical/infrastructure
// events (callbacks, workflow-state mirrors, report bookkeeping...). Those
// rows are simply omitted here - the underlying audit_logs / fci_audit_events
// rows are untouched and remain fully queryable for technical audit.
export function buildHistoryWorkspace(records: RecordView[]) {
  return records.flatMap<HistoryWorkspaceRow>((record) => {
    const identity = buildWorkspaceIdentity(record.detail);
    const href = `/appels-offres/${encodeURIComponent(record.detail.code)}/history`;

    const tenderEvents = record.detail.auditLogs.flatMap((event) => {
      const presentation = mapTenderAuditEvent(event);
      if (!presentation) return [];
      return [{
        id: `audit-${event.id}`,
        createdAt: event.createdAt,
        category: presentation.category,
        eventTitle: presentation.title,
        description: presentation.description,
        code: record.detail.code,
        title: identity.displayTitle,
        actor: event.actor ?? "Système",
        result: presentation.result,
        tone: presentation.tone,
        href
      }];
    });

    const fciEvents = (record.fci?.auditEvents ?? []).flatMap((event) => {
      const presentation = mapFciAuditEvent(event);
      if (!presentation) return [];
      return [{
        id: `fci-${event.id}`,
        createdAt: event.createdAt,
        category: presentation.category,
        eventTitle: presentation.title,
        description: presentation.description,
        code: record.detail.code,
        title: identity.displayTitle,
        actor: event.actor ?? "Système",
        result: presentation.result,
        tone: presentation.tone,
        href
      }];
    });

    return [...tenderEvents, ...fciEvents] as HistoryWorkspaceRow[];
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getCommercialSecondaryRecords(currentUser: CurrentUser) {
  const details = (await listAppelOffresDetails({ archived: "all" })).filter(detail => !isTestTenderCode(detail.code));
  const records = await Promise.all(details.map(async detail => ({ detail, fci: await getFciDetailByAppelOffresCode(detail.code), workflow: await deriveTenderWorkflowState(detail.code), decision: await getLatestGoNoGoDecisionByAppelOffresId(detail.id) })));
  return records.filter(record => owned(record, currentUser));
}
