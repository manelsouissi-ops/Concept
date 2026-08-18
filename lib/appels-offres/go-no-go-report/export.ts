import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  convertDocxToPdf,
  FciPdfConversionError
} from "../fci/export/pdf-converter.ts";
import { getGoNoGoReportWorkspace } from "./service.ts";
import { getGoNoGoView } from "../go-no-go/service.ts";
import type { CurrentUser } from "../../auth/rbac.ts";
import {
  appendGoNoGoReportAuditEvent,
  listGoNoGoReportsByAppelOffresId
} from "./repository.ts";
import { appendAuditLog, getAppelOffresRecordByCode } from "../repository.ts";
import { createNotification } from "../../notifications/service.ts";
import { buildForCom02Document } from "./for-com-02-mapping.ts";
import { resolveGoNoGoPythonExecution } from "./python-runtime.ts";

export type GoNoGoReportExportFormat = "docx" | "pdf";

export class GoNoGoReportExportError extends Error {
  code:
    | "GO_NO_GO_REPORT_EXPORT_INVALID_FORMAT"
    | "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE"
    | "GO_NO_GO_REPORT_EXPORT_FAILED";
  status: number;

  constructor(
    code:
      | "GO_NO_GO_REPORT_EXPORT_INVALID_FORMAT"
      | "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE"
      | "GO_NO_GO_REPORT_EXPORT_FAILED",
    message: string,
    status: number
  ) {
    super(message);
    this.name = "GoNoGoReportExportError";
    this.code = code;
    this.status = status;
  }
}

function getExporterScriptPath() {
  return path.join(
    process.cwd(),
    "lib",
    "appels-offres",
    "go-no-go-report",
    "python_docx_report_exporter.py"
  );
}

function getForCom02TemplatePath() {
  return path.join(
    process.cwd(),
    "lib",
    "appels-offres",
    "go-no-go-report",
    "templates",
    "FOR_COM_02_GONOGO_TEMPLATE.docx"
  );
}

function parseFormat(value: string | null): GoNoGoReportExportFormat {
  if (value === "docx" || value === "pdf") {
    return value;
  }

  throw new GoNoGoReportExportError(
    "GO_NO_GO_REPORT_EXPORT_INVALID_FORMAT",
    "Le format d'export du rapport Go/No-Go est invalide.",
    400
  );
}

