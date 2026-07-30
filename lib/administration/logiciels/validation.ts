import type { SoftwareMutationInput } from "./types.ts";
import {
  normalizeSoftwareComparisonName,
  normalizeSoftwareDisplayName
} from "./normalization.ts";

function parseAliasesInput(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((alias) => normalizeSoftwareDisplayName(alias))
    .filter(Boolean);
}

export function serializeAliasesInput(aliases: string[]) {
  return aliases.join("\n");
}

export function validateSoftwareMutationInput(input: SoftwareMutationInput) {
  const name = normalizeSoftwareDisplayName(input.name);
  if (!name) {
    throw new Error("Le nom du logiciel est obligatoire.");
  }

  const aliasMap = new Map<string, string>();
  for (const alias of input.aliases) {
    const normalizedAlias = normalizeSoftwareComparisonName(alias);
    if (!normalizedAlias) {
      continue;
    }

    if (normalizedAlias === normalizeSoftwareComparisonName(name)) {
      continue;
    }

    if (!aliasMap.has(normalizedAlias)) {
      aliasMap.set(normalizedAlias, normalizeSoftwareDisplayName(alias));
    }
  }

  return {
    name,
    normalizedName: normalizeSoftwareComparisonName(name),
    descriptionRaw: input.descriptionRaw.trim(),
    aliases: [...aliasMap.values()]
  };
}

export function parseSoftwareFormData(formData: FormData): SoftwareMutationInput {
  const name = typeof formData.get("name") === "string" ? String(formData.get("name")) : "";
  const descriptionRaw =
    typeof formData.get("description_raw") === "string"
      ? String(formData.get("description_raw"))
      : "";
  const aliasesRaw =
    typeof formData.get("aliases") === "string" ? String(formData.get("aliases")) : "";

  return {
    name,
    descriptionRaw,
    aliases: parseAliasesInput(aliasesRaw)
  };
}

export function parseSoftwareImportSourceFormData(formData: FormData) {
  const source = typeof formData.get("source") === "string" ? formData.get("source") : "";
  const file = formData.get("file");

  if (source === "local_catalogue") {
    return { source: "local_catalogue" as const, file: null };
  }

  if (!(file instanceof File)) {
    throw new Error("Selectionnez un fichier Excel .xlsx ou utilisez le catalogue local.");
  }

  const fileName = file.name.trim();
  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Seuls les fichiers Excel .xlsx sont acceptes pour l'import du catalogue.");
  }

  return {
    source: "uploaded_file" as const,
    file
  };
}
