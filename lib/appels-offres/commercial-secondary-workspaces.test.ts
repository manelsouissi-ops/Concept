import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoNoGoWorkspace,
  filterCommercialSecondaryRecords,
  type CommercialHistorySource
} from "./commercial-secondary-workspaces.ts";
import type { FciModuleCode, FciModuleStatus } from "./fci/types.ts";

function record(input: {
  code: string;
  workflowState: CommercialHistorySource["workflow"]["explicit_state"];
  modules: Partial<Record<FciModuleCode, FciModuleStatus>>;
  decision?: "go" | "no_go";
  archived?: boolean;
}): CommercialHistorySource {
  const moduleEntries = Object.entries(input.modules) as [FciModuleCode, FciModuleStatus][];
  return {
    detail: {
      id: input.code.length,
      code: input.code,
      title: `Dossier ${input.code}`,
      buyer: "Client test",
      archivedAt: input.archived ? "2026-08-12T12:30:00.000Z" : null
    },
    fci: {
      modules: moduleEntries.map(([moduleCode, status], index) => ({
        id: index + 1,
        moduleCode,
        status
      }))
    },
    workflow: {
      explicit_state: input.workflowState,
      ready_for_gonogo: moduleEntries.length === 4
        && moduleEntries.every(([, status]) => status === "validated")
    },
    decision: input.decision ? {
      id: 1,
      appelOffresId: input.code.length,
      version: 1,
      status: input.decision,
      decision: input.decision,
      rationale: "Décision historique",
      reserves: null,
      decidedBy: "Isabelle Moreau",
      decidedAt: "2026-08-12T12:26:18.268Z",
      createdAt: "2026-08-12T12:26:18.269Z",
      updatedAt: "2026-08-12T12:26:18.269Z"
    } : null
  } as CommercialHistorySource;
}

test("an archived A/B/C-era final decision remains in Commercial decided history", () => {
  const workspace = buildGoNoGoWorkspace([record({
    code: "AO-20260812-0942",
    workflowState: "ARCHIVED",
    modules: { A: "validated", B: "validated", C: "validated", D: "not_started" },
    decision: "no_go",
    archived: true
  })]);

  assert.equal(workspace.counts.decided, 1);
  assert.equal(workspace.rows.length, 1);
  assert.equal(workspace.rows[0]?.filter, "decided");
  assert.equal(workspace.rows[0]?.decision, "NO-GO");
  assert.equal(workspace.rows[0]?.readiness, 3);
  assert.equal(workspace.counts.ready, 0);
});

test("A/B/C without D is not ready for preparation", () => {
  const workspace = buildGoNoGoWorkspace([record({
    code: "AO-ACTIVE-ABC",
    workflowState: "FCI_ASSIGNED",
    modules: { A: "validated", B: "validated", C: "validated" }
  })]);

  assert.deepEqual(workspace.rows, []);
  assert.equal(workspace.counts.ready, 0);
});

test("current four-FCI decisions use the same persisted outcome and counts match rows", () => {
  const workspace = buildGoNoGoWorkspace([
    record({
      code: "AO-CURRENT-GO",
      workflowState: "GO_DECIDED",
      modules: { A: "validated", B: "validated", C: "validated", D: "validated" },
      decision: "go"
    }),
    record({
      code: "AO-CURRENT-NOGO",
      workflowState: "ARCHIVED",
      modules: { A: "validated", B: "validated", C: "validated", D: "validated" },
      decision: "no_go",
      archived: true
    })
  ]);

  const decidedRows = workspace.rows.filter((row) => row.filter === "decided");
  assert.equal(workspace.counts.decided, decidedRows.length);
  assert.deepEqual(decidedRows.map((row) => row.decision), ["GO", "NO-GO"]);
});

test("historical records remain owner-scoped when archived decisions are included", () => {
  const historical = record({
    code: "AO-CLAIRE-HISTORY",
    workflowState: "ARCHIVED",
    modules: { A: "validated", B: "validated", C: "validated" },
    decision: "no_go",
    archived: true
  });
  historical.detail.commercialOwnerUserId = 2;
  const claire = { id: "2", role: "COMMERCIAL" } as Parameters<typeof filterCommercialSecondaryRecords>[1];
  const anotherCommercial = { id: "99", role: "COMMERCIAL" } as Parameters<typeof filterCommercialSecondaryRecords>[1];

  assert.equal(filterCommercialSecondaryRecords([historical], claire, { includeArchived: true }).length, 1);
  assert.equal(filterCommercialSecondaryRecords([historical], anotherCommercial, { includeArchived: true }).length, 0);
  assert.equal(filterCommercialSecondaryRecords([historical], claire).length, 0);
});
