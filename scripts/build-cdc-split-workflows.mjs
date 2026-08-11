import fs from "node:fs";
import crypto from "node:crypto";

const [baseline] = JSON.parse(fs.readFileSync("n8n/workflows/cdc-initiation-fiche-projet-xml.json", "utf8"));
const byName = new Map(baseline.nodes.map((node) => [node.name, structuredClone(node)]));
const pick = (...names) => names.map((name) => {
  const node = byName.get(name);
  if (!node) throw new Error(`Baseline node missing: ${name}`);
  return structuredClone(node);
});
const id = () => crypto.randomUUID();
const codeNode = (name, jsCode, position) => ({ parameters: { jsCode }, id: id(), name, type: "n8n-nodes-base.code", typeVersion: 2, position });
const ifNode = (name, expression, position) => ({
  parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ leftValue: expression, rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }], combinator: "and" }, options: {} },
  id: id(), name, type: "n8n-nodes-base.if", typeVersion: 2.2, position
});
const connect = (...names) => Object.fromEntries(names.slice(0, -1).map((name, index) => [name, { main: [[{ node: names[index + 1], type: "main", index: 0 }]] }]));

const w1Nodes = pick(
  "Webhook CDC Initiation", "Validate Canonical Launch", "Launch Valid?", "Build Canonical Context", "Launch Ready?",
  "Respond Launch Rejected", "Respond 202 Accepted", "Read Source PDF From Disk", "Prepare Source PDF Read Failure",
  "Validate Source PDF Binary", "Source PDF Valid?", "Convert PDF via FastAPI Marker", "Init Marker Poll Guard",
  "Wait 30s Before Marker Result", "Increment Marker Poll Guard", "Marker Timeout Reached?", "Get Marker Status",
  "Merge Marker Result With Guard", "Check Marker Status", "Get Marker Result", "Read Markdown as Text",
  "Prepare Marker Failure Callback", "Prepare Marker Timeout Callback", "Prepare Validation Failure Callback",
  "Sign Canonical Callback", "Unwrap Signed Callback", "Send Canonical Callback"
);
const renameW1 = new Map([
  ["Webhook CDC Initiation", "Webhook Document Processing"],
  ["Build Canonical Context", "Build Document Context"],
  ["Convert PDF via FastAPI Marker", "Convert PDF via Document Parser"],
  ["Send Canonical Callback", "Send Document Callback"]
]);
for (const node of w1Nodes) node.name = renameW1.get(node.name) ?? node.name;
const w1Webhook = w1Nodes.find((n) => n.name === "Webhook Document Processing");
w1Webhook.parameters.path = "concept-document-processing";
w1Webhook.webhookId = id();
const w1Validate = w1Nodes.find((n) => n.name === "Validate Canonical Launch");
w1Validate.parameters.jsCode = w1Validate.parameters.jsCode.replace("pdf_path = requireField('pdf_path');", "pdf_path = requireField('pdf_path');\n  const idem = getHeader('idempotency-key');\n  if (idem !== correlationId + ':document-processing') throw new Error('idempotency-key');");
const w1Build = w1Nodes.find((n) => n.name === "Build Document Context");
w1Build.parameters.jsCode = w1Build.parameters.jsCode
  .replaceAll("Build Canonical Context", "Build Document Context")
  .replace("llm_model: 'gemini-3.6-flash',", "parser_provider: String(item.json.requested_parser || env.DOCUMENT_PARSER || 'docling').trim(),");
