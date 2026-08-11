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

assert.equal(w1.active, false);
assert.equal(w2.active, false);
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
console.log("Coverage: W1/W2 separation, webhook paths, 202-before-processing, tender-bound Markdown path, size/hash checks, and unchanged final callback path.");
