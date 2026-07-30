import type { FciExportFormat, FciExportSource } from "./types.ts";

function sanitizeSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function formatDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildFciExportFileName(
  source: FciExportSource,
  format: FciExportFormat,
  date = new Date()
) {
  const extension = format === "pdf" ? "pdf" : "docx";
  const code = sanitizeSegment(source.appelOffres.code);
  const stateSuffix = source.state === "draft" ? "_BROUILLON" : "";
  return `FCI_${source.templateCode}_${code}_${formatDateStamp(date)}${stateSuffix}.${extension}`;
}
