# CLAUDE.md

JARVIS is a persistent memory layer connecting Claude Code to an Obsidian vault at
`C:\Users\<you>\Documents\JARVIS-Vault`. Goal: zero-manual cross-session context, ≤2% token overhead.

## Status

Core memory + `/resume` + `/compress`/`/compress-last` + `/dream` complete (Phase 4, B.5, Session C). Memory-linking pass done: Working-Memory is a cross-tier hub and `/recall` traverses links (`recall-links.js`) — see `.claude/rules/internals.md` → Memory Linking.

**Pending:** `/dream` live test (needs a session restart to register its agent). **Deferred:** role-aware retrieval (see `JARVIS_SETUP.md`).

## Rules

- Ask before coding — 95% confidence threshold
- Discuss architecture before implementing
- Vault token budget: Working-Memory entries ≤60 tokens, vault CLAUDE.md ≤180 tokens total
- Windows 11 / PowerShell environment

## Pointers

- Architecture, MCP tools, skills, vault paths: `.claude/rules/internals.md` (auto-loads on `mcp/**` edits; Read on demand otherwise)
- Project registry: `Projects/registry.md` (via `mcp__jarvis__read_note`)
