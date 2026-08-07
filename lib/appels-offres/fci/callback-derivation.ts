import type {
  FciAiModuleSummary,
  FciAiSourceFiche,
  FciAiSummaryStatus
} from "./ai-contracts.ts";
import type { FicheStatus } from "../../types.ts";

// source_fiche and summary are platform-owned metadata, not model output:
// the AI is never given a reliable way to know the fiche's real validated_at
// timestamp or to consistently compute completion stats, so asking it to
// invent them produces schema violations. The platform reconstructs both
// deterministically after the AI's own `data` payload has already validated.

function parseSourceFicheVersion(version: string): {
  status: string;
  validatedAt: string | null;
} {
  const separatorIndex = version.indexOf(":");
  if (separatorIndex === -1) {
    return { status: version, validatedAt: null };
  }

  return {
    status: version.slice(0, separatorIndex),
    validatedAt: version.slice(separatorIndex + 1)
  };
}

export function buildAuthoritativeSourceFiche(
  appelOffresCode: string,
  job: { sourceFicheVersion: string; sourceFicheHash: string }
): FciAiSourceFiche {
  const { status, validatedAt } = parseSourceFicheVersion(job.sourceFicheVersion);

  return {
    code_interne: appelOffresCode,
    version: job.sourceFicheVersion,
    hash: job.sourceFicheHash,
    status: status as FicheStatus,
    validated_at: validatedAt
  };
}

type FieldBaseLike = {
  requires_human_input: boolean;
};

function isFieldBaseLike(value: unknown): value is FieldBaseLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    "value" in record &&
    typeof record.source_type === "string" &&
    typeof record.confidence === "string" &&
    typeof record.requires_human_input === "boolean" &&
    typeof record.justification === "string" &&
    Array.isArray(record.source_references)
  );
}

function collectFieldLeaves(node: unknown, sink: FieldBaseLike[]) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectFieldLeaves(item, sink);
    }
    return;
  }

  if (isFieldBaseLike(node)) {
    sink.push(node);
    return;
  }

  if (typeof node === "object" && node !== null) {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectFieldLeaves(value, sink);
    }
  }
}

function collectSectionWarnings(data: Record<string, unknown>): string[] {
  const warnings: string[] = [];

  for (const [sectionKey, sectionValue] of Object.entries(data)) {
    const leaves: FieldBaseLike[] = [];
    collectFieldLeaves(sectionValue, leaves);
    if (leaves.some((leaf) => leaf.requires_human_input)) {
      warnings.push(
        `La section "${sectionKey}" contient des champs necessitant une saisie humaine.`
      );
    }
  }

  return warnings;
}

// Mechanical only: counts already-validated requires_human_input flags in the
// AI's `data` payload. Does not fabricate qualitative judgment - warnings are
// derived strictly from which sections contain a human-input field, not from
// any interpretation of their content.
export function computeFciModuleSummary(data: unknown): FciAiModuleSummary {
  const leaves: FieldBaseLike[] = [];
  collectFieldLeaves(data, leaves);

  const total = leaves.length;
  const humanInputsRequired = leaves.filter((leaf) => leaf.requires_human_input).length;
  const completionPercentage =
    total === 0 ? 0 : Math.round((100 * (total - humanInputsRequired)) / total);

  const status: FciAiSummaryStatus =
    total === 0 || humanInputsRequired === total
      ? "insufficient_data"
      : humanInputsRequired === 0
        ? "complete"
        : "partial";

  const warnings =
    data && typeof data === "object" && !Array.isArray(data)
      ? collectSectionWarnings(data as Record<string, unknown>)
      : [];

  return {
    status,
    completion_percentage: completionPercentage,
    human_inputs_required: humanInputsRequired,
    warnings
  };
}
