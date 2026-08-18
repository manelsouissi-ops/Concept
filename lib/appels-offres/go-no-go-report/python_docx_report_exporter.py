from __future__ import annotations

import json
import sys
import tempfile
import zipfile
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
ET.register_namespace("w", W_NS)


def text(node: ET.Element) -> str:
    return "".join(item.text or "" for item in node.iter(W + "t"))


def normalized(value: str) -> str:
    return " ".join(value.replace("\u00a0", " ").split()).casefold()


def add_run(paragraph: ET.Element, value: str, *, bold: bool = False) -> None:
    if not value:
        return
    run = ET.SubElement(paragraph, W + "r")
    if bold:
        props = ET.SubElement(run, W + "rPr")
        ET.SubElement(props, W + "b")
    value_node = ET.SubElement(run, W + "t")
    value_node.set(XML_SPACE, "preserve")
    value_node.text = value


def replace_paragraph(paragraph: ET.Element, value: str) -> None:
    props = paragraph.find(W + "pPr")
    for child in list(paragraph):
        if child is not props:
            paragraph.remove(child)
    add_run(paragraph, value)


def append_at_anchor(root: ET.Element, anchor: str, value: str) -> bool:
    if not value:
        return False
    for paragraph in root.iter(W + "p"):
        if normalized(anchor) in normalized(text(paragraph)):
            add_run(paragraph, f" {value}")
            return True
    return False


def append_at_anchor_occurrence(root: ET.Element, anchor: str, value: str, occurrence: int) -> bool:
    matches = [paragraph for paragraph in root.iter(W + "p") if normalized(anchor) in normalized(text(paragraph))]
    if value and len(matches) >= occurrence:
        add_run(matches[occurrence - 1], f" {value}")
        return True
    return False


def replace_at_anchor(root: ET.Element, anchor: str, value: str) -> bool:
    for paragraph in root.iter(W + "p"):
        if normalized(anchor) in normalized(text(paragraph)):
            replace_paragraph(paragraph, value)
            return True
    return False


def cell_set(cell: ET.Element, value: str) -> None:
    tc_props = cell.find(W + "tcPr")
    first_p = cell.find(W + "p")
    p_props = deepcopy(first_p.find(W + "pPr")) if first_p is not None and first_p.find(W + "pPr") is not None else None
    for child in list(cell):
        if child is not tc_props:
            cell.remove(child)
    paragraph = ET.SubElement(cell, W + "p")
    if p_props is not None:
        paragraph.append(p_props)
    add_run(paragraph, value)


def table_by_header(root: ET.Element, header: str) -> ET.Element | None:
    candidates = [table for table in root.iter(W + "tbl") if header in text(table)]
    # A number of FOR-COM-02 grids are nested in a larger one-cell section
    # table. The shortest matching table is the actual data grid.
    return min(candidates, key=lambda table: len(text(table))) if candidates else None


def fill_rows(root: ET.Element, header: str, start: int, capacity: int, rows: list[list[str]]) -> None:
    table = table_by_header(root, header)
    if table is None:
        return
    table_rows = table.findall(W + "tr")
    template_row = table_rows[start] if len(table_rows) > start else None
    for index, values in enumerate(rows):
        target_index = start + index
        if target_index >= start + capacity and template_row is not None:
            new_row = deepcopy(template_row)
            table.append(new_row)
            table_rows.append(new_row)
        if target_index >= len(table_rows):
            break
        cells = table_rows[target_index].findall(W + "tc")
        for column, value in enumerate(values[: len(cells)]):
            cell_set(cells[column], value)


def check_decision_box(root: ET.Element, label: str, checked: bool) -> None:
    for paragraph in root.findall(".//" + W + "body/" + W + "p"):
        label_text = text(paragraph)
        if label == "GO" and "VALIDATION:" not in label_text:
            continue
        if label == "GO AVEC RESERVES" and label not in label_text:
            continue
        if label == "NOGO" and label not in label_text:
            continue
        if label == "GO" or label in label_text:
            for box in paragraph.iter(W + "txbxContent"):
                box_paragraph = box.find(W + "p")
                if box_paragraph is not None:
                    replace_paragraph(box_paragraph, "X" if checked else "")
            return


