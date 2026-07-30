import type {
  SoftwareImportCandidate,
  SoftwareImportPreview,
  SoftwareImportSummary
} from "./types.ts";

export type ImportStepKey = "selection" | "verification" | "confirmation";

export type ImportStepState = {
  key: ImportStepKey;
  label: string;
  active: boolean;
  completed: boolean;
};

export type CandidatePresentation = {
  resultLabel: "Nouveau" | "Déjà enregistré" | "Alias reconnu" | "À vérifier" | "Ignoré";
  resultTone: "success" | "info" | "warning" | "neutral";
  actionLabel:
    | "Créer"
    | "Conserver"
    | "Ajouter comme alias"
    | "Ignorer"
    | "Vérification nécessaire";
  explanation: string | null;
};

export function shouldShowDevelopmentImportOptions(nodeEnv: string | undefined) {
  return nodeEnv !== "production";
}

export function getImportSteps(input: {
  preview: SoftwareImportPreview | null;
  summary: SoftwareImportSummary | null;
}): ImportStepState[] {
  const currentStep: ImportStepKey = input.summary
    ? "confirmation"
    : input.preview
      ? "verification"
      : "selection";

  return [
    {
      key: "selection",
      label: "1. Sélection du fichier",
      active: currentStep === "selection",
      completed: currentStep !== "selection"
    },
    {
      key: "verification",
      label: "2. Vérification",
      active: currentStep === "verification",
      completed: currentStep === "confirmation"
    },
    {
      key: "confirmation",
      label: "3. Confirmation",
      active: currentStep === "confirmation",
      completed: currentStep === "confirmation"
    }
  ];
}

function isAliasRecognitionCandidate(candidate: SoftwareImportCandidate) {
  return (
    candidate.result === "existing" &&
    Boolean(candidate.sourceName) &&
    Boolean(candidate.existingSoftwareName) &&
    candidate.sourceName !== candidate.existingSoftwareName
  );
}

export function getCandidatePresentation(candidate: SoftwareImportCandidate): CandidatePresentation {
  if (candidate.result === "skipped") {
    return {
      resultLabel: "Ignoré",
      resultTone: "neutral",
      actionLabel: "Ignorer",
      explanation: "La ligne ne contient pas de logiciel exploitable."
    };
  }

  if (candidate.result === "warning") {
    return {
      resultLabel: "À vérifier",
      resultTone: "warning",
      actionLabel: "Vérification nécessaire",
      explanation:
        "Le système n'est pas suffisamment confiant pour appliquer cette ligne automatiquement."
    };
  }

  if (isAliasRecognitionCandidate(candidate)) {
    return {
      resultLabel: "Alias reconnu",
      resultTone: "info",
      actionLabel: "Ajouter comme alias",
      explanation:
        "Le nom du fichier sera rattaché à un logiciel déjà enregistré sans créer de doublon."
    };
  }

  if (candidate.result === "existing") {
    return {
      resultLabel: "Déjà enregistré",
      resultTone: "info",
      actionLabel: "Conserver",
      explanation:
        "Le logiciel existe déjà et ne sera pas créé une seconde fois."
    };
  }

  return {
    resultLabel: "Nouveau",
    resultTone: "success",
    actionLabel: "Créer",
    explanation: "Le logiciel sera ajouté au catalogue."
  };
}

export function canConfirmImport(preview: SoftwareImportPreview | null) {
  if (!preview) {
    return false;
  }

  if (preview.validSoftwareCandidates <= 0) {
    return false;
  }

  return preview.candidates.some((candidate) => candidate.result !== "skipped");
}

export function buildPreImportSummary(preview: SoftwareImportPreview) {
  const aliasCount = preview.candidates.filter((candidate) => {
    const presentation = getCandidatePresentation(candidate);
    return presentation.actionLabel === "Ajouter comme alias";
  }).length;

  return `La mise à jour créera ${preview.newRecords} nouveau(x) logiciel(s), conservera ${preview.existingMatches} logiciel(s) existant(s) et ajoutera ${aliasCount} alias.`;
}
