import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = JSON.parse(readFileSync(
  "n8n/workflows/fci-module-generation.json",
  "utf8"
))[0] as { nodes: Array<{ name: string; parameters: Record<string, unknown> }> };

test("FCI workflow routes A local without a Gemini fallback", () => {
  const context = workflow.nodes.find((node) => node.name === "Build FCI Context");
  assert.ok(context);
  const code = String(context.parameters.jsCode);
  assert.match(code, /module_code === 'A'/);
  assert.match(code, /127\.0\.0\.1:11434\/api\/chat/);
  assert.match(code, /LOCAL_FCI_MODEL \|\| 'qwen3:14b'/);
  assert.match(code, /EXTERNAL_AI_COMPARISON_ENABLED/);
  assert.match(code, /EXTERNAL_AI_AUTHORIZED_CDC_IDS/);
  assert.match(code, /FCI A externe non autorisee/);
  assert.equal(workflow.nodes.some((node) => node.name.includes("Fallback")), false);
});

test("FCI workflow routes B local without a Gemini fallback", () => {
  const context = workflow.nodes.find((node) => node.name === "Build FCI Context");
  assert.ok(context);
  const code = String(context.parameters.jsCode);
  assert.match(code, /module_code === 'B'/);
  assert.match(code, /Modele local FCI B inattendu/);
  assert.match(code, /FCI B externe non autorisee/);
  assert.equal(workflow.nodes.some((node) => node.name.includes("Fallback")), false);
});

test("FCI workflow routes C local without a Gemini fallback", () => {
  const context = workflow.nodes.find((node) => node.name === "Build FCI Context");
  assert.ok(context);
  const code = String(context.parameters.jsCode);
  assert.match(code, /module_code === 'C'/);
  assert.match(code, /Modele local FCI C inattendu/);
  assert.match(code, /FCI C externe non autorisee/);
  assert.equal(workflow.nodes.some((node) => node.name.includes("Fallback")), false);
});

test("shared workflow explicitly keeps D on Gemini", () => {
  const context = workflow.nodes.find((node) => node.name === "Build FCI Context");
  const code = String(context?.parameters.jsCode);
  assert.match(code, /FCI D conserve son provider existant/);
  assert.match(
    code,
    /module_code !== 'A' && item\.json\.module_code !== 'B' && item\.json\.module_code !== 'C'/
  );
});
