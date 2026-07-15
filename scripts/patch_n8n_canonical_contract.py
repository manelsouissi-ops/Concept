import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path.home() / ".n8n" / "database.sqlite"
WORKFLOW_ID = "f866bd39869c4c11"
BACKUP_DIR = REPO_ROOT / "tmp" / "n8n-workflow-backups"
AUTHOR = "db-patch-canonical-n8n-contract"


def utc_timestamp() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


def utc_sql_timestamp() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def new_version_id() -> str:
    return str(uuid.uuid4())


def backup_database() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"database_full_{utc_timestamp()}_before_n8n_canonical_contract.sqlite.bak"
    with sqlite3.connect(DB_PATH) as source:
        with sqlite3.connect(backup_path) as destination:
            source.backup(destination)
    return backup_path


def workflow_payload_from_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "active": row["active"],
        "nodes": json.loads(row["nodes"]),
        "connections": json.loads(row["connections"]),
        "settings": json.loads(row["settings"]) if row["settings"] else {},
        "updatedAt": row["updatedAt"],
        "versionId": row["versionId"],
        "activeVersionId": row["activeVersionId"],
        "versionCounter": row["versionCounter"],
    }


def backup_workflow_json(payload: dict, suffix: str) -> Path:
    path = BACKUP_DIR / f"{WORKFLOW_ID}_{suffix}_{utc_timestamp()}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def require_node(nodes_by_name: dict[str, dict], name: str) -> dict:
    node = nodes_by_name.get(name)
    if node is None:
        raise RuntimeError(f"Node '{name}' not found in workflow {WORKFLOW_ID}")
    return node


def require_first_node(nodes_by_name: dict[str, dict], names: list[str]) -> dict:
    for name in names:
        node = nodes_by_name.get(name)
        if node is not None:
            return node
    joined = ", ".join(names)
    raise RuntimeError(f"None of the candidate nodes were found in workflow {WORKFLOW_ID}: {joined}")


def build_validate_launch_node(existing: dict) -> dict:
    node = dict(existing)
    node["name"] = "Validate Canonical Launch"
    node["parameters"] = {
        "jsCode": """const item = $input.first();
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

const badRequest = (message, code) => ([{
  json: {
    launch_valid: false,
    response_status: 400,
    response_body: JSON.stringify({
      error: message,
      code,
    }),
  },
}]);

const configurationError = (message) => ([{
  json: {
    launch_valid: false,
    response_status: 500,
    response_body: JSON.stringify({
      error: message,
      code: 'WORKFLOW_CONFIGURATION_ERROR',
    }),
  },
}]);

const expectedToken = String(env.N8N_WEBHOOK_TOKEN || '').trim();
if (!expectedToken) {
  return configurationError('N8N_WEBHOOK_TOKEN est absent de l\\'environnement n8n.');
}

const authorization = getHeader('authorization');
if (!authorization || !authorization.startsWith('Bearer ')) {
  return unauthorized('Authorization Bearer manquant.');
}

const providedToken = authorization.slice('Bearer '.length).trim();
if (providedToken !== expectedToken) {
  return unauthorized('Jeton de lancement invalide.');
}

const expectedVersion = String(env.N8N_CONTRACT_VERSION || '1.0').trim();
const requireField = (key) => {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(key);
  }
  return value.trim();
};

let contractVersion = '';
let processingJobId = '';
let appelOffreId = '';
let codeInterne = '';
let correlationId = '';
let callbackUrl = '';
let pdfPath = '';
let requestedAt = '';

try {
  contractVersion = requireField('contract_version');
  processingJobId = requireField('processing_job_id');
  appelOffreId = requireField('appel_offre_id');
  codeInterne = requireField('code_interne');
  correlationId = requireField('correlation_id');
  callbackUrl = requireField('callback_url');
  pdfPath = requireField('pdf_path');
  requestedAt = requireField('requested_at');
} catch (error) {
  return badRequest(
    `Champ obligatoire manquant ou invalide: ${error.message}`,
    'INVALID_LAUNCH_PAYLOAD'
  );
}

if (contractVersion !== expectedVersion) {
  return badRequest(
    `Version de contrat inattendue: ${contractVersion}`,
    'INVALID_CONTRACT_VERSION'
  );
}

if (!Number.isFinite(Date.parse(requestedAt))) {
  return badRequest(
    'requested_at doit etre un timestamp ISO-8601 valide.',
    'INVALID_REQUESTED_AT'
  );
}

if (!/^https?:\/\/[^\s]+$/i.test(callbackUrl)) {
  return badRequest(
    'callback_url doit etre une URL http(s) valide.',
    'INVALID_CALLBACK_URL'
  );
}

return [{
  json: {
    launch_valid: true,
    contract_version: contractVersion,
    processing_job_id: processingJobId,
    appel_offre_id: appelOffreId,
    code_interne: codeInterne,
    correlation_id: correlationId,
    callback_url: callbackUrl,
    pdf_path: pdfPath,
    requested_at: requestedAt,
  },
}];"""
    }
    return node


