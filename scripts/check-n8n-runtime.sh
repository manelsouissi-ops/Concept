#!/usr/bin/env bash
set -Eeuo pipefail

port="${N8N_PORT:-5678}"
health_url="http://127.0.0.1:${port}/healthz"
pid="$(ss -H -ltnp "sport = :$port" 2>/dev/null | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -1)"

health="FAIL"
process_state="not running"
managed="NO"
env_access="disabled"
cdc_contract="FAIL"
fci_contract="FAIL"
gonogo_contract="OK"
runtime_contract="INVALID"

if curl -fsS --max-time 5 "$health_url" >/dev/null 2>&1; then
  health="OK"
fi

has_env() {
  local name="$1"
  [[ -n "$pid" ]] && tr '\0' '\n' < "/proc/$pid/environ" | cut -d= -f1 | grep -Fxq "$name"
}

env_equals() {
  local expected="$1"
  [[ -n "$pid" ]] && tr '\0' '\n' < "/proc/$pid/environ" | grep -Fxq "$expected"
}

if [[ -n "$pid" && -r "/proc/$pid/environ" ]]; then
  process_state="running (PID $pid)"
  env_equals "CONCEPT_N8N_MANAGED_RUNTIME=1" && managed="YES"
  env_equals "N8N_BLOCK_ENV_ACCESS_IN_NODE=false" && env_access="enabled"

  if has_env N8N_WEBHOOK_TOKEN \
    && has_env PLATFORM_CALLBACK_TOKEN \
    && has_env N8N_CALLBACK_SIGNER_URL \
    && has_env N8N_SHARED_STORAGE_ROOT \
    && has_env MARKER_CONVERT_URL \
    && has_env MARKER_STATUS_URL \
    && has_env MARKER_RESULT_URL; then
    cdc_contract="OK"
  fi

  if has_env N8N_WEBHOOK_TOKEN \
    && has_env PLATFORM_CALLBACK_TOKEN \
    && has_env GEMINI_API_KEY \
    && has_env FCI_CALLBACK_SIGNER_URL; then
    fci_contract="OK"
  fi
fi

if [[ "$health" == "OK" && "$managed" == "YES" && "$env_access" == "enabled" \
  && "$cdc_contract" == "OK" && "$fci_contract" == "OK" && "$gonogo_contract" == "OK" ]]; then
  runtime_contract="VALID"
fi

printf '%s\n' \
  'CONCEPT n8n runtime' \
  '-------------------' \
  "Health: $health" \
  "Process: $process_state" \
  "Managed launcher: $managed" \
  "Env access: $env_access" \
  "CDC contract env: $cdc_contract" \
  "FCI contract env: $fci_contract" \
  "Go/No-Go contract env: $gonogo_contract" \
  "Runtime contract: $runtime_contract"

[[ "$runtime_contract" == "VALID" ]]
