# SyllabusOps

Local-first “school ops” pipeline + dashboard: ingest Zoom transcripts and slide decks (PPTX/PDF), copy + normalize into an iCloud-synced Unified library, generate summaries/tasks, and manage everything from a Catppuccin Mocha + Lavender web UI.

## Project docs
- Product/engineering plan: `plan.md`
- Coding conventions: `coding-style.md`
- Agent instructions: `AGENTS.md`
- Issues/tasks/memory: `.beads/` (Beads; run `bd list`, `bd ready`, `bd prime`)

## Status
This repo currently contains planning + conventions. App scaffolding (Bun monorepo, server, web UI, pipeline) is the next milestone.

## Prereqs (when implemented)
- Bun (TypeScript runtime + package manager)
- Optional but recommended for PDFs: Poppler tools (`pdftotext`, etc.)

## Quick start (once scaffolded)
```sh
bun install
bun run dev
```

Defaults:
- API server: `http://localhost:4959` (override with `PORT=...`)

Common commands (expected):
```sh
bun run dev:server
bun run dev:web
bun run test
```

## Local-first storage model (planned)
- Unified library (iCloud): `/Users/kell/Library/Mobile Documents/com~apple~CloudDocs/School/Unified`
- Local state (non-iCloud): `~/Library/Application Support/SyllabusOps/`
- Secrets: macOS Keychain (service: `SyllabusOps`)