def build_launch_valid_if_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Launch Valid?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [-1520, 752],
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2,
                },
                "conditions": [
                    {
                        "leftValue": "={{ $json.launch_valid }}",
                        "rightValue": True,
                        "operator": {
                            "type": "boolean",
                            "operation": "true",
                            "singleValue": True,
                        },
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    }


def build_reject_response_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Respond Launch Rejected",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.5,
        "position": [-1296, 928],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ $json.response_body }}",
            "options": {
                "responseCode": "={{ Number($json.response_status || 400) }}",
            },
        },
    }


def build_launch_ready_if_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Launch Ready?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [-1296, 752],
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2,
                },
                "conditions": [
                    {
                        "leftValue": "={{ $json.launch_ready }}",
                        "rightValue": True,
                        "operator": {
                            "type": "boolean",
                            "operation": "true",
                            "singleValue": True,
                        },
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    }


def build_canonical_context_node(existing: dict) -> dict:
    node = dict(existing)
    node["name"] = "Build Canonical Context"
    node["parameters"] = {
        "jsCode": """const item = $input.first();
const env = typeof $env === 'object' && $env ? $env : {};
const sharedRootRaw = String(env.N8N_SHARED_STORAGE_ROOT || '').trim();
const markerConvertUrl = String(env.MARKER_CONVERT_URL || '').trim();
const markerResultUrl = String(env.MARKER_RESULT_URL || '').trim().replace(/\\/+$/, '');
const callbackSignerUrl = String(env.N8N_CALLBACK_SIGNER_URL || '').trim();
const contractVersion = String(env.N8N_CONTRACT_VERSION || '1.0').trim();
const callbackToken = String(env.PLATFORM_CALLBACK_TOKEN || '').trim();

const rejectLaunch = (message, code, status = 400) => ([{
  json: {
    launch_ready: false,
    response_status: status,
    response_body: JSON.stringify({
      error: message,
      code,
    }),
  },
}]);

if (!sharedRootRaw) {
  return rejectLaunch('N8N_SHARED_STORAGE_ROOT est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

if (!markerConvertUrl) {
  return rejectLaunch('MARKER_CONVERT_URL est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

if (!markerResultUrl) {
  return rejectLaunch('MARKER_RESULT_URL est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

if (!callbackSignerUrl) {
  return rejectLaunch('N8N_CALLBACK_SIGNER_URL est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

if (!callbackToken) {
  return rejectLaunch('PLATFORM_CALLBACK_TOKEN est absent de l\\'environnement n8n.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

const normalizeAbsoluteLocalPath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const unified = raw.replace(/\\\\/g, '/').replace(/\\/+/g, '/');
  const driveMatch = unified.match(/^([A-Za-z]:)(?:\\/|$)/);
  if (!driveMatch) {
    return null;
  }

  const drive = driveMatch[1].toUpperCase();
  const remainder = unified.slice(drive.length);
  const segments = [];

  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${drive}/${segments.join('/')}`;
};

const sharedRoot = normalizeAbsoluteLocalPath(sharedRootRaw);
if (!sharedRoot) {
  return rejectLaunch('N8N_SHARED_STORAGE_ROOT doit etre un chemin absolu Windows valide.', 'WORKFLOW_CONFIGURATION_ERROR', 500);
}

const pdfPath = normalizeAbsoluteLocalPath(String(item.json.pdf_path || '').trim());
if (!pdfPath) {
  return rejectLaunch('pdf_path doit etre un chemin absolu Windows valide.', 'INVALID_PDF_PATH');
}

if (!(pdfPath === sharedRoot || pdfPath.startsWith(`${sharedRoot}/`))) {
  return rejectLaunch(`pdf_path hors du stockage partage autorise: ${pdfPath}`, 'INVALID_PDF_PATH');
}

if (!pdfPath.toLowerCase().endsWith('.pdf')) {
  return rejectLaunch(`pdf_path doit cibler un fichier .pdf: ${pdfPath}`, 'INVALID_PDF_PATH');
}

const receivedAt = new Date().toISOString();
const launchResponse = {
  contract_version: contractVersion,
  accepted: true,
  processing_job_id: item.json.processing_job_id,
  correlation_id: item.json.correlation_id,
  execution_id: String($execution.id),
  received_at: receivedAt,
  processing_status: 'RUNNING',
};

return [{
  json: {
    launch_ready: true,
    launch_valid: true,
    contract_version: contractVersion,
    processing_job_id: item.json.processing_job_id,
    appel_offre_id: item.json.appel_offre_id,
    code_interne: item.json.code_interne,
    correlation_id: item.json.correlation_id,
    callback_url: item.json.callback_url,
    pdf_path: pdfPath,
    requested_at: item.json.requested_at,
    execution_id: String($execution.id),
    received_at: receivedAt,
    started_at: receivedAt,
    marker_convert_url: markerConvertUrl,
    marker_result_url: markerResultUrl,
    callback_signer_url: callbackSignerUrl,
    callback_timeout_ms: Number(env.N8N_CALLBACK_TIMEOUT_MS || 30000),
    llm_model: 'gemini-2.5-flash',
    pdf_size_bytes: null,
    launch_response_body: JSON.stringify(launchResponse),
  },
}];"""
    }
    return node


def build_accept_response_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Respond 202 Accepted",
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1.5,
        "position": [-1072, 576],
        "parameters": {
            "respondWith": "json",
            "responseBody": "={{ $json.launch_response_body }}",
            "options": {
                "responseCode": 202,
            },
        },
    }


