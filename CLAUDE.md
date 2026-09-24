# CLAUDE.md

JARVIS is a persistent memory layer connecting Claude Code to a Markdown vault (`JARVIS_VAULT_PATH`). Goal: cross-session context with ~2% token overhead.

- `mcp/server.js` - stdio MCP server, 10 vault tools in `mcp/tools/`; `mcp/lib/vault.js` resolves and guards vault paths.
- `mcp/scripts/session-context.js` - SessionStart hook (loads Working-Memory, flags unsaved sessions) and `--pending` CLI; "unsaved" is defined in `mcp/lib/sessions.js`.
- `skills/resume.md` + `mcp/scripts/resume-brief.js` - builds the `/resume` presentation without a model.
- `skills/compress-last.md` + `extract-transcript.js`, `files-touched.js`, `user-asks.js` - deterministic anchors for saving a session.

Vault budget: Working-Memory entries <= 60 tokens, max 3 entries.
