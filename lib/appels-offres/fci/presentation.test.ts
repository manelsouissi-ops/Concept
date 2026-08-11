import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFciOverallStatus,
  buildFciModuleAllowedActions
} from "./presentation.ts";
import type { FciModuleDataRecord, FciModuleRecord } from "./types.ts";
import type { CurrentUser } from "../../auth/rbac.ts";

function buildModule(overrides: Partial<FciModuleRecord>): FciModuleRecord {
  return {
    id: overrides.id ?? 1,
    fciSetId: 1,
    moduleCode: overrides.moduleCode ?? "A",
    moduleType: overrides.moduleType ?? "commercial",
    status: overrides.status ?? "validated",
    aiGeneratedAt: null,
    validatedAt: overrides.validatedAt ?? "2026-08-01T10:00:00.000Z",
    validatedBy: overrides.validatedBy ?? "Claire Martin",
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z"
  };
}

function buildModuleData(overrides: Partial<FciModuleDataRecord> & { id: number }): FciModuleDataRecord {
  return {
    id: overrides.id,
    fciModuleId: overrides.fciModuleId ?? overrides.id,
    dataJson: {},
    sourceSummaryJson: null,
    confidenceJson: null,
    aiNotesJson: null,
    version: overrides.version ?? 1,
    generatedFromFicheVersion: overrides.generatedFromFicheVersion ?? "draft:2026-08-01T08:00:00.000Z",
    generatedFromFicheHash: overrides.generatedFromFicheHash ?? "hash-1",
    createdAt: "2026-08-01T09:30:00.000Z",
    updatedAt: "2026-08-01T09:30:00.000Z"
  };
}

function buildUser(role: CurrentUser["role"]): CurrentUser {
  return {
    id: "2",
    firstName: "Claire",
    name: "Claire Martin",
    email: "claire.martin@concept.local",
    role,
    status: "ACTIVE",
    departmentCode: "COMMERCIAL",
    departmentLabel: "Commercial",
    jobTitle: "Responsable commerciale",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    lastLoginAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    isDevelopmentUser: true
  };
}

test("all modules validated + fiche currently validated => overall status validated", () => {
  const modules = (["A", "B", "C"] as const).map((moduleCode, index) =>
    buildModule({ id: index + 1, moduleCode })
  );
  const latestDataByModuleId = new Map(
    modules.map((module) => [module.id, buildModuleData({ id: module.id })])
  );

  const status = calculateFciOverallStatus({
    modules,
    latestDataByModuleId,
    ficheCurrentlyValidated: true
  });

  assert.equal(status, "validated");
});

// This is the core fix for the reported contradiction: a tender whose Fiche
// CDC has reverted to a draft (e.g. after a CDC replacement) must not keep
// reading as "ready for Go/No-Go" just because modules were validated
// against an earlier version of the fiche.
test("all modules validated but fiche NOT currently validated => needs_review, not validated", () => {
  const modules = (["A", "B", "C"] as const).map((moduleCode, index) =>
    buildModule({ id: index + 1, moduleCode })
  );
  const latestDataByModuleId = new Map(
    modules.map((module) => [module.id, buildModuleData({ id: module.id })])
  );

  const status = calculateFciOverallStatus({
    modules,
    latestDataByModuleId,
    ficheCurrentlyValidated: false
  });

  assert.equal(status, "needs_review");
});

test("omitting ficheCurrentlyValidated preserves prior behavior (backward compatible)", () => {
  const modules = (["A", "B", "C"] as const).map((moduleCode, index) =>
    buildModule({ id: index + 1, moduleCode })
  );
  const latestDataByModuleId = new Map(
    modules.map((module) => [module.id, buildModuleData({ id: module.id })])
  );

  const status = calculateFciOverallStatus({ modules, latestDataByModuleId });

  assert.equal(status, "validated");
});

test("validate action is hidden once a module is already validated", () => {
  const module = buildModule({ id: 1, moduleCode: "A", status: "validated" });
  const latestData = buildModuleData({ id: 1 });

  const actions = buildFciModuleAllowedActions({
    module,
    latestData,
    latestJob: null,
    sourceFiche: null,
    knowledgeBaseEnabled: true,
    currentUser: buildUser("COMMERCIAL")
  });

  assert.equal(actions.includes("validate"), false);
  assert.equal(actions.includes("edit"), true);
});

test("validate action is offered while a module is not yet validated", () => {
  const module = buildModule({ id: 1, moduleCode: "A", status: "needs_review", validatedAt: null });
  const latestData = buildModuleData({ id: 1 });

  const actions = buildFciModuleAllowedActions({
    module,
    latestData,
    latestJob: null,
    sourceFiche: null,
    knowledgeBaseEnabled: true,
    currentUser: buildUser("COMMERCIAL")
  });

  assert.equal(actions.includes("validate"), true);
});
