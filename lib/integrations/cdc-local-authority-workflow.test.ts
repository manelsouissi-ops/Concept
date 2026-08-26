import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflows = JSON.parse(
  readFileSync("n8n/workflows/concept-cdc-extraction.json", "utf8")
) as Array<{
  id: string;
  nodes: Array<{ name: string; type: string; parameters: Record<string, unknown> }>;
  connections: Record<string, { main: Array<Array<{ node: string }>> }>;
}>;
const workflow = workflows.find((item) => item.id === "cdcExtractionV1");
assert.ok(workflow);

const node = (name: string) => {
  const found = workflow.nodes.find((item) => item.name === name);
  assert.ok(found, `missing workflow node ${name}`);
  return found;
};

test("normal CDC extraction defaults to local qwen3:14b", () => {
  const selector = String(node("Select CDC AI Provider").parameters.jsCode);
  assert.match(selector, /CDC_AI_PROVIDER\|\|'local'/);
  assert.match(selector, /LOCAL_FICHE_MODEL\|\|'qwen3:14b'/);
  assert.equal(node("Call Local Fiche Extraction").type, "n8n-nodes-base.httpRequest");
  assert.match(String(node("Call Local Fiche Extraction").parameters.url), /\/v1\/extract/);
});

test("Gemini requires opt-in and an authorized CDC identifier", () => {
  const selector = String(node("Select CDC AI Provider").parameters.jsCode);
  assert.match(selector, /EXTERNAL_AI_COMPARISON_ENABLED/);
  assert.match(selector, /EXTERNAL_AI_AUTHORIZED_CDC_IDS/);
  assert.match(selector, /authorized\.has/);
});

test("local failure routes directly to a failed callback without Gemini fallback", () => {
  const outputs = workflow.connections["Call Local Fiche Extraction"].main;
  assert.deepEqual(outputs[0].map((item) => item.node), ["Clean Local Fiche Response"]);
  assert.deepEqual(outputs[1].map((item) => item.node), ["Prepare Provider Failure Callback"]);
  assert.match(String(node("Prepare Provider Failure Callback").parameters.jsCode), /LOCAL_FICHE_GENERATION_FAILED/);
});

test("local validation and provider metadata enter the canonical callback", () => {
  const clean = String(node("Clean Local Fiche Response").parameters.jsCode);
  const success = String(node("Prepare Success Callback").parameters.jsCode);
  const validationFailure = String(node("Prepare Validation Failure Callback").parameters.jsCode);
  assert.match(clean, /validation\?\.passed!==true/);
  assert.match(clean, /canonical_xml/);
  assert.match(success, /provider:/);
  assert.match(success, /embedding_model:/);
  assert.match(validationFailure, /provider: selectedProvider/);
  assert.deepEqual(
    workflow.connections["Success Payload Valid?"].main[0].map((item) => item.node),
    ["Prepare Success Callback"]
  );
});

test("automatic external shadow nodes are absent", () => {
  const names = new Set(workflow.nodes.map((item) => item.name));
  assert.equal(names.has("Call Local RAG Shadow"), false);
  assert.equal(names.has("CDC AI Shadow Enabled?"), false);
});
