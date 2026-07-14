export type FicheStatus = "processing" | "draft" | "validated" | "error";

export type FicheErrorStage = "marker" | "anonymization" | "groq" | "unknown";

export const EXTRACTION_FIELD_DEFINITIONS = [
  { key: "reference_officielle", label: "reference_officielle", group: "Identification" },
  { key: "intitule_mission", label: "intitule_mission", group: "Identification" },
  { key: "client_maitre_ouvrage", label: "client_maitre_ouvrage", group: "Identification" },
  { key: "pays", label: "pays", group: "Identification" },
  { key: "zone_execution", label: "zone_execution", group: "Identification" },
  { key: "projet_rattachement", label: "projet_rattachement", group: "Identification" },
  { key: "source_financement", label: "source_financement", group: "Identification" },
  { key: "credit_financement", label: "credit_financement", group: "Identification" },
  { key: "secteur", label: "secteur", group: "Identification" },
  { key: "nature_prestation", label: "nature_prestation", group: "Identification" },
  { key: "type_procedure", label: "type_procedure", group: "Procedure" },
  { key: "methode_selection", label: "methode_selection", group: "Procedure" },
  { key: "type_proposition", label: "type_proposition", group: "Procedure" },
  { key: "type_contrat", label: "type_contrat", group: "Procedure" },
  { key: "date_emission", label: "date_emission", group: "Procedure" },
  { key: "date_limite_depot", label: "date_limite_depot", group: "Procedure" },
  { key: "langue_offre", label: "langue_offre", group: "Procedure" },
  {
    key: "ponderation_technique_financiere",
    label: "ponderation_technique_financiere",
    group: "Procedure"
  },
  { key: "note_technique_minimale", label: "note_technique_minimale", group: "Procedure" },
  { key: "duree_totale", label: "duree_totale", group: "Duree & volume" },
  { key: "volume_hommes_mois", label: "volume_hommes_mois", group: "Duree & volume" },
  {
    key: "nombre_profils_experts",
    label: "nombre_profils_experts",
    group: "Duree & volume"
  },
  { key: "phases_mission", label: "phases_mission", group: "Duree & volume" },
  { key: "livrables_principaux", label: "livrables_principaux", group: "Livrables & profils" },
  {
    key: "nombre_livrables_structurants",
    label: "nombre_livrables_structurants",
    group: "Livrables & profils"
  },
  { key: "profils_cles", label: "profils_cles", group: "Livrables & profils" },
  {
    key: "disciplines_techniques",
    label: "disciplines_techniques",
    group: "Livrables & profils"
  },
  { key: "nombre_sites", label: "nombre_sites", group: "Site & contraintes" },
  { key: "contraintes_site", label: "contraintes_site", group: "Site & contraintes" },
  { key: "outils_methodes", label: "outils_methodes", group: "Site & contraintes" },
  { key: "moyens_materiels", label: "moyens_materiels", group: "Site & contraintes" },
  { key: "exigences_es", label: "exigences_es", group: "Site & contraintes" },
  { key: "normes_referentiels", label: "normes_referentiels", group: "Site & contraintes" },
  {
    key: "points_techniques_structurants",
    label: "points_techniques_structurants",
    group: "Site & contraintes"
  }
] as const;

export const EVALUATION_FIELD_DEFINITIONS = [
  { key: "complexite_technique", label: "complexite_technique" },
  { key: "difficulte_terrain", label: "difficulte_terrain" },
  { key: "risque_sous_dimensionnement", label: "risque_sous_dimensionnement" }
] as const;

export type ExtractionFieldKey = (typeof EXTRACTION_FIELD_DEFINITIONS)[number]["key"];
export type ExtractionFieldGroup = (typeof EXTRACTION_FIELD_DEFINITIONS)[number]["group"];
export type EvaluationFieldKey = (typeof EVALUATION_FIELD_DEFINITIONS)[number]["key"];

export type ExtractionField = {
  key: ExtractionFieldKey;
  label: string;
  value: string;
  source: string;
};

export type EvaluationField = {
  key: EvaluationFieldKey;
  label: string;
  score: number | null;
  justification: string;
  chargeEstimee?: string;
};

export type ControleResolutionSection =
  | "champs_non_trouves"
  | "incoherences"
  | "a_verifier";

export type ControleResolutionStatus =
  | "unresolved"
  | "resolved"
  | "ignored"
  | "commented";

export type ControleResolution = {
  section: ControleResolutionSection;
  index: number;
  status: ControleResolutionStatus;
  comment: string;
};

export type ControleSection = {
  champsNonTrouves: string[];
  incoherences: string[];
  aVerifier: string[];
  resolutions: ControleResolution[];
};

export type FichePayload = {
  codeInterne: string;
  extraction: ExtractionField[];
  evaluation: EvaluationField[];
  controle: ControleSection;
};

export type StatusPayload = {
  status: FicheStatus;
  createdAt: string;
  validatedAt: string | null;
  modifiedAt: string | null;
  n8nExecutionId: string | null;
  processingStartedAt: string | null;
  errorReason: string | null;
  errorStage: FicheErrorStage | null;
};

export type FicheResponse = FichePayload & {
  markdown: string | null;
  status: StatusPayload;
};