def build_read_pdf_node(existing: dict) -> dict:
    node = dict(existing)
    node["name"] = "Read Source PDF From Disk"
    node["type"] = "n8n-nodes-base.readWriteFile"
    node["typeVersion"] = 1.1
    node["position"] = [-1072, 752]
    node["parameters"] = {
        "operation": "read",
        "fileSelector": "={{ $json.pdf_path }}",
        "options": {
            "dataPropertyName": "data",
            "mimeType": "application/pdf",
        },
    }
    node["onError"] = "continueErrorOutput"
    return node


def patch_convert_node(existing: dict) -> dict:
    node = dict(existing)
    node["parameters"]["url"] = "={{ $('Build Canonical Context').first().json.marker_convert_url }}"
    node["parameters"]["bodyParameters"] = {
        "parameters": [
            {
                "parameterType": "formBinaryData",
                "name": "file",
                "inputDataFieldName": "={{ $json.marker_binary_field || 'data' }}",
            }
        ]
    }
    return node


def build_prepare_source_pdf_read_failure_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Prepare Source PDF Read Failure",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-848, 928],
        "parameters": {
            "jsCode": """const item = $input.first();
const rawMessage = item.json?.error || item.json?.message || 'Lecture du PDF source impossible.';
const errorMessage = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);

return [{
  json: {
    error_stage: 'VALIDATION',
    error_code: 'SOURCE_PDF_READ_FAILED',
    error_message: errorMessage,
  },
}];"""
        },
    }


def build_validate_source_pdf_binary_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Validate Source PDF Binary",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [-848, 752],
        "parameters": {
            "jsCode": """const item = $input.first();
const binaryField = 'data';
const buffer = await this.helpers.getBinaryDataBuffer(0, binaryField);
const header = buffer.subarray(0, 4).toString('utf8');
const pdfSizeBytes = Number(item.binary?.[binaryField]?.fileSize || buffer.length || 0);

if (header !== '%PDF') {
  return [{
    json: {
      source_pdf_valid: false,
      error_stage: 'VALIDATION',
      error_code: 'INVALID_PDF_FILE',
      error_message: `Le fichier n\\'a pas une signature PDF valide: ${item.binary?.[binaryField]?.fileName || 'source.pdf'}`,
      pdf_size_bytes: pdfSizeBytes,
    },
    binary: item.binary,
  }];
}

return [{
  json: {
    source_pdf_valid: true,
    marker_binary_field: binaryField,
    pdf_size_bytes: pdfSizeBytes,
  },
  binary: item.binary,
}];"""
        },
    }


def build_source_pdf_valid_if_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Source PDF Valid?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [-624, 752],
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2,
                },
                "conditions": [
                    {
                        "leftValue": "={{ $json.source_pdf_valid }}",
                        "rightValue": True,
                        "operator": {
                            "type": "boolean",
                            "operation": "true",
                            "singleValue": True,
                        },
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    }


def patch_read_markdown_node(existing: dict) -> dict:
    node = dict(existing)
    node["parameters"] = {
        "jsCode": """const item = $input.first();
let text;

if (item.binary && Object.keys(item.binary).length > 0) {
  const binaryKey = Object.keys(item.binary)[0];
  const buffer = await this.helpers.getBinaryDataBuffer(0, binaryKey);
  text = buffer.toString('utf-8');
} else {
  text = item.json.markdown;
}

return [{
  json: {
    ...item.json,
    text,
    markdown: text,
  },
}];"""
    }
    return node


def patch_get_marker_result_node(existing: dict) -> dict:
    node = dict(existing)
    node["parameters"]["url"] = "={{ $('Build Canonical Context').first().json.marker_result_url + '/' + $json.job_id }}"
    return node


def build_validate_success_payload_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Validate Success Payload",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1392, 656],
        "parameters": {
            "jsCode": """const item = $input.first();
const xml = String(item.json.xml || '').trim();
const markdown = String(item.json.markdown || '').trim();

let successReady = true;
let errorStage = null;
let errorCode = null;
let errorMessage = null;

if (!markdown) {
  successReady = false;
  errorStage = 'MARKDOWN';
  errorCode = 'MARKDOWN_EMPTY';
  errorMessage = 'Le markdown retourne par Marker est vide.';
} else if (!xml) {
  successReady = false;
  errorStage = 'XML';
  errorCode = 'XML_EMPTY';
  errorMessage = 'Le XML retourne par Gemini est vide.';
} else if (!/<fiche_projet(?:\\s|>)/i.test(xml)) {
  successReady = false;
  errorStage = 'XML';
  errorCode = 'XML_INVALID_ROOT';
  errorMessage = 'Le XML retourne par Gemini ne contient pas la racine fiche_projet attendue.';
}

return [{
  json: {
    ...item.json,
    success_ready: successReady,
    error_stage: errorStage,
    error_code: errorCode,
    error_message: errorMessage,
  },
}];"""
        },
    }


