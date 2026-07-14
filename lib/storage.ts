import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseFiche, serializeFiche } from "./fiche-xml.ts";
import type {
  FicheErrorStage,
  FichePayload,
  FicheResponse,
  StatusPayload
} from "./types.ts";

// DATA_ROOT is resolved relative to this file's location (lib/storage.ts → ../data).
// If this file ever moves out of lib/, adjust the ".." accordingly.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = path.join(MODULE_DIR, "..", "data");

export function sanitizeCodeInterne(codeInterne: string) {
  const sanitized = codeInterne.trim().replace(/[^\w-]+/g, "_");
  if (!sanitized) {
    throw new Error("Code interne invalide.");
  }
  return sanitized;
}

export function projectDir(codeInterne: string) {
  return path.join(DATA_ROOT, sanitizeCodeInterne(codeInterne));
}

async function ensureDataRoot() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
}

export function statusPath(codeInterne: string) {
  return path.join(projectDir(codeInterne), "status.json");
}

export function xmlPath(codeInterne: string) {
  return path.join(projectDir(codeInterne), "fiche.xml");
}

export function markdownPath(codeInterne: string) {
  return path.join(projectDir(codeInterne), "cdc.md");
}

export function pdfPath(codeInterne: string) {
  return path.join(projectDir(codeInterne), "cdc.pdf");
}

async function writeStatus(codeInterne: string, status: StatusPayload) {
  await fs.writeFile(statusPath(codeInterne), JSON.stringify(status, null, 2), "utf8");
}

async function readStatus(codeInterne: string): Promise<StatusPayload> {
  const raw = await fs.readFile(statusPath(codeInterne), "utf8");
  return normalizeStatus(JSON.parse(raw) as Partial<StatusPayload>);
}

function normalizeStatus(raw: Partial<StatusPayload>): StatusPayload {
  return {
    status: raw.status ?? "draft",
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    validatedAt: raw.validatedAt ?? null,
    modifiedAt: raw.modifiedAt ?? null,
    n8nExecutionId: raw.n8nExecutionId ?? null,
    processingStartedAt: raw.processingStartedAt ?? null,
    errorReason: raw.errorReason ?? null,
    errorStage: raw.errorStage ?? null
  };
}

async function writeFileAtomic(targetPath: string, contents: string | Buffer) {
  const tmpPath = `${targetPath}.tmp-${randomUUID()}`;
  await fs.writeFile(targetPath ? tmpPath : tmpPath, contents);
  await fs.rename(tmpPath, targetPath);
}

