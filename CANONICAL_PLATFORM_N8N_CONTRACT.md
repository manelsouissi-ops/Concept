# CANONICAL PLATFORM / N8N CONTRACT

Document purpose:
- This is the official integration contract between the `Plateforme de Gestion Intelligente des Appels d'Offres` and the n8n workflow.
- It replaces previous implicit assumptions.
- The platform is the owner of all business data.
- n8n is only an asynchronous orchestration engine.

Contract version:
- `1.0`

Scope:
- CDC analysis launch
- asynchronous processing
- completion callback
- result persistence
- failure reporting

Out of scope:
- frontend behavior
- internal n8n node design
- internal PostgreSQL schema details
- prompt design
- XML structure internals beyond transport ownership

**1. Architecture**
Platform responsibilities:
- Own users, appels d'offres, documents, processing jobs, fiche CDC, audit logs, statuses, and validation.
- Store the source CDC PDF before any webhook is sent.
- Create the `Processing Job` before invoking n8n.
- Generate the `correlation_id`.
- Decide whether a callback is accepted, ignored, or rejected.
- Persist Markdown, XML, statuses, and audit history after callback validation.

n8n responsibilities:
- Accept a deterministic launch request from the platform.
- Orchestrate the technical pipeline only.
- Read the platform-owned PDF from the provided location.
- Call Marker.
- Call the configured LLM extraction provider.
- Return one completion callback to the platform.
- Never write business data directly to the platform database.

External service responsibilities:
- `Marker`: convert the PDF into structured Markdown or equivalent text extraction output.
- `LLM provider`: transform Markdown into the expected XML fiche output.

Data ownership rule:
- Platform owns persistent business data.
- n8n owns only transient execution state and temporary files.

Reference flow:

```text
Platform
  -> creates Appel d'offre / Document / Processing Job
  -> sends launch webhook

Webhook
  -> delivered to n8n

n8n
  -> validates request
  -> reads platform-owned PDF
  -> calls Marker
  -> prepares Markdown
  -> calls LLM provider
     current provider may be Gemini or Groq
     provider choice is not part of the business contract
  -> posts completion callback

Platform Callback
  -> authenticates callback
  -> validates correlation
  -> validates payload
  -> stores Markdown/XML
  -> updates Processing Job and business statuses
  -> writes audit logs

Platform Database
  -> remains the only source of truth for business state
```

**2. Webhook Request**
Canonical endpoint:
- Provided to the platform by configuration:
  - `N8N_WEBHOOK_URL`

Method:
- `POST`

Content-Type:
- `application/json`

Authentication:
- Required header:
  - `Authorization: Bearer <N8N_WEBHOOK_TOKEN>`

Additional required headers:
- `X-Contract-Version: 1.0`
- `Idempotency-Key: <correlation_id>`