def build_success_payload_valid_if_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Success Payload Valid?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [1616, 656],
        "parameters": {
            "conditions": {
                "options": {
                    "caseSensitive": True,
                    "leftValue": "",
                    "typeValidation": "strict",
                    "version": 2,
                },
                "conditions": [
                    {
                        "leftValue": "={{ $json.success_ready }}",
                        "rightValue": True,
                        "operator": {
                            "type": "boolean",
                            "operation": "true",
                            "singleValue": True,
                        },
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
    }


def build_prepare_success_callback_node(existing: dict) -> dict:
    node = dict(existing)
    node["name"] = "Prepare Success Callback"
    node["type"] = "n8n-nodes-base.code"
    node["typeVersion"] = 2
    node["position"] = [1840, 576]
    node["parameters"] = {
        "jsCode": """const context = $('Build Canonical Context').first().json;
const getNodeJson = (nodeName) => {
  try {
    return $(nodeName).first()?.json ?? null;
  } catch {
    return null;
  }
};
const item = $input.first();
const pdfInfo = getNodeJson('Validate Source PDF Binary') ?? {};
const markerStats = getNodeJson('Increment Marker Poll Guard') ?? {};
const finishedAt = new Date().toISOString();
const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(context.started_at));
const payload = {
  contract_version: context.contract_version,
  processing_job_id: context.processing_job_id,
  appel_offre_id: context.appel_offre_id,
  code_interne: context.code_interne,
  correlation_id: context.correlation_id,
  execution_id: context.execution_id,
  status: 'COMPLETED',
  started_at: context.started_at,
  finished_at: finishedAt,
  duration_ms: durationMs,
  metadata: {
    llm_model: context.llm_model,
    marker_poll_count: markerStats.marker_poll_count ?? null,
    marker_elapsed_ms: markerStats.marker_elapsed_ms ?? null,
    pdf_size_bytes: pdfInfo.pdf_size_bytes ?? context.pdf_size_bytes ?? null,
  },
  result: {
    markdown: item.json.markdown,
    xml: item.json.xml,
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
      terminal_status: 'COMPLETED',
    },
  },
}];"""
    }
    return node


def build_prepare_failure_callback_node(name: str, position: list[int], stage_expression: str, code_expression: str, message_expression: str, retryable_expression: str, provider_expression: str | None = None) -> dict:
    provider_assignment = (
        f"    provider: {provider_expression},\n"
        if provider_expression is not None
        else ""
    )
    js_code = f"""const context = $('Build Canonical Context').first().json;
const getNodeJson = (nodeName) => {{
  try {{
    return $(nodeName).first()?.json ?? null;
  }} catch {{
    return null;
  }}
}};
const item = $input.first();
const markerStats = getNodeJson('Increment Marker Poll Guard') ?? {{}};
const finishedAt = new Date().toISOString();
const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(context.started_at));
const payload = {{
  contract_version: context.contract_version,
  processing_job_id: context.processing_job_id,
  appel_offre_id: context.appel_offre_id,
  code_interne: context.code_interne,
  correlation_id: context.correlation_id,
  execution_id: context.execution_id,
  status: 'FAILED',
  started_at: context.started_at,
  finished_at: finishedAt,
  duration_ms: durationMs,
  metadata: {{
    llm_model: context.llm_model,
    marker_poll_count: markerStats.marker_poll_count ?? null,
    marker_elapsed_ms: markerStats.marker_elapsed_ms ?? null,
  }},
  error: {{
    stage: {stage_expression},
    code: {code_expression},
    message: {message_expression},
    retryable: {retryable_expression},
{provider_assignment}  }},
}};

const rawBody = JSON.stringify(payload);

return [{{
  json: {{
    callback_sign_request: {{
      callback_url: context.callback_url,
      contract_version: context.contract_version,
      callback_timestamp: new Date().toISOString(),
      callback_raw_body: rawBody,
      terminal_status: 'FAILED',
    }},
  }},
}}];"""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": position,
        "parameters": {
            "jsCode": js_code
        },
    }


def build_sign_callback_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Sign Canonical Callback",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.4,
        "position": [2064, 704],
        "parameters": {
            "method": "POST",
            "url": "={{ $('Build Canonical Context').first().json.callback_signer_url }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {
                        "name": "Content-Type",
                        "value": "application/json",
                    }
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify($json.callback_sign_request || $json) }}",
            "options": {
                "response": {
                    "response": {
                        "responseFormat": "json",
                    }
                },
                "timeout": "={{ Number($('Build Canonical Context').first().json.callback_timeout_ms || 30000) }}",
            },
        },
    }


