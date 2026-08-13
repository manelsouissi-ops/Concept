import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinanceWorkspacePresentation,
  getFinanceWorkspacePresentation
} from "./finance-workspace.ts";
import type { FciDetail } from "./fci/types.ts";
import type { AppelOffresDetail } from "./types.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import type { UserRecord } from "../users/types.ts";

function buildUser(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    id: "user-finance",
    firstName: "Sophie",
    name: "Sophie Bernard",
    email: "sophie.bernard@concept.local",
    role: "FINANCE",
    status: "ACTIVE",
    departmentCode: "FINANCE",
    departmentLabel: "Finance",
    jobTitle: "Responsable Finance",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    lastLoginAt: null,
    createdAt: "2026-07-01T08:00:00.000Z",
    isDevelopmentUser: true,
    ...overrides
  };
}

const FINANCE_USER = buildUser({});
const OPERATIONS_USER = buildUser({
  id: "user-operations",
  firstName: "Marc",
  name: "Marc Leroy",
  email: "marc.leroy@concept.local",
  role: "OPERATIONS",
  departmentCode: "OPERATIONS",
  departmentLabel: "Operations",
  jobTitle: "Responsable Operations"
});
const DIRECTION_GENERALE_USER = buildUser({
  id: "user-dg",
  firstName: "Isabelle",
  name: "Isabelle Moreau",
  email: "isabelle.moreau@concept.local",
  role: "DIRECTION_GENERALE",
  departmentCode: "DIRECTION_GENERALE",
  departmentLabel: "Direction generale",
  jobTitle: "Direction generale"
});

function buildDetail(overrides: Partial<AppelOffresDetail>): AppelOffresDetail {
  return {
    id: overrides.id ?? 1,
    code: overrides.code ?? "AO-TEST",
    title: overrides.title ?? "AO de test",
    reference: overrides.reference ?? "",
    buyer: overrides.buyer ?? "Client test",
    country: overrides.country ?? "SN",
    dueDate: overrides.dueDate ?? "2026-08-20T00:00:00.000Z",
    notes: overrides.notes ?? "",
    priorite: overrides.priorite ?? "normale",
    responsableCommercial: overrides.responsableCommercial ?? "Claire Martin",
    status: overrides.status ?? "ready",
    businessStatus: overrides.businessStatus ?? "fiche_validee",
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-08-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-02T09:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    documents: overrides.documents ?? [],
    latestJob: overrides.latestJob ?? null,
    processingJobs: overrides.processingJobs ?? [],
    auditLogs: overrides.auditLogs ?? [],
    artifacts: overrides.artifacts ?? {
      hasSourcePdf: true,
      hasFicheXml: true,
      hasFicheMarkdown: false,
      hasStatusJson: true
    },
    ficheStatus: overrides.ficheStatus ?? null
  };
}

function buildFciDetail(
  moduleCode: FciDetail["modules"][number]["moduleCode"],
  status: FciDetail["modules"][number]["status"],
  overrides?: Partial<FciDetail>
): FciDetail {
  return {
    set: {
      id: 100,
      appelOffresId: 1,
      sourceFicheVersion: "validated:2026-08-01T08:00:00.000Z",
      sourceFicheHash: "hash-1",
      sourceFicheUpdatedAt: "2026-08-01T08:00:00.000Z",
      overallStatus: status === "validated" ? "validated" : "in_progress",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-02T09:00:00.000Z"
    },
    modules: [
      {
        id: 200,
        fciSetId: 100,
        moduleCode,
        moduleType: "finance",
        status,
        aiGeneratedAt: status === "needs_review" ? "2026-08-02T10:00:00.000Z" : null,
        validatedAt: status === "validated" ? "2026-08-02T14:00:00.000Z" : null,
        validatedBy: status === "validated" ? "Sophie Bernard" : null,
        errorCode: null,
        errorMessage: null,
        createdAt: "2026-08-01T09:00:00.000Z",
        updatedAt: "2026-08-02T10:00:00.000Z"
      }
    ],
    moduleData: [],
    generationJobs: [],
    auditEvents: [],
    ...overrides
  };
}

