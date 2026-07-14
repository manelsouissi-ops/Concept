# Incidents

## 2026-07-08 — Shared build directory between `next dev` and `next start` is a footgun

Class of bug: any two Next.js processes pointed at the same `distDir`
(default `.next/`) can stomp on each other's build artifacts while both
are running or being restarted — not just a dev-vs-prod pairing. Two prod
instances sharing a distDir, or an `rm -rf .next` / rebuild firing while
another process is serving from it, are the same bug wearing a different
hat.

Instance hit: a `next start -p 3016` production server (started earlier
for manual testing) and the `next dev` server on port 3000 both used the
default `.next/` directory. Restarting `next dev` regenerated `.next/` in
dev format, wiping the production build's CSS/JS chunks out from under the
still-running `next start` process — it kept serving HTML that referenced
now-deleted asset filenames, so `/initiation` on 3016 rendered unstyled and
the "Generate" button did nothing (client bundle never loaded, so React
never hydrated).

Fix: `next.config.ts` now reads `distDir` from `NEXT_DIST_DIR`, and
`npm run dev` / `npm run build:prod` / `npm run start:prod` each set it to
a separate directory (`.next-dev` / `.next-prod`) via `cross-env`. Any
future mode (staging, a second prod port, etc.) needs its own distDir
value too — the guard is per-directory, not per-command.

## 2026-07-08 — Handoff briefs must come from a code audit, not from memory of what was "in flight"

The handoff brief written for this Claude Code session was materially
stale on four items (n8n fetch timeout, source-badge/PDF-jump, Contrôle
blocking gate, Postgres index layer) — all four were already implemented.
The brief was generated from the operator's recollection of what was in
flight when the prior session (Codex) hit its context limit, not from a
direct read of the current code/state. That cost real session time
re-verifying and re-discovering work that was already done.

Fix / rule going forward: before writing a handoff brief for the next
session, audit the actual code and running state (grep for the features
in question, query the live DB, check process state) rather than
summarizing from session memory. A session can end with more done than
the operator remembers — trust the repo, not the recap.

## Known gap — orphaned `.tmp-*` directories under `data/`

`createDraftBundle` (`lib/storage.ts`) now writes into `data/{code}.tmp-{uuid}/`
and atomically renames to `data/{code}/` on success, cleaning up the tmp dir
on any failure it catches. But if the Node process is killed (SIGKILL, crash,
power loss) between `fs.mkdir(tmpDir)` and the rename, there's no catch block
to run — the tmp directory is orphaned on disk permanently.

Not urgent: it's dead weight, not corruption (the real fiche directory is
never in a partial state). Fix whenever it starts mattering: a startup sweep
or a small script that deletes `data/*.tmp-*` older than ~1h.

## 2026-07-09 â€” Synchronous webhook coupling was the wrong shape for real CDC runtimes

The original `POST /api/generate` implementation waited for n8n to finish the
entire Marker â†’ anonymisation â†’ Groq pipeline before writing `fiche.xml` and
returning to the browser. That worked on tiny PDFs but broke on real CDCs:
the frontend timed out while n8n kept running, leaving orphaned executions
and occasional late responses trying to write back to a request that was
already gone.

Fix: the interface now uses an asynchronous job pattern. `/api/generate`
writes `cdc.pdf` and `status.json` in `processing`, sends a short acceptance
request to n8n, and returns `202 Accepted` immediately. n8n later POSTs back
to `/api/fiche/[code]/complete` with either `{ xml, markdown, executionId }`
or `{ error, stage, executionId }`, and the fiche page polls
`/api/fiche/[code]/status` while the pipeline runs.

Known follow-up gap: if an n8n execution is canceled manually and never hits
the completion callback, the fiche can stay stuck in `processing`
indefinitely. Manual regenerate is the current escape hatch; no stale-job
reaper exists yet.
