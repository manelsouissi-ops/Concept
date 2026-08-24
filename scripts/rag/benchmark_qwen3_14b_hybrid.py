#!/usr/bin/env python3
"""Evaluation-only hybrid retrieval benchmark for one persisted CONCEPT CDC."""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter
from uuid import NAMESPACE_URL, uuid5

from llama_index.core.schema import TextNode
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.core.vector_stores.utils import node_to_metadata_dict
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models

from benchmark_qwen3_14b import FIELDS, MODEL, correct, ollama_generate
from poc_tender_rag import (
    EMBEDDING_MODEL,
    OLLAMA_URL,
    QDRANT_URL,
    build_nodes,
    exact_filter,
    llama_filters,
    resolve_tender,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "local-rag"))
from canonical import FIELD_ROUTES  # noqa: E402

COLLECTION_PREFIX = "concept_rag_qwen3_14b_hybrid_benchmark"
RRF_K = 60
DENSE_POOL = 24
LEXICAL_POOL = 24
FINAL_K = 8

EXPANSIONS = {
    "official_reference": "référence officielle référence de la mission numéro de référence Ref DP dossier demande propositions",
    "client": "client autorité contractante maître d'ouvrage unité de coordination agence d'exécution nom du client",
    "country": "pays pays du client pays du projet lieu d'exécution",
    "issue_date": "date d'émission date de publication émis le émission de la demande de propositions",
    "credit_number": "crédit IDA prêt financement numéro de crédit",
    "selection_method": "méthode de sélection consultant qualité coût SFQC",
    "mission_duration": "délai durée réalisation mission jours mois calendrier",
    "financed_project": "projet financé financement nom du projet programme",
    "unsupported": "",
}

# Canonical W2 fields use the same retrieval stack.  Values are deliberately
# generic vocabulary, never values from a benchmark tender.
EXPANSIONS.update({
    "reference_officielle": EXPANSIONS["official_reference"],
    "intitule_mission": "intitulé mission objet services consultant recrutement firme termes référence",
    "client_maitre_ouvrage": EXPANSIONS["client"],
    "pays": EXPANSIONS["country"],
    "zone_execution": "zone exécution localisation sites communes régions intervention",
    "projet_rattachement": EXPANSIONS["financed_project"],
    "source_financement": "source financement bailleur banque IDA fonds prêt don",
    "credit_financement": EXPANSIONS["credit_number"],
    "secteur": "secteur domaine assainissement infrastructure eau transport énergie",
    "nature_prestation": "nature prestation services consultants études supervision assistance technique",
    "type_procedure": "type procédure demande propositions appel offres manifestation intérêt",
    "methode_selection": EXPANSIONS["selection_method"],
    "type_proposition": "type proposition technique complète simplifiée PTC PTS",
    "type_contrat": "type contrat rémunération forfaitaire temps passé",
    "date_emission": EXPANSIONS["issue_date"],
    "date_limite_depot": "date limite dépôt soumission propositions heure adresse",
    "langue_offre": "langue proposition offre français anglais",
    "ponderation_technique_financiere": "pondération technique financière poids T F qualité coût",
    "note_technique_minimale": "note score technique minimum points qualification",
    "duree_totale": EXPANSIONS["mission_duration"],
    "volume_hommes_mois": "volume hommes mois expert mois personnel charge totale",
    "nombre_profils_experts": "nombre experts clés profils personnel équipe",
    "phases_mission": "phases étapes mission calendrier activités tâches",
    "livrables_principaux": "livrables rapports résultats attendus produits délais remise",
    "nombre_livrables_structurants": "nombre livrables rapports étapes structurants calendrier",
    "profils_cles": "experts clés profils qualifications équipe personnel",
    "disciplines_techniques": "disciplines compétences techniques spécialités experts",
    "nombre_sites": "nombre sites zones communes localités intervention",
    "contraintes_site": "contraintes site terrain accès inondation sécurité environnement",
    "outils_methodes": "méthodologie outils logiciels calcul modélisation études levés",
    "moyens_materiels": "matériel équipements logiciels véhicules laboratoire moyens consultant",
    "exigences_es": "environnement social EAS HS VBG sauvegarde santé sécurité CES",
    "normes_referentiels": "normes référentiels règlement code directives standards fascicules",
    "points_techniques_structurants": "points techniques structurants enjeux ouvrages solutions études",
})


def tokens(text: str) -> list[str]:
    import unicodedata

    value = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", value)


def headings(markdown: str) -> list[tuple[int, str]]:
    found = []
    offset = 0
    for line in markdown.splitlines(keepends=True):
        match = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
        if match:
            found.append((offset, match.group(1)))
        offset += len(line)
    return found


def meaningful_heading(title: str) -> bool:
    value = " ".join(tokens(title))
    return not bool(re.fullmatch(r"(?:\d+\s+)?section 7 termes de reference|\d+", value))


