from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape


CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"""


def paragraph(text: str, heading: bool = False) -> str:
    safe = escape(text or "")
    if heading:
        return (
            "<w:p>"
            "<w:pPr><w:pStyle w:val=\"Heading1\" xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/></w:pPr>"
            f"<w:r><w:t>{safe}</w:t></w:r>"
            "</w:p>"
        )
    return f"<w:p><w:r><w:t xml:space=\"preserve\">{safe}</w:t></w:r></w:p>"


def build_document(payload: dict) -> str:
    lines: list[str] = []
    lines.append(paragraph(payload.get("title", "CONCEPT - Rapport Go/No-Go"), heading=True))
    header_lines = [
        f"Dossier: {payload.get('dossierCode', '')}",
        f"Titre: {payload.get('dossierTitle', '')}",
        f"Version rapport: {payload.get('reportVersion', '')}",
        f"Statut rapport: {payload.get('reportStatus', '')}",
        f"Prepare le: {payload.get('preparedAt', 'Information non disponible')}",
        f"Soumis le: {payload.get('submittedAt', 'Information non disponible')}",
    ]
    for header_line in header_lines:
        lines.append(paragraph(header_line))

    for section in payload.get("sections", []):
        lines.append(paragraph(section.get("heading", "Section"), heading=True))
        for chunk in str(section.get("content", "Information non disponible")).splitlines():
            lines.append(paragraph(chunk or " "))

    body = "".join(lines)
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" "
        "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" "
        "xmlns:o=\"urn:schemas-microsoft-com:office:office\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
        "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" "
        "xmlns:v=\"urn:schemas-microsoft-com:vml\" "
        "xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" "
        "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" "
        "xmlns:w10=\"urn:schemas-microsoft-com:office:word\" "
        "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
        "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" "
        "xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" "
        "xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" "
        "xmlns:wne=\"http://schemas.microsoft.com/office/2006/wordml\" "
        "xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" "
        "mc:Ignorable=\"w14 wp14\">"
        f"<w:body>{body}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr></w:body>"
        "</w:document>"
    )


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python_docx_report_exporter.py <instruction-json>")

    instruction_path = Path(sys.argv[1])
    payload = json.loads(instruction_path.read_text(encoding="utf-8"))
    output_path = Path(payload["outputPath"])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    document_xml = build_document(payload)

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", CONTENT_TYPES)
        docx.writestr("_rels/.rels", ROOT_RELS)
        docx.writestr("word/_rels/document.xml.rels", DOC_RELS)
        docx.writestr("word/document.xml", document_xml)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
