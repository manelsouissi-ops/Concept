import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDecisionCenterReadiness,
  buildDecisionCenterReviewCard,
  sanitizeDecisionCenterModuleError
} from "./dg-decision-center.ts";
import type { FciFormPayload } from "./fci/rendering.ts";
import type { FciModulePresentation } from "./fci/presentation.ts";

function buildModulePresentation(
  moduleCode: "A" | "B" | "C" | "D",
  status: FciModulePresentation["module"]["status"],
  overrides?: Partial<FciModulePresentation["module"]>
): FciModulePresentation {
  return {
    current_user: {
      id: "user-dg",
      name: "Diane DG",
      email: "diane.dg@concept.local",
      role: "DIRECTION_GENERALE",
      role_label: "Direction generale",
      status: "ACTIVE",
      department_code: "DIRECTION_GENERALE",
      department_label: "Direction generale",
      job_title: "Direction generale",
      avatar_url: null,
      phone: null,
      language: "fr-FR",
      timezone: "Europe/Paris",
      last_login_at: null,
      created_at: "2026-08-01T09:00:00.000Z",
      is_development_user: true
    },
    appel_offres: {
      code: "AO-TEST",
      title: "AO test",
      due_date: "2026-08-20T00:00:00.000Z"
    },
    module: {
      id: 1,
      module_code: moduleCode,
      module_type: moduleCode === "A" ? "commercial" : moduleCode === "B" ? "finance" : moduleCode === "C" ? "operations" : "strategy",
      department_code: moduleCode,
      department_label: moduleCode === "A" ? "Commercial" : moduleCode === "B" ? "Finance" : "Operations",
      title: `Module ${moduleCode}`,
      status,
      form_status: status === "validated" ? "completed" : "draft",
      ai_generated_at: null,
      validated_at: status === "validated" ? "2026-08-04T12:00:00.000Z" : null,
      validated_by: status === "validated" ? "Equipe" : null,
      error_code: null,
      error_message: null,
      created_at: "2026-08-01T09:00:00.000Z",
      updated_at: "2026-08-04T12:00:00.000Z",
      ...overrides
    },
    latest_data: null,
    completion: {
      filled: 0,
      total: 0,
      percentage: 0,
      human_inputs_required: 0,
      ready_for_completion: false
    },
    generation_job: null,
    source_fiche: {
      available: true,
      status: "validated",
      is_validated: true,
      version: "validated:test",
      updated_at: "2026-08-04T12:00:00.000Z",
      hash: "hash"
    },
    stale_source: false,
    allowed_actions: ["view_history"],
    permissions: {
      can_view: true,
      can_edit: false,
      can_generate: false,
      can_regenerate: false,
      can_validate: false,
      can_make_final_decision: true,
      read_only: true,
      read_only_message: "Lecture seule"
    },
    history_summary: {
      versions_count: 1,
      jobs_count: 0,
      audit_events_count: 0,
      latest_version: 1,
      latest_job_status: null
    }
  };
}

function buildPayload(moduleCode: "A" | "B" | "C"): FciFormPayload {
  if (moduleCode === "A") {
    return {
      contract_version: "2.0",
      payload_kind: "departmental_fci_form",
      module_code: "A",
      module_type: "commercial",
      department_code: "DC",
      generated_at: null,
      source_fiche: {
        code_interne: "AO-TEST",
        version: "validated:test",
        hash: "hash",
        status: "validated",
        validated_at: "2026-08-04T12:00:00.000Z"
      },
      summary: {
        status: "partial",
        completion_percentage: 50,
        human_inputs_required: 1,
        warnings: []
      },
      data: {
        identification_commune: {},
        a2_positionnement: {
          notre_avantage_differentiel: {
            value: "Bonne proximite client",
            source: "human",
            review_status: "reviewed",
            confidence: "high",
            justification: "",
            source_references: []
          },
          notre_vulnerabilite_principale: {
            value: "Pression tarifaire forte",
            source: "human",
            review_status: "reviewed",
            confidence: "high",
            justification: "",
            source_references: []
          }
        },
        a3_logistique_interne: {
          autres_contraintes: {
            value: "Representation locale a confirmer",
            source: "human",
            review_status: "reviewed",
            confidence: "high",
            justification: "",
            source_references: []
          }
        }
      },
      ai_notes: [],
      validation_warnings: []
    };
  }

  return {
    contract_version: "2.0",
    payload_kind: "departmental_fci_form",
    module_code: moduleCode,
    module_type: moduleCode === "B" ? "finance" : "operations",
    department_code: moduleCode === "B" ? "DF" : "DO",
    generated_at: null,
    source_fiche: {
      code_interne: "AO-TEST",
      version: "validated:test",
      hash: "hash",
      status: "validated",
      validated_at: "2026-08-04T12:00:00.000Z"
    },
    summary: {
      status: "partial",
      completion_percentage: 50,
      human_inputs_required: 1,
      warnings: []
    },
    data: moduleCode === "B"
      ? {
          identification_commune: {},
          b3_synthese_financiere: {
            commentaires_generaux: {
              value: "Synthese financiere favorable sous conditions de tresorerie.",
              source: "human",
              review_status: "reviewed",
              confidence: "high",
              justification: "",
              source_references: []
            },
            pression_tresorerie: {
              value: "Tension de tresorerie moderee",
              source: "human",
              review_status: "reviewed",
              confidence: "high",
              justification: "",
              source_references: []
            },
            points_revue: {
              value: "Garantie bancaire a confirmer",
              source: "human",
              review_status: "reviewed",
              confidence: "high",
              justification: "",
              source_references: []
            }
          }
        }
      : {
          identification_commune: {},
          c5_risques_coordination: {
            risques_vis_a_vis_partenaires: {
              value: "Coordination multisite a surveiller",
              source: "human",
              review_status: "reviewed",
              confidence: "high",
              justification: "",
              source_references: []
            }
          },
          rex_recommandations: {
            points_vigilance_prioritaires: {
              value: "Mobilisation des experts terrain",
              source: "human",
              review_status: "reviewed",
              confidence: "high",
              justification: "",
              source_references: []
            },
            bonnes_pratiques: {
              value: "Rituels de coordination hebdomadaires",
              source: "human",
              review_status: "reviewed",
              confidence: "high",
              justification: "",
              source_references: []
            }
          }
        },
    ai_notes: [],
    validation_warnings: []
  };
}

