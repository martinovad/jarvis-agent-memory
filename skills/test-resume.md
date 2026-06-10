A/B verification harness for the resume subagent. Scoring is deterministic via `mcp__jarvis__pick_resume_sessions`, so this harness no longer verifies algorithmic parity — it verifies (a) the subagent calls the tool with the right inputs, (b) Haiku renders Working-Memory and Preferences faithfully, and (c) cost savings vs. inline Opus are real. Re-run any time the subagent prompt or rendering rules change.

**Step 0 — Resolve project**
Resolve project per /resume Step 0. Capture `Slug`, `Vault Root`, and today's date as `YYYY-MM-DD`. If the project isn't registered, abort the harness — this skill is for verification, not initialization.

**Step 1 — Path A: inline Opus execution**

Execute /resume Steps 1-3 in this main context using the same MCP tool the subagent uses:

1. Read in parallel:
   - `mcp__jarvis__read_note("{Vault Root}/Working-Memory.md")`
   - `mcp__jarvis__read_note("Knowledge/Preferences.md")`
2. Call `mcp__jarvis__pick_resume_sessions({ slug: "{Slug}", vault_root: "{Vault Root}", today: "{YYYY-MM-DD}", top_n: 3 })`.
3. For each returned row, read `mcp__jarvis__read_note("{Vault Root}/Session-Logs/{date}-{slug}.md")` and take pre-`## Raw Session Log` content.
4. Assemble the presentation in memory exactly as /resume would. **Do NOT display it.**

Record for Path A:
- The set of picked (date, slug) pairs from the tool's return value.
- The assembled output as a string `output_A`.
- Approximate Opus input tokens: sum the word counts of all files read × 1.33 (rough token-per-word ratio). Call this `tokens_A`.

**Step 2 — Path B: orchestrator + resume subagent**

Spawn `Agent` with `subagent_type: resume`. Prompt:

```
Slug: {Slug}
Vault Root: {Vault Root}
Today: {YYYY-MM-DD}
```

From the result, capture:
- The full response text (call this `output_B_raw`).
- The reported `total_tokens` from the result's `<usage>` block (call this `haiku_tokens`).
- The status line at the bottom (DONE / BLOCKED / NEEDS_CONTEXT).

Strip the trailing status line from `output_B_raw` to get `output_B` (the user-facing presentation).

**Step 3 — Parity check**

Compare Path A and Path B:

- **Picked sessions (sanity check):** does Path A's set of (date, slug) equal Path B's? (Extract Path B's picks from its `## Relevant Sessions` `### {date} · {slug}` headers.) Both paths call the same MCP tool, so these MUST match — a mismatch means the subagent did its own scoring instead of calling the tool. Mark ✅ MATCH or ❌ DIFFER.
- **Working-Memory rendering:** does the content of Path B's `## Working Memory` block contain the same session entry lines (the lines starting with `**YYYY-MM-DD ·`) in the same order as Path A's? Mark ✅ MATCH or ❌ DIFFER.
- **Preferences rendering:** does the content of Path B's `## Preferences` block contain the same bullet items as Path A's, in the same order? Heading style may differ (Path A may render `## Working Style`, subagent renders `**Working Style**`) — this is acceptable and not a fail. Mark ✅ MATCH or ❌ DIFFER (only on missing/extra bullets).

**Step 4 — Cost comparison**

Compute:
- `tokens_A` — Opus input estimate from Path A (above).
- `tokens_B_opus` ≈ 200 (brief) + word_count(output_B) × 1.33 (display) — what Opus paid for in Path B.
- `effective_opus_B = tokens_B_opus + (haiku_tokens / 12)` — Path B in Opus-equivalent terms.
- `savings_pct = (tokens_A - effective_opus_B) / tokens_A × 100`

**Step 5 — Verdict and display**

PASS if all three parity checks ✅ AND `savings_pct > 0`. FAIL otherwise.

Display only this report — never dump `output_A` or `output_B`:

```
Resume A/B Harness — {Today}

Parity:
- Picked sessions:           ✅/❌  ({diff if differ})
- Working-Memory rendering:  ✅/❌  ({diff if differ})
- Preferences rendering:     ✅/❌  ({diff if differ})

Cost (approximate):
- Path A (Opus inline):           ~{tokens_A} tokens
- Path B Opus parent overhead:    ~{tokens_B_opus} tokens
- Path B Haiku subagent total:    ~{haiku_tokens} tokens
- Path B effective Opus equiv:    ~{effective_opus_B} tokens
- Savings vs Path A:              ~{savings_pct}%

Subagent status: {DONE | BLOCKED | NEEDS_CONTEXT}

Verdict: {PASS | FAIL}
Recommendation:
  PASS → subagent path is healthy; promote /resume-orchestrator.md to /resume.md when ready, or keep both.
  FAIL → Picks differ: subagent isn't calling pick_resume_sessions — check agents/resume.md Step 2.
         Rendering differs: check the subagent's output-format section for dropped fields or reordering.
         Negative savings: Haiku prompt is bloated; trim the agent definition.
```

If subagent status is BLOCKED or NEEDS_CONTEXT, verdict is automatic FAIL — print the subagent's preceding error text in place of the cost comparison.

Do not add commentary outside the report block.
