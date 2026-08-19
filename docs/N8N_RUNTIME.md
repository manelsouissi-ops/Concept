# CONCEPT n8n runtime

> **Do not run `n8n start` directly.**

Plain n8n startup does not load the CONCEPT runtime contract. The `/healthz`
endpoint can therefore be green while workflow Code nodes fail to read `$env`.

The supported runtime is the user systemd service, which invokes the project
launcher as the single source of environment initialization:

```bash
scripts/manage-n8n.sh status
scripts/manage-n8n.sh check
scripts/manage-n8n.sh restart
scripts/manage-n8n.sh logs
```

Equivalent direct controls are:

```bash
systemctl --user status concept-n8n
systemctl --user restart concept-n8n
```

Install or refresh the unit after moving the repository:

```bash
scripts/manage-n8n.sh install
systemctl --user enable --now concept-n8n
```

## Readiness and troubleshooting

`scripts/check-n8n-runtime.sh` verifies the listener process, managed-runtime
marker, `$env` access policy, and CDC/FCI runtime contracts without printing
secret values. A healthy HTTP endpoint alone is not sufficient.

If port 5678 is already occupied, the managed launcher refuses to start and
reports the owner instead of killing or replacing it. Stop the known existing
runtime gracefully, then start the user service. Workflow definitions,
credentials, executions, and the n8n database remain in the existing user
folder.