def build_unwrap_signed_callback_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Unwrap Signed Callback",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2176, 704],
        "parameters": {
            "jsCode": """const item = $input.first();
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
  },
}];"""
        },
    }


def build_send_callback_node() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "name": "Send Canonical Callback",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.4,
        "position": [2288, 704],
        "retryOnFail": True,
        "maxTries": 3,
        "waitBetweenTries": 5000,
        "parameters": {
            "method": "POST",
            "url": "={{ $json.callback_url }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {
                        "name": "Authorization",
                        "value": "=Bearer {{$env.PLATFORM_CALLBACK_TOKEN}}",
                    },
                    {
                        "name": "X-Contract-Version",
                        "value": "={{ $json.contract_version }}",
                    },
                    {
                        "name": "X-Callback-Timestamp",
                        "value": "={{ $json.callback_timestamp }}",
                    },
                    {
                        "name": "X-Callback-Signature",
                        "value": "={{ 'sha256=' + $json.callback_signature }}",
                    },
                    {
                        "name": "Content-Type",
                        "value": "application/json",
                    },
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ $json.callback_raw_body }}",
            "options": {
                "timeout": "={{ Number($('Build Canonical Context').first().json.callback_timeout_ms || 30000) }}",
            },
        },
    }


def replace_connection_targets(connections: dict, old_name: str, new_name: str) -> dict:
    updated = {}
    for source, outputs in connections.items():
        new_source = new_name if source == old_name else source
        cloned_outputs = json.loads(json.dumps(outputs))
        for branch in cloned_outputs.get("main", []):
            for edge in branch:
                if edge.get("node") == old_name:
                    edge["node"] = new_name
        updated[new_source] = cloned_outputs
    return updated


