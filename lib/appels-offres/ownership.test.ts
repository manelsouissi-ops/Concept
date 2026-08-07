import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import nextEnv from "@next/env";
import { Pool } from "pg";
import {
  DATA_ROOT,
  createDraftBundle,
  markFicheValidated,
  projectDir
} from "../storage.ts";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema
} from "./repository.ts";
import { closeFciPool, ensureFciSchema } from "./fci/repository.ts";
import { initializeFciWorkspace } from "./fci/service.ts";
import {
  assignCommercialOwner,
  backfillLegacyCommercialOwnership,
  CommercialOwnershipError,
  getCommercialOwnership,
  getCommercialOwnershipImpactForUser,
  handleCommercialOwnershipRecoveryRequired,
  transferCommercialOwner
} from "./ownership.ts";
import { getSeededActors } from "./test-actors.ts";
import {
  assignFciModule,
  deriveTenderWorkflowState,
  getAssignmentsForTender
} from "./workflow/service.ts";
import { closeWorkflowPool } from "./workflow/repository.ts";
import {
  closeUsersPool,
  createUser,
  setUserStatus
} from "../users/repository.ts";
import type { UserMutationInput } from "../users/types.ts";
import {
  closeNotificationsPool,
  listAppNotificationsForUser
} from "../notifications/repository.ts";
import { serializeFiche } from "../fiche-xml.ts";
import type { FichePayload } from "../types.ts";
import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS
} from "../types.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cleanupCodes = new Set<string>();
const cleanupUserIds = new Set<number>();

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

function buildFichePayload(code: string): FichePayload {
  return {
    codeInterne: code,
    extraction: EXTRACTION_FIELD_DEFINITIONS.map((field) => ({
      key: field.key,
      label: field.label,
      value: `${field.label} ${code}`,
      source: "ownership-test"
    })),
    evaluation: EVALUATION_FIELD_DEFINITIONS.map((field, index) => ({
      key: field.key,
      label: field.label,
      score: 3 + (index % 2),
      justification: `${field.label} justification`,
      chargeEstimee:
        field.key === "risque_sous_dimensionnement" ? "Charge ownership test" : undefined
    })),
    controle: {
      champsNonTrouves: [],
      incoherences: [],
      aVerifier: [],
      resolutions: []
    }
  };
}

async function createTempUser(input: UserMutationInput) {
  const user = await createUser(input);
  assert.ok(user, "Expected temporary user to be created.");
  cleanupUserIds.add(user.id);
  return user;
}

async function createTender(overrides?: Partial<Parameters<typeof createAppelOffres>[0]>) {
  const code = overrides?.code ?? `AO-OWN-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await createAppelOffres({
    code,
    title: overrides?.title ?? `AO ${code}`,
    reference: overrides?.reference ?? "",
    buyer: overrides?.buyer ?? "Client ownership",
    country: overrides?.country ?? "SN",
    dueDate: overrides?.dueDate ?? null,
    notes: overrides?.notes ?? "",
    priorite: overrides?.priorite ?? "normale",
    responsableCommercial: overrides?.responsableCommercial ?? "",
    status: overrides?.status ?? "ready",
    businessStatus: overrides?.businessStatus ?? "fiche_validee",
    source: overrides?.source ?? "manual"
  });

  return code;
}

async function createWorkflowTender() {
  const code = await createTender({
    responsableCommercial: "Claire Martin"
  });
  await ensureFciSchema();
  await fs.mkdir(DATA_ROOT, { recursive: true });

  const payload = buildFichePayload(code);
  const xml = serializeFiche(payload, { referenceInterne: code });
  await createDraftBundle({
    codeInterne: code,
    pdfFile: new File(["%PDF-1.7 ownership"], "cdc.pdf", { type: "application/pdf" }),
    xml,
    markdown: `# ${code}`
  });
  await markFicheValidated(code);

  const actors = await getSeededActors();
  await initializeFciWorkspace(code, actors.commercial);
  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(actors.commercial.id),
    currentUser: actors.commercial,
    reason: "ownership_test_setup"
  });

  return { code, actors };
}

