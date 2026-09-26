# JARVIS

A persistent memory layer that gives Claude Code cross-session context with no manual re-explaining, backed by an Obsidian-compatible Markdown vault. A small Node.js MCP server exposes the vault to Claude; two skills read and write it: `/resume` loads context, `/compress-last` saves a finished session. Local-first, stdio transport, ~2% token overhead per session.

<p align="center">
  <strong>Interested in this project, or hiring? Let's talk.</strong><br>
  <a href="https://www.linkedin.com/in/adrian-martinov-584043237/">
    <img src="https://img.shields.io/badge/Connect_on_LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="Connect on LinkedIn">
  </a>
</p>

> This repository is the minimal public core of a larger private system: enough to set up and run the memory loop, nothing more. **Environment:** documented Windows-first (PowerShell); macOS/Linux notes are at the end.

---

## Overview

LLM coding agents are stateless: every new session starts from zero. The two usual ways to carry context forward both scale the wrong way:

- **Keep one ever-growing conversation.** The full history is re-sent on every turn, so token usage grows roughly quadratically with turn count and quality drops as the window fills. A real 498-turn session measured here was re-sending ~268K tokens *every turn* just to carry history.
- **Start fresh and re-explain.** Cheaper per turn, but lossy and manual: you re-type context and decide from memory what mattered.

JARVIS keeps knowledge in a vault instead of the context window. Each session starts lean; what you learned persists as plain Markdown and is loaded back automatically.

## What it is

- **Tiered memory, all plain Markdown:** a small *working-memory* buffer loaded at every session start, *episodic* session logs, and *semantic* decision and architecture notes, exposed to Claude through an MCP server.
- **Deterministic where possible:** mechanical work (the verbatim session log, which files changed, what the user asked for) is done by zero-token Node.js scripts; cheap Haiku sub-agents do only the judgment, in their own context windows, so saving cost stays flat no matter how long the session was.

## Token economics

| Dimension | No memory layer | JARVIS |
|---|---|---|
| Cross-session memory | None: cold start every session | Persistent vault, loaded automatically |
| Standing overhead / session | 0 | ~2K tokens |
| Restore prior context | Manual re-paste, or carry the whole transcript | `/resume`: a few K tokens, automatic |
| Save a session for later | Not really possible | `/compress-last`: Haiku sub-agents, cost decoupled from session size |

**Measured example.** Saving a 498-turn work session cost **~83K Haiku tokens** for the part that reads and rewrites it, and that figure stays roughly flat however large the session is, because the heavy reading happens in isolated sub-agents rather than the coordinating model's window. *(Measured 2026-06-10 from the project's own token instrumentation.)*

## How the pieces fit

| Part | Lives in | Provided by |
|------|----------|-------------|
| MCP server (`mcp/`) - 10 vault tools | this repo | `git clone` |
| Session-start hook (`mcp/scripts/session-context.js`) | registered in `~/.claude/settings.json` | Step 4 |
| Skills (`/resume`, `/compress-last`) | `~/.claude/commands/` | copied from `skills/` (Step 5) |
| MCP registration | `~/.claude.json` -> `mcpServers.jarvis` | Step 3 |
| The vault (your notes) | anywhere, e.g. `~/Documents/JARVIS-Vault` | scaffolded fresh (Step 2) |

---

## Prerequisites

- **Node.js 22.13+** (`node --version`; the search tool uses the built-in `node:sqlite`)
- **Claude Code** - the CLI, or the Cursor / VS Code extension
- **Git**
- *(Optional)* **Obsidian** - to browse the vault as a graph. The vault is just Markdown files.

## 1. Clone and install dependencies

```powershell
git clone https://github.com/martinovad/jarvis-agent-memory.git
cd jarvis-agent-memory\mcp
npm install
```

## 2. Scaffold a fresh vault

Per-project folders are created automatically the first time you run `/resume` in a project; this only seeds the shared top-level files.

```powershell
$Vault = "$env:USERPROFILE\Documents\JARVIS-Vault"
$today = (Get-Date -Format "yyyy-MM-dd")

New-Item -ItemType Directory -Force "$Vault\Projects", "$Vault\Knowledge" | Out-Null

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

<!-- Global session index. One row per saved session across all projects. /compress-last appends here. -->

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
"@ | Set-Content -Encoding utf8 "$Vault\Knowledge\Preferences.md"

Write-Host "Vault scaffolded at $Vault"
```

## 3. Register the MCP server

