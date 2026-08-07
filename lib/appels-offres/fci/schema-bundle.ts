type JsonSchema = Record<string, unknown>;

// Each ai/schemas/fci-{module}.schema.json references shared definitions in
// fci-common.schema.json via external $ref (e.g. "https://concept.local/ai/
// schemas/fci-common.schema.json#/$defs/field_base"). That's correct and
// necessary for ajv, which resolves cross-file $ref natively at validation
// time (see ai-validation.ts). But the *same* schema JSON is also serialized
// as plain text and handed to Gemini as `expected_json_schema` (see
// ai-runtime.ts / lib/appels-offres/fci/service.ts launch payload) - Gemini
// never receives fci-common.schema.json separately, so every $ref it sees is
// a dangling URL with no resolvable content. This function inlines every
// $ref into a single self-contained document before that text is built, so
// the model actually sees the enums/shapes it's expected to produce instead
// of an opaque pointer.
function getByPointer(doc: JsonSchema, pointer: string): unknown {
  const parts = pointer
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~")));

  let node: unknown = doc;
  for (const part of parts) {
    if (typeof node !== "object" || node === null) {
      throw new Error(`Cannot resolve JSON pointer "/${parts.join("/")}": stopped at "${part}"`);
    }
    node = (node as Record<string, unknown>)[part];
  }

  if (node === undefined) {
    throw new Error(`JSON pointer "/${parts.join("/")}" resolved to nothing`);
  }

  return node;
}

function resolveRef(
  ref: string,
  currentRoot: JsonSchema,
  commonSchema: JsonSchema,
  commonSchemaId: string
): { doc: JsonSchema; fragment: unknown } {
  const hashIndex = ref.indexOf("#");
  const baseUrl = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
  const pointer = hashIndex === -1 ? "" : ref.slice(hashIndex + 1);

  let doc: JsonSchema;
  if (baseUrl === "") {
    doc = currentRoot;
  } else if (baseUrl === commonSchemaId) {
    doc = commonSchema;
  } else {
    throw new Error(`Unsupported FCI schema $ref base "${baseUrl}" in "${ref}"`);
  }

  return { doc, fragment: pointer ? getByPointer(doc, pointer) : doc };
}

function dereference(
  node: unknown,
  currentRoot: JsonSchema,
  commonSchema: JsonSchema,
  commonSchemaId: string,
  seenRefs: ReadonlySet<string>
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => dereference(item, currentRoot, commonSchema, commonSchemaId, seenRefs));
  }

  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const ref = record.$ref;

    if (typeof ref === "string") {
      if (seenRefs.has(ref)) {
        // Defensive only: none of the current FCI defs are actually
        // circular. Break rather than recurse forever if that ever changes.
        return {};
      }

      const { doc, fragment } = resolveRef(ref, currentRoot, commonSchema, commonSchemaId);
      const nextRoot = doc === commonSchema ? commonSchema : currentRoot;
      return dereference(fragment, nextRoot, commonSchema, commonSchemaId, new Set(seenRefs).add(ref));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = dereference(value, currentRoot, commonSchema, commonSchemaId, seenRefs);
    }
    return result;
  }

  return node;
}

export function dereferenceFciModuleSchema(
  moduleSchema: JsonSchema,
  commonSchema: JsonSchema
): JsonSchema {
  const commonSchemaId = String(commonSchema.$id ?? "");
  if (!commonSchemaId) {
    throw new Error("fci-common.schema.json is missing its $id");
  }

  return dereference(moduleSchema, moduleSchema, commonSchema, commonSchemaId, new Set()) as JsonSchema;
}