test("not-ready state lists missing contributions including DG", () => {
  const readiness = buildDecisionCenterReadiness({
    modules: [
      {
        moduleCode: "A",
        summary: {
          module_code: "A",
          department_code: "DC",
          department_label: "Commercial",
          status: "validated",
          validated_at: "2026-08-04T12:00:00.000Z",
          validated_by: "Claire",
          completion_percentage: 100
        }
      },
      {
        moduleCode: "B",
        summary: {
          module_code: "B",
          department_code: "DF",
          department_label: "Finance",
          status: "needs_review",
          validated_at: null,
          validated_by: null,
          completion_percentage: 80
        }
      }
    ]
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.validatedCount, 1);
  assert.deepEqual(readiness.pendingDepartments, ["Finance", "Direction Operationnelle", "Direction Generale"]);
  assert.equal(readiness.entries[1]?.statusLabel, "A completer");
  assert.equal(readiness.entries[2]?.statusLabel, "Non commence");
});

test("ready state requires all four contributions", () => {
  const readiness = buildDecisionCenterReadiness({
    modules: [
      {
        moduleCode: "A",
        summary: {
          module_code: "A",
          department_code: "DC",
          department_label: "Commercial",
          status: "validated",
          validated_at: "2026-08-04T12:00:00.000Z",
          validated_by: "Claire",
          completion_percentage: 100
        }
      },
      {
        moduleCode: "B",
        summary: {
          module_code: "B",
          department_code: "DF",
          department_label: "Finance",
          status: "validated",
          validated_at: "2026-08-04T12:00:00.000Z",
          validated_by: "Farid",
          completion_percentage: 100
        }
      },
      {
        moduleCode: "C",
        summary: {
          module_code: "C",
          department_code: "DO",
          department_label: "Operations",
          status: "validated",
          validated_at: "2026-08-04T12:00:00.000Z",
          validated_by: "Olivia",
          completion_percentage: 100
        }
      },
      {
        moduleCode: "D",
        summary: {
          module_code: "D",
          department_code: "DG",
          department_label: "Direction Generale",
          status: "validated",
          validated_at: "2026-08-04T12:00:00.000Z",
          validated_by: "Diane",
          completion_percentage: 100
        }
      }
    ]
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.validatedCount, 4);
  assert.deepEqual(readiness.pendingDepartments, []);
});

test("review cards stay read-only and expose no mutation controls", () => {
  const card = buildDecisionCenterReviewCard({
    moduleCode: "B",
    modulePresentation: buildModulePresentation("B", "validated"),
    payload: buildPayload("B")
  });

  assert.equal(card.readOnly, true);
  assert.equal(card.showMutationControls, false);
  assert.match(card.executiveSummary, /Synthese financiere/i);
});

test("raw technical processing errors are mapped to safe DG-facing copy", () => {
  const message = sanitizeDecisionCenterModuleError(
    "C",
    new Error("Unterminated string in JSON at position 42")
  );

  assert.match(
    message,
    /La contribution Direction Operationnelle n'a pas pu etre preparee correctement/i
  );
  assert.equal(message.includes("Unterminated string"), false);
});
