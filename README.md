# SyllabusOps

SyllabusOps is a **local-first school dashboard** that automatically:
- Finds your class artifacts (Zoom transcripts, PPTX/PDF slides)
- **Copies + canonically renames** them into a clean “Unified library”
- Extracts text, suggests study tasks, and gives you a **sysops-style control panel** for your semester

It’s designed to feel like “**DevOps for your classes**”: queues, logs, jobs, health checks — but with an academic touch and a built‑in Markdown editor.

Theme: **Catppuccin Mocha + Lavender**.

## Why you’d want this (student view)
- **One place for everything**: transcripts + slides + notes + tasks, organized by course and session date.
- **Less chaos**: you don’t need to remember where Zoom put the transcript or which deck was “final-final-2”.
- **Actionable**: the app suggests what to do next (“read chapter 3”, “review X”, “finish problem set”) based on what happened in class.
- **Safe**: it never deletes your originals; it works by copying into the Unified library.

## AI: plug-in and go
SyllabusOps supports two ways to power AI features:

1) **Codex (recommended for most students)** — uses your existing **ChatGPT/Codex sign‑in** via local `codex app-server` (no API key to paste).
   - If you already pay for ChatGPT, this is often the easiest “plug it into my account and go” option.
2) **OpenAI API** — supports the OpenAI API for model calls (OAuth or Keychain‑stored API key fallback).

## What it can do today (MVP)
**Pipeline**
- Watch folders for new artifacts (`.txt/.vtt/.md/.pptx/.pdf`)
- Stability gate (waits for files to finish writing)
- Canonical copy into Unified + `.meta.json` sidecar
- Text extraction:
  - Transcript cleanup (`.vtt`, `.txt`, `.md`)
  - PPTX slide + notes extraction
  - PDF `pdftotext` when available, fallback to `pdfjs`

**Dashboard**
- **Overview** (service health + queue counters)
- **Classes** (sessions timeline, artifacts list, extracted-text preview, deep-links into editor)
- **Queue** (job stats, filters, auto-refresh)
- **Logs** (live tail + pause + filters)
- **Editor** (Markdown Edit/Preview/Split + snapshots + restore)
- **Settings** (paths, ingestion toggle, LLM provider + models + reasoning effort)

**Tasks (AI-assisted)**
- Suggest tasks per session (schema-first JSON → stored tasks)
- Approve / Dismiss / Done workflow in the UI

## Quick start
From the repo root:
```sh
bun install
bun run dev
```

Open the dashboard:
- Web UI: `http://localhost:5173`
- API: `http://localhost:4959/api/status`

If you visit the API root (`http://localhost:4959/`) you may see `NOT_FOUND` — that’s normal; the UI lives on the Vite port.

## First-time setup (non-coder friendly)
1) Open **Settings**
2) Set **Unified directory** (where SyllabusOps stores its organized library):
   - Recommended (default): `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified`
   - If you want a clean reset without touching anything existing: create and use `Unified_Clean` (or any folder name that includes “Unified”) instead.
3) Set **Watch Roots** (one per line)
   - Tip: you *can* watch a messy top-level “School/” folder; SyllabusOps will try to infer course names from the watch-root structure.
   - For the cleanest results, watch your *course folders* (or a folder that contains course folders).
4) Choose an **LLM Provider**
   - **Codex (default)**: click “Connect Codex” (uses your ChatGPT/Codex sign-in)
   - **OpenAI API**: paste an API key (stored in macOS Keychain)
5) Toggle **Enable ingest**
6) Go to **Queue** and watch jobs appear as files are discovered

## How to use it day-to-day
- Drop transcripts/slides into your watched folders.
- SyllabusOps copies them into the Unified library with canonical names.
- Go to **Classes → pick a session**:
  - Preview extracted text
  - Click **Suggest Tasks**
  - Approve/Dismiss tasks
  - Write your own notes in the Editor (snapshots on every save)

## “Is it working?” checklist (good first tests)
1) **Settings → Unified Library**: points at a folder ending in `Unified` (or containing “Unified”).
2) **Settings → Watch Roots**: at least one folder with transcripts/slides under it.
3) **Settings → Codex**: “Available: Yes”, then click **Connect Codex** until it shows “Connected”.
4) **Settings → Ingestion**: toggle **Enable ingest**.
5) **Queue**: you should see `ingest_file` then `extract_transcript` / `extract_pptx` / `extract_pdf`.
6) **Classes**: pick a course → pick a session → open an artifact → preview extracted text.
7) **Suggest Tasks**: click it and confirm tasks appear under that session.

## Clean slate (fix messy folders fast)
If your watch roots were messy and SyllabusOps created junk course names, use:
**Settings → Danger Zone → Clean slate**.
- “Local state only” clears the pipeline database + caches/logs and disables ingestion.
- “Local state + Unified library” also wipes the Unified library contents (it refuses to wipe folders that don’t include “Unified”).

## Storage model (important)
SyllabusOps splits storage into:

**Unified library (browseable, iCloud-friendly)**
- Default: `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified`
- Structure (per course):
  - `raw/<YYYY>/<YYYY-MM-DD>/` — canonical copied originals + `.meta.json`
  - `generated/` — safe-to-overwrite outputs (summaries later)
  - `notes/` — your edits (never overwritten)

**Local state (NOT in iCloud)**
- Default in this repo: `.syllabusops/` (SQLite, cache, logs)
- You can move it via `SYLLABUSOPS_STATE_DIR`.

**Secrets**
- macOS Keychain service: `SyllabusOps` (API keys / tokens)

## Known gotchas
- If your watch root contains the Unified folder, SyllabusOps now ignores the Unified output directory to avoid recursive ingestion — but it’s still best to watch only your “source” folders.
- If you paste macOS paths from a shell (e.g. `Mobile\ Documents`), SyllabusOps will normalize `\ ` to spaces when saving settings.
- Ingestion is **disabled by default**. `watch.scan` logs can still appear even when ingest is off; enabling ingest is what causes jobs to enqueue/copy/extract.

## Repo layout (for the curious)
- `apps/server/` — Bun + Elysia API, pipeline engine, watcher, job queue/runner
- `apps/web/` — React dashboard (TypeScript)
- `packages/core/` — extraction + schemas + renderers
- `.beads/` — Beads issues/task tracking (`bd list`, `bd ready`, `bd show …`)

## Dev commands
```sh
bun run dev        # server + web
bun run dev:server # API only (default :4959)
bun run dev:web    # UI only (default :5173)
```

## Docs
- Product/engineering plan: `plan.md`
- Coding conventions: `coding-style.md`
- Agent instructions: `AGENTS.md`
- Issues/tasks/memory: `.beads/` (Beads)