test("assignCommercialOwner persists the canonical owner and history", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const actors = await getSeededActors();
  const code = await createTender({
    responsableCommercial: "Legacy Label"
  });

  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(actors.commercial.id),
    currentUser: actors.admin,
    reason: "ownership_test_assign"
  });

  const ownership = await getCommercialOwnership(code);
  assert.equal(ownership.owner.userId, Number(actors.commercial.id));
  assert.equal(ownership.owner.displayName, actors.commercial.name);
  assert.equal(ownership.history.length, 1);
  assert.equal(ownership.history[0]?.newOwnerUserId, Number(actors.commercial.id));
  assert.equal(ownership.history[0]?.reason, "ownership_test_assign");
});

test("only active Commercial users may become canonical owners", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const actors = await getSeededActors();
  const code = await createTender();
  const inactiveCommercial = await createTempUser({
    firstName: "Ines",
    lastName: "Inactive",
    email: `ines.inactive.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Commerciale inactive",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "INACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  for (const target of [
    { label: "finance", userId: Number(actors.finance.id), code: "OWNER_INVALID_TARGET" },
    { label: "operations", userId: Number(actors.operations.id), code: "OWNER_INVALID_TARGET" },
    { label: "dg", userId: Number(actors.dg.id), code: "OWNER_INVALID_TARGET" },
    { label: "inactive-commercial", userId: inactiveCommercial.id, code: "OWNER_TARGET_INACTIVE" }
  ]) {
    await assert.rejects(
      () =>
        assignCommercialOwner({
          code,
          newOwnerUserId: target.userId,
          currentUser: actors.admin,
          reason: `reject_${target.label}`
        }),
      (error: unknown) =>
        error instanceof CommercialOwnershipError
        && error.code === target.code
    );
  }
});

test("ownership transfer preserves assignments and workflow state, and notifies old and new owners", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();
  const secondCommercial = await createTempUser({
    firstName: "Nadia",
    lastName: "Relai",
    email: `nadia.relai.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Responsable commerciale",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  await assignFciModule({
    code,
    moduleCode: "B",
    assignedUserId: Number(actors.finance.id),
    currentUser: actors.commercial
  });
  await assignFciModule({
    code,
    moduleCode: "C",
    assignedUserId: Number(actors.operations.id),
    currentUser: actors.commercial
  });

  const assignmentsBefore = await getAssignmentsForTender(code);
  const workflowBefore = await deriveTenderWorkflowState(code);

  await transferCommercialOwner({
    code,
    newOwnerUserId: secondCommercial.id,
    currentUser: actors.commercial,
    reason: "handover"
  });

  const assignmentsAfter = await getAssignmentsForTender(code);
  const workflowAfter = await deriveTenderWorkflowState(code);
  const ownership = await getCommercialOwnership(code);
  const previousOwnerNotifications = await listAppNotificationsForUser(Number(actors.commercial.id), 20);
  const newOwnerNotifications = await listAppNotificationsForUser(secondCommercial.id, 20);

  assert.equal(ownership.owner.userId, secondCommercial.id);
  assert.deepEqual(
    assignmentsAfter.map((assignment) => ({
      moduleCode: assignment.moduleCode,
      assignedUserId: assignment.assignedUserId
    })),
    assignmentsBefore.map((assignment) => ({
      moduleCode: assignment.moduleCode,
      assignedUserId: assignment.assignedUserId
    }))
  );
  assert.equal(workflowAfter.explicit_state, workflowBefore.explicit_state);
  assert.equal(
    previousOwnerNotifications.some((notification) =>
      notification.eventType === "COMMERCIAL_OWNER_TRANSFERRED"
      && notification.appelOffreCode === code
    ),
    true
  );
  assert.equal(
    newOwnerNotifications.some((notification) =>
      notification.eventType === "COMMERCIAL_OWNER_TRANSFERRED"
      && notification.appelOffreCode === code
    ),
    true
  );
});

