import assert from "node:assert/strict";
import test, { after } from "node:test";

import { getCommercialGoNoGoWorkspace } from "./commercial-secondary-workspaces.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import { closeAppelsOffresPool } from "./repository.ts";
import { closeFciPool } from "./fci/repository.ts";
import { closeWorkflowPool } from "./workflow/repository.ts";
import { closeGoNoGoPool } from "./go-no-go/repository.ts";

after(async () => {
  await Promise.all([
    closeAppelsOffresPool(),
    closeFciPool(),
    closeWorkflowPool(),
    closeGoNoGoPool()
  ]);
});

const claire: CurrentUser = {
  id: "2",
  email: "claire.martin@concept.local",
  name: "Claire Martin",
  firstName: "Claire",
  role: "COMMERCIAL",
  jobTitle: "Responsable commerciale",
  departmentCode: "COMMERCIAL",
  departmentLabel: "Direction commerciale",
  status: "ACTIVE",
  avatarUrl: null,
  phone: null,
  language: "fr",
  timezone: "Etc/UTC",
  lastLoginAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isDevelopmentUser: true
};

test("the public /go-no-go loader retains Claire's archived historical NO-GO", async (t) => {
  if (!process.env.DATABASE_URL?.trim()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const workspace = await getCommercialGoNoGoWorkspace(claire);
  const row = workspace.rows.find((item) => item.code === "AO-20260812-0942");

  assert.ok(row, "the real historical dossier must reach the public page model");
  assert.equal(row.filter, "decided");
  assert.equal(row.decision, "NO-GO");
  assert.equal(row.action, "Voir la décision");
  assert.equal(workspace.counts.decided, workspace.rows.filter((item) => item.filter === "decided").length);
  assert.equal(workspace.counts.ready, workspace.rows.filter((item) => item.filter === "ready").length);
  assert.equal(workspace.counts.prepared, workspace.rows.filter((item) => item.filter === "prepared").length);
  assert.equal(workspace.counts.submitted, workspace.rows.filter((item) => item.filter === "submitted").length);
});
