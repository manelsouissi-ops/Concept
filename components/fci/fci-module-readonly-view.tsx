"use client";

import { useEffect, useState } from "react";
import {
  FciClientError,
  getFciModule
} from "@/lib/appels-offres/fci/client.ts";
import {
  getFciModuleDefinition,
  isRecognizedFciModulePayload,
  type FciFormPayload
} from "@/lib/appels-offres/fci/rendering.ts";
import type { FciAiSupportedModuleCode } from "@/lib/appels-offres/fci/ai-contracts.ts";
import type { FciModulePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import { formatFciClientErrorMessage, formatFciDateTime } from "@/lib/appels-offres/fci/ui.ts";
import { FciModuleEditor } from "./fci-module-editor.tsx";
import { FciErrorState } from "./fci-error-state.tsx";
import { EmptyState } from "@/components/empty-state.tsx";

function noop() {}

/**
 * Intentional read-only presentation for a validated/submitted contribution
 * from another department - not the normal edit form with disabled inputs.
 * No save/validate/regenerate/export controls exist here at all.
 */
export function FciModuleReadOnlyView({
  code,
  moduleCode,
  onBack
}: {
  code: string;
  moduleCode: FciAiSupportedModuleCode;
  onBack: () => void;
}) {
  const definition = getFciModuleDefinition(moduleCode);
  const [modulePresentation, setModulePresentation] = useState<FciModulePresentation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErrorMessage(null);
    setModulePresentation(null);

    void getFciModule(code, moduleCode)
      .then((data) => {
        if (!cancelled) {
          setModulePresentation(data);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setErrorMessage(
          error instanceof FciClientError
            ? formatFciClientErrorMessage(error)
            : "Impossible de charger cette contribution."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [code, moduleCode]);

  if (!definition) {
    return (
      <FciErrorState
        title="Module FCI introuvable"
        message={`Le module ${moduleCode} n'est pas supporte dans cette phase.`}
        onRetry={onBack}
      />
    );
  }

  if (errorMessage) {
    return <FciErrorState message={errorMessage} onRetry={onBack} />;
  }

  if (!modulePresentation) {
    return (
      <section className="section-card">
        <div className="section-body">
          <p className="meta">Chargement de la contribution...</p>
        </div>
      </section>
    );
  }

  const payload =
    modulePresentation.latest_data && isRecognizedFciModulePayload(modulePresentation.latest_data.data, moduleCode)
      ? (modulePresentation.latest_data.data as FciFormPayload)
      : null;

  return (
    <div className="workspace-stack">
      <header className="fci-readonly-header">
        <button type="button" className="button button-ghost button-small" onClick={onBack}>
          ← Retour
        </button>
        <div className="fci-readonly-header-copy">
          <span className="fci-readonly-badge">Lecture seule</span>
          <h2>{definition.departmentLabel}</h2>
          <p className="meta">
            {modulePresentation.module.validated_at
              ? `Validée par ${modulePresentation.module.validated_by ?? "un contributeur"} le ${formatFciDateTime(modulePresentation.module.validated_at)}`
              : "Cette contribution n'est pas encore validée."}
          </p>
        </div>
      </header>

      {payload ? (
        <FciModuleEditor
          definition={definition}
          payload={payload}
          readOnly
          onChange={noop}
        />
      ) : (
        <EmptyState
          compact
          title="Aucune information disponible"
          description="Cette contribution ne contient pas encore de données à afficher."
        />
      )}
    </div>
  );
}
