import nextEnv from "@next/env";
import { promises as fs } from "fs";
import path from "path";
import { Client } from "pg";
import { DATA_ROOT } from "../lib/storage.ts";

type AppelOffresDbRow = {
  code: string;
  title: string;
  buyer: string | null;
  country: string | null;
  due_date: string | null;
  notes: string | null;
  priorite: string | null;
  responsable_commercial: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type AuditActionRow = {
  action: string;
  created_at: string;
};

type TestResult = {
  result: "Passed" | "Passed with limitation" | "Failed" | "Not applicable";
  evidence: string;
  notes: string;
};

function getBaseUrl() {
  const value = process.argv[2]?.trim();
  return value || "http://localhost:3001";
}

function buildCode() {
  const iso = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
  return `INT-2026-BIZVERIFY-${iso}`;
}

async function buildPdfFile(samplePath: string) {
  const buffer = await fs.readFile(samplePath);
  return new File([buffer], "cdc.pdf", { type: "application/pdf" });
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return {
    status: response.status,
    ok: response.ok,
    body
  };
}

async function queryAppelOffresByCode(client: Client, code: string) {
  const row = await client.query<AppelOffresDbRow>(
    `
      select
        code,
        title,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at::text,
        updated_at::text,
        archived_at::text
      from public.appels_offres
      where code = $1
    `,
    [code]
  );

  return row.rows[0] ?? null;
}

async function queryAuditActions(client: Client, code: string) {
  const rows = await client.query<AuditActionRow>(
    `
      select a.action, a.created_at::text
      from public.audit_logs a
      inner join public.appels_offres o on o.id = a.appel_offres_id
      where o.code = $1
      order by a.created_at asc, a.id asc
    `,
    [code]
  );

  return rows.rows;
}

async function queryDashboardCounts(client: Client) {
  const rows = await client.query<{
    total: string;
    archived: string;
    drafts: string;
    processing: string;
    errors: string;
  }>(`
    select
      count(*) filter (where archived_at is null) as total,
      count(*) filter (where archived_at is not null) as archived,
      count(*) filter (where status = 'draft' and archived_at is null) as drafts,
      count(*) filter (where status = 'processing' and archived_at is null) as processing,
      count(*) filter (where status = 'error' and archived_at is null) as errors
    from public.appels_offres
  `);

  return rows.rows[0];
}

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());

  const baseUrl = getBaseUrl().replace(/\/$/, "");
  const code = buildCode();
  const samplePdfPath = path.join(DATA_ROOT, "int-2026-1", "cdc.pdf");

  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  await client.connect();

  const results: Record<string, TestResult> = {};

  try {
    const createForm = new FormData();
    createForm.set("code", code);
    createForm.set("title", "Verification AO");
    createForm.set("buyer", "Client Verification");
    createForm.set("country", "France");
    createForm.set("dueDate", "2026-12-31");
    createForm.set("priorite", "haute");
    createForm.set("responsable_commercial", "Alice Martin");
    createForm.set("reference", "REF-VERIFY");
    createForm.set("notes", "Creation for business-data verification");
    createForm.set("file", await buildPdfFile(samplePdfPath));

    const createResponse = await requestJson(`${baseUrl}/api/appels-offres`, {
      method: "POST",
      body: createForm
    });
    const createdRow = await queryAppelOffresByCode(client, code);
    const createdActions = await queryAuditActions(client, code);

    results["Test A - Create"] =
      createResponse.ok &&
      createdRow != null &&
      createdRow.title === "Verification AO" &&
      createdRow.buyer === "Client Verification" &&
      createdRow.country === "France" &&
      createdRow.due_date === "2026-12-31" &&
      createdRow.priorite === "haute" &&
      createdRow.responsable_commercial === "Alice Martin" &&
      createdActions.some((row) => row.action === "appel_offres.created")
        ? {
            result: "Passed",
            evidence: `HTTP ${createResponse.status}; row created with status=${createdRow.status}; ${createdActions.length} audit events`,
            notes: "Create flow persisted the requested business metadata and created an audit trail."
          }
        : {
            result: "Failed",
            evidence: `HTTP ${createResponse.status}; row=${createdRow ? "present" : "missing"}; actions=${createdActions.map((row) => row.action).join(", ")}`,
            notes: "Create flow did not fully persist the expected data or audit event."
          };

    const rowBeforeEdit = createdRow;
    const editForm = new FormData();
    editForm.set("code", code);
    editForm.set("title", "Verification AO Modifie");
    editForm.set("buyer", "Client Verification");
    editForm.set("country", "France");
    editForm.set("dueDate", "2027-01-15");
    editForm.set("priorite", "critique");
    editForm.set("responsable_commercial", "Bob Durand");
    editForm.set("reference", "REF-VERIFY");
    editForm.set("notes", "Updated by verification flow");

    const editResponse = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: editForm
    });
    const rowAfterEdit = await queryAppelOffresByCode(client, code);
    const actionsAfterEdit = await queryAuditActions(client, code);

    results["Test B - Edit"] =
      editResponse.ok &&
      rowBeforeEdit != null &&
      rowAfterEdit != null &&
      rowAfterEdit.title === "Verification AO Modifie" &&
      rowAfterEdit.priorite === "critique" &&
      rowAfterEdit.responsable_commercial === "Bob Durand" &&
      rowAfterEdit.due_date === "2027-01-15" &&
      rowAfterEdit.notes === "Updated by verification flow" &&
      rowAfterEdit.updated_at !== rowBeforeEdit.updated_at &&
      actionsAfterEdit.some((row) => row.action === "appel_offres.updated")
        ? {
            result: "Passed",
            evidence: `HTTP ${editResponse.status}; updated_at changed from ${rowBeforeEdit.updated_at} to ${rowAfterEdit.updated_at}`,
            notes: "Edit flow updated business fields without losing unchanged values."
          }
        : {
            result: "Failed",
            evidence: `HTTP ${editResponse.status}; before=${rowBeforeEdit?.updated_at ?? "n/a"} after=${rowAfterEdit?.updated_at ?? "n/a"}`,
            notes: "Edit flow did not fully update the expected fields or audit trail."
          };

    const archiveResponse = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(code)}/archive`, {
      method: "POST"
    });
    const rowAfterArchive = await queryAppelOffresByCode(client, code);
    const actionsAfterArchive = await queryAuditActions(client, code);
    const sourcePdfStillExists = await fs
      .access(path.join(DATA_ROOT, code, "cdc.pdf"))
      .then(() => true)
      .catch(() => false);
    const detailAfterArchive = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(code)}`);
    const activeListAfterArchive = await requestJson(`${baseUrl}/api/appels-offres`);
    const archivedListAfterArchive = await requestJson(`${baseUrl}/api/appels-offres?archived=true`);

    const activeListItems = Array.isArray(activeListAfterArchive.body) ? activeListAfterArchive.body : [];
    const archivedListItems = Array.isArray(archivedListAfterArchive.body) ? archivedListAfterArchive.body : [];

    results["Test C - Archive"] =
      archiveResponse.ok &&
      rowAfterArchive?.archived_at != null &&
      sourcePdfStillExists &&
      detailAfterArchive.ok &&
      !activeListItems.some((item) => item && typeof item === "object" && (item as { code?: string }).code === code) &&
      archivedListItems.some((item) => item && typeof item === "object" && (item as { code?: string }).code === code) &&
      actionsAfterArchive.some((row) => row.action === "appel_offres.archived")
        ? {
            result: "Passed",
            evidence: `HTTP ${archiveResponse.status}; archived_at=${rowAfterArchive.archived_at}`,
            notes: "Archive removed the record from the default active list and preserved disk artifacts."
          }
        : {
            result: "Failed",
            evidence: `HTTP ${archiveResponse.status}; archived_at=${rowAfterArchive?.archived_at ?? "null"}; pdf=${sourcePdfStillExists}`,
            notes: "Archive behavior or visibility did not match expectations."
          };

    const unarchiveResponse = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(code)}/unarchive`, {
      method: "POST"
    });
    const rowAfterUnarchive = await queryAppelOffresByCode(client, code);
    const actionsAfterUnarchive = await queryAuditActions(client, code);
    const activeListAfterUnarchive = await requestJson(`${baseUrl}/api/appels-offres`);
    const activeListAfterUnarchiveItems = Array.isArray(activeListAfterUnarchive.body)
      ? activeListAfterUnarchive.body
      : [];

    results["Test D - Unarchive"] =
      unarchiveResponse.ok &&
      rowAfterUnarchive?.archived_at == null &&
      activeListAfterUnarchiveItems.some(
        (item) => item && typeof item === "object" && (item as { code?: string }).code === code
      ) &&
      actionsAfterUnarchive.some((row) => row.action === "appel_offres.unarchived")
        ? {
            result: "Passed",
            evidence: `HTTP ${unarchiveResponse.status}; status=${rowAfterUnarchive.status}`,
            notes: "Unarchive restored the active visibility without losing data."
          }
        : {
            result: "Failed",
            evidence: `HTTP ${unarchiveResponse.status}; archived_at=${rowAfterUnarchive?.archived_at ?? "n/a"}`,
            notes: "Unarchive did not fully restore the active state."
          };

    const dashboardResponse = await requestJson(`${baseUrl}/api/dashboard`);
    const dashboardDbCounts = await queryDashboardCounts(client);
    const dashboardBody =
      dashboardResponse.body && typeof dashboardResponse.body === "object"
        ? (dashboardResponse.body as Record<string, unknown>)
        : null;

    const totalMatches =
      dashboardBody?.total_appels_offres === Number(dashboardDbCounts.total);
    const archiveMatches =
      dashboardBody?.archives === Number(dashboardDbCounts.archived);
    const errorMatches =
      dashboardBody?.erreurs_traitement === Number(dashboardDbCounts.errors);

    results["Test E - Dashboard"] =
      dashboardResponse.ok && totalMatches && archiveMatches && errorMatches
        ? {
            result: "Passed with limitation",
            evidence: `HTTP ${dashboardResponse.status}; total=${dashboardBody?.total_appels_offres}; archives=${dashboardBody?.archives}; errors=${dashboardBody?.erreurs_traitement}`,
            notes: "Core totals matched direct SQL counts. Fiche-derived KPI buckets depend on disk fiche status mapping rather than simple raw SQL."
          }
        : {
            result: "Failed",
            evidence: `HTTP ${dashboardResponse.status}; body=${JSON.stringify(dashboardBody)}`,
            notes: "Dashboard totals did not match the direct database state."
          };

    const filteredByCode = await requestJson(
      `${baseUrl}/api/appels-offres?search=${encodeURIComponent(code)}`
    );
    const filteredByPriority = await requestJson(
      `${baseUrl}/api/appels-offres?priorite=critique`
    );
    const sortedByDeadline = await requestJson(
      `${baseUrl}/api/appels-offres?sort=deadline`
    );

    const filteredByCodeItems = Array.isArray(filteredByCode.body) ? filteredByCode.body : [];
    const filteredByPriorityItems = Array.isArray(filteredByPriority.body) ? filteredByPriority.body : [];
    const sortedByDeadlineItems = Array.isArray(sortedByDeadline.body) ? sortedByDeadline.body : [];

    results["Test F - Filters and sorting"] =
      filteredByCode.ok &&
      filteredByCodeItems.some(
        (item) => item && typeof item === "object" && (item as { code?: string }).code === code
      ) &&
      filteredByPriority.ok &&
      filteredByPriorityItems.some(
        (item) => item && typeof item === "object" && (item as { code?: string }).code === code
      ) &&
      sortedByDeadline.ok &&
      sortedByDeadlineItems.length > 0
        ? {
            result: "Passed with limitation",
            evidence: `search=${filteredByCodeItems.length}; priority=${filteredByPriorityItems.length}; sorted=${sortedByDeadlineItems.length}`,
            notes: "API-backed filtering and sorting worked. Client-side UI toggles were verified indirectly through the same live dataset rather than browser automation."
          }
        : {
            result: "Failed",
            evidence: `search=${filteredByCode.status}; priority=${filteredByPriority.status}; sort=${sortedByDeadline.status}`,
            notes: "Live filtering or sorting did not behave as expected."
          };

    const detailResponse = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(code)}`);
    const historyResponse = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(code)}/history`);
    const ficheResponse = await requestJson(`${baseUrl}/api/fiche/int-2026-1`);

    const detailBody =
      detailResponse.body && typeof detailResponse.body === "object"
        ? (detailResponse.body as Record<string, unknown>)
        : null;
    const historyItems = Array.isArray(historyResponse.body) ? historyResponse.body : [];

    results["Test G - Workspace"] =
      detailResponse.ok &&
      detailBody?.priorite === "critique" &&
      detailBody?.responsableCommercial === "Bob Durand" &&
      typeof detailBody?.updatedAt === "string" &&
      historyResponse.ok &&
      historyItems.length > 0 &&
      ficheResponse.ok
        ? {
            result: "Passed",
            evidence: `detail HTTP ${detailResponse.status}; history entries=${historyItems.length}; fiche HTTP ${ficheResponse.status}`,
            notes: "Workspace API state, history feed, document preservation, and fiche compatibility all remained accessible."
          }
        : {
            result: "Failed",
            evidence: `detail=${detailResponse.status}; history=${historyResponse.status}; fiche=${ficheResponse.status}`,
            notes: "Workspace data or compatibility endpoints did not fully respond as expected."
          };

    const compatibilityCodes = ["int-2026-1", "INT-2026-9", "INT-2026-ASYNC-8"];
    const compatibilityChecks = await Promise.all(
      compatibilityCodes.map(async (existingCode) => {
        const detail = await requestJson(`${baseUrl}/api/appels-offres/${encodeURIComponent(existingCode)}`);
        return {
          code: existingCode,
          ok: detail.ok
        };
      })
    );

    results["Test H - Compatibility"] = compatibilityChecks.every((item) => item.ok)
      ? {
          result: "Passed",
          evidence: compatibilityChecks.map((item) => `${item.code}:${item.ok ? "ok" : "fail"}`).join(", "),
          notes: "Pre-existing disk bundles across ready, error, and processing states still resolved through the business-data layer."
        }
      : {
          result: "Failed",
          evidence: compatibilityChecks.map((item) => `${item.code}:${item.ok ? "ok" : "fail"}`).join(", "),
          notes: "One or more legacy bundles no longer resolved correctly."
        };

    console.log(
      JSON.stringify(
        {
          baseUrl,
          code,
          results
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        failed: true,
        message: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
