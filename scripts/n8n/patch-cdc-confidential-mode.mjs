#!/usr/bin/env node

import fs from "node:fs";

const path = "n8n/workflows/cdc-initiation-fiche-projet-xml.json";
const workflows = JSON.parse(fs.readFileSync(path, "utf8"));
const workflow = workflows.find((item) => item.id === "f866bd39869c4c11");
if (!workflow) throw new Error("Legacy canonical CDC workflow not found.");

const node = workflow.nodes.find((item) => item.name === "Validate Canonical Launch");
if (!node) throw new Error("Validate Canonical Launch node not found.");

const marker = "const env = typeof $env === 'object' && $env ? $env : {};";
const guard = `

const rawConfidentialMode = String(env.CONFIDENTIAL_MODE || 'false').trim().toLowerCase();
if (!['true', 'false'].includes(rawConfidentialMode)) {
  return [{ json: { launch_valid: false, response_status: 500, response_body: JSON.stringify({ error: 'CONFIDENTIAL_MODE doit valoir exactement true ou false.', code: 'CONFIDENTIAL_MODE_INVALID' }) } }];
}
if (rawConfidentialMode === 'true') {
  return [{ json: { launch_valid: false, response_status: 409, response_body: JSON.stringify({ error: 'Le mode confidentiel interdit tout appel CDC externe.', code: 'CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED' }) } }];
}`;

if (!node.parameters.jsCode.includes("CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED")) {
  if (!node.parameters.jsCode.includes(marker)) throw new Error("Legacy environment marker not found.");
  node.parameters.jsCode = node.parameters.jsCode.replace(marker, marker + guard);
}

fs.writeFileSync(path, JSON.stringify(workflows), "utf8");
console.log(JSON.stringify({ workflow: workflow.id, confidential_guard: true }));
