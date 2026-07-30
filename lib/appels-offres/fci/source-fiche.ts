import { createHash } from "node:crypto";
import { getAppelOffresRecordByCode } from "../repository.ts";
import type { AppelOffresRecord } from "../types.ts";
import { readFicheIndexSource } from "../../storage.ts";
import type { FichePayload, StatusPayload } from "../../types.ts";

export type SourceFicheSnapshot = {
  appelOffres: AppelOffresRecord;
  xml: string;
  fiche: FichePayload;
  status: StatusPayload;
  version: string;
  updatedAt: string;
  hash: string;
  isValidated: boolean;
};

type ReadSourceFicheOptions = {
  allowDraft?: boolean;
};

function buildSourceVersion(status: StatusPayload) {
  const updatedAt = status.validatedAt ?? status.modifiedAt ?? status.createdAt;
  return `${status.status}:${updatedAt}`;
}

function buildSourceHash(xml: string) {
  return createHash("sha256").update(xml, "utf8").digest("hex");
}

function isMissingFileError(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

export async function getSourceAppelOffresRecord(code: string) {
  return getAppelOffresRecordByCode(code, { includeArchived: true });
}

export async function readSourceFicheSnapshot(
  code: string,
  options: ReadSourceFicheOptions = {}
): Promise<SourceFicheSnapshot | null> {
  const appelOffres = await getSourceAppelOffresRecord(code);
  if (!appelOffres) {
    return null;
  }

  let indexed;
  try {
    indexed = await readFicheIndexSource(code);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }

  const isValidated = indexed.status.status === "validated";
  const canUseDraft = options.allowDraft === true && indexed.status.status === "draft";

  if (!isValidated && !canUseDraft) {
    return null;
  }

  const updatedAt =
    indexed.status.validatedAt ??
    indexed.status.modifiedAt ??
    indexed.status.createdAt;

  return {
    appelOffres,
    xml: indexed.xml,
    fiche: indexed.fiche,
    status: indexed.status,
    version: buildSourceVersion(indexed.status),
    updatedAt,
    hash: buildSourceHash(indexed.xml),
    isValidated
  };
}
