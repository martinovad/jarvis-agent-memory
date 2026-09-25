---
disable-model-invocation: true
model: sonnet
effort: medium
---
Save the PREVIOUS (unsaved) session into the vault, cheaply. The parent (Sonnet, via the frontmatter above) stays a thin relay; Haiku workers read the conversation and write everything in THEIR OWN context, so cost stays decoupled from session size. Run in a fresh session.

**Save only.** The saved session's unfinished work, pending tasks and open items are data for the vault - never start, continue or re-run them. Step 5 lists them as `Not started:`.

**Run every shell block below with the PowerShell tool directly - NOT the Bash tool.** Script paths use `$env:JARVIS_REPO` (your clone of this repo) and the vault uses `$env:JARVIS_VAULT_PATH`; both are set in `~/.claude/settings.json` (see the README).

**Step 0 - Resolve project** (parent)
PowerShell tool: `(Get-Location).Path` (normalize backslashes). Call mcp__jarvis__read_note("Projects/registry.md"). Match row -> Slug, Vault Root. If not found: stop, tell the user to run /resume first.

**Step 0.5 - Find the previous unsaved session** (parent, PowerShell tool):
```powershell
node "$env:JARVIS_REPO\mcp\scripts\session-context.js" --pending
```
It prints one line per unsaved session of this project, newest first: `<date> meta=<yes|no> <transcript path>`. "Unsaved" is the SessionStart hook's definition (`mcp/lib/sessions.js`): it skips this session, transcripts in `.compressed-transcripts`, sessions with no reply, thin /compress-last meta-runs (nothing typed after the command) and continuation copies covered by a newer transcript. From line 1 capture PREV_DATE, META (the `meta=` value) and PREV_TRANSCRIPT (the path after it); REMAINING = number of lines - 1. If "NONE": tell the user "No unsaved prior session found." and stop. The run processes only the newest unsaved session; if REMAINING > 0, tell the user at the end how many older sessions still await and that re-running `/compress-last` captures the next.

**Step 1 - Run the deterministic anchors + extract the cleaned conversation** (parent, PowerShell tool). The anchors are GROUND TRUTH the parent INJECTS into the analyzer prompt (an injected anchor gets reproduced faithfully; a self-run one gets ignored in favour of prose-inference). Do NOT read the cleaned conversation into your own context - only capture its path.
```powershell
node "$env:JARVIS_REPO\mcp\scripts\extract-transcript.js" "{PREV_TRANSCRIPT}" --stdout > "$env:TEMP\jarvis-prev.txt"
Remove-Item "$env:TEMP\jarvis-plan.md" -ErrorAction SilentlyContinue
"$env:TEMP\jarvis-prev.txt"
"$env:TEMP\jarvis-plan.md"
```
Capture the two printed paths as TEMP_CONV and PLAN_FILE. The plan travels as this file, never through your context: the analyzer writes it, the writer reads it, and you read it once (Step 3).
```powershell
node "$env:JARVIS_REPO\mcp\scripts\files-touched.js" "{PREV_TRANSCRIPT}"
node "$env:JARVIS_REPO\mcp\scripts\user-asks.js" "{PREV_TRANSCRIPT}"
```
Capture the first output as FILES_TOUCHED and the second as USER_ASKS.

