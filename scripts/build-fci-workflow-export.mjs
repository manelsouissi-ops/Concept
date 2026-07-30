import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const workflowPath = path.join(
  process.cwd(),
  "n8n",
  "workflows",
  "fci-module-generation.json"
);
const backupDir = path.join(process.cwd(), "tmp", "n8n-workflow-backups");
const timestamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z")
  .replace("T", "_");

function responseNode(name, id, position, responseBodyExpression, responseCode) {
  return {
    parameters: {
      respondWith: "json",
      responseBody: responseBodyExpression,
      options: {
        responseCode
      }
    },
    id,
    name,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.5,
    position
  };
}

function codeNode(name, id, position, jsCode, extra = {}) {
  return {
    parameters: {
      jsCode
    },
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    ...extra
  };
}

function ifNode(name, id, position, leftValueExpression) {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2
        },
        conditions: [
          {
            leftValue: leftValueExpression,
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "true",
              singleValue: true
            }
          }
        ],
        combinator: "and"
      },
      options: {}
    },
    id,
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position
  };
}

function httpRequestNode(name, id, position, parameters, extra = {}) {
  return {
    parameters,
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position,
    ...extra
  };
}

const validateLaunchCode = `
const item = $input.first();
const body = item.json.body ?? item.json ?? {};
const headers = item.json.headers ?? {};
const env = typeof $env === 'object' && $env ? $env : {};

const getHeader = (name) => {
  const direct = headers[name];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const lower = headers[name.toLowerCase()];
  if (typeof lower === 'string' && lower.trim()) {
    return lower.trim();
  }
  return '';
};

const unauthorized = (message) => ([{
  json: {
    launch_valid: false,
    response_status: 401,
    response_body: JSON.stringify({
      error: message,
      code: 'UNAUTHORIZED',
    }),
  },
}]);

const reject = (message, code, status = 400) => ([{
  json: {
    launch_valid: false,
    response_status: status,
    response_body: JSON.stringify({
      error: message,
      code,
    }),
  },
}]);

const expectedToken = String(env.FCI_N8N_WEBHOOK_TOKEN || env.N8N_WEBHOOK_TOKEN || '').trim();
if (!expectedToken) {
  return reject('FCI_N8N_WEBHOOK_TOKEN ou N8N_WEBHOOK_TOKEN est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

const authorization = getHeader('authorization');
if (!authorization || !authorization.startsWith('Bearer ')) {
  return unauthorized('Authorization Bearer manquant.');
}

const providedToken = authorization.slice('Bearer '.length).trim();
if (providedToken !== expectedToken) {
  return unauthorized('Jeton de lancement FCI invalide.');
}

const expectedContractVersion = String(env.FCI_N8N_CONTRACT_VERSION || '1.0').trim();
const expectedModuleTypes = {
  A: 'commercial',
  B: 'finance',
  C: 'operations',
  D: 'strategy',
};

const requirePositiveInteger = (value, key) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(key);
  }
  return parsed;
};

const requireString = (value, key) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(key);
  }
  return value.trim();
};

const requireRecord = (value, key) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(key);
  }
  return value;
};

let contractVersion = '';
let generationJobId = 0;
let fciSetId = 0;
let fciModuleId = 0;
let appelOffreId = 0;
let codeInterne = '';
let moduleCode = '';
let moduleType = '';
let triggerType = '';
let correlationId = '';
let callbackUrl = '';
let sourceFiche = null;
let ficheCdc = null;
let generationMetadata = null;
let prompt = null;
let outputSchema = null;

try {
  contractVersion = requireString(body.contract_version, 'contract_version');
  generationJobId = requirePositiveInteger(body.generation_job_id, 'generation_job_id');
  fciSetId = requirePositiveInteger(body.fci_set_id, 'fci_set_id');
  fciModuleId = requirePositiveInteger(body.fci_module_id, 'fci_module_id');
  appelOffreId = requirePositiveInteger(body.appel_offre_id, 'appel_offre_id');
  codeInterne = requireString(body.code_interne, 'code_interne');
  moduleCode = requireString(body.module_code, 'module_code');
  moduleType = requireString(body.module_type, 'module_type');
  triggerType = requireString(body.trigger_type, 'trigger_type');
  correlationId = requireString(body.correlation_id, 'correlation_id');
  callbackUrl = requireString(body.callback_url, 'callback_url');
  sourceFiche = requireRecord(body.source_fiche, 'source_fiche');
  ficheCdc = requireRecord(body.fiche_cdc, 'fiche_cdc');
  generationMetadata = requireRecord(body.generation_metadata, 'generation_metadata');
  prompt = requireRecord(body.prompt, 'prompt');
  outputSchema = requireRecord(body.output_schema, 'output_schema');
} catch (error) {
  return reject('Champ obligatoire manquant ou invalide: ' + error.message, 'INVALID_LAUNCH_PAYLOAD');
}

if (contractVersion !== expectedContractVersion) {
  return reject('Version de contrat inattendue: ' + contractVersion, 'INVALID_CONTRACT_VERSION', 409);
}

if (!Object.prototype.hasOwnProperty.call(expectedModuleTypes, moduleCode)) {
  return reject('Module FCI non pris en charge: ' + moduleCode, 'UNSUPPORTED_MODULE');
}

if (expectedModuleTypes[moduleCode] !== moduleType) {
  return reject('module_type ne correspond pas au module_code fourni.', 'MODULE_TYPE_MISMATCH');
}

if (!['manual', 'automatic', 'regeneration'].includes(triggerType)) {
  return reject('trigger_type invalide.', 'INVALID_TRIGGER_TYPE');
}

if (!/^https?:\\/\\/[^\\s]+$/i.test(callbackUrl)) {
  return reject('callback_url doit etre une URL http(s) valide.', 'INVALID_CALLBACK_URL');
}

if (String(sourceFiche.status || '').trim() !== 'validated') {
  return reject('La source Fiche CDC doit etre validee avant generation.', 'INVALID_SOURCE_FICHE_STATUS');
}

const sourceCodeInterne = requireString(sourceFiche.code_interne, 'source_fiche.code_interne');
const sourceVersion = requireString(sourceFiche.version, 'source_fiche.version');
const sourceHash = requireString(sourceFiche.hash, 'source_fiche.hash');
const promptText = requireString(prompt.text, 'prompt.text');
const promptVersion = requireString(prompt.version, 'prompt.version');
const schemaVersion = requireString(outputSchema.version, 'output_schema.version');
const schemaJson = requireRecord(outputSchema.json_schema, 'output_schema.json_schema');
const metadataPromptVersion = requireString(generationMetadata.prompt_version, 'generation_metadata.prompt_version');
const metadataSchemaVersion = requireString(generationMetadata.schema_version, 'generation_metadata.schema_version');

if (promptVersion !== metadataPromptVersion) {
  return reject('Version de prompt incoherente entre prompt.version et generation_metadata.prompt_version.', 'PROMPT_VERSION_MISMATCH');
}

if (schemaVersion !== metadataSchemaVersion) {
  return reject('Version de schema incoherente entre output_schema.version et generation_metadata.schema_version.', 'SCHEMA_VERSION_MISMATCH');
}

return [{
  json: {
    launch_valid: true,
    contract_version: contractVersion,
    generation_job_id: generationJobId,
    fci_set_id: fciSetId,
    fci_module_id: fciModuleId,
    appel_offre_id: appelOffreId,
    code_interne: codeInterne,
    module_code: moduleCode,
    module_type: moduleType,
    trigger_type: triggerType,
    correlation_id: correlationId,
    callback_url: callbackUrl,
    source_fiche: {
      code_interne: sourceCodeInterne,
      version: sourceVersion,
      hash: sourceHash,
      status: 'validated',
      validated_at: typeof sourceFiche.validated_at === 'string' ? sourceFiche.validated_at : null,
    },
    fiche_cdc: ficheCdc,
    generation_metadata: generationMetadata,
    prompt: {
      text: promptText,
      version: promptVersion,
    },
    output_schema: {
      version: schemaVersion,
      json_schema: schemaJson,
    },
  },
}];
`.trim();

