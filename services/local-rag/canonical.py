"""Canonical Fiche CDC contract and fail-closed local candidate helpers."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import OrderedDict

NON_TROUVE = "Non trouvé"

FIELD_GROUPS = OrderedDict(
    [
        ("identification", (
            "reference_officielle", "intitule_mission", "client_maitre_ouvrage", "pays",
            "zone_execution", "projet_rattachement", "source_financement", "credit_financement",
            "secteur", "nature_prestation",
        )),
        ("procedure", (
            "type_procedure", "methode_selection", "type_proposition", "type_contrat",
            "date_emission", "date_limite_depot", "langue_offre",
            "ponderation_technique_financiere", "note_technique_minimale",
        )),
        ("duree_volume", (
            "duree_totale", "volume_hommes_mois", "nombre_profils_experts", "phases_mission",
        )),
        ("livrables_profils", (
            "livrables_principaux", "nombre_livrables_structurants", "profils_cles",
            "disciplines_techniques",
        )),
        ("site_contraintes", (
            "nombre_sites", "contraintes_site", "outils_methodes", "moyens_materiels",
            "exigences_es", "normes_referentiels", "points_techniques_structurants",
        )),
    ]
)
EXTRACTION_FIELDS = tuple(key for fields in FIELD_GROUPS.values() for key in fields)
EVALUATION_FIELDS = ("complexite_technique", "difficulte_terrain", "risque_sous_dimensionnement")

FIELD_RULES = {
    "reference_officielle": "official procurement/reference identifier, preserving punctuation",
    "intitule_mission": "full populated mission title",
    "client_maitre_ouvrage": "contracting authority/client and explicitly named executing unit",
    "pays": "country of the client/project",
    "zone_execution": "explicit geographic execution locations",
    "projet_rattachement": "named parent project/programme",
    "source_financement": "financing institution or source",
    "credit_financement": "credit, loan or grant identifier",
    "secteur": "mission sector",
    "nature_prestation": "nature and scope category of consulting services",
    "type_procedure": "official procurement procedure label, not the consultant selection method",
    "methode_selection": "consultant selection method and acronym",
    "type_proposition": "populated technical proposal type actually required (complete/PTC or simplified/PTS); reject template alternatives",
    "type_contrat": "contract/remuneration type",
    "date_emission": "issue/emission date, not submission deadline",
    "date_limite_depot": "actual proposal submission deadline; reject blank templates",
    "langue_offre": "required proposal language",
    "ponderation_technique_financiere": "technical and financial weights",
    "note_technique_minimale": "explicit minimum technical qualification score; never return weighting or maximum criterion points",
    "duree_totale": "total mission duration, preserving equivalent units",
    "volume_hommes_mois": "total expert/person-month effort",
    "nombre_profils_experts": "count of distinct required key expert profiles; prefer an explicit Total Personnel clé row over counting a partial table fragment",
    "phases_mission": "mission stages/phases",
    "livrables_principaux": "principal deliverables",
    "nombre_livrables_structurants": "count of explicitly structured principal deliverable milestones",
    "profils_cles": "required key expert profiles",
    "disciplines_techniques": "technical specialties explicitly represented by required profiles; remove role prefixes Expert/Ingénieur/Chef and preserve the remaining tender terms (for example Hydraulicien, Routier, Topographe), supporting every item",
    "nombre_sites": "count of distinct execution sites",
    "contraintes_site": "explicit physical, access, occupation, safety, climate, network or operating constraints; pure locations are not constraints",
    "outils_methodes": "required methods, calculations, models and tools",
    "moyens_materiels": "required material, equipment and software resources",
    "exigences_es": "project environmental/social obligations, safeguards, mitigation or compliance requirements; reject expert diplomas and experience criteria",
    "normes_referentiels": "applicable standards, codes and reference frameworks",
    "points_techniques_structurants": "major technical features shaping the assignment",
}

FIELD_QUERIES = {key: f"{key.replace('_', ' ')} {rule}" for key, rule in FIELD_RULES.items()}
INTEGER_FIELDS = {"nombre_profils_experts", "nombre_livrables_structurants", "nombre_sites"}

# Explicit, reusable field-to-section routing. Primary families receive a
# stronger deterministic boost; fallback families remain eligible and global
# retrieval is never removed.
FIELD_ROUTES = {
    "reference_officielle": (("front_matter", "procurement"), ("financing",), ("DP No", "référence", "reference"), ("insérer", "table des matières"), "scalar"),
    "intitule_mission": (("front_matter", "scope"), ("procurement",), ("désignation de la mission", "services de consultant", "objet"), ("formulaire type",), "scalar"),
    "client_maitre_ouvrage": (("front_matter", "client_authority"), ("procurement",), ("client", "maître d'ouvrage", "UCP", "unité de coordination"), ("définition", "consultants/firmes"), "scalar"),
    "pays": (("front_matter", "procurement"), ("client_authority",), ("pays du client", "pays :", "country"), ("pays éligibles", "consultants/firmes"), "scalar"),
    "zone_execution": (("sites", "scope"), ("schedule",), ("localisation", "lieu", "communes", "zones du projet"), ("pays éligibles",), "list"),
    "projet_rattachement": (("financing", "front_matter"), ("scope",), ("projet d'", "programme", "en vue de financer"), ("projeté", "proposition", "ATTENDU QUE", "conditions du contrat"), "scalar"),
    "source_financement": (("financing",), ("front_matter", "procurement"), ("a reçu un financement", "association internationale de développement", "IDA", "source de financement"), ("numéro de crédit", "prix", "ATTENDU QUE", "Banque internationale pour la Reconstruction", "conditions du contrat"), "scalar"),
    "credit_financement": (("financing", "front_matter"), ("procurement",), ("Prêt/Crédit/Don No", "Crédit IDA", "accord de crédit", "loan", "grant"), ("crédit-temps", "ATTENDU QUE", "conditions du contrat"), "scalar"),
    "secteur": (("scope", "technical"), ("front_matter",), ("assainissement", "drainage", "secteur", "infrastructure"), ("secteur privé",), "synthesized"),
    "nature_prestation": (("front_matter", "scope"), ("procurement",), ("services de consultants", "études", "mission"), ("formulaire",), "synthesized"),
    "type_procedure": (("procurement", "front_matter"), (), ("demande de propositions", "dossier de demande", "services de consultants"), ("table des matières", "consultants/firmes", "adresse", "critères d'évaluation"), "scalar"),
    "methode_selection": (("procurement",), ("scope",), ("méthode de sélection", "SFQC", "qualité et le coût"), ("indiquer le mode",), "scalar"),
    "type_proposition": (("procurement",), (), ("15.2", "doit fournir une proposition technique complète", "proposition technique complète", "PTC"), ("formulaire TECH", "instructions : insérez", "consultant retenu", "sélectionnez", "ou proposition technique simplifiée"), "scalar"),
    "type_contrat": (("procurement",), (), ("rémunération forfaitaire", "temps passé", "contrat type"), ("table des matières",), "scalar"),
    "date_emission": (("front_matter", "procurement"), (), ("émis le", "date d'émission", "date :"), ("date limite", "date de publication"), "scalar"),
    "date_limite_depot": (("procurement",), ("front_matter",), ("date limite", "dépôt", "17.7", "soumettre au plus tard"), ("modèle",), "scalar"),
    "langue_offre": (("procurement", "deliverables"), (), ("langue", "rédigés en français", "proposition"), ("langue du contrat",), "scalar"),
    "ponderation_technique_financiere": (("procurement",), (), ("pondération", "T =", "F =", "poids technique"), (), "scalar"),
    "note_technique_minimale": (("procurement",), (), ("note technique (Nt) minimum", "minimum de qualification", "seuil technique"), ("points maxi", "critères de pré-sélection", "pondération", "T =", "F ="), "scalar"),
    "duree_totale": (("schedule",), ("scope",), ("lieu et durée", "délai de réalisation", "jours calendaires", "mois"), ("hommes/mois", "validité"), "scalar"),
    "volume_hommes_mois": (("personnel", "schedule"), (), ("hommes/mois", "expert-mois", "crédit-temps"), ("durée de la mission",), "table_derived"),
    "nombre_profils_experts": (("personnel",), (), ("composition de l'équipe", "total personnel clé", "profils des experts"), ("CV", "formulaire type"), "table_derived"),
    "phases_mission": (("scope", "schedule"), ("deliverables",), ("étape 1", "étape 2", "phases de la mission"), ("formulaire",), "list"),
    "livrables_principaux": (("deliverables",), ("schedule",), ("livrables", "rapports", "résultats attendus"), ("formulaire TECH-5", "annexe"), "table_derived"),
    "nombre_livrables_structurants": (("deliverables",), ("schedule",), ("liste et délais", "tableau", "livrables"), ("annexe",), "table_derived"),
    "profils_cles": (("personnel",), (), ("composition de l'équipe", "total personnel clé", "expert hydraulicien", "chef de mission"), ("CV", "formulaire TECH", "approche technique", "points", "accord de groupement"), "table_derived"),
    "disciplines_techniques": (("personnel", "technical"), ("scope",), ("composition de l'équipe", "expert hydraulicien", "géotechnicien", "topographe"), ("expérience du consultant", "CV", "années d'expérience"), "synthesized"),
    "nombre_sites": (("sites",), ("scope",), ("localisation des zones", "sites", "communes", "talweg", "cuvette", "bassin"), ("sites des ouvrages",), "table_derived"),
    "contraintes_site": (("sites",), ("technical", "scope", "schedule"), ("inondation", "ravinement", "érosion", "profondeur", "occupations", "déchets", "risques naturels", "sites indépendants", "décalage", "maintien du service"), ("localisation des zones", "commune", "district", "ville"), "list"),
    "outils_methodes": (("technical",), ("scope", "equipment"), ("modélisation", "calcul", "levés", "sondages", "méthodologie"), ("formulaire TECH-4",), "list"),
    "moyens_materiels": (("equipment",), ("technical",), ("moyens logistiques", "matériel", "équipement", "laboratoire", "véhicules"), ("personnel de contrepartie",), "list"),
    "exigences_es": (("environmental_social",), ("scope", "technical"), ("cadre environnemental et social", "code de conduite", "EAS", "HS", "VBG", "travail forcé", "travail des enfants"), ("diplôme", "qualification", "expert", "profil", "CV", "années d'expérience", "missions relatives"), "list"),
    "normes_referentiels": (("standards", "technical"), ("procurement",), ("normes", "règlement", "code", "directives", "fascicules"), ("table des matières",), "list"),
    "points_techniques_structurants": (("technical", "scope"), ("sites",), ("ouvrages", "aménagement", "SBN", "dimensionnement", "modélisation"), ("expérience du consultant",), "synthesized"),
}


def is_placeholder(value: object) -> bool:
    return bool(re.search(r"ins[eé]rer|à compl[eé]ter|\.{3,}|…{2,}|\[\s*(nom|date|r[eé]f)", str(value), re.I))


ES_OBLIGATION_PATTERN = re.compile(
    r"doit|exig[eé]|obligation|code de conduite|mesures|att[eé]nuation|travail forc[eé]|travail des enfants|EAS|harc[eè]lement sexuel",
    re.I,
)


def is_es_obligation_evidence(text: str) -> bool:
    """Shared by validation and candidate selection so both agree on what counts as an E&S obligation clause."""
    return bool(ES_OBLIGATION_PATTERN.search(text))


def validate_field(field: str, item: object, evidence: dict[str, str]) -> tuple[bool, str]:
    if not isinstance(item, dict) or set(item) != {"value", "supported", "source_chunks"}:
        return False, "exactly value, supported and source_chunks are required"
    value, supported, sources = item["value"], item["supported"], item["source_chunks"]
    if value is None:
        evidence_text = "\n".join(evidence.values())
        direct_patterns = {
            "type_procedure": r"demande de propositions services de consultants|dossier de demande de propositions|la pr[eé]sente demande de propositions",
            "type_proposition": r"15\.2.{0,120}doit fournir une proposition technique compl[eè]te|doit fournir une proposition technique compl[eè]te \(PTC\)",
            "note_technique_minimale": r"note technique \(Nt\) minimum de qualification est\s*:\s*\d+\s*points",
            "disciplines_techniques": r"tableau \d+\s*:\s*(composition|temps d.intervention).*personnel cl[eé]",
            "contraintes_site": r"ravinement|[eé]rosion r[eé]gressive|inondation|profondeur moyenne|occupations anarchiques|d[eé]p[oô]ts sauvages|sites? (?:sont|[eé]tant) ind[eé]pendants|d[eé]calage de .{0,20} mois|maintien du service",
            "exigences_es": r"doit soumettre son code de conduite|travail forc[eé]|travail des enfants|EAS.{0,50}HS",
        }
        if field in direct_patterns and re.search(direct_patterns[field], evidence_text, re.I | re.S):
            return False, "direct field evidence was supplied; null requires one correction attempt"
        return (supported is False and sources == [], "valid absence" if supported is False and sources == [] else "null must be unsupported and uncited")
    if supported is not True or not isinstance(sources, list) or not sources:
        return False, "populated value must be supported and cited"
    if any(str(source) not in evidence for source in sources):
        return False, "citation is outside supplied tender-scoped evidence"
    if not isinstance(value, (str, int, float)) or not str(value).strip() or is_placeholder(value):
        return False, "empty, structured or placeholder value rejected"
    if field in INTEGER_FIELDS and not re.fullmatch(r"\d+", str(value).strip()):
        return False, "derived count must be an integer"
    if field == "credit_financement" and not re.search(r"\d", str(value)):
        return False, "financing identifier must contain its populated number"
    if field == "reference_officielle" and not re.search(r"[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+){2,}", str(value)):
        return False, "official reference lacks a populated multi-part identifier"
    if field in {"date_emission", "date_limite_depot"} and not re.fullmatch(r"\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}\s*", str(value)):
        return False, "date must be complete"
    cited = "\n".join(evidence[str(source)] for source in sources)
    if field == "contraintes_site" and not re.search(r"inondation|ravinement|[eé]rosion|profondeur|occupation|acc[eè]s|circulation|s[eé]curit[eé]|r[eé]seau|d[eé]chets?|risque|restriction|sites? (?:sont|[eé]tant) ind[eé]pendants|d[eé]calage|maintien du service", cited, re.I):
        return False, "site evidence contains locations but no actual constraint"
    if field == "exigences_es":
        obligation = is_es_obligation_evidence(cited)
        qualification = re.search(r"dipl[oô]me|ann[eé]es? d.exp[eé]rience|expert environnementaliste|profil|CV|missions relatives", cited, re.I)
        if not obligation or qualification and not re.search(r"code de conduite|mesures d.att[eé]nuation|travail forc[eé]|travail des enfants", cited, re.I):
            return False, "expert qualification evidence is not a project E&S obligation"
    if field == "disciplines_techniques" and re.search(r"\b(?:Expert|Chef de Mission|Architecte|Ing[eé]nieur)\b", str(value), re.I):
        return False, "return technical disciplines, not personnel job titles"
    value_tokens = {token for token in re.findall(r"[a-z0-9]+", _normalize(str(value))) if len(token) > 2}
    evidence_tokens = set(re.findall(r"[a-z0-9]+", _normalize(cited)))
    if field not in INTEGER_FIELDS and value_tokens and len(value_tokens & evidence_tokens) / len(value_tokens) < 0.65:
        return False, "value is not sufficiently grounded in cited evidence"
    return True, "valid"


def _normalize(value: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()


def deterministic_control(fields: dict, validation_warnings: list[str] | None = None) -> dict:
    missing = [key for key in EXTRACTION_FIELDS if fields[key]["value"] is None]
    verify = list(validation_warnings or [])
    return {"champs_non_trouves": missing, "incoherences": [], "a_verifier": verify}


def build_xml(code_interne: str, fields: dict, evaluations: dict, control: dict) -> str:
    root = ET.Element("fiche_projet")
    ET.SubElement(root, "reference_interne").text = code_interne
    extraction = ET.SubElement(root, "extraction")
    for key in EXTRACTION_FIELDS:
        item = fields[key]
        node = ET.SubElement(extraction, key, source=", ".join(map(str, item["source_chunks"])))
        node.text = NON_TROUVE if item["value"] is None else str(item["value"])
    evaluation = ET.SubElement(root, "evaluation")
    for key in EVALUATION_FIELDS:
        item = evaluations[key]
        node = ET.SubElement(evaluation, key, note=str(item["note"]))
        if key == "risque_sous_dimensionnement":
            ET.SubElement(node, "charge_estimee").text = item["charge_estimee"]
        ET.SubElement(node, "justification").text = item["justification"]
    controle = ET.SubElement(root, "controle")
    for key in ("champs_non_trouves", "incoherences", "a_verifier"):
        ET.SubElement(controle, key).text = "\n".join(control[key])
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode")


def validate_canonical_xml(xml: str) -> None:
    root = ET.fromstring(xml)
    if root.tag != "fiche_projet" or root.find("reference_interne") is None:
        raise ValueError("invalid canonical root/reference")
    extraction = root.find("extraction")
    if extraction is None or [node.tag for node in extraction] != list(EXTRACTION_FIELDS):
        raise ValueError("canonical extraction fields are missing, extra or out of order")
    if any("source" not in node.attrib for node in extraction):
        raise ValueError("every extraction field requires source")
    evaluation = root.find("evaluation")
    if evaluation is None:
        raise ValueError("evaluation missing")
    for key in EVALUATION_FIELDS:
        node = evaluation.find(key)
        if node is None or not re.fullmatch(r"[1-5]", node.attrib.get("note", "")) or node.find("justification") is None:
            raise ValueError(f"invalid evaluation: {key}")
        if key == "risque_sous_dimensionnement" and node.find("charge_estimee") is None:
            raise ValueError("charge_estimee missing")
    control = root.find("controle")
    if control is None or any(control.find(key) is None for key in ("champs_non_trouves", "incoherences", "a_verifier")):
        raise ValueError("control sections missing")
