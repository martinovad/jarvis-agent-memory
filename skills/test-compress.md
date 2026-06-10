Verify the deterministic /compress transcript extractor against the current session — fidelity, speed, cost. Read-only: writes nothing to the vault. Run before trusting /compress, or any time `extract-transcript.js` changes.

**Step 0 — Resolve project + locate transcript**
- Resolve project per /compress Step 0 (registry → Slug, Vault Root). If unregistered, abort.
- Locate TRANSCRIPT per /compress Step 0.5 (most-recent `.jsonl` in `~/.claude/projects/<encoded-cwd>/`).

**Step 1 — Path B (extractor): measure speed + output** (no vault write):
```powershell
$ms=(Measure-Command { node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\extract-transcript.js" "{TRANSCRIPT}" --stdout > "$env:TEMP\jarvis-tc.txt" 2>$null }).TotalMilliseconds
$b=(Get-Item "$env:TEMP\jarvis-tc.txt").Length
$u=(Select-String -Path "$env:TEMP\jarvis-tc.txt" -Pattern '^USER:').Count
$a=(Select-String -Path "$env:TEMP\jarvis-tc.txt" -Pattern '^ASSISTANT:').Count
"extractor: $u user + $a assistant turns, $b bytes, $([int]$ms) ms, 0 LLM tokens"
```

**Step 2 — Fidelity checks** on `$env:TEMP\jarvis-tc.txt` (read it; do NOT dump it to the user):
- **Leakage scan**: `(Select-String -Path "$env:TEMP\jarvis-tc.txt" -Pattern '<command-message>','<ide_opened_file>','<system-reminder>','tool_use_id' | Measure-Object).Count` — expect 0. Nonzero is OK only if every hit is the model quoting the tag in prose (verify).
- **First/last turn** — first extracted turn is `USER:` and matches how the session began; last turn isn't cut mid-content.
- **Verbatim spot-check** — pick one of your own earlier user messages; confirm it appears word-for-word (typos included).

**Step 3 — Cost** — the extractor moves the verbatim log fully off the LLM: `~{bytes/4}` output tokens saved per compress vs. having the model write it.

**Step 4 — A/B benchmark vs the LLM (OPTIONAL, costly — ~40s + tens of thousands of tokens).** Run only when you want fresh comparative numbers, not on every check.
Spawn `Agent` (model: haiku) with this prompt:
```
Read the transcript JSONL at {TRANSCRIPT}. Reconstruct a verbatim Raw Session Log (USER:/ASSISTANT: turns, actual words, omit tool calls/results, thinking, attachments, harness tags). Write it to {TEMP}\jarvis-tc-llm.txt with the Write tool. Do NOT put the log in your response. Respond with ONLY: turns=<n> bytes=<n> truncated=<yes/no — where/why>
```
From the result capture `<usage>` total_tokens + duration_ms and the reported bytes. Compare: extractor (Step 1) vs LLM here. Expect the LLM to be far slower, cost real tokens, and produce FEWER bytes than the extractor (it paraphrases/drops content even when it reports `truncated=no`) — that gap is lost fidelity.

**Step 5 — Report** (display only this):
```
Compress Extractor Harness — {today}

Transcript: {basename}
Extractor:  {u}+{a} turns, {bytes} bytes, {ms} ms, 0 LLM tokens

Fidelity:
- No leakage:        ✅/❌  ({count})
- First/last turn:   ✅/⚠️
- Verbatim match:    ✅/❌

Cost: ~{bytes/4} output tokens off the LLM per compress

[if Step 4 ran]
A/B vs LLM:  extractor {ms} ms / 0 tok / {bytes} B   vs   LLM {llm_ms} ms / {llm_tokens} tok / {llm_bytes} B
             → {speedup}× faster, {llm_tokens} tokens saved, {bytes-llm_bytes} B more content kept

Verdict: {PASS | FAIL}
```
PASS if no leakage AND verbatim spot-check matches AND turn count is sane. FAIL otherwise — name the failing check.
