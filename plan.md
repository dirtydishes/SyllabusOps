# SyllabusOps — School Ops Pipeline + Dashboard

## 1) Goal
A local-first system that:
- Watches school artifacts in:
  - `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School`
  - `~/Documents/Zoom`
- Ingests transcripts + slides (PPTX/PDF), **copies** them into an iCloud-synced Unified library, **renames canonically**, extracts text, generates summaries + tasks, and provides a TypeScript web dashboard (Bun) to manage everything.
- “Sysops + academia” UI: Catppuccin Mocha + Lavender, logs, job queue, per-class views, calendar, tasks, editor mode.

## 2) Key decisions (locked)
- Runtime: Local Mac, dashboard on `localhost`
- Unified library path: `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified`
- Originals: **copy** into Unified; keep originals untouched
- Date format: `YYYY-MM-DD`
- Class assignment: rules + manual override in UI
- Slides: `.pptx` and PDF slide exports
- Textbooks: Phase 2 (not MVP)
- AI auth: OpenAI **OAuth for model calls**, with **API-key fallback**
- Editing: generated summaries are overwrite-safe; user edits go to `notes/*` via built-in editor

## 3) Non-goals (MVP)
- Remote hosting, multi-user auth, or cloud DB
- Full Google/Apple calendar sync (Phase 2+)
- EPUB ingestion (Phase 2+)
- Full diff-history UI (MVP uses simple snapshots)

## 4) Monorepo structure (Bun + TypeScript)
- `apps/server/` — Bun API, pipeline engine, watchers, job runner, logging
- `apps/web/` — React dashboard (TypeScript)
- `packages/core/` — shared domain types, ingestion/extraction, LLM client, markdown renderers
- `packages/ui/` — theme + reusable UI components (tables, cards, log viewer)
- `docs/` — operational docs / troubleshooting

## 5) On-disk Unified library spec (source-of-truth you can browse)
Root: `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified`

Per course:
- `Unified/<courseSlug>/`
  - `raw/<YYYY>/<YYYY-MM-DD>/` (canonical copied originals)
  - `generated/` (safe to overwrite)
    - `sessions/<YYYY-MM-DD>/session-summary.md`
    - `artifacts/<artifactId>/summary.md`
  - `notes/` (never overwritten)
    - `sessions/<YYYY-MM-DD>/notes.md`
    - `sections/<sectionId>/notes.md` (Phase 2)

Canonical filenames in `raw/...`:
- Transcript: `"<CourseShort> <YYYY-MM-DD> Transcript.<ext>"`
- Slides: `"<CourseShort> <YYYY-MM-DD> Slides.<ext>"`
- If duplicates: append ` (2)`, ` (3)`.

Every canonical copy gets a sidecar:
- `<canonicalName>.meta.json` containing:
  - source path, import timestamp, sha256, detected type/class/date, extractor used, pipeline version

## 6) Local operational state (NOT in iCloud)
To avoid SQLite+iCloud conflicts, store state locally:
- `~/Library/Application Support/SyllabusOps/`
  - `syllabusops.sqlite`
  - `logs/` (JSONL)
  - `cache/` (extracted text, conversions, LLM caches where safe)

Secrets:
- macOS Keychain (service: `SyllabusOps`)
  - OpenAI OAuth refresh token and/or API key

## 7) Pipeline engine (robust, resumable)

### 7.1 Job model
All work is jobs with:
- `queued | running | succeeded | failed | blocked`
- retries + exponential backoff
- linkage: `artifact_id`, `course_id`, `session_date`

### 7.2 Ingestion flow
1. Discover new/changed files via watcher + periodic scan
2. Stability gate: only process when file size stable for N seconds
3. Classify artifact type (transcript vs slides) + parse date hints
4. Assign course/session via rules:
   - folder name / Zoom meeting topic / regex mappings
   - UI manual override persists and feeds rule suggestions
5. Copy into Unified `raw/...` with canonical name + meta.json
6. Extract text
7. Summarize artifact (LLM → JSON → Markdown template)
8. Generate session summary from transcript+slides summaries
9. Extract suggested tasks (LLM → structured JSON) requiring UI approval

## 8) Text extraction

Transcripts:
- `.vtt`: strip timestamps, preserve speaker labels if present
- `.txt/.md`: normalize whitespace

PPTX:
- Extract text from slide XML (`ppt/slides/*.xml`)
- Extract speaker notes (`ppt/notesSlides/*.xml`)
- Keep slide numbers + notes association

Slide PDFs:
- Primary: Poppler `pdftotext` if installed
- Fallback: `pdfjs-dist` text extraction
- Record extractor choice in meta