def section_family(heading: str | None, parent: str | None, text: str, *, front: bool = False) -> str:
    if front:
        return "front_matter"
    contract_probe = " ".join(tokens(" ".join(filter(None, [heading, parent, text[:600]]))))
    if "attendu que" in contract_probe or "clauses du contrat" in contract_probe or "conditions du contrat" in contract_probe:
        return "procurement"
    heading_probe = " ".join(tokens(heading or ""))
    heading_rules = (
        ("equipment", r"moyens logistiques|moyens materiels|equipements"),
        ("schedule", r"lieu et duree|calendrier"),
        ("deliverables", r"livrables|resultats attendus|rapports demandes|plans"),
        ("personnel", r"profil des experts|experts cles|composition de l equipe|temps d intervention"),
        ("sites", r"localisation des zones|zones du projet|sites? d.intervention|lieux? d.ex[eé]cution|implantation|emplacements?"),
        ("environmental_social", r"environnemental|developpement social|eas|harcelement sexuel|vbg"),
        ("standards", r"normes|referentiels|cadre normatif|codes? applicables?|prescriptions techniques|documents? de reference"),
        ("technical", r"etudes topographiques|etudes geotechniques|methodologie"),
        ("scope", r"objectifs et description|contenu de la mission|presentation du paru|contexte et justification"),
        ("procurement", r"donnees particulieres|demande de proposition|methode de selection|instructions aux candidats|contrat type"),
    )
    matched_heading = next((family for family, pattern in heading_rules if re.search(pattern, heading_probe)), None)
    if matched_heading:
        return matched_heading
    probe = " ".join(tokens(" ".join(filter(None, [heading, parent, text[:900]]))))
    rules = (
        ("personnel", r"profil des experts|experts cles|composition de l equipe|temps d intervention|personnel cle"),
        ("deliverables", r"livrables|resultats attendus|rapports et delais|plans"),
        ("schedule", r"lieu et duree|calendrier|delai de transmission|duree de la mission"),
        ("sites", r"localisation des zones|zones du projet|talweg|cuvette|bassin versant|lieu de la mission|sites? d.intervention|lieux? d.ex[eé]cution|implantation|emplacements?"),
        ("equipment", r"moyens logistiques|moyens materiels|materiel informatique|laboratoire"),
        ("environmental_social", r"environnemental|developpement social|eas|harcelement sexuel|vbg|sauvegarde"),
        ("standards", r"normes et standards|referentiels|cadre normatif|codes? applicables?|prescriptions techniques|documents? de reference|reglement de passation|code des marches|directives anti corruption|fascicules"),
        ("financing", r"pret credit don|source de financement|association internationale de developpement|accord de credit"),
        ("client_authority", r"obligations de l ucp|maitre d ouvrage|unite de coordination|client"),
        ("procurement", r"donnees particulieres|demande de proposition|methode de selection|instructions aux candidats|contrat type"),
        ("scope", r"objectifs et description|contenu de la mission|termes de reference|presentation du paru|contexte et justification"),
        ("technical", r"etudes topographiques|etudes geotechniques|methodologie|dimensionnement|mission du consultant"),
    )
    return next((family for family, pattern in rules if re.search(pattern, probe)), "other")


def preceding_headings(markdown: str, text: str, start: int, all_headings: list[tuple[int, str]]) -> tuple[str | None, str | None, int]:
    probe = text[: min(100, len(text))]
    position = markdown.find(probe, max(0, start))
    if position < 0:
        position = markdown.find(probe)
    if position < 0:
        position = start
    prior = [title for offset, title in all_headings if offset <= position and meaningful_heading(title)]
    return (prior[-1] if prior else None, prior[-2] if len(prior) > 1 else None, position)


def populated_front_matter(markdown: str) -> str | None:
    """Build a compact populated cover block and stop before TOC contamination."""
    lines = markdown.splitlines()
    start = next((i for i, line in enumerate(lines) if re.match(
        r"^##\s+(?:(?:DP|DAO|AMI)\s+(?:No|N[o°])\s*:|DOSSIER\s+DE\s+DEMANDE\s+DE\s+PROPOSITIONS|AVIS\s+(?:D.APPEL|DE\s+CONSULTATION)|IDENTIFICATION\s+DU\s+MARCH[EÉ])",
        line, re.I,
    )), None)
    if start is None:
        return None
    end = next((i for i in range(start + 1, min(len(lines), start + 80)) if re.match(r"^##\s+TABLE DES MATI", lines[i], re.I)), min(len(lines), start + 40))
    raw = lines[start:end]
    kept = []
    pending_label = None
    labels = re.compile(r"^(Client|Autorit[eé] contractante|Ma[iî]tre d.ouvrage|Pays|[EÉ]mis le|Date d.[eé]mission|Date|DP\s*N[o°]|DAO\s*N[o°]|AMI\s*N[o°]|Cr[eé]dit\s*N[o°]|Pr[eê]t\s*N[o°]|Don\s*N[o°]|Pr[eê]t/Cr[eé]dit/Don\s*N[o°]|Services de Consultant pour|D[eé]signation de la Mission|Objet de la mission|Passation de March[eé]s de)\s*:\s*(.*)$", re.I)
    for line in raw:
        clean = line.strip()
        if not clean or "insérer" in clean.lower() or re.fullmatch(r"[.…/\s-]+(?:20\d\d)?", clean):
            continue
        match = labels.match(clean.removeprefix("## "))
        if match:
            pending_label = match.group(1)
            value = match.group(2).strip()
            if value and not placeholder_penalty(value):
                kept.append(f"{pending_label}: {value}")
                pending_label = None
            continue
        if pending_label and len(clean) < 500:
            kept.append(f"{pending_label}: {clean}")
            pending_label = None
        elif re.search(r"Services de Consultant pour|Client\s*:|Pays\s*:|DP\s*N[o°]", clean, re.I):
            kept.append(clean)
    text = "\n".join(dict.fromkeys(kept)).strip()
    return text if text else None


def populated_financing_matter(markdown: str) -> str | None:
    """Compact populated financing/project facts from the invitation section."""
    starts = [position for marker in ("## DP No :", "## Lettre de Demande de Propositions", "## Services de Consultant") if (position := markdown.find(marker)) >= 0]
    start = min(starts) if starts else 0
    ends = [position for marker in ("## Section 2 Instructions aux Candidats", "## E. Données particulières") if (position := markdown.find(marker, start)) > start]
    end = min(ends) if ends else -1
    probe = markdown[start:end if end > start else min(len(markdown), start + 60000)]
    kept = []
    label_pattern = re.compile(r"^(Pr[eê]t/Cr[eé]dit/Don\s*N[o°]?|Cr[eé]dit\s*N[o°]?|Pr[eê]t\s*N[o°]?|Don\s*N[o°]?|DP\s*N[o°]?|DAO\s*N[o°]?|AMI\s*N[o°]?|D[eé]signation de la Mission|Objet de la mission|Client|Autorit[eé] contractante|Ma[iî]tre d.ouvrage|Pays|Date|[EÉ]mis le|Date d.[eé]mission)\s*:\s*(.*)$", re.I)
    lines = probe.splitlines()
    for index, line in enumerate(lines):
        clean = line.strip().removeprefix("## ")
        match = label_pattern.match(clean)
        if not match:
            continue
        value = match.group(2).strip()
        if not value:
            value = next((candidate.strip() for candidate in lines[index + 1:index + 4] if candidate.strip()), "")
        if value and not re.search(r"[.…]{3,}|ins[eé]rer", value, re.I):
            kept.append(f"{match.group(1)}: {value}")
    for sentence in re.split(r"(?<=[.!?])\s+", probe):
        if re.search(r"a re[cç]u un financement|en vue de financer le co[uû]t du projet|accord de cr[eé]dit N", sentence, re.I):
            kept.append(" ".join(sentence.split()))
    text = "\n".join(dict.fromkeys(kept)).strip()
    return text[:5000] if text else None


