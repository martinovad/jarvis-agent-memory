Consolidate recurring session knowledge into permanent memory. A deterministic anchor (dream-scan.js) finds topics that provably recur across sessions; a Haiku subagent judges which deserve promotion to the vault CLAUDE.md, which Preferences to add, and which stale lines to archive. The parent presents PROPOSALS — nothing is written without your approval.

**Run every shell block below with the PowerShell tool directly — NOT the Bash tool** (backticks and Windows paths get mangled through Bash).

**Step 0 — Resolve project** (parent)
PowerShell tool: `(Get-Location).Path` (normalize backslashes). Call mcp__jarvis__read_note("Projects/registry.md"). Match row → Slug, Vault Root. If not found: stop, tell the user to run /resume first. Today's date is in the current-date context block (YYYY-MM-DD).

**Step 1 — Run the deterministic anchor** (parent, PowerShell tool):
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\dream-scan.js" "{Slug}" "{Vault Root}" --today {today}
```
Capture the output as ANCHOR. If it prints "No promotion candidates …": tell the user "Nothing to consolidate — no topics have crossed the promotion threshold." and STOP (do not spawn the subagent — save the cost).

**Step 2 — Spawn the dream judge** (parent). Agent tool: `subagent_type: dream` (model is fixed to haiku in the agent file). Prompt (exactly these fields, one per line, with the anchor pasted verbatim):
```
Slug: {Slug}
Vault Root: {Vault Root}
Today: {today}
Anchor:
{ANCHOR}
```
The subagent reads CLAUDE.md + Working-Memory + Preferences in its own context, judges worthiness against the anchor, and returns a structured proposal ending in a `Status:` line.

**Step 3 — Branch on status + present** (parent). Read the last line:
- `Status: DONE` — strip the status line; show the rest as "**Dream proposal ({Slug})**". If every section is `_None._`, tell the user "Nothing crossed the worthiness bar this pass." and STOP.
- `Status: BLOCKED` / `Status: NEEDS_CONTEXT` — display the subagent's response and stop (do not retry without fixing the brief).

Then ask the user which proposals to apply: "Approve all / pick by number / none?". **Wait for the user.** Nothing below runs until they choose.

**Step 4 — Apply approved items only** (parent). For each approved item:
- **Promotion** → mcp__jarvis__append_note "{Vault Root}/CLAUDE.md" with the ≤20-token line. Before appending, re-check the 200-token cap: if the approved promotions would exceed it, the paired eviction (below) MUST be applied first.
- **Preference** → mcp__jarvis__append_note "Knowledge/Preferences.md" with the profile line (place under the right `## ` subheading if one fits; otherwise append).
- **Stale / demote + eviction** → move the line, never delete it outright:
  1. mcp__jarvis__append_note "{Vault Root}/CLAUDE-archive.md" with `| {today} | <verbatim line> | <reason> |` (create the file with a header first if `mcp__jarvis__read_note` 404s — see the archive format in the skill notes).
  2. Remove that line from its source file: read it, write it back without the line (mcp__jarvis__write_note).

**Step 5 — Record + report** (parent).
PowerShell tool (so the /compress-last gate stops re-offering what you just reviewed):
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\dream-scan.js" "{Slug}" "{Vault Root}" --mark-seen --today {today}
```
Then display the list of vault files changed (one per line) and, for each, what was promoted / added / archived. If the user approved nothing, say so and note the candidates were marked seen (re-run /dream anytime to revisit). No other commentary.

---

**Archive file format** — `{Vault Root}/CLAUDE-archive.md`, created on first demotion:
```
---
type: claude-archive
project: {Slug}
---
# CLAUDE.md Archive — {Slug}
Lines demoted from permanent memory by /dream. Git-tracked; recoverable; searched by /recall.

| Demoted | Line | Reason |
|---------|------|--------|
```
