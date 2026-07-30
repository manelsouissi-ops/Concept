"use client";

import type { ChangeEvent } from "react";
import type {
  FciFieldDefinition,
  FciFormField,
  FciFormFieldValue
} from "@/lib/appels-offres/fci/rendering.ts";
import { getFciNullPlaceholder } from "@/lib/appels-offres/fci/ui.ts";
import { FciFieldMetadata } from "./fci-field-metadata.tsx";

function toInputValue(value: FciFormFieldValue) {
  if (value == null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join("\n");
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function parseChangedValue(
  rawValue: string,
  fieldDefinition: FciFieldDefinition
): FciFormFieldValue {
  if (!rawValue.trim()) {
    return null;
  }

  switch (fieldDefinition.valueType) {
    case "string_array":
      return rawValue
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    case "number": {
      const parsed = Number(rawValue.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean":
      return rawValue === "true";
    default:
      return rawValue;
  }
}

function withEditedField(
  currentField: FciFormField,
  nextValue: FciFormFieldValue
): FciFormField {
  const originalAiValue =
    currentField.source === "ai" && currentField.original_ai_value === undefined
      ? currentField.value
      : currentField.original_ai_value;

  if (currentField.source === "ai" || currentField.review_status === "human_required") {
    return {
      ...currentField,
      value: nextValue,
      source: "human",
      review_status: nextValue == null ? "human_required" : "reviewed",
      confidence: nextValue == null ? "none" : "high",
      original_ai_value: originalAiValue
    };
  }

  return {
    ...currentField,
    value: nextValue,
    review_status: nextValue == null ? "human_required" : "reviewed"
  };
}

function sanitizeFieldPath(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function FciFieldRenderer({
  fieldDefinition,
  field,
  fieldPath,
  errorMessage,
  readOnly = false,
  onChange
}: {
  fieldDefinition: FciFieldDefinition;
  field: FciFormField | null;
  fieldPath?: string;
  errorMessage?: string | null;
  readOnly?: boolean;
  onChange?: (nextField: FciFormField) => void;
}) {
  const pathSuffix = sanitizeFieldPath(fieldPath ?? fieldDefinition.key);
  const inputId = `fci-field-${pathSuffix}`;
  const descriptionId = fieldDefinition.description ? `${inputId}-description` : null;
  const helpId = fieldDefinition.helpText ? `${inputId}-help` : null;
  const errorId = errorMessage ? `${inputId}-error` : null;
  const describedBy = [descriptionId, helpId, errorId].filter(Boolean).join(" ") || undefined;

  if (!field) {
    return (
      <article className="fci-field-card is-readonly" data-fci-field-path={fieldPath}>
        <div className="fci-field-header">
          <label className="fci-field-label">{fieldDefinition.label}</label>
        </div>
        <div className="fci-field-static">{getFciNullPlaceholder()}</div>
      </article>
    );
  }

  const currentField = field;
  const value = toInputValue(field.value);
  const disabled =
    readOnly ||
    fieldDefinition.inputType === "readonly" ||
    !fieldDefinition.editable ||
    !onChange;

  function commitValue(
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    if (!onChange) {
      return;
    }

    const nextValue = parseChangedValue(event.target.value, fieldDefinition);
    onChange(withEditedField(currentField, nextValue));
  }

  const fieldControl =
    disabled ? (
      <div className="fci-field-static" id={inputId} tabIndex={errorMessage ? -1 : undefined}>
        {value || getFciNullPlaceholder()}
      </div>
    ) : fieldDefinition.inputType === "textarea" ? (
      <textarea
        id={inputId}
        className="input textarea"
        value={value}
        onChange={commitValue}
        placeholder={fieldDefinition.placeholder}
        rows={fieldDefinition.multiline ? 5 : 4}
        aria-invalid={errorMessage ? "true" : undefined}
        aria-describedby={describedBy}
      />
    ) : fieldDefinition.inputType === "select" ? (
      <select
        id={inputId}
        className="input select"
        value={value}
        onChange={commitValue}
        aria-invalid={errorMessage ? "true" : undefined}
        aria-describedby={describedBy}
      >
        <option value="">Sélectionner</option>
        {(fieldDefinition.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : fieldDefinition.inputType === "boolean" ? (
      <select
        id={inputId}
        className="input select"
        value={value}
        onChange={commitValue}
        aria-invalid={errorMessage ? "true" : undefined}
        aria-describedby={describedBy}
      >
        <option value="">Non renseigné</option>
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    ) : fieldDefinition.inputType === "list" ? (
      <textarea
        id={inputId}
        className="input textarea"
        value={value}
        onChange={commitValue}
        placeholder={fieldDefinition.placeholder ?? "Une ligne par élément"}
        rows={4}
        aria-invalid={errorMessage ? "true" : undefined}
        aria-describedby={describedBy}
      />
    ) : fieldDefinition.inputType === "percentage" ? (
      <div className="fci-input-with-suffix">
        <input
          id={inputId}
          className="input"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={value}
          onChange={commitValue}
          placeholder={fieldDefinition.placeholder}
          aria-invalid={errorMessage ? "true" : undefined}
          aria-describedby={describedBy}
        />
        <span className="fci-input-suffix" aria-hidden="true">%</span>
      </div>
    ) : (
      <input
        id={inputId}
        className="input"
        type={fieldDefinition.inputType === "date" ? "date" : "text"}
        inputMode={
          fieldDefinition.inputType === "number"
          || fieldDefinition.inputType === "currency"
            ? "decimal"
            : undefined
        }
        value={value}
        onChange={commitValue}
        placeholder={
          fieldDefinition.placeholder
          ?? (fieldDefinition.inputType === "currency" ? "Montant et devise" : undefined)
        }
        aria-invalid={errorMessage ? "true" : undefined}
        aria-describedby={describedBy}
      />
    );

  return (
    <article
      className={`fci-field-card${disabled ? " is-readonly" : ""}${errorMessage ? " has-error" : ""}`}
      data-fci-field-path={fieldPath}
    >
      <div className="fci-field-header">
        <label className="fci-field-label" htmlFor={disabled ? undefined : inputId}>
          {fieldDefinition.label}
          {fieldDefinition.required ? <span className="fci-required-marker">*</span> : null}
        </label>
        {fieldDefinition.description ? (
          <p className="fci-field-description" id={descriptionId ?? undefined}>
            {fieldDefinition.description}
          </p>
        ) : null}
        {fieldDefinition.helpText ? (
          <p className="fci-field-help" id={helpId ?? undefined}>
            {fieldDefinition.helpText}
          </p>
        ) : null}
      </div>

      {fieldControl}

      {errorMessage ? (
        <p className="fci-field-error" id={errorId ?? undefined} role="alert">
          {errorMessage}
        </p>
      ) : null}

      <FciFieldMetadata
        field={field}
        showConfidence={fieldDefinition.showConfidence !== false}
        showJustification={fieldDefinition.showJustification !== false}
      />
    </article>
  );
}
