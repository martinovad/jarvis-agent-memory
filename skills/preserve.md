Append a key insight to the permanent project memory.

Insight to preserve: $ARGUMENTS

Steps:
0. Run PowerShell: `(Get-Location).Path` — normalize backslashes to forward slashes. Call mcp__jarvis__read_note("Projects/registry.md"). Find matching row → extract Vault Root. If not found, use "Projects/{folder name}".
1. Read {Vault Root}/CLAUDE.md from the vault using mcp__jarvis__read_note.
2. Estimate its token count (word count ÷ 0.75). Hard cap is 200 tokens.
3. If adding one line would exceed 200 tokens, say so and stop — do not write.
4. Otherwise, append the insight as a single concise line (≤20 tokens) using mcp__jarvis__append_note.

Confirm with the file path and estimated new token count. No other commentary.
