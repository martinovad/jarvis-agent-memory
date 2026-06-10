Run a JARVIS system health check. Execute all steps, then present the results.

0. Run PowerShell: `(Get-Location).Path` — normalize backslashes to forward slashes. Call mcp__jarvis__read_note("Projects/registry.md"). Find matching row → extract Slug and Vault Root. If not found: use Vault Root = "System/JARVIS", Slug = "Jarvis", and note "(registry miss)" in output.

1. Call mcp__jarvis__list_folder("") — confirms MCP is alive, shows vault root.
2. Call mcp__jarvis__read_note("{Vault Root}/Working-Memory.md") — count session blocks (<!-- Session N --> markers). Report 0/3 if file missing.
3. Call mcp__jarvis__list_folder("{Vault Root}/Session-Logs") — count .md snapshot files (exclude .keep).
4. Call mcp__jarvis__read_note("{Vault Root}/CLAUDE.md") — estimate token count (word count ÷ 0.75). Flag ⚠ if over 160 tokens.
5. Call mcp__jarvis__read_frontmatter("Knowledge/Preferences.md") — confirm readable.
6. Call mcp__jarvis__read_note("Brain.md") — count rows where Project = {Slug}.

Present as:
JARVIS Status — {today's date}
─────────────────────────────
Project:         {Slug} ({Vault Root})
MCP:             ✓ connected
Working-Memory:  N/3 sessions
Session-Logs/:   N snapshots
Vault CLAUDE.md: ~N/200 tokens
Preferences.md:  ✓ readable
Brain.md:        N rows ({Slug})

Replace ✓ with ✗ and add a brief error note for any failed step. No other commentary.
