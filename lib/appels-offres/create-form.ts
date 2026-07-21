export type CreateAppelOffresFileLike = {
  name: string;
  type: string;
  size: number;
};

type CreateDraftInput = {
  code: string;
  file: CreateAppelOffresFileLike | null;
};

type CreateDraftValidation = {
  normalizedCode: string;
  isCodeValid: boolean;
  fileError: string | null;
  canSubmit: boolean;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function suggestNewAppelOffresCode(now = new Date()) {
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());

  return `AO-${year}${month}${day}-${hours}${minutes}`;
}

export function normalizeAppelOffresCodeCandidate(value: string) {
  return value.trim().replace(/[^\w-]+/g, "_");
}

export function getPdfFileSelectionError(file: CreateAppelOffresFileLike | null) {
  if (!file) {
    return null;
  }

  const mimeType = file.type.trim().toLowerCase();
  const lowerName = file.name.trim().toLowerCase();
  const hasPdfExtension = lowerName.endsWith(".pdf");

  if (mimeType && mimeType !== "application/pdf") {
    return "Seuls les fichiers PDF sont acceptes pour le CDC.";
  }

  if (!mimeType && !hasPdfExtension) {
    return "Seuls les fichiers PDF sont acceptes pour le CDC.";
  }

  return null;
}

export function validateCreateAppelOffresDraft(
  input: CreateDraftInput
): CreateDraftValidation {
  const normalizedCode = normalizeAppelOffresCodeCandidate(input.code);
  const isCodeValid = Boolean(normalizedCode);
  const fileError = getPdfFileSelectionError(input.file);

  return {
    normalizedCode,
    isCodeValid,
    fileError,
    canSubmit: isCodeValid && Boolean(input.file) && !fileError
  };
}