test("backfill infers only unambiguous legacy Commercial labels", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const uniqueCommercial = await createTempUser({
    firstName: "Nadia",
    lastName: `Unique${randomUUID().slice(0, 4)}`,
    email: `nadia.unique.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Commerciale legacy",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });
  const ambiguousA = await createTempUser({
    firstName: "Alex",
    lastName: `Ambiguous${randomUUID().slice(0, 4)}`,
    email: `alex.ambiguous.a.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Commerciale legacy",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });
  const ambiguousB = await createTempUser({
    firstName: ambiguousA.firstName,
    lastName: ambiguousA.lastName,
    email: `alex.ambiguous.b.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Commerciale legacy",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  const codeByEmail = await createTender({
    responsableCommercial: uniqueCommercial.email
  });
  const codeByName = await createTender({
    responsableCommercial: uniqueCommercial.displayName
  });
  const codeAmbiguous = await createTender({
    responsableCommercial: ambiguousA.displayName
  });
  const codeUnknown = await createTender({
    responsableCommercial: "Personne Inconnue"
  });

  const dryRun = await backfillLegacyCommercialOwnership({ dryRun: true });
  assert.equal(dryRun.assignedCodes.includes(codeByEmail), true);
  assert.equal(dryRun.assignedCodes.includes(codeByName), true);
  assert.equal(dryRun.ambiguousCodes.includes(codeAmbiguous), true);
  assert.equal(dryRun.unresolvedCodes.includes(codeUnknown), true);

  await backfillLegacyCommercialOwnership({ dryRun: false });

  const [emailOwnership, nameOwnership, ambiguousOwnership, unknownOwnership] = await Promise.all([
    getCommercialOwnership(codeByEmail),
    getCommercialOwnership(codeByName),
    getCommercialOwnership(codeAmbiguous),
    getCommercialOwnership(codeUnknown)
  ]);

  assert.equal(emailOwnership.owner.userId, uniqueCommercial.id);
  assert.equal(nameOwnership.owner.userId, uniqueCommercial.id);
  assert.equal(ambiguousOwnership.owner.userId, null);
  assert.equal(unknownOwnership.owner.userId, null);
  assert.equal(ambiguousOwnership.owner.isRecoveryRequired, true);
  assert.equal(unknownOwnership.owner.isRecoveryRequired, true);
  assert.equal(ambiguousOwnership.history.length, 0);
  assert.equal(unknownOwnership.history.length, 0);

  assert.notEqual(ambiguousA.id, ambiguousB.id);
});

test("inactive Commercial owners surface recovery impact and notify other active Commercial users", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const actors = await getSeededActors();
  const owner = await createTempUser({
    firstName: "Claire",
    lastName: `Sortante${randomUUID().slice(0, 4)}`,
    email: `claire.sortante.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Responsable commerciale",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });
  const backupCommercial = await createTempUser({
    firstName: "Maya",
    lastName: `Backup${randomUUID().slice(0, 4)}`,
    email: `maya.backup.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Responsable commerciale",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });
  const code = await createTender({
    responsableCommercial: owner.displayName
  });

  await assignCommercialOwner({
    code,
    newOwnerUserId: owner.id,
    currentUser: actors.admin,
    reason: "recovery_test_setup"
  });

  const inactiveOwner = await setUserStatus(owner.id, "INACTIVE");
  assert.ok(inactiveOwner);

  const impact = await handleCommercialOwnershipRecoveryRequired({
    user: inactiveOwner,
    currentUser: actors.admin
  });
  const refreshedImpact = await getCommercialOwnershipImpactForUser(owner.id);
  const backupNotifications = await listAppNotificationsForUser(backupCommercial.id, 20);

  assert.equal(impact.activeOwnedCount, 1);
  assert.equal(refreshedImpact.ownedTenderCodes.includes(code), true);
  assert.equal(
    backupNotifications.some((notification) =>
      notification.eventType === "COMMERCIAL_OWNER_RECOVERY_REQUIRED"
      && notification.appelOffreCode === code
    ),
    true
  );
});

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
      await fs.rm(projectDir(code), { recursive: true, force: true });
    }

    for (const userId of cleanupUserIds) {
      await cleanupPool.query("delete from public.app_users where id = $1", [userId]);
    }

    await cleanupPool.end();
  }

  await Promise.all([
    closeNotificationsPool(),
    closeWorkflowPool(),
    closeFciPool(),
    closeAppelsOffresPool(),
    closeUsersPool()
  ]);
});
