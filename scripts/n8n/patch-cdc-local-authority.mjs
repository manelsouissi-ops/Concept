#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const target = path.resolve("n8n/workflows/concept-cdc-extraction.json");
const workflows = JSON.parse(fs.readFileSync(target, "utf8"));
const workflow = workflows.find((item) => item.id === "cdcExtractionV1");
if (!workflow) throw new Error("Workflow cdcExtractionV1 not found.");

const node = (name) => {
  const result = workflow.nodes.find((item) => item.name === name);
  if (!result) throw new Error(`Node not found: ${name}`);
  return result;
};

const renameNode = (oldName, newName) => {
  const existing = workflow.nodes.find((item) => item.name === newName);
  if (existing) return existing;
  const original = node(oldName);
  original.name = newName;
  return original;
};

node("Build CDC Extraction Context").parameters.jsCode = node("Build CDC Extraction Context")
  .parameters.jsCode.replace("llm_model:'gemini-3.6-flash'", "llm_model:'qwen3:14b'");

node("Select CDC AI Provider").parameters.jsCode = `const item=$input.first().json;
const env=typeof $env==='object'&&$env?$env:{};
const bool=(name,fallback=false)=>{ const raw=String(env[name]??'').trim().toLowerCase(); if(!raw)return fallback; if(raw==='true')return true; if(raw==='false')return false; throw new Error(name+' doit valoir exactement true ou false.'); };
let provider=String(env.CDC_AI_PROVIDER||'local').trim().toLowerCase();
let routeAllowed=['local','gemini'].includes(provider);
let errorCode=routeAllowed?item.error_code:'AI_PROVIDER_INVALID';
let errorMessage=routeAllowed?item.error_message:'CDC_AI_PROVIDER doit valoir local ou gemini.';
try {
  const confidential=bool('CONFIDENTIAL_MODE',false);
  if(provider==='gemini') {
    const enabled=bool('EXTERNAL_AI_COMPARISON_ENABLED',false);
    const authorized=new Set(String(env.EXTERNAL_AI_AUTHORIZED_CDC_IDS||'').split(',').map(v=>v.trim()).filter(Boolean));
    if(confidential){ routeAllowed=false; errorCode='CONFIDENTIAL_EXTERNAL_PROVIDER_BLOCKED'; errorMessage='Le mode confidentiel interdit tout appel CDC externe.'; }
    else if(!enabled){ routeAllowed=false; errorCode='EXTERNAL_AI_COMPARISON_DISABLED'; errorMessage='La comparaison externe CDC exige une activation explicite.'; }
    else if(!authorized.has(String(item.code_interne))){ routeAllowed=false; errorCode='EXTERNAL_AI_CDC_NOT_AUTHORIZED'; errorMessage='Ce CDC n est pas autorise pour une comparaison externe.'; }
  }
} catch(error) { routeAllowed=false; errorCode='AI_POLICY_CONFIGURATION_INVALID'; errorMessage=String(error.message||error); }
return [{json:{...item,cdc_ai_provider:provider,llm_model:provider==='local'?String(env.LOCAL_FICHE_MODEL||'qwen3:14b'):'gemini-3.6-flash',route_allowed:routeAllowed,error_stage:routeAllowed?item.error_stage:'LLM',error_code:errorCode,error_message:errorMessage}}];`;

const localCall = renameNode("Prepare Local Contract Not Ready", "Call Local Fiche Extraction");
localCall.type = "n8n-nodes-base.httpRequest";
localCall.typeVersion = 4.2;
localCall.onError = "continueErrorOutput";
localCall.parameters = {
  method: "POST",
  url: "={{ String($env.LOCAL_RAG_SERVICE_URL || 'http://127.0.0.1:8091').replace(/\\/+$/, '') + '/v1/extract' }}",
  sendHeaders: true,
  headerParameters: { parameters: [
    { name: "Authorization", value: "=Bearer {{$env.LOCAL_RAG_SERVICE_TOKEN}}" },
    { name: "Content-Type", value: "application/json" }
  ] },
  sendBody: true,
  specifyBody: "json",
  jsonBody: "={{ (function(){ const context=$('Build CDC Extraction Context').first().json; return JSON.stringify({contract_version:String($env.LOCAL_RAG_CONTRACT_VERSION||'local-cdc-shadow.v1'),processing_job_id:context.processing_job_id,correlation_id:context.correlation_id,appel_offre_id:Number(String(context.appel_offre_id).replace(/^ao_/,'')),code_interne:context.code_interne,document_id:Number(context.markdown_document_id),markdown_path:context.markdown_path,markdown_content_hash:context.markdown_content_hash}); })() }}",
  options: { timeout: 600000, response: { response: { responseFormat: "json" } } }
};

const cleanLocal = {
  id: "cdc-clean-local-authoritative-v1",
  name: "Clean Local Fiche Response",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2200, 100],
  parameters: {
    jsCode: "const response=$input.first().json; const context=$('Select CDC AI Provider').first().json; const xml=String(response.canonical_xml||'').trim(); if(response.provider!=='local'||response.generation_model!==context.llm_model||response.validation?.passed!==true||!xml){ throw new Error('LOCAL_FICHE_RESPONSE_INVALID'); } return [{json:{...context,markdown:context.markdown,xml,provider:'local',llm_model:response.generation_model,embedding_model:response.embedding_model,local_validation:response.validation,local_metrics:response.metrics}}];"
  }
};
const existingCleanLocal = workflow.nodes.findIndex((item) => item.name === cleanLocal.name);
if (existingCleanLocal >= 0) workflow.nodes[existingCleanLocal] = cleanLocal;
else workflow.nodes.push(cleanLocal);

