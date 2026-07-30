import {
  shouldDisplayFciConfidenceBadge,
  getFciConfidencePresentation,
  getFciFieldReviewStatusPresentation,
  getFciFieldSourcePresentation
} from "@/lib/appels-offres/fci/ui.ts";
import { StatusBadge } from "@/components/status-badge.tsx";
import { FciSourceReferences } from "./fci-source-references.tsx";
import type { FciFormField } from "@/lib/appels-offres/fci/rendering.ts";

function formatOriginalValue(value: FciFormField["original_ai_value"]) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "Oui" : "Non";
  }

  return String(value);
}

export function FciFieldMetadata({
  field,
  showConfidence = true,
  showJustification = true
}: {
  field: FciFormField;
  showConfidence?: boolean;
  showJustification?: boolean;
}) {
  const source = getFciFieldSourcePresentation(field.source);
  const review = getFciFieldReviewStatusPresentation(field.review_status);
  const confidence = getFciConfidencePresentation(field.confidence);
  const originalAiValue = formatOriginalValue(field.original_ai_value);
  const shouldShowConfidence = showConfidence && shouldDisplayFciConfidenceBadge({
    source: field.source,
    confidence: field.confidence,
    originalAiValue: field.original_ai_value
  });
  const justification = field.justification?.trim() ? field.justification.trim() : null;

  return (
    <div className="fci-field-metadata">
      <div className="fci-field-badges">
        <StatusBadge label={source.label} tone={source.tone} className="status-badge-compact" />
        <StatusBadge label={review.label} tone={review.tone} className="status-badge-compact" />
        {shouldShowConfidence ? (
          <StatusBadge
            label={`Confiance ${confidence.label.toLowerCase()}`}
            tone={confidence.tone}
            className="status-badge-compact"
          />
        ) : null}
      </div>
      {field.review_status === "human_required" ? (
        <p className="fci-field-callout">Ce champ attend une saisie interne.</p>
      ) : null}
      {showJustification && justification ? (
        <p className="fci-field-justification">{justification}</p>
      ) : null}
      {originalAiValue ? (
        <p className="fci-field-original-value">
          <strong>Proposition IA initiale :</strong> {originalAiValue}
        </p>
      ) : null}
      <FciSourceReferences references={field.source_references} />
    </div>
  );
}
