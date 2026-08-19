#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_LAUNCHER="$SCRIPT_DIR/start-n8n-local.sh"
tmp_root="$(mktemp -d)"
trap 'rm -rf -- "$tmp_root"' EXIT

copy_launcher() {
  local root="$1"
  mkdir -p "$root/scripts"
  cp "$SOURCE_LAUNCHER" "$root/scripts/start-n8n-local.sh"
  chmod +x "$root/scripts/start-n8n-local.sh"
}

missing_env_root="$tmp_root/missing-env"
copy_launcher "$missing_env_root"
if CONCEPT_N8N_PREFLIGHT_ONLY=1 CONCEPT_N8N_SKIP_PORT_CHECK=1 "$missing_env_root/scripts/start-n8n-local.sh" >/dev/null 2>"$tmp_root/missing-env.err"; then
  printf 'FAIL: missing .env.local was accepted\n' >&2
  exit 1
fi
grep -q 'Required environment file is missing' "$tmp_root/missing-env.err"

missing_required_root="$tmp_root/missing-required"
copy_launcher "$missing_required_root"
printf 'N8N_WEBHOOK_TOKEN=fixture\n' > "$missing_required_root/.env.local"
if CONCEPT_N8N_PREFLIGHT_ONLY=1 CONCEPT_N8N_SKIP_PORT_CHECK=1 "$missing_required_root/scripts/start-n8n-local.sh" >/dev/null 2>"$tmp_root/missing-required.err"; then
  printf 'FAIL: missing required variables were accepted\n' >&2
  exit 1
fi
grep -q 'PLATFORM_CALLBACK_TOKEN' "$tmp_root/missing-required.err"
grep -q 'GEMINI_API_KEY' "$tmp_root/missing-required.err"
! grep -q 'fixture' "$tmp_root/missing-required.err"

valid_root="$tmp_root/not-home-concept"
copy_launcher "$valid_root"
printf '%s\n' \
  'N8N_WEBHOOK_TOKEN=fixture-webhook' \
  'PLATFORM_CALLBACK_TOKEN=fixture-callback' \
  'GEMINI_API_KEY=fixture-gemini' > "$valid_root/.env.local"
output="$(CONCEPT_N8N_PREFLIGHT_ONLY=1 CONCEPT_N8N_SKIP_PORT_CHECK=1 "$valid_root/scripts/start-n8n-local.sh")"
grep -q 'startup preflight: OK' <<<"$output"
! grep -q 'fixture-' <<<"$output"

mkdir -p "$tmp_root/mock-bin"
cat > "$tmp_root/mock-bin/ss" <<'EOF'
#!/usr/bin/env bash
printf 'LISTEN 0 511 *:5678 *:* users:(("node",pid=4242,fd=1))\n'
EOF
chmod +x "$tmp_root/mock-bin/ss"
if PATH="$tmp_root/mock-bin:$PATH" CONCEPT_N8N_PREFLIGHT_ONLY=1 "$valid_root/scripts/start-n8n-local.sh" >/dev/null 2>"$tmp_root/occupied.err"; then
  printf 'FAIL: occupied port was accepted\n' >&2
  exit 1
fi
grep -q 'Port 5678 is already occupied' "$tmp_root/occupied.err"

grep -q 'CONCEPT_N8N_MANAGED_RUNTIME=1' "$SOURCE_LAUNCHER"
grep -q 'ExecStart=@REPO_ROOT@/scripts/start-n8n-local.sh' "$SCRIPT_DIR/systemd/concept-n8n.service"
! grep -q 'ExecStart=.*n8n start' "$SCRIPT_DIR/systemd/concept-n8n.service"

printf 'CONCEPT n8n startup tests: PASS\n'