const buildContextCode = `
const item = $input.first();
const env = typeof $env === 'object' && $env ? $env : {};

const rejectLaunch = (message, code, status = 500) => ([{
  json: {
    launch_ready: false,
    response_status: status,
    response_body: JSON.stringify({
      error: message,
      code,
    }),
  },
}]);

const callbackSignerUrl = String(env.FCI_CALLBACK_SIGNER_URL || '').trim();
const callbackBearerToken = String(env.FCI_CALLBACK_BEARER_TOKEN || env.PLATFORM_CALLBACK_TOKEN || '').trim();
const geminiApiKey = String(env.GEMINI_API_KEY || '').trim();
const runtimeModel = String(env.FCI_GENERATION_MODEL || item.json.generation_metadata?.model || '').trim();
const contractVersion = String(env.FCI_N8N_CONTRACT_VERSION || item.json.contract_version || '1.0').trim();

if (!callbackSignerUrl) {
  return rejectLaunch('FCI_CALLBACK_SIGNER_URL est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR');
}

if (!callbackBearerToken) {
  return rejectLaunch('FCI_CALLBACK_BEARER_TOKEN ou PLATFORM_CALLBACK_TOKEN est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR');
}

if (!geminiApiKey) {
  return rejectLaunch('GEMINI_API_KEY est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR');
}

if (!runtimeModel) {
  return rejectLaunch('FCI_GENERATION_MODEL est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR');
}

const callbackUrl = String(item.json.callback_url || '').trim();
const callbackSuffix = '/api/fci/callbacks/n8n';
if (!callbackUrl.endsWith(callbackSuffix)) {
  return rejectLaunch('callback_url FCI inattendue.', 'INVALID_CALLBACK_URL', 400);
}

const platformBaseUrl = callbackUrl.slice(0, callbackUrl.length - callbackSuffix.length);
const validatorUrl = platformBaseUrl + '/api/fci/contracts/validate';
const now = new Date().toISOString();

const systemPrompt = [
  item.json.prompt.text,
  '',
  'Contraintes systeme additionnelles:',
  '- Reponds uniquement avec un objet JSON valide.',
  '- N\\'ajoute aucun commentaire, aucun Markdown et aucune balise de code.',
  '- Respecte strictement module_code=' + item.json.module_code + ' et module_type=' + item.json.module_type + '.',
  '- Utilise uniquement les informations de la Fiche CDC fournie.',
  '- Si une information manque, garde une valeur vide ou la structure attendue plutot que d\\'inventer.',
  '- La sortie doit rester concise, professionnelle et en francais.'
].join('\\n');

const userPrompt = JSON.stringify({
  module_code: item.json.module_code,
  module_type: item.json.module_type,
  trigger_type: item.json.trigger_type,
  source_fiche: item.json.source_fiche,
  generation_metadata: item.json.generation_metadata,
  expected_schema_version: item.json.output_schema.version,
  expected_json_schema: item.json.output_schema.json_schema,
  fiche_cdc: item.json.fiche_cdc,
}, null, 2);

const geminiRequest = {
  model: runtimeModel,
  messages: [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userPrompt,
    }
  ],
  max_completion_tokens: 12000,
};

const launchResponse = {
  contract_version: contractVersion,
  accepted: true,
  generation_job_id: item.json.generation_job_id,
  correlation_id: item.json.correlation_id,
  execution_id: String($execution.id),
  received_at: now,
  processing_status: 'RUNNING',
};

return [{
  json: {
    ...item.json,
    launch_ready: true,
    contract_version: contractVersion,
    execution_id: String($execution.id),
    received_at: now,
    started_at: now,
    platform_base_url: platformBaseUrl,
    validator_url: validatorUrl,
    callback_signer_url: callbackSignerUrl,
    llm_model: runtimeModel,
    llm_provider: 'gemini',
    gemini_request_body: JSON.stringify(geminiRequest),
    launch_response_body: JSON.stringify(launchResponse),
    generation_parameters_base: {
      provider: 'gemini',
      model: runtimeModel,
      prompt_version: item.json.prompt.version,
      schema_version: item.json.output_schema.version,
      repair_attempted: false,
      callback_url: item.json.callback_url,
      validator_url: validatorUrl,
    },
  },
}];
`.trim();