def patch_workflow(payload: dict) -> dict:
    nodes = payload["nodes"]
    settings = payload["settings"]
    nodes_by_name = {node["name"]: node for node in nodes}

    webhook = require_node(nodes_by_name, "Webhook CDC Initiation")
    webhook["parameters"] = {
        "httpMethod": "POST",
        "path": "cdc-initiation-fiche-projet-xml",
        "responseMode": "responseNode",
        "options": {},
    }

    validate_source = require_first_node(nodes_by_name, ["Validate Canonical Launch", "Validate Webhook Input"])
    context_source = require_first_node(nodes_by_name, ["Build Canonical Context", "Prepare Upload Paths"])
    read_pdf_source = require_first_node(nodes_by_name, ["Read Source PDF From Disk", "Save Uploaded PDF"])
    success_prepare_source = require_first_node(nodes_by_name, ["Prepare Success Callback", "Respond XML JSON"])

    validate_node = build_validate_launch_node(validate_source)
    context_node = build_canonical_context_node(context_source)
    read_pdf_node = build_read_pdf_node(read_pdf_source)
    convert_node = patch_convert_node(require_node(nodes_by_name, "Convert PDF via FastAPI Marker"))
    get_result_node = patch_get_marker_result_node(require_node(nodes_by_name, "Get Marker Result"))
    read_markdown_node = patch_read_markdown_node(require_node(nodes_by_name, "Read Markdown as Text"))
    success_prepare_node = build_prepare_success_callback_node(success_prepare_source)

    nodes_by_name[validate_source["name"]] = validate_node
    nodes_by_name[validate_node["name"]] = validate_node
    nodes_by_name[context_source["name"]] = context_node
    nodes_by_name[context_node["name"]] = context_node
    nodes_by_name[read_pdf_source["name"]] = read_pdf_node
    nodes_by_name[read_pdf_node["name"]] = read_pdf_node
    nodes_by_name["Convert PDF via FastAPI Marker"] = convert_node
    nodes_by_name["Get Marker Result"] = get_result_node
    nodes_by_name["Read Markdown as Text"] = read_markdown_node
    nodes_by_name[success_prepare_source["name"]] = success_prepare_node
    nodes_by_name[success_prepare_node["name"]] = success_prepare_node

    additional_nodes = [
        build_launch_valid_if_node(),
        build_launch_ready_if_node(),
        build_reject_response_node(),
        build_accept_response_node(),
        build_prepare_source_pdf_read_failure_node(),
        build_validate_source_pdf_binary_node(),
        build_source_pdf_valid_if_node(),
        build_validate_success_payload_node(),
        build_success_payload_valid_if_node(),
        build_prepare_failure_callback_node(
            "Prepare Marker Failure Callback",
            [944, 880],
            "'MARKER'",
            "'MARKER_FAILED'",
            "String($input.first().json.error || 'Marker job failed.')",
            "true",
            "null",
        ),
        build_prepare_failure_callback_node(
            "Prepare Marker Timeout Callback",
            [496, 960],
            "'MARKER'",
            "'MARKER_TIMEOUT'",
            "'Marker timeout exceeded.'",
            "true",
            "null",
        ),
        build_prepare_failure_callback_node(
            "Prepare Gemini Failure Callback",
            [1392, 880],
            "'LLM'",
            "'LLM_REQUEST_FAILED'",
            "String($input.first().json.error?.message || $input.first().json.message || 'Gemini request failed.')",
            "true",
            "'gemini'",
        ),
        build_prepare_failure_callback_node(
            "Prepare Validation Failure Callback",
            [1840, 800],
            "String($input.first().json.error_stage || 'UNKNOWN')",
            "String($input.first().json.error_code || 'VALIDATION_FAILED')",
            "String($input.first().json.error_message || 'Validation de sortie echouee.')",
            "false",
            "null",
        ),
        build_sign_callback_node(),
        build_unwrap_signed_callback_node(),
        build_send_callback_node(),
    ]

    nodes_to_remove = {
        "Marker Job Failed",
        "Marker Timeout",
        "Gemini Error Callback",
    }

    additional_nodes_by_name = {node["name"]: node for node in additional_nodes}
    final_nodes_by_name = dict(nodes_by_name)
    final_nodes_by_name.update(additional_nodes_by_name)

    new_nodes = []
    seen_names: set[str] = set()
    for original_node in nodes:
        name = original_node["name"]
        if name in nodes_to_remove or name in seen_names:
            continue
        replacement = final_nodes_by_name.get(name)
        if replacement is None:
            continue
        new_nodes.append(replacement)
        seen_names.add(name)

    for name, node in additional_nodes_by_name.items():
        if name in seen_names:
            continue
        new_nodes.append(node)
        seen_names.add(name)

    new_connections = {
        "Webhook CDC Initiation": {
            "main": [[{"node": "Validate Canonical Launch", "type": "main", "index": 0}]]
        },
        "Validate Canonical Launch": {
            "main": [[{"node": "Launch Valid?", "type": "main", "index": 0}]]
        },
        "Launch Valid?": {
            "main": [
                [{"node": "Build Canonical Context", "type": "main", "index": 0}],
                [{"node": "Respond Launch Rejected", "type": "main", "index": 0}],
            ]
        },
        "Build Canonical Context": {
            "main": [[{"node": "Launch Ready?", "type": "main", "index": 0}]]
        },
        "Launch Ready?": {
            "main": [[
                {"node": "Respond 202 Accepted", "type": "main", "index": 0},
                {"node": "Read Source PDF From Disk", "type": "main", "index": 0},
            ], [
                {"node": "Respond Launch Rejected", "type": "main", "index": 0}
            ]]
        },
        "Read Source PDF From Disk": {
            "main": [
                [{"node": "Validate Source PDF Binary", "type": "main", "index": 0}],
                [{"node": "Prepare Source PDF Read Failure", "type": "main", "index": 0}],
            ]
        },
        "Prepare Source PDF Read Failure": {
            "main": [[{"node": "Prepare Validation Failure Callback", "type": "main", "index": 0}]]
        },
        "Validate Source PDF Binary": {
            "main": [[{"node": "Source PDF Valid?", "type": "main", "index": 0}]]
        },
        "Source PDF Valid?": {
            "main": [
                [{"node": "Convert PDF via FastAPI Marker", "type": "main", "index": 0}],
                [{"node": "Prepare Validation Failure Callback", "type": "main", "index": 0}],
            ]
        },
        "Convert PDF via FastAPI Marker": {
            "main": [[{"node": "Init Marker Poll Guard", "type": "main", "index": 0}]]
        },
        "Init Marker Poll Guard": {
            "main": [[{"node": "Wait 30s Before Marker Result", "type": "main", "index": 0}]]
        },
        "Wait 30s Before Marker Result": {
            "main": [[{"node": "Increment Marker Poll Guard", "type": "main", "index": 0}]]
        },
        "Increment Marker Poll Guard": {
            "main": [[
                {"node": "Marker Timeout Reached?", "type": "main", "index": 0},
                {"node": "Merge Marker Result With Guard", "type": "main", "index": 0},
            ]]
        },
        "Get Marker Result": {
            "main": [[{"node": "Merge Marker Result With Guard", "type": "main", "index": 1}]]
        },
        "Merge Marker Result With Guard": {
            "main": [[{"node": "Check Marker Status", "type": "main", "index": 0}]]
        },
        "Check Marker Status": {
            "main": [
                [{"node": "Read Markdown as Text", "type": "main", "index": 0}],
                [{"node": "Wait 30s Before Marker Result", "type": "main", "index": 0}],
                [{"node": "Prepare Marker Failure Callback", "type": "main", "index": 0}],
            ]
        },
        "Read Markdown as Text": {
            "main": [[{"node": "HTTP Request → Gemini XML", "type": "main", "index": 0}]]
        },
        "HTTP Request → Gemini XML": {
            "main": [
                [{"node": "Clean XML Response", "type": "main", "index": 0}],
                [{"node": "Prepare Gemini Failure Callback", "type": "main", "index": 0}],
            ]
        },
        "Clean XML Response": {
            "main": [[{"node": "Validate Success Payload", "type": "main", "index": 0}]]
        },
        "Validate Success Payload": {
            "main": [[{"node": "Success Payload Valid?", "type": "main", "index": 0}]]
        },
        "Success Payload Valid?": {
            "main": [
                [{"node": "Prepare Success Callback", "type": "main", "index": 0}],
                [{"node": "Prepare Validation Failure Callback", "type": "main", "index": 0}],
            ]
        },
        "Marker Timeout Reached?": {
            "main": [
                [{"node": "Prepare Marker Timeout Callback", "type": "main", "index": 0}],
                [{"node": "Get Marker Result", "type": "main", "index": 0}],
            ]
        },
        "Prepare Marker Failure Callback": {
            "main": [[{"node": "Sign Canonical Callback", "type": "main", "index": 0}]]
        },
        "Prepare Marker Timeout Callback": {
            "main": [[{"node": "Sign Canonical Callback", "type": "main", "index": 0}]]
        },
        "Prepare Gemini Failure Callback": {
            "main": [[{"node": "Sign Canonical Callback", "type": "main", "index": 0}]]
        },
        "Prepare Validation Failure Callback": {
            "main": [[{"node": "Sign Canonical Callback", "type": "main", "index": 0}]]
        },
        "Prepare Success Callback": {
            "main": [[{"node": "Sign Canonical Callback", "type": "main", "index": 0}]]
        },
        "Sign Canonical Callback": {
            "main": [[{"node": "Unwrap Signed Callback", "type": "main", "index": 0}]]
        },
        "Unwrap Signed Callback": {
            "main": [[{"node": "Send Canonical Callback", "type": "main", "index": 0}]]
        },
    }

    payload["nodes"] = new_nodes
    payload["connections"] = new_connections
    payload["settings"] = settings
    return payload


