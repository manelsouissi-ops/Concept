from __future__ import annotations

import copy
import json
import sys
import zipfile
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
XML_NS = "http://www.w3.org/XML/1998/namespace"
NS = {"w": W_NS}

ET.register_namespace("w", W_NS)


def normalize_text(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split()).strip()


def iter_paragraph_texts(parent: ET.Element) -> Iterable[str]:
    for paragraph in parent.findall("./w:p", NS):
        texts = [node.text or "" for node in paragraph.findall(".//w:t", NS)]
        joined = "".join(texts).strip()
        if joined:
            yield joined


def get_cell_text(cell: ET.Element) -> str:
    parts = list(iter_paragraph_texts(cell))
    return normalize_text(" ".join(parts))


def ensure_text_preserve(element: ET.Element) -> None:
    if element.text and (element.text.startswith(" ") or element.text.endswith(" ")):
        element.set(f"{{{XML_NS}}}space", "preserve")


def build_text_run(text: str) -> ET.Element:
    run = ET.Element(f"{{{W_NS}}}r")
    text_node = ET.SubElement(run, f"{{{W_NS}}}t")
    text_node.text = text
    ensure_text_preserve(text_node)
    return run


def clone_paragraph_with_text(paragraph: ET.Element, text: str) -> ET.Element:
    cloned = copy.deepcopy(paragraph)
    for run in list(cloned.findall("./w:r", NS)):
        cloned.remove(run)
    cloned.append(build_text_run(text))
    return cloned


def set_cell_value(cell: ET.Element, value: str) -> None:
    paragraphs = cell.findall("./w:p", NS)
    template_paragraph = paragraphs[0] if paragraphs else ET.Element(f"{{{W_NS}}}p")
    for paragraph in paragraphs:
        cell.remove(paragraph)

    lines = value.splitlines() or [value]
    for line in lines:
        cell.append(clone_paragraph_with_text(template_paragraph, line))


def find_row_by_label(root: ET.Element, label: str) -> tuple[ET.Element, ET.Element] | None:
    normalized_label = normalize_text(label)
    for table in root.findall(".//w:tbl", NS):
        for row in table.findall("./w:tr", NS):
            cells = row.findall("./w:tc", NS)
            if len(cells) < 2:
                continue
            if get_cell_text(cells[0]) == normalized_label:
                return row, cells[1]
    return None


def row_matches_header(row: ET.Element, header: list[str]) -> bool:
    cells = row.findall("./w:tc", NS)
    if len(cells) < len(header):
        return False
    row_values = [get_cell_text(cell) for cell in cells[: len(header)]]
    return row_values == [normalize_text(item) for item in header]


def fill_repeatable_table(root: ET.Element, table_instruction: dict) -> None:
    header = table_instruction["header"]
    rows = table_instruction["rows"]
    empty_placeholder = table_instruction.get("emptyPlaceholder", "Non renseigné")

    for table in root.findall(".//w:tbl", NS):
      table_rows = table.findall("./w:tr", NS)
      header_index = next(
          (index for index, row in enumerate(table_rows) if row_matches_header(row, header)),
          None
      )
      if header_index is None:
          continue

      data_rows = table_rows[header_index + 1 :]
      if not data_rows:
          raise RuntimeError(
              f"Aucune ligne de données trouvée après l'en-tête {header!r}."
          )

      template_row = data_rows[0]
      target_rows = rows or [[empty_placeholder] + [""] * (len(header) - 1)]

      while len(data_rows) < len(target_rows):
          cloned = copy.deepcopy(template_row)
          table.append(cloned)
          data_rows.append(cloned)

      while len(data_rows) > len(target_rows):
          row_to_remove = data_rows.pop()
          table.remove(row_to_remove)

      for row_element, values in zip(data_rows, target_rows, strict=True):
          cells = row_element.findall("./w:tc", NS)
          if len(cells) < len(header):
              raise RuntimeError(
                  f"La ligne de données du tableau {table_instruction['key']!r} ne contient pas assez de cellules."
              )
          for cell, value in zip(cells[: len(header)], values, strict=True):
              set_cell_value(cell, value)
      return

    raise RuntimeError(
        f"Tableau répétable introuvable pour l'en-tête {header!r}."
    )


def add_header_suffix(xml_bytes: bytes, suffix: str | None) -> bytes:
    if not suffix:
        return xml_bytes

    root = ET.fromstring(xml_bytes)
    paragraphs = root.findall(".//w:p", NS)
    for paragraph in paragraphs:
        texts = [node.text or "" for node in paragraph.findall(".//w:t", NS)]
        current = "".join(texts).strip()
        if not current:
            continue
        new_text = f"{current} — {suffix}"
        for run in list(paragraph.findall("./w:r", NS)):
            paragraph.remove(run)
        paragraph.append(build_text_run(new_text))
        return ET.tostring(root, encoding="utf-8", xml_declaration=True)

    return xml_bytes


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python_docx_exporter.py <instruction-json>")

    instruction_path = Path(sys.argv[1])
    instruction = json.loads(instruction_path.read_text(encoding="utf-8"))
    template_path = Path(instruction["templatePath"])
    output_path = Path(instruction["outputPath"])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(template_path, "r") as source_zip:
        document_root = ET.fromstring(source_zip.read("word/document.xml"))

        for replacement in instruction["singleValueRows"]:
            found = find_row_by_label(document_root, replacement["label"])
            if not found:
                raise RuntimeError(
                    f"Ligne introuvable dans le template: {replacement['label']}"
                )
            _, value_cell = found
            set_cell_value(value_cell, replacement["value"])

        for repeatable_table in instruction["repeatableTables"]:
            fill_repeatable_table(document_root, repeatable_table)

        with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as output_zip:
            for info in source_zip.infolist():
                data = source_zip.read(info.filename)
                if info.filename == "word/document.xml":
                    data = ET.tostring(
                        document_root, encoding="utf-8", xml_declaration=True
                    )
                elif info.filename.startswith("word/header"):
                    data = add_header_suffix(data, instruction.get("headerSuffix"))
                output_zip.writestr(info, data)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