Canonical request body:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "callback_url": "https://platform.example.com/api/fiche/callbacks/n8n",
  "pdf_path": "C:\\Users\\lotfi\\Documents\\Concept\\data\\AO-2026-014\\cdc.pdf",
  "requested_at": "2026-07-14T10:15:30.000Z"
}
```

Field definitions:
- `contract_version`
  - Required.
  - Version of this integration contract.
- `processing_job_id`
  - Required.
  - Platform-owned identifier for this analysis attempt.
  - One launch attempt equals one processing job.
- `appel_offre_id`
  - Required.
  - Platform-owned business identifier of the root Appel d'offre.
- `code_interne`
  - Required.
  - Human-readable operational reference.
  - Used for logs and traceability only.
- `correlation_id`
  - Required.
  - Platform-generated immutable idempotency key for this exact attempt.
  - Must be unique per attempt.
- `callback_url`
  - Required.
  - Absolute platform URL that n8n must call on completion.
  - Must never be hardcoded in the workflow.
- `pdf_path`
  - Required.
  - Absolute platform-owned path of the CDC PDF to process.
  - n8n may read it.
  - n8n must not treat this path as a place to write business outputs.
- `requested_at`
  - Required.
  - ISO-8601 UTC timestamp emitted by the platform when the request is sent.

Rules:
- The platform must store the CDC PDF before sending this request.
- The platform must create the Processing Job before sending this request.
- n8n must not require any additional business identifiers beyond this body.
- The platform must not wait for processing completion on this request.

**3. Webhook Acceptance Response**
Purpose:
- Confirm only that n8n accepted the request for asynchronous processing.
- Never return final business results here.

Response time:
- n8n should answer in less than 10 seconds.

HTTP status:
- `202 Accepted` on success
- `4xx` on client/auth/contract errors
- `5xx` on n8n-side technical acceptance failure

Content-Type:
- `application/json`

Canonical acceptance body:

```json
{
  "contract_version": "1.0",
  "accepted": true,
  "processing_job_id": "pj_20260714_000123",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "received_at": "2026-07-14T10:15:31.102Z",
  "processing_status": "RUNNING"
}
```

Required fields:
- `contract_version`
- `accepted`
- `processing_job_id`
- `correlation_id`
- `execution_id`
- `received_at`
- `processing_status`

Rules:
- `accepted` must be `true` only if n8n has created or reserved an execution for that request.
- `execution_id` is mandatory.
- `processing_status` must be one of:
  - `QUEUED`
  - `RUNNING`
- The platform must persist `execution_id` immediately.
- The platform must never treat a missing `execution_id` as a valid acceptance.

**4. Callback Contract**
Canonical endpoint:
- The exact `callback_url` supplied by the platform in the webhook request.

Method:
- `POST`

Content-Type:
- `application/json`

Authentication:
- Required headers:
  - `Authorization: Bearer <PLATFORM_CALLBACK_TOKEN>`
  - `X-Contract-Version: 1.0`
  - `X-Callback-Timestamp: <ISO-8601 UTC>`
  - `X-Callback-Signature: sha256=<hex_hmac>`

Shared secret:
- The callback signature is computed with a shared secret known only by the platform and n8n.
- Recommended env name:
  - `N8N_CALLBACK_SECRET`

Signature input:
- `<X-Callback-Timestamp> + "." + raw_request_body`

Mandatory callback body envelope:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "status": "COMPLETED",
  "started_at": "2026-07-14T10:15:31.102Z",
  "finished_at": "2026-07-14T10:18:44.900Z",
  "duration_ms": 193798,
  "metadata": {}
}
```

Mandatory envelope fields:
- `contract_version`
- `processing_job_id`
- `appel_offre_id`
- `code_interne`
- `correlation_id`
- `execution_id`
- `status`
- `started_at`
- `finished_at`
- `duration_ms`
- `metadata`

Allowed callback statuses:
- `COMPLETED`
- `FAILED`
- `CANCELLED`

Rules:
- Exactly one terminal callback must be attempted by n8n for each accepted execution.
- The callback must always echo the original `processing_job_id` and `correlation_id`.
- The callback must always include `execution_id`.
- `metadata` is required and may be empty.

**5. Success Callback**
Canonical success status:
- `COMPLETED`

Meaning:
- Marker completed successfully.
- Markdown was produced.
- The LLM provider completed successfully.
- XML was produced and is included in the callback.
- n8n considers the orchestration complete.

Canonical success body:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "status": "COMPLETED",
  "started_at": "2026-07-14T10:15:31.102Z",
  "finished_at": "2026-07-14T10:18:44.900Z",
  "duration_ms": 193798,
  "result": {
    "markdown": "# CDC\\n\\nContenu extrait...",
    "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><fiche_projet>...</fiche_projet>"
  },
  "metadata": {
    "marker_job_id": "marker_983741",
    "llm_provider": "gemini",
    "llm_model": "gemini-2.5-flash"
  }
}
```

Additional required success fields:
- `result.markdown`
- `result.xml`

Platform behavior on valid success callback:
1. Authenticate the callback.
2. Verify `contract_version`.
3. Verify `processing_job_id`, `correlation_id`, and `execution_id`.
4. Verify that this processing job is still the active attempt for the Appel d'offre.
5. Validate the XML.
6. Persist Markdown and XML in platform-owned storage.
7. Mark the Processing Job `COMPLETED`.
8. Move business status to `FICHE_CDC_A_VALIDER`.
9. Append audit logs.
10. Return an acknowledgement response.

Success acknowledgement response:
- HTTP `200 OK`

Example acknowledgement:

```json
{
  "acknowledged": true,
  "processing_job_id": "pj_20260714_000123",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "applied": true
}
```

**6. Failure Callback**
Canonical failure statuses:
- `FAILED`
- `CANCELLED`

Meaning:
- `FAILED`: the workflow attempted processing and ended in a technical or content-processing failure.
- `CANCELLED`: the execution was intentionally cancelled and no further processing will occur.

Canonical failure body:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "status": "FAILED",
  "started_at": "2026-07-14T10:15:31.102Z",
  "finished_at": "2026-07-14T10:17:02.410Z",
  "duration_ms": 91308,
  "error": {
    "stage": "LLM",
    "code": "LLM_REQUEST_FAILED",
    "message": "The LLM request failed before XML generation.",
    "retryable": true,
    "provider": "gemini"
  },
  "metadata": {
    "marker_job_id": "marker_983741",
    "llm_provider": "gemini",
    "llm_model": "gemini-2.5-flash"
  }
}
```

