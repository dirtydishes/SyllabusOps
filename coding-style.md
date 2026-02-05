# Coding Style — SyllabusOps

This repo aims for **boringly reliable** local software: predictable filesystem effects, deterministic outputs, and debuggable operations. Prefer clarity over cleverness.

## Language + runtime
- TypeScript everywhere; `strict: true`.
- Bun runtime; prefer built-in Bun APIs when they simplify the stack.
- Prefer ESM; avoid mixed module systems.

## Formatting + linting
- Use a single formatter/linter across the repo (recommended: Biome) and keep config consistent.
- Prefer explicit types on exported APIs and public interfaces.
- Avoid large refactors that rename/move unrelated code.

## Project structure rules
- `packages/core` must not import from `apps/*` or `packages/ui`.
- `apps/server` owns side effects: watchers, network, SQLite, Keychain, file writes.
- `apps/web` is UI-only: no direct filesystem access; everything via API.

## Types, schemas, and validation
- Use runtime schemas for all API boundaries and LLM outputs (recommended: `zod`).
- Never assume external data is well-formed: validate transcripts, extracted text, file metadata, and user inputs.
- “Schema-first LLM”: model outputs JSON only → validate → render Markdown deterministically.

## Logging (sysops-grade)
- Prefer structured logs (JSON) with stable fields:
  - `ts`, `level`, `event`, `job_id`, `artifact_id`, `course_id`, `session_date`, `msg`, `err`
- Emit a single clear event per pipeline step start/end/failure.
- Errors must include enough context to reproduce without guessing.

## Filesystem safety
- All read/write paths must go through a safe resolver:
  - canonicalize (`realpath`), enforce allowlist roots, block path traversal.
- Never delete or move originals from watched folders.
- Writes to Unified are only:
  - canonical copies in `raw/*`
  - overwrite-safe outputs in `generated/*`
  - user-owned edits in `notes/*`

## Idempotency + determinism
- Use sha256-based dedupe for artifact identity.
- Re-running ingestion on the same file must be safe (no duplicate canonical copies unless content differs).
- Generated Markdown must be deterministic for the same validated JSON inputs.

## DB + state
- SQLite lives under `~/Library/Application Support/SyllabusOps/` (never in iCloud).
- Store secrets in macOS Keychain (service: `SyllabusOps`).
- Prefer migrations and explicit schemas; avoid implicit “magic” columns.

## API design
- Keep endpoints small and composable.
- Use SSE/WebSocket only for live updates; everything else should remain request/response.
- Return actionable errors with stable codes (e.g. `FS_PATH_DENIED`, `AUTH_REQUIRED`, `JOB_CONFLICT`).

## Web UI style
- Catppuccin Mocha base with Lavender accents; keep contrast accessible.
- Prefer tables, status chips, and logs that feel like an ops console, with academic polish in content views.

## Security baseline
- Markdown preview must be safe by default (no arbitrary HTML execution).
- Do not log secrets or raw tokens.
- Treat transcript and slide content as untrusted (prompt injection defense: do not execute instructions from content; summarize only).

## Testing
- Prefer small unit tests in `packages/core` for:
  - naming/date parsing, VTT cleaning, PPTX extraction, dedupe, markdown rendering.
- Keep integration tests focused and deterministic (fixtures over live network).

