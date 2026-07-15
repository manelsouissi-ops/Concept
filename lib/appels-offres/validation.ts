import { sanitizeCodeInterne } from "../storage.ts";
import type { AppelOffresInput, AppelOffresPriorite } from "./types.ts";

function readString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeOptionalText(value: string) {
  return value.trim();
}

function normalizeOptionalDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("La date limite doit etre au format YYYY-MM-DD.");
  }

  return trimmed;
}

function normalizePriorite(value: string): AppelOffresPriorite {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "normale";
  }

  if (["basse", "normale", "haute", "critique"].includes(normalized)) {
    return normalized as AppelOffresPriorite;
  }

  throw new Error("La priorité doit être basse, normale, haute ou critique.");
}

function readFirstString(formData: FormData, keys: string[]) {
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function buildInput(values: {
  code: string;
  title: string;
  reference: string;
  buyer: string;
  country: string;
  dueDate: string;
  notes: string;
  priorite: string;
  responsableCommercial: string;
}, options: { requireCode: boolean }): AppelOffresInput {
  const code = options.requireCode
    ? sanitizeCodeInterne(values.code)
    : values.code.trim()
      ? sanitizeCodeInterne(values.code)
      : "";
  const title = values.title.trim();

  if (!title) {
    throw new Error("L'intitule est obligatoire.");
  }

  return {
    code,
    title,
    reference: normalizeOptionalText(values.reference),
    buyer: normalizeOptionalText(values.buyer),
    country: normalizeOptionalText(values.country),
    dueDate: normalizeOptionalDate(values.dueDate),
    notes: normalizeOptionalText(values.notes),
    priorite: normalizePriorite(values.priorite),
    responsableCommercial: normalizeOptionalText(values.responsableCommercial)
  };
}

export function parseAppelOffresFormData(
  formData: FormData,
  options: { requireCode?: boolean; requirePdf?: boolean }
) {
  const codeValue = readString(formData.get("code"));
  const file = formData.get("file");

  if (options.requireCode && !codeValue) {
    throw new Error("Le code est obligatoire.");
  }

  if (options.requirePdf && !(file instanceof File)) {
    throw new Error("Le PDF source est obligatoire.");
  }

  if (file instanceof File) {
    const mimeType = file.type?.trim();
    if (mimeType && mimeType !== "application/pdf") {
      throw new Error("Seuls les fichiers PDF sont acceptes.");
    }
  }

  return {
    input: buildInput({
      code: codeValue || readFirstString(formData, ["code_interne"]),
      title: readFirstString(formData, ["title", "intitule"]),
      reference: readFirstString(formData, ["reference", "description"]),
      buyer: readFirstString(formData, ["buyer", "client"]),
      country: readFirstString(formData, ["country", "pays"]),
      dueDate: readFirstString(formData, ["dueDate", "date_limite"]),
      notes: readFirstString(formData, ["notes", "notes_internes"]),
      priorite: readFirstString(formData, ["priorite", "priority"]),
      responsableCommercial: readFirstString(formData, [
        "responsableCommercial",
        "responsable_commercial"
      ])
    }, {
      requireCode: Boolean(options.requireCode)
    }),
    file: file instanceof File ? file : null
  };
}
