# CONCEPT Office runtime

The normal Office startup command is:

```bash
cd ~/Concept
./scripts/start-concept.sh
```

It starts the FULL profile. Use the manager directly for explicit profiles:

```bash
./scripts/manage-concept.sh start --core
./scripts/manage-concept.sh start --full
./scripts/manage-concept.sh status --full
./scripts/manage-concept.sh restart --full
./scripts/manage-concept.sh stop --full
```

`./scripts/check-concept.sh --full` performs consolidated readiness checks.

CORE contains PostgreSQL, managed n8n, the Docling parser adapter, and the
Next.js development application. FULL adds Ollama, the existing Qdrant and
Open WebUI containers, Historical KB, and configured Local RAG. Optional local
AI tooling never blocks CORE readiness.

Stop controls only CONCEPT-owned user services. It deliberately leaves shared
PostgreSQL, Ollama, Qdrant, and Open WebUI running. Logs are available with
`./scripts/manage-concept.sh logs {n8n|docling|web|kb|rag}`.

Never run plain `n8n start`; it bypasses the CONCEPT runtime contract. A green
n8n health endpoint alone is insufficient—use the consolidated checker.