async function removeFileIfPresent(targetPath: string) {
  try {
    await fs.rm(targetPath, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function buildProcessingStatus(now: string): StatusPayload {
  return {
    status: "processing",
    createdAt: now,
    validatedAt: null,
    modifiedAt: null,
    n8nExecutionId: null,
    processingStartedAt: now,
    errorReason: null,
    errorStage: null
  };
}

function buildDraftStatusFromCurrent(currentStatus: StatusPayload): StatusPayload {
  return {
    ...currentStatus,
    status: "draft",
    validatedAt: null,
    modifiedAt: null,
    processingStartedAt: null,
    errorReason: null,
    errorStage: null
  };
}

async function readMarkdownIfPresent(codeInterne: string): Promise<string | null> {
  try {
    return await fs.readFile(markdownPath(codeInterne), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function readExistingStatus(codeInterne: string): Promise<StatusPayload | null> {
  try {
    return await readStatus(codeInterne);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function createDraftBundle({
  codeInterne,
  pdfFile,
  xml,
  markdown
}: {
  codeInterne: string;
  pdfFile: File;
  xml: string;
  markdown: string;
}) {
  await ensureDataRoot();
  const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
  const now = new Date().toISOString();
  const finalDir = projectDir(codeInterne);
  const tmpDir = path.join(DATA_ROOT, `${sanitizeCodeInterne(codeInterne)}.tmp-${randomUUID()}`);
  const status: StatusPayload = {
    status: "draft",
    createdAt: now,
    validatedAt: null,
    modifiedAt: null,
    n8nExecutionId: null,
    processingStartedAt: null,
    errorReason: null,
    errorStage: null
  };

  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(tmpDir, "cdc.pdf"), pdfBuffer),
      fs.writeFile(path.join(tmpDir, "cdc.md"), markdown, "utf8"),
      fs.writeFile(path.join(tmpDir, "fiche.xml"), xml, "utf8"),
      fs.writeFile(path.join(tmpDir, "status.json"), JSON.stringify(status, null, 2), "utf8")
    ]);
    // Atomic on both Windows and Linux as long as source and destination
    // are on the same filesystem, which they always are here (both under DATA_ROOT).
    await fs.rename(tmpDir, finalDir);
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true });

    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM") {
      const concurrentError = new Error(
        "Une autre generation pour ce code interne est deja en cours ou vient d'aboutir."
      ) as Error & { reason?: string };
      concurrentError.reason = "concurrent_create";
      throw concurrentError;
    }

    throw error;
  }
}

export async function createProcessingBundle({
  codeInterne,
  pdfFile
}: {
  codeInterne: string;
  pdfFile: File;
}) {
  await ensureDataRoot();
  const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
  const now = new Date().toISOString();
  const finalDir = projectDir(codeInterne);
  const nextStatus = buildProcessingStatus(now);

  try {
    await fs.access(finalDir);

    await Promise.all([
      writeFileAtomic(pdfPath(codeInterne), pdfBuffer),
      writeFileAtomic(statusPath(codeInterne), JSON.stringify(nextStatus, null, 2)),
      removeFileIfPresent(xmlPath(codeInterne)),
      removeFileIfPresent(markdownPath(codeInterne))
    ]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      throw error;
    }

    const tmpDir = path.join(DATA_ROOT, `${sanitizeCodeInterne(codeInterne)}.tmp-${randomUUID()}`);

    try {
      await fs.mkdir(tmpDir, { recursive: true });
      await Promise.all([
        fs.writeFile(path.join(tmpDir, "cdc.pdf"), pdfBuffer),
        fs.writeFile(path.join(tmpDir, "status.json"), JSON.stringify(nextStatus, null, 2), "utf8")
      ]);
      await fs.rename(tmpDir, finalDir);
    } catch (createError) {
      await fs.rm(tmpDir, { recursive: true, force: true });

      const createCode = (createError as NodeJS.ErrnoException)?.code;
      if (createCode === "EEXIST" || createCode === "ENOTEMPTY" || createCode === "EPERM") {
        const concurrentError = new Error(
          "Une autre generation pour ce code interne est deja en cours ou vient d'aboutir."
        ) as Error & { reason?: string };
        concurrentError.reason = "concurrent_create";
        throw concurrentError;
      }

      throw createError;
    }
  }

  return nextStatus;
}

export async function readFicheBundle(codeInterne: string): Promise<FicheResponse> {
  const [xml, status, markdown] = await Promise.all([
    fs.readFile(xmlPath(codeInterne), "utf8"),
    readStatus(codeInterne),
    readMarkdownIfPresent(codeInterne)
  ]);

  const fiche = parseFiche(xml);

  return {
    ...fiche,
    codeInterne: fiche.codeInterne || sanitizeCodeInterne(codeInterne),
    markdown,
    status
  };
}

export async function readStoredFicheXml(codeInterne: string) {
  return fs.readFile(xmlPath(codeInterne), "utf8");
}

export async function readFicheIndexSourceForSync(codeInterne: string) {
  const status = await readStatus(codeInterne);

  try {
    const xml = await readStoredFicheXml(codeInterne);
    const fiche = parseFiche(xml);

    return {
      xml,
      fiche: {
        ...fiche,
        codeInterne: fiche.codeInterne || sanitizeCodeInterne(codeInterne)
      },
      status
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      throw error;
    }

    return {
      xml: null,
      fiche: null,
      status
    };
  }
}

export async function readFicheIndexSource(codeInterne: string) {
  const [xml, status] = await Promise.all([
    readStoredFicheXml(codeInterne),
    readStatus(codeInterne)
  ]);
  const fiche = parseFiche(xml);

  return {
    xml,
    fiche: {
      ...fiche,
      codeInterne: fiche.codeInterne || sanitizeCodeInterne(codeInterne)
    },
    status
  };
}

function validatePayload(payload: FichePayload) {
  if (!payload.codeInterne.trim()) {
    throw new Error("Le code interne est obligatoire.");
  }

  if (!Array.isArray(payload.extraction) || !Array.isArray(payload.evaluation)) {
    throw new Error("Le format de fiche est invalide.");
  }
}

export async function writeFicheBundle(
  codeInterne: string,
  payload: FichePayload
): Promise<FicheResponse> {
  validatePayload(payload);

  const currentStatus = await readStatus(codeInterne);
  if (currentStatus.status !== "draft") {
    throw new Error(
      "Cette fiche ne peut etre modifiee que lorsqu'elle est en statut brouillon."
    );
  }

  const currentXml = await fs.readFile(xmlPath(codeInterne), "utf8");
  const currentReferenceInterne = parseFiche(currentXml).codeInterne;
  const xml = serializeFiche({
    ...payload,
    codeInterne: sanitizeCodeInterne(codeInterne)
  }, {
    referenceInterne: currentReferenceInterne
  });

  await fs.writeFile(xmlPath(codeInterne), xml, "utf8");
  await writeStatus(codeInterne, {
    ...currentStatus,
    modifiedAt: new Date().toISOString()
  });
  return readFicheBundle(codeInterne);
}

export async function updateProcessingExecutionId(
  codeInterne: string,
  executionId: string | null
) {
  const currentStatus = await readStatus(codeInterne);
  const nextStatus: StatusPayload = {
    ...currentStatus,
    n8nExecutionId: executionId
  };
  await writeFileAtomic(statusPath(codeInterne), JSON.stringify(nextStatus, null, 2));
  return nextStatus;
}

export async function markProcessingError(
  codeInterne: string,
  errorReason: string,
  errorStage: FicheErrorStage
) {
  const currentStatus = await readStatus(codeInterne);
  const nextStatus: StatusPayload = {
    ...currentStatus,
    status: "error",
    processingStartedAt: null,
    errorReason,
    errorStage,
    validatedAt: null
  };
  await writeFileAtomic(statusPath(codeInterne), JSON.stringify(nextStatus, null, 2));
  return nextStatus;
}

export async function finalizeProcessingSuccess({
  codeInterne,
  xml,
  markdown
}: {
  codeInterne: string;
  xml: string;
  markdown: string;
}) {
  const currentStatus = await readStatus(codeInterne);
  const nextStatus = buildDraftStatusFromCurrent(currentStatus);

  await Promise.all([
    writeFileAtomic(xmlPath(codeInterne), xml),
    writeFileAtomic(markdownPath(codeInterne), markdown),
    writeFileAtomic(statusPath(codeInterne), JSON.stringify(nextStatus, null, 2))
  ]);

  return nextStatus;
}

export async function markFicheValidated(codeInterne: string) {
  const currentStatus = await readStatus(codeInterne);

  if (currentStatus.status === "validated") {
    return;
  }

  await writeStatus(codeInterne, {
    ...currentStatus,
    status: "validated",
    validatedAt: new Date().toISOString(),
    processingStartedAt: null,
    errorReason: null,
    errorStage: null
  });
}

export async function readStoredMarkdown(codeInterne: string) {
  return fs.readFile(markdownPath(codeInterne), "utf8");
}

export async function getStoredPdfPath(codeInterne: string) {
  await fs.access(pdfPath(codeInterne));
  return pdfPath(codeInterne);
}

export async function readStoredPdfFile(codeInterne: string) {
  const buffer = await fs.readFile(pdfPath(codeInterne));
  return new File([buffer], "cdc.pdf", { type: "application/pdf" });
}

export async function readFicheStatus(codeInterne: string) {
  return readStatus(codeInterne);
}
