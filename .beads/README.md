# Beads - AI-Native Issue Tracking

```
╔═════════════════════════════════════════════════════════╗
║  ____        _ _       _                ___             ║
║ / ___| _   _| | | __ _| |__  _   _ ___ / _ \ _ __  ___  ║
║ \___ \| | | | | |/ _` | '_ \| | | / __| | | | '_ \/ __| ║
║  ___) | |_| | | | (_| | |_) | |_| \__ \ |_| | |_) \__ \ ║
║ |____/ \__, |_|_|\__,_|_.__/ \__,_|___/\___/| .__/|___/ ║
║       |___/                                |_|          ║
╚═════════════════════════════════════════════════════════╝
```

## Current Status (2026-02-05)
- Pipeline: watcher + stability gate, canonical copy + meta sidecars, transcript/PPTX/PDF extraction, per-course Unified layout
- Ops controls: “Clean slate” reset (local state, optional Unified wipe) + watcher session reset for re-ingest without restarting the server
- Course detection: infers course from watch-root structure (skips generic buckets like “Powerpoints/Homework”), strips Zoom-style date/time prefixes when present
- AI auth:
  - OpenAI API: OAuth (PKCE) + Keychain + API-key fallback; Settings UI to configure + connect/disconnect
  - Codex: local `codex app-server` provider using ChatGPT/Codex sign-in (no API key); selectable LLM provider in Settings
- Dashboard:
  - Overview shows queue counters + key paths
  - Classes view (sessions timeline, artifacts list, extracted-text preview modal, editor deep-links)
  - Queue view (job stats + filters + auto-refresh)
  - Logs view (level/search filters, pause/resume, clear)
  - Settings (watch roots, ingest toggle, LLM provider + auth)
  - Markdown editor (Edit/Preview/Split + save snapshots + restore + wrapped layout)
- Tasks: JSON-schema task suggestions + per-session approval workflow (Suggest/Approve/Dismiss/Done)
- Summaries:
  - Session summary generation job writes `Unified/<course>/generated/sessions/<date>/session-summary.md`
  - Summary markdown opens GitHub-style: rendered by default, with an in-pane Edit button
- Beads: issues imported from `plan.md` and tracked in `.beads/issues.jsonl`
- Hygiene: Biome checks pass; local `.syllabusops.*` archives ignored
- Next milestone: Security hardening (SyllabusOps-2mx.18) + tests (SyllabusOps-2mx.19 / SyllabusOps-2mx.20)

Welcome to Beads! This repository uses **Beads** for issue tracking - a modern, AI-native tool designed to live directly in your codebase alongside your code.

## What is Beads?

Beads is issue tracking that lives in your repo, making it perfect for AI coding agents and developers who want their issues close to their code. No web UI required - everything works through the CLI and integrates seamlessly with git.

**Learn more:** [github.com/steveyegge/beads](https://github.com/steveyegge/beads)

## Quick Start

### Essential Commands

```bash
# Create new issues
bd create "Add user authentication"

# View all issues
bd list

# View issue details
bd show <issue-id>

# Update issue status
bd update <issue-id> --status in_progress
bd update <issue-id> --status done

# Sync with git remote
bd sync
```

### Working with Issues

Issues in Beads are:
- **Git-native**: Stored in `.beads/issues.jsonl` and synced like code
- **AI-friendly**: CLI-first design works perfectly with AI coding agents
- **Branch-aware**: Issues can follow your branch workflow
- **Always in sync**: Auto-syncs with your commits

## Why Beads?

✨ **AI-Native Design**
- Built specifically for AI-assisted development workflows
- CLI-first interface works seamlessly with AI coding agents
- No context switching to web UIs

🚀 **Developer Focused**
- Issues live in your repo, right next to your code
- Works offline, syncs when you push
- Fast, lightweight, and stays out of your way

🔧 **Git Integration**
- Automatic sync with git commits
- Branch-aware issue tracking
- Intelligent JSONL merge resolution

## Get Started with Beads

Try Beads in your own projects:

```bash
# Install Beads
curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

# Initialize in your repo
bd init

# Create your first issue
bd create "Try out Beads"
```

## Learn More

- **Documentation**: [github.com/steveyegge/beads/docs](https://github.com/steveyegge/beads/tree/main/docs)
- **Quick Start Guide**: Run `bd quickstart`
- **Examples**: [github.com/steveyegge/beads/examples](https://github.com/steveyegge/beads/tree/main/examples)

---

*Beads: Issue tracking that moves at the speed of thought* ⚡
