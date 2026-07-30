import type { SoftwareRecord } from "../administration/logiciels/types.ts";
import {
  normalizeSoftwareAlias,
  normalizeSoftwareComparisonName,
  normalizeSoftwareDisplayName
} from "../administration/logiciels/normalization.ts";
import type {
  SoftwareAnalysisMatchCandidate,
  TenderSoftwareMatchType
} from "./software-analysis-types.ts";

function buildLooseComparableName(value: string) {
  return normalizeSoftwareComparisonName(value).replace(/[^a-z0-9\u00c0-\u024f]+/gi, "");
}

function toComparableTokens(value: string) {
  return normalizeSoftwareComparisonName(value)
    .split(/[\s/_-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function buildPossibleMatch(
  software: SoftwareRecord,
  explanation: string
): SoftwareAnalysisMatchCandidate {
  return {
    software,
    matchType: "possible",
    validatedByUser: false,
    explanation
  };
}

export function findSoftwareMatchCandidate(
  softwareNameRaw: string,
  catalogue: SoftwareRecord[]
): SoftwareAnalysisMatchCandidate {
  const displayName = normalizeSoftwareDisplayName(softwareNameRaw);
  if (!displayName) {
    return {
      software: null,
      matchType: "none",
      validatedByUser: false,
      explanation: "Aucun nom logiciel exploitable n'a ete fourni."
    };
  }

  const normalizedName = normalizeSoftwareComparisonName(displayName);
  const looseComparable = buildLooseComparableName(displayName);

  const exactMatch =
    catalogue.find((software) => software.normalizedName === normalizedName) ?? null;
  if (exactMatch) {
    return {
      software: exactMatch,
      matchType: "exact",
      validatedByUser: true,
      explanation: "Le nom logiciel correspond exactement au catalogue interne."
    };
  }

  for (const software of catalogue) {
    const aliasMatch = software.aliases.find(
      (alias) => normalizeSoftwareAlias(alias.alias) === normalizedName
    );
    if (aliasMatch) {
      return {
        software,
        matchType: "alias",
        validatedByUser: true,
        explanation: "Le nom logiciel correspond a un alias connu du catalogue."
      };
    }
  }

  const looseExactMatch =
    catalogue.find((software) => buildLooseComparableName(software.name) === looseComparable) ??
    catalogue.find((software) =>
      software.aliases.some(
        (alias) => buildLooseComparableName(alias.alias) === looseComparable
      )
    ) ??
    null;
  if (looseExactMatch) {
    return buildPossibleMatch(
      looseExactMatch,
      "Le nom logiciel est proche d'une entree du catalogue mais demande une confirmation."
    );
  }

  const queryTokens = toComparableTokens(displayName);
  if (queryTokens.length) {
    const tokenPossibleMatch =
      catalogue.find((software) => {
        const haystack = [
          software.name,
          ...software.aliases.map((alias) => alias.alias)
        ]
          .join(" ")
          .toLocaleLowerCase("fr-FR");
        return queryTokens.every((token) => haystack.includes(token));
      }) ?? null;

    if (tokenPossibleMatch) {
      return buildPossibleMatch(
        tokenPossibleMatch,
        "Le catalogue contient une entree voisine, a confirmer manuellement."
      );
    }
  }

  return {
    software: null,
    matchType: "none",
    validatedByUser: false,
    explanation: "Aucune correspondance catalogue n'a ete detectee."
  };
}

export function resolveCoverageStatusFromWorkbook(value: string) {
  const normalized = normalizeSoftwareComparisonName(value);
  if (!normalized) {
    return "to_confirm" as const;
  }
  if (normalized.includes("partiel")) {
    return "partially_covered" as const;
  }
  if (normalized.includes("non") || normalized.includes("absent") || normalized.includes("manquant")) {
    return "not_covered" as const;
  }
  if (normalized.includes("conf")) {
    return "to_confirm" as const;
  }
  return "covered" as const;
}

export function resolveMatchTypeForManualSelection(logicielId: number | null): TenderSoftwareMatchType {
  return logicielId == null ? "none" : "manual";
}
