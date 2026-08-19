import type {
  FciAiConfidence,
  FciAiField,
  FciAiFieldValue,
  FciAiModulePayload,
  FciAiSourceReference,
  FciAiSupportedModuleCode
} from "./ai-contracts.ts";
import type { FicheStatus } from "@/lib/types.ts";
import { deriveDeadlinePresentation } from "../extraction-identity.ts";
import type { FciHumanVisibleModuleCode, FciModuleType } from "./types.ts";
import { FCI_HUMAN_VISIBLE_MODULE_CODES } from "./types.ts";

export const FCI_FORM_CONTRACT_VERSION = "2.0" as const;
export const FCI_FORM_PAYLOAD_KIND = "departmental_fci_form" as const;

export type FciFieldSource = "ai" | "human" | "tender" | "cdc" | "system";
export type FciFieldReviewStatus = "to_review" | "reviewed" | "human_required";
export type FciDepartmentCode = "DC" | "DF" | "DO" | "DG";
export type FciFormStatus = "not_started" | "draft" | "ready_for_review" | "completed";

export type FciFieldInputType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "boolean"
  | "select"
  | "list"
  | "readonly";

export type FciFieldValueType = "string" | "number" | "boolean" | "string_array";
export type FciSectionDisplayType = "object" | "table";

export type FciFormFieldValue = string | number | boolean | string[] | null;

export type FciFormField<TValue extends FciFormFieldValue = FciFormFieldValue> = {
  value: TValue;
  source: FciFieldSource;
  review_status: FciFieldReviewStatus;
  confidence: FciAiConfidence;
  justification: string;
  source_references: FciAiSourceReference[];
  original_ai_value?: TValue | null;
};

export type FciFormPayload = {
  contract_version: typeof FCI_FORM_CONTRACT_VERSION;
  payload_kind: typeof FCI_FORM_PAYLOAD_KIND;
  module_code: FciAiSupportedModuleCode;
  module_type: Extract<FciModuleType, "commercial" | "finance" | "operations" | "strategy">;
  department_code: FciDepartmentCode;
  generated_at: string | null;
  source_fiche: {
    code_interne: string;
    version: string;
    hash: string | null;
    status: FicheStatus;
    validated_at: string | null;
  };
  summary: {
    status: "complete" | "partial" | "insufficient_data";
    completion_percentage: number;
    human_inputs_required: number;
    warnings: string[];
  };
  data: Record<string, unknown>;
  ai_notes: string[];
  validation_warnings: string[];
};

export type FciFieldDefinition = {
  key: string;
  label: string;
  description?: string;
  section: string;
  inputType: FciFieldInputType;
  valueType: FciFieldValueType;
  editable: boolean;
  required: boolean;
  multiline?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{
    value: string;
    label: string;
  }>;
  sourceLabel?: "ai" | "human" | "dossier" | "system";
  internalInputExpected?: boolean;
  showJustification?: boolean;
  showConfidence?: boolean;
  conditional?: (payload: FciFormPayload) => boolean;
};

export type FciSectionDefinition = {
  key: string;
  title: string;
  description?: string;
  order: number;
  display: FciSectionDisplayType;
  fields: FciFieldDefinition[];
  addRowLabel?: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  minRows?: number;
};

export type FciModuleDefinition = {
  moduleCode: FciAiSupportedModuleCode;
  moduleType: Extract<FciModuleType, "commercial" | "finance" | "operations" | "strategy">;
  departmentCode: FciDepartmentCode;
  departmentLabel: string;
  title: string;
  shortTitle: string;
  description: string;
  sections: FciSectionDefinition[];
};

export type FciPayloadDefaults = {
  codeInterne: string;
  intituleOffre: string;
  dateDepot: string | null;
  sourceDeadline?: string | null;
  preparedByName?: string | null;
  validatedByName?: string | null;
  sourceFiche: {
    code_interne: string;
    version: string;
    hash: string | null;
    status: FicheStatus;
    validated_at: string | null;
  };
};

export type FciPayloadCompletion = {
  filled: number;
  total: number;
  percentage: number;
  humanInputsRequired: number;
  satisfiedRepeatableRules: number;
  totalRepeatableRules: number;
};

export type FciPayloadValidationError = {
  path: string;
  section: string;
  message: string;
};