test("buildFinanceWorkspacePresentation creates a personal department queue and KPIs", () => {
  const workspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records: [
      {
        detail: buildDetail({
          id: 1,
          code: "AO-NEW",
          title: "Nouveau module",
          buyer: "Ville A",
          dueDate: "2026-08-06T00:00:00.000Z",
          priorite: "haute"
        }),
        fciDetail: null,
        sourceFiche: null
      },
      {
        detail: buildDetail({
          id: 2,
          code: "AO-REVIEW",
          title: "Budget a valider",
          buyer: "Ville B",
          dueDate: "2026-08-01T00:00:00.000Z",
          priorite: "critique"
        }),
        fciDetail: buildFciDetail("B", "needs_review"),
        sourceFiche: null
      },
      {
        detail: buildDetail({
          id: 3,
          code: "AO-DONE",
          title: "Module valide",
          buyer: "Ville C",
          dueDate: "2026-08-12T00:00:00.000Z",
          priorite: "normale"
        }),
        fciDetail: buildFciDetail("B", "validated", {
          auditEvents: [
            {
              id: 300,
              appelOffresId: 3,
              fciModuleId: 200,
              eventType: "fci.module.validated",
              actor: "Sophie Bernard",
              payloadJson: { moduleCode: "B" },
              createdAt: "2026-08-02T14:00:00.000Z"
            }
          ]
        }),
        sourceFiche: null
      }
    ]
  });

  assert.equal(workspace.currentUser.firstName, "Sophie");
  assert.equal(workspace.moduleCode, "B");
  assert.equal(workspace.departmentLabel, "Finance");
  assert.equal(workspace.dossiers.length, 3);
  assert.equal(workspace.attentionCount, 2);
  assert.equal(workspace.kpis.find((item) => item.key === "attention")?.value, 2);
  assert.equal(workspace.kpis.find((item) => item.key === "in_progress")?.value, 0);
  assert.equal(workspace.kpis.find((item) => item.key === "completed")?.value, 1);
  assert.equal(workspace.dossiers[0]?.code, "AO-REVIEW");
  assert.equal(workspace.dossiers[0]?.statusLabel, "Validation requise");
  assert.equal(workspace.quickActions.find((item) => item.key === "continue-latest")?.href != null, true);
  assert.equal(workspace.notifications[0]?.label, "Votre module Finance a ete valide.");
});

test("notifications never leak another department's module events (the lane-leak bug)", () => {
  const auditEvents: FciDetail["auditEvents"] = [
    {
      id: 301,
      appelOffresId: 1,
      fciModuleId: 201,
      eventType: "fci.generation.completed",
      actor: null,
      payloadJson: { moduleCode: "A" },
      createdAt: "2026-08-02T09:00:00.000Z"
    },
    {
      id: 302,
      appelOffresId: 1,
      fciModuleId: 202,
      eventType: "fci.module.validated",
      actor: null,
      payloadJson: { moduleCode: "B" },
      createdAt: "2026-08-02T10:00:00.000Z"
    },
    {
      id: 303,
      appelOffresId: 1,
      fciModuleId: 203,
      eventType: "fci.generation.failed",
      actor: null,
      payloadJson: { moduleCode: "C" },
      createdAt: "2026-08-02T11:00:00.000Z"
    },
    {
      id: 304,
      appelOffresId: 1,
      fciModuleId: 204,
      eventType: "fci.module.validated",
      actor: null,
      payloadJson: { moduleCode: "D" },
      createdAt: "2026-08-02T12:00:00.000Z"
    }
  ];

  const records = [
    {
      detail: buildDetail({ id: 1, code: "AO-SHARED", buyer: "Client partage" }),
      fciDetail: buildFciDetail("B", "validated", { auditEvents }),
      sourceFiche: null
    }
  ];

  const financeWorkspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records
  });
  assert.equal(financeWorkspace.notifications.length, 1);
  assert.match(financeWorkspace.notifications[0]!.label, /Finance/);
  assert.equal(
    financeWorkspace.notifications.some((item) => /commerciale|Operations|generale/i.test(item.label)),
    false,
    "Finance must never see another department's module event"
  );

  const operationsWorkspace = buildFinanceWorkspacePresentation({
    currentUser: OPERATIONS_USER,
    moduleCode: "C",
    nowIso: "2026-08-03T10:00:00.000Z",
    records
  });
  assert.equal(operationsWorkspace.notifications.length, 1);
  assert.match(operationsWorkspace.notifications[0]!.label, /Operations/);

  const directionGeneraleWorkspace = buildFinanceWorkspacePresentation({
    currentUser: DIRECTION_GENERALE_USER,
    moduleCode: "D",
    nowIso: "2026-08-03T10:00:00.000Z",
    records
  });
  assert.equal(directionGeneraleWorkspace.notifications.length, 1);
  assert.match(directionGeneraleWorkspace.notifications[0]!.label, /Direction generale/);
});