function runProcess(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; cwd?: string }
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let completed = false;

    const timeoutId =
      options?.timeoutMs != null
        ? setTimeout(() => {
            if (completed) {
              return;
            }
            completed = true;
            child.kill();
            reject(new Error(`Le generateur DOCX a depasse le delai (${options.timeoutMs} ms).`));
          }, options.timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Le generateur DOCX a echoue (${code}).`));
    });
  });
}

function buildExportFileName(code: string, version: number | null, format: GoNoGoReportExportFormat) {
  const suffix = version != null ? `_rapport_gonogo_v${version}` : "_rapport_gonogo";
  return `${code}${suffix}.${format}`;
}

export async function generateGoNoGoReportExportArtifact(
  code: string,
  formatRaw: string | null,
  currentUser?: CurrentUser | null,
  options?: {
    pdfConverter?: typeof convertDocxToPdf;
  }
) {
  const format = parseFormat(formatRaw);
  const [workspace, goNoGoView] = await Promise.all([
    getGoNoGoReportWorkspace(code, currentUser),
    getGoNoGoView(code, currentUser)
  ]);
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  const payload = workspace.report.editable_payload;
  if (!payload) {
    throw new GoNoGoReportExportError(
      "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE",
      "Aucun rapport Go/No-Go exportable n'est disponible pour ce dossier.",
      404
    );
  }

  if (workspace.report.is_stale) {
    throw new GoNoGoReportExportError(
      "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE",
      "Le rapport Go/No-Go repose sur des sources obsoletes. Regenerez-le avant export.",
      409
    );
  }

  const reports = appelOffres
    ? await listGoNoGoReportsByAppelOffresId(appelOffres.id)
    : [];
  const report = reports.find((entry) => entry.id === workspace.report.id) ?? null;
  const mapping = buildForCom02Document({
    code: workspace.appel_offres.code,
    title: workspace.appel_offres.title,
    sourceSnapshot: report?.sourceSnapshotJson ?? null,
    reviewed: payload,
    decision: goNoGoView.decision
  });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "concept-gonogo-report-"));
  const docxPath = path.join(tempDir, buildExportFileName(code, workspace.report.version, "docx"));
  const instructionPath = path.join(tempDir, `instruction-${randomUUID()}.json`);
  const templatePath = getForCom02TemplatePath();
  const templateAvailable = await fs.access(templatePath).then(() => true, () => false);
  await fs.writeFile(
    instructionPath,
    JSON.stringify(
      {
        outputPath: docxPath,
        ...(templateAvailable
          ? { templatePath, mapping }
          : {
              title: "CONCEPT - Rapport Go/No-Go",
              lines: [
                workspace.appel_offres.code,
                workspace.appel_offres.title,
                payload.executive_summary,
                payload.commercial_summary,
                payload.financial_summary,
                payload.operational_summary,
                payload.key_risks,
                payload.commercial_recommendation
              ]
            })
      },
      null,
      2
    ),
    "utf8"
  );

  const actorUserId = currentUser ? Number(currentUser.id) : null;
  const pdfConverter = options?.pdfConverter ?? convertDocxToPdf;

  try {
    const python = await resolveGoNoGoPythonExecution();
    await runProcess(
      python.command,
      [...python.argsPrefix, getExporterScriptPath(), instructionPath],
      {
        timeoutMs: 30_000,
        cwd: tempDir
      }
    );

    if (format === "docx") {
      const buffer = await fs.readFile(docxPath);
      const artifact = {
        buffer,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileName: buildExportFileName(code, workspace.report.version, "docx"),
        converter: templateAvailable ? "for-com-02" : "custom-docx-fallback"
      };
      if (workspace.report.id != null) {
        await appendGoNoGoReportAuditEvent({
          goNoGoReportId: workspace.report.id,
          appelOffresId: appelOffres?.id ?? 0,
          eventType: "REPORT_EXPORTED",
          actorUserId: Number.isInteger(actorUserId) ? actorUserId : null,
          actorName: currentUser?.name ?? null,
          payloadJson: {
            format: "docx",
            converter: artifact.converter,
            reportVersion: workspace.report.version
          }
        });
      }
      await appendAuditLog(
        code,
        "go_no_go_report.exported",
        {
          format: "docx",
          report_version: workspace.report.version,
          converter: artifact.converter
        },
        currentUser?.name ?? null
      );
      if (Number.isInteger(actorUserId) && actorUserId != null) {
        await createNotification({
          recipientUserId: actorUserId,
          recipientRole: currentUser?.role ?? null,
          appelOffreCode: code,
          eventType: "GONOGO_REPORT_EXPORTED",
          actorUserId,
          metadata: {
            actorName: currentUser?.name ?? null,
            format: "docx"
          },
          section: "go-no-go"
        });
      }
      return artifact;
    }

    try {
      const pdfResult = await pdfConverter(docxPath, tempDir);
      const buffer = await fs.readFile(pdfResult.outputPath);
      const artifact = {
        buffer,
        contentType: "application/pdf",
        fileName: buildExportFileName(code, workspace.report.version, "pdf"),
        converter: pdfResult.converterKind
      };
      if (workspace.report.id != null) {
        await appendGoNoGoReportAuditEvent({
          goNoGoReportId: workspace.report.id,
          appelOffresId: appelOffres?.id ?? 0,
          eventType: "REPORT_EXPORTED",
          actorUserId: Number.isInteger(actorUserId) ? actorUserId : null,
          actorName: currentUser?.name ?? null,
          payloadJson: {
            format: "pdf",
            converter: artifact.converter,
            reportVersion: workspace.report.version
          }
        });
      }
      await appendAuditLog(
        code,
        "go_no_go_report.exported",
        {
          format: "pdf",
          report_version: workspace.report.version,
          converter: artifact.converter
        },
        currentUser?.name ?? null
      );
      if (Number.isInteger(actorUserId) && actorUserId != null) {
        await createNotification({
          recipientUserId: actorUserId,
          recipientRole: currentUser?.role ?? null,
          appelOffreCode: code,
          eventType: "GONOGO_REPORT_EXPORTED",
          actorUserId,
          metadata: {
            actorName: currentUser?.name ?? null,
            format: "pdf"
          },
          section: "go-no-go"
        });
      }
      return artifact;
    } catch (error) {
      if (error instanceof FciPdfConversionError) {
        throw new GoNoGoReportExportError(
          error.code === "PDF_CONVERTER_UNAVAILABLE"
            ? "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE"
            : "GO_NO_GO_REPORT_EXPORT_FAILED",
          error.message,
          error.code === "PDF_CONVERTER_UNAVAILABLE" ? 503 : 502
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof GoNoGoReportExportError) {
      throw error;
    }

    throw new GoNoGoReportExportError(
      "GO_NO_GO_REPORT_EXPORT_FAILED",
      error instanceof Error ? error.message : "Export Go/No-Go impossible.",
      500
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
