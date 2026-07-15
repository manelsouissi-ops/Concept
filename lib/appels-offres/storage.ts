import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import {
  DATA_ROOT,
  markdownPath,
  pdfPath,
  projectDir,
  readExistingStatus,
  statusPath,
  xmlPath
} from "../storage.ts";
import type { StatusPayload } from "../types.ts";
import type { ArtifactPresence } from "./types.ts";

const DEFAULT_STATUS: StatusPayload = {
  status: "draft",
  createdAt: new Date(0).toISOString(),
  validatedAt: null,
  modifiedAt: null,
  n8nExecutionId: null,
  processingStartedAt: null,
  errorReason: null,
  errorStage: null
};

async function ensureDataRoot() {
  await fs.mkdir(DATA_ROOT, { recursive: true });
}

async function writeFileAtomic(targetPath: string, contents: string | Buffer) {
  const tmpPath = `${targetPath}.tmp-${randomUUID()}`;
  await fs.writeFile(tmpPath, contents);
  await fs.rename(tmpPath, targetPath);
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function buildInitialStatus(now: string): StatusPayload {
  return {
    ...DEFAULT_STATUS,
    createdAt: now
  };
}

export async function ensureAppelOffresBundleStatus(code: string) {
  await ensureDataRoot();
  await fs.mkdir(projectDir(code), { recursive: true });

  const existingStatus = await readExistingStatus(code);
  if (existingStatus) {
    return existingStatus;
  }

  const nextStatus = buildInitialStatus(new Date().toISOString());
  await writeFileAtomic(statusPath(code), JSON.stringify(nextStatus, null, 2));
  return nextStatus;
}

export async function storeSourcePdf(code: string, pdfFile: File) {
  await ensureDataRoot();
  await fs.mkdir(projectDir(code), { recursive: true });
  await ensureAppelOffresBundleStatus(code);

  const fileBuffer = Buffer.from(await pdfFile.arrayBuffer());
  await writeFileAtomic(pdfPath(code), fileBuffer);

  return {
    fileName: pdfFile.name || "cdc.pdf",
    storagePath: pdfPath(code),
    mimeType: "application/pdf",
    sizeBytes: fileBuffer.byteLength
  };
}

export async function getAppelOffresPdfPath(code: string) {
  const targetPath = pdfPath(code);
  await fs.access(targetPath);
  return targetPath;
}

export async function getArtifactPresence(code: string): Promise<ArtifactPresence> {
  const [hasSourcePdf, hasFicheXml, hasFicheMarkdown, hasStatusJson] = await Promise.all([
    fileExists(pdfPath(code)),
    fileExists(xmlPath(code)),
    fileExists(markdownPath(code)),
    fileExists(statusPath(code))
  ]);

  return {
    hasSourcePdf,
    hasFicheXml,
    hasFicheMarkdown,
    hasStatusJson
  };
}

export async function getAttachedFicheStatus(code: string) {
  return readExistingStatus(code);
}

export async function getStoredArtifactStats(code: string) {
  const artifacts = [
    ["source_pdf", pdfPath(code), "cdc.pdf", "application/pdf"],
    ["fiche_xml", xmlPath(code), "fiche.xml", "application/xml"],
    ["fiche_markdown", markdownPath(code), "cdc.md", "text/markdown"],
    ["status_json", statusPath(code), "status.json", "application/json"]
  ] as const;

  const results = await Promise.all(
    artifacts.map(async ([kind, targetPath, fileName, mimeType]) => {
      try {
        const stats = await fs.stat(targetPath);
        return {
          kind,
          fileName,
          storagePath: path.resolve(targetPath),
          mimeType,
          sizeBytes: stats.size
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }

        throw error;
      }
    })
  );

  return results.filter((entry) => entry !== null);
}
