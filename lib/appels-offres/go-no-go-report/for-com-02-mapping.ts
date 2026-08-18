import type { FciJsonObject } from "../fci/types.ts";
import type { GoNoGoReportEditablePayload } from "./types.ts";
import type { GoNoGoDecisionView } from "../go-no-go/service.ts";

export type ForCom02Row = string[];

export type ForCom02Document = {
  fields: Record<string, string>;
  tables: {
    competitors: ForCom02Row[];
    equipment: ForCom02Row[];
    keyPersonnel: ForCom02Row[];
    supportPersonnel: ForCom02Row[];
    financialResources: ForCom02Row[];
  };
  decision: {
    go: boolean;
    goWithReserves: boolean;
    noGo: boolean;
  };
};

type MappingInput = {
  code: string;
  title: string;
  sourceSnapshot: FciJsonObject | null;
  reviewed: GoNoGoReportEditablePayload;
  decision: GoNoGoDecisionView | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function valueText(value: unknown): string {
  const wrapped = object(value);
  if (wrapped && "value" in wrapped) return valueText(wrapped.value);
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join("\n");
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function at(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => object(current)?.[key], root);
}

function first(root: unknown, paths: string[]): string {
  for (const path of paths) {
    const result = valueText(at(root, path));
    if (result) return result;
  }
  return "";
}

function ficheMap(snapshot: FciJsonObject | null) {
  const entries = at(snapshot, "source_fiche.extraction");
  const result = new Map<string, string>();
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    const row = object(entry);
    const key = valueText(row?.key) || valueText(row?.label);
    const value = valueText(row?.value);
    if (key && value) result.set(key.toLowerCase(), value);
  }
  return result;
}

function moduleData(snapshot: FciJsonObject | null, code: "A" | "B" | "C" | "D") {
  return at(snapshot, `modules.${code}.data`);
}

function legacyFact(snapshot: FciJsonObject | null, code: "A" | "B" | "C" | "D", terms: string[]) {
  const facts = at(snapshot, `modules.${code}.facts`);
  if (!Array.isArray(facts)) return "";
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  for (const fact of facts) {
    const row = object(fact);
    const label = valueText(row?.label).toLowerCase();
    if (normalizedTerms.every((term) => label.includes(term))) return valueText(row?.value);
  }
  return "";
}

function rows(root: unknown, path: string, columns: string[][]): ForCom02Row[] {
  const list = at(root, path);
  if (!Array.isArray(list)) return [];
  return list.map((item) => columns.map((paths) => first(item, paths))).filter((row) => row.some(Boolean));
}