for (const node of w1Nodes) {
  const raw = JSON.stringify(node.parameters);
  node.parameters = JSON.parse(raw.replaceAll("Build Canonical Context", "Build Document Context"));
}
for (const failureName of ["Prepare Marker Failure Callback", "Prepare Marker Timeout Callback", "Prepare Validation Failure Callback"]) {
  const node = w1Nodes.find((candidate) => candidate.name === failureName);
  node.parameters.jsCode = `const context=$('Build Document Context').first().json; const item=$input.first().json??{}; const finished=new Date().toISOString();
const stage=String(item.error_stage||(${JSON.stringify(failureName)}.includes('Marker')?'PARSER':'UNKNOWN')); const code=String(item.error_code||(${JSON.stringify(failureName)}.includes('Timeout')?'PARSER_TIMEOUT':'DOCUMENT_PROCESSING_FAILED')); const message=String(item.error_message||item.error?.message||item.error||'Le traitement documentaire a echoue.');
const payload={event:'document.processing.failed',contract_version:context.contract_version,processing_job_id:context.processing_job_id,appel_offre_id:context.appel_offre_id,code_interne:context.code_interne,correlation_id:context.correlation_id,execution_id:context.execution_id,status:'FAILED',started_at:context.started_at,finished_at:finished,duration_ms:Math.max(0,Date.parse(finished)-Date.parse(context.started_at)),metadata:{parser_provider:context.parser_provider},error:{stage:['WEBHOOK','UPLOAD','PARSER','MARKDOWN','CALLBACK'].includes(stage)?stage:'UNKNOWN',code,message,retryable:stage==='PARSER'||stage==='UPLOAD'}};
return [{json:{callback_sign_request:{callback_url:context.callback_url,contract_version:context.contract_version,callback_timestamp:new Date().toISOString(),callback_raw_body:JSON.stringify(payload),terminal_status:'FAILED'}}}];`;
}
const validateMarkdown = codeNode("Validate Clean Markdown", `const item = $input.first();
const markdown = String(item.json.markdown || item.json.text || '');
const bytes = Buffer.byteLength(markdown, 'utf8');
const clean = markdown.trim().length > 0 && !/data:image\\/[^;]+;base64,/i.test(markdown);
return [{json:{...item.json, markdown, markdown_valid:clean, markdown_byte_size:bytes, error_stage:'MARKDOWN', error_code:clean?null:'MARKDOWN_INVALID', error_message:clean?null:'Markdown vide ou contenant une image base64.'}}];`, [1840, 752]);
const markdownValid = ifNode("Markdown Valid?", "={{ $json.markdown_valid }}", [2064, 752]);
const hashMarkdown = { parameters: { action: "hash", type: "SHA256", value: "={{ $json.markdown }}", dataPropertyName: "markdown_sha256" }, id: id(), name: "Hash Markdown", type: "n8n-nodes-base.crypto", typeVersion: 1, position: [2288, 672] };
const prepareW1Success = codeNode("Prepare Document Success Callback", `const context=$('Build Document Context').first().json; const item=$input.first().json; const finished=new Date().toISOString();
const payload={event:'document.processing.completed',contract_version:context.contract_version,processing_job_id:context.processing_job_id,appel_offre_id:context.appel_offre_id,code_interne:context.code_interne,correlation_id:context.correlation_id,execution_id:context.execution_id,status:'COMPLETED',parser:{provider:context.parser_provider,job_id:String(item.job_id||'unknown')},started_at:context.started_at,finished_at:finished,duration_ms:Math.max(0,Date.parse(finished)-Date.parse(context.started_at)),metadata:{parser_poll_count:$('Increment Marker Poll Guard').first()?.json?.marker_poll_count??null},result:{markdown:item.markdown,byte_size:item.markdown_byte_size,content_hash:'sha256:'+item.markdown_sha256,mime_type:'text/markdown'}};
return [{json:{callback_sign_request:{callback_url:context.callback_url,contract_version:context.contract_version,callback_timestamp:new Date().toISOString(),callback_raw_body:JSON.stringify(payload),terminal_status:'COMPLETED'}}}];`, [2512, 672]);
w1Nodes.push(validateMarkdown, markdownValid, hashMarkdown, prepareW1Success);
const w1Connections = structuredClone(baseline.connections);
for (const [oldName, newName] of renameW1) {
  if (w1Connections[oldName]) { w1Connections[newName] = w1Connections[oldName]; delete w1Connections[oldName]; }
  for (const connection of Object.values(w1Connections)) for (const outputs of connection.main ?? []) for (const edge of outputs ?? []) if (edge.node === oldName) edge.node = newName;
}
const allowedW1 = new Set(w1Nodes.map((n) => n.name));
for (const name of Object.keys(w1Connections)) {
  if (!allowedW1.has(name)) { delete w1Connections[name]; continue; }
  w1Connections[name].main = (w1Connections[name].main ?? []).map((edges) => (edges ?? []).filter((edge) => allowedW1.has(edge.node)));
}
w1Connections["Read Markdown as Text"] = { main: [[{ node: "Validate Clean Markdown", type: "main", index: 0 }]] };
w1Connections["Validate Clean Markdown"] = { main: [[{ node: "Markdown Valid?", type: "main", index: 0 }]] };
w1Connections["Markdown Valid?"] = { main: [[{ node: "Hash Markdown", type: "main", index: 0 }], [{ node: "Prepare Validation Failure Callback", type: "main", index: 0 }]] };
w1Connections["Hash Markdown"] = { main: [[{ node: "Prepare Document Success Callback", type: "main", index: 0 }]] };
w1Connections["Prepare Document Success Callback"] = { main: [[{ node: "Sign Canonical Callback", type: "main", index: 0 }]] };
const w1 = { id: "cdcDocumentProcessingV1", name: "CONCEPT - Document Processing", description: "W1 split CDC pipeline: secured PDF processing to signed Markdown callback. Inactive until cutover.", active: false, nodes: w1Nodes, connections: w1Connections, settings: baseline.settings };