def render(template_path: Path, output_path: Path, mapping: dict) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="concept-for-com-02-") as directory:
        package = Path(directory)
        with zipfile.ZipFile(template_path) as source:
            source.extractall(package)

        document_path = package / "word" / "document.xml"
        tree = ET.parse(document_path)
        root = tree.getroot()
        fields = mapping.get("fields", {})

        replace_at_anchor(root, "CODE OFFRE", f"CODE OFFRE : {fields.get('code', '')}    TYPE D’OFFRE : {fields.get('offerType', '')}")
        replace_at_anchor(root, "INTITULE OFFRE", f"INTITULE OFFRE : {fields.get('title', '')}")
        replace_at_anchor(root, "METHODE SELECTION", f"METHODE SELECTION : {fields.get('selectionMethod', '')}")

        anchors = {
            "Durée :": "duration",
            "Prestations à Fournir": "services",
            "Les composantes du projet": "components",
            "RISQUES MAJEURS DU PROJET": "majorRisks",
            "PLAN CORRECTION RISQUES": "riskCorrectionPlan",
            "CLIENT": "client",
            "FINANCEMENT": "financing",
            "PARTENAIRES": "partners",
            "DATE DE REMISE DE L’OFFRE": "submissionDate",
            "DATE LIMITE POUR L’ENVOI": "clarificationDeadline",
            "CONFERENCE PREPARATOIRE": "preparatoryConference",
            "BUDGET (Si information disponible)": "budget",
            "OFFRES SIMILAIRES": "similarOffers",
            "MONTAGE DE L’OFFRE": "offerStructure",
            "DUREE TOTALE DU PROJET": "totalDuration",
            "VOLUME PRESTATIONS PROPOSE PAR CONCEPT": "conceptServiceVolume",
            "VOLUME PRESTATION CLIENT": "clientServiceVolume",
            "CHARGE DE L’OFFRE": "offerWorkload",
            "RESPONSABLE TECHNIQUE DE L’OFFRE": "technicalLead",
            "TEMPS NECESSAIRE POUR PREPARATION OFFRE": "preparationTime",
            "VISITE SUR SITE NECESSAIRE": "siteVisit",
            "MAITRISE TECHNIQUE": "technicalMastery",
            "EXIGENCES CLIENTS": "clientRequirements",
            "DATE DU TAUX DE CHANGE": "exchangeRate",
            "COEFFICIENT CHARGES DE STRUCTURE": "structureCoefficient",
            "MODALITES DE PAIEMENT": "paymentTerms",
            "AVANCE": "advance",
            "IMMATRICULATION FISCALE": "taxRegistration",
            "ENREGISTREMENT DU CONTRAT": "contractRegistration",
            "ASSURANCES": "insurance",
        }
        for anchor, key in anchors.items():
            append_at_anchor(root, anchor, fields.get(key, ""))
        append_at_anchor_occurrence(root, "COMMENTAIRES/AVIS MOTIVE", fields.get("operationsComments", ""), 2)

        swot = table_by_header(root, "FORCES")
        if swot is not None:
            swot_values = [[fields.get("strengths", ""), fields.get("weaknesses", "")], [fields.get("opportunities", ""), fields.get("threats", "")]]
            for row, values in zip(swot.findall(W + "tr"), swot_values):
                for cell, value in zip(row.findall(W + "tc"), values):
                    if value:
                        paragraph = cell.find(W + "p")
                        if paragraph is not None:
                            add_run(paragraph, "\n" + value)

        blank_tables = [table for table in root.iter(W + "tbl") if not text(table).strip()]
        comments = [fields.get("commercialComments", "")]
        for table, value in zip(blank_tables, comments):
            first_cell = table.find(".//" + W + "tc")
            if first_cell is not None:
                cell_set(first_cell, value)

        tables = mapping.get("tables", {})
        fill_rows(root, "Concurrent", 1, 7, tables.get("competitors", []))
        fill_rows(root, "TYPEQUANTITE", 1, 3, tables.get("equipment", []))
        fill_rows(root, "PERSONNEL CLE", 2, 11, tables.get("keyPersonnel", []))
        fill_rows(root, "PERSONNEL D’‘APPUI", 14, 3, tables.get("supportPersonnel", []))
        fill_rows(root, "N°Désignation", 1, 2, tables.get("financialResources", []))

        dg_text = "\n".join(filter(None, [
            fields.get("dgContribution", ""),
            fields.get("decisionRationale", ""),
            fields.get("decisionReserves", ""),
        ]))
        append_at_anchor(root, "DIRECTION GENERALE", dg_text)
        identity = " — ".join(filter(None, [fields.get("decidedBy", ""), fields.get("decidedAt", "")]))
        if identity:
            append_at_anchor(root, "DIRECTION GENERALE", f"Décision prise par : {identity}")

        decision = mapping.get("decision", {})
        check_decision_box(root, "GO", bool(decision.get("go")))
        check_decision_box(root, "GO AVEC RESERVES", bool(decision.get("goWithReserves")))
        check_decision_box(root, "NOGO", bool(decision.get("noGo")))

        tree.write(document_path, encoding="utf-8", xml_declaration=True)
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as target:
            for item in package.rglob("*"):
                if item.is_file():
                    target.write(item, item.relative_to(package).as_posix())


def generic_render(output_path: Path, payload: dict) -> None:
    """Temporary compatibility fallback for deployments missing the master."""
    paragraphs = []
    for line in [payload.get("title", "CONCEPT - Rapport Go/No-Go"), *payload.get("lines", [])]:
        paragraphs.append(f'<w:p><w:r><w:t xml:space="preserve">{escape(str(line))}</w:t></w:r></w:p>')
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}"><w:body>{"".join(paragraphs)}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as target:
        target.writestr("[Content_Types].xml", content_types)
        target.writestr("_rels/.rels", root_rels)
        target.writestr("word/document.xml", document)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python_docx_report_exporter.py <instruction-json>")
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if payload.get("templatePath") and payload.get("mapping"):
        render(Path(payload["templatePath"]), Path(payload["outputPath"]), payload["mapping"])
        return 0
    generic_render(Path(payload["outputPath"]), payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
