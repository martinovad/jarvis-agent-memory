# JARVIS

A persistent memory layer that gives Claude Code zero-manual cross-session context, backed by an Obsidian-compatible markdown vault. A custom Node.js MCP server exposes the vault to Claude; a set of skills (`/resume`, `/compress`, `/recall`, …) read and write it. Local-first, stdio transport, ~≤2% token overhead per session.

> **Environment:** documented Windows-first (PowerShell). macOS/Linux notes are at the end.

---

## Overview

LLM coding agents are stateless: every new session starts from zero. The two usual ways to carry context forward both scale the wrong way:

- **Keep one ever-growing conversation.** The full history is re-sent on every turn, so token usage grows roughly quadratically with turn count and quality drops as the window fills (the "lost-in-the-middle" and long-context-degradation effects). A real 498-turn session measured here was re-sending ~268K tokens *every turn* just to carry history, climbing toward the 1M-token ceiling.
- **Start fresh and re-explain.** Cheaper per turn, but lossy and manual: you re-type context and decide from memory what mattered.

JARVIS removes the tradeoff by keeping knowledge in a vault instead of the context window. Each session starts lean; what you learned persists as plain Markdown and is pulled back on demand.

## What it is

A persistent, token-efficient memory layer for an LLM coding agent (Claude Code), targeting ≤2% token overhead per session:

- **Four-tier memory (CoALA-grounded):** a hot *working-memory* buffer, an *episodic* store of full session logs, a *semantic* store of distilled decisions and architecture notes, and *procedural* skills - all plain Markdown in an Obsidian vault, exposed through a custom MCP server.
- **Deterministic / probabilistic split:** mechanical work (verbatim transcript extraction, file-change tracking, keyword-frequency scoring, link resolution) runs as zero-token Node.js scripts; a thin orchestrator delegates only judgment to cheap Haiku sub-agents in isolated context windows, so cost stays decoupled from session size.
- **Human-memory-like skills:** session compression, a *"dreaming"* consolidation pass that promotes recurring knowledge into permanent memory behind a human approval gate (informed by Generative Agents' reflection and A-MEM's linked-note evolution), and a retrieval layer that traverses a typed knowledge graph of the vault.
- **Measure-before-you-trust:** key automations ship with A/B verification harnesses rather than on faith.

## Token economics

| Dimension | Normal AI (no memory layer) | JARVIS |
|---|---|---|
| Cross-session memory | None: cold start every session | Persistent vault, loaded automatically |
| Standing overhead / session | 0 | ~2K tokens (~0.2% of a 1M window) |
| Restore prior context | Manual re-paste, or carry the whole transcript | `/resume`: ~1-3K tokens, automatic |
| Keep a long history alive | Quadratic re-send, up to the 1M wall | Start fresh; knowledge lives in the vault |
| Save a session for later | Not really possible | `/compress-last`: lightweight Haiku token usage, decoupled from session size |
| Quality at scale | Degrades as history grows | Lean context + front-loaded summaries |

**Measured example.** Saving a 498-turn / 130.5M-cumulative-token work session cost **~83K Haiku tokens** for the part that actually reads and rewrites it, and that figure stays roughly flat no matter how large the saved session is, because the heavy reading happens in isolated Haiku sub-agents rather than the coordinating model's window.

