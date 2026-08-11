#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const target = path.resolve("n8n/workflows/concept-cdc-extraction.json");
const workflows = JSON.parse(fs.readFileSync(target, "utf8"));
const workflow = workflows.find((item) => item.id === "cdcExtractionV1");
if (!workflow) throw new Error("Workflow cdcExtractionV1 not found.");
workflow.active = true;

const additions = [
  {
    id: "cdc-provider-select-v1",
    name: "Select CDC AI Provider",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1320, 260],
    parameters: {
      jsCode: "const item=$input.first().json; const env=typeof $env==='object'&&$env?$env:{}; const provider=String(env.CDC_AI_PROVIDER||'gemini').trim().toLowerCase(); const valid=['gemini','shadow','local'].includes(provider); return [{json:{...item,cdc_ai_provider:provider,provider_valid:valid,error_stage:valid?item.error_stage:'LLM',error_code:valid?item.error_code:'AI_PROVIDER_INVALID',error_message:valid?item.error_message:'CDC_AI_PROVIDER doit valoir gemini, shadow ou local.'}}];"
    }
  },
  {
    id: "cdc-provider-valid-v1",
    name: "CDC AI Provider Valid?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1540, 260],
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ leftValue: "={{ $json.provider_valid }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" },
      options: {}
    }
  },
  {
    id: "cdc-provider-local-v1",
    name: "CDC AI Provider Local?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [1760, 220],
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ leftValue: "={{ $json.cdc_ai_provider }}", rightValue: "local", operator: { type: "string", operation: "equals" } }], combinator: "and" },
      options: {}
    }
  },
  {
    id: "cdc-local-not-ready-v1",
    name: "Prepare Local Contract Not Ready",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1980, 100],
    parameters: {
      jsCode: "return [{json:{...$input.first().json,error_stage:'LLM',error_code:'LOCAL_CANONICAL_CONTRACT_NOT_READY',error_message:'Le fournisseur local est limite au shadow: le contrat XML canonique complet 34 champs/evaluation/controle n est pas encore valide.',local_provider:'qwen3:14b'}}];"
    }
  },
  {
    id: "cdc-shadow-enabled-v1",
    name: "CDC AI Shadow Enabled?",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [2860, 220],
    parameters: {
      conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ leftValue: "={{ $('Select CDC AI Provider').first().json.cdc_ai_provider }}", rightValue: "shadow", operator: { type: "string", operation: "equals" } }], combinator: "and" },
      options: {}
    }
  },
  {
    id: "cdc-local-shadow-call-v1",
    name: "Call Local RAG Shadow",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [3080, 120],
    onError: "continueRegularOutput",
    parameters: {
      method: "POST",
      url: "={{ String($env.LOCAL_RAG_SERVICE_URL || 'http://127.0.0.1:8091').replace(/\\/+$/, '') + '/v1/shadow' }}",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{$env.LOCAL_RAG_SERVICE_TOKEN}}" }, { name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ (function(){ const context=$('Build CDC Extraction Context').first().json; const validated=$('Validate Success Payload').first().json; return JSON.stringify({contract_version:String($env.LOCAL_RAG_CONTRACT_VERSION||'local-cdc-shadow.v1'),processing_job_id:context.processing_job_id,correlation_id:context.correlation_id,appel_offre_id:Number(context.appel_offre_id),code_interne:context.code_interne,document_id:Number(context.markdown_document_id),markdown_path:context.markdown_path,markdown_content_hash:context.markdown_content_hash,authoritative_xml:validated.xml}); })() }}",
      options: { timeout: 600000, response: { response: { responseFormat: "json" } } }
    }
  },
  {
    id: "cdc-continue-authoritative-v1",
    name: "Continue Authoritative Gemini Success",
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [3300, 220],
    parameters: {
      jsCode: "const provider=$('Select CDC AI Provider').first().json.cdc_ai_provider; const shadowInput=$input.first().json; if(provider==='shadow'){ const ok=['recorded','duplicate'].includes(shadowInput?.status); console.log(JSON.stringify({event:'cdc_local_ai_shadow',provider:'local',authoritative_provider:'gemini',shadow_ok:ok,shadow_status:shadowInput?.status||'failed',local_persisted:false,code_interne:$('Build CDC Extraction Context').first().json.code_interne,error:ok?null:String(shadowInput?.error?.message||shadowInput?.message||shadowInput?.error||'LOCAL_SHADOW_UNAVAILABLE')})); } return [{json:$('Validate Success Payload').first().json}];"
    }
  }
];

for (const node of additions) {
  const existingIndex = workflow.nodes.findIndex((item) => item.name === node.name);
  if (existingIndex >= 0) workflow.nodes[existingIndex] = node;
  else workflow.nodes.push(node);
}

workflow.connections["Artifact Valid?"].main[0] = [{ node: "Select CDC AI Provider", type: "main", index: 0 }];
workflow.connections["Select CDC AI Provider"] = { main: [[{ node: "CDC AI Provider Valid?", type: "main", index: 0 }]] };
workflow.connections["CDC AI Provider Valid?"] = { main: [[{ node: "CDC AI Provider Local?", type: "main", index: 0 }], [{ node: "Prepare Validation Failure Callback", type: "main", index: 0 }]] };
workflow.connections["CDC AI Provider Local?"] = { main: [[{ node: "Prepare Local Contract Not Ready", type: "main", index: 0 }], [{ node: "HTTP Request → Gemini XML", type: "main", index: 0 }]] };
workflow.connections["Prepare Local Contract Not Ready"] = { main: [[{ node: "Prepare Validation Failure Callback", type: "main", index: 0 }]] };
workflow.connections["Success Payload Valid?"].main[0] = [{ node: "CDC AI Shadow Enabled?", type: "main", index: 0 }];
workflow.connections["CDC AI Shadow Enabled?"] = { main: [[{ node: "Call Local RAG Shadow", type: "main", index: 0 }], [{ node: "Continue Authoritative Gemini Success", type: "main", index: 0 }]] };
workflow.connections["Call Local RAG Shadow"] = { main: [[{ node: "Continue Authoritative Gemini Success", type: "main", index: 0 }]] };
workflow.connections["Continue Authoritative Gemini Success"] = { main: [[{ node: "Prepare Success Callback", type: "main", index: 0 }]] };

fs.writeFileSync(target, `${JSON.stringify(workflows, null, 2)}\n`);
console.log(JSON.stringify({ workflow: workflow.id, nodes: workflow.nodes.length, providerDefault: "gemini" }));