export function buildForCom02Document(input: MappingInput): ForCom02Document {
  const fiche = ficheMap(input.sourceSnapshot);
  const dossier = at(input.sourceSnapshot, "dossier");
  const commercial = moduleData(input.sourceSnapshot, "A");
  const finance = moduleData(input.sourceSnapshot, "B");
  const operations = moduleData(input.sourceSnapshot, "C");
  const direction = moduleData(input.sourceSnapshot, "D");
  const f = (...keys: string[]) => keys.map((key) => fiche.get(key)).find(Boolean) ?? "";
  const a = (paths: string[], terms: string[] = []) => first(commercial, paths) || legacyFact(input.sourceSnapshot, "A", terms);
  const b = (paths: string[], terms: string[] = []) => first(finance, paths) || legacyFact(input.sourceSnapshot, "B", terms);
  const c = (paths: string[], terms: string[] = []) => first(operations, paths) || legacyFact(input.sourceSnapshot, "C", terms);
  const d = (paths: string[], terms: string[] = []) => first(direction, paths) || legacyFact(input.sourceSnapshot, "D", terms);

  const final = input.decision?.status === "go" || input.decision?.status === "no_go"
    ? input.decision
    : null;
  const reserves = final?.reserves?.trim() ?? "";

  return {
    fields: {
      code: input.code,
      offerType: f("type_procedure", "type_proposition"),
      title: input.title || f("intitule_mission") || first(dossier, ["title"]),
      duration: f("duree_totale"),
      services: f("nature_prestation", "livrables_principaux"),
      components: f("phases_mission", "points_techniques_structurants"),
      selectionMethod: f("methode_selection"),
      strengths: input.reviewed.key_strengths,
      weaknesses: a(["positionnement_offre.notre_vulnerabilite_principale"], ["vulnerabilite"]),
      opportunities: d(["synthese_direction.opportunites_majeures"], ["opportunites"]),
      threats: d(["synthese_direction.menaces_majeures"], ["menaces"]),
      majorRisks: input.reviewed.key_risks,
      riskCorrectionPlan: input.reviewed.reservations,
      client: f("client_maitre_ouvrage") || first(dossier, ["buyer"]),
      financing: f("source_financement", "credit_financement"),
      partners: a(["points_logistiques_internes.representation_locale_existante"], ["representation", "locale"]),
      submissionDate: f("date_limite_depot") || first(dossier, ["due_date"]),
      clarificationDeadline: a(["identification_opportunite.date_limite_eclaircissement"], ["eclaircissement"]),
      preparatoryConference: a(["identification_opportunite.conference_preparatoire"], ["conference"]),
      budget: b(["elements_financiers_internes.budget_estime_du_marche"], ["budget"]),
      similarOffers: a(["references_offres_similaires"], ["offres", "similaires"]),
      offerStructure: a(["montage_offre"], ["montage"]),
      commercialComments: input.reviewed.commercial_summary || input.reviewed.commercial_recommendation,
      totalDuration: f("duree_totale"),
      conceptServiceVolume: f("volume_hommes_mois"),
      clientServiceVolume: c(["repartition_des_composantes_techniques.0.effort_estime_client_vs_concept"], ["effort"]),
      offerWorkload: c(["synthese_operations.niveau_complexite_operationnelle"], ["complexite", "operationnelle"]),
      technicalLead: c(["disponibilite_des_experts_cles.0.poste_ou_expert"], ["poste", "expert"]),
      preparationTime: c(["temps_preparation_offre"], ["temps", "preparation"]),
      siteVisit: c(["visite_site"], ["visite", "site"]),
      technicalMastery: c(["synthese_operations.niveau_complexite_operationnelle"], ["complexite", "operationnelle"]),
      clientRequirements: f("exigences_es", "normes_referentiels", "contraintes_site"),
      operationsComments: input.reviewed.operational_summary,
      exchangeRate: b(["elements_financiers_internes.taux_de_change_applique_et_source"], ["taux", "change"]),
      structureCoefficient: b(["elements_financiers_internes.coefficient_de_charges_de_structure"], ["coefficient", "charges"]),
      paymentTerms: b(["synthese_financiere.commentaires_financiers_generaux"], ["modalites", "paiement"]),
      advance: b(["avance"], ["avance"]),
      taxRegistration: b(["immatriculation_fiscale"], ["immatriculation"]),
      contractRegistration: b(["enregistrement_contrat"], ["enregistrement", "contrat"]),
      insurance: b(["assurances"], ["assurances"]),
      dgContribution: d([
        "decision_strategique_preliminaire.commentaires_strategiques_de_la_direction_generale",
        "decision_strategique_preliminaire.importance_strategique_globale"
      ], ["importance", "strategique"]),
      decisionRationale: final?.rationale?.trim() ?? "",
      decisionReserves: reserves,
      decidedBy: final?.decided_by?.trim() ?? "",
      decidedAt: final?.decided_at?.trim() ?? ""
    },
    tables: {
      competitors: rows(commercial, "concurrents_premiere_lecture", [
        ["nom_du_concurrent"], ["pays"], ["historique_avec_le_client"],
        ["avantage_principal_pour_ce_cdc"], ["risque_qu_il_represente"], ["points_forts_connus"]
      ]),
      equipment: rows(operations, "capacite_absorption_globale", [
        ["designation_du_moyen"], ["quantite_requise"], ["quantite_disponible", "disponible_au_demarrage"], ["ecart"]
      ]),
      keyPersonnel: rows(operations, "disponibilite_des_experts_cles", [
        ["poste_ou_expert"], ["poste_ou_expert"], ["volume_travail_reel_previsionnel"],
        ["volume_travail_demande_par_le_cdc"], ["probabilite_disponibilite_experts"],
        ["suppleant"], ["volume_travail_previsionnel_suppleant"], ["action_requise"]
      ]),
      supportPersonnel: rows(operations, "disponibilite_des_experts_non_cles", [
        ["poste_ou_expert"], ["poste_ou_expert"], ["volume_travail_reel_previsionnel"],
        [], ["probabilite_disponibilite_experts"], [], [], ["action_requise"]
      ]),
      financialResources: rows(finance, "cash_flow_par_jalon", [
        ["jalon_livrable"], ["pourcentage_montant", "delai_paiement_estime"]
      ]).map((row, index) => [String(index + 1), row.filter(Boolean).join(" — ")])
    },
    decision: {
      go: final?.status === "go" && !reserves,
      goWithReserves: final?.status === "go" && Boolean(reserves),
      noGo: final?.status === "no_go"
    }
  };
}
