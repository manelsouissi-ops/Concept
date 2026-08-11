#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const workflows = JSON.parse(fs.readFileSync("n8n/workflows/concept-cdc-extraction.json", "utf8"));
const workflow = workflows.find((item) => item.id === "cdcExtractionV1");
assert(workflow, "cdcExtractionV1 must exist");

const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
const required = [
  "Select CDC AI Provider",
  "CDC AI Provider Valid?",
  "CDC AI Provider Local?",
  "Prepare Local Contract Not Ready",
  "CDC AI Shadow Enabled?",
  "Call Local RAG Shadow",
  "Continue Authoritative Gemini Success"
];
for (const name of required) assert(nodes.has(name), `Missing node: ${name}`);

const connection = (from, branch = 0) =>
  workflow.connections[from]?.main?.[branch]?.map((item) => item.node) ?? [];

assert.deepEqual(connection("Artifact Valid?", 0), ["Select CDC AI Provider"]);
assert.deepEqual(connection("CDC AI Provider Valid?", 0), ["CDC AI Provider Local?"]);
assert.deepEqual(connection("CDC AI Provider Valid?", 1), ["Prepare Validation Failure Callback"]);
assert.deepEqual(connection("CDC AI Provider Local?", 0), ["Prepare Local Contract Not Ready"]);
assert.deepEqual(connection("CDC AI Provider Local?", 1), ["HTTP Request → Gemini XML"]);
assert.deepEqual(connection("Prepare Local Contract Not Ready"), ["Prepare Validation Failure Callback"]);
assert.deepEqual(connection("Success Payload Valid?", 0), ["CDC AI Shadow Enabled?"]);
assert.deepEqual(connection("CDC AI Shadow Enabled?", 0), ["Call Local RAG Shadow"]);
assert.deepEqual(connection("CDC AI Shadow Enabled?", 1), ["Continue Authoritative Gemini Success"]);
assert.deepEqual(connection("Call Local RAG Shadow"), ["Continue Authoritative Gemini Success"]);
assert.deepEqual(connection("Continue Authoritative Gemini Success"), ["Prepare Success Callback"]);

const providerCode = nodes.get("Select CDC AI Provider").parameters.jsCode;
assert.match(providerCode, /CDC_AI_PROVIDER\|\|'gemini'/, "Gemini must remain the default");
assert.match(providerCode, /\['gemini','shadow','local'\]/, "Only controlled providers are accepted");
assert.equal(nodes.get("Call Local RAG Shadow").onError, "continueRegularOutput");
assert.match(nodes.get("Continue Authoritative Gemini Success").parameters.jsCode, /Validate Success Payload/);
assert.match(nodes.get("Prepare Local Contract Not Ready").parameters.jsCode, /LOCAL_CANONICAL_CONTRACT_NOT_READY/);

console.log(JSON.stringify({
  workflow: workflow.id,
  gemini_default_preserved: true,
  shadow_failure_non_authoritative: true,
  local_mode_fails_closed: true,
  canonical_success_callback_preserved: true
}));