const extractGeminiContentCode = `
const context = $('Build FCI Context').first().json;
const response = $input.first().json ?? {};
const choice = response?.choices?.[0] ?? {};
let content = choice?.message?.content ?? '';

if (Array.isArray(content)) {
  content = content
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object' && typeof entry.text === 'string') {
        return entry.text;
      }
      return '';
    })
    .join('');
}

content = String(content || '').trim();

return [{
  json: {
    ...context,
    ai_content: content,
    finish_reason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    usage: response?.usage ?? null,
  },
}];
`.trim();

const cleanGeminiJsonCode = `
const item = $input.first();
let cleaned = String(item.json.ai_content || '').trim();
cleaned = cleaned.replace(/^\\uFEFF/, '');
cleaned = cleaned.replace(/^\\\`\\\`\\\`json\\s*/i, '');
cleaned = cleaned.replace(/^\\\`\\\`\\\`\\s*/i, '');
cleaned = cleaned.replace(/\\s*\\\`\\\`\\\`$/i, '');
cleaned = cleaned.trim();

return [{
  json: {
    ...item.json,
    cleaned_ai_json: cleaned,
  },
}];
`.trim();

const parseModuleJsonCode = `
const item = $input.first();
const cleaned = String(item.json.cleaned_ai_json || '').trim();

if (!cleaned) {
  return [{
    json: {
      ...item.json,
      parse_valid: false,
      error_stage: 'gemini_response',
      error_code: 'EMPTY_AI_RESPONSE',
      error_message: 'Gemini a renvoye une reponse vide.',
      retryable: true,
      validation_errors: [],
    },
  }];
}

try {
  const parsed = JSON.parse(cleaned);
  return [{
    json: {
      ...item.json,
      parse_valid: true,
      parsed_payload: parsed,
    },
  }];
} catch (error) {
  const message = error instanceof Error ? error.message : 'JSON invalide';
  return [{
    json: {
      ...item.json,
      parse_valid: false,
      error_stage: 'json_parse',
      error_code: 'MALFORMED_AI_JSON',
      error_message: 'La reponse Gemini n\\'est pas un JSON exploitable: ' + message,
      retryable: true,
      validation_errors: [
        {
          path: '$',
          keyword: 'json_parse',
          message,
        }
      ],
      ai_preview: cleaned.slice(0, 400),
    },
  }];
}
`.trim();

