# n8n Canonical Contract Environment

## Required launch-side variables

- `N8N_WEBHOOK_TOKEN`
  Bearer token that the platform sends to the n8n launch webhook.

- `N8N_CONTRACT_VERSION`
  Canonical contract version shared with the platform.
  Current expected value: `1.0`.

## Required callback-side variables

- `PLATFORM_CALLBACK_TOKEN`
  Bearer token that n8n must send back to the platform callback URL.

- `N8N_CALLBACK_SECRET`
  HMAC secret used to compute:
  - `X-Callback-Signature`
  - over `X-Callback-Timestamp + "." + raw_request_body`

- `N8N_CALLBACK_TIMEOUT_MS`
  Timeout in milliseconds for the HTTP callback to the platform.
  Recommended default: `30000`.

## Required shared-storage variables

- `N8N_SHARED_STORAGE_ROOT`
  Absolute shared root under which platform-generated `pdf_path` values must reside.
  n8n validates that every incoming `pdf_path` remains inside this root before processing.

## Required Marker service variables

- `MARKER_CONVERT_URL`
  URL used to submit the PDF to Marker/FastAPI.

- `MARKER_RESULT_URL`
  Base URL used to poll Marker results.
  The workflow appends `/{job_id}` to this base URL.

## Required AI provider variables

- `GEMINI_API_KEY`
  API key used by the Gemini OpenAI-compatible HTTP request node.

## Optional runtime/path variables

- `N8N_PLATFORM_DATA_ROOT`
  Optional documentation-only alias if the n8n host needs to reason about the platform data root separately.

- `N8N_RUNTIME_DATA_ROOT`
  Optional path-translation helper if platform and n8n do not see identical absolute paths.
  The current patch assumes direct shared-path visibility and does not apply translation automatically.

## Notes

- Do not hardcode:
  - platform callback URLs
  - bearer tokens
  - HMAC secrets
  - Gemini keys

- The workflow should read the callback URL from the launch payload field:
  - `callback_url`

- The workflow should read the PDF location from the launch payload field:
  - `pdf_path`
