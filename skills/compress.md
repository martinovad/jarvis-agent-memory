Compress the current session into the vault using a 1-2 exchange flow. Run at end of session before switching context.

**Step 0 — Resolve project**
Run PowerShell: `(Get-Location).Path` — normalize backslashes to forward slashes. Call mcp__jarvis__read_note("Projects/registry.md"). Find matching row → extract Slug and Vault Root. If not found: stop and tell the user "This project isn't registered yet. Run /resume first to register it, then re-run /compress." Do not auto-derive a slug or write anything.

**Step 0.5 — Locate the session transcript**
Run PowerShell:
```powershell
$enc = (Get-Location).Path -replace '[:\\/ ]','-'
(Get-ChildItem "$env:USERPROFILE\.claude\projects\$enc\*.jsonl" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
```
Capture the printed path as TRANSCRIPT — the current session's JSONL (the most recently written). If nothing is found, note it and skip the verbatim Raw Session Log in Step 3 (structured sections only).

**Step 1 — Silent analysis**
Review the full conversation. Prepare:
- SLUG: 2-4 word domain slug (e.g. compress-redesign, hook-system)
- KEYWORDS: 4-8 terms (project names, technical terms, tools, action types)
- QUICK RESUME: 2-3 sentences that fully orient the next session
- DECISIONS: specific choices made with rationale (→ Decisions/)
- ARCHITECTURE: system design or component changes (→ Architecture/)
- KEY LEARNINGS: insights and discoveries
- FILES MODIFIED: if TRANSCRIPT was found in Step 0.5, run `node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\files-touched.js" "{TRANSCRIPT}"` (PowerShell tool) and use its deterministic output verbatim — authoritative, don't rely on memory; otherwise list every file created/edited from tool calls in this session
- PENDING TASKS: unfinished work, next steps
- PREFERENCES: any user working-style changes (→ Knowledge/Preferences.md)

**Step 2 — Single question message**
Present ONE message with two sections:

**Planning to save:**
- Slug: `{slug}`
- Keywords: `{keywords}`
- Quick Resume: {sentence}
- Decisions: {list or "none"}
- Architecture: {list or "none"}
- Key Learnings: {list or "none"}
- Files Modified: {list or "none"}
- Pending Tasks: {list or "none"}
- Preferences: {list or "none"}

**Open questions:** {any ambiguities — or "None, proceeding."}

Wait for user response. If open questions is "None, proceeding." skip waiting and go straight to Step 3.

**Step 3 — Resolve and write**
Apply user corrections. If one unknown remains, ask it (max 1 follow-up). Otherwise proceed immediately.

**3a — Session log** → write `{Vault Root}/Session-Logs/YYYY-MM-DD-{slug}.md` with mcp__jarvis__write_note. Write the structured sections and STOP at the Raw Session Log separator — do NOT write the conversation turns yourself; the extractor does that verbatim:
```
---
type: session-log
date: YYYY-MM-DD
domain: {slug}
project: {Slug}
keywords: [{kw1}, {kw2}, ...]
---

## Quick Resume Context
{2-3 sentences.}

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| {decision} | {why} |

## Key Learnings
- {learning}

## Files Modified
- `{path}`: {what changed}

## Pending Tasks
- [ ] {task}

---

## Raw Session Log
<!-- /resume stops here — /recall searches below -->
```

**3b — Append verbatim transcript** → run the deterministic extractor (no LLM, faithful, zero token cost). Skip if TRANSCRIPT wasn't found in Step 0.5:
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\extract-transcript.js" "{TRANSCRIPT}" "{Vault Root}/Session-Logs/YYYY-MM-DD-{slug}.md"
```
It appends `USER:`/`ASSISTANT:` turns to the file, stripping thinking, tool calls/results, and harness-injected noise. Report the printed turn count.

**3c — Remaining entries** (write in parallel):
- **Decisions/** → if decisions exist: `{Vault Root}/Decisions/YYYY-MM-DD-{slug}.md`
  - Check mcp__jarvis__search_filename("{Vault Root}/Decisions/{slug}") first — append if exists, create if not.
  - Frontmatter: `type: decision · date · project: {Slug} · topic: {slug} · status: active`
- **Architecture/** → if architecture decisions exist: `{Vault Root}/Architecture/{component}.md`
  - Check mcp__jarvis__search_filename("{Vault Root}/Architecture/{component}") first — append if exists, create if not.
  - Frontmatter: `type: architecture · date · project: {Slug} · component: {component}`
- **Preferences** → if preferences changed: mcp__jarvis__append_note("Knowledge/Preferences.md", {changes})

**Step 4 — Update Working-Memory**
Read `{Vault Root}/Working-Memory.md`. Prepend new block as Session 3 (newest), shift others down, drop oldest if 4 blocks:
```
<!-- Session 3 (newest) -->
**YYYY-MM-DD · {slug}** — {≤60 token summary}. Open: {first pending task or "none"}.
↳ [[Session-Logs/YYYY-MM-DD-{slug}]]{ · [[{component}]] for each Architecture note written in 3c}{ · [[Decisions/YYYY-MM-DD-{slug}]] if a Decision was written in 3c}
```
Keep the bold `**YYYY-MM-DD · {slug}**` header byte-for-byte — the /resume scorer (`pick_resume_sessions`) parses it. The `↳` line wires Working-Memory into episodic (Session-Logs) + semantic (Architecture/Decisions) memory so it acts as a cross-tier hub; include only links you actually wrote. Write back with mcp__jarvis__write_note.

**Step 5 — Append to Brain.md**
Call mcp__jarvis__append_note("Brain.md", "| {YYYY-MM-DD} | {Slug} | [[{YYYY-MM-DD}-{slug}]] | {keywords joined by comma} |")
Schema is `| Date | Project | Slug | Keywords |`. Summary lives in the session log's Quick Resume Context section — /resume fetches it on demand. The wiki-link in the Slug column lets Obsidian's graph view connect Brain.md to each session log.

**Step 5.5 — Mark this transcript compressed** (so a later session doesn't offer to re-compress it):
```powershell
$tracker = "$env:JARVIS_VAULT_PATH\{Vault Root}\.compressed-transcripts"
if (-not $env:JARVIS_VAULT_PATH) { $tracker = "C:\Users\<you>\Documents\JARVIS-Vault\{Vault Root}\.compressed-transcripts" }
Split-Path "{TRANSCRIPT}" -Leaf | Add-Content $tracker
```
Skip if TRANSCRIPT wasn't found in Step 0.5.

**Step 5.6 — Refresh the token dashboard** (skip if TRANSCRIPT wasn't found):
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\token-report.js" "{TRANSCRIPT}" --ledger --html > $null 2>&1
```
Upserts this session into `{Vault Root}/Metrics/token-ledger.jsonl` and regenerates `dashboard.html`.

**Step 6 — Report**
List every vault file written, one line each (include the Raw Session Log turn count from Step 3b). No other commentary.