Required failure fields:
- `error.stage`
- `error.code`
- `error.message`
- `error.retryable`

Canonical error stages:

| Stage | Meaning | Example code | Recommended action |
|---|---|---|---|
| `WEBHOOK` | Request was rejected before real processing started | `WEBHOOK_AUTH_FAILED` | Check auth token, contract version, and request schema |
| `UPLOAD` | n8n could not access the platform-owned PDF | `PDF_NOT_FOUND` | Verify `pdf_path`, file permissions, and storage availability |
| `MARKER` | PDF-to-Markdown extraction failed or timed out | `MARKER_TIMEOUT` | Retry after checking Marker service and PDF health |
| `MARKDOWN` | Markdown output was empty or unusable | `MARKDOWN_EMPTY` | Inspect Marker output and extraction rules |
| `ANONYMIZATION` | Optional anonymization step failed | `ANONYMIZATION_FAILED` | Retry or disable optional anonymization according to ops rules |
| `LLM` | LLM provider call failed or returned unusable content | `LLM_REQUEST_FAILED` | Retry after checking provider availability, key, limits, and model configuration |
| `XML` | XML was missing, invalid, or did not pass validation | `XML_INVALID` | Inspect returned content and validation rules |
| `CALLBACK` | n8n could not deliver the callback successfully | `CALLBACK_REJECTED` | Retry callback with same correlation and execution identifiers |
| `UNKNOWN` | No precise stage could be determined | `UNKNOWN_ERROR` | Manual investigation required |

Rules:
- Provider-specific names such as `GROQ`, `GEMINI`, or `OLLAMA` must not be used as canonical stages.
- Provider details belong in `error.provider` or `metadata`.
- This keeps the contract stable even if the LLM provider changes.

Platform behavior on valid failure callback:
1. Authenticate the callback.
2. Verify `processing_job_id`, `correlation_id`, and `execution_id`.
3. Verify that this attempt is still active.
4. Persist the failure details.
5. Mark the Processing Job `FAILED` or `CANCELLED`.
6. Move business status to `ERREUR` unless the Appel d'offre was already archived.
7. Append audit logs.
8. Return an acknowledgement response.

**7. Business Statuses**
Only allowed business statuses:
- `BROUILLON`
- `CDC_IMPORTE`
- `EN_ATTENTE_ANALYSE`
- `ANALYSE_EN_COURS`
- `FICHE_CDC_A_VALIDER`
- `FICHE_CDC_VALIDEE`
- `ERREUR`
- `ARCHIVE`

Definitions:
- `BROUILLON`
  - Appel d'offre exists.
  - No usable CDC PDF is attached yet.
- `CDC_IMPORTE`
  - CDC PDF is stored by the platform.
  - No analysis has been requested yet.
- `EN_ATTENTE_ANALYSE`
  - The platform created the Processing Job.
  - The launch is pending acceptance or queued for dispatch.
- `ANALYSE_EN_COURS`
  - n8n accepted the job and processing is in progress.
- `FICHE_CDC_A_VALIDER`
  - Platform has stored valid Markdown and XML.
  - Commercial review is required.