const prepareGeminiFailureCallbackCode = `
function sanitizeFciErrorMessage(raw, contentType) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return 'Erreur inconnue.';
  }

  const ct = String(contentType || '').toLowerCase();
  const looksLikeHtml = ct.includes('text/html')
    || /^<!DOCTYPE\\s+html/i.test(text)
    || /^<html[\\s>]/i.test(text)
    || /<\\/?[a-z][\\s\\S]{0,20}>/i.test(text.slice(0, 200));

  if (looksLikeHtml) {
    return 'Le service appelé a retourné une réponse HTTP inattendue.';
  }

  const MAX_LENGTH = 300;
  return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH - 1) + '…' : text;
}

const context = $('Build FCI Context').first().json;
const item = $input.first();
const rawContentType = item.json?.error?.response?.headers?.['content-type']
  || item.json?.error?.cause?.response?.headers?.['content-type']
  || null;
const rawError = item.json?.error?.message || item.json?.message || item.json?.body?.error?.message || 'Echec de la requete Gemini.';
const safeMessage = sanitizeFciErrorMessage(rawError, rawContentType);
const payload = {
  event: 'fci.generation.failed',
  contract_version: context.contract_version,
  generation_job_id: context.generation_job_id,
  fci_set_id: context.fci_set_id,
  fci_module_id: context.fci_module_id,
  appel_offre_id: context.appel_offre_id,
  code_interne: context.code_interne,
  module_code: context.module_code,
  correlation_id: context.correlation_id,
  execution_id: context.execution_id,
  status: 'failed',
  provider: context.llm_provider,
  model: context.llm_model,
  prompt_version: context.prompt.version,
  schema_version: context.output_schema.version,
  source_fiche: {
    version: context.source_fiche.version,
    hash: context.source_fiche.hash,
  },
  generated_at: new Date().toISOString(),
  generation_parameters: {
    ...context.generation_parameters_base,
    finish_reason: null,
    usage: null,
  },
  error: {
    code: 'GEMINI_REQUEST_FAILED',
    message: safeMessage,
    stage: 'gemini_request',
    retryable: true,
  },
};

const rawBody = JSON.stringify(payload);

return [{
  json: {
    callback_sign_request: {
      callback_url: context.callback_url,
      contract_version: context.contract_version,
      callback_timestamp: new Date().toISOString(),
      callback_raw_body: rawBody,
      terminal_status: 'failed',
      failure_message: payload.error.message,
      failure_code: payload.error.code,
    },
    raw_error_detail_for_execution_log: String(rawError).slice(0, 2000),
  },
}];
`.trim();

