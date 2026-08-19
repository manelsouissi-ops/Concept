#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
profile="${1:---core}"
[[ "$profile" == "--core" || "$profile" == "--full" ]] || { printf 'Usage: %s [--core|--full]\n' "$0" >&2; exit 2; }
ENV_FILE="$REPO_ROOT/.env.local"
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

core_fail=0
full_degraded=0
service_state() { systemctl --user is-active --quiet "$1" && printf 'RUNNING' || printf 'STOPPED'; }
http_state() { curl -fsS --max-time 5 "$1" >/dev/null 2>&1 && printf 'OK' || printf 'FAIL'; }
container_state() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || true)" == true ]] && printf 'RUNNING' || printf 'STOPPED'; }

postgres_service="$(systemctl is-active postgresql@18-main.service 2>/dev/null || true)"
postgres_db="FAIL"
if [[ -n "${DATABASE_URL:-}" ]] && psql "$DATABASE_URL" -X -Atc 'select 1' 2>/dev/null | grep -qx 1; then postgres_db="OK"; fi
[[ "$postgres_service" == active && "$postgres_db" == OK ]] || core_fail=1
n8n_contract="INVALID"
if "$SCRIPT_DIR/check-n8n-runtime.sh" >/tmp/concept-n8n-check.out 2>&1; then n8n_contract="VALID"; else core_fail=1; fi
docling_service="$(service_state concept-docling.service)"
docling_health="$(http_state http://127.0.0.1:8010/health)"; [[ "$docling_service" == RUNNING && "$docling_health" == OK ]] || core_fail=1
web_service="$(service_state concept-web.service)"
web_health="$(http_state http://127.0.0.1:3000/login)"; [[ "$web_service" == RUNNING && "$web_health" == OK ]] || core_fail=1

printf '%s\n' 'CONCEPT Platform — Office' '=========================' '' 'CORE'
printf 'PostgreSQL\n  Service: %s\n  Port 5432 / database: %s\n' "${postgres_service^^}" "$postgres_db"
printf 'n8n\n  Service: %s\n  Runtime contract: %s\n' "$(service_state concept-n8n.service)" "$n8n_contract"
printf 'Docling\n  Service: %s\n  Health: %s\n' "$docling_service" "$docling_health"
printf 'CONCEPT Web\n  Service: %s\n  URL: http://127.0.0.1:3000\n  Health: %s\n' "$web_service" "$web_health"

if [[ "$profile" == "--full" ]]; then
  ollama_health="$(http_state http://127.0.0.1:11434/api/version)"; [[ "$ollama_health" == OK ]] || full_degraded=1
  qdrant_health="$(http_state http://127.0.0.1:6333/healthz)"; [[ "$qdrant_health" == OK ]] || full_degraded=1
  webui_health="$(http_state http://127.0.0.1:3002/health)"; [[ "$webui_health" == OK ]] || full_degraded=1
  kb_health="$(http_state http://127.0.0.1:8092/health)"; [[ "$kb_health" == OK ]] || full_degraded=1
  rag_configured=NO; [[ -n "${LOCAL_RAG_SERVICE_TOKEN:-}" && -x "$REPO_ROOT/.venv-rag/bin/python" ]] && rag_configured=YES
  rag_health="$(http_state http://127.0.0.1:8091/health)"
  [[ "$rag_configured" == NO || "$rag_health" == OK ]] || full_degraded=1
  printf '%s\n' '' 'LOCAL AI / KNOWLEDGE'
  printf 'Ollama\n  Service: %s\n  Health: %s\n' "$(systemctl is-active ollama.service 2>/dev/null || true)" "$ollama_health"
  printf 'Qdrant\n  Container: %s\n  Health: %s\n' "$(container_state qdrant)" "$qdrant_health"
  printf 'Historical KB\n  Service: %s\n  Health: %s\n' "$(service_state concept-kb.service)" "$kb_health"
  if [[ "$rag_configured" == YES ]]; then printf 'Local RAG\n  Service: %s\n  Health: %s\n' "$(service_state concept-local-rag.service)" "$rag_health"; else printf 'Local RAG\n  Status: OPTIONAL — NOT CONFIGURED\n'; fi
  printf 'Open WebUI\n  Container: %s\n  URL: http://127.0.0.1:3002\n  Health: %s\n' "$(container_state open-webui)" "$webui_health"
fi

overall_core=READY; (( core_fail == 0 )) || overall_core='NOT READY'
printf '\nOverall CORE: %s\n' "$overall_core"
if [[ "$profile" == "--full" ]]; then overall_full=READY; (( core_fail == 0 && full_degraded == 0 )) || overall_full=DEGRADED; printf 'Overall FULL: %s\n' "$overall_full"; fi
(( core_fail == 0 ))