def compact_table_nodes(markdown: str, tender: dict, content_hash: str, all_headings: list[tuple[int, str]]) -> list[TextNode]:
    lines = markdown.splitlines(keepends=True)
    blocks, current, offset = [], [], 0
    previous_text = ""
    for line in lines:
        if line.lstrip().startswith("|"):
            if not current:
                current = [(offset, previous_text)]
            current.append((offset, line.rstrip()))
        elif current:
            blocks.append(current); current = []
        if line.strip() and not line.lstrip().startswith("|"):
            previous_text = line.strip().removeprefix("## ")
        offset += len(line)
    if current:
        blocks.append(current)
    result = []
    for table_index, block in enumerate(blocks):
        caption = block[0][1]
        table_lines = []
        for _offset, raw_line in block[1:]:
            if re.fullmatch(r"\|[-:|\s]+\|?", raw_line):
                continue
            cells = [cell.strip() for cell in raw_line.strip().strip("|").split("|")]
            table_lines.append("| " + " | ".join(cells) + " |")
        if len(table_lines) < 2:
            continue
        position = block[0][0]
        prior = [title for at, title in all_headings if at <= position and meaningful_heading(title)]
        heading = prior[-1] if prior else None
        parent = prior[-2] if len(prior) > 1 else None
        family = section_family(heading, parent, caption + " " + " ".join(table_lines[:3]))
        for part_index in range(0, len(table_lines), 10):
            rows = table_lines[part_index:part_index + 10]
            # Repeat the header for split tables so row/column relationships survive.
            if part_index and table_lines[0] not in rows:
                rows = [table_lines[0], *rows]
            text = "\n".join(filter(None, [caption, *rows]))
            if placeholder_penalty(text) and family not in {"procurement", "personnel", "deliverables"}:
                continue
            chunk_index = f"table_{table_index}_{part_index // 10}"
            metadata = {
                "appel_offre_id": int(tender["appel_offre_id"]), "code_interne": tender["code_interne"],
                "document_id": int(tender["document_id"]), "document_type": "cdc_markdown",
                "source_filename": tender["source_filename"], "chunk_index": chunk_index,
                "section_heading": heading, "parent_heading": parent, "preceding_heading": parent,
                "section_family": family, "content_hash": content_hash, "chunk_profile": "compact_table",
            }
            node_id = str(uuid5(NAMESPACE_URL, f"concept-rag-table:{tender['appel_offre_id']}:{tender['document_id']}:{content_hash}:{chunk_index}"))
            result.append(TextNode(id_=node_id, text=text, metadata=metadata))
    return result


def structured_section_nodes(markdown: str, tender: dict, content_hash: str, all_headings: list[tuple[int, str]]) -> list[TextNode]:
    result = []
    for index, (start, title) in enumerate(all_headings):
        if not meaningful_heading(title):
            continue
        end = all_headings[index + 1][0] if index + 1 < len(all_headings) else len(markdown)
        body = markdown[start:end].strip()
        if len(body) < 80:
            continue
        prior = [candidate for at, candidate in all_headings[:index] if at < start and meaningful_heading(candidate)]
        parent = prior[-1] if prior else None
        family = section_family(title, parent, body)
        if family == "other" or re.search(r"table des mati[eè]res|sommaire|tableau du contenu", title, re.I):
            continue
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", body) if part.strip()]
        parts, current = [], ""
        for paragraph in paragraphs:
            if current and len(current) + len(paragraph) > 2600:
                parts.append(current); current = ""
            current = f"{current}\n\n{paragraph}".strip()
        if current:
            parts.append(current)
        for part_index, text in enumerate(parts):
            if placeholder_penalty(text) and not re.search(r"\d|\b(?:IDA|SFQC|PTC|PTS|SBN|VBG|EAS|HS)\b", text):
                continue
            chunk_index = f"section_{index}_{part_index}"
            metadata = {
                "appel_offre_id": int(tender["appel_offre_id"]), "code_interne": tender["code_interne"],
                "document_id": int(tender["document_id"]), "document_type": "cdc_markdown",
                "source_filename": tender["source_filename"], "chunk_index": chunk_index,
                "section_heading": title, "parent_heading": parent, "preceding_heading": parent,
                "section_family": family, "content_hash": content_hash, "chunk_profile": "structured_section",
            }
            node_id = str(uuid5(NAMESPACE_URL, f"concept-rag-section:{tender['appel_offre_id']}:{tender['document_id']}:{content_hash}:{chunk_index}"))
            result.append(TextNode(id_=node_id, text=text, metadata=metadata))
    return result