test("test/verification tenders (INT-2026-*) never enter a department workspace or its KPIs", () => {
  const workspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records: [
      {
        detail: buildDetail({ id: 1, code: "AO-REAL", buyer: "Vraie cliente" }),
        fciDetail: buildFciDetail("B", "needs_review"),
        sourceFiche: null
      },
      {
        detail: buildDetail({
          id: 2,
          code: "int-2026-pgtest",
          title: "int-2026-pgtest",
          buyer: "",
          businessStatus: "fiche_validee"
        }),
        fciDetail: buildFciDetail("B", "needs_review"),
        sourceFiche: null
      },
      {
        detail: buildDetail({
          id: 3,
          code: "INT-2026-BIZVERIFY-202607141135",
          title: "Verification AO Modifie",
          buyer: "",
          businessStatus: "fiche_validee"
        }),
        fciDetail: null,
        sourceFiche: null
      }
    ]
  });

  assert.equal(workspace.dossiers.length, 1);
  assert.equal(workspace.dossiers[0]?.code, "AO-REAL");
  assert.equal(workspace.kpis.find((item) => item.key === "attention")?.value, 1);
});

test("empty client/title fall back to the shared 'en attente d'extraction' wording, not a bespoke phrase", () => {
  const workspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records: [
      {
        detail: buildDetail({ id: 1, code: "AO-BLANK", title: "", buyer: "" }),
        fciDetail: buildFciDetail("B", "needs_review"),
        sourceFiche: null
      }
    ]
  });

  assert.equal(workspace.dossiers[0]?.client, "En attente d'extraction");
  assert.notEqual(workspace.dossiers[0]?.client, "Client non renseigne");
});

test("FINANCE/OPERATIONS split their dossiers into tasks (to act on) and history (already validated)", () => {
  const workspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records: [
      {
        detail: buildDetail({ id: 1, code: "AO-TODO", buyer: "Ville A" }),
        fciDetail: buildFciDetail("B", "needs_review"),
        sourceFiche: null
      },
      {
        detail: buildDetail({ id: 2, code: "AO-DONE", buyer: "Ville B" }),
        fciDetail: buildFciDetail("B", "validated"),
        sourceFiche: null
      }
    ]
  });

  assert.equal(workspace.tasks.length, 1);
  assert.equal(workspace.tasks[0]?.code, "AO-TODO");
  assert.equal(workspace.history.length, 1);
  assert.equal(workspace.history[0]?.code, "AO-DONE");
  assert.equal(workspace.history[0]?.validatedAtLabel, "02 août 2026");
  assert.equal(workspace.attentionCount, workspace.tasks.length, "the single metric must equal tasks.length");
});

test("FINANCE/OPERATIONS never fall back to Fiche CDC/tender-lifecycle notifications; DIRECTION_GENERALE still does", () => {
  const detail = buildDetail({
    id: 1,
    code: "AO-NOEVENT",
    buyer: "Client X",
    auditLogs: [
      {
        id: 900,
        appelOffresId: 1,
        action: "fiche_cdc_generated",
        details: null,
        actor: "Claire Martin",
        createdAt: "2026-08-02T09:00:00.000Z"
      }
    ]
  });
  const records = [
    {
      detail,
      fciDetail: buildFciDetail("B", "not_started", { auditEvents: [] }),
      sourceFiche: null
    }
  ];

  const financeWorkspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records
  });
  assert.equal(
    financeWorkspace.notifications.length,
    0,
    "Finance must not see the generic Fiche CDC lifecycle event as a fallback"
  );

  const directionGeneraleWorkspace = buildFinanceWorkspacePresentation({
    currentUser: DIRECTION_GENERALE_USER,
    moduleCode: "D",
    nowIso: "2026-08-03T10:00:00.000Z",
    records: [
      {
        detail,
        fciDetail: buildFciDetail("D", "not_started", { auditEvents: [] }),
        sourceFiche: null
      }
    ]
  });
  assert.equal(
    directionGeneraleWorkspace.notifications.length,
    1,
    "Direction generale keeps the fuller fallback behaviour"
  );
  assert.match(directionGeneraleWorkspace.notifications[0]!.label, /Fiche CDC/i);
});

