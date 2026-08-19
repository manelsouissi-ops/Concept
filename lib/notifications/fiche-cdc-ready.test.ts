import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFicheCdcReadyActionUrl,
  buildFicheCdcReadyDedupeKey,
  isActiveCommercialNotificationOwner
} from "./orchestration.ts";
import { isFicheCdcReadyNotificationEligible } from "./fiche-cdc-ready.ts";

test("COMPLETED plus applied plus persisted Fiche is eligible", () => {
  assert.equal(
    isFicheCdcReadyNotificationEligible({
      callbackStatus: "COMPLETED",
      callbackApplied: true,
      persistedFicheStatus: "draft"
    }),
    true
  );
});

test("FAILED callback is not eligible for a ready notification", () => {
  assert.equal(
    isFicheCdcReadyNotificationEligible({
      callbackStatus: "FAILED",
      callbackApplied: true,
      persistedFicheStatus: "draft"
    }),
    false
  );
});

test("COMPLETED without successful apply or persisted Fiche is not eligible", () => {
  assert.equal(
    isFicheCdcReadyNotificationEligible({
      callbackStatus: "COMPLETED",
      callbackApplied: false,
      persistedFicheStatus: "draft"
    }),
    false
  );
  assert.equal(
    isFicheCdcReadyNotificationEligible({
      callbackStatus: "COMPLETED",
      callbackApplied: true,
      persistedFicheStatus: null
    }),
    false
  );
});

test("same completed processing job has one deterministic dedupe identity", () => {
  const first = buildFicheCdcReadyDedupeKey("AO-42", "job-7");
  const replay = buildFicheCdcReadyDedupeKey("AO-42", "job-7");
  assert.equal(first, "fiche-cdc-ready:AO-42:job-7");
  assert.equal(replay, first);
});

test("a genuinely regenerated Fiche gets a distinct dedupe identity", () => {
  assert.notEqual(
    buildFicheCdcReadyDedupeKey("AO-42", "job-7"),
    buildFicheCdcReadyDedupeKey("AO-42", "job-8")
  );
});

test("only the active Commercial owner is eligible", () => {
  assert.equal(
    isActiveCommercialNotificationOwner({ userId: 12, status: "ACTIVE", role: "COMMERCIAL" }),
    true
  );
  assert.equal(
    isActiveCommercialNotificationOwner({ userId: 12, status: "INACTIVE", role: "COMMERCIAL" }),
    false
  );
  assert.equal(
    isActiveCommercialNotificationOwner({ userId: null, status: null, role: null }),
    false
  );
  assert.equal(
    isActiveCommercialNotificationOwner({ userId: 15, status: "ACTIVE", role: "FINANCE" }),
    false
  );
});

test("ready notification opens the Fiche CDC review page", () => {
  assert.equal(
    buildFicheCdcReadyActionUrl("AO-20260818-1132"),
    "/appels-offres/AO-20260818-1132/fiche-cdc"
  );
});