const prepareValidationFailureCallbackCode = `
function sanitizeFciErrorMessage(raw, contentType) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return 'Erreur inconnue.';
  }

  const ct = String(contentType || '').toLowerCase();
  const looksLikeHtml = ct.includes('text/html')
    || /^<!DOCTYPE\\s+html/i.test(text)
    || /^<html[\\s>]/i.test(text)
    || /<\\/?[a-z][\\s\\S]{0,20}>/i.test(text.slice(0, 200));

  if (looksLikeHtml) {
    return 'Le service appelé a retourné une réponse HTTP inattendue.';
  }

  const MAX_LENGTH = 300;
  return text.length > MAX_LENGTH ? text.slice(0, MAX_LENGTH - 1) + '…' : text;
}

const context = $('Build FCI Context').first().json;
const item = $input.first().json ?? {};

let errorCode = 'AI_SCHEMA_VALIDATION_FAILED';
let errorStage = 'schema_validation';
let errorMessage = 'Le payload IA ne respecte pas le schema attendu.';
let retryable = true;
let validationErrors = [];
let rawContentType = null;

if (item.parse_valid === false) {
  errorCode = String(item.error_code || 'MALFORMED_AI_JSON');
  errorStage = String(item.error_stage || 'json_parse');
  errorMessage = String(item.error_message || errorMessage);
  retryable = typeof item.retryable === 'boolean' ? item.retryable : true;
  validationErrors = Array.isArray(item.validation_errors) ? item.validation_errors : [];
} else if (item.ok === true && item.valid === false) {
  errorCode = 'AI_SCHEMA_VALIDATION_FAILED';
  errorStage = 'schema_validation';
  errorMessage = 'Le payload IA ne respecte pas le schema FCI attendu.';
  validationErrors = Array.isArray(item.errors) ? item.errors : [];
} else if (item.error && typeof item.error === 'object') {
  errorCode = String(item.error.code || 'SCHEMA_VALIDATION_FAILED');
  errorStage = 'schema_validation';
  errorMessage = String(item.error.message || errorMessage);
  rawContentType = item.error?.response?.headers?.['content-type']
    || item.error?.cause?.response?.headers?.['content-type']
    || null;
  retryable = false;
} else if (item.message) {
  errorCode = 'SCHEMA_VALIDATION_FAILED';
  errorStage = 'schema_validation';
  errorMessage = String(item.message);
  retryable = false;
}

const rawErrorMessage = errorMessage;
const safeErrorMessage = sanitizeFciErrorMessage(rawErrorMessage, rawContentType);

const payload = {
  event: 'fci.generation.failed',
  contract_version: context.contract_version,
  generation_job_id: context.generation_job_id,
  fci_set_id: context.fci_set_id,
  fci_module_id: context.fci_module_id,
  appel_offre_id: context.appel_offre_id,
  code_interne: context.code_interne,
  module_code: context.module_code,
  correlation_id: context.correlation_id,
  execution_id: context.execution_id,
  status: 'failed',
  provider: context.llm_provider,
  model: context.llm_model,
  prompt_version: context.prompt.version,
  schema_version: context.output_schema.version,
  source_fiche: {
    version: context.source_fiche.version,
    hash: context.source_fiche.hash,
  },
  generated_at: new Date().toISOString(),
  generation_parameters: {
    ...context.generation_parameters_base,
    finish_reason: $('Extract Gemini Content').first()?.json?.finish_reason ?? null,
    usage: $('Extract Gemini Content').first()?.json?.usage ?? null,
  },
  error: {
    code: errorCode,
    message: safeErrorMessage,
    stage: errorStage,
    retryable: retryable,
    validation_errors: validationErrors,
  },
};

const rawBody = JSON.stringify(payload);

return [{
  json: {
    callback_sign_request: {
      callback_url: context.callback_url,
      contract_version: context.contract_version,
      callback_timestamp: new Date().toISOString(),
      callback_raw_body: rawBody,
      terminal_status: 'failed',
      failure_message: payload.error.message,
      failure_code: payload.error.code,
    },
    raw_error_detail_for_execution_log: String(rawErrorMessage).slice(0, 2000),
  },
}];
`.trim();

