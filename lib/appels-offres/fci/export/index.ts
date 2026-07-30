import type { FciModulePresentation } from "../presentation.ts";
import { buildFciExportFileName } from "./filenames.ts";
import { buildFciExportSource } from "./mapping.ts";
import {
  cleanupExportTempDir,
  generateFciDocxArtifact
} from "./docx-exporter.ts";
import {
  convertDocxToPdf,
  FciPdfConversionError
} from "./pdf-converter.ts";
import type { FciExportFormat, FciGeneratedArtifact } from "./types.ts";

export class FciExportError extends Error {
  code:
    | "FCI_EXPORT_INVALID_FORMAT"
    | "FCI_EXPORT_MODULE_UNSUPPORTED"
    | "FCI_EXPORT_DATA_NOT_FOUND"
    | "FCI_EXPORT_TEMPLATE_ERROR"
    | "FCI_EXPORT_PDF_UNAVAILABLE"
    | "FCI_EXPORT_PDF_FAILED";
  status: number;

  constructor(
    code:
      | "FCI_EXPORT_INVALID_FORMAT"
      | "FCI_EXPORT_MODULE_UNSUPPORTED"
      | "FCI_EXPORT_DATA_NOT_FOUND"
      | "FCI_EXPORT_TEMPLATE_ERROR"
      | "FCI_EXPORT_PDF_UNAVAILABLE"
      | "FCI_EXPORT_PDF_FAILED",
    message: string,
    status: number
  ) {
    super(message);
    this.name = "FciExportError";
    this.code = code;
    this.status = status;
  }
}

export function parseFciExportFormat(value: string | null) {
  if (value === "docx" || value === "pdf") {
    return value satisfies FciExportFormat;
  }

  throw new FciExportError(
    "FCI_EXPORT_INVALID_FORMAT",
    "Le format d'export demande est invalide.",
    400
  );
}

export async function generateFciExportArtifact(
  modulePresentation: FciModulePresentation,
  format: FciExportFormat
): Promise<FciGeneratedArtifact> {
  let tempDir: string | null = null;

  try {
    const source = buildFciExportSource(modulePresentation);
    const docxResult = await generateFciDocxArtifact(source);
    tempDir = docxResult.tempDir;

    if (format === "docx") {
      return {
        ...docxResult.artifact,
        fileName: buildFciExportFileName(source, "docx")
      };
    }

    try {
      const pdfResult = await convertDocxToPdf(docxResult.docxPath, docxResult.tempDir);
      const pdfBuffer = await import("node:fs/promises").then((fs) => fs.readFile(pdfResult.outputPath));

      return {
        buffer: pdfBuffer,
        contentType: "application/pdf",
        fileName: buildFciExportFileName(source, "pdf"),
        converter: pdfResult.converterKind
      };
    } catch (error) {
      if (error instanceof FciPdfConversionError) {
        throw new FciExportError(
          error.code === "PDF_CONVERTER_UNAVAILABLE"
            ? "FCI_EXPORT_PDF_UNAVAILABLE"
            : "FCI_EXPORT_PDF_FAILED",
          error.code === "PDF_CONVERTER_UNAVAILABLE"
            ? "L’export PDF n’est pas disponible sur cet environnement. Le téléchargement Word reste disponible."
            : error.message,
          error.code === "PDF_CONVERTER_UNAVAILABLE" ? 503 : 502
        );
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export FCI impossible.";

    if (error instanceof FciExportError) {
      throw error;
    }

    if (message.includes("pas exportable")) {
      throw new FciExportError(
        "FCI_EXPORT_MODULE_UNSUPPORTED",
        "Le module FCI demande n'est pas exportable.",
        404
      );
    }

    if (message.includes("Aucune donnee FCI exportable")) {
      throw new FciExportError(
        "FCI_EXPORT_DATA_NOT_FOUND",
        "Aucune donnee FCI enregistree n'est disponible pour cet export.",
        404
      );
    }

    throw new FciExportError(
      "FCI_EXPORT_TEMPLATE_ERROR",
      message,
      500
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }
}
