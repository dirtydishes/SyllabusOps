# Agent Instructions — SyllabusOps

## Mission
Build a local-first “school operations” pipeline + dashboard that ingests class artifacts (Zoom transcripts, PPTX/PDF slides), organizes them into an iCloud-synced Unified library, and provides a Bun/TypeScript web UI with observability and editing tools.

## Issue Tracking

This project uses **bd (beads)** for issue tracking.
Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

Quick reference:
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

## Non-negotiables
- NEVER move or delete originals in watched folders; ingest by copying into Unified.
- NEVER store SQLite or secrets inside iCloud paths.
- Generated outputs must be overwrite-safe: write only under `generated/*`; user edits belong in `notes/*`.
- Treat paths as macOS-specific defaults; keep them configurable.

## Defaults (paths)
- Watched roots:
  - `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School`
  - `~/Documents/Zoom`
- Unified library root:
  - `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified`
- Local state:
  - `~/Library/Application Support/SyllabusOps/`
- Secrets:
  - macOS Keychain service name: `SyllabusOps`

## Tech stack
- Runtime: Bun
- Language: TypeScript (strict)
- Server: Elysia (preferred)
- Web: React + TypeScript (Catppuccin Mocha + Lavender theme)
- Logging: structured JSONL + UI log tail (SSE/WS)

## Repo layout (intended)
- `apps/server/` Bun API + pipeline + watchers
- `apps/web/` dashboard
- `packages/core/` domain logic (ingest/extract/llm/render)
- `packages/ui/` design system + theme

## Engineering principles
- Schema-first, deterministic outputs: LLM → JSON → Markdown templates.
- Idempotent pipeline: sha256-based dedupe + meta sidecars; resumable job queue.
- Filesystem safety: path allowlists + traversal protection; never write outside configured roots.
- UI safety: Markdown preview must not execute arbitrary HTML.
- Local-first reliability: clear logs, retry/backoff, and explicit “blocked” states.

## AI auth
- Support OpenAI OAuth (PKCE) for model calls with refresh tokens in Keychain.
- Provide API-key fallback in Keychain.
- If OAuth-for-model calls is not supported as expected, do not fake it—fall back cleanly.

## PDFs / slides guidance
- PPTX: extract from XML + notesSlides.
- PDF slides/textbooks: prefer Poppler tools when available; keep fallback extractors.
- When tasks involve PDF rendering or layout validation, use the `pdf` skill workflow.

## UI expectations
- “Sysops control panel” feel: queue, throughput, failures, logs, per-class breakdown.
- Built-in Markdown editor with preview, conflict detection, and save snapshots.

## Testing
- Add focused unit tests for naming, date parsing, VTT cleaning, PPTX extraction, dedupe, markdown rendering.
- Add integration tests for ingestion → summary generation → UI listing where feasible.


## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
Use 'bd' for task tracking