function createRowId(prefix: string) {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`;
}

function toIsoDateInput(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const directMatch = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) {
    return directMatch[1];
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return items.length ? items : null;
  }

  if (typeof value === "string") {
    const items = value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length ? items : null;
  }

  return null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseBooleanLike(value: unknown) {
  if (typeof value === "boolean") {
    return { value, details: null as string | null };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { value: null, details: null as string | null };
    }

    const normalized = trimmed.toLowerCase();
    if (
      normalized === "oui"
      || normalized === "yes"
      || normalized === "true"
      || normalized.startsWith("oui ")
      || normalized.startsWith("oui,")
      || normalized.startsWith("oui/")
    ) {
      return { value: true, details: trimmed };
    }

    if (
      normalized === "non"
      || normalized === "no"
      || normalized === "false"
      || normalized.startsWith("non ")
      || normalized.startsWith("non,")
      || normalized.startsWith("non/")
    ) {
      return { value: false, details: trimmed };
    }

    return { value: null, details: trimmed };
  }

  return { value: null, details: null as string | null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function makeSystemField(
  value: FciFormFieldValue,
  origin: Extract<FciFieldSource, "tender" | "cdc" | "system">,
  justification: string
): FciFormField {
  return {
    value,
    source: origin,
    review_status: "reviewed",
    confidence: "high",
    justification,
    source_references: []
  };
}

function makeHumanField(
  justification: string,
  value: FciFormFieldValue = null
): FciFormField {
  return {
    value,
    source: "human",
    review_status: value == null ? "human_required" : "reviewed",
    confidence: value == null ? "none" : "high",
    justification,
    source_references: []
  };
}

function makeAiField(
  value: FciFormFieldValue,
  confidence: FciAiConfidence,
  justification: string,
  sourceReferences: FciAiSourceReference[],
  requiresHumanInput = false
): FciFormField {
  return {
    value,
    source: "ai",
    review_status: requiresHumanInput ? "human_required" : "to_review",
    confidence,
    justification,
    source_references: sourceReferences,
    original_ai_value: value
  };
}

function makeDossierField(
  value: FciFormFieldValue,
  justification: string,
  sourceReferences: FciAiSourceReference[] = []
): FciFormField {
  return {
    value,
    source: "cdc",
    review_status: "reviewed",
    confidence: value == null ? "none" : "high",
    justification,
    source_references: sourceReferences
  };
}

function createFieldDefinition(
  section: string,
  key: string,
  label: string,
  options: Partial<FciFieldDefinition> = {}
): FciFieldDefinition {
  return {
    key,
    label,
    section,
    inputType: "text",
    valueType: "string",
    editable: true,
    required: false,
    placeholder: "Information non renseignee",
    internalInputExpected: false,
    showJustification: false,
    showConfidence: false,
    ...options
  };
}

function commonHeaderSection(): FciSectionDefinition {
  return {
    key: "identification_commune",
    title: "Identification du dossier",
    description: "Informations communes reprises depuis le dossier d'appel d'offres.",
    order: 1,
    display: "object",
    fields: [
      createFieldDefinition("identification_commune", "reference_interne_code_dossier", "Reference interne / code dossier", {
        editable: false,
        inputType: "readonly",
        required: true,
        sourceLabel: "system"
      }),
      createFieldDefinition("identification_commune", "intitule_offre", "Intitule de l'offre", {
        editable: false,
        inputType: "readonly",
        required: true,
        sourceLabel: "dossier"
      }),
      createFieldDefinition("identification_commune", "date_depot", "Date de depot", {
        editable: false,
        inputType: "readonly",
        required: true,
        sourceLabel: "dossier"
      }),
      createFieldDefinition("identification_commune", "prepared_by_name", "Prepare par", {
        required: true,
        internalInputExpected: true,
        sourceLabel: "human"
      }),
      createFieldDefinition("identification_commune", "validated_by_name", "Valide par", {
        required: true,
        internalInputExpected: true,
        sourceLabel: "human"
      })
    ]
  };
}

function createModuleDefinitions(): Record<FciAiSupportedModuleCode, FciModuleDefinition> {
  return {
    A: {
      moduleCode: "A",
      moduleType: "commercial",
      departmentCode: "DC",
      departmentLabel: "Direction Commerciale",
      title: "FCI — Direction Commerciale",
      shortTitle: "Direction Commerciale",
      description: "Veille concurrentielle, positionnement commercial et logistique interne.",
      sections: [
        commonHeaderSection(),
        {
          key: "a1_concurrents",
          title: "A1. Concurrents",
          description: "Concurrents identifies et premiere lecture commerciale.",
          order: 2,
          display: "table",
          addRowLabel: "Ajouter un concurrent",
          emptyStateTitle: "Aucun concurrent renseigne",
          emptyStateDescription: "Ajoutez un concurrent ou laissez la section vide si aucun nom n'est encore confirme.",
          fields: [
            createFieldDefinition("a1_concurrents", "nom", "Nom du concurrent", {
              required: true,
              sourceLabel: "dossier"
            }),
            createFieldDefinition("a1_concurrents", "pays", "Pays", {
              required: true,
              sourceLabel: "dossier"
            }),
            createFieldDefinition("a1_concurrents", "points_forts_connus", "Points forts connus", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("a1_concurrents", "historique_client", "Historique avec le client", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("a1_concurrents", "avantage_principal", "Avantage principal pour ce CDC", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("a1_concurrents", "risque_represente", "Risque qu'il represente", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "a2_positionnement",
          title: "A2. Positionnement",
          order: 3,
          display: "object",
          fields: [
            createFieldDefinition("a2_positionnement", "avantage_differentiel", "Notre avantage differentiel principal", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("a2_positionnement", "vulnerabilite_principale", "Notre vulnerabilite principale", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("a2_positionnement", "niveau_prix_cible", "Niveau de prix cible estime", {
              inputType: "currency",
              required: true,
              internalInputExpected: true,
              placeholder: "Ex. 1 200 000 000 FCFA",
              sourceLabel: "human"
            })
          ]
        },
        {
          key: "a3_logistique_interne",
          title: "A3. Logistique interne",
          order: 4,
          display: "object",
          fields: [
            createFieldDefinition("a3_logistique_interne", "delai_transit_jours", "Delai de transit necessaire", {
              inputType: "number",
              valueType: "number",
              placeholder: "Jours ouvres",
              sourceLabel: "human"
            }),
            createFieldDefinition("a3_logistique_interne", "responsable_depot", "Responsable du depot", {
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("a3_logistique_interne", "representation_locale_existante", "Representation locale existante", {
              inputType: "boolean",
              valueType: "boolean",
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("a3_logistique_interne", "representation_locale_details", "Details de la representation locale", {
              inputType: "textarea",
              multiline: true,
              internalInputExpected: true,
              conditional: (payload) =>
                getObjectField(payload, "a3_logistique_interne", "representation_locale_existante")?.value === true,
              sourceLabel: "human"
            })
          ]
        }
      ]
    },
    B: {
      moduleCode: "B",
      moduleType: "finance",
      departmentCode: "DF",
      departmentLabel: "Direction Financiere",
      title: "FCI — Direction Financiere",
      shortTitle: "Direction Financiere",
      description: "Analyse financiere preliminaire et synthese de cash-flow.",
      sections: [
        commonHeaderSection(),
        {
          key: "b1_elements_financiers",
          title: "B1. Elements financiers internes",
          order: 2,
          display: "object",
          fields: [
            createFieldDefinition("b1_elements_financiers", "budget_estime_marche", "Budget estime du marche", {
              inputType: "currency",
              placeholder: "Montant et monnaie",
              sourceLabel: "ai"
            }),
            createFieldDefinition("b1_elements_financiers", "budget_estime_source", "Source de l'estimation", {
              sourceLabel: "human"
            }),
            createFieldDefinition("b1_elements_financiers", "taux_change", "Taux de change applique et source", {
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("b1_elements_financiers", "coefficient_charges_structure", "Coefficient de charges de structure", {
              inputType: "percentage",
              required: true,
              internalInputExpected: true,
              placeholder: "Ex. 12%",
              sourceLabel: "human"
            }),
            createFieldDefinition("b1_elements_financiers", "marge_cible", "Marge cible visee", {
              inputType: "percentage",
              required: true,
              internalInputExpected: true,
              placeholder: "Ex. 15%",
              sourceLabel: "human"
            })
          ]
        },
        {
          key: "b2_jalons_cash_flow",
          title: "B2. Jalons / cash-flow",
          order: 3,
          display: "table",
          addRowLabel: "Ajouter un jalon",
          emptyStateTitle: "Aucun jalon renseigne",
          emptyStateDescription: "Ajoutez les jalons utiles au suivi de tresorerie.",
          fields: [
            createFieldDefinition("b2_jalons_cash_flow", "jalon_livrable", "Jalon / Livrable", {
              required: true,
              sourceLabel: "dossier"
            }),
            createFieldDefinition("b2_jalons_cash_flow", "pourcentage_montant", "% du montant", {
              inputType: "percentage",
              required: true,
              sourceLabel: "dossier"
            }),
            createFieldDefinition("b2_jalons_cash_flow", "delai_paiement_estime", "Delai de paiement estime", {
              sourceLabel: "ai"
            }),
            createFieldDefinition("b2_jalons_cash_flow", "risque_cash_flow", "Risque de cash-flow", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "b3_synthese_financiere",
          title: "B3. Synthese financiere",
          order: 4,
          display: "object",
          fields: [
            createFieldDefinition("b3_synthese_financiere", "commentaires_generaux", "Commentaires financiers generaux", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "ai"
            })
          ]
        }
      ]
    },
    C: {
      moduleCode: "C",
      moduleType: "operations",
      departmentCode: "DO",
      departmentLabel: "Direction Operationnelle",
      title: "FCI — Direction Operationnelle",
      shortTitle: "Direction Operationnelle",
      description: "Ressources, capacite, repartition des roles et retour d'experience.",
      sections: [
        commonHeaderSection(),
        {
          key: "c1_ressources_cles",
          title: "1. Ressources cles",
          order: 2,
          display: "table",
          addRowLabel: "Ajouter un expert cle",
          emptyStateTitle: "Aucun expert cle",
          emptyStateDescription: "Ajoutez les profils clefs a confirmer pour cette offre.",
          fields: [
            createFieldDefinition("c1_ressources_cles", "poste_expert", "Poste / Expert", {
              required: true,
              sourceLabel: "dossier"
            }),
            createFieldDefinition("c1_ressources_cles", "volume_demande_cdc", "Volume de travail demande par le CDC", {
              sourceLabel: "dossier"
            }),
            createFieldDefinition("c1_ressources_cles", "volume_reel_previsionnel", "Volume de travail reel previsionnel", {
              inputType: "number",
              valueType: "number",
              required: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c1_ressources_cles", "suppleant", "Suppleant", {
              sourceLabel: "human"
            }),
            createFieldDefinition("c1_ressources_cles", "volume_previsionnel_suppleant", "Volume de travail previsionnel du suppleant", {
              inputType: "number",
              valueType: "number",
              sourceLabel: "human"
            }),
            createFieldDefinition("c1_ressources_cles", "probabilite_disponibilite", "Probabilite de disponibilite", {
              inputType: "select",
              required: true,
              internalInputExpected: true,
              sourceLabel: "human",
              options: [
                { value: "faible", label: "Faible" },
                { value: "moyenne", label: "Moyenne" },
                { value: "elevee", label: "Elevee" },
                { value: "a_confirmer", label: "A confirmer" }
              ]
            }),
            createFieldDefinition("c1_ressources_cles", "action_requise", "Action requise", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            })
          ]
        },
        {
          key: "c2_ressources_non_cles",
          title: "2. Ressources non cles",
          order: 3,
          display: "table",
          addRowLabel: "Ajouter un expert non cle",
          emptyStateTitle: "Aucun expert non cle",
          emptyStateDescription: "Ajoutez les profils de soutien ou de renfort.",
          fields: [
            createFieldDefinition("c2_ressources_non_cles", "poste_expert", "Poste / Expert", {
              required: true,
              sourceLabel: "dossier"
            }),
            createFieldDefinition("c2_ressources_non_cles", "volume_previsionnel", "Volume de travail reel previsionnel", {
              inputType: "number",
              valueType: "number",
              sourceLabel: "human"
            }),
            createFieldDefinition("c2_ressources_non_cles", "probabilite_disponibilite", "Probabilite de disponibilite", {
              inputType: "select",
              internalInputExpected: true,
              sourceLabel: "human",
              options: [
                { value: "faible", label: "Faible" },
                { value: "moyenne", label: "Moyenne" },
                { value: "elevee", label: "Elevee" },
                { value: "a_confirmer", label: "A confirmer" }
              ]
            }),
            createFieldDefinition("c2_ressources_non_cles", "action_requise", "Action requise", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            })
          ]
        },
        {
          key: "c3_moyens_capacite",
          title: "3. Moyens et capacite",
          order: 4,
          display: "table",
          addRowLabel: "Ajouter un moyen",
          emptyStateTitle: "Aucun moyen renseigne",
          emptyStateDescription: "Ajoutez les moyens a confirmer pour le demarrage.",
          fields: [
            createFieldDefinition("c3_moyens_capacite", "designation", "Designation du moyen", {
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("c3_moyens_capacite", "quantite_requise", "Quantite requise", {
              inputType: "number",
              valueType: "number",
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("c3_moyens_capacite", "quantite_disponible", "Quantite disponible", {
              inputType: "number",
              valueType: "number",
              required: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c3_moyens_capacite", "membre_apporteur", "Membre du groupement qui l'apporte", {
              sourceLabel: "human"
            }),
            createFieldDefinition("c3_moyens_capacite", "disponible_demarrage", "Disponible au demarrage", {
              inputType: "boolean",
              valueType: "boolean",
              required: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c3_moyens_capacite", "ecart", "Ecart", {
              editable: false,
              inputType: "readonly",
              valueType: "number",
              sourceLabel: "system"
            })
          ]
        },
        {
          key: "c4_repartition_roles",
          title: "4. Repartition des roles",
          order: 5,
          display: "table",
          addRowLabel: "Ajouter une composante",
          emptyStateTitle: "Aucune composante",
          emptyStateDescription: "Ajoutez les composantes ou taches a repartir entre membres.",
          fields: [
            createFieldDefinition("c4_repartition_roles", "composante_tache", "Composante / Tache", {
              required: true,
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("c4_repartition_roles", "membre_responsable", "Membre responsable", {
              required: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c4_repartition_roles", "experts_affectes", "Expert(s) affecte(s)", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c4_repartition_roles", "effort_client_vs_concept", "Effort estime par le client vs effort estime par Concept", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c4_repartition_roles", "commentaire_risque", "Commentaire / Risque", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "c5_risques_coordination",
          title: "5. Risques de coordination",
          order: 6,
          display: "object",
          fields: [
            createFieldDefinition("c5_risques_coordination", "partenaires_non_eprouves", "Partenaires non encore eprouves", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c5_risques_coordination", "frequence_reunions_coordination", "Frequence des reunions de coordination", {
              sourceLabel: "human"
            }),
            createFieldDefinition("c5_risques_coordination", "penalites_internes_groupement", "Risque de penalites internes au groupement", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c5_risques_coordination", "controle_qualite_livrables", "Controle qualite des livrables partenaires", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c5_risques_coordination", "risques_vis_a_vis_partenaires", "Risques vis-a-vis des partenaires", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("c5_risques_coordination", "risques_consultants_externes", "Risques vis-a-vis des consultants externes", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "human"
            })
          ]
        },
        {
          key: "rex_projet_reference",
          title: "6. Retour d'experience — Projet de reference",
          order: 7,
          display: "object",
          fields: [
            createFieldDefinition("rex_projet_reference", "identite", "Nom et reference du projet similaire", {
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("rex_projet_reference", "niveau_similitude", "Niveau et type de similitude", {
              inputType: "select",
              required: true,
              sourceLabel: "ai",
              options: [
                { value: "tres_similaire", label: "Tres similaire" },
                { value: "similaire", label: "Similaire" },
                { value: "partiel", label: "Partiel" }
              ]
            }),
            createFieldDefinition("rex_projet_reference", "differences_cles", "Differences cles a noter", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "rex_ecarts_couts",
          title: "Retour d'experience — Ecarts de couts",
          order: 8,
          display: "object",
          fields: [
            createFieldDefinition("rex_ecarts_couts", "postes_sous_estimes", "Postes de couts sous-estimes", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("rex_ecarts_couts", "postes_surestimes", "Postes de couts surestimes", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("rex_ecarts_couts", "depassement_budgetaire", "Depassement budgetaire global constate", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "rex_standards_client",
          title: "Retour d'experience — Standards et habitudes du client",
          order: 9,
          display: "object",
          fields: [
            createFieldDefinition("rex_standards_client", "standards_techniques", "Standards techniques du pays ou client", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("rex_standards_client", "habitudes_validation", "Habitudes de validation des livrables", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("rex_standards_client", "risque_methodologie_non_adaptee", "Risque de methodologie non adaptee", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            })
          ]
        },
        {
          key: "rex_recommandations",
          title: "Retour d'experience — Recommandations",
          order: 10,
          display: "object",
          fields: [
            createFieldDefinition("rex_recommandations", "ajustements_dimensionnement", "Ajustements sur le dimensionnement", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("rex_recommandations", "points_vigilance_prioritaires", "Points de vigilance prioritaires", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            }),
            createFieldDefinition("rex_recommandations", "bonnes_pratiques", "Bonnes pratiques a reproduire", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            })
          ]
        }
      ]
    },
    D: {
      moduleCode: "D",
      moduleType: "strategy",
      departmentCode: "DG",
      departmentLabel: "Direction Generale",
      title: "FCI — Direction Generale",
      shortTitle: "Direction Generale",
      description: "Valeur strategique, enjeux reputationnels et cadrage de decision preliminaire.",
      sections: [
        commonHeaderSection(),
        {
          key: "d1_valeur_strategique",
          title: "D1. Valeur strategique",
          order: 2,
          display: "object",
          fields: [
            createFieldDefinition("d1_valeur_strategique", "programme_pluriannuel", "Inscription dans un programme pluriannuel", {
              inputType: "boolean",
              valueType: "boolean",
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("d1_valeur_strategique", "programme_pluriannuel_details", "Valeur des futures phases", {
              inputType: "textarea",
              multiline: true,
              conditional: (payload) =>
                getObjectField(payload, "d1_valeur_strategique", "programme_pluriannuel")?.value === true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("d1_valeur_strategique", "valeur_futurs_lots", "Valeur estimee des futurs lots", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("d1_valeur_strategique", "positionnement_geographique", "Positionnement geographique vise", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("d1_valeur_strategique", "valeur_reference", "Valeur comme reference", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "d2_enjeux_reputationnels",
          title: "D2. Enjeux reputationnels",
          order: 3,
          display: "object",
          fields: [
            createFieldDefinition("d2_enjeux_reputationnels", "risque_sous_performance", "Risque en cas de sous-performance", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("d2_enjeux_reputationnels", "risque_perte", "Risque en cas de perte", {
              inputType: "textarea",
              multiline: true,
              required: true,
              sourceLabel: "ai"
            }),
            createFieldDefinition("d2_enjeux_reputationnels", "valeur_test_apprentissage", "Valeur de test ou d'apprentissage", {
              inputType: "textarea",
              multiline: true,
              sourceLabel: "ai"
            })
          ]
        },
        {
          key: "d3_decision_preliminaire",
          title: "D3. Decision strategique preliminaire",
          order: 4,
          display: "object",
          fields: [
            createFieldDefinition("d3_decision_preliminaire", "importance_strategique_globale", "Importance strategique globale", {
              inputType: "select",
              required: true,
              sourceLabel: "human",
              options: [
                { value: "faible", label: "Faible" },
                { value: "moyenne", label: "Moyenne" },
                { value: "haute", label: "Haute" },
                { value: "critique", label: "Critique" }
              ]
            }),
            createFieldDefinition("d3_decision_preliminaire", "marche_prioritaire_direction", "Marche prioritaire pour la direction", {
              inputType: "select",
              required: true,
              internalInputExpected: true,
              sourceLabel: "human",
              options: [
                { value: "oui", label: "Oui" },
                { value: "non", label: "Non" },
                { value: "sous_conditions", label: "Sous conditions" }
              ]
            }),
            createFieldDefinition("d3_decision_preliminaire", "conditions_priorisation", "Conditions de priorisation", {
              inputType: "textarea",
              multiline: true,
              conditional: (payload) =>
                getObjectField(payload, "d3_decision_preliminaire", "marche_prioritaire_direction")?.value === "sous_conditions",
              sourceLabel: "human"
            }),
            createFieldDefinition("d3_decision_preliminaire", "commentaires_strategiques", "Commentaires strategiques de la DG", {
              inputType: "textarea",
              multiline: true,
              required: true,
              internalInputExpected: true,
              sourceLabel: "human"
            })
          ]
        }
      ]
    }
  };
}

const MODULE_DEFINITIONS = createModuleDefinitions();

export function getFciModuleDefinitions(input?: {
  includeHidden?: boolean;
}) {
  if (input?.includeHidden) {
    return Object.values(MODULE_DEFINITIONS);
  }

  return FCI_HUMAN_VISIBLE_MODULE_CODES.map(
    (moduleCode) => MODULE_DEFINITIONS[moduleCode as FciHumanVisibleModuleCode]
  );
}

export function getFciModuleDefinition(moduleCode: FciAiSupportedModuleCode) {
  return MODULE_DEFINITIONS[moduleCode] ?? null;
}

export function getFciFieldDefinition(
  moduleCode: FciAiSupportedModuleCode,
  fieldKey: string
) {
  const moduleDefinition = getFciModuleDefinition(moduleCode);
  if (!moduleDefinition) {
    return null;
  }

  for (const section of moduleDefinition.sections) {
    const field = section.fields.find((item) => item.key === fieldKey);
    if (field) {
      return field;
    }
  }

  return null;
}

export function getFciDepartmentLabel(moduleCode: FciAiSupportedModuleCode) {
  return getFciModuleDefinition(moduleCode)?.departmentLabel ?? moduleCode;
}

export function getFciDepartmentCode(moduleCode: FciAiSupportedModuleCode) {
  return getFciModuleDefinition(moduleCode)?.departmentCode ?? "DC";
}

function buildCommonHeader(
  defaults: FciPayloadDefaults,
  currentSection?: Record<string, unknown> | null
) {
  const preparedValue = asFormField(currentSection?.prepared_by_name);
  const validatedValue = asFormField(currentSection?.validated_by_name);
  const generatedDeadline = asFormField(
    currentSection?.date_depot ?? currentSection?.dateDepot
  );
  const sourceDeadline = defaults.sourceDeadline?.trim() || null;
  const hasAuthoritativeDeadline = sourceDeadline != null;
  const sourcePresentation = deriveDeadlinePresentation(sourceDeadline);
  const authoritativeDeadline = sourcePresentation.state === "CONFIRMED"
    ? sourcePresentation.parsedDate
    : sourcePresentation.state === "PENDING_CONFIRMATION"
      || sourcePresentation.state === "AMBIGUOUS"
      ? sourceDeadline
      : null;
  const dossierDeadline = toIsoDateInput(defaults.dateDepot);
  const deadlineField = authoritativeDeadline != null
    ? makeSystemField(
        authoritativeDeadline,
        "cdc",
        "Date limite reprise de l'extraction de la Fiche CDC validée."
      )
    : hasAuthoritativeDeadline
      ? makeSystemField(
          null,
          "cdc",
          "La Fiche CDC validée ne contient pas de date limite confirmée."
        )
    : generatedDeadline && generatedDeadline.value != null
      ? generatedDeadline
      : makeSystemField(
          dossierDeadline,
          "tender",
          "Date de depot reprise du dossier d'appel d'offres."
        );

  return {
    reference_interne_code_dossier: makeSystemField(
      defaults.codeInterne,
      "system",
      "Code interne du dossier reutilise automatiquement."
    ),
    intitule_offre: makeSystemField(
      defaults.intituleOffre,
      "tender",
      "Intitule repris du dossier d'appel d'offres."
    ),
    date_depot: deadlineField,
    prepared_by_name:
      preparedValue
      ?? makeHumanField("Nom du preparateur pour ce module.", defaults.preparedByName ?? null),
    validated_by_name:
      validatedValue
      ?? makeHumanField("Nom du validateur pour ce module.", defaults.validatedByName ?? null)
  };
}

function createEmptyObjectSection(section: FciSectionDefinition) {
  return Object.fromEntries(
    section.fields.map((field) => {
      const defaultField = createEmptyFciFieldDefinitionValue(field);
      return [field.key, defaultField];
    })
  );
}

export function createEmptyFciFieldDefinitionValue(
  field: FciFieldDefinition
): FciFormField {
  if (field.sourceLabel === "dossier" || field.sourceLabel === "system") {
    return makeSystemField(
      null,
      field.sourceLabel === "system" ? "system" : "tender",
      "Valeur renseignee automatiquement si disponible."
    );
  }

  return makeHumanField(
    field.internalInputExpected
      ? "Champ a completer manuellement."
      : "Champ disponible pour pre-remplissage ou completion manuelle."
  );
}

function createSummaryForPayload(
  payload: FciFormPayload,
  moduleCode: FciAiSupportedModuleCode
) {
  const completion = calculateFciPayloadCompletion(payload, moduleCode);
  return {
    status:
      completion.percentage === 100
        ? ("complete" as const)
        : completion.filled > 0
          ? ("partial" as const)
          : ("insufficient_data" as const),
    completion_percentage: completion.percentage,
    human_inputs_required: completion.humanInputsRequired,
    warnings: payload.validation_warnings
  };
}

function asFormField(value: unknown): FciFormField | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const confidence = normalizeText(value.confidence) as FciAiConfidence | null;
  const reviewStatus = normalizeText(value.review_status) as FciFieldReviewStatus | null;
  const source = normalizeText(value.source) as FciFieldSource | null;

  if (source && reviewStatus && confidence) {
    return {
      value: (value.value as FciFormFieldValue) ?? null,
      source,
      review_status: reviewStatus,
      confidence,
      justification: typeof value.justification === "string" ? value.justification : "",
      source_references: Array.isArray(value.source_references)
        ? (value.source_references as FciAiSourceReference[])
        : [],
      original_ai_value: (value.original_ai_value as FciFormFieldValue | undefined) ?? undefined
    };
  }

  return null;
}

export function isFciFieldLike(value: unknown): value is FciFormField {
  return asFormField(value) != null;
}

function legacyFieldToFormField(
  field: FciAiField<FciAiFieldValue> | null,
  fallback: {
    sourceLabel?: "ai" | "human" | "dossier" | "system";
    internalInputExpected?: boolean;
    defaultJustification: string;
  }
): FciFormField {
  if (!field) {
    if (fallback.sourceLabel === "dossier" || fallback.sourceLabel === "system") {
      return makeSystemField(
        null,
        fallback.sourceLabel === "system" ? "system" : "tender",
        fallback.defaultJustification
      );
    }

    return makeHumanField(fallback.defaultJustification, null);
  }

  switch (field.source_type) {
    case "fiche_cdc":
      return makeDossierField(field.value as FciFormFieldValue, field.justification, field.source_references);
    case "ai_inference":
      return makeAiField(
        field.value as FciFormFieldValue,
        field.confidence,
        field.justification,
        field.source_references,
        field.requires_human_input
      );
    case "internal_required":
      return makeHumanField(field.justification, field.value as FciFormFieldValue);
    case "not_applicable":
      return {
        value: null,
        source: "system",
        review_status: "reviewed",
        confidence: "none",
        justification: field.justification,
        source_references: field.source_references
      };
    case "unavailable":
    default:
      if (fallback.sourceLabel === "dossier" || fallback.sourceLabel === "system") {
        return makeSystemField(
          field.value as FciFormFieldValue,
          fallback.sourceLabel === "system" ? "system" : "tender",
          field.justification || fallback.defaultJustification
        );
      }
      return makeHumanField(field.justification || fallback.defaultJustification, field.value as FciFormFieldValue);
  }
}

function normalizeTransitDaysField(field: FciFormField): FciFormField {
  const raw = field.value;
  const parsed = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : null;
  const value = parsed != null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;

  if (value == null) {
    return {
      value: null,
      source: "human",
      review_status: "human_required",
      confidence: "none",
      justification: "Durée de transit en jours à renseigner par l'équipe commerciale.",
      source_references: [],
      original_ai_value: raw
    };
  }

  return { ...field, value };
}

function getLegacyField(
  legacySection: Record<string, unknown> | null | undefined,
  key: string
) {
  if (!legacySection) {
    return null;
  }
  const field = legacySection[key];
  if (!isPlainObject(field)) {
    return null;
  }

  const sourceType = normalizeText(field.source_type);
  const confidence = normalizeText(field.confidence);
  if (!sourceType || !confidence) {
    return null;
  }

  return field as FciAiField<FciAiFieldValue>;
}

function getObjectField(
  payload: FciFormPayload,
  sectionKey: string,
  fieldKey: string
) {
  const section = payload.data[sectionKey];
  if (!isPlainObject(section)) {
    return null;
  }

  return asFormField(section[fieldKey]);
}

function ensureRowIds(rows: Record<string, unknown>[], sectionKey: string) {
  return rows.map((row, index) => {
    const rowId = typeof row.row_id === "string" && row.row_id.trim()
      ? row.row_id.trim()
      : `legacy-${sectionKey}-${index + 1}`;
    return { ...row, row_id: rowId };
  });
}

function createEmptyPayload(
  moduleCode: FciAiSupportedModuleCode,
  defaults: FciPayloadDefaults
): FciFormPayload {
  const definition = getFciModuleDefinition(moduleCode);
  if (!definition) {
    throw new Error(`Definition FCI inconnue pour le module ${moduleCode}.`);
  }

  const data = Object.fromEntries(
    definition.sections.map((section) =>
      section.key === "identification_commune"
        ? [section.key, buildCommonHeader(defaults, null)]
        : [
            section.key,
            section.display === "table" ? [] : createEmptyObjectSection(section)
          ]
    )
  ) as Record<string, unknown>;

  const payload: FciFormPayload = {
    contract_version: FCI_FORM_CONTRACT_VERSION,
    payload_kind: FCI_FORM_PAYLOAD_KIND,
    module_code: definition.moduleCode,
    module_type: definition.moduleType,
    department_code: definition.departmentCode,
    generated_at: null,
    source_fiche: defaults.sourceFiche,
    summary: {
      status: "insufficient_data",
      completion_percentage: 0,
      human_inputs_required: 0,
      warnings: []
    },
    data,
    ai_notes: [],
    validation_warnings: []
  };

  payload.summary = createSummaryForPayload(payload, moduleCode);
  return payload;
}

type NormalizedLegacyPayload = {
  payload: FciFormPayload;
  unmapped: Record<string, unknown> | null;
};

function mapLegacyCommercialPayload(
  legacyPayload: FciAiModulePayload,
  defaults: FciPayloadDefaults
): NormalizedLegacyPayload {
  const payload = createEmptyPayload("A", defaults);
  const data = legacyPayload.data as Record<string, unknown>;
  const identification = isPlainObject(data.identification_opportunite)
    ? data.identification_opportunite
    : null;
  payload.data.identification_commune = buildCommonHeader(defaults, {
    date_depot: identification?.date_depot,
    prepared_by_name: identification?.prepare_par,
    validated_by_name: identification?.valide_par
  });

  const legacyRows = Array.isArray(data.concurrents_premiere_lecture)
    ? data.concurrents_premiere_lecture
    : [];
  payload.data.a1_concurrents = ensureRowIds(
    legacyRows
      .filter(isPlainObject)
      .map((row) => ({
        row_id: createRowId("a1"),
        nom: legacyFieldToFormField(getLegacyField(row, "nom_du_concurrent"), {
          sourceLabel: "dossier",
          defaultJustification: "Nom du concurrent issu du dossier ou de la veille."
        }),
        pays: legacyFieldToFormField(getLegacyField(row, "pays"), {
          sourceLabel: "dossier",
          defaultJustification: "Pays du concurrent issu du dossier."
        }),
        points_forts_connus: legacyFieldToFormField(getLegacyField(row, "points_forts_connus"), {
          sourceLabel: "ai",
          defaultJustification: "Point fort propose par l'analyse."
        }),
        historique_client: legacyFieldToFormField(getLegacyField(row, "historique_avec_le_client"), {
          sourceLabel: "ai",
          defaultJustification: "Historique client a confirmer."
        }),
        avantage_principal: legacyFieldToFormField(getLegacyField(row, "avantage_principal_pour_ce_cdc"), {
          sourceLabel: "ai",
          defaultJustification: "Avantage principal a confirmer."
        }),
        risque_represente: legacyFieldToFormField(getLegacyField(row, "risque_qu_il_represente"), {
          sourceLabel: "ai",
          defaultJustification: "Risque concurrentiel a confirmer."
        })
      })),
    "a1_concurrents"
  );

  const positionnement = isPlainObject(data.positionnement_offre)
    ? data.positionnement_offre
    : null;
  payload.data.a2_positionnement = {
    avantage_differentiel: legacyFieldToFormField(
      getLegacyField(positionnement, "notre_avantage_differentiel_principal"),
      {
        sourceLabel: "human",
        internalInputExpected: true,
        defaultJustification: "A completer par l'equipe commerciale."
      }
    ),
    vulnerabilite_principale: legacyFieldToFormField(
      getLegacyField(positionnement, "notre_vulnerabilite_principale"),
      {
        sourceLabel: "human",
        internalInputExpected: true,
        defaultJustification: "A completer par l'equipe commerciale."
      }
    ),
    niveau_prix_cible: legacyFieldToFormField(
      getLegacyField(positionnement, "niveau_de_prix_cible_estime"),
      {
        sourceLabel: "human",
        internalInputExpected: true,
        defaultJustification: "A completer lors de la revue commerciale."
      }
    )
  };

  const logistique = isPlainObject(data.points_logistiques_internes)
    ? data.points_logistiques_internes
    : null;
  const legacyRepresentation = getLegacyField(logistique, "representation_locale_existante");
  const parsedBoolean = parseBooleanLike(legacyRepresentation?.value);

  payload.data.a3_logistique_interne = {
    delai_transit_jours: normalizeTransitDaysField(
      legacyFieldToFormField(
        getLegacyField(logistique, "delai_de_transit_necessaire"),
        {
          sourceLabel: "human",
          internalInputExpected: true,
          defaultJustification: "A definir en interne."
        }
      )
    ),
    responsable_depot: legacyFieldToFormField(
      getLegacyField(logistique, "responsable_depot"),
      {
        sourceLabel: "human",
        internalInputExpected: true,
        defaultJustification: "Responsable du depot a definir."
      }
    ),
    representation_locale_existante: legacyRepresentation
      ? {
          ...legacyFieldToFormField(legacyRepresentation, {
            sourceLabel: "human",
            internalInputExpected: true,
            defaultJustification: "Representation locale a confirmer."
          }),
          value: parsedBoolean.value
        }
      : makeHumanField("Representation locale a confirmer."),
    representation_locale_details:
      parsedBoolean.details && parsedBoolean.details !== "Oui" && parsedBoolean.details !== "Non"
        ? makeHumanField("Details de la representation locale.", parsedBoolean.details)
        : makeHumanField("Details de la representation locale.")
  };

  payload.ai_notes = legacyPayload.ai_notes;
  payload.validation_warnings = legacyPayload.validation_warnings;
  payload.generated_at = legacyPayload.generated_at;
  payload.summary = createSummaryForPayload(payload, "A");

  const legacyData = legacyPayload.data as Record<string, unknown>;
  const unmapped = {
    synthese_commerciale: legacyData.synthese_commerciale ?? null,
    points_logistiques_internes: {
      autres_contraintes_internes:
        getLegacyField(logistique, "autres_contraintes_internes") ?? null
    }
  };

  return { payload, unmapped };
}

function mapLegacyFinancePayload(
  legacyPayload: FciAiModulePayload,
  defaults: FciPayloadDefaults
): NormalizedLegacyPayload {
  const payload = createEmptyPayload("B", defaults);
  const data = legacyPayload.data as Record<string, unknown>;
  payload.data.identification_commune = buildCommonHeader(defaults, null);

  const elements = isPlainObject(data.elements_financiers_internes)
    ? data.elements_financiers_internes
    : null;
  payload.data.b1_elements_financiers = {
    budget_estime_marche: legacyFieldToFormField(
      getLegacyField(elements, "budget_estime_du_marche"),
      { sourceLabel: "ai", defaultJustification: "Budget estime du marche." }
    ),
    budget_estime_source: makeHumanField("Source de l'estimation budgetaire."),
    taux_change: legacyFieldToFormField(
      getLegacyField(elements, "taux_de_change_applique_et_source"),
      {
        sourceLabel: "human",
        internalInputExpected: true,
        defaultJustification: "Taux de change a confirmer."
      }
    ),
    coefficient_charges_structure: legacyFieldToFormField(
      getLegacyField(elements, "coefficient_de_charges_de_structure"),
      {
        sourceLabel: "human",
        internalInputExpected: true,
        defaultJustification: "Coefficient de charges a confirmer."
      }
    ),
    marge_cible: legacyFieldToFormField(getLegacyField(elements, "marge_cible_visee"), {
      sourceLabel: "human",
      internalInputExpected: true,
      defaultJustification: "Marge cible a confirmer."
    })
  };

  const legacyRows = Array.isArray(data.cash_flow_par_jalon) ? data.cash_flow_par_jalon : [];
  payload.data.b2_jalons_cash_flow = ensureRowIds(
    legacyRows
      .filter(isPlainObject)
      .map((row) => ({
        row_id: createRowId("b2"),
        jalon_livrable: legacyFieldToFormField(getLegacyField(row, "jalon_livrable"), {
          sourceLabel: "dossier",
          defaultJustification: "Jalon du dossier."
        }),
        pourcentage_montant: legacyFieldToFormField(getLegacyField(row, "pourcentage_montant"), {
          sourceLabel: "dossier",
          defaultJustification: "Pourcentage du montant."
        }),
        delai_paiement_estime: legacyFieldToFormField(getLegacyField(row, "delai_paiement_estime"), {
          sourceLabel: "ai",
          defaultJustification: "Delai de paiement estime."
        }),
        risque_cash_flow: legacyFieldToFormField(getLegacyField(row, "risque_cash_flow"), {
          sourceLabel: "ai",
          defaultJustification: "Risque de cash-flow."
        })
      })),
    "b2_jalons_cash_flow"
  );

  const synthese = isPlainObject(data.synthese_financiere) ? data.synthese_financiere : null;
  payload.data.b3_synthese_financiere = {
    commentaires_generaux: legacyFieldToFormField(
      getLegacyField(synthese, "commentaires_financiers_generaux"),
      {
        sourceLabel: "ai",
        defaultJustification: "Commentaire financier general."
      }
    )
  };

  payload.ai_notes = legacyPayload.ai_notes;
  payload.validation_warnings = legacyPayload.validation_warnings;
  payload.generated_at = legacyPayload.generated_at;
  payload.summary = createSummaryForPayload(payload, "B");

  const unmapped = {
    calculs_financiers: data.calculs_financiers ?? [],
    synthese_financiere: {
      pression_tresorerie_preliminaire:
        getLegacyField(synthese, "pression_tresorerie_preliminaire") ?? null,
      exposition_garanties: getLegacyField(synthese, "exposition_garanties") ?? null,
      points_de_revue_financiere:
        getLegacyField(synthese, "points_de_revue_financiere") ?? null
    }
  };

  return { payload, unmapped };
}

function mapLegacyOperationsPayload(
  legacyPayload: FciAiModulePayload,
  defaults: FciPayloadDefaults
): NormalizedLegacyPayload {
  const payload = createEmptyPayload("C", defaults);
  const data = legacyPayload.data as Record<string, unknown>;
  payload.data.identification_commune = buildCommonHeader(defaults, null);

  const keyExperts = Array.isArray(data.disponibilite_des_experts_cles)
    ? data.disponibilite_des_experts_cles
    : [];
  payload.data.c1_ressources_cles = ensureRowIds(
    keyExperts.filter(isPlainObject).map((row) => ({
      row_id: createRowId("c1"),
      poste_expert: legacyFieldToFormField(getLegacyField(row, "poste_ou_expert"), {
        sourceLabel: "dossier",
        defaultJustification: "Poste issu du dossier."
      }),
      volume_demande_cdc: legacyFieldToFormField(
        getLegacyField(row, "volume_travail_demande_par_le_cdc"),
        { sourceLabel: "dossier", defaultJustification: "Volume demande par le CDC." }
      ),
      volume_reel_previsionnel: legacyFieldToFormField(
        getLegacyField(row, "volume_travail_reel_previsionnel"),
        { sourceLabel: "human", defaultJustification: "Volume reel a confirmer." }
      ),
      suppleant: legacyFieldToFormField(getLegacyField(row, "suppleant"), {
        sourceLabel: "human",
        defaultJustification: "Suppleant a confirmer."
      }),
      volume_previsionnel_suppleant: legacyFieldToFormField(
        getLegacyField(row, "volume_travail_previsionnel_suppleant"),
        { sourceLabel: "human", defaultJustification: "Volume du suppleant a confirmer." }
      ),
      probabilite_disponibilite: legacyFieldToFormField(
        getLegacyField(row, "probabilite_disponibilite_experts"),
        { sourceLabel: "human", defaultJustification: "Probabilite a confirmer." }
      ),
      action_requise: legacyFieldToFormField(getLegacyField(row, "action_requise"), {
        sourceLabel: "human",
        defaultJustification: "Action requise a preciser."
      })
    })),
    "c1_ressources_cles"
  );

  const nonKeyExperts = Array.isArray(data.disponibilite_des_experts_non_cles)
    ? data.disponibilite_des_experts_non_cles
    : [];
  payload.data.c2_ressources_non_cles = ensureRowIds(
    nonKeyExperts.filter(isPlainObject).map((row) => ({
      row_id: createRowId("c2"),
      poste_expert: legacyFieldToFormField(getLegacyField(row, "poste_ou_expert"), {
        sourceLabel: "dossier",
        defaultJustification: "Poste issu du dossier."
      }),
      volume_previsionnel: legacyFieldToFormField(
        getLegacyField(row, "volume_travail_reel_previsionnel"),
        { sourceLabel: "human", defaultJustification: "Volume a confirmer." }
      ),
      probabilite_disponibilite: legacyFieldToFormField(
        getLegacyField(row, "probabilite_disponibilite_experts"),
        { sourceLabel: "human", defaultJustification: "Probabilite a confirmer." }
      ),
      action_requise: legacyFieldToFormField(getLegacyField(row, "action_requise"), {
        sourceLabel: "human",
        defaultJustification: "Action requise a preciser."
      })
    })),
    "c2_ressources_non_cles"
  );

  const capacities = Array.isArray(data.capacite_absorption_globale)
    ? data.capacite_absorption_globale
    : [];
  payload.data.c3_moyens_capacite = ensureRowIds(
    capacities.filter(isPlainObject).map((row) => {
      const quantiteRequise = legacyFieldToFormField(getLegacyField(row, "quantite_requise"), {
        sourceLabel: "ai",
        defaultJustification: "Quantite requise."
      });
      const quantiteDisponible = legacyFieldToFormField(getLegacyField(row, "quantite_disponible"), {
        sourceLabel: "human",
        defaultJustification: "Quantite disponible."
      });
      const ecart = computeEcartsField(quantiteRequise, quantiteDisponible);
      return {
        row_id: createRowId("c3"),
        designation: legacyFieldToFormField(getLegacyField(row, "designation_du_moyen"), {
          sourceLabel: "ai",
          defaultJustification: "Designation du moyen."
        }),
        quantite_requise: quantiteRequise,
        quantite_disponible: quantiteDisponible,
        membre_apporteur: legacyFieldToFormField(
          getLegacyField(row, "membre_du_groupement_qui_lapporte"),
          { sourceLabel: "human", defaultJustification: "Membre apporteur." }
        ),
        disponible_demarrage: booleanFieldFromLegacy(
          getLegacyField(row, "disponible_au_demarrage"),
          "Disponibilite au demarrage."
        ),
        ecart
      };
    }),
    "c3_moyens_capacite"
  );

  const roleShare = Array.isArray(data.repartition_des_composantes_techniques)
    ? data.repartition_des_composantes_techniques
    : [];
  payload.data.c4_repartition_roles = ensureRowIds(
    roleShare.filter(isPlainObject).map((row) => ({
      row_id: createRowId("c4"),
      composante_tache: legacyFieldToFormField(getLegacyField(row, "composante_ou_tache"), {
        sourceLabel: "ai",
        defaultJustification: "Composante ou tache proposee."
      }),
      membre_responsable: legacyFieldToFormField(getLegacyField(row, "membre_responsable"), {
        sourceLabel: "human",
        defaultJustification: "Membre responsable a confirmer."
      }),
      experts_affectes: legacyFieldToFormField(getLegacyField(row, "experts_affectes"), {
        sourceLabel: "human",
        defaultJustification: "Experts affectes a confirmer."
      }),
      effort_client_vs_concept: legacyFieldToFormField(
        getLegacyField(row, "effort_estime_client_vs_concept"),
        { sourceLabel: "human", defaultJustification: "Comparaison d'effort a documenter." }
      ),
      commentaire_risque: legacyFieldToFormField(getLegacyField(row, "commentaire_ou_risque"), {
        sourceLabel: "ai",
        defaultJustification: "Commentaire ou risque a confirmer."
      })
    })),
    "c4_repartition_roles"
  );

  const coordination = isPlainObject(data.risques_coordination_mitigation)
    ? data.risques_coordination_mitigation
    : null;
  payload.data.c5_risques_coordination = {
    partenaires_non_eprouves: legacyFieldToFormField(
      getLegacyField(coordination, "partenaires_non_encore_eprouves"),
      { sourceLabel: "human", defaultJustification: "Partenaires non eprouves." }
    ),
    frequence_reunions_coordination: legacyFieldToFormField(
      getLegacyField(coordination, "frequence_reunions_coordination"),
      { sourceLabel: "human", defaultJustification: "Frequence de coordination." }
    ),
    penalites_internes_groupement: legacyFieldToFormField(
      getLegacyField(coordination, "risque_penalites_internes_groupement"),
      { sourceLabel: "human", defaultJustification: "Penalites internes a documenter." }
    ),
    controle_qualite_livrables: legacyFieldToFormField(
      getLegacyField(coordination, "controle_qualite_livrables_partenaires"),
      { sourceLabel: "human", defaultJustification: "Controle qualite a documenter." }
    ),
    risques_vis_a_vis_partenaires: legacyFieldToFormField(
      getLegacyField(coordination, "risques_vis_a_vis_partenaires"),
      { sourceLabel: "human", defaultJustification: "Risques vis-a-vis des partenaires." }
    ),
    risques_consultants_externes: legacyFieldToFormField(
      getLegacyField(coordination, "risques_vis_a_vis_consultants_externes"),
      { sourceLabel: "human", defaultJustification: "Risques consultants externes." }
    )
  };

  payload.ai_notes = legacyPayload.ai_notes;
  payload.validation_warnings = legacyPayload.validation_warnings;
  payload.generated_at = legacyPayload.generated_at;
  payload.summary = createSummaryForPayload(payload, "C");

  const synthese = data.synthese_operations ?? null;
  return {
    payload,
    unmapped: {
      synthese_operations: synthese
    }
  };
}

function mapLegacyStrategyPayload(
  legacyPayload: FciAiModulePayload,
  defaults: FciPayloadDefaults
): NormalizedLegacyPayload {
  const payload = createEmptyPayload("D", defaults);
  const data = legacyPayload.data as Record<string, unknown>;
  payload.data.identification_commune = buildCommonHeader(defaults, null);

  const contexte = isPlainObject(data.contexte_programme_valeur_strategique)
    ? data.contexte_programme_valeur_strategique
    : null;
  const programme = getLegacyField(contexte, "inscription_dans_un_programme_pluriannuel");
  const parsedProgramme = parseBooleanLike(programme?.value);
  payload.data.d1_valeur_strategique = {
    programme_pluriannuel: programme
      ? {
          ...legacyFieldToFormField(programme, {
            sourceLabel: "ai",
            defaultJustification: "Programme pluriannuel."
          }),
          value: parsedProgramme.value
        }
      : makeAiField(null, "none", "Programme pluriannuel a determiner.", [], false),
    programme_pluriannuel_details:
      parsedProgramme.details && parsedProgramme.details !== "Oui" && parsedProgramme.details !== "Non"
        ? makeAiField(parsedProgramme.details, "medium", "Details du programme pluriannuel.", [], false)
        : makeHumanField("Details du programme pluriannuel."),
    valeur_futurs_lots: legacyFieldToFormField(
      getLegacyField(contexte, "valeur_estimee_des_futurs_lots"),
      { sourceLabel: "ai", defaultJustification: "Valeur estimee des futurs lots." }
    ),
    positionnement_geographique: legacyFieldToFormField(
      getLegacyField(contexte, "positionnement_geographique_vise"),
      { sourceLabel: "ai", defaultJustification: "Positionnement geographique vise." }
    ),
    valeur_reference: legacyFieldToFormField(
      getLegacyField(contexte, "valeur_comme_reference"),
      { sourceLabel: "ai", defaultJustification: "Valeur comme reference." }
    )
  };

  const enjeux = isPlainObject(data.enjeux_reputationnels)
    ? data.enjeux_reputationnels
    : null;
  payload.data.d2_enjeux_reputationnels = {
    risque_sous_performance: legacyFieldToFormField(
      getLegacyField(enjeux, "risque_en_cas_de_sous_performance"),
      { sourceLabel: "ai", defaultJustification: "Risque en cas de sous-performance." }
    ),
    risque_perte: legacyFieldToFormField(getLegacyField(enjeux, "risque_en_cas_de_perte"), {
      sourceLabel: "ai",
      defaultJustification: "Risque en cas de perte."
    }),
    valeur_test_apprentissage: legacyFieldToFormField(
      getLegacyField(enjeux, "valeur_de_test_ou_apprentissage"),
      { sourceLabel: "ai", defaultJustification: "Valeur de test ou d'apprentissage." }
    )
  };

  const decision = isPlainObject(data.decision_strategique_preliminaire)
    ? data.decision_strategique_preliminaire
    : null;
  payload.data.d3_decision_preliminaire = {
    importance_strategique_globale: legacyFieldToFormField(
      getLegacyField(decision, "importance_strategique_globale"),
      { sourceLabel: "human", defaultJustification: "Importance strategique a arbitrer." }
    ),
    marche_prioritaire_direction: legacyFieldToFormField(
      getLegacyField(decision, "marche_prioritaire_pour_la_direction"),
      { sourceLabel: "human", defaultJustification: "Priorisation direction a arbitrer." }
    ),
    conditions_priorisation: makeHumanField("Conditions de priorisation si necessaire."),
    commentaires_strategiques: legacyFieldToFormField(
      getLegacyField(decision, "commentaires_strategiques_de_la_direction_generale"),
      { sourceLabel: "human", defaultJustification: "Commentaires strategiques de la direction." }
    )
  };

  payload.ai_notes = legacyPayload.ai_notes;
  payload.validation_warnings = legacyPayload.validation_warnings;
  payload.generated_at = legacyPayload.generated_at;
  payload.summary = createSummaryForPayload(payload, "D");

  const synthese = data.synthese_direction ?? null;
  return {
    payload,
    unmapped: {
      synthese_direction: synthese
    }
  };
}

function booleanFieldFromLegacy(
  field: FciAiField<FciAiFieldValue> | null,
  justification: string
) {
  if (!field) {
    return makeHumanField(justification);
  }

  const parsed = parseBooleanLike(field.value);
  return {
    ...legacyFieldToFormField(field, {
      sourceLabel: "human",
      defaultJustification: justification
    }),
    value: parsed.value
  };
}

function computeEcartsField(
  requiredField: FciFormField,
  availableField: FciFormField
) {
  const required = normalizeNumber(requiredField.value);
  const available = normalizeNumber(availableField.value);
  return makeSystemField(
    required != null && available != null ? required - available : null,
    "system",
    "Ecart calcule automatiquement a partir des quantites requises et disponibles."
  );
}

function createModuleType(
  moduleCode: FciAiSupportedModuleCode
): Extract<FciModuleType, "commercial" | "finance" | "operations" | "strategy"> {
  return MODULE_DEFINITIONS[moduleCode].moduleType;
}

function createDepartmentCode(moduleCode: FciAiSupportedModuleCode): FciDepartmentCode {
  return MODULE_DEFINITIONS[moduleCode].departmentCode;
}

export function createEmptyFciModulePayload(
  moduleCode: FciAiSupportedModuleCode,
  defaults: FciPayloadDefaults
) {
  return createEmptyPayload(moduleCode, defaults);
}

export function isRecognizedFciModulePayload(
  value: unknown,
  moduleCode?: FciAiSupportedModuleCode
): value is FciFormPayload {
  if (!isPlainObject(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (
    payload.payload_kind !== FCI_FORM_PAYLOAD_KIND
    || payload.contract_version !== FCI_FORM_CONTRACT_VERSION
    || typeof payload.module_code !== "string"
    || typeof payload.module_type !== "string"
    || typeof payload.department_code !== "string"
    || !isPlainObject(payload.data)
  ) {
    return false;
  }

  if (moduleCode && payload.module_code !== moduleCode) {
    return false;
  }

  return true;
}

function isLegacyAiPayload(
  value: unknown,
  moduleCode: FciAiSupportedModuleCode
): value is FciAiModulePayload {
  if (!isPlainObject(value)) {
    return false;
  }

  return value.module_code === moduleCode && isPlainObject(value.data) && "source_fiche" in value;
}

function applyDefaultsToPayload(
  moduleCode: FciAiSupportedModuleCode,
  payload: FciFormPayload,
  defaults: FciPayloadDefaults
) {
  const definition = getFciModuleDefinition(moduleCode);
  if (!definition) {
    throw new Error(`Definition FCI inconnue pour le module ${moduleCode}.`);
  }

  const nextPayload: FciFormPayload = {
    ...payload,
    contract_version: FCI_FORM_CONTRACT_VERSION,
    payload_kind: FCI_FORM_PAYLOAD_KIND,
    module_code: moduleCode,
    module_type: createModuleType(moduleCode),
    department_code: createDepartmentCode(moduleCode),
    source_fiche: defaults.sourceFiche,
    data: { ...payload.data }
  };

  nextPayload.data.identification_commune = buildCommonHeader(
    defaults,
    isPlainObject(payload.data.identification_commune)
      ? payload.data.identification_commune
      : null
  );

  for (const section of definition.sections) {
    if (section.key === "identification_commune") {
      continue;
    }

    const currentValue = nextPayload.data[section.key];
    if (section.display === "table") {
      const rows = Array.isArray(currentValue) ? currentValue.filter(isPlainObject) : [];
      nextPayload.data[section.key] = ensureTableRows(section, rows);
    } else {
      nextPayload.data[section.key] = ensureObjectSection(section, currentValue);
    }
  }

  if (moduleCode === "A") {
    const logistics = isPlainObject(nextPayload.data.a3_logistique_interne)
      ? nextPayload.data.a3_logistique_interne
      : {};
    const transit = asFormField(logistics.delai_transit_jours);
    nextPayload.data.a3_logistique_interne = {
      ...logistics,
      delai_transit_jours: normalizeTransitDaysField(
        transit ?? makeHumanField("Durée de transit en jours à renseigner.")
      )
    };
  }

  nextPayload.summary = createSummaryForPayload(nextPayload, moduleCode);
  return nextPayload;
}

function ensureObjectSection(section: FciSectionDefinition, rawValue: unknown) {
  const current = isPlainObject(rawValue) ? rawValue : {};
  return Object.fromEntries(
    section.fields.map((field) => {
      const currentField = asFormField(current[field.key]);
      if (currentField) {
        return [field.key, currentField];
      }

      if (field.sourceLabel === "dossier" || field.sourceLabel === "system") {
        return [
          field.key,
          makeSystemField(
            null,
            field.sourceLabel === "system" ? "system" : "tender",
            "Valeur renseignee automatiquement si disponible."
          )
        ];
      }

      return [
        field.key,
        makeHumanField(
          field.internalInputExpected
            ? "Champ a completer manuellement."
            : "Champ disponible pour pre-remplissage ou completion manuelle."
        )
      ];
    })
  );
}

function ensureTableRows(section: FciSectionDefinition, rows: Record<string, unknown>[]) {
  return ensureRowIds(
    rows.map((row) => {
      const nextRow: Record<string, unknown> = {
        row_id:
          typeof row.row_id === "string" && row.row_id.trim()
            ? row.row_id.trim()
            : createRowId(section.key)
      };

      for (const field of section.fields) {
        const currentField = asFormField(row[field.key]);
        if (currentField) {
          nextRow[field.key] = currentField;
        } else if (field.sourceLabel === "dossier" || field.sourceLabel === "system") {
          nextRow[field.key] = makeSystemField(
            null,
            field.sourceLabel === "system" ? "system" : "tender",
            "Valeur renseignee automatiquement si disponible."
          );
        } else {
          nextRow[field.key] = makeHumanField(
            field.internalInputExpected
              ? "Champ a completer manuellement."
              : "Champ disponible pour pre-remplissage ou completion manuelle."
          );
        }
      }

      if (section.key === "c3_moyens_capacite") {
        nextRow.ecart = computeEcartsField(
          nextRow.quantite_requise as FciFormField,
          nextRow.quantite_disponible as FciFormField
        );
      }

      return nextRow;
    }),
    section.key
  );
}

export function normalizeStoredFciModulePayload(
  moduleCode: FciAiSupportedModuleCode,
  rawPayload: unknown,
  defaults: FciPayloadDefaults
) {
  if (isRecognizedFciModulePayload(rawPayload, moduleCode)) {
    return applyDefaultsToPayload(moduleCode, rawPayload, defaults);
  }

  if (isLegacyAiPayload(rawPayload, moduleCode)) {
    const normalized =
      moduleCode === "A"
        ? mapLegacyCommercialPayload(rawPayload, defaults)
        : moduleCode === "B"
          ? mapLegacyFinancePayload(rawPayload, defaults)
          : moduleCode === "C"
            ? mapLegacyOperationsPayload(rawPayload, defaults)
            : mapLegacyStrategyPayload(rawPayload, defaults);
    return normalized.payload;
  }

  return createEmptyPayload(moduleCode, defaults);
}

export function mapAiPayloadToFciModulePayload(
  moduleCode: FciAiSupportedModuleCode,
  payload: FciAiModulePayload,
  defaults: FciPayloadDefaults
) {
  const normalized =
    moduleCode === "A"
      ? mapLegacyCommercialPayload(payload, defaults)
      : moduleCode === "B"
        ? mapLegacyFinancePayload(payload, defaults)
        : moduleCode === "C"
          ? mapLegacyOperationsPayload(payload, defaults)
          : mapLegacyStrategyPayload(payload, defaults);

  return normalized;
}

export function getFciModulePayloadContractVersion(value: unknown) {
  if (!isPlainObject(value)) {
    return null;
  }

  return typeof value.contract_version === "string" ? value.contract_version : null;
}

function hasFilledValue(value: FciFormFieldValue) {
  if (value == null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function getRequiredFieldsForSection(
  section: FciSectionDefinition,
  payload: FciFormPayload
) {
  return section.fields.filter((field) => {
    if (!field.required) {
      return false;
    }
    if (
      field.editable === false &&
      (field.sourceLabel === "dossier" || field.sourceLabel === "system")
    ) {
      return false;
    }
    if (field.conditional) {
      return field.conditional(payload);
    }
    return true;
  });
}

export function calculateFciPayloadCompletion(
  payload: FciFormPayload,
  moduleCode: FciAiSupportedModuleCode
): FciPayloadCompletion {
  const definition = getFciModuleDefinition(moduleCode);
  if (!definition) {
    return {
      filled: 0,
      total: 0,
      percentage: 0,
      humanInputsRequired: 0,
      satisfiedRepeatableRules: 0,
      totalRepeatableRules: 0
    };
  }

  let total = 0;
  let filled = 0;
  let humanInputsRequired = 0;
  let satisfiedRepeatableRules = 0;
  let totalRepeatableRules = 0;

  for (const section of definition.sections) {
    if (section.display === "table") {
      const rows = Array.isArray(payload.data[section.key])
        ? (payload.data[section.key] as unknown[]).filter(isPlainObject)
        : [];
      if ((section.minRows ?? 0) > 0) {
        totalRepeatableRules += 1;
        if (rows.length >= (section.minRows ?? 0)) {
          satisfiedRepeatableRules += 1;
        }
      }

      for (const row of rows) {
        for (const field of getRequiredFieldsForSection(section, payload)) {
          total += 1;
          if (field.internalInputExpected) {
            humanInputsRequired += 1;
          }
          const wrapped = asFormField((row as Record<string, unknown>)[field.key]);
          if (wrapped && hasFilledValue(wrapped.value)) {
            filled += 1;
          }
        }
      }
      continue;
    }

    const sectionObject = isPlainObject(payload.data[section.key])
      ? (payload.data[section.key] as Record<string, unknown>)
      : {};

    for (const field of getRequiredFieldsForSection(section, payload)) {
      total += 1;
      if (field.internalInputExpected) {
        humanInputsRequired += 1;
      }
      const wrapped = asFormField(sectionObject[field.key]);
      if (wrapped && hasFilledValue(wrapped.value)) {
        filled += 1;
      }
    }
  }

  if (totalRepeatableRules > 0) {
    total += totalRepeatableRules;
    filled += satisfiedRepeatableRules;
  }

  return {
    filled,
    total,
    percentage: total === 0 ? 0 : Math.round((filled / total) * 100),
    humanInputsRequired,
    satisfiedRepeatableRules,
    totalRepeatableRules
  };
}

export function validateFciModulePayloadForCompletion(
  payload: FciFormPayload,
  moduleCode: FciAiSupportedModuleCode
) {
  const definition = getFciModuleDefinition(moduleCode);
  if (!definition) {
    return [
      {
        path: "module_code",
        section: "module",
        message: "Definition du module introuvable."
      }
    ] satisfies FciPayloadValidationError[];
  }

  const errors: FciPayloadValidationError[] = [];

  for (const section of definition.sections) {
    if (section.display === "table") {
      const rows = Array.isArray(payload.data[section.key])
        ? (payload.data[section.key] as unknown[]).filter(isPlainObject)
        : [];

      if ((section.minRows ?? 0) > 0 && rows.length < (section.minRows ?? 0)) {
        errors.push({
          path: section.key,
          section: section.title,
          message:
            section.minRows === 1
              ? "Au moins une ligne est requise."
              : `Au moins ${section.minRows} lignes sont requises.`
        });
      }

      for (const [rowIndex, row] of rows.entries()) {
        for (const field of getRequiredFieldsForSection(section, payload)) {
          const wrapped = asFormField((row as Record<string, unknown>)[field.key]);
          if (!wrapped || !hasFilledValue(wrapped.value)) {
            errors.push({
              path: `${section.key}[${rowIndex}].${field.key}`,
              section: section.title,
              message: `Le champ « ${field.label} » est obligatoire.`
            });
          }
        }
      }

      continue;
    }

    const sectionObject = isPlainObject(payload.data[section.key])
      ? (payload.data[section.key] as Record<string, unknown>)
      : {};
    for (const field of getRequiredFieldsForSection(section, payload)) {
      const wrapped = asFormField(sectionObject[field.key]);
      if (!wrapped || !hasFilledValue(wrapped.value)) {
        errors.push({
          path: `${section.key}.${field.key}`,
          section: section.title,
          message: `Le champ « ${field.label} » est obligatoire.`
        });
      }
    }
  }

  return errors;
}

export function markFciPayloadReviewed(payload: FciFormPayload) {
  const definition = getFciModuleDefinition(payload.module_code);
  if (!definition) {
    return payload;
  }

  const nextPayload: FciFormPayload = {
    ...payload,
    data: { ...payload.data }
  };

  for (const section of definition.sections) {
    if (section.display === "table") {
      const rows = Array.isArray(nextPayload.data[section.key])
        ? (nextPayload.data[section.key] as unknown[]).filter(isPlainObject)
        : [];
      nextPayload.data[section.key] = rows.map((row) => {
        const nextRow: Record<string, unknown> = { ...(row as Record<string, unknown>) };
        for (const field of section.fields) {
          const wrapped = asFormField(nextRow[field.key]);
          if (!wrapped) {
            continue;
          }
          if (wrapped.review_status === "to_review" && hasFilledValue(wrapped.value)) {
            nextRow[field.key] = {
              ...wrapped,
              review_status: "reviewed"
            } satisfies FciFormField;
          } else if (wrapped.review_status === "human_required" && hasFilledValue(wrapped.value)) {
            nextRow[field.key] = {
              ...wrapped,
              review_status: "reviewed",
              source: "human"
            } satisfies FciFormField;
          }
        }
        return nextRow;
      });
      continue;
    }

    const current = isPlainObject(nextPayload.data[section.key])
      ? (nextPayload.data[section.key] as Record<string, unknown>)
      : {};
    const nextSection: Record<string, unknown> = { ...current };
    for (const field of section.fields) {
      const wrapped = asFormField(nextSection[field.key]);
      if (!wrapped) {
        continue;
      }
      if (wrapped.review_status === "to_review" && hasFilledValue(wrapped.value)) {
        nextSection[field.key] = {
          ...wrapped,
          review_status: "reviewed"
        } satisfies FciFormField;
      } else if (wrapped.review_status === "human_required" && hasFilledValue(wrapped.value)) {
        nextSection[field.key] = {
          ...wrapped,
          review_status: "reviewed",
          source: "human"
        } satisfies FciFormField;
      }
    }
    nextPayload.data[section.key] = nextSection;
  }

  nextPayload.summary = createSummaryForPayload(nextPayload, payload.module_code);
  return nextPayload;
}
