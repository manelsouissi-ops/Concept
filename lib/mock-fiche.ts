import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS,
  type EvaluationField,
  type FichePayload
} from "@/lib/types";

export function createMockFiche(codeInterne: string): FichePayload {
  const extractionValues: Record<(typeof EXTRACTION_FIELD_DEFINITIONS)[number]["key"], string> = {
    reference_officielle: "AMI-SEN-EAU-2026-014",
    intitule_mission: "Assistance technique pour la conception detaillee et la supervision de reseaux AEP ruraux",
    client_maitre_ouvrage: "Agence nationale de l'hydraulique rurale",
    pays: "Senegal",
    zone_execution: "Kaolack, Kaffrine et Fatick",
    projet_rattachement: "Programme d'acces durable a l'eau potable en milieu rural",
    source_financement: "Banque mondiale",
    credit_financement: "IDA-74210-SN",
    secteur: "Eau et assainissement",
    nature_prestation: "Etudes d'execution, supervision et assistance a la mise en service",
    type_procedure: "Appel a manifestation d'interet",
    methode_selection: "Selection fondee sur la qualite et le cout",
    type_proposition: "Offre technique et financiere separees",
    type_contrat: "Marche a prix forfaitaire",
    date_emission: "2026-06-18",
    date_limite_depot: "2026-08-01 12:00 GMT",
    langue_offre: "Francais",
    ponderation_technique_financiere: "80/20",
    note_technique_minimale: "75/100",
    duree_totale: "14 mois",
    volume_hommes_mois: "68 hommes-mois",
    nombre_profils_experts: "9 experts cles",
    phases_mission: "Demarrage, diagnostic, etudes detaillees, supervision, appui a la reception",
    livrables_principaux: "Rapport de demarrage, APS/APD, DAO, rapports mensuels, rapport final",
    nombre_livrables_structurants: "5 livrables structurants",
    profils_cles: "Chef de mission, hydraulicien, electromechanicien, expert SIG, expert E&S",
    disciplines_techniques: "Hydraulique, genie civil, electromechanique, SIG, environnement social",
    nombre_sites: "17 sites",
    contraintes_site: "Acces difficile en saison des pluies sur 6 sites et emprises sensibles en zone habitee",
    outils_methodes: "Leve topographique drone, SIG QGIS, BIM light pour ouvrages types",
    moyens_materiels: "Vehicules 4x4, kits GPS, materiel topographique, equipement de relevage",
    exigences_es: "PGES chantier, consultations communautaires, suivi HSE mensuel",
    normes_referentiels: "Normes AEP nationales, directives Banque mondiale ESS, Eurocodes pour ouvrages",
    points_techniques_structurants: "Dimensionnement des reservoirs, fiabilite energetique, pression reseau et phasage des travaux"
  };

  const evaluationByKey: Record<(typeof EVALUATION_FIELD_DEFINITIONS)[number]["key"], EvaluationField> =
    {
      complexite_technique: {
        key: "complexite_technique",
        label: "complexite_technique",
        score: 4,
        justification:
          "La mission combine etudes detaillees, supervision multi-sites et coordination interdisciplinaire."
      },
      difficulte_terrain: {
        key: "difficulte_terrain",
        label: "difficulte_terrain",
        score: 4,
        justification:
          "Les sites sont disperses et plusieurs zones restent difficiles d'acces pendant la saison humide."
      },
      risque_sous_dimensionnement: {
        key: "risque_sous_dimensionnement",
        label: "risque_sous_dimensionnement",
        score: 3,
        chargeEstimee: "68 hommes-mois pour 17 sites et 5 livrables structurants",
        justification:
          "Le risque est modere mais reel si la supervision de chantier et les validations intermediaires se chevauchent."
      }
    };

  return {
    codeInterne,
    extraction: EXTRACTION_FIELD_DEFINITIONS.map((field) => ({
      key: field.key,
      label: field.label,
      value: extractionValues[field.key],
      source: `cdc.md > ${field.key}`
    })),
    evaluation: EVALUATION_FIELD_DEFINITIONS.map((field) => evaluationByKey[field.key]),
    controle: {
      champsNonTrouves: [
        "Montant estimatif de la mission",
        "Liste detaillee des annexes techniques"
      ],
      incoherences: [
        "Le volume annonce de 68 hommes-mois semble tendu au regard du nombre de sites et du calendrier."
      ],
      aVerifier: [
        "Confirmer si la note technique minimale de 75/100 est eliminatoire.",
        "Verifier si les normes nationales priment sur les referentiels bailleur en cas d'ecart."
      ],
      resolutions: [
        {
          section: "champs_non_trouves",
          index: 0,
          status: "unresolved",
          comment: ""
        },
        {
          section: "champs_non_trouves",
          index: 1,
          status: "unresolved",
          comment: ""
        },
        {
          section: "incoherences",
          index: 0,
          status: "unresolved",
          comment: ""
        },
        {
          section: "a_verifier",
          index: 0,
          status: "unresolved",
          comment: ""
        },
        {
          section: "a_verifier",
          index: 1,
          status: "unresolved",
          comment: ""
        }
      ]
    }
  };
}

export function mockMarkdown(codeInterne: string) {
  return `# CDC ${codeInterne}

## Identification
Mission d'assistance technique pour la conception detaillee et la supervision de reseaux AEP ruraux au Senegal.

## Procedure
AMI finance par la Banque mondiale avec selection fondee sur la qualite et le cout.

## Duree et volume
Mission de 14 mois estimee a 68 hommes-mois sur 17 sites.

## Livrables et profils
Livrables de conception, DAO et supervision portes par une equipe pluridisciplinaire.
`;
}