## 9) LLM outputs (schema-first)
LLM returns JSON only; server renders Markdown deterministically.

Artifact summary schema (example fields):
- `title`, `type`, `date`, `topics[]`, `key_points[]`, `definitions[]`, `quotes[]`
- for slides: `slides[]` with slide_no + bullets + notes highlights

Session summary schema:
- overview, concepts, “review next”, tasks, references

Tasks schema:
- title, description, due (optional), confidence, sources (artifact/session pointers)

## 10) Server API (local control plane)
Recommended: Bun + Elysia.

Key endpoints:
- `GET /api/status` (watcher + queue + last error)
- Courses: `GET/POST /api/courses`
- Sessions: `GET /api/sessions?courseId=...`
- Artifacts: `GET /api/artifacts?courseId=...`
- Jobs: `POST /api/reprocess` (artifact/session), `GET /api/jobs`
- Logs: `GET /api/logs` (filter + tail)
- Settings: `GET/POST /api/settings` (watch roots, unified path, rules)
- Calendar: `GET/POST /api/calendar`
- Tasks: `GET/POST /api/tasks` (approve/complete)

Live updates:
- SSE or WebSocket for job progress + log tail.

## 11) Web UI (dashboard)
Theme:
- Catppuccin Mocha base, Lavender accent
- sysops components: status chips, queue tables, throughput charts, log viewer
- academia components: course cards, session timeline, study-guide layouts

Routes:
- Overview (health, queue depth, failures, throughput, recent imports)
- Classes (course list + health)
- Class detail (sessions timeline, artifacts, summaries + notes, tasks)
- Ingestion (watch roots, exclusions, manual scan, rule tester)
- Logs (filters + live tail)
- Calendar (managed schedule + Zoom links, optional .ics import)
- Tasks (suggested → approved workflow)
- Settings (OpenAI auth, concurrency, retention)

## 12) Built-in editor mode (Markdown + preview)
Goal: edit notes and text files from within the dashboard.

Capabilities:
- File browser scoped to Unified paths
- Markdown editor with:
  - `Edit / Preview / Split`
  - GFM preview, safe rendering (no raw HTML)
- “Create notes from generated” action:
  - copies generated markdown into `notes/.../notes.md` with a provenance header
- Conflict detection:
  - write uses `expectedHash` to prevent clobber
- Simple versioning:
  - snapshot on each save into `~/Library/Application Support/SyllabusOps/revisions/...`

Server FS endpoints (scoped allowlist):
- `GET /api/fs/list?path=...`
- `GET /api/fs/read?path=...`
- `PUT /api/fs/write?path=...` with `{ content, expectedHash }`
- `GET /api/fs/revisions?path=...`
- `POST /api/fs/restore`

## 13) OpenAI OAuth for model calls (plus API key fallback)

Supported auth modes:
- `openai_oauth` (preferred): Authorization Code + PKCE, refresh tokens stored in Keychain
- `openai_api_key` fallback: API key stored in Keychain

Endpoints:
- `GET /api/auth/openai/start` → returns `auth_url` (state + PKCE)
- `GET /api/auth/openai/callback` → exchanges code → stores refresh token
- `POST /api/auth/openai/disconnect`

Operational behavior:
- auto-refresh tokens before expiry
- if refresh fails, UI shows degraded state and offers reconnect or API key mode

Implementation gating:
- first confirm OAuth endpoints/scopes support the required model APIs; if not, keep API-key as model-auth and optionally still use OAuth for UI login.

## 14) Calendar (MVP)
- Per-course recurring schedule (day/time/timezone)
- Zoom join URL + meeting ID/passcode fields
- Optional `.ics` import to create/update events
- Future: sync to Google/Apple (Phase 2+)

## 15) Phase 2: textbooks + unified section docs
- Define course “Sections” (manual or date ranges)
- Generate `generated/sections/<sectionId>/unified-study-doc.md` from:
  - session summaries + artifacts + textbook chapter summaries
- Textbook ingestion:
  - PDFs first (`pdftotext`, optional `pdfplumber/pypdf` helpers)
  - chunk + index for retrieval-augmented synthesis

## 16) Acceptance criteria (MVP)
- Dropping a new Zoom transcript triggers copy → canonical name → summary within 1–2 minutes.
- Dropping PPTX or slide PDF triggers extraction → summary and linkage to correct session.
- Regeneration overwrites only `generated/*`, never `notes/*`.
- Editor creates/edits notes with preview; saves create snapshots; conflicts are detected.
- OAuth connect enables model calls without API key; fallback key mode works.