const w2Nodes = pick("HTTP Request → Gemini XML", "Clean XML Response", "Validate Success Payload", "Success Payload Valid?", "Prepare Success Callback", "Prepare Gemini Failure Callback", "Prepare Validation Failure Callback", "Sign Canonical Callback", "Unwrap Signed Callback", "Send Canonical Callback");
const webhookW2 = structuredClone(byName.get("Webhook CDC Initiation")); webhookW2.id=id(); webhookW2.webhookId=id(); webhookW2.name="Webhook CDC Extraction"; webhookW2.parameters.path="concept-cdc-extraction";
const validateW2 = codeNode("Validate CDC Extraction Launch", `const item=$input.first(); const body=item.json.body??item.json??{}; const headers=item.json.headers??{}; const env=typeof $env==='object'&&$env?$env:{}; const h=(n)=>String(headers[n]||headers[n.toLowerCase()]||'').trim(); const fail=(m,c,s=400)=>[{json:{launch_valid:false,response_status:s,response_body:JSON.stringify({error:m,code:c})}}];
if(!env.N8N_WEBHOOK_TOKEN) return fail('N8N_WEBHOOK_TOKEN absent.','WORKFLOW_CONFIGURATION_ERROR',500); if(h('authorization')!=='Bearer '+env.N8N_WEBHOOK_TOKEN) return fail('Jeton invalide.','UNAUTHORIZED',401);
const required=['contract_version','processing_job_id','appel_offre_id','code_interne','correlation_id','source_processing_job_id','markdown_document_id','markdown_path','markdown_content_hash','callback_url','requested_at']; for(const k of required) if(typeof body[k]!=='string'||!body[k].trim()) return fail('Champ invalide: '+k,'INVALID_LAUNCH_PAYLOAD');
if(h('idempotency-key')!==body.correlation_id+':cdc-extraction') return fail('Idempotency-Key invalide.','INVALID_IDEMPOTENCY_KEY'); if(body.contract_version!==String(env.N8N_CONTRACT_VERSION||'1.0')) return fail('Version invalide.','INVALID_CONTRACT_VERSION');
return [{json:{...body,markdown_byte_size:Number(body.markdown_byte_size),launch_valid:true}}];`, [-1760, 720]);
const launchValidW2 = ifNode("Launch Valid?", "={{ $json.launch_valid }}", [-1536, 720]);
const buildW2 = codeNode("Build CDC Extraction Context", `const item=$input.first().json; const env=typeof $env==='object'&&$env?$env:{}; const root=String(env.N8N_SHARED_STORAGE_ROOT||'').replace(/\\\\/g,'/').replace(/\\/+$/,''); const p=String(item.markdown_path).replace(/\\\\/g,'/'); const expected=root+'/'+item.code_interne+'/cdc.md'; const ready=p===expected&&/^sha256:[a-f0-9]{64}$/.test(item.markdown_content_hash)&&Number.isInteger(item.markdown_byte_size)&&item.markdown_byte_size>0&&String(item.callback_url).endsWith('/api/fiche/callbacks/n8n'); const now=new Date().toISOString(); return [{json:{...item,launch_ready:ready,response_status:ready?202:400,response_body:ready?'':JSON.stringify({error:'Artifact Markdown invalide.',code:'INVALID_MARKDOWN_ARTIFACT'}),execution_id:String($execution.id),started_at:now,callback_signer_url:String(env.N8N_CALLBACK_SIGNER_URL||''),callback_timeout_ms:Number(env.N8N_CALLBACK_TIMEOUT_MS||30000),llm_model:'gemini-3.6-flash',launch_response_body:JSON.stringify({contract_version:item.contract_version,accepted:true,processing_job_id:item.processing_job_id,correlation_id:item.correlation_id,execution_id:String($execution.id),received_at:now,processing_status:'RUNNING'})}}];`, [-1296, 624]);
const launchReadyW2 = ifNode("Launch Ready?", "={{ $json.launch_ready }}", [-1072, 624]);
const rejected = structuredClone(byName.get("Respond Launch Rejected")); rejected.id=id();
const accepted = structuredClone(byName.get("Respond 202 Accepted")); accepted.id=id();
const readMd = { parameters: { fileSelector: "={{ $json.markdown_path }}", options: { mimeType: "text/markdown", dataPropertyName: "data" } }, id:id(), name:"Read Persisted Markdown", type:"n8n-nodes-base.readWriteFile", typeVersion:1.1, position:[-832,720], onError:"continueErrorOutput" };
const readText = codeNode("Read Markdown as Text", `const item=$input.first(); const buffer=await this.helpers.getBinaryDataBuffer(0,'data'); return [{json:{...$('Build CDC Extraction Context').first().json,markdown:buffer.toString('utf8'),actual_byte_size:buffer.length}}];`, [-608, 720]);
const hashW2 = { parameters: { action:"hash",type:"SHA256",value:"={{ $json.markdown }}",dataPropertyName:"actual_sha256" },id:id(),name:"Hash Persisted Markdown",type:"n8n-nodes-base.crypto",typeVersion:1,position:[-384,720] };
const verifyW2 = codeNode("Verify Persisted Markdown", `const j=$input.first().json; const valid=j.actual_byte_size===j.markdown_byte_size&&('sha256:'+j.actual_sha256)===j.markdown_content_hash; return [{json:{...j,artifact_valid:valid,error_stage:'MARKDOWN',error_code:valid?null:'MARKDOWN_INTEGRITY_MISMATCH',error_message:valid?null:'Le Markdown persiste ne correspond pas a la taille/empreinte attendue.'}}];`, [-160,720]);
const artifactValid = ifNode("Artifact Valid?", "={{ $json.artifact_valid }}", [64,720]);
w2Nodes.find(n=>n.name==="Prepare Success Callback").parameters.jsCode = w2Nodes.find(n=>n.name==="Prepare Success Callback").parameters.jsCode.replaceAll("Build Canonical Context","Build CDC Extraction Context");
for(const node of w2Nodes){ node.parameters=JSON.parse(JSON.stringify(node.parameters).replaceAll("Build Canonical Context","Build CDC Extraction Context").replaceAll("Increment Marker Poll Guard","Build CDC Extraction Context")); }
w2Nodes.push(webhookW2,validateW2,launchValidW2,buildW2,launchReadyW2,rejected,accepted,readMd,readText,hashW2,verifyW2,artifactValid);
const w2Connections={
  ...connect("Webhook CDC Extraction","Validate CDC Extraction Launch","Launch Valid?"),
  "Launch Valid?":{main:[[{node:"Build CDC Extraction Context",type:"main",index:0}],[{node:"Respond Launch Rejected",type:"main",index:0}]]},
  "Build CDC Extraction Context":{main:[[{node:"Launch Ready?",type:"main",index:0}]]},
  "Launch Ready?":{main:[[{node:"Respond 202 Accepted",type:"main",index:0}],[{node:"Respond Launch Rejected",type:"main",index:0}]]},
  "Respond 202 Accepted":{main:[[{node:"Read Persisted Markdown",type:"main",index:0}]]},
  ...connect("Read Persisted Markdown","Read Markdown as Text","Hash Persisted Markdown","Verify Persisted Markdown","Artifact Valid?"),
  "Artifact Valid?":{main:[[{node:"HTTP Request → Gemini XML",type:"main",index:0}],[{node:"Prepare Validation Failure Callback",type:"main",index:0}]]},
  "HTTP Request → Gemini XML":baseline.connections["HTTP Request → Gemini XML"], "Clean XML Response":baseline.connections["Clean XML Response"], "Validate Success Payload":baseline.connections["Validate Success Payload"], "Success Payload Valid?":baseline.connections["Success Payload Valid?"], "Prepare Success Callback":baseline.connections["Prepare Success Callback"], "Prepare Gemini Failure Callback":baseline.connections["Prepare Gemini Failure Callback"], "Prepare Validation Failure Callback":baseline.connections["Prepare Validation Failure Callback"], "Sign Canonical Callback":baseline.connections["Sign Canonical Callback"], "Unwrap Signed Callback":baseline.connections["Unwrap Signed Callback"]
};
const w2={id:"cdcExtractionV1",name:"CONCEPT - CDC Extraction",description:"W2 split CDC pipeline: verified persisted Markdown to Gemini/XML and existing signed final callback. Inactive until cutover.",active:false,nodes:w2Nodes,connections:w2Connections,settings:baseline.settings};

fs.writeFileSync("n8n/workflows/concept-document-processing.json", JSON.stringify([w1],null,2)+"\n");
fs.writeFileSync("n8n/workflows/concept-cdc-extraction.json", JSON.stringify([w2],null,2)+"\n");
