import type { FicheStatus } from "@/lib/types.ts";

export const FCI_AI_CONTRACT_VERSION = "1.0" as const;

export const FCI_AI_SOURCE_TYPES = [
  "fiche_cdc",
  "ai_inference",
  "internal_required",
  "unavailable",
  "not_applicable"
] as const;

export type FciAiSourceType = (typeof FCI_AI_SOURCE_TYPES)[number];

export const FCI_AI_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
  "none"
] as const;

export type FciAiConfidence = (typeof FCI_AI_CONFIDENCE_LEVELS)[number];

export const FCI_AI_SUMMARY_STATUSES = [
  "complete",
  "partial",
  "insufficient_data"
] as const;

export type FciAiSummaryStatus = (typeof FCI_AI_SUMMARY_STATUSES)[number];

export const FCI_AI_PRELIMINARY_REVIEW_STATUSES = [
  "favorable_for_review",
  "conditional_review",
  "insufficient_information",
  "high_risk_review"
] as const;

export type FciAiPreliminaryReviewStatus =
  (typeof FCI_AI_PRELIMINARY_REVIEW_STATUSES)[number];

export type FciAiFieldValue = string | number | boolean | string[] | null;

export type FciAiSourceReference = {
  section: string;
  field: string;
  excerpt: string | null;
};

export type FciAiField<TValue extends FciAiFieldValue> = {
  value: TValue;
  source_type: FciAiSourceType;
  confidence: FciAiConfidence;
  requires_human_input: boolean;
  justification: string;
  source_references: FciAiSourceReference[];
};

export type FciAiModuleSummary = {
  status: FciAiSummaryStatus;
  completion_percentage: number;
  human_inputs_required: number;
  warnings: string[];
};

export type FciAiSourceFiche = {
  code_interne: string;
  version: string;
  hash: string | null;
  status: FicheStatus;
  validated_at: string | null;
};

export type FciAiModuleEnvelope<
  TCode extends "A" | "B" | "C" | "D",
  TModuleType extends "commercial" | "finance" | "operations" | "strategy",
  TData
> = {
  contract_version: typeof FCI_AI_CONTRACT_VERSION;
  module_code: TCode;
  module_type: TModuleType;
  generated_at: string | null;
  source_fiche: FciAiSourceFiche;
  summary: FciAiModuleSummary;
  data: TData;
  ai_notes: string[];
  validation_warnings: string[];
};

export type FciCommercialCompetitorRow = {
  nom_du_concurrent: FciAiField<string | null>;
  pays: FciAiField<string | null>;
  points_forts_connus: FciAiField<string | null>;
  historique_avec_le_client: FciAiField<string | null>;
  avantage_principal_pour_ce_cdc: FciAiField<string | null>;
  risque_qu_il_represente: FciAiField<string | null>;
};

export type FciCommercialData = {
  identification_opportunite: {
    reference_interne_code_dossier: FciAiField<string | null>;
    intitule_offre: FciAiField<string | null>;
    date_depot: FciAiField<string | null>;
    prepare_par: FciAiField<string | null>;
    valide_par: FciAiField<string | null>;
  };
  concurrents_premiere_lecture: FciCommercialCompetitorRow[];
  positionnement_offre: {
    notre_avantage_differentiel_principal: FciAiField<string | null>;
    notre_vulnerabilite_principale: FciAiField<string | null>;
    niveau_de_prix_cible_estime: FciAiField<string | null>;
  };
  points_logistiques_internes: {
    delai_de_transit_necessaire: FciAiField<number | null>;
    responsable_depot: FciAiField<string | null>;
    representation_locale_existante: FciAiField<string | null>;
  };
};

export type FciCommercialPayload = FciAiModuleEnvelope<
  "A",
  "commercial",
  FciCommercialData
>;

export type FciFinanceCashFlowRow = {
  jalon_livrable: FciAiField<string | null>;
  pourcentage_montant: FciAiField<string | null>;
  delai_paiement_estime: FciAiField<string | null>;
  risque_cash_flow: FciAiField<string | null>;
};

export type FciFinanceCalculationInput = {
  label: string;
  value: number | string | null;
  unit: string | null;
  source_references: FciAiSourceReference[];
};

export type FciFinanceCalculation = {
  label: string;
  formula: string;
  inputs: FciFinanceCalculationInput[];
  result: FciAiField<number | string | null>;
  justification: string;
  source_references: FciAiSourceReference[];
};

export type FciFinanceData = {
  elements_financiers_internes: {
    budget_estime_du_marche: FciAiField<string | null>;
    taux_de_change_applique_et_source: FciAiField<string | null>;
    coefficient_de_charges_de_structure: FciAiField<string | null>;
    marge_cible_visee: FciAiField<string | null>;
  };
  cash_flow_par_jalon: FciFinanceCashFlowRow[];
  calculs_financiers: FciFinanceCalculation[];
  synthese_financiere: {
    pression_tresorerie_preliminaire: FciAiField<string | null>;
    exposition_garanties: FciAiField<string | null>;
    commentaires_financiers_generaux: FciAiField<string | null>;
    points_de_revue_financiere: FciAiField<string[] | null>;
  };
};

