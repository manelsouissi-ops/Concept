import assert from "node:assert/strict";
import fs from "node:fs";

const readWorkflow = (name) => JSON.parse(
  fs.readFileSync(new URL(`../n8n/workflows/${name}.json`, import.meta.url), "utf8")
)[0];

const w1 = readWorkflow("concept-document-processing");
const w2 = readWorkflow("concept-cdc-extraction");
const names = (workflow) => new Set(workflow.nodes.map((node) => node.name));
const code = (workflow, nodeName) => String(
  workflow.nodes.find((node) => node.name === nodeName)?.parameters?.jsCode ?? ""
);
const runCodeNode = (source, inputJson, nodeJsonByName = {}) => {
  const input = { first: () => ({ json: inputJson }) };
  const lookup = (name) => ({ first: () => ({ json: nodeJsonByName[name] ?? {} }) });
  return Function("$input", "$", source)(input, lookup)[0].json;
};
const chargeCount = (xml) => (String(xml).match(/<charge_estimee(?:\s|>)/gi) ?? []).length;

assert.equal(w1.active, false);
assert.equal(w2.active, true);
assert.equal(
  w1.nodes.find((node) => node.name === "Webhook Document Processing")?.parameters?.path,
  "concept-document-processing"
);
assert.equal(
  w2.nodes.find((node) => node.name === "Webhook CDC Extraction")?.parameters?.path,
  "concept-cdc-extraction"
);

assert(names(w1).has("Convert PDF via Document Parser"));
assert(!names(w1).has("HTTP Request → Gemini XML"));
assert(!names(w2).has("Convert PDF via Document Parser"));
assert(!names(w2).has("Read Source PDF From Disk"));
assert(names(w2).has("Read Persisted Markdown"));
assert(names(w2).has("HTTP Request → Gemini XML"));

const cleanXml = code(w2, "Clean XML Response");
const validateXml = code(w2, "Validate Success Payload");
const clean = (candidate) => runCodeNode(
  cleanXml,
  { choices: [{ message: { content: candidate } }] },
  { "Read Markdown as Text": { markdown: "fixture markdown" } },
);

const existingValue = "<fiche_projet><evaluation><risque_sous_dimensionnement note=\"3\"><charge_estimee>15 jours-homme</charge_estimee><justification>x</justification></risque_sous_dimensionnement></evaluation></fiche_projet>";
const existingValueResult = clean(existingValue);
assert.equal(existingValueResult.xml, existingValue);
assert.equal(existingValueResult.charge_estimee_normalization_applied, false);

const existingPlaceholder = "<fiche_projet><evaluation><risque_sous_dimensionnement note=\"3\"><charge_estimee>Non trouvé</charge_estimee><justification>x</justification></risque_sous_dimensionnement></evaluation></fiche_projet>";
const existingPlaceholderResult = clean(existingPlaceholder);
assert.equal(existingPlaceholderResult.xml, existingPlaceholder);
assert.equal(existingPlaceholderResult.charge_estimee_normalization_applied, false);

const missingCharge = "<fiche_projet><evaluation><risque_sous_dimensionnement note=\"3\"><justification>x</justification></risque_sous_dimensionnement></evaluation></fiche_projet>";
const normalized = clean(missingCharge);
assert.equal(chargeCount(normalized.xml), 1);
assert.match(normalized.xml, /<charge_estimee>Non trouvé<\/charge_estimee>/);
assert.equal(normalized.candidate_xml_charge_estimee_present, false);
assert.equal(normalized.charge_estimee_normalization_applied, true);

const normalizedTwice = clean(normalized.xml);
assert.equal(chargeCount(normalizedTwice.xml), 1);
assert.equal(normalizedTwice.xml, normalized.xml);
assert.equal(normalizedTwice.charge_estimee_normalization_applied, false);

const unrelatedMalformed = "<fiche_projet><evaluation><risque_sous_dimensionnement note=\"3\"><justification>x</justification></charge_estimee></risque_sous_dimensionnement></evaluation></fiche_projet>";
const malformedResult = clean(unrelatedMalformed);
assert.equal(malformedResult.xml, unrelatedMalformed);
assert.equal(malformedResult.charge_estimee_normalization_applied, false);
assert.equal(runCodeNode(validateXml, { ...malformedResult, markdown: "fixture markdown" }).success_ready, false);
assert.match(validateXml, /XML_SCHEMA_INVALID/);

const w2Context = code(w2, "Build CDC Extraction Context");
assert.match(w2Context, /item\.code_interne\+'\/cdc\.md'/);
assert.match(w2Context, /markdown_content_hash/);
assert.match(w2Context, /markdown_byte_size/);
assert.match(w2Context, /\/api\/fiche\/callbacks\/n8n/);

const integrity = code(w2, "Verify Persisted Markdown");
assert.match(integrity, /actual_byte_size===j\.markdown_byte_size/);
assert.match(integrity, /actual_sha256/);
assert.match(integrity, /MARKDOWN_INTEGRITY_MISMATCH/);

assert.deepEqual(
  w2.connections["Launch Ready?"].main[0].map((edge) => edge.node),
  ["Respond 202 Accepted"]
);
assert.deepEqual(
  w2.connections["Respond 202 Accepted"].main[0].map((edge) => edge.node),
  ["Read Persisted Markdown"]
);

for (const workflow of [w1, w2]) {
  const allTargets = Object.values(workflow.connections)
    .flatMap((connection) => connection.main ?? [])
    .flatMap((output) => output ?? [])
    .map((edge) => edge.node);
  assert(!allTargets.includes(workflow === w1 ? "Webhook CDC Extraction" : "Webhook Document Processing"));
}

console.log("verify-cdc-split-workflows: OK");
console.log("Coverage: W1/W2 separation, webhook paths, 202-before-processing, tender-bound Markdown path, size/hash checks, strict validation, and idempotent charge_estimee normalization.");