if (!node("Clean XML Response").parameters.jsCode.includes("provider: 'gemini'")) {
  node("Clean XML Response").parameters.jsCode = node("Clean XML Response").parameters.jsCode.replace(
    "    charge_estimee_normalization_applied: chargeEstimeeNormalizationApplied,",
    "    charge_estimee_normalization_applied: chargeEstimeeNormalizationApplied,\n    provider: 'gemini',\n    llm_model: 'gemini-3.6-flash',"
  );
}
const providerFailure = renameNode("Prepare Gemini Failure Callback", "Prepare Provider Failure Callback");
providerFailure.parameters.jsCode = `const context=$('Select CDC AI Provider').first().json;
const finishedAt=new Date().toISOString();
const durationMs=Math.max(0,Date.parse(finishedAt)-Date.parse(context.started_at));
const provider=context.cdc_ai_provider;
const input=$input.first().json;
const payload={contract_version:context.contract_version,processing_job_id:context.processing_job_id,appel_offre_id:context.appel_offre_id,code_interne:context.code_interne,correlation_id:context.correlation_id,execution_id:context.execution_id,status:'FAILED',started_at:context.started_at,finished_at:finishedAt,duration_ms:durationMs,metadata:{provider,llm_model:context.llm_model},error:{stage:'LLM',code:provider==='local'?'LOCAL_FICHE_GENERATION_FAILED':'LLM_REQUEST_FAILED',message:String(input.error?.message||input.message||(provider==='local'?'Local Fiche generation failed.':'Gemini request failed.')),retryable:true,provider}};
return [{json:{callback_sign_request:{callback_url:context.callback_url,contract_version:context.contract_version,callback_timestamp:new Date().toISOString(),callback_raw_body:JSON.stringify(payload),terminal_status:'FAILED'}}}];`;

const success = node("Prepare Success Callback");
success.parameters.jsCode = success.parameters.jsCode
  .replace("llm_model: context.llm_model,", "provider: item.json.provider ?? context.cdc_ai_provider,\n    llm_model: item.json.llm_model ?? context.llm_model,\n    embedding_model: item.json.embedding_model ?? null,\n    validation: item.json.local_validation ?? null,");

const validationFailure = node("Prepare Validation Failure Callback");
if (!validationFailure.parameters.jsCode.includes("provider: selectedProvider")) {
  validationFailure.parameters.jsCode = validationFailure.parameters.jsCode
    .replace(
      "const item = $input.first();",
      "const item = $input.first();\nconst selectedProvider = getNodeJson('Select CDC AI Provider')?.cdc_ai_provider ?? 'local';"
    )
    .replace(
      "    llm_model: context.llm_model,",
      "    provider: selectedProvider,\n    llm_model: getNodeJson('Select CDC AI Provider')?.llm_model ?? context.llm_model,"
    )
    .replace("    provider: null,", "    provider: selectedProvider,");
}

const successValidation = node("Validate Success Payload");
if (!successValidation.parameters.jsCode.includes("hasClosingOrSelfClosingTag")) {
  successValidation.parameters.jsCode = successValidation.parameters.jsCode
    .replace(
      "const hasClosingTag = (name) => new RegExp(`</${name}>`, 'i').test(xml);",
      "const hasClosingTag = (name) => new RegExp(`</${name}>`, 'i').test(xml);\nconst hasClosingOrSelfClosingTag = (name) => hasClosingTag(name) || new RegExp(`<${name}\\\\b[^>]*/>`, 'i').test(xml);"
    )
    .replace(
      "if (!hasClosingTag(field)) {\n      fail('XML_INCOMPLETE', `Le XML retourne par Gemini est incomplet : balise fermante </${field}> manquante dans <controle>.`, field);",
      "if (!hasClosingOrSelfClosingTag(field)) {\n      fail('XML_INCOMPLETE', `Le XML canonique est incomplet : balise fermante ou auto-fermante pour <${field}> manquante dans <controle>.`, field);"
    );
}

workflow.connections["CDC AI Provider Valid?"] = { main: [
  [{ node: "CDC AI Provider Local?", type: "main", index: 0 }],
  [{ node: "Prepare Validation Failure Callback", type: "main", index: 0 }]
] };
workflow.connections["CDC AI Provider Local?"] = { main: [
  [{ node: "Call Local Fiche Extraction", type: "main", index: 0 }],
  [{ node: "HTTP Request → Gemini XML", type: "main", index: 0 }]
] };
workflow.connections["Call Local Fiche Extraction"] = { main: [
  [{ node: "Clean Local Fiche Response", type: "main", index: 0 }],
  [{ node: "Prepare Provider Failure Callback", type: "main", index: 0 }]
] };
workflow.connections["Clean Local Fiche Response"] = { main: [[{ node: "Validate Success Payload", type: "main", index: 0 }]] };
workflow.connections["HTTP Request → Gemini XML"].main[1] = [{ node: "Prepare Provider Failure Callback", type: "main", index: 0 }];
workflow.connections["Success Payload Valid?"].main[0] = [{ node: "Prepare Success Callback", type: "main", index: 0 }];
workflow.connections["Prepare Provider Failure Callback"] = { main: [[{ node: "Sign Canonical Callback", type: "main", index: 0 }]] };
delete workflow.connections["Prepare Local Contract Not Ready"];
delete workflow.connections["Prepare Gemini Failure Callback"];
for (const name of ["CDC AI Shadow Enabled?", "Call Local RAG Shadow", "Continue Authoritative Gemini Success"]) {
  workflow.nodes = workflow.nodes.filter((item) => item.name !== name);
  delete workflow.connections[name];
}

fs.writeFileSync(target, `${JSON.stringify(workflows, null, 2)}\n`);
console.log(JSON.stringify({ workflow: workflow.id, authoritativeDefault: "local", model: "qwen3:14b" }));