Add a `jarvis` entry under `mcpServers` in `~/.claude.json` (`$env:USERPROFILE\.claude.json`). Merge it in - don't overwrite the file:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["C:\\path\\to\\jarvis-agent-memory\\mcp\\server.js"],
      "env": { "JARVIS_VAULT_PATH": "C:\\Users\\<you>\\Documents\\JARVIS-Vault" }
    }
  }
}
```

Use double backslashes in JSON paths on Windows. *(With the Claude CLI: `claude mcp add jarvis --env JARVIS_VAULT_PATH=<vault> -- node <clone>\mcp\server.js`.)*

## 4. Set the paths and the session-start hook

In `~/.claude/settings.json`, merge in two environment variables (the skills read them) and the hook that loads working memory at every session start:

```json
{
  "env": {
    "JARVIS_REPO": "C:\\path\\to\\jarvis-agent-memory",
    "JARVIS_VAULT_PATH": "C:\\Users\\<you>\\Documents\\JARVIS-Vault"
  },
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [{ "type": "command", "command": "node \"C:\\path\\to\\jarvis-agent-memory\\mcp\\scripts\\session-context.js\"" }]
      }
    ]
  }
}
```

## 5. Install the skills

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\commands" | Out-Null
Copy-Item ".\skills\*.md" "$env:USERPROFILE\.claude\commands\" -Force
```

## 6. Reload and use

The MCP server starts with Claude Code and does not hot-reload: reload the window (Cursor / VS Code: `Ctrl+Shift+P` -> "Developer: Reload Window") or restart the `claude` CLI.

- **First time in a project:** `cd` into it and run `/resume`. It registers the project in `registry.md`, creates its vault folder (`Projects/{Slug}/` with `CLAUDE.md`, `Working-Memory.md`, `Index.md`) and writes the project's vault root into its `.claude/settings.json`.
- **Every session start:** the hook loads the project's Working-Memory automatically and tells you when an earlier session is not saved yet.
- **Saving:** start a fresh session and run `/compress-last`. It writes the previous session's log (summary plus verbatim prose), routes decisions and architecture notes, updates Working-Memory and appends a row to `Brain.md`.
- **Full recap:** `/resume`.

---

## Skills

| Skill | What it does |
|-------|-------------|
| `/resume` | Resolve the project from the working directory; show Working-Memory, open items, the last substantial session in full (capped; a thin session is skipped), related older sessions and your preferences. Initializes new projects on first run. |
| `/compress-last` | Save the previous session from a fresh, cheap context: deterministic anchors + a Haiku analyzer write a plan file, a Haiku writer commits it to the vault. |

## MCP tools (`mcp__jarvis__*`)

`read_note` · `write_note` · `append_note` · `list_folder` · `search_filename` · `search_content` · `search_frontmatter` · `read_frontmatter` · `list_recent` · `pick_resume_sessions`

---

## Notes and limitations

- **Local-first.** stdio transport, no auth, no TLS. Nothing leaves the machine.
- **Memory is private and separate from this repo.** The code (this repo) and the memory (your vault) are kept apart on purpose: the vault lives outside the repo and stays local.
- **macOS / Linux:** the server and scripts are OS-agnostic; the skills' shell blocks are PowerShell, so install PowerShell 7 (`pwsh`) or adapt them. Use POSIX paths (e.g. `/home/<you>/JARVIS-Vault`) in the settings above.

---

## Origin and prior art

The idea came to me in late 2025, but the actual coding began in February/March 2026, kickstarted by a Reddit post about using Claude Code for daily note-taking, now that AI agents had finally gotten capable enough to maintain a knowledge base on their own.

I came across Karpathy's "LLM knowledge base" writeup once JARVIS was already taking a similar shape: raw notes compiled into a cross-linked Markdown wiki, queried in compiled form rather than raw. It was a useful point of reference - his verification-first principle ("LLMs automate what you can verify") shaped how JARVIS checks its own work, and studying his approach sharpened the compile-at-write-time design.

---

## License

Source-available under the **PolyForm Noncommercial License 1.0.0**: free to use, study, and modify for **noncommercial** purposes, with **commercial use reserved** to the author. For a commercial license or collaboration, reach out via LinkedIn (top of this README). Full terms in [`LICENSE`](LICENSE).

---

Built by Adrian Martinov, April 2026.

*Not affiliated with Marvel/Disney; JARVIS here is a backronym for Just A Rather Versatile Information System.*
