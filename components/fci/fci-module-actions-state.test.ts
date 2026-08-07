import test from "node:test";
import assert from "node:assert/strict";
import { buildFciModuleActionGroups } from "./fci-module-actions-state.ts";
import type { FciModuleAllowedAction } from "@/lib/appels-offres/fci/presentation.ts";

function createModulePresentationFixture(input?: {
  latestData?: boolean;
  actions?: FciModuleAllowedAction[];
  canEdit?: boolean;
  canValidate?: boolean;
  canGenerate?: boolean;
  canRegenerate?: boolean;
}) {
  return {
    allowed_actions: input?.actions ?? ["validate", "regenerate", "view_history"],
    permissions: {
      can_view: true,
      can_edit: input?.canEdit ?? true,
      can_generate: input?.canGenerate ?? true,
      can_regenerate: input?.canRegenerate ?? true,
      can_validate: input?.canValidate ?? true,
      can_make_final_decision: false,
      read_only: !(input?.canEdit ?? true),
      read_only_message: input?.canEdit === false ? "Lecture seule" : null
    },
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
  assert.ok(labels.includes("Marquer comme termine"));
  assert.ok(labels.includes("Telecharger Word"));
  assert.ok(labels.includes("Telecharger PDF"));
});

test("save and reset are disabled while save is pending", () => {
  const groups = buildFciModuleActionGroups({
    modulePresentation: createModulePresentationFixture({
      latestData: false,
      actions: ["validate"],
      canGenerate: false,
      canRegenerate: false
    }),
    isDirty: true,
    isBusy: true,
    pendingAction: "save"
  });

  const buttons = groups.flatMap((group) => group.buttons);
  const save = buttons.find((button) => button.action === "save");
  const reset = buttons.find((button) => button.action === "reset");

  assert.equal(save?.label, "Enregistrement...");
  assert.equal(save?.disabled, true);
  assert.equal(reset?.disabled, true);
});

test("read-only modules hide save and reset actions", () => {
  const groups = buildFciModuleActionGroups({
    modulePresentation: createModulePresentationFixture({
      canEdit: false,
      canValidate: false,
      canGenerate: false,
      canRegenerate: false,
      actions: ["view_history"]
    }),
    isDirty: true,
    isBusy: false,
    pendingAction: null
  });

  const actions = groups.flatMap((group) => group.buttons.map((button) => button.action));
  assert.equal(actions.includes("save"), false);
  assert.equal(actions.includes("reset"), false);
});

test("initial generate action is no longer exposed in module action groups", () => {
  const groups = buildFciModuleActionGroups({
    modulePresentation: createModulePresentationFixture({
      latestData: false,
      actions: ["view_history"],
      canGenerate: true,
      canRegenerate: false
    }),
    isDirty: false,
    isBusy: false,
    pendingAction: null
  });

  const labels = groups.flatMap((group) => group.buttons.map((button) => button.label));
  assert.equal(labels.includes("Lancer la generation"), false);
});