- `FICHE_CDC_VALIDEE`
  - Commercial validation is complete.
- `ERREUR`
  - The latest analysis attempt ended in a failure requiring action.
- `ARCHIVE`
  - The Appel d'offre is archived and no new analysis should start until unarchived.

Canonical transitions:

```text
BROUILLON
  -> CDC_IMPORTE

CDC_IMPORTE
  -> EN_ATTENTE_ANALYSE
  -> ARCHIVE

EN_ATTENTE_ANALYSE
  -> ANALYSE_EN_COURS
  -> ERREUR
  -> ARCHIVE

ANALYSE_EN_COURS
  -> FICHE_CDC_A_VALIDER
  -> ERREUR
  -> ARCHIVE only after explicit cancellation

FICHE_CDC_A_VALIDER
  -> FICHE_CDC_VALIDEE
  -> EN_ATTENTE_ANALYSE on explicit regenerate
  -> ARCHIVE

FICHE_CDC_VALIDEE
  -> EN_ATTENTE_ANALYSE on explicit regenerate
  -> ARCHIVE

ERREUR
  -> EN_ATTENTE_ANALYSE on retry
  -> ARCHIVE
```

**8. Processing Job Statuses**
Only allowed processing job statuses:
- `CREATED`
- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELLED`
- `RETRYING`

Definitions:
- `CREATED`
  - Platform created the job record.
  - No webhook dispatch has happened yet.
- `QUEUED`
  - Platform is dispatching or has scheduled dispatch.
  - n8n acceptance not yet persisted.
- `RUNNING`
  - n8n accepted the job and returned `execution_id`.
- `COMPLETED`
  - Success callback was accepted and applied by the platform.
- `FAILED`
  - Failure callback was accepted and applied by the platform, or launch failed definitively.
- `CANCELLED`
  - Platform or operator cancelled the attempt.
- `RETRYING`
  - Previous attempt failed or timed out and the platform is creating a new attempt.

Canonical transitions:

```text
CREATED -> QUEUED -> RUNNING -> COMPLETED
CREATED -> QUEUED -> RUNNING -> FAILED
CREATED -> QUEUED -> FAILED
RUNNING -> CANCELLED
FAILED -> RETRYING -> CREATED
CANCELLED -> RETRYING -> CREATED
```

Rules:
- One user-triggered retry creates a new `processing_job_id`.
- `RETRYING` is transitional and platform-owned.
- n8n must never decide business retries by itself.

**9. Idempotency**
Canonical identifiers:
- `processing_job_id`
  - Platform-owned business processing record.
- `correlation_id`
  - Platform-owned immutable integration idempotency key for one attempt.
- `execution_id`
  - n8n-owned execution identifier for one accepted run.

Rules for duplicate webhook requests:
- Same `correlation_id` sent twice means the same attempt.
- n8n must treat the second request as idempotent.
- n8n must return the same acceptance semantics for the same `correlation_id`.
- n8n must not create a second live execution for the same `correlation_id`.

Rules for duplicate callbacks:
- Same `processing_job_id` + `correlation_id` + `execution_id` + terminal `status` sent again must be treated by the platform as a duplicate.
- The platform must return `200 OK` with `applied: false` when the callback was already applied.

Rules for retry:
- Every retry creates:
  - a new `processing_job_id`
  - a new `correlation_id`
- A retry must never reuse a prior `correlation_id`.

Rules for old execution finishing after retry:
- The platform must track one active attempt per Appel d'offre.
- If an older callback arrives after a newer retry is already active or completed:
  - the platform must authenticate it
  - detect it as stale by `processing_job_id` and `correlation_id`
  - acknowledge it as ignored
  - perform no business state change

Recommended callback acknowledgement for stale attempt:

```json
{
  "acknowledged": true,
  "processing_job_id": "pj_old",
  "correlation_id": "corr_old",
  "applied": false,
  "reason": "stale_attempt"
}
```

**10. Security**
Webhook authentication:
- Mandatory bearer token:
  - `Authorization: Bearer <N8N_WEBHOOK_TOKEN>`

Callback authentication:
- Mandatory bearer token:
  - `Authorization: Bearer <PLATFORM_CALLBACK_TOKEN>`
- Mandatory HMAC signature:
  - `X-Callback-Signature`
- Mandatory callback timestamp:
  - `X-Callback-Timestamp`

Shared secret:
- Use one dedicated callback secret:
  - `N8N_CALLBACK_SECRET`
- Do not hardcode secrets in the workflow.

Replay protection:
- Platform must reject callbacks whose `X-Callback-Timestamp` is older than 5 minutes.
- Platform must reject invalid HMAC signatures.
- Platform must record already-applied callback tuples:
  - `processing_job_id`
  - `correlation_id`
  - `execution_id`
  - `status`

Allowed origins:
- Server-to-server bearer token and HMAC are the source of trust.
- Network allowlisting should be used when possible.
- `Origin` header checks are optional and advisory only.

Timeouts:
- Webhook acceptance timeout:
  - platform waits up to 10 seconds
- Callback request timeout from n8n to platform:
  - 30 seconds per attempt
- Callback retries:
  - n8n should retry transient callback delivery failures with backoff

Maximum payload sizes:
- Webhook request body:
  - 32 KB max
- Callback success body:
  - 10 MB max total JSON payload
- Callback failure body:
  - 256 KB max

Maximum file size:
- Source CDC PDF:
  - 50 MB max

Operational rules:
- n8n must not log full secrets.
- Platform must not trust undocumented fields.
- Platform must reject callbacks with missing mandatory fields.

**11. Versioning**
Current contract version:
- `1.0`

Version transport:
- Always send:
  - header `X-Contract-Version: 1.0`
  - body field `contract_version: "1.0"`

Compatibility rules:
- Patch change:
  - clarifies wording only
  - no payload change
- Minor change:
  - adds optional fields only
  - must remain backward compatible
- Major change:
  - changes semantics, removes fields, or changes required fields
  - requires explicit coordinated rollout

Deprecated fields:
- May remain accepted for one major version only.
- Must be documented with:
  - deprecation notice
  - last supported version
  - removal date

Future compatibility rule:
- Unknown optional fields must be ignored.
- Unknown required fields must never be invented by either side.

**12. Sequence Diagram**

```text
Commercial
  -> Platform: create Appel d'offre
  -> Platform: upload CDC