const prepareSuccessCallbackCode = `
const context = $('Build FCI Context').first().json;
const item = $input.first().json ?? {};
const normalized = item.normalized ?? $('Parse Module JSON').first().json.parsed_payload;
const gemini = $('Extract Gemini Content').first().json ?? {};

const payload = {
  event: 'fci.generation.completed',
  contract_version: context.contract_version,
  generation_job_id: context.generation_job_id,
  fci_set_id: context.fci_set_id,
  fci_module_id: context.fci_module_id,
  appel_offre_id: context.appel_offre_id,
  code_interne: context.code_interne,
  module_code: context.module_code,
  correlation_id: context.correlation_id,
  execution_id: context.execution_id,
  status: 'completed',
  provider: context.llm_provider,
  model: context.llm_model,
  prompt_version: context.prompt.version,
  schema_version: context.output_schema.version,
  source_fiche: {
    version: context.source_fiche.version,
    hash: context.source_fiche.hash,
  },
  generated_at: new Date().toISOString(),
  generation_parameters: {
    ...context.generation_parameters_base,
    finish_reason: gemini.finish_reason ?? null,
    usage: gemini.usage ?? null,
  },
  payload: normalized,
};

const rawBody = JSON.stringify(payload);

return [{
  json: {
    callback_sign_request: {
      callback_url: context.callback_url,
      contract_version: context.contract_version,
      callback_timestamp: new Date().toISOString(),
      callback_raw_body: rawBody,
      terminal_status: 'completed',
    },
  },
}];
`.trim();

const unwrapSignedCallbackCode = `
const item = $input.first();
const signed = item.json?.body && typeof item.json.body === 'object'
  ? item.json.body
  : item.json;

return [{
  json: {
    callback_url: signed.callback_url,
    contract_version: signed.contract_version,
    callback_timestamp: signed.callback_timestamp,
    callback_signature: signed.callback_signature,
    callback_raw_body: signed.callback_raw_body,
    terminal_status: signed.terminal_status,
    failure_message: signed.failure_message ?? null,
    failure_code: signed.failure_code ?? null,
  },
}];
`.trim();

const failAfterCallbackCode = `
const item = $input.first().json ?? {};
throw new Error(String(item.failure_message || item.failure_code || 'La generation FCI a echoue apres notification du callback.'));
`.trim();