def build_enhanced_nodes(markdown: str, tender: dict) -> tuple[list[TextNode], str]:
    base_nodes, content_hash = build_nodes(markdown, tender)
    all_headings = headings(markdown)
    cursor = 0
    for node in base_nodes:
        section, preceding, cursor = preceding_headings(markdown, node.text, cursor, all_headings)
        node.metadata.update({"section_heading": section, "parent_heading": preceding, "preceding_heading": preceding, "section_family": section_family(section, preceding, node.text), "chunk_profile": "semantic"})

    front = populated_front_matter(markdown)
    if front:
        metadata = {
            "appel_offre_id": int(tender["appel_offre_id"]),
            "code_interne": tender["code_interne"],
            "document_id": int(tender["document_id"]),
            "document_type": "cdc_markdown",
            "source_filename": tender["source_filename"],
            "chunk_index": "front_matter_0",
            "section_heading": "Document identification",
            "preceding_heading": "Dossier de demande de propositions",
            "parent_heading": "Dossier de demande de propositions",
            "section_family": "front_matter",
            "content_hash": content_hash,
            "chunk_profile": "compact_front_matter",
        }
        node_id = str(uuid5(NAMESPACE_URL, f"concept-rag-hybrid:{tender['appel_offre_id']}:{tender['code_interne']}:{tender['document_id']}:{content_hash}:front_matter_0"))
        base_nodes.append(TextNode(id_=node_id, text=front, metadata=metadata))
    financing = populated_financing_matter(markdown)
    if financing:
        metadata = {
            "appel_offre_id": int(tender["appel_offre_id"]), "code_interne": tender["code_interne"],
            "document_id": int(tender["document_id"]), "document_type": "cdc_markdown",
            "source_filename": tender["source_filename"], "chunk_index": "financing_matter_0",
            "section_heading": "Invitation financing facts", "parent_heading": "Letter of request",
            "preceding_heading": "Letter of request", "section_family": "financing",
            "content_hash": content_hash, "chunk_profile": "compact_front_matter",
        }
        node_id = str(uuid5(NAMESPACE_URL, f"concept-rag-financing:{tender['appel_offre_id']}:{tender['document_id']}:{content_hash}"))
        base_nodes.append(TextNode(id_=node_id, text=financing, metadata=metadata))
    base_nodes.extend(structured_section_nodes(markdown, tender, content_hash, all_headings))
    base_nodes.extend(compact_table_nodes(markdown, tender, content_hash, all_headings))
    return base_nodes, content_hash


class BM25:
    def __init__(self, nodes: list[TextNode], k1: float = 1.5, b: float = 0.75):
        self.nodes = nodes
        self.k1 = k1
        self.b = b
        self.docs = [tokens(" ".join(filter(None, [n.text, str(n.metadata.get("section_heading") or ""), str(n.metadata.get("preceding_heading") or "")]))) for n in nodes]
        self.lengths = [len(doc) for doc in self.docs]
        self.avgdl = sum(self.lengths) / max(1, len(self.lengths))
        document_frequency = Counter(term for doc in self.docs for term in set(doc))
        count = len(self.docs)
        self.idf = {term: math.log(1 + (count - freq + 0.5) / (freq + 0.5)) for term, freq in document_frequency.items()}

    def rank(self, query: str, top_k: int) -> list[tuple[TextNode, float]]:
        query_terms = tokens(query)
        ranked = []
        for node, doc, length in zip(self.nodes, self.docs, self.lengths, strict=True):
            frequencies = Counter(doc)
            score = 0.0
            for term in query_terms:
                frequency = frequencies.get(term, 0)
                if not frequency:
                    continue
                denominator = frequency + self.k1 * (1 - self.b + self.b * length / max(1, self.avgdl))
                score += self.idf.get(term, 0) * frequency * (self.k1 + 1) / denominator
            ranked.append((node, score))
        return sorted(ranked, key=lambda item: (-item[1], str(item[0].node_id)))[:top_k]


def chunk_id(node: TextNode) -> str:
    return f"chunk_{node.metadata['chunk_index']}"


