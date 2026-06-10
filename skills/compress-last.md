Compress the PREVIOUS (uncompressed) session into the vault — cheaply. The Opus parent stays a thin relay; Haiku workers read the conversation and write everything in THEIR OWN context, so cost stays decoupled from session size. Run in a fresh session. To save the CURRENT session immediately, use /compress.

**Run every shell block below with the PowerShell tool directly — NOT the Bash tool.** They are PowerShell; wrapping them as `powershell -Command "..."` through Bash mangles the backticks (`` `n ``) and Windows paths (the error looks like `unexpected EOF while looking for matching backtick`).

**Step 0 — Resolve project** (parent)
PowerShell tool: `(Get-Location).Path` (normalize backslashes). Call mcp__jarvis__read_note("Projects/registry.md"). Match row → Slug, Vault Root. If not found: stop, tell the user to run /resume first.

**Step 0.5 — Find the previous uncompressed transcript** (parent, PowerShell tool):
```powershell
$enc = (Get-Location).Path -replace '[:\\/ ]','-'
$dir = "$env:USERPROFILE\.claude\projects\$enc"
$tracker = "$env:JARVIS_VAULT_PATH\{Vault Root}\.compressed-transcripts"
if (-not $env:JARVIS_VAULT_PATH) { $tracker = "C:\Users\<you>\Documents\JARVIS-Vault\{Vault Root}\.compressed-transcripts" }
$done = @(); if (Test-Path $tracker) { $done = Get-Content $tracker }
$all = Get-ChildItem "$dir\*.jsonl" | Sort-Object LastWriteTime -Descending
# Skip the current (newest) session + anything already compressed.
$cands = $all | Select-Object -Skip 1 | Where-Object { $done -notcontains $_.Name }
# Drop THIN meta-runs: a session that BOTH started with a /compress(-last) command
# AND stayed short (no real work to save). A session that began with /compress-last
# and then pivoted into substantial work (many turns) must still be captured — so
# only skip when the assistant-turn count is also low.
$real = foreach ($c in $cands) {
  $firstUser = Get-Content $c.FullName -TotalCount 30 | Where-Object { $_ -match '"type":"user"' } | Select-Object -First 1
  if ($firstUser -and $firstUser -match '<command-name>/compress') {
    $turns = (Select-String -Path $c.FullName -Pattern '"type":"assistant"').Count
    if ($turns -lt 60) { continue }   # thin throwaway compress-run -> skip
  }
  $c
}
$real = @($real)
if ($real.Count -eq 0) { "NONE" } else {
  "$($real[0].FullName)"
  "$($real[0].LastWriteTime.ToString('yyyy-MM-dd'))"
  "REMAINING: $($real.Count - 1)"
  $real | Select-Object -Skip 1 | ForEach-Object { "  - $($_.Name) [$($_.LastWriteTime.ToString('yyyy-MM-dd'))]" }
}
```
Capture PREV_TRANSCRIPT (line 1), PREV_DATE (line 2), and the REMAINING count. If "NONE": tell the user "No uncompressed prior session found." and stop. The run processes only the newest real uncompressed session; if REMAINING > 0, remember it — after finishing, tell the user how many older sessions still await and that re-running `/compress-last` captures the next.

**Step 1 — Extract the cleaned conversation to a temp file** (parent, PowerShell tool — DO NOT read this file into your own context):
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\extract-transcript.js" "{PREV_TRANSCRIPT}" --stdout > "$env:TEMP\jarvis-prev.txt"
"$env:TEMP\jarvis-prev.txt"
```
Capture the printed path as TEMP_CONV; note the turn count from the script's stderr line.

Also capture the deterministic list of files changed (ground truth — the cleaned conversation has tool calls STRIPPED, so the analyzer cannot otherwise see what was built):
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\files-touched.js" "{PREV_TRANSCRIPT}"
```
Capture the output as FILES_TOUCHED.

**Step 2 — Phase 1: spawn the analyzer** (parent). Agent tool: `subagent_type: general-purpose`, `model: haiku`. Prompt:
```
Files changed in this session (deterministic ground truth, extracted from tool calls — the cleaned conversation below has tool calls STRIPPED, so this is the authoritative record of what was built/edited):
{FILES_TOUCHED}

Reproduce that list verbatim in FILES MODIFIED, and let it anchor your whole summary: if files were changed, this was a BUILD session — do NOT characterize it as research/discussion only.

Read the cleaned conversation at {TEMP_CONV} ONCE, fully (use a single Read; do not re-read in chunks). Produce a compress PLAN as plain structured text and nothing else:
- SLUG (2-4 word kebab-case)
- KEYWORDS (4-8, comma-separated)
- QUICK RESUME (2-3 sentences orienting the next session)
- DECISIONS (each: choice + rationale) or "none"
- ARCHITECTURE (system/component changes) or "none"
- KEY LEARNINGS (bullets)
- FILES MODIFIED (path: what changed)
- PENDING TASKS (bullets)
- PREFERENCES (user working-style changes) or "none"
Do not write any files. Return only the plan.
```
Capture the returned plan.

**Step 3 — Present the plan + confirm** (parent). Show it as "Planning to save (previous session, {PREV_DATE})" with an Open questions line. Wait for the user unless there are none.

**Step 4 — Phase 2: spawn the writer** (parent). A FRESH worker — it does NOT need the conversation (structured sections come from the plan; the verbatim log is appended by the deterministic script). Agent tool: `subagent_type: general-purpose`, `model: haiku`. Prompt = the confirmed plan (with the user's edits applied) followed by:
```
Write the above plan to the JARVIS vault using your mcp__jarvis__* tools and the PowerShell tool. Context: Vault Root = {Vault Root}, Slug = {Slug}, date = {PREV_DATE}, transcript = {PREV_TRANSCRIPT}.
1. mcp__jarvis__write_note "{Vault Root}/Session-Logs/{PREV_DATE}-<slug>.md" — frontmatter (type: session-log, date: {PREV_DATE}, domain: <slug>, project: {Slug}, keywords: [...]) then ## Quick Resume Context, ## Decisions Made (table), ## Key Learnings, ## Files Modified, ## Pending Tasks, then a line "---", then "## Raw Session Log", then "<!-- /resume stops here — /recall searches below -->". STOP there — do NOT write the conversation turns yourself.
2. PowerShell tool: node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\extract-transcript.js" "{PREV_TRANSCRIPT}" "{Vault Root}/Session-Logs/{PREV_DATE}-<slug>.md"  (appends the verbatim log).
3. If decisions: mcp__jarvis__search_filename "{Vault Root}/Decisions/<slug>" then write/append "{Vault Root}/Decisions/{PREV_DATE}-<slug>.md". If architecture: search then write/append "{Vault Root}/Architecture/<component>.md". If preferences changed: mcp__jarvis__append_note "Knowledge/Preferences.md".
4. mcp__jarvis__read_note "{Vault Root}/Working-Memory.md"; prepend "<!-- Session 3 (newest) -->\n**{PREV_DATE} · <slug>** — <=60-token summary. Open: <first pending or none>.\n↳ [[Session-Logs/{PREV_DATE}-<slug>]]<append ' · [[<component>]]' for each Architecture note you wrote in step 3, and ' · [[Decisions/{PREV_DATE}-<slug>]]' if you wrote a Decision>" — keep the bold **{PREV_DATE} · <slug>** header byte-for-byte (the /resume scorer parses it); the ↳ line wires WM into episodic + semantic memory (cross-tier hub); keep max 3 blocks; write back with mcp__jarvis__write_note.
5. mcp__jarvis__append_note "Brain.md" with "| {PREV_DATE} | {Slug} | [[{PREV_DATE}-<slug>]] | <keywords> |".
6. PowerShell tool: Split-Path "{PREV_TRANSCRIPT}" -Leaf | Add-Content "<vault>\{Vault Root}\.compressed-transcripts"  (vault = $env:JARVIS_VAULT_PATH or C:\Users\<you>\Documents\JARVIS-Vault).
7. PowerShell tool: node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\token-report.js" "{PREV_TRANSCRIPT}" --ledger --html > $null 2>&1  (updates the token ledger + regenerates dashboard.html).
Return ONLY the list of vault files you wrote (one per line) + the Raw Session Log turn count. End with a status line: DONE or BLOCKED <reason>.
```
Capture the returned file list + status.

**Step 5 — Report + clean up** (parent). Display the file list verbatim. PowerShell tool: `Remove-Item "$env:TEMP\jarvis-prev.txt" -ErrorAction SilentlyContinue`. If the worker returned BLOCKED, show its reason instead. If REMAINING (Step 0.5) > 0, add one final line: "N older uncompressed session(s) still pending — run `/compress-last` again to capture the next." No other commentary except the dream-gate line from Step 6.

**Step 6 — Dream gate** (parent, PowerShell tool). The save just added a Brain.md row, so check cheaply whether recurring knowledge now warrants consolidation (no `--today` → uses the system date):
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\dream-scan.js" "{Slug}" "{Vault Root}" --gate
```
If the output is `GATE: none`, add nothing. If it is `GATE: N new candidate(s): <list>`, append exactly ONE line to your report: "💭 N recurring topic(s) now look promotion-worthy (<list>) — run `/dream` to consolidate." This only surfaces topics not already offered (the script tracks that in `.dream-state`), so it won't nag on every save.
