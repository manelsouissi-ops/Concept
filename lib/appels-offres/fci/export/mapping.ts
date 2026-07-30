import type { FciAiSupportedModuleCode } from "../ai-contracts.ts";
import {
  getFciFieldDefinition,
  isRecognizedFciModulePayload,
  type FciFieldDefinition,
  type FciFormField,
  type FciFormFieldValue,
  type FciFormPayload
} from "../rendering.ts";
import type { FciModulePresentation } from "../presentation.ts";
import { getFciTemplateDefinition } from "./templates.ts";
import type {
  FciDocxRepeatableTable,
  FciDocxSingleValueRow,
  FciExportSource
} from "./types.ts";

const EMPTY_VALUE = "Non renseigné";

function asFormField(value: unknown): FciFormField | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return "value" in value ? (value as FciFormField) : null;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTableRows(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>>
    : [];
}

function formatDateValue(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("fr-FR");
}

function formatNumberValue(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

function formatFieldValue(
  field: FciFormField | null,
  definition?: FciFieldDefinition | null
): string {
  if (!field) {
    return EMPTY_VALUE;
  }

  const value = field.value;
  if (value == null) {
    return EMPTY_VALUE;
  }

  if (Array.isArray(value)) {
    return value.length ? value.join("\n") : EMPTY_VALUE;
  }

  if (typeof value === "boolean") {
    return value ? "Oui" : "Non";
  }

  if (typeof value === "number") {
    if (definition?.inputType === "percentage") {
      return `${formatNumberValue(value)} %`;
    }
    return formatNumberValue(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return EMPTY_VALUE;
  }

  if (definition?.inputType === "date") {
    return formatDateValue(trimmed);
  }

  if (definition?.inputType === "select" && definition.options?.length) {
    const option = definition.options.find((item) => item.value === trimmed);
    if (option) {
      return option.label;
    }
  }

  if (definition?.inputType === "percentage" && !trimmed.includes("%")) {
    return `${trimmed} %`;
  }

  return trimmed;
}

function getObjectField(
  payload: FciFormPayload,
  sectionKey: string,
  fieldKey: string
) {
  const section = asObject(payload.data[sectionKey]);
  return asFormField(section?.[fieldKey]);
}

function getTableField(
  row: Record<string, unknown>,
  fieldKey: string
) {
  return asFormField(row[fieldKey]);
}

function getDefinition(
  moduleCode: FciAiSupportedModuleCode,
  fieldKey: string
) {
  return getFciFieldDefinition(moduleCode, fieldKey);
}

function formatCommonIdentificationRows(payload: FciFormPayload) {
  return [
    {
      label: "Référence interne Code dossier",
      value: formatFieldValue(
        getObjectField(payload, "identification_commune", "reference_interne_code_dossier")
      )
    },
    {
      label: "Intitulé de l’offre ▸CDC. Reporter depuis la lettre d’invitation",
      value: formatFieldValue(
        getObjectField(payload, "identification_commune", "intitule_offre")
      )
    },
    {
      label: "Date de dépôt ▸CDC. Reporter depuis le CDC",
      value: formatDateValue(
        formatFieldValue(getObjectField(payload, "identification_commune", "date_depot"))
      )
    },
    {
      label: "Préparé par Nom, fonction",
      value: formatFieldValue(
        getObjectField(payload, "identification_commune", "prepared_by_name")
      )
    },
    {
      label: "Validé par Nom, fonction",
      value: formatFieldValue(
        getObjectField(payload, "identification_commune", "validated_by_name")
      )
    }
  ] satisfies FciDocxSingleValueRow[];
}

function combineBooleanWithDetails(
  payload: FciFormPayload,
  sectionKey: string,
  booleanFieldKey: string,
  detailsFieldKey: string,
  moduleCode: FciAiSupportedModuleCode
) {
  const booleanField = getObjectField(payload, sectionKey, booleanFieldKey);
  const detailsField = getObjectField(payload, sectionKey, detailsFieldKey);
  const baseValue = formatFieldValue(booleanField, getDefinition(moduleCode, booleanFieldKey));
  const details = formatFieldValue(detailsField, getDefinition(moduleCode, detailsFieldKey));

  if (details !== EMPTY_VALUE) {
    if (baseValue === EMPTY_VALUE) {
      return details;
    }
    return `${baseValue} — ${details}`;
  }

  return baseValue;
}

function combineBudgetAndSource(payload: FciFormPayload) {
  const budget = formatFieldValue(
    getObjectField(payload, "b1_elements_financiers", "budget_estime_marche"),
    getDefinition("B", "budget_estime_marche")
  );
  const source = formatFieldValue(
    getObjectField(payload, "b1_elements_financiers", "budget_estime_source"),
    getDefinition("B", "budget_estime_source")
  );

  if (budget === EMPTY_VALUE && source === EMPTY_VALUE) {
    return EMPTY_VALUE;
  }

  if (budget !== EMPTY_VALUE && source !== EMPTY_VALUE) {
    return `${budget} (source : ${source})`;
  }

  return budget !== EMPTY_VALUE ? budget : source;
}

function createRowsFromTableSection(
  payload: FciFormPayload,
  moduleCode: FciAiSupportedModuleCode,
  sectionKey: string,
  fieldKeys: string[]
) {
  const rows = asTableRows(payload.data[sectionKey]);
  return rows.map((row) =>
    fieldKeys.map((fieldKey) =>
      formatFieldValue(getTableField(row, fieldKey), getDefinition(moduleCode, fieldKey))
    )
  );
}

function buildModuleAExport(payload: FciFormPayload) {
  return {
    singleValueRows: [
      ...formatCommonIdentificationRows(payload),
      {
        label: "Notre avantage différentiel principal Ce que les concurrents ne peuvent pas opposer",
        value: formatFieldValue(
          getObjectField(payload, "a2_positionnement", "avantage_differentiel"),
          getDefinition("A", "avantage_differentiel")
        )
      },
      {
        label: "Notre vulnérabilité principale Ce sur quoi un concurrent peut nous surpasser",
        value: formatFieldValue(
          getObjectField(payload, "a2_positionnement", "vulnerabilite_principale"),
          getDefinition("A", "vulnerabilite_principale")
        )
      },
      {
        label: "Niveau de prix cible estimé Fourchette, monnaie, source d’information",
        value: formatFieldValue(
          getObjectField(payload, "a2_positionnement", "niveau_prix_cible"),
          getDefinition("A", "niveau_prix_cible")
        )
      },
      {
        label: "Délai de transit nécessaire Jours ouvrés pour acheminer le dossier physique",
        value: formatFieldValue(
          getObjectField(payload, "a3_logistique_interne", "delai_transit_jours"),
          getDefinition("A", "delai_transit_jours")
        )
      },
      {
        label: "Responsable du dépôt Personne ou partenaire local en charge",
        value: formatFieldValue(
          getObjectField(payload, "a3_logistique_interne", "responsable_depot"),
          getDefinition("A", "responsable_depot")
        )
      },
      {
        label: "Représentation locale existante Oui / Non. Si oui, laquelle et depuis quand",
        value: combineBooleanWithDetails(
          payload,
          "a3_logistique_interne",
          "representation_locale_existante",
          "representation_locale_details",
          "A"
        )
      }
    ] satisfies FciDocxSingleValueRow[],
    repeatableTables: [
      {
        key: "a1_concurrents",
        header: [
          "Nom du concurrent ▸CDC",
          "Pays ▸CDC",
          "Points forts connus",
          "Historique avec le client",
          "Avantage principal pour ce CDC",
          "Risque qu’il représente"
        ],
        rows: createRowsFromTableSection(payload, "A", "a1_concurrents", [
          "nom",
          "pays",
          "points_forts_connus",
          "historique_client",
          "avantage_principal",
          "risque_represente"
        ]),
        emptyPlaceholder: EMPTY_VALUE
      }
    ] satisfies FciDocxRepeatableTable[]
  };
}

function buildModuleBExport(payload: FciFormPayload) {
  return {
    singleValueRows: [
      ...formatCommonIdentificationRows(payload),
      {
        label: "Budget estimé du marché Montant, monnaie, source de l’estimation. Souvent non publié",
        value: combineBudgetAndSource(payload)
      },
      {
        label: "Taux de change appliqué et source Ex. parité fixe, BCEAO, BCE, date",
        value: formatFieldValue(
          getObjectField(payload, "b1_elements_financiers", "taux_change"),
          getDefinition("B", "taux_change")
        )
      },
      {
        label: "Coefficient de charges de structure Pourcentage appliqué, justification",
        value: formatFieldValue(
          getObjectField(payload, "b1_elements_financiers", "coefficient_charges_structure"),
          getDefinition("B", "coefficient_charges_structure")
        )
      },
      {
        label: "Marge cible visée Pourcentage après prise en compte des risques",
        value: formatFieldValue(
          getObjectField(payload, "b1_elements_financiers", "marge_cible"),
          getDefinition("B", "marge_cible")
        )
      },
      {
        label: "Commentaires financiers généraux Tout élément financier à risque ou à surveiller",
        value: formatFieldValue(
          getObjectField(payload, "b3_synthese_financiere", "commentaires_generaux"),
          getDefinition("B", "commentaires_generaux")
        )
      }
    ] satisfies FciDocxSingleValueRow[],
    repeatableTables: [
      {
        key: "b2_jalons_cash_flow",
        header: [
          "Jalon / Livrable ▸CDC",
          "% du montant ▸CDC",
          "Délai de paiement estimé",
          "Risque de cash flow"
        ],
        rows: createRowsFromTableSection(payload, "B", "b2_jalons_cash_flow", [
          "jalon_livrable",
          "pourcentage_montant",
          "delai_paiement_estime",
          "risque_cash_flow"
        ]),
        emptyPlaceholder: EMPTY_VALUE
      }
    ] satisfies FciDocxRepeatableTable[]
  };
}

function buildModuleCExport(payload: FciFormPayload) {
  return {
    singleValueRows: [
      ...formatCommonIdentificationRows(payload),
      {
        label: "Partenaires non encore éprouvés Nom et nature du risque (qualité, délais, communication)",
        value: formatFieldValue(
          getObjectField(payload, "c5_risques_coordination", "partenaires_non_eprouves"),
          getDefinition("C", "partenaires_non_eprouves")
        )
      },
      {
        label: "Fréquence des réunions de coordination Ex. hebdomadaire en phase active",
        value: formatFieldValue(
          getObjectField(payload, "c5_risques_coordination", "frequence_reunions_coordination"),
          getDefinition("C", "frequence_reunions_coordination")
        )
      },
      {
        label: "Risque de pénalités internes au groupement Pénalités de retard inter-membres ? Oui / Non, détailler",
        value: formatFieldValue(
          getObjectField(payload, "c5_risques_coordination", "penalites_internes_groupement"),
          getDefinition("C", "penalites_internes_groupement")
        )
      },
      {
        label: "Contrôle qualité des livrables partenaires Comment le chef de file vérifie et valide",
        value: formatFieldValue(
          getObjectField(payload, "c5_risques_coordination", "controle_qualite_livrables"),
          getDefinition("C", "controle_qualite_livrables")
        )
      },
      {
        label: "Risques vis-à-vis des partenaires",
        value: formatFieldValue(
          getObjectField(payload, "c5_risques_coordination", "risques_vis_a_vis_partenaires"),
          getDefinition("C", "risques_vis_a_vis_partenaires")
        )
      },
      {
        label: "Risques vs à vis consultants externe",
        value: formatFieldValue(
          getObjectField(payload, "c5_risques_coordination", "risques_consultants_externes"),
          getDefinition("C", "risques_consultants_externes")
        )
      },
      {
        label: "Nom et référence du projet similaire Code interne, client, pays, année",
        value: formatFieldValue(
          getObjectField(payload, "rex_projet_reference", "identite"),
          getDefinition("C", "identite")
        )
      },
      {
        label: "Niveau et type de similitude Très similaire / Similaire / Partiel. Expliquer",
        value: formatFieldValue(
          getObjectField(payload, "rex_projet_reference", "niveau_similitude"),
          getDefinition("C", "niveau_similitude")
        )
      },
      {
        label: "Différences clés à noter Ex. étendue, nombre de systèmes, milieu urbain ou rural",
        value: formatFieldValue(
          getObjectField(payload, "rex_projet_reference", "differences_cles"),
          getDefinition("C", "differences_cles")
        )
      },
      {
        label: "Postes de coûts sous-estimés Ex. carburant, per diem en zone enclavée, reprises",
        value: formatFieldValue(
          getObjectField(payload, "rex_ecarts_couts", "postes_sous_estimes"),
          getDefinition("C", "postes_sous_estimes")
        )
      },
      {
        label: "Postes de coûts surestimés Ex. équipements non utilisés, effectifs trop dimensionnés",
        value: formatFieldValue(
          getObjectField(payload, "rex_ecarts_couts", "postes_surestimes"),
          getDefinition("C", "postes_surestimes")
        )
      },
      {
        label: "Dépassement budgétaire global constaté Pourcentage et causes principales",
        value: formatFieldValue(
          getObjectField(payload, "rex_ecarts_couts", "depassement_budgetaire"),
          getDefinition("C", "depassement_budgetaire")
        )
      },
      {
        label: "Standards techniques du pays ou client Normes locales. Vérifier aussi le TDR",
        value: formatFieldValue(
          getObjectField(payload, "rex_standards_client", "standards_techniques"),
          getDefinition("C", "standards_techniques")
        )
      },
      {
        label: "Habitudes de validation des livrables Délais réels, cycles de révision, exigences de forme",
        value: formatFieldValue(
          getObjectField(payload, "rex_standards_client", "habitudes_validation"),
          getDefinition("C", "habitudes_validation")
        )
      },
      {
        label: "Risque de méthodologie non adaptée Ajustements nécessaires si calquée d’un autre contexte",
        value: formatFieldValue(
          getObjectField(payload, "rex_standards_client", "risque_methodologie_non_adaptee"),
          getDefinition("C", "risque_methodologie_non_adaptee")
        )
      },
      {
        label: "Ajustements sur le dimensionnement Ex. ajouter ou réduire des homme-mois par poste",
        value: formatFieldValue(
          getObjectField(payload, "rex_recommandations", "ajustements_dimensionnement"),
          getDefinition("C", "ajustements_dimensionnement")
        )
      },
      {
        label: "Points de vigilance prioritaires Les 3 risques opérationnels à surveiller",
        value: formatFieldValue(
          getObjectField(payload, "rex_recommandations", "points_vigilance_prioritaires"),
          getDefinition("C", "points_vigilance_prioritaires")
        )
      },
      {
        label: "Bonnes pratiques à reproduire Ce qui a fonctionné et doit être intégré",
        value: formatFieldValue(
          getObjectField(payload, "rex_recommandations", "bonnes_pratiques"),
          getDefinition("C", "bonnes_pratiques")
        )
      }
    ] satisfies FciDocxSingleValueRow[],
    repeatableTables: [
      {
        key: "c1_ressources_cles",
        header: [
          "Poste / Expert ▸CDC",
          "Volume de travail demandé par le CDC▸CDC*",
          "Volume de travail réel prévisionnel",
          "Suppléant",
          "Volume de travail prévisionnel du suppléant",
          "Probabilité de la disponible des experts",
          "Action requise (recrutement, consultant externe . ;etc)"
        ],
        rows: createRowsFromTableSection(payload, "C", "c1_ressources_cles", [
          "poste_expert",
          "volume_demande_cdc",
          "volume_reel_previsionnel",
          "suppleant",
          "volume_previsionnel_suppleant",
          "probabilite_disponibilite",
          "action_requise"
        ]),
        emptyPlaceholder: EMPTY_VALUE
      },
      {
        key: "c2_ressources_non_cles",
        header: [
          "Poste / Expert ▸CDC à partir de la description du travail",
          "Volume de travail réél pré visionnel Peut être estimé du CDC",
          "Probabilité de la disponible des experts",
          "Action requise(recrutement, consultant externe . ;etc)"
        ],
        rows: createRowsFromTableSection(payload, "C", "c2_ressources_non_cles", [
          "poste_expert",
          "volume_previsionnel",
          "probabilite_disponibilite",
          "action_requise"
        ]),
        emptyPlaceholder: EMPTY_VALUE
      },
      {
        key: "c3_moyens_capacite",
        header: [
          "Désignation du moyen Véhicule, équipement ou logiciel requis. Source : estimation à partir du CDC.",
          "Quantité requise Nombre exigé par le projet. Source : estimation à partir du CDC.",
          "Quantité disponible Nombre détenu par le groupement.",
          "Membre du groupement qui l'apporte Entité du groupement qui mobilise le moyen.",
          "Disponible au démar-rage ? Oui / Non lors du démarrage.",
          "Écart Requise moins disponible. Calcul manuel."
        ],
        rows: createRowsFromTableSection(payload, "C", "c3_moyens_capacite", [
          "designation",
          "quantite_requise",
          "quantite_disponible",
          "membre_apporteur",
          "disponible_demarrage",
          "ecart"
        ]),
        emptyPlaceholder: EMPTY_VALUE
      },
      {
        key: "c4_repartition_roles",
        header: [
          "Composante / Tâche*",
          "Membre responsable",
          "Expert(s) affecté(s)",
          "Effort estimé par le client vs Effort estimé par Concept",
          "Commentaire / Risque"
        ],
        rows: createRowsFromTableSection(payload, "C", "c4_repartition_roles", [
          "composante_tache",
          "membre_responsable",
          "experts_affectes",
          "effort_client_vs_concept",
          "commentaire_risque"
        ]),
        emptyPlaceholder: EMPTY_VALUE
      }
    ] satisfies FciDocxRepeatableTable[]
  };
}

function buildModuleDExport(payload: FciFormPayload) {
  return {
    singleValueRows: [
      ...formatCommonIdentificationRows(payload),
      {
        label: "Inscription dans un programme pluriannuel Oui / Non. Si oui, valeur des futures phases",
        value: combineBooleanWithDetails(
          payload,
          "d1_valeur_strategique",
          "programme_pluriannuel",
          "programme_pluriannuel_details",
          "D"
        )
      },
      {
        label: "Valeur estimée des futurs lots Opportunités à venir si ce 1er contrat est remporté",
        value: formatFieldValue(
          getObjectField(payload, "d1_valeur_strategique", "valeur_futurs_lots"),
          getDefinition("D", "valeur_futurs_lots")
        )
      },
      {
        label: "Positionnement géographique visé Nouveau pays, région ou client ?",
        value: formatFieldValue(
          getObjectField(payload, "d1_valeur_strategique", "positionnement_geographique"),
          getDefinition("D", "positionnement_geographique")
        )
      },
      {
        label: "Valeur comme référence Apport au portefeuille de références",
        value: formatFieldValue(
          getObjectField(payload, "d1_valeur_strategique", "valeur_reference"),
          getDefinition("D", "valeur_reference")
        )
      },
      {
        label: "Risque en cas de sous-performance Impact relation client et futures présélections",
        value: formatFieldValue(
          getObjectField(payload, "d2_enjeux_reputationnels", "risque_sous_performance"),
          getDefinition("D", "risque_sous_performance")
        )
      },
      {
        label: "Risque en cas de perte Moral des équipes, signal au marché, coût de l’offre",
        value: formatFieldValue(
          getObjectField(payload, "d2_enjeux_reputationnels", "risque_perte"),
          getDefinition("D", "risque_perte")
        )
      },
      {
        label: "Valeur de test ou d’apprentissage Nouveau type de mission, pays ou partenaire ?",
        value: formatFieldValue(
          getObjectField(payload, "d2_enjeux_reputationnels", "valeur_test_apprentissage"),
          getDefinition("D", "valeur_test_apprentissage")
        )
      },
      {
        label: "Importance stratégique globale Faible / Moyenne / Haute / Critique. Justifier",
        value: formatFieldValue(
          getObjectField(payload, "d3_decision_preliminaire", "importance_strategique_globale"),
          getDefinition("D", "importance_strategique_globale")
        )
      },
      {
        label: "Marché prioritaire pour la direction Oui / Non / Sous conditions. Préciser",
        value: combineBooleanWithDetails(
          payload,
          "d3_decision_preliminaire",
          "marche_prioritaire_direction",
          "conditions_priorisation",
          "D"
        )
      },
      {
        label: "Commentaires stratégiques de la DG Contexte non couvert ci-dessus",
        value: formatFieldValue(
          getObjectField(payload, "d3_decision_preliminaire", "commentaires_strategiques"),
          getDefinition("D", "commentaires_strategiques")
        )
      }
    ] satisfies FciDocxSingleValueRow[],
    repeatableTables: [] satisfies FciDocxRepeatableTable[]
  };
}

export function buildFciExportSource(
  modulePresentation: FciModulePresentation
): FciExportSource {
  const moduleCode = modulePresentation.module.module_code;
  if (moduleCode !== "A" && moduleCode !== "B" && moduleCode !== "C" && moduleCode !== "D") {
    throw new Error("Le module FCI demande n'est pas exportable.");
  }

  const payload = modulePresentation.latest_data?.data;
  if (!payload || !isRecognizedFciModulePayload(payload, moduleCode)) {
    throw new Error("Aucune donnee FCI exportable n'est disponible pour ce module.");
  }

  const template = getFciTemplateDefinition(moduleCode);
  return {
    moduleCode,
    templateCode: template.templateCode,
    module: modulePresentation.module,
    appelOffres: modulePresentation.appel_offres,
    payload,
    state: modulePresentation.module.status === "validated" ? "completed" : "draft"
  };
}

export function buildFciDocxMapping(source: FciExportSource) {
  switch (source.moduleCode) {
    case "A":
      return buildModuleAExport(source.payload);
    case "B":
      return buildModuleBExport(source.payload);
    case "C":
      return buildModuleCExport(source.payload);
    case "D":
      return buildModuleDExport(source.payload);
  }
}