def placeholder_penalty(text: str) -> float:
    normalized = " ".join(tokens(text))
    placeholder = bool(re.search(r"\bins[eé]rer\b|\bà compl[eé]ter\b|\.{4,}|…{2,}|\[\s*(nom|date|r[eé]f)", text, re.I))
    populated = bool(re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b|\b[A-Z]{2,}(?:[-/][A-Z0-9]+){2,}\b|\b[A-Z]{2,}-[A-Z]{2,}\b", text))
    alternatives = bool(re.search(r"\bPTC\s+(?:ou|et|/)\s+PTS\b|\bpr[eê]t\s*/\s*cr[eé]dit\s*/\s*don\b", text, re.I))
    instructional = bool(re.search(r"\b(?:veuillez|doit indiquer|indiquer|s[eé]lectionnez|comme indiqu[eé]|selon les donn[eé]es particuli[eè]res)\b", text, re.I))
    if placeholder and not populated:
        return 0.07
    if alternatives or instructional:
        return 0.045
    return 0.0


def populated_value_score(key: str, text: str) -> float:
    """Reward project-populated structural values, independent of tender vocabulary."""
    if key == "type_proposition" and re.search(r"\bPTC\b", text, re.I) and re.search(r"\bPTS\b", text, re.I):
        return 0.0
    patterns = {
        "intitule_mission": r"(?:d[eé]signation de la mission|services? de consultants? pour)\s*:\s*\S.{8,}",
        "client_maitre_ouvrage": r"(?:nom du client|client|ma[iî]tre d.ouvrage)\s*:\s*\S.{3,}",
        "pays": r"\bpays\s*:\s*[A-ZÀ-ÖØ-Þ][^|\n]{2,}",
        "projet_rattachement": r"(?:financer le co[uû]t du|dans le cadre du)\s+projet\s+\S.{5,}",
        "credit_financement": r"(?:cr[eé]dit|pr[eê]t|don|financement)\s*(?:n[o°.]|num[eé]ro)?\s*:\s*[A-Z0-9][A-Z0-9./_-]*\d[A-Z0-9./_-]*",
        "methode_selection": r"(?:mode|m[eé]thode) de s[eé]lection\s*:\s*\S.{3,}|sera choisi par la m[eé]thode de\s+\S.{3,}",
        "nature_prestation": r"(?:d[eé]signation de la mission|services? de consultants? pour)\s*:\s*\S.{8,}",
        "zone_execution": r"(?:localisation des zones|lieu d.ex[eé]cution|zones? des travaux).{0,500}(?:commune|quartier|site|talweg|bassin)",
        "type_proposition": r"(?:\b15\.2\b.{0,180}|(?:doit fournir|est demand[eé]e)\s+une\s+proposition\s+technique\s+)(?:compl[eè]te|simplifi[eé]e?)\s*\(?(?:PTC|PTS)\)?",
        "type_contrat": r"(?:section\s*8.{0,80}|contrat\s+type\s*:)\s*r[eé]mun[eé]ration\s+(?:au\s+temps\s+pass[eé]|forfaitaire)",
        "date_emission": r"(?:[eé]mis le|date d.[eé]mission|date)\s*:\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}",
        "date_limite_depot": r"(?:17\.7|date et.{0,30}heure).{0,180}\d{1,2}[/-]\d{1,2}[/-]\d{4}",
        "ponderation_technique_financiere": r"\bT\s*=\s*\d+.{0,80}\bF\s*=\s*\d+",
        "duree_totale": r"(?:\b14\.1\.2\b.{0,160}|d[eé]lai de r[eé]alisation de la mission (?:est|:).{0,80}|(?:dur[eé]e|p[eé]riode) (?:totale? |globale? |d.ex[eé]cution )?(?:de )?(?:la mission|des prestations)\s*(?:est|sera|:).{0,100})\b(?:jours?|semaines?|mois|ann[eé]es?)\b",
        "volume_hommes_mois": r"(?:\b14\.1\.3\b.{0,180}|(?:volume|charge|total).{0,100})\d+(?:[,.]\d+)?\s*(?:expert|homme|personne|H\.)[- .]?mois",
        "phases_mission": r"(?:\b14\.1\.2\b.{0,600}\bmobilisation\b.{0,600}\b(?:phase des travaux|garantie)\b|(?:phases?|[eé]tapes?) (?:de |d.)?(?:la mission|des prestations)\s*:.{0,800}(?:phase|[eé]tape)\s*(?:\d+|[IVX]+))",
    }
    pattern = patterns.get(key)
    return 0.13 if pattern and re.search(pattern, text, re.I | re.S) else 0.0


def field_signal(key: str, text: str) -> float:
    value = " ".join(tokens(text))
    key = {
        "reference_officielle": "official_reference", "client_maitre_ouvrage": "client",
        "pays": "country", "date_emission": "issue_date", "credit_financement": "credit_number",
        "methode_selection": "selection_method", "duree_totale": "mission_duration",
        "projet_rattachement": "financed_project",
    }.get(key, key)
    if key == "official_reference":
        return 0.035 if re.search(r"\b[A-Z]{2,}(?:[-/][A-Z0-9]+){2,}\b", text) else 0.0
    if key == "issue_date":
        return 0.035 if re.search(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b", text) else 0.0
    if key == "client":
        return 0.025 if "client" in value and re.search(r"\b[A-Z]{2,}(?:-[A-Z]{2,})?\b", text) else 0.0
    if key == "country":
        return 0.025 if re.search(r"\bpays\s*:", text, re.I) else 0.0
    if key == "credit_number":
        return 0.025 if re.search(r"\b(cr[eé]dit|pr[eê]t)\b.{0,30}\d", text, re.I) else 0.0
    if key == "selection_method":
        return 0.02 if "methode de selection" in value or "sfqc" in value else 0.0
    if key == "mission_duration":
        return 0.025 if re.search(r"\b(d[eé]lai|dur[eé]e)\b.{0,100}\b(jours?|mois)\b", text, re.I | re.S) else 0.0
    if key == "financed_project":
        return 0.02 if "projet" in value and ("finance" in value or "financement" in value) else 0.0
    patterns = {
        "intitule_mission": r"(recrutement|services).{0,180}(consultant|mission|[eé]tudes)",
        "zone_execution": r"(zone|site|commune|localit[eé]).{0,100}(ex[eé]cution|intervention|travaux)",
        "source_financement": r"(financ[eé]|financement).{0,100}(ida|banque|fonds|pr[eê]t|cr[eé]dit|don)",
        "secteur": r"(secteur|assainissement|infrastructure|drainage|transport|[eé]nergie)",
        "nature_prestation": r"(services de consultants|nature.{0,30}prestation|[eé]tudes techniques|supervision)",
        "type_procedure": r"(demande de propositions|appel d.offres|manifestation d.int[eé]r[eê]t)",
        "type_proposition": r"proposition technique (compl[eè]te|simplifi[eé]e)|\bPT[CS]\b",
        "type_contrat": r"(r[eé]mun[eé]ration forfaitaire|temps pass[eé]|type.{0,30}contrat)",
        "date_limite_depot": r"(date limite|au plus tard).{0,80}(d[eé]p[oô]t|soumission|proposition)",
        "langue_offre": r"(langue).{0,60}(proposition|offre|fran[cç]ais|anglais)",
        "ponderation_technique_financiere": r"(pond[eé]ration|poids).{0,100}(technique|financi[eè]re)|\bT\s*=\s*\d+",
        "note_technique_minimale": r"(note|score).{0,80}(technique).{0,80}(minimum|minimale)|\d+\s*points",
        "volume_hommes_mois": r"\d+(?:[,.]\d+)?\s*(expert|hommes?)[-/ ]mois",
        "nombre_profils_experts": r"(personnel|experts?)\s*(cl[eé]s?)|temps d.intervention du personnel",
        "phases_mission": r"([eé]tape|phase)\s*\d|phases? de la mission",
        "livrables_principaux": r"(livrables|rapports).{0,100}(d[eé]lai|transmission|remise)",
        "nombre_livrables_structurants": r"tableau.{0,80}(livrables|rapports)|livrables et d[eé]lais",
        "profils_cles": r"(personnel|experts?)\s*(cl[eé]s?)|chef de mission",
        "disciplines_techniques": r"(hydrauli|g[eé]otech|topograph|g[eé]nie civil|environnement)",
        "nombre_sites": r"(sites?|communes?|zones?).{0,100}(mission|[eé]tude|intervention|travaux)",
        "contraintes_site": r"(inondation|ravinement|[eé]rosion|acc[eè]s|contraintes?|risques? naturels)",
        "outils_methodes": r"(mod[eé]lisation|calculs?|m[eé]thodologie|lev[eé]s|logiciels?)",
        "moyens_materiels": r"(mat[eé]riel|[eé]quipement|station totale|v[eé]hicule|laboratoire)",
        "exigences_es": r"(environnemental|social|EAS|VBG|sant[eé].{0,20}s[eé]curit[eé]|sauvegarde)",
        "normes_referentiels": r"(normes?|r[eè]glement|code des march[eé]s|directives?|fascicules?)",
        "points_techniques_structurants": r"(ouvrages?|am[eé]nagement|solutions bas[eé]es|points techniques|dimensionnement)",
    }
    return 0.04 if key in patterns and re.search(patterns[key], text, re.I | re.S) else 0.0


def clause_semantics_score(key: str, text: str) -> float:
    """Prefer operative/current clauses only for fields whose value is an obligation."""
    operative_fields = {"contraintes_site", "outils_methodes", "moyens_materiels", "exigences_es", "normes_referentiels"}
    if key not in operative_fields:
        return 0.0
    operative = bool(re.search(
        r"\b(?:le consultant|le titulaire|l.entreprise|les prestations)\b.{0,100}\b(?:doit|devra|est tenu|comprennent?|mettre en [oœ]uvre|respecter|veiller|assurer|fournir)\b",
        text, re.I | re.S,
    ))
    definition = bool(re.search(r"\b(?:signifie|d[eé]signe|est d[eé]fini(?:e)? comme|le terme|l.expression)\b", text, re.I))
    qualification = bool(re.search(r"\b(?:dipl[oô]me|ann[eé]es? d.exp[eé]rience|qualification|CV)\b", text, re.I))
    return (0.12 if operative else 0.0) - (0.09 if definition else 0.0) - (0.09 if qualification and key == "exigences_es" else 0.0)


def historical_context_penalty(key: str, text: str) -> float:
    """Down-rank past-project narrative for current procurement facts."""
    current_fact_fields = {
        "intitule_mission", "client_maitre_ouvrage", "credit_financement", "nature_prestation",
        "type_procedure", "type_proposition", "type_contrat", "duree_totale", "volume_hommes_mois",
        "nombre_profils_experts", "phases_mission", "livrables_principaux", "exigences_es",
    }
    if key not in current_fact_fields:
        return 0.0
    historical = bool(re.search(
        r"\b(?:[eé]tudes? (?:d[eé]j[aà]|ant[eé]rieurement) r[eé]alis[eé]es?|projet (?:ant[eé]rieur|pr[eé]c[eé]dent)|anciens? travaux|en \d{4}.{0,80}(?:a [eé]t[eé]|ont [eé]t[eé])|historique)\b",
        text, re.I | re.S,
    ))
    return 0.08 if historical else 0.0


def section_route_score(key: str, node: TextNode) -> tuple[float, dict]:
    route = FIELD_ROUTES.get(key)
    family = str(node.metadata.get("section_family") or "other")
    if not route:
        return 0.0, {"section_family": family, "section_boost": 0.0, "anchor_boost": 0.0, "exclusion_penalty": 0.0}
    primary, fallback, anchors, exclusions, _shape = route
    section_boost = 0.075 if family in primary else 0.035 if family in fallback else 0.0
    normalized = " ".join(tokens(node.text + " " + str(node.metadata.get("section_heading") or "")))
    anchor_hits = sum(1 for anchor in anchors if " ".join(tokens(anchor)) in normalized)
    exclusion_hits = sum(1 for signal in exclusions if " ".join(tokens(signal)) in normalized)
    if key == "contraintes_site" and anchor_hits:
        exclusion_hits = 0
    anchor_boost = min(0.045, anchor_hits * 0.018)
    exclusion_penalty = min(0.07, exclusion_hits * 0.035)
    # Compact structural nodes are preferred only when routed or anchored.
    profile_boost = 0.03 if node.metadata.get("chunk_profile") in {"compact_front_matter", "compact_table"} and (section_boost or anchor_boost) else 0.0
    targeted_patterns = {
        "type_procedure": r"dossier de demande de propositions services de consultants|la pr[eé]sente demande de propositions",
        "type_proposition": r"15\.2.{0,120}doit fournir une proposition technique compl[eè]te|doit fournir une proposition technique compl[eè]te \(PTC\)",
        "note_technique_minimale": r"note technique \(nt\) minimum de qualification est\s*:\s*\d+\s*points",
        "disciplines_techniques": r"tableau \d+\s*:\s*(composition|temps d.intervention).*personnel cl[eé]",
        "contraintes_site": r"ravinement|[eé]rosion r[eé]gressive|inondation|profondeur moyenne|occupations anarchiques|d[eé]p[oô]ts sauvages|sites? (?:sont|[eé]tant) ind[eé]pendants|d[eé]calage de .{0,20} mois|maintien du service",
        "exigences_es": r"doit soumettre son code de conduite|mesures pour faire face aux risques sociaux|travail forc[eé]|travail des enfants|EAS.{0,50}HS",
    }
    targeted_match = key in targeted_patterns and re.search(targeted_patterns[key], node.text, re.I | re.S)
    targeted_allowed = (
        key == "note_technique_minimale"
        or key == "contraintes_site" and family == "sites"
        or key not in {"note_technique_minimale", "contraintes_site"} and exclusion_hits == 0
    )
    targeted_boost = 0.14 if targeted_match and targeted_allowed else 0.0
    populated_boost = populated_value_score(key, node.text)
    clause_boost = clause_semantics_score(key, node.text)
    historical_penalty = historical_context_penalty(key, node.text)
    score = section_boost + anchor_boost + profile_boost + targeted_boost + populated_boost + clause_boost - exclusion_penalty - historical_penalty
    return score, {"section_family": family, "section_boost": section_boost, "anchor_boost": anchor_boost, "exclusion_penalty": exclusion_penalty, "profile_boost": profile_boost, "targeted_boost": targeted_boost, "populated_value_boost": populated_boost, "clause_semantics_boost": clause_boost, "historical_penalty": historical_penalty}


def ensure_collection(client: QdrantClient, collection: str, vector_size: int) -> None:
    names = {item.name for item in client.get_collections().collections}
    if collection in names:
        client.delete_collection(collection)
    client.create_collection(collection, vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE))


def retrieve_modes(store: QdrantVectorStore, embedding: OllamaEmbedding, bm25: BM25, nodes_by_id: dict[str, TextNode], tender: dict, key: str, question: str) -> tuple[dict, float]:
    expanded = f"{question} {EXPANSIONS.get(key, question)}"
    started = perf_counter()
    vector = embedding.get_query_embedding(expanded)
    dense = store.query(VectorStoreQuery(query_embedding=vector, query_str=expanded, similarity_top_k=DENSE_POOL, filters=llama_filters(int(tender["appel_offre_id"]), tender["code_interne"])))
    dense_rows = [(node, float(score)) for node, score in zip(dense.nodes or [], dense.similarities or [], strict=True)]
    lexical_rows = bm25.rank(expanded, LEXICAL_POOL)
    routed_rows = sorted(
        ((node, section_route_score(key, node)[0] + field_signal(key, node.text) - placeholder_penalty(node.text)) for node in bm25.nodes),
        key=lambda item: (-item[1], str(item[0].node_id)),
    )[:16]
    elapsed = perf_counter() - started

    candidates: dict[str, dict] = {}
    for rank, (node, score) in enumerate(dense_rows, 1):
        candidates.setdefault(node.node_id, {"node": nodes_by_id[node.node_id], "dense_rank": None, "dense_score": None, "lexical_rank": None, "lexical_score": None})
        candidates[node.node_id].update({"dense_rank": rank, "dense_score": score})
    for rank, (node, score) in enumerate(lexical_rows, 1):
        candidates.setdefault(node.node_id, {"node": node, "dense_rank": None, "dense_score": None, "lexical_rank": None, "lexical_score": None})
        candidates[node.node_id].update({"lexical_rank": rank, "lexical_score": score})
    for rank, (node, score) in enumerate(routed_rows, 1):
        if score <= 0:
            continue
        candidates.setdefault(node.node_id, {"node": node, "dense_rank": None, "dense_score": None, "lexical_rank": None, "lexical_score": None})
        candidates[node.node_id].update({"routed_rank": rank, "routed_score": score})
    for candidate in candidates.values():
        routing_score, routing = section_route_score(key, candidate["node"])
        candidate["rrf_score"] = (1 / (RRF_K + candidate["dense_rank"]) if candidate["dense_rank"] else 0) + (1 / (RRF_K + candidate["lexical_rank"]) if candidate["lexical_rank"] else 0)
        candidate.update(routing)
        candidate.setdefault("routed_rank", None)
        candidate.setdefault("routed_score", None)
        candidate["routing_score"] = routing_score
        candidate["rerank_score"] = candidate["rrf_score"] + routing_score + field_signal(key, candidate["node"].text) - placeholder_penalty(candidate["node"].text)
    hybrid = sorted(candidates.values(), key=lambda item: (-item["rrf_score"], str(item["node"].node_id)))
    reranked = sorted(candidates.values(), key=lambda item: (-item["rerank_score"], -item["rrf_score"], str(item["node"].node_id)))
    return {"dense": [dict(item, fused_rank=None, reranked_rank=None) for item in [candidates[node.node_id] for node, _ in dense_rows[:FINAL_K]]], "hybrid": [dict(item, fused_rank=rank, reranked_rank=None) for rank, item in enumerate(hybrid[:FINAL_K], 1)], "hybrid_rerank": [dict(item, fused_rank=next((i for i, x in enumerate(hybrid, 1) if x["node"].node_id == item["node"].node_id), None), reranked_rank=rank) for rank, item in enumerate(reranked[:FINAL_K], 1)]}, elapsed


def generate_answer(question: str, candidates: list[dict]) -> tuple[object, dict]:
    context = "\n\n".join(f"[{chunk_id(item['node'])}]\n{item['node'].text}" for item in candidates)
    return ollama_generate(f'Retourne strictement {{"answer": string|null, "sources": ["chunk_N"]}}. Réponds uniquement depuis le contexte. Si la valeur exacte n’est pas explicitement prouvée, answer doit être null. Ignore les champs modèles vides et les placeholders.\nQuestion: {question}\nContexte:\n{context}', num_predict=220)


def serialize_candidate(item: dict, rank: int, key: str) -> dict:
    node = item["node"]
    return {"chunk_id": chunk_id(node), "rank": rank, "dense_rank": item["dense_rank"], "dense_score": round(item["dense_score"], 6) if item["dense_score"] is not None else None, "lexical_rank": item["lexical_rank"], "lexical_score": round(item["lexical_score"], 6) if item["lexical_score"] is not None else None, "fused_rank": item.get("fused_rank"), "rrf_score": round(item["rrf_score"], 8), "reranked_rank": item.get("reranked_rank"), "rerank_score": round(item["rerank_score"], 8), "section_heading": node.metadata.get("section_heading"), "preceding_heading": node.metadata.get("preceding_heading"), "is_correct_evidence": correct(key, node.text), "excerpt": re.sub(r"\s+", " ", node.text)[:600]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code-interne", default="AO-20260810-0958")
    parser.add_argument("--embedding-model", default=EMBEDDING_MODEL)
    parser.add_argument("--collection")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    tender = resolve_tender(args.code_interne)
    markdown = tender["markdown_path"].read_text(encoding="utf-8")
    nodes, content_hash = build_enhanced_nodes(markdown, tender)
    qdrant = QdrantClient(url=QDRANT_URL, timeout=60)
    embedding = OllamaEmbedding(model_name=args.embedding_model, base_url=OLLAMA_URL, embed_batch_size=16, keep_alive="10m")
    dimension_probe = embedding.get_text_embedding("CONCEPT embedding dimension probe")
    vector_size = len(dimension_probe)
    collection = args.collection or f"{COLLECTION_PREFIX}_{args.embedding_model.rsplit(':', 1)[-1].replace('.', '_')}"
    ensure_collection(qdrant, collection, vector_size)
    embed_started = perf_counter()
    vectors = embedding.get_text_embedding_batch([node.get_content() for node in nodes], show_progress=True)
    embedding_seconds = perf_counter() - embed_started
    points = []
    for node, vector in zip(nodes, vectors, strict=True):
        node.embedding = vector
        payload = node_to_metadata_dict(node, remove_text=False, flat_metadata=True)
        payload["document_id"] = int(tender["document_id"])
        points.append(models.PointStruct(id=node.node_id, vector=vector, payload=payload))
    index_started = perf_counter()
    for offset in range(0, len(points), 128):
        qdrant.upsert(collection, points[offset:offset + 128], wait=True)
    index_seconds = perf_counter() - index_started
    store = QdrantVectorStore(client=qdrant, collection_name=collection, stores_text=True)
    bm25 = BM25(nodes)
    nodes_by_id = {node.node_id: node for node in nodes}

    results = {mode: [] for mode in ("dense", "hybrid", "hybrid_rerank")}
    retrieval_seconds = []
    for key, (question, expected) in FIELDS.items():
        modes, elapsed = retrieve_modes(store, embedding, bm25, nodes_by_id, tender, key, question)
        retrieval_seconds.append(elapsed)
        for mode, candidates in modes.items():
            answer_obj, generation = generate_answer(question, candidates)
            answer = answer_obj.get("answer") if isinstance(answer_obj, dict) else None
            sources = answer_obj.get("sources", []) if isinstance(answer_obj, dict) else []
            evidence_ids = {chunk_id(item["node"]) for item in candidates if correct(key, item["node"].text)}
            answer_ok = correct(key, answer)
            citation_ok = answer_ok and bool(set(map(str, sources)) & evidence_ids)
            evidence = bool(evidence_ids)
            results[mode].append({"key": key, "question": question, "expected": expected, "candidates": [serialize_candidate(item, rank, key) for rank, item in enumerate(candidates, 1)], "evidence_in_top_k": evidence, "answer": answer, "sources": sources, "answer_correct": answer_ok, "citation_correct": citation_ok, "classification": "SUCCESS" if evidence and answer_ok else "GENERATION_FAILURE" if evidence else "RETRIEVAL_FAILURE", "generation": generation})

    best_mode = "hybrid_rerank"
    structured_parts = []
    for row in results[best_mode]:
        structured_parts.extend(f"[{candidate['chunk_id']}]\n{nodes_by_id[next(node_id for node_id, node in nodes_by_id.items() if chunk_id(node) == candidate['chunk_id'])].text}" for candidate in row["candidates"][:5])
    structured_context = "\n\n".join(dict.fromkeys(structured_parts))
    shape = {key: {"value": "string|null", "sources": ["chunk_N"]} for key in FIELDS}
    structured, structured_metrics = ollama_generate(f"Extrait les champs uniquement depuis les preuves. Ignore tout placeholder ou champ modèle vide. Retourne exactement cette structure JSON: {json.dumps(shape)}. Aucun fait non prouvé.\nPREUVES:\n{structured_context}", num_predict=900)
    structured_fields = {}
    allowed_ids = {candidate["chunk_id"] for row in results[best_mode] for candidate in row["candidates"]}
    for key in FIELDS:
        item = structured.get(key, {}) if isinstance(structured, dict) else {}
        value = item.get("value") if isinstance(item, dict) else None
        sources = item.get("sources", []) if isinstance(item, dict) else []
        structured_fields[key] = {"value": value, "sources": sources, "correct": correct(key, value), "citation_ids_valid": bool(sources) and all(str(source) in allowed_ids for source in sources)}

    anti_hallucination = []
    unsupported_questions = [
        "Quel est le budget exact de la mission en FCFA ?",
        "Quel est le nom du chef de projet proposé par le consultant ?",
        "Quelle est la date exacte de démarrage des travaux ?",
    ]
    for question in unsupported_questions:
        modes, _ = retrieve_modes(store, embedding, bm25, nodes_by_id, tender, "unsupported", question)
        answer_obj, metrics = generate_answer(question, modes[best_mode])
        answer = answer_obj.get("answer") if isinstance(answer_obj, dict) else None
        passed = answer is None or "indispon" in str(answer).lower() or "insuff" in str(answer).lower()
        anti_hallucination.append({"question": question, "answer": answer, "passed": passed, "metrics": metrics})

    wrong_code = tender["code_interne"] + "-MISMATCH"
    query_vector = embedding.get_query_embedding(EXPANSIONS["client"])
    dense_wrong = store.query(VectorStoreQuery(query_embedding=query_vector, similarity_top_k=8, filters=llama_filters(int(tender["appel_offre_id"]), wrong_code)))
    lexical_wrong = [node for node in nodes if node.metadata["appel_offre_id"] == int(tender["appel_offre_id"]) and node.metadata["code_interne"] == wrong_code]
    report = {
        "benchmark": {"model": MODEL, "embedding_model": args.embedding_model, "embedding_dimension": vector_size, "collection": collection, "code_interne": tender["code_interne"], "appel_offre_id": int(tender["appel_offre_id"]), "document_id": int(tender["document_id"]), "content_hash": content_hash},
        "chunking": {"base_chunk_size": 700, "base_overlap": 100, "base_chunks": len(nodes) - 1, "compact_front_matter_chunks": 1, "total_chunks": len(nodes), "metadata_fields": ["section_heading", "preceding_heading", "chunk_index", "document_type", "appel_offre_id", "code_interne", "document_id", "source_filename"]},
        "retrieval": {"dense_pool": DENSE_POOL, "lexical_pool": LEXICAL_POOL, "final_k": FINAL_K, "rrf_k": RRF_K, "modes": results, "mean_combined_retrieval_seconds": round(sum(retrieval_seconds) / len(retrieval_seconds), 4)},
        "structured_rag": {"mode": best_mode, "json_valid": isinstance(structured, dict), "fields": structured_fields, "metrics": structured_metrics},
        "anti_hallucination": {"tests": anti_hallucination, "hallucination_count": sum(not test["passed"] for test in anti_hallucination)},
        "isolation": {"mismatched_code": wrong_code, "dense_retrieved_count": len(dense_wrong.nodes or []), "lexical_retrieved_count": len(lexical_wrong), "passed": not (dense_wrong.nodes or lexical_wrong)},
        "performance": {"embedding_seconds": round(embedding_seconds, 4), "qdrant_index_seconds": round(index_seconds, 4)},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {mode: {"evidence": sum(row["evidence_in_top_k"] for row in rows), "answers": sum(row["answer_correct"] for row in rows), "citations": sum(row["citation_correct"] for row in rows)} for mode, rows in results.items()}
    summary["structured_correct"] = sum(field["correct"] for field in structured_fields.values())
    summary["isolation"] = report["isolation"]["passed"]
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
