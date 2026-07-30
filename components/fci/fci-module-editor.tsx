"use client";

import type {
  FciFieldDefinition,
  FciFormField,
  FciFormPayload,
  FciModuleDefinition,
  FciPayloadValidationError,
  FciSectionDefinition
} from "@/lib/appels-offres/fci/rendering.ts";
import {
  createEmptyFciFieldDefinitionValue,
  isFciFieldLike
} from "@/lib/appels-offres/fci/rendering.ts";
import { FciFieldRenderer } from "./fci-field-renderer.tsx";

function asRecord(value: unknown) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function createRowId(sectionKey: string) {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${sectionKey}-${randomPart}`;
}

function ensureFieldValue(
  container: Record<string, unknown>,
  fieldDefinition: FciFieldDefinition
) {
  const current = container[fieldDefinition.key];
  return isFciFieldLike(current)
    ? current
    : createEmptyFciFieldDefinitionValue(fieldDefinition);
}

function withUpdatedPayload(
  payload: FciFormPayload,
  nextData: FciFormPayload["data"]
) {
  return {
    ...payload,
    data: nextData
  } satisfies FciFormPayload;
}

function isFieldVisible(
  fieldDefinition: FciFieldDefinition,
  payload: FciFormPayload
) {
  return fieldDefinition.conditional ? fieldDefinition.conditional(payload) : true;
}

function computeGapField(row: Record<string, unknown>) {
  const required = ensureFieldValue(row, {
    key: "quantite_requise",
    label: "Quantité requise",
    section: "c3_moyens_capacite",
    inputType: "number",
    valueType: "number",
    editable: true,
    required: true
  }).value;
  const available = ensureFieldValue(row, {
    key: "quantite_disponible",
    label: "Quantité disponible",
    section: "c3_moyens_capacite",
    inputType: "number",
    valueType: "number",
    editable: true,
    required: true
  }).value;

  return {
    value:
      typeof required === "number" && typeof available === "number"
        ? required - available
        : null,
    source: "system",
    review_status: "reviewed",
    confidence: "high",
    justification: "Écart calculé automatiquement à partir des quantités requise et disponible.",
    source_references: []
  } satisfies FciFormField<number | null>;
}

function buildValidationMap(validationErrors: FciPayloadValidationError[]) {
  return new Map(validationErrors.map((error) => [error.path, error.message] as const));
}

function getSectionErrors(
  section: FciSectionDefinition,
  validationErrors: FciPayloadValidationError[]
) {
  return validationErrors.filter((error) => error.path === section.key);
}

export function FciModuleEditor({
  definition,
  payload,
  validationErrors = [],
  readOnly = false,
  onChange
}: {
  definition: FciModuleDefinition;
  payload: FciFormPayload;
  validationErrors?: FciPayloadValidationError[];
  readOnly?: boolean;
  onChange: (nextPayload: FciFormPayload) => void;
}) {
  const validationMap = buildValidationMap(validationErrors);

  function updateObjectField(
    section: FciSectionDefinition,
    fieldDefinition: FciFieldDefinition,
    nextField: FciFormField
  ) {
    const currentSection = asRecord(payload.data[section.key]) ?? {};
    onChange(
      withUpdatedPayload(payload, {
        ...payload.data,
        [section.key]: {
          ...currentSection,
          [fieldDefinition.key]: nextField
        }
      })
    );
  }

  function updateTableField(
    section: FciSectionDefinition,
    rowIndex: number,
    fieldDefinition: FciFieldDefinition,
    nextField: FciFormField
  ) {
    const currentRows = Array.isArray(payload.data[section.key])
      ? ([...(payload.data[section.key] as unknown[])] as Record<string, unknown>[])
      : [];
    const currentRow = asRecord(currentRows[rowIndex]) ?? {};
    const nextRow: Record<string, unknown> = {
      ...currentRow,
      [fieldDefinition.key]: nextField
    };

    if (section.key === "c3_moyens_capacite") {
      nextRow.ecart = computeGapField(nextRow);
    }

    currentRows[rowIndex] = nextRow;
    onChange(
      withUpdatedPayload(payload, {
        ...payload.data,
        [section.key]: currentRows
      })
    );
  }

  function addTableRow(section: FciSectionDefinition) {
    const currentRows = Array.isArray(payload.data[section.key])
      ? ([...(payload.data[section.key] as unknown[])] as Record<string, unknown>[])
      : [];

    const newRow = Object.fromEntries(
      section.fields.map((field) => [field.key, createEmptyFciFieldDefinitionValue(field)])
    ) as Record<string, unknown>;
    newRow.row_id = createRowId(section.key);

    if (section.key === "c3_moyens_capacite") {
      newRow.ecart = computeGapField(newRow);
    }

    currentRows.push(newRow);
    onChange(
      withUpdatedPayload(payload, {
        ...payload.data,
        [section.key]: currentRows
      })
    );
  }

  function removeTableRow(section: FciSectionDefinition, rowIndex: number) {
    const currentRows = Array.isArray(payload.data[section.key])
      ? ([...(payload.data[section.key] as unknown[])] as Record<string, unknown>[])
      : [];
    currentRows.splice(rowIndex, 1);
    onChange(
      withUpdatedPayload(payload, {
        ...payload.data,
        [section.key]: currentRows
      })
    );
  }

  return (
    <div className="workspace-stack fci-module-editor">
      {definition.sections.map((section) => {
        const sectionValue = payload.data[section.key];
        const sectionErrors = getSectionErrors(section, validationErrors);

        return (
          <section key={section.key} className="section-card" id={`fci-section-${section.key}`}>
            <div className="section-header">
              <div>
                <h3>{section.title}</h3>
                {section.description ? <p className="meta">{section.description}</p> : null}
              </div>
              {section.display === "table" && !readOnly ? (
                <button
                  type="button"
                  className="button button-ghost button-small"
                  onClick={() => addTableRow(section)}
                >
                  {section.addRowLabel ?? "Ajouter une ligne"}
                </button>
              ) : null}
            </div>
            <div className="section-body">
              {sectionErrors.length ? (
                <div className="callout warning fci-section-validation" role="alert">
                  {sectionErrors.map((error) => (
                    <p key={error.path}>{error.message}</p>
                  ))}
                </div>
              ) : null}

              {section.display === "object" ? (
                <div className="fci-fields-grid">
                  {section.fields
                    .filter((fieldDefinition) => isFieldVisible(fieldDefinition, payload))
                    .map((fieldDefinition) => {
                      const sectionRecord = asRecord(sectionValue) ?? {};
                      const fieldPath = `${section.key}.${fieldDefinition.key}`;
                      return (
                        <FciFieldRenderer
                          key={fieldPath}
                          fieldDefinition={fieldDefinition}
                          field={ensureFieldValue(sectionRecord, fieldDefinition)}
                          fieldPath={fieldPath}
                          errorMessage={validationMap.get(fieldPath) ?? null}
                          readOnly={readOnly}
                          onChange={(nextField) =>
                            updateObjectField(section, fieldDefinition, nextField)
                          }
                        />
                      );
                    })}
                </div>
              ) : Array.isArray(sectionValue) && sectionValue.length ? (
                <div className="fci-table-stack">
                  {sectionValue.map((row, rowIndex) => {
                    const rowRecord = asRecord(row) ?? {};
                    const rowId =
                      typeof rowRecord.row_id === "string" && rowRecord.row_id.trim()
                        ? rowRecord.row_id.trim()
                        : `${section.key}:${rowIndex}`;

                    return (
                      <article key={rowId} className="fci-table-row">
                        <div className="fci-table-row-topline">
                          <strong>Ligne {rowIndex + 1}</strong>
                          {!readOnly ? (
                            <button
                              type="button"
                              className="button button-danger-ghost button-small"
                              onClick={() => removeTableRow(section, rowIndex)}
                            >
                              Supprimer
                            </button>
                          ) : null}
                        </div>
                        <div className="fci-fields-grid">
                          {section.fields
                            .filter((fieldDefinition) => isFieldVisible(fieldDefinition, payload))
                            .map((fieldDefinition) => {
                              const fieldPath = `${section.key}[${rowIndex}].${fieldDefinition.key}`;
                              return (
                                <FciFieldRenderer
                                  key={`${rowId}:${fieldDefinition.key}`}
                                  fieldDefinition={fieldDefinition}
                                  field={ensureFieldValue(rowRecord, fieldDefinition)}
                                  fieldPath={fieldPath}
                                  errorMessage={validationMap.get(fieldPath) ?? null}
                                  readOnly={readOnly}
                                  onChange={(nextField) =>
                                    updateTableField(section, rowIndex, fieldDefinition, nextField)
                                  }
                                />
                              );
                            })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="fci-empty-table" data-fci-field-path={section.key}>
                  <strong>{section.emptyStateTitle ?? "Aucune donnée"}</strong>
                  <p>{section.emptyStateDescription ?? "Ajoutez une première ligne pour commencer."}</p>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
