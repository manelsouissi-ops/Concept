function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeSoftwareDisplayName(value: string) {
  return collapseWhitespace(value);
}

export function normalizeSoftwareComparisonName(value: string) {
  return collapseWhitespace(value).toLocaleLowerCase("fr-FR");
}

export function normalizeSoftwareAlias(value: string) {
  return normalizeSoftwareComparisonName(value);
}

function looksLikeSoftwareNameFragment(value: string) {
  const normalized = normalizeSoftwareDisplayName(value);
  if (!normalized) {
    return false;
  }

  if (normalized.length > 60) {
    return false;
  }

  if (/[.;:!?]/.test(normalized)) {
    return false;
  }

  const words = normalized.split(" ").filter(Boolean);
  return words.length >= 1 && words.length <= 6;
}

export function splitSoftwareNameCandidates(value: string) {
  const normalized = normalizeSoftwareDisplayName(value);
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split(",")
    .map((part) => normalizeSoftwareDisplayName(part))
    .filter(Boolean);

  if (parts.length <= 1) {
    return [normalized];
  }

  if (!parts.every(looksLikeSoftwareNameFragment)) {
    return [normalized];
  }

  const seen = new Set<string>();
  const uniqueParts: string[] = [];

  for (const part of parts) {
    const key = normalizeSoftwareComparisonName(part);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueParts.push(part);
  }

  return uniqueParts;
}