const workflow = {
  name: "FCI Module Generation - Gemini JSON",
  active: false,
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "fci-module-generation",
        responseMode: "responseNode",
        options: {}
      },
      id: "5c0e18d0-4f28-4b88-9d67-a4ec25bb0a61",
      name: "Webhook FCI Generation",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2.1,
      position: [-2128, 832],
      webhookId: "662e90f9-0b9a-4faa-b4e6-1b99c9e0e3a6"
    },
    codeNode(
      "Validate FCI Launch",
      "1ce598a2-3c90-49f8-8eb6-441e271cbce9",
      [-1888, 832],
      validateLaunchCode
    ),
    ifNode(
      "Launch Valid?",
      "db3eb7af-6d65-4706-ad7e-6fe9ca974500",
      [-1648, 832],
      "={{ $json.launch_valid }}"
    ),
    codeNode(
      "Build FCI Context",
      "0fb27ed2-bdab-4d74-958b-959d6f1ec3c8",
      [-1408, 736],
      buildContextCode
    ),
    ifNode(
      "Launch Ready?",
      "7c8aef22-a132-44e1-b4c0-bc57f85f5b90",
      [-1168, 736],
      "={{ $json.launch_ready }}"
    ),
    responseNode(
      "Respond Launch Rejected",
      "1fc5f6dc-afd7-43d8-8042-25de7154a1e8",
      [-1408, 1008],
      "={{ $json.response_body }}",
      "={{ Number($json.response_status || 400) }}"
    ),
    responseNode(
      "Respond 202 Accepted",
      "d9587f8a-5ca5-467b-8830-3b567f38d92d",
      [-928, 592],
      "={{ $json.launch_response_body }}",
      202
    ),
    httpRequestNode(
      "HTTP Request → Gemini JSON",
      "21a6cc38-c0bc-4e68-ae2e-3151f10f9884",
      [-928, 832],
      {
        method: "POST",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Authorization",
              value: "=Bearer {{$env.GEMINI_API_KEY}}"
            },
            {
              name: "Content-Type",
              value: "application/json"
            }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ $json.gemini_request_body }}",
        options: {
          response: {
            response: {
              responseFormat: "json"
            }
          },
          timeout: 600000
        }
      },
      {
        onError: "continueErrorOutput"
      }
    ),
    codeNode(
      "Extract Gemini Content",
      "e38d5bd1-7c08-4797-8810-a3c9c22fdb4d",
      [-688, 736],
      extractGeminiContentCode
    ),
    codeNode(
      "Clean Gemini JSON",
      "e50c072f-a3d5-4ae9-9c3e-f1be0d020254",
      [-448, 736],
      cleanGeminiJsonCode
    ),
    codeNode(
      "Parse Module JSON",
      "a8d9f7e5-458e-4c0f-8338-8f011f290fe5",
      [-208, 736],
      parseModuleJsonCode
    ),
    ifNode(
      "Module JSON Parsed?",
      "7864f99a-0c45-4d2b-93b9-f1fef1f72c7f",
      [32, 736],
      "={{ $json.parse_valid }}"
    ),
    httpRequestNode(
      "Validate Module Schema via Concept",
      "34e3416f-4fd1-4d84-b02f-d7740b422d41",
      [272, 640],
      {
        method: "POST",
        url: "={{ $json.validator_url }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Authorization",
              value: "=Bearer {{$env.FCI_N8N_WEBHOOK_TOKEN || $env.N8N_WEBHOOK_TOKEN}}"
            },
            {
              name: "Content-Type",
              value: "application/json"
            }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ contract_version: $json.contract_version, module_code: $json.module_code, payload: $json.parsed_payload }) }}",
        options: {
          response: {
            response: {
              responseFormat: "json"
            }
          },
          timeout: 30000
        }
      },
      {
        onError: "continueErrorOutput"
      }
    ),
    ifNode(
      "Schema Valid?",
      "4f41ff7f-f8db-4ba7-b86a-5c6b7734db1d",
      [512, 640],
      "={{ $json.ok === true && $json.valid === true }}"
    ),
    codeNode(
      "Prepare Success Callback",
      "b23b55d3-d3f5-45df-8d0c-743f700aa988",
      [752, 544],
      prepareSuccessCallbackCode
    ),
    codeNode(
      "Prepare Validation Failure Callback",
      "0d174f51-cb3b-4917-84e0-00cb309ded2e",
      [752, 800],
      prepareValidationFailureCallbackCode
    ),
    codeNode(
      "Prepare Gemini Failure Callback",
      "a02dbf7b-b89e-48e9-b8f4-1a4e2e5c04af",
      [-688, 992],
      prepareGeminiFailureCallbackCode
    ),
    httpRequestNode(
      "Sign FCI Callback",
      "d8d80417-9084-4d4d-9b5d-fae2d4a64908",
      [992, 672],
      {
        method: "POST",
        url: "={{ $('Build FCI Context').first().json.callback_signer_url }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Content-Type",
              value: "application/json"
            }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify($json.callback_sign_request || $json) }}",
        options: {
          response: {
            response: {
              responseFormat: "json"
            }
          },
          timeout: 30000
        }
      }
    ),
    codeNode(
      "Unwrap Signed Callback",
      "a871085d-716a-45f5-a55f-f4d09d8d65ec",
      [1232, 672],
      unwrapSignedCallbackCode
    ),
    {
      parameters: {
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 2
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.terminal_status }}",
                    "rightValue": "completed",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "Completed"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": true,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 2
                },
                "conditions": [
                  {
                    "leftValue": "={{ $json.terminal_status }}",
                    "rightValue": "failed",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "Failed"
            }
          ]
        },
        "options": {}
      },
      id: "82433565-a887-48e1-b731-5e39a2df0d6f",
      name: "Callback Terminal Status",
      type: "n8n-nodes-base.switch",
      typeVersion: 3.4,
      position: [1472, 672]
    },
    httpRequestNode(
      "Send Success Callback",
      "dd731c68-2cf3-4b97-8445-f1af2de18011",
      [1712, 592],
      {
        method: "POST",
        url: "={{ $json.callback_url }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Authorization",
              value: "=Bearer {{$env.FCI_CALLBACK_BEARER_TOKEN || $env.PLATFORM_CALLBACK_TOKEN}}"
            },
            {
              name: "X-Contract-Version",
              value: "={{ $json.contract_version }}"
            },
            {
              name: "X-Callback-Timestamp",
              value: "={{ $json.callback_timestamp }}"
            },
            {
              name: "X-Callback-Signature",
              value: "={{ 'sha256=' + $json.callback_signature }}"
            },
            {
              name: "Content-Type",
              value: "application/json"
            }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ $json.callback_raw_body }}",
        options: {
          timeout: 30000
        }
      }
    ),
    httpRequestNode(
      "Send Failure Callback",
      "d5e23cc2-d0b5-4e49-8e87-95dd6b71749d",
      [1712, 752],
      {
        method: "POST",
        url: "={{ $json.callback_url }}",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: "Authorization",
              value: "=Bearer {{$env.FCI_CALLBACK_BEARER_TOKEN || $env.PLATFORM_CALLBACK_TOKEN}}"
            },
            {
              name: "X-Contract-Version",
              value: "={{ $json.contract_version }}"
            },
            {
              name: "X-Callback-Timestamp",
              value: "={{ $json.callback_timestamp }}"
            },
            {
              name: "X-Callback-Signature",
              value: "={{ 'sha256=' + $json.callback_signature }}"
            },
            {
              name: "Content-Type",
              value: "application/json"
            }
          ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ $json.callback_raw_body }}",
        options: {
          timeout: 30000
        }
      }
    ),
    codeNode(
      "Fail Workflow After Failure Callback",
      "a73ed392-d086-4a56-b782-d8675893fda9",
      [1952, 752],
      failAfterCallbackCode
    )
  ],
  connections: {
    "Webhook FCI Generation": {
      main: [
        [
          {
            node: "Validate FCI Launch",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Validate FCI Launch": {
      main: [
        [
          {
            node: "Launch Valid?",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Launch Valid?": {
      main: [
        [
          {
            node: "Build FCI Context",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Respond Launch Rejected",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Build FCI Context": {
      main: [
        [
          {
            node: "Launch Ready?",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Launch Ready?": {
      main: [
        [
          {
            node: "Respond 202 Accepted",
            type: "main",
            index: 0
          },
          {
            node: "HTTP Request → Gemini JSON",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Respond Launch Rejected",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "HTTP Request → Gemini JSON": {
      main: [
        [
          {
            node: "Extract Gemini Content",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Prepare Gemini Failure Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Extract Gemini Content": {
      main: [
        [
          {
            node: "Clean Gemini JSON",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Clean Gemini JSON": {
      main: [
        [
          {
            node: "Parse Module JSON",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Parse Module JSON": {
      main: [
        [
          {
            node: "Module JSON Parsed?",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Module JSON Parsed?": {
      main: [
        [
          {
            node: "Validate Module Schema via Concept",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Prepare Validation Failure Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Validate Module Schema via Concept": {
      main: [
        [
          {
            node: "Schema Valid?",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Prepare Validation Failure Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Schema Valid?": {
      main: [
        [
          {
            node: "Prepare Success Callback",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Prepare Validation Failure Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Prepare Success Callback": {
      main: [
        [
          {
            node: "Sign FCI Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Prepare Validation Failure Callback": {
      main: [
        [
          {
            node: "Sign FCI Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Prepare Gemini Failure Callback": {
      main: [
        [
          {
            node: "Sign FCI Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Sign FCI Callback": {
      main: [
        [
          {
            node: "Unwrap Signed Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Unwrap Signed Callback": {
      main: [
        [
          {
            node: "Callback Terminal Status",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Callback Terminal Status": {
      main: [
        [
          {
            node: "Send Success Callback",
            type: "main",
            index: 0
          }
        ],
        [
          {
            node: "Send Failure Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    },
    "Send Failure Callback": {
      main: [
        [
          {
            node: "Fail Workflow After Failure Callback",
            type: "main",
            index: 0
          }
        ]
      ]
    }
  },
  settings: {
    executionOrder: "v1",
    callerPolicy: "workflowsFromSameOwner",
    availableInMCP: true
  },
  pinData: {},
  versionId: "96dfcd40-76ca-4284-8995-3c5e2b46f4cd",
  description:
    "Dedicated FCI orchestration workflow. Receives a validated Fiche CDC JSON snapshot, calls Gemini, validates the generated module payload against the Phase 2.5 schema through Concept, then sends a signed callback back to Concept.",
  tags: []
};

mkdirSync(path.dirname(workflowPath), { recursive: true });
mkdirSync(backupDir, { recursive: true });

writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
copyFileSync(
  workflowPath,
  path.join(backupDir, "fci-module-generation_export_" + timestamp + ".json")
);

console.log(
  JSON.stringify(
    {
      workflowPath,
      backupPath: path.join(
        backupDir,
        "fci-module-generation_export_" + timestamp + ".json"
      ),
      workflowName: workflow.name
    },
    null,
    2
  )
);
