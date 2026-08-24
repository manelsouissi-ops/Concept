#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const workflows = JSON.parse(fs.readFileSync("n8n/workflows/concept-cdc-extraction.json", "utf8"));
const workflow = workflows.find((item) => item.id === "cdcExtractionV1");
assert(workflow, "cdcExtractionV1 must exist");

const nodes = new Map(workflow.nodes.map((node) => [node.name, node]));
for (const name of [
  "Select CDC AI Provider",
  "CDC AI Provider Valid?",
  "HTTP Request → Gemini XML",
  "Continue Authoritative Gemini Success"
]) assert(nodes.has(name), `Missing node: ${name}`);

const connection = (from, branch = 0) =>
  workflow.connections[from]?.main?.[branch]?.map((item) => item.node) ?? [];

assert.deepEqual(connection("Artifact Valid?", 0), ["Select CDC AI Provider"]);
assert.deepEqual(connection("CDC AI Provider Valid?", 0), ["HTTP Request → Gemini XML"]);
assert.deepEqual(connection("CDC AI Provider Valid?", 1), ["Prepare Validation Failure Callback"]);
assert.deepEqual(connection("Success Payload Valid?", 0), ["Continue Authoritative Gemini Success"]);
assert.deepEqual(connection("Continue Authoritative Gemini Success"), ["Prepare Success Callback"]);

const providerCode = nodes.get("Select CDC AI Provider").parameters.jsCode;
assert.match(providerCode, /CDC_AI_PROVIDER\|\|'gemini'/, "Gemini must remain the default");
assert.match(providerCode, /\['gemini','shadow','local'\]/, "Only controlled providers are accepted");
assert.match(providerCode, /CONFIDENTIAL_MODE\|\|'false'/, "Confidential mode must default off");
assert.match(providerCode, /routeAllowed=.*!confidentialMode/, "Confidential mode must block the external route");
assert.match(providerCode, /CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED/);
assert.match(nodes.get("Continue Authoritative Gemini Success").parameters.jsCode, /Validate Success Payload/);

const executeProviderNode = (environment) => {
  const input = { first: () => ({ json: {} }) };
  return Function("$input", "$env", providerCode)(input, environment)[0].json;
};

for (const provider of ["gemini", "shadow", "local"]) {
  const result = executeProviderNode({ CONFIDENTIAL_MODE: "true", CDC_AI_PROVIDER: provider });
  assert.equal(result.route_allowed, false, `confidential ${provider} must be blocked`);
}
assert.equal(executeProviderNode({ CONFIDENTIAL_MODE: "false", CDC_AI_PROVIDER: "gemini" }).route_allowed, true);
assert.equal(executeProviderNode({ CONFIDENTIAL_MODE: "false", CDC_AI_PROVIDER: "shadow" }).route_allowed, true);
assert.equal(executeProviderNode({ CONFIDENTIAL_MODE: "false", CDC_AI_PROVIDER: "local" }).route_allowed, false);
assert.equal(executeProviderNode({ CONFIDENTIAL_MODE: "yes", CDC_AI_PROVIDER: "gemini" }).route_allowed, false);

const reachable = (start) => {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const branch of workflow.connections[current]?.main ?? []) {
      for (const target of branch ?? []) queue.push(target.node);
    }
  }
  return seen;
};
assert.equal(reachable("Prepare Validation Failure Callback").has("HTTP Request → Gemini XML"), false);
assert.equal(reachable("Continue Authoritative Gemini Success").has("Call Local RAG Shadow"), false);

const legacyWorkflows = JSON.parse(fs.readFileSync("n8n/workflows/cdc-initiation-fiche-projet-xml.json", "utf8"));
const legacy = legacyWorkflows.find((item) => item.id === "f866bd39869c4c11");
assert(legacy, "legacy canonical CDC workflow must exist");
const legacyGuard = legacy.nodes.find((node) => node.name === "Validate Canonical Launch")?.parameters?.jsCode;
assert.match(legacyGuard, /CONFIDENTIAL_MODE/);
assert.match(legacyGuard, /CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED/);
const legacyResult = Function("$input", "$env", legacyGuard)(
  { first: () => ({ json: { body: {}, headers: {} } }) },
  { CONFIDENTIAL_MODE: "true" }
)[0].json;
assert.equal(legacyResult.launch_valid, false);
assert.equal(JSON.parse(legacyResult.response_body).code, "CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED");

console.log(JSON.stringify({
  workflow: workflow.id,
  gemini_default_preserved: true,
  confidential_external_route_blocked: true,
  legacy_confidential_launch_blocked: true,
  n8n_shadow_duplication_removed: true,
  local_mode_fails_closed: true,
  canonical_success_callback_preserved: true
}));
