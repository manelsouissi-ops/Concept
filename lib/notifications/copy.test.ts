import assert from "node:assert/strict";
import test from "node:test";

import { buildNotificationCopy } from "./copy.ts";

test("FCI D assignment and final DG arbitration have distinct notifications", () => {
  const assignment = buildNotificationCopy({
    eventType: "FCI_ASSIGNED",
    appelOffreCode: "AO-DG-001",
    moduleCode: "D"
  });
  const submission = buildNotificationCopy({
    eventType: "SUBMITTED_TO_DG",
    appelOffreCode: "AO-DG-001"
  });

  assert.equal(assignment.title, "Nouvelle FCI Direction Générale à compléter");
  assert.match(assignment.message, /module Direction Générale/);
  assert.equal(submission.title, "Dossier soumis a la DG");
  assert.match(submission.message, /decision Go\/No-Go/);
  assert.notEqual(assignment.title, submission.title);
});

test("Go/No-Go readiness notification describes four contributions", () => {
  const notification = buildNotificationCopy({
    eventType: "READY_FOR_GONOGO",
    appelOffreCode: "AO-DG-002"
  });

  assert.match(notification.message, /quatre contributions departementales/);
});