test("heroSummary uses module-centric wording for the minimal shell and dossier-centric wording for the fuller workspace", () => {
  const records = [
    {
      detail: buildDetail({ id: 1, code: "AO-TODO", buyer: "Ville A" }),
      fciDetail: buildFciDetail("B", "needs_review"),
      sourceFiche: null
    }
  ];

  const financeWorkspace = buildFinanceWorkspacePresentation({
    currentUser: FINANCE_USER,
    moduleCode: "B",
    nowIso: "2026-08-03T10:00:00.000Z",
    records
  });
  assert.equal(financeWorkspace.heroSummary, "1 FCI nécessite votre attention.");

  const directionGeneraleWorkspace = buildFinanceWorkspacePresentation({
    currentUser: DIRECTION_GENERALE_USER,
    moduleCode: "D",
    nowIso: "2026-08-03T10:00:00.000Z",
    records: [
      {
        detail: buildDetail({ id: 1, code: "AO-TODO", buyer: "Ville A" }),
        fciDetail: buildFciDetail("D", "needs_review"),
        sourceFiche: null
      }
    ]
  });
  assert.equal(directionGeneraleWorkspace.heroSummary, "1 dossier necessite votre intervention.");
});

test("getFinanceWorkspacePresentation exposes only truly assigned work for Finance", async () => {
  const assignedUser = {
    id: 101,
    firstName: "Sophie",
    lastName: "Bernard",
    displayName: "Sophie Bernard",
    email: "sophie.bernard@concept.local",
    normalizedEmail: "sophie.bernard@concept.local",
    jobTitle: "Responsable Finance",
    departmentCode: "FINANCE",
    departmentName: "Finance",
    role: "FINANCE",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    lastLoginAt: null
  } satisfies UserRecord;

  const workspace = await getFinanceWorkspacePresentation(FINANCE_USER, "B", {
    listDetails: async () => [
      buildDetail({ id: 1, code: "AO-ASSIGNED", buyer: "Client assigne" }),
      buildDetail({ id: 2, code: "AO-LEGACY", buyer: "Client legacy" })
    ],
    getFciDetail: async (code: string) =>
      buildFciDetail("B", code === "AO-ASSIGNED" ? "needs_review" : "validated"),
    readSourceFiche: async () => null,
    getAssignmentsForUser: async () => [
      {
        id: 900,
        appelOffresId: 1,
        appelOffresCode: "AO-ASSIGNED",
        moduleCode: "B",
        assignedUserId: assignedUser.id,
        assignedRole: "FINANCE",
        assignedDepartmentCode: "FINANCE",
        assignedUserStatus: "ACTIVE",
        assignedByUserId: 1,
        assignedAt: "2026-08-02T10:00:00.000Z",
        reassignedAt: null,
        assignmentStatus: "assigned",
        createdAt: "2026-08-02T10:00:00.000Z",
        updatedAt: "2026-08-02T10:00:00.000Z",
        assignedUserName: assignedUser.displayName,
        assignedUserEmail: assignedUser.email,
        assignedByName: "Claire Martin"
      }
    ],
    listNotificationsForUser: async () => []
  });

  assert.deepEqual(workspace.dossiers.map((row) => row.code), ["AO-ASSIGNED"]);
  assert.equal(
    workspace.dossiers.some((row) => row.code === "AO-LEGACY"),
    false,
    "legacy dossier without assignment must stay hidden from Finance"
  );
});