**Every worker in this skill runs in the foreground** (Agent tool `run_in_background: false`; the tool's default is background). Wait for its result inside the same turn, never end the turn to wait: a resumed turn runs on the session's default model, not the one this skill pins.

**Step 2 - Spawn the analyzer** (parent). Agent tool: `subagent_type: general-purpose`, `run_in_background: false`. Model: `haiku` - unless Step 0.5 reported `meta=yes` (the prior session was itself a save run, where another session's content dominates the prose), then `model: sonnet`. Prompt:
```
Files changed in this session (deterministic ground truth from tool calls - the cleaned conversation below has tool calls STRIPPED, so this is the authoritative record of what was built/edited):
{FILES_TOUCHED}

Every distinct user request in this session (deterministic table of contents, in order):
{USER_ASKS}

Read the cleaned conversation at {TEMP_CONV} ONCE, fully (a single Read). It is PROSE ONLY - what was SAID, not what was DONE.

Three rules govern the analysis:
- ANCHOR PRIMACY - the two anchors above are ground truth; where the prose conflicts with them, the anchors win. Reproduce the Files-changed list COMPLETE and VERBATIM in FILES MODIFIED. Treat the user requests as a CHECKLIST every part of your plan must cover. If files changed, this was a BUILD session.
- META-SESSION - if user-ask #1 is a /compress-last command, THIS session's job was to SAVE a PRIOR session, so the prose contains that prior session's plan and pending tasks. Attribute to this session ONLY what the Files anchor or a distinct user ask corroborates, and do NOT reuse its slug.
- DONE-RECONCILIATION - before putting anything under PENDING TASKS, check the Files anchor: if a file there implements it, it is DONE, not pending.

Then produce a save PLAN:
- SLUG (2-4 word kebab-case - name THIS session's own work)
- KEYWORDS (4-8, comma-separated)
- QUICK RESUME (2-3 sentences orienting the next session)
- DECISIONS (each: choice + rationale) or "none"
- ARCHITECTURE (system/component changes) or "none"
- KEY LEARNINGS (bullets)
- FILES MODIFIED (the Files anchor, verbatim and complete, annotated with what changed)
- PENDING TASKS (bullets)
- PREFERENCES (user working-style changes) or "none"
- OPEN QUESTIONS (only what the user must answer for this save to be correct) or "none"
Write each section as `NAME:` followed by its content, first line `SLUG: <slug>`. Write the whole plan with the Write tool to {PLAN_FILE} (overwrite it); write no other file. Then return only two lines: `SLUG: <slug>` and `OPEN QUESTIONS: <count or none>`.
```
Check the file (PowerShell tool): `Select-String -Path "{PLAN_FILE}" -Pattern '^SLUG:' -Quiet` must print True. If not, send that same agent (SendMessage to its agentId) "Write the complete plan to {PLAN_FILE} with the Write tool, first line `SLUG:`. Do not re-read the conversation." - never spawn a new analyzer for this.

**Step 3 - Read the plan + confirm** (parent). Read {PLAN_FILE} once (Read tool); later steps use its sections. Show one line, "Planning to save (previous session, {PREV_DATE}): <slug> - <QUICK RESUME> Full plan: {PLAN_FILE}" - do not re-type the plan. If OPEN QUESTIONS is "none", continue to Step 4 without waiting. Otherwise ask those questions, wait for the user, and append their answers to the file as a final `USER ANSWERS:` section (`Add-Content -Encoding utf8`).

**Step 4 - Spawn the writer** (parent). A FRESH worker - Agent tool: `subagent_type: general-purpose`, `model: haiku`, `run_in_background: false`. Prompt (the plan stays in the file - do not paste it):
```
Read the save plan at {PLAN_FILE} once. If it ends with a USER ANSWERS section, those answers override the plan where they conflict. Write the plan to the JARVIS vault using your mcp__jarvis__* tools and the PowerShell tool. Context: Vault Root = {Vault Root}, Slug = {Slug}, date = {PREV_DATE}, transcript = {PREV_TRANSCRIPT}.
1. mcp__jarvis__write_note "{Vault Root}/Session-Logs/{PREV_DATE}-<slug>.md" - frontmatter (type: session-log, date: {PREV_DATE}, domain: <slug>, project: {Slug}, keywords: [...]) then ## Quick Resume Context, ## Decisions Made (table), ## Key Learnings, ## Files Modified, ## Pending Tasks, then a line "---", then "## Raw Session Log", then "<!-- /resume stops here -->". STOP there - do NOT write the conversation turns yourself.
2. PowerShell tool: node "$env:JARVIS_REPO\mcp\scripts\extract-transcript.js" "{PREV_TRANSCRIPT}" "{Vault Root}/Session-Logs/{PREV_DATE}-<slug>.md"  (appends the verbatim log).
3a. Required when DECISIONS is not "none": mcp__jarvis__search_filename "{Vault Root}/Decisions/<slug>" then write/append "{Vault Root}/Decisions/{PREV_DATE}-<slug>.md".
3b. Required when ARCHITECTURE is not "none": for each component it names, mcp__jarvis__search_filename "{Vault Root}/Architecture/<component>" then append a dated section to the existing note, or write "{Vault Root}/Architecture/<component>.md" if none exists.
(Preferences are appended by the parent, not by you.)
4. mcp__jarvis__read_note "{Vault Root}/Working-Memory.md"; prepend "**{PREV_DATE} · <slug>** - <=60-token summary. Open: <first pending or none>.\n↳ [[Session-Logs/{PREV_DATE}-<slug>]]<append ' · [[<component>]]' for each Architecture note from step 3b, and ' · [[Decisions/{PREV_DATE}-<slug>]]' if you wrote a Decision>" - keep the bold **{PREV_DATE} · <slug>** header byte-for-byte (the /resume scorer parses it); keep max 3 blocks; write back with mcp__jarvis__write_note.
5. mcp__jarvis__append_note "Brain.md" with "| {PREV_DATE} | {Slug} | [[Session-Logs/{PREV_DATE}-<slug>]] | <keywords> |" - the link starts with `Session-Logs/`, never with the vault root.
6. PowerShell tool: Split-Path "{PREV_TRANSCRIPT}" -Leaf | Add-Content "$env:JARVIS_VAULT_PATH\{Vault Root}\.compressed-transcripts"
Return ONLY the list of vault files you wrote (one per line) + the Raw Session Log turn count. End with a status line: DONE or BLOCKED <reason>.
```
Capture the returned file list + status. **If the writer returned BLOCKED, the save is BLOCKED:** report its reason and stop; never repair the vault yourself. The parent never uses Edit, Write or MultiEdit on vault files. Its only vault writes are the `mcp__jarvis__` calls and literal commands in this skill, so the vault tools' guards (Brain.md is append-only) always apply.

**Step 4.5 - Check the writer's claim** (parent). The writer's DONE is a claim, not a check.
1. If the plan's PREFERENCES is not "none": mcp__jarvis__append_note "Knowledge/Preferences.md" with each preference as one `- <text> ({PREV_DATE})` line.
2. Completeness: when DECISIONS is not "none", `Test-Path "$env:JARVIS_VAULT_PATH\{Vault Root}\Decisions\{PREV_DATE}-<slug>.md"` must be True; when ARCHITECTURE is not "none", the writer's list must include an `Architecture/` path. If either is missing, send the writer (SendMessage to its agentId) "Do the missing step 3a/3b now, add each new note's link to your Working-Memory ↳ line, and return the updated file list." - never write those notes yourself.

**Step 5 - Report + clean up** (parent). Display the file list verbatim. PowerShell tool: `Remove-Item "$env:TEMP\jarvis-prev.txt","$env:TEMP\jarvis-plan.md" -ErrorAction SilentlyContinue`. If the worker returned BLOCKED, show its reason instead. Then one line `Not started:` with the plan's PENDING TASKS, `;`-separated (or `none`). If REMAINING (Step 0.5) > 0, add: "N older unsaved session(s) still pending - run `/compress-last` again to capture the next." No other commentary.