def validate_connections(nodes: list[dict], connections: dict) -> None:
    names = {node["name"] for node in nodes}
    for source, outputs in connections.items():
        if source not in names:
            raise RuntimeError(f"Missing source node in connections: {source}")
        for branch in outputs.get("main", []):
            for edge in branch:
                if edge["node"] not in names:
                    raise RuntimeError(f"Missing target node in connections: {source} -> {edge['node']}")


def verify_payload(payload: dict) -> dict:
    workflow_blob = json.dumps(payload, ensure_ascii=False)
    nodes_by_name = {node["name"]: node for node in payload["nodes"]}

    webhook = require_node(nodes_by_name, "Webhook CDC Initiation")
    validate_launch = require_node(nodes_by_name, "Validate Canonical Launch")
    context = require_node(nodes_by_name, "Build Canonical Context")
    send_callback = require_node(nodes_by_name, "Send Canonical Callback")

    return {
        "workflow_json_valid": True,
        "response_mode_is_response_node": webhook["parameters"].get("responseMode") == "responseNode",
        "no_localhost_callback_url": "http://localhost:3000" not in workflow_blob,
        "no_legacy_complete_secret": "N8N_COMPLETE_SECRET" not in workflow_blob,
        "uses_callback_url_field": "$json.callback_url" in json.dumps(send_callback, ensure_ascii=False),
        "uses_platform_callback_token": "PLATFORM_CALLBACK_TOKEN" in workflow_blob,
        "uses_callback_signature": "X-Callback-Signature" in workflow_blob,
        "uses_callback_timestamp": "X-Callback-Timestamp" in workflow_blob,
        "uses_canonical_processing_job_id": "processing_job_id" in workflow_blob,
        "uses_canonical_execution_id": "execution_id" in workflow_blob,
        "uses_canonical_correlation_id": "correlation_id" in workflow_blob,
        "uses_pdf_path": "pdf_path" in json.dumps(validate_launch, ensure_ascii=False),
        "uses_shared_storage_root": "N8N_SHARED_STORAGE_ROOT" in json.dumps(context, ensure_ascii=False),
        "code_nodes_use_n8n_env": "process.env" not in workflow_blob,
        "no_disallowed_builtin_requires": all(
            token not in workflow_blob
            for token in (
                "require('crypto')",
                'require(\"crypto\")',
                "require('fs')",
                'require(\"fs\")',
                "require('path')",
                'require(\"path\")',
                "require('os')",
                'require(\"os\")',
                "require('child_process')",
                'require(\"child_process\")',
            )
        ),
        "provider_specific_stage_removed": '"stage": "gemini"' not in workflow_blob and '"stage": "groq"' not in workflow_blob,
    }


