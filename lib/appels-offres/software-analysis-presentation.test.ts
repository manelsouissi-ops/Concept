import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSoftwareAnalysisSummary,
  canTransitionSoftwareAnalysisStatus,
  getSoftwareAnalysisStatusLabel
} from "./software-analysis-presentation.ts";

test("canTransitionSoftwareAnalysisStatus enforces the review workflow", () => {
  assert.equal(canTransitionSoftwareAnalysisStatus("draft", "submit"), true);
  assert.equal(canTransitionSoftwareAnalysisStatus("draft", "validate"), false);
  assert.equal(canTransitionSoftwareAnalysisStatus("submitted", "validate"), true);
  assert.equal(canTransitionSoftwareAnalysisStatus("validated", "reopen"), true);
});

test("getSoftwareAnalysisStatusLabel maps draft, submitted, and validated", () => {
  assert.equal(getSoftwareAnalysisStatusLabel("draft"), "Brouillon");
  assert.equal(getSoftwareAnalysisStatusLabel("submitted"), "A valider");
  assert.equal(getSoftwareAnalysisStatusLabel("validated"), "Valide");
});

test("buildSoftwareAnalysisSummary computes the page-level counters", () => {
  const summary = buildSoftwareAnalysisSummary({
    review: {
      id: 1,
      appelOffresId: 1,
      scope: "logiciels",
      status: "draft",
      submittedAt: null,
      validatedAt: null,
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z"
    },
    requirements: [1, 2, 3].map((id) => ({
      id,
      appelOffresId: 1,
      requirementText: `Besoin ${id}`,
      explicitness: "explicit" as const,
      softwareNamesRaw: "",
      necessityLevel: "Eleve",
      justification: "",
      riskIfMissing: "",
      alternativePossible: "",
      sourceExcerpt: "",
      status: "draft" as const,
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z"
    })),
    matches: [
      {
        id: 1,
        appelOffresId: 1,
        requirementId: 1,
        logicielId: 10,
        softwareNameRaw: "Autocad",
        matchType: "exact" as const,
        coverageStatus: "covered" as const,
        necessityLevel: "Eleve",
        utilityText: "",
        recommendedDecision: "",
        comment: "",
        validatedByUser: true,
        status: "validated" as const,
        createdAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z",
        matchedSoftware: null
      },
      {
        id: 2,
        appelOffresId: 1,
        requirementId: 2,
        logicielId: 11,
        softwareNameRaw: "QGIS",
        matchType: "manual" as const,
        coverageStatus: "partially_covered" as const,
        necessityLevel: "Moyen",
        utilityText: "",
        recommendedDecision: "",
        comment: "",
        validatedByUser: true,
        status: "reviewed" as const,
        createdAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z",
        matchedSoftware: null
      }
    ],
    gaps: [
      {
        id: 1,
        appelOffresId: 1,
        requirementId: 3,
        missingNeed: "Modeleur",
        softwareTypeNeeded: "",
        whyNeeded: "",
        urgencyLevel: "Haute",
        exampleSoftwareOrCategory: "",
        recommendedAction: "",
        status: "draft" as const,
        createdAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z"
      }
    ],
    confirmations: [
      {
        id: 1,
        appelOffresId: 1,
        scope: "logiciels",
        topic: "Verification",
        questionText: "Confirmer la licence",
        status: "open" as const,
        resolutionNote: "",
        createdAt: "2026-07-22T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z"
      }
    ],
    sources: []
  });

  assert.deepEqual(summary, {
    requirementsCount: 3,
    coveredCount: 1,
    partiallyCoveredCount: 1,
    notCoveredCount: 1,
    toConfirmCount: 1
  });
});