export type FciFinancePayload = FciAiModuleEnvelope<
  "B",
  "finance",
  FciFinanceData
>;

export type FciOperationsExpertKeyRow = {
  poste_ou_expert: FciAiField<string | null>;
  volume_travail_demande_par_le_cdc: FciAiField<string | null>;
  volume_travail_reel_previsionnel: FciAiField<string | null>;
  suppleant: FciAiField<string | null>;
  volume_travail_previsionnel_suppleant: FciAiField<string | null>;
  probabilite_disponibilite_experts: FciAiField<string | null>;
  action_requise: FciAiField<string | null>;
};

export type FciOperationsExpertSupportRow = {
  poste_ou_expert: FciAiField<string | null>;
  volume_travail_reel_previsionnel: FciAiField<string | null>;
  probabilite_disponibilite_experts: FciAiField<string | null>;
  action_requise: FciAiField<string | null>;
};

export type FciOperationsCapacityRow = {
  designation_du_moyen: FciAiField<string | null>;
  quantite_requise: FciAiField<string | null>;
  quantite_disponible: FciAiField<string | null>;
  membre_du_groupement_qui_lapporte: FciAiField<string | null>;
  disponible_au_demarrage: FciAiField<string | null>;
  ecart: FciAiField<string | null>;
};

export type FciOperationsRoleShareRow = {
  composante_ou_tache: FciAiField<string | null>;
  membre_responsable: FciAiField<string | null>;
  experts_affectes: FciAiField<string | null>;
  effort_estime_client_vs_concept: FciAiField<string | null>;
  commentaire_ou_risque: FciAiField<string | null>;
};

export type FciOperationsData = {
  disponibilite_des_experts_cles: FciOperationsExpertKeyRow[];
  disponibilite_des_experts_non_cles: FciOperationsExpertSupportRow[];
  capacite_absorption_globale: FciOperationsCapacityRow[];
  repartition_des_composantes_techniques: FciOperationsRoleShareRow[];
  risques_coordination_mitigation: {
    partenaires_non_encore_eprouves: FciAiField<string | null>;
    frequence_reunions_coordination: FciAiField<string | null>;
    risque_penalites_internes_groupement: FciAiField<string | null>;
    controle_qualite_livrables_partenaires: FciAiField<string | null>;
    risques_vis_a_vis_partenaires: FciAiField<string | null>;
    risques_vis_a_vis_consultants_externes: FciAiField<string | null>;
  };
  synthese_operations: {
    niveau_complexite_operationnelle: FciAiField<string | null>;
    points_blocage_operations: FciAiField<string[] | null>;
    informations_internes_requises: FciAiField<string[] | null>;
  };
};

export type FciOperationsPayload = FciAiModuleEnvelope<
  "C",
  "operations",
  FciOperationsData
>;

export type FciStrategyData = {
  contexte_programme_valeur_strategique: {
    inscription_dans_un_programme_pluriannuel: FciAiField<string | null>;
    valeur_estimee_des_futurs_lots: FciAiField<string | null>;
    positionnement_geographique_vise: FciAiField<string | null>;
    valeur_comme_reference: FciAiField<string | null>;
  };
  enjeux_reputationnels: {
    risque_en_cas_de_sous_performance: FciAiField<string | null>;
    risque_en_cas_de_perte: FciAiField<string | null>;
    valeur_de_test_ou_apprentissage: FciAiField<string | null>;
  };
  decision_strategique_preliminaire: {
    importance_strategique_globale: FciAiField<string | null>;
    marche_prioritaire_pour_la_direction: FciAiField<string | null>;
    commentaires_strategiques_de_la_direction_generale: FciAiField<string | null>;
  };
  synthese_direction: {
    statut_revue_preliminaire: FciAiField<
      FciAiPreliminaryReviewStatus | null
    >;
    opportunites_majeures: FciAiField<string[] | null>;
    menaces_majeures: FciAiField<string[] | null>;
    questions_pour_la_direction: FciAiField<string[] | null>;
    blocages_non_resolus: FciAiField<string[] | null>;
  };
};

export type FciStrategyPayload = FciAiModuleEnvelope<
  "D",
  "strategy",
  FciStrategyData
>;

export type FciAiModulePayload =
  | FciCommercialPayload
  | FciFinancePayload
  | FciOperationsPayload
  | FciStrategyPayload;

export type FciAiPayloadByCode = {
  A: FciCommercialPayload;
  B: FciFinancePayload;
  C: FciOperationsPayload;
  D: FciStrategyPayload;
};

export type FciAiValidationError = {
  path: string;
  keyword: string;
  message: string;
};

export type FciAiValidationResult<TPayload extends FciAiModulePayload> =
  | {
      ok: true;
      data: TPayload;
    }
  | {
      ok: false;
      errors: FciAiValidationError[];
    };

export const FCI_AI_SUPPORTED_MODULE_CODES = ["A", "B", "C", "D"] as const;

export type FciAiSupportedModuleCode =
  (typeof FCI_AI_SUPPORTED_MODULE_CODES)[number];
