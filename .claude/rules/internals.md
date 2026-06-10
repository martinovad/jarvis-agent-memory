---
description: JARVIS architecture, MCP tools, skills, project resolution, vault paths. Auto-loaded when editing the MCP server.
paths: [mcp/**]
---

# JARVIS Internals

## Architecture
Three-tier vault memory:
- **CLAUDE.md** (vault) — permanent project facts, hard cap 180 tokens
- **Working-Memory.md** — rotating last-3-session summaries (~180 tokens)
- **Session-Logs/** — structured session snapshots; /resume loads summary only (stops at `## Raw Session Log` separator)

Custom Node.js MCP server (`mcp/server.js`, ESM) exposes 10 tools via stdio transport.
Registered in `~/.claude.json` under `mcpServers.jarvis`.

## Memory Linking (CoALA roles)
Notes carry typed `[[wikilinks]]` so retrieval can *traverse*, not just match. The folder encodes the memory role: `Session-Logs/` = episodic, `Architecture/` + `Decisions/` + `CLAUDE.md` = semantic, `Working-Memory.md` = working. Links are **folder-qualified** where basenames collide (a log and a decision can share a name). Each Working-Memory entry carries a `↳` line linking its session (episodic) + decisions/architecture (semantic), making WM a cross-tier hub; `/compress` + `/compress-last` emit this automatically. `/recall` traverses these edges via `mcp/scripts/recall-links.js`. **Rule:** every edge is a real relationship — never add links for visual graph density (spurious edges degrade retrieval).

## Orchestrator Pattern
Skills with significant compute (read-heavy, format-heavy) delegate to a Haiku subagent at `~/.claude/agents/<skill>.md`. Parent passes a tiny structured brief; subagent reads in its own context; parent displays the result. Verify A/B before merging. See `System/JARVIS/Architecture/orchestrator-pattern.md`.

## MCP Tools (`mcp__jarvis__*`)
`read_note` · `write_note` · `append_note` · `list_folder` · `search_filename`
`search_content` · `search_frontmatter` · `read_frontmatter` · `list_recent` · `pick_resume_sessions`

## Project Resolution
Skills resolve the active project by reading `Projects/registry.md` and matching the current working directory. JARVIS maps to `System/JARVIS/`. New projects are initialized at `Projects/{Slug}/` on first `/resume` run — `/resume` also auto-writes `JARVIS_VAULT_ROOT` and `JARVIS_PROJECT_PATH` into the project's `.claude/settings.json`. `/compress` refuses to run on unregistered projects.

## Key Vault Paths
| Path | Purpose |
|------|---------|
| `Projects/registry.md` | Path → slug → vault root mapping |
| `{Vault Root}/CLAUDE.md` | Permanent project memory |
| `{Vault Root}/Working-Memory.md` | Last 3 sessions buffer |
| `{Vault Root}/Decisions/` | Key decisions (routed by /compress) |
| `{Vault Root}/Architecture/` | System design notes (routed by /compress) |
| `{Vault Root}/Session-Logs/` | Session snapshots |
| `{Vault Root}/Index.md` | Per-project hub for graph view |
| `Brain.md` | Global session index — schema: Date \| Project \| Slug \| Keywords |
| `Knowledge/Preferences.md` | Cross-project user prefs |
| `+Inbox/` | Quick capture, unprocessed |

## Skills (`~/.claude/commands/`)
- `/resume` — resolve project (parent), delegate to the `resume` Haiku agent which loads Working-Memory + Preferences, calls `pick_resume_sessions` for deterministic scoring, and surfaces 3 relevant sessions
- `/compress` — same-session save: model writes structured sections, the deterministic extractor (`mcp/scripts/extract-transcript.js`) writes the verbatim Raw Session Log; routes Decisions/Architecture/WM/Brain. Pricey at end of a long session (steps × full context)
- `/compress-last` — thin-parent save of the PREVIOUS session from a fresh context (cheap); finds the prior uncompressed transcript via mtime + `.compressed-transcripts` tracker, extracts + summarizes it
- `/preserve <insight>` — append key insight to `{Vault Root}/CLAUDE.md`
- `/dream` — memory consolidation: `mcp/scripts/dream-scan.js` finds recurring topics (frequency×recency, not already in CLAUDE.md); the `dream` Haiku agent judges promotion-worthiness; parent presents proposals for approval (promote→CLAUDE.md, profile→Preferences, stale→`CLAUDE-archive.md`). `/compress-last` appends a gated offer when topics cross threshold. See `Architecture/dream-consolidation.md`
- `/recall <topic>` — full-text vault search (top 5), then 1-hop link traversal (`mcp/scripts/recall-links.js`) surfacing each hit's neighbors (outbound + backlinks) grouped by memory role
- `/status` — resolve project, MCP health + Working-Memory count + Session-Logs count + token cap check
- `/test-resume` — A/B harness verifying the `resume` agent's picks + rendering against inline execution
- `/test-compress` — verifies the transcript extractor's fidelity + speed + cost (optional A/B vs LLM)

## Auto-Resume
On the first user message of every session, before responding:
1. Load `{Vault Root}/Working-Memory.md` and `Knowledge/Preferences.md` silently — use as context, do not present unless the user explicitly runs /resume.
2. Check for an uncompressed prior session: list `~/.claude/projects/<encoded-cwd>/*.jsonl` (encoded = CWD with `[:\/ ]`→`-`), drop the most-recent (current session), any basename in `{Vault Root}/.compressed-transcripts`, and any meta-run (a session whose first user message is a `/compress`(-last) invocation — it has no original work to save). If any remain, append ONE plain line to your first reply: "Note: an uncompressed session from {date} is pending — run `/compress-last` to save it cheaply." Do not auto-run it.

Do this once per session only.
