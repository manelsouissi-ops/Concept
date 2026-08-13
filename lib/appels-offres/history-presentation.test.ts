import assert from "node:assert/strict";
import test from "node:test";
import { mapFciAuditEvent, mapTenderAuditEvent } from "./history-presentation.ts";
import type { AuditLogRecord } from "./types.ts";
import type { FciAuditEventRecord } from "./fci/types.ts";

function auditLog(action: string, details: Record<string, unknown> | null = null): AuditLogRecord {
  return { id: 1, appelOffresId: 1, action, details, actor: "Alice", createdAt: "2026-08-11T09:04:00.000Z" };
}

function fciEvent(eventType: string, payloadJson: Record<string, unknown> | null = null): FciAuditEventRecord {
  return { id: 1, appelOffresId: 1, fciModuleId: null, eventType, actor: "Alice", payloadJson, createdAt: "2026-08-11T09:04:00.000Z" };
}

// A. technical events are hidden from the default business history
test("technical/infrastructure audit events map to null (hidden)", () => {
  for (const action of [
    "callback_received",
    "duplicate_callback_ignored",
    "late_callback_ignored",
    "appel_offres.business_status_changed",
    "appel_offres.status_changed",
    "n8n_launch_accepted",
    "workflow.go_decided",
    "go_no_go_report.superseded",
    "commercial_owner.recovery_required",
    "software_analysis.requirement_saved"
  ]) {
    assert.equal(mapTenderAuditEvent(auditLog(action)), null, `${action} should be hidden`);
  }
});

test("technical/granular FCI audit events map to null (hidden)", () => {
  for (const eventType of [
    "fci.initialized",
    "fci.module_data.saved",
    "fci.generation.launch_accepted",
    "fci.assignment.started",
    "fci.assignment.validated"
  ]) {
    assert.equal(mapFciAuditEvent(fciEvent(eventType)), null, `${eventType} should be hidden`);
  }
});

// B. business events display with the correct French label
test("business audit events map to clear French labels", () => {
  assert.equal(mapTenderAuditEvent(auditLog("fiche_cdc_generated"))?.title, "Fiche CDC générée");
  assert.equal(mapTenderAuditEvent(auditLog("fiche_cdc.validated"))?.title, "Fiche CDC validée");
  assert.equal(mapTenderAuditEvent(auditLog("workflow.gonogo_prepared"))?.title, "Rapport Go/No-Go préparé");
  assert.equal(mapTenderAuditEvent(auditLog("workflow.submitted_to_dg"))?.title, "Soumis à la Direction Générale");
  assert.equal(mapFciAuditEvent(fciEvent("fci.reminder.sent", { moduleCode: "B" }))?.title, "Rappel envoyé");
});

// C. FCI validation/creation labels include the correct department name
test("FCI module events include the department name in the label", () => {
  assert.equal(mapFciAuditEvent(fciEvent("fci.generation.completed", { moduleCode: "A" }))?.title, "FCI Commerciale créée");
  assert.equal(mapFciAuditEvent(fciEvent("fci.module.validated", { moduleCode: "B" }))?.title, "FCI Financière validée");
  assert.equal(mapFciAuditEvent(fciEvent("fci.module.validated", { moduleCode: "C" }))?.title, "FCI Opérationnelle validée");
  assert.equal(mapFciAuditEvent(fciEvent("fci.assignment.changed", { moduleCode: "C" }))?.title, "FCI Opérationnelle réaffectée");
  assert.equal(mapFciAuditEvent(fciEvent("fci.module_data.saved", { moduleCode: "A", version: 1 }))?.title, "FCI Commerciale commencée");
  assert.equal(mapFciAuditEvent(fciEvent("fci.module_data.saved", { moduleCode: "A", version: 2 })), null);
});

// Go/No-Go report lifecycle events (generated/edited/prepared/submitted) are
// now visible business milestones (Part 13 of the FCI/Go-No-Go workflow spec).
test("Go/No-Go report lifecycle events map to clear French labels", () => {
  assert.equal(mapTenderAuditEvent(auditLog("go_no_go_report.generated"))?.title, "Rapport Go/No-Go généré");
  assert.equal(mapTenderAuditEvent(auditLog("go_no_go_report.edited"))?.title, "Rapport Go/No-Go modifié");
  assert.equal(mapTenderAuditEvent(auditLog("go_no_go_report.prepared"))?.title, "Rapport marqué comme prêt");
  assert.equal(mapTenderAuditEvent(auditLog("go_no_go_report.submitted"))?.title, "Rapport soumis à la Direction Générale");
});

// D. GO and NO-GO decisions map correctly
test("GO and NO-GO decisions map to distinct labels, tones and results", () => {
  const go = mapTenderAuditEvent(auditLog("go_no_go.decided_go", { rationale: "Bon fit" }));
  assert.equal(go?.title, "Décision GO");
  assert.equal(go?.result, "GO");
  assert.equal(go?.tone, "success");
  assert.equal(go?.category, "decision");

  const noGo = mapTenderAuditEvent(auditLog("go_no_go.decided_no_go", { rationale: "Prix trop bas" }));
  assert.equal(noGo?.title, "Décision NO-GO");
  assert.equal(noGo?.result, "NO-GO");
  assert.equal(noGo?.tone, "danger");
  assert.equal(noGo?.category, "decision");
});

// E. raw audit data is left untouched - hidden events are a presentation
// concern only, the persisted rows are never dropped or mutated.
test("hiding technical events does not alter the underlying audit records", () => {
  const record = auditLog("callback_received", { callbackStatus: "success" });
  const presentation = mapTenderAuditEvent(record);

  assert.equal(presentation, null);
  assert.equal(record.action, "callback_received");
  assert.deepEqual(record.details, { callbackStatus: "success" });
});

// F. filters correctly classify CDC / FCI / Go-No-Go / Décisions
test("business events are classified into the expected filter categories", () => {
  assert.equal(mapTenderAuditEvent(auditLog("fiche_cdc_generated"))?.category, "fiche");
  assert.equal(mapTenderAuditEvent(auditLog("appel_offres.cdc_uploaded"))?.category, "fiche");
  assert.equal(mapFciAuditEvent(fciEvent("fci.module.validated", { moduleCode: "A" }))?.category, "fci");
  assert.equal(mapTenderAuditEvent(auditLog("workflow.submitted_to_dg"))?.category, "gonogo");
  assert.equal(mapTenderAuditEvent(auditLog("go_no_go.decided_go"))?.category, "decision");
  assert.equal(mapTenderAuditEvent(auditLog("appel_offres.created"))?.category, "general");
});