def main() -> None:
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH}")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    db_backup_path = backup_database()

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        entity_row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, staticData, pinData,
                   description, nodeGroups, updatedAt, versionId, activeVersionId, versionCounter
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        if entity_row is None:
            raise RuntimeError(f"Workflow {WORKFLOW_ID} not found")

        published_row = cur.execute(
            """
            select versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups
            from workflow_history
            where versionId = ?
            """,
            (entity_row["activeVersionId"],),
        ).fetchone()
        if published_row is None:
            raise RuntimeError(f"Published workflow history row {entity_row['activeVersionId']} not found")

        current_payload = workflow_payload_from_row(entity_row)
        published_payload = {
            "id": entity_row["id"],
            "name": entity_row["name"],
            "active": entity_row["active"],
            "nodes": json.loads(published_row["nodes"]),
            "connections": json.loads(published_row["connections"]),
            "settings": json.loads(entity_row["settings"]) if entity_row["settings"] else {},
            "updatedAt": published_row["updatedAt"],
            "versionId": entity_row["activeVersionId"],
            "activeVersionId": entity_row["activeVersionId"],
            "versionCounter": entity_row["versionCounter"],
        }

        draft_backup_path = backup_workflow_json(current_payload, "before_n8n_canonical_contract_draft")
        published_backup_path = backup_workflow_json(published_payload, "before_n8n_canonical_contract_published")

        patched_payload = patch_workflow(published_payload)
        validate_connections(patched_payload["nodes"], patched_payload["connections"])

        old_version_id = entity_row["versionId"]
        old_active_version_id = entity_row["activeVersionId"]
        old_version_counter = int(entity_row["versionCounter"] or 0)
        new_ver_id = new_version_id()
        new_version_counter = old_version_counter + 1
        now = utc_sql_timestamp()

        new_nodes_json = json.dumps(patched_payload["nodes"], ensure_ascii=False)
        new_connections_json = json.dumps(patched_payload["connections"], ensure_ascii=False)
        new_settings_json = json.dumps(patched_payload["settings"], ensure_ascii=False)

        conn.execute("BEGIN")

        cur.execute(
            """
            update workflow_entity
            set nodes = ?, connections = ?, settings = ?, versionId = ?, activeVersionId = ?, versionCounter = ?, updatedAt = ?
            where id = ?
            """,
            (
                new_nodes_json,
                new_connections_json,
                new_settings_json,
                new_ver_id,
                new_ver_id,
                new_version_counter,
                now,
                WORKFLOW_ID,
            ),
        )

        cur.execute(
            """
            insert into workflow_history
                (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description, nodeGroups)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_ver_id,
                WORKFLOW_ID,
                AUTHOR,
                now,
                now,
                new_nodes_json,
                new_connections_json,
                entity_row["name"],
                0,
                entity_row["description"],
                entity_row["nodeGroups"],
            ),
        )

        cur.execute(
            """
            insert into workflow_publish_history (workflowId, versionId, event, userId, createdAt)
            values (?, ?, 'activated', NULL, ?)
            """,
            (WORKFLOW_ID, new_ver_id, now),
        )

        dependency_rows = cur.execute(
            """
            select dependencyType, dependencyKey, indexVersionId, dependencyInfo
            from workflow_dependency
            where workflowId = ? and workflowVersionId = ?
            """,
            (WORKFLOW_ID, old_version_counter),
        ).fetchall()

        cur.execute(
            """
            update workflow_dependency
            set publishedVersionId = ?
            where workflowId = ? and workflowVersionId = ?
            """,
            (new_ver_id, WORKFLOW_ID, old_version_counter),
        )

        for dep in dependency_rows:
            cur.execute(
                """
                insert into workflow_dependency
                    (workflowId, workflowVersionId, dependencyType, dependencyKey, indexVersionId, createdAt, dependencyInfo, publishedVersionId)
                values (?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    WORKFLOW_ID,
                    new_version_counter,
                    dep["dependencyType"],
                    dep["dependencyKey"],
                    dep["indexVersionId"],
                    now,
                    dep["dependencyInfo"],
                ),
            )

        conn.commit()

        updated_row = cur.execute(
            """
            select id, name, active, nodes, connections, settings, updatedAt, versionId, activeVersionId, versionCounter
            from workflow_entity
            where id = ?
            """,
            (WORKFLOW_ID,),
        ).fetchone()
        updated_payload = workflow_payload_from_row(updated_row)

    after_export_path = backup_workflow_json(updated_payload, "after_n8n_canonical_contract")
    verification = verify_payload(updated_payload)

    print(
        json.dumps(
            {
                "workflow_id": WORKFLOW_ID,
                "workflow_name": updated_payload["name"],
                "db_backup_path": str(db_backup_path),
                "draft_backup_path": str(draft_backup_path),
                "published_backup_path": str(published_backup_path),
                "after_export_path": str(after_export_path),
                "old_version_id": old_version_id,
                "old_active_version_id": old_active_version_id,
                "new_version_id": updated_payload["versionId"],
                "old_version_counter": old_version_counter,
                "new_version_counter": updated_payload["versionCounter"],
                "verification": verification,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