Platform
  -> Platform DB: create/update Appel d'offre
  -> Platform DB: store document metadata
  -> Platform DB: create Processing Job (CREATED)
  -> Platform Storage: persist cdc.pdf
  -> Platform DB: set business status EN_ATTENTE_ANALYSE
  -> n8n Webhook: POST launch request

n8n
  -> n8n: validate auth + contract + body
  -> Platform: 202 Accepted + execution_id

Platform
  -> Platform DB: persist execution_id
  -> Platform DB: set Processing Job RUNNING
  -> Platform DB: set business status ANALYSE_EN_COURS

n8n
  -> Platform Storage: read pdf_path
  -> Marker: extract markdown
  -> n8n: validate markdown
  -> LLM provider: generate XML
  -> n8n: validate XML payload exists

Success path:
n8n
  -> Platform Callback: POST COMPLETED callback
Platform
  -> Platform: authenticate callback
  -> Platform DB: verify active processing job
  -> Platform Storage: write cdc.md and fiche.xml
  -> Platform DB: mark Processing Job COMPLETED
  -> Platform DB: set business status FICHE_CDC_A_VALIDER
  -> Platform DB: append audit logs
  -> n8n: 200 acknowledged

Failure path:
n8n
  -> Platform Callback: POST FAILED callback
Platform
  -> Platform: authenticate callback
  -> Platform DB: verify active processing job
  -> Platform DB: mark Processing Job FAILED
  -> Platform DB: set business status ERREUR
  -> Platform DB: append audit logs
  -> n8n: 200 acknowledged
```

**13. Examples**
Webhook request example:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "callback_url": "https://platform.example.com/api/fiche/callbacks/n8n",
  "pdf_path": "C:\\Users\\lotfi\\Documents\\Concept\\data\\AO-2026-014\\cdc.pdf",
  "requested_at": "2026-07-14T10:15:30.000Z"
}
```

Webhook acceptance example:

```json
{
  "contract_version": "1.0",
  "accepted": true,
  "processing_job_id": "pj_20260714_000123",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "received_at": "2026-07-14T10:15:31.102Z",
  "processing_status": "RUNNING"
}
```

Success callback example:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "status": "COMPLETED",
  "started_at": "2026-07-14T10:15:31.102Z",
  "finished_at": "2026-07-14T10:18:44.900Z",
  "duration_ms": 193798,
  "result": {
    "markdown": "# CDC\\n\\nContenu extrait...",
    "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><fiche_projet>...</fiche_projet>"
  },
  "metadata": {
    "marker_job_id": "marker_983741",
    "llm_provider": "gemini",
    "llm_model": "gemini-2.5-flash"
  }
}
```

Failure callback example:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "pj_20260714_000123",
  "appel_offre_id": "ao_20260714_000045",
  "code_interne": "AO-2026-014",
  "correlation_id": "corr_01JYV7Y8R4P6S2D5H9K3M1N7QX",
  "execution_id": "194",
  "status": "FAILED",
  "started_at": "2026-07-14T10:15:31.102Z",
  "finished_at": "2026-07-14T10:17:02.410Z",
  "duration_ms": 91308,
  "error": {
    "stage": "MARKER",
    "code": "MARKER_TIMEOUT",
    "message": "Marker did not complete within the allowed timeout.",
    "retryable": true,
    "provider": null
  },
  "metadata": {
    "marker_job_id": "marker_983741"
  }
}
```

**14. State Ownership**

| Data / State | Owner | Notes |
|---|---|---|
| Users | Platform | Business owner only |
| Appel d'offre | Platform | Root business entity |
| Documents metadata | Platform | Stored in platform DB |
| Processing Job | Platform | One attempt per job |
| Business statuses | Platform | Canonical source of truth |
| Validation state | Platform | Commercial validation is platform-owned |
| Audit logs | Platform | Platform-owned history |
| Source PDF | Platform | n8n may read only |
| Markdown artifact | Platform | n8n generates transiently, platform persists |
| Fiche CDC XML | Platform | n8n generates transiently, platform persists |
| `correlation_id` | Platform | Idempotency and attempt correlation |
| `processing_job_id` | Platform | Business processing record |
| `execution_id` | n8n | Technical workflow execution identifier |
| Temporary files | n8n | Internal orchestration only |
| Marker execution state | n8n / Marker | Technical, not business ownership |
| LLM provider request state | n8n | Technical, not business ownership |
| Final callback decision | Platform | Platform decides whether a callback is applied |

**15. Implementation Checklist**

Platform tasks:
- Generate and persist `processing_job_id` before launch.
- Generate a new `correlation_id` for every attempt.
- Persist the source PDF before launch.
- Send JSON launch requests, not ad hoc multipart launch requests.
- Include `callback_url` on every launch.
- Require and persist `execution_id` from acceptance.
- Authenticate and verify every callback.
- Validate XML before marking a job completed.
- Store Markdown/XML in platform-owned storage.
- Make Processing Job state authoritative in the database.
- Ignore stale callbacks safely.
- Record audit logs for launch, success, failure, retry, cancel, and validation.

n8n tasks:
- Enforce webhook bearer-token authentication.
- Treat `correlation_id` as the idempotency key.
- Return `202 Accepted` with mandatory `execution_id`.
- Read `pdf_path` from platform-owned storage.
- Keep all output files temporary unless explicitly needed internally.
- Send exactly one terminal callback per accepted execution.
- Use provider-neutral error stages.
- Include provider-specific details only in `metadata` or `error.provider`.
- Retry callback delivery on transient failures without changing identifiers.
- Never write directly into the platform database.

Shared tasks:
- Freeze contract version `1.0`.
- Standardize mandatory headers and field names.
- Standardize business and processing-job statuses.
- Standardize callback acknowledgement semantics.
- Standardize stale-attempt behavior.
- Standardize timeout and payload limits.
- Document secret rotation and environment variables.
- Validate one successful and one failed end-to-end run against this contract before wider rollout.

Final rule:
- If platform behavior and n8n behavior conflict, this document wins.