*(Measured 2026-06-10 from the project's own token instrumentation; figures reconcile with its per-session ledger, and the Haiku total is exact as reported by the runtime.)*

**Subscription cost (Claude Pro / Max).** The 5-hour usage window is sized relative to Pro - Max 5x ($100) is roughly 5x Pro, Max 20x ($200) roughly 20x - and Opus draws the allowance down faster than Sonnet or Haiku. Because `/compress-last` runs most of its work on Haiku and serves ~81% of the orchestrator's input from cache, one save is a small fraction of a Max window: negligible in normal daily work, and not meaningfully different between the $100 and $200 tiers. It is more noticeable on the smaller Pro window, but stays a once-per-session operation. *(Plan limits as researched 2026-06-10; Anthropic adjusts these periodically, so treat the relationship, not any exact figure, as the takeaway.)*

## How the pieces fit

JARVIS has three parts that live in three different places. Setup means putting each in place:

| Part | Lives in | Provided by |
|------|----------|-------------|
| MCP server (`mcp/`) — 10 vault tools | this repo | `git clone` |
| Skills (`/resume`, `/compress`, `/dream`, `/recall`, …) + `resume` & `dream` agents | `~/.claude/commands/` and `~/.claude/agents/` | copied from this repo's `skills/` and `agents/` |
| MCP registration | `~/.claude.json` → `mcpServers.jarvis` | added by hand (Step 3) |
| The vault (your notes) | anywhere, e.g. `~/Documents/JARVIS-Vault` | scaffolded fresh (Step 2) |

The server reads its vault location from the `JARVIS_VAULT_PATH` environment variable.

---

## Prerequisites

- **Node.js 18+** (`node --version`)
- **Claude Code** — the CLI, or the Cursor / VS Code extension
- **Git**
- *(Optional)* **Obsidian** — to browse the vault as a graph. JARVIS does not require it; the vault is just markdown files.

---

## 1. Clone and install dependencies

```powershell
git clone https://github.com/martinovad/jarvis-agent-memory.git
cd jarvis-agent-memory\mcp
npm install
```

This installs the MCP SDK and `zod`. The server entry point is `mcp\server.js`.

## 2. Scaffold a fresh vault

Pick a location for your vault and create the base structure. Per-project folders are created automatically the first time you run `/resume` in a project — this only seeds the shared, top-level files.

```powershell
# Choose your vault path
$Vault = "$env:USERPROFILE\Documents\JARVIS-Vault"
$today = (Get-Date -Format "yyyy-MM-dd")

New-Item -ItemType Directory -Force "$Vault\Projects", "$Vault\Knowledge", "$Vault\+Inbox" | Out-Null

@"
---
type: project-registry
last_updated: $today
---

# Project Registry

Maps working directory paths to vault roots. One row per project.

| Project Path | Slug | Vault Root |
|---|---|---|
"@ | Set-Content -Encoding utf8 "$Vault\Projects\registry.md"

@"
---
type: brain
---

# Brain

<!-- Global session index. One row per compressed session across all projects. /compress appends here. -->

| Date | Project | Slug | Keywords |
|------|---------|------|----------|
"@ | Set-Content -Encoding utf8 "$Vault\Brain.md"

@"
---
type: preferences
last_updated: $today
---

# User Preferences

## Working Style
-

## Technical
- OS:
- Shell:

## Communication
-
"@ | Set-Content -Encoding utf8 "$Vault\Knowledge\Preferences.md"

Write-Host "Vault scaffolded at $Vault"
```

## 3. Register the MCP server

Open `~/.claude.json` (`$env:USERPROFILE\.claude.json`) and add a `jarvis` entry under `mcpServers`. Merge this in — don't overwrite the file:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["C:\\path\\to\\jarvis-agent-memory\\mcp\\server.js"],
      "env": {
        "JARVIS_VAULT_PATH": "C:\\Users\\<you>\\Documents\\JARVIS-Vault"
      }
    }
  }
}
```

- Use **double backslashes** in JSON paths on Windows.
- Point `args` at the absolute path to `mcp\server.js` from your clone.
- Set `JARVIS_VAULT_PATH` to the vault from Step 2. If omitted, the server falls back to a hardcoded default that will not exist on your machine — so set it.

*(Alternative, if you have the Claude CLI: `claude mcp add jarvis --env JARVIS_VAULT_PATH=<vault> -- node <path>\mcp\server.js`.)*

## 4. Install the skills and agent

Copy the vendored skill and agent files into your global Claude config:

```powershell
$cc = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Force "$cc\commands", "$cc\agents" | Out-Null
Copy-Item ".\skills\*.md"  "$cc\commands\" -Force
Copy-Item ".\agents\*.md"  "$cc\agents\"   -Force
```

This installs all skills (`/resume`, `/compress`, `/compress-last`, `/preserve`, `/dream`, `/recall`, `/status`, `/test-resume`, `/test-compress`) and the `resume` + `dream` Haiku agents.

## 5. Reload and verify

The MCP server is spawned as a child process when Claude Code starts, so it does **not** hot-reload.

- **Cursor / VS Code:** `Ctrl+Shift+P` → "Developer: Reload Window"
- **CLI:** restart your `claude` session

Then run:

```
/status
```

A healthy result reports the MCP connection up plus Working-Memory and Session-Logs counts. If `/status` reports the MCP as down, re-check the path in `args` and that `npm install` completed.

## 6. Use it

- **First time in any project:** `cd` into the project, run `/resume`. It registers the project in `registry.md`, creates its vault folder (`Projects/{Slug}/` with `CLAUDE.md`, `Working-Memory.md`, `Index.md`, `Decisions/`, `Architecture/`, `Session-Logs/`), and writes `JARVIS_VAULT_ROOT` + `JARVIS_PROJECT_PATH` into that project's `.claude/settings.json`.
- **During a session:** `/recall <topic>` to search the vault, `/preserve <insight>` to pin a permanent note.
- **Before closing (or next session):** `/compress-last` from a fresh session is the recommended low-cost save; `/compress` saves the current session in-place. Either writes the session log, routes decisions/architecture notes, updates Working-Memory, and appends a row to `Brain.md`.
- **Periodically:** `/dream` consolidates recurring knowledge into permanent memory (you approve each promotion); `/recall <topic>` searches and traverses the vault's linked notes.
- **Next session:** the first message silently auto-loads Working-Memory + Preferences; run `/resume` for the full recap.

---

## Skills reference

| Skill | What it does |
|-------|-------------|
| `/resume` | Resolve project from CWD, load Working-Memory + Preferences, surface 3 relevant past sessions. Initializes new projects on first run. |
| `/compress` | Save the current session: model writes the summary, a deterministic script writes the verbatim log. Updates Working-Memory + Brain.md. |
| `/compress-last` | Save the *previous* session from a fresh, cheap context (the recommended low-cost path). |
| `/preserve <insight>` | Append a concise insight to the project's permanent `CLAUDE.md`. |
| `/dream` | Consolidate recurring knowledge into permanent memory: a deterministic anchor (`dream-scan.js`) finds recurring topics, the `dream` Haiku agent proposes promotions / profile updates / stale demotions, you approve each. |
| `/recall <topic>` | Full-text + filename vault search, then 1-hop link traversal (`recall-links.js`) surfacing connected notes grouped by memory role. |
| `/status` | MCP health + Working-Memory / Session-Logs counts + token-cap check. |
| `/test-resume` | A/B harness verifying the `resume` agent against inline execution. |
| `/test-compress` | Verifies the transcript extractor's fidelity, speed, and cost. |

## MCP tools (`mcp__jarvis__*`)

`read_note` · `write_note` · `append_note` · `list_folder` · `search_filename` · `search_content` · `search_frontmatter` · `read_frontmatter` · `list_recent` · `pick_resume_sessions`

---

## Notes & limitations

- **Local-first.** stdio transport, no auth, no TLS — not built for remote/multi-machine access yet. Nothing leaves the machine.
- **Memory is private and separate from this repo.** The code (this repo) and the memory (your vault — session logs, decisions, notes) are deliberately kept apart: the vault lives outside this repo and is meant to stay local. A future VPS deployment is the planned home for an always-on agent, not a public host.
- **The committed `.claude/settings.json`** uses placeholder paths (`<you>`) in its `env` block and permission rules. Replace them with your real paths (`JARVIS_PROJECT_PATH`, and the vault location) before using JARVIS on this clone. It does not affect using JARVIS in *other* projects.
- **macOS / Linux:** replace Windows paths and `\\` separators with POSIX paths (e.g. `/home/<you>/JARVIS-Vault`), use `~/.claude.json` and `~/.claude/` directly, and run the scaffold/copy steps with the shell equivalents (`mkdir -p`, `cp`). The server and skills are OS-agnostic; only the paths differ.
