@echo off
setlocal
rem Controlled local canonical-contract test only.
rem This script uses tmp/ shared storage plus local stub services on 127.0.0.1:8898 and 127.0.0.1:8899.
rem For the real repository data root and runtime wiring, see docs/n8n-canonical-contract-env.md.
for %%I in ("%~dp0..\..") do set "REPO_ROOT=%%~fI"
set "TMP_ROOT=%REPO_ROOT%\tmp"
set "N8N_WEBHOOK_TOKEN=replace-with-launch-token"
set "N8N_CONTRACT_VERSION=1.0"
set "PLATFORM_CALLBACK_TOKEN=replace-with-callback-bearer-token"
set "N8N_CALLBACK_SECRET=replace-with-hmac-secret"
set "N8N_CALLBACK_SIGNER_URL=http://127.0.0.1:8899/sign"
set "N8N_CALLBACK_TIMEOUT_MS=10000"
set "N8N_RESTRICT_FILE_ACCESS_TO=%TMP_ROOT%\n8n-shared;~/.n8n-files"
set "N8N_SHARED_STORAGE_ROOT=%TMP_ROOT%\n8n-shared"
set "MARKER_CONVERT_URL=http://127.0.0.1:8898/convert"
set "MARKER_STATUS_URL=http://127.0.0.1:8898/status"
set "MARKER_RESULT_URL=http://127.0.0.1:8898/result"
set "GEMINI_API_KEY=replace-with-gemini-api-key"
call "%AppData%\npm\n8n.cmd" start
