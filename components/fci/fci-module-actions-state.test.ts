import test from "node:test";
import assert from "node:assert/strict";
import { buildFciModuleActionGroups } from "./fci-module-actions-state.ts";
import type { FciModuleAllowedAction } from "@/lib/appels-offres/fci/presentation.ts";

function createModulePresentationFixture(input?: {
  latestData?: boolean;
  actions?: FciModuleAllowedAction[];
}) {
  return {
    allowed_actions: input?.actions ?? ["generate", "validate", "regenerate", "view_history"],
    latest_data:
      input?.latestData === false
        ? null
        : {
            version: 1,
            data: {},
            source_summary: null,
            confidence: null,
            ai_notes: null,
            generated_from_fiche_version: null,
            generated_from_fiche_hash: null,
            created_at: "2026-07-30T10:00:00.000Z",
            updated_at: "2026-07-30T10:00:00.000Z"
          }
  };
}

test("action groups include export buttons when data exists", () => {
  const groups = buildFciModuleActionGroups({
    modulePresentation: createModulePresentationFixture(),
    isDirty: true,
    isBusy: false,
    pendingAction: null
  });

  const labels = groups.flatMap((group) => group.buttons.map((button) => button.label));
  assert.ok(labels.includes("Enregistrer le brouillon"));
  assert.ok(labels.includes("Marquer comme terminé"));
  assert.ok(labels.includes("Télécharger Word"));
  assert.ok(labels.includes("Télécharger PDF"));
});

test("save and reset are disabled while save is pending", () => {
  const groups = buildFciModuleActionGroups({
    modulePresentation: createModulePresentationFixture({ latestData: false, actions: ["validate"] }),
    isDirty: true,
    isBusy: true,
    pendingAction: "save"
  });

  const buttons = groups.flatMap((group) => group.buttons);
  const save = buttons.find((button) => button.action === "save");
  const reset = buttons.find((button) => button.action === "reset");

  assert.equal(save?.label, "Enregistrement…");
  assert.equal(save?.disabled, true);
  assert.equal(reset?.disabled, true);
});
