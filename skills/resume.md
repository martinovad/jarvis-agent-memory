Load session context from the vault. Execute all steps in order:

**Step 0 — Resolve project**
1. Run PowerShell: `(Get-Location).Path` — capture as CWD. Normalize backslashes to forward slashes.
2. Call mcp__jarvis__read_note("Projects/registry.md").
3. Find the table row where Project Path matches CWD.
4. If found: extract Slug and Vault Root.
5. If NOT found:
   a. Ask: "No vault entry found for '{CWD}'. Reply with a project name to initialize the vault, or 'cancel' to skip."
   b. Wait for user's reply. If 'cancel': stop here, load nothing further.
   c. Confirm before writing: "About to create Projects/{Slug}/ in the vault and register it. Proceed?"
   d. Wait for confirmation. If denied: stop.
   e. In parallel:
      - Call mcp__jarvis__write_note("Projects/{Slug}/Working-Memory.md") with:
        ```
        ---
        type: working-memory
        project: {Slug}
        ---
        # Working Memory — {Slug}
        <!-- Max 3 entries. Drop oldest when adding 4th. Each entry ~60 tokens. -->
        ```
      - Call mcp__jarvis__write_note("Projects/{Slug}/CLAUDE.md") with:
        ```
        ---
        type: project-memory
        project: {Slug}
        ---
        # Project: {Slug}
        **Goal**: (to be filled in)
        **Stack**: (to be filled in)
        ```
      - Call mcp__jarvis__append_note("Projects/registry.md", "| {CWD} | {Slug} | Projects/{Slug} |")
      - Call mcp__jarvis__write_note("Projects/{Slug}/Index.md") with:
        ```
        ---
        type: project-index
        project: {Slug}
        ---
        # {Slug} — Index

        Hub for the {Slug} project. Graph view: this node connects the project's main artifacts.

        - [[CLAUDE]] — permanent project memory
        - [[Working-Memory]] — rotating 3-session buffer
        - [[Decisions/]] — key decisions log
        - [[Architecture/]] — system design notes
        - [[Session-Logs/]] — full session snapshots
        ```
   f. Wire env vars into `{CWD}/.claude/settings.json`:
      - Try to Read the file. If missing: Write a fresh `{ "env": { "JARVIS_VAULT_ROOT": "Projects/{Slug}", "JARVIS_PROJECT_PATH": "{CWD}" } }` (2-space indent).
      - If present: parse JSON. If parse fails, tell the user the file is malformed and skip auto-write (do not attempt to fix). Otherwise:
        - If `env.JARVIS_VAULT_ROOT` or `env.JARVIS_PROJECT_PATH` already exist with different values, ask the user before overwriting.
        - Merge the two keys into `env` (creating the `env` block if absent), preserving all other top-level keys and formatting. Write back with Edit (targeted replacement) when feasible; otherwise Write the full re-serialized JSON.
   g. Tell the user: "Vault initialized for {Slug} and env vars wired into .claude/settings.json. Skills work immediately in this session; env vars only apply on next session start (used by the session-end hook)."

**Step 1 — Delegate to the resume subagent**

Use the `Agent` tool to spawn `subagent_type: resume`. Prompt (exactly these three fields, one per line):

```
Slug: {Slug}
Vault Root: {Vault Root}
Today: {YYYY-MM-DD from the current-date context block}
```

The subagent reads Working-Memory and Preferences in its own context; calls the `mcp__jarvis__pick_resume_sessions` MCP tool for deterministic scoring (word-boundary keyword overlap × bucket weight, WM-resident slugs excluded); reads the picked logs; and returns a formatted presentation with a trailing `Status:` line.

**Step 2 — Branch on the subagent's status and display**

The subagent's response ends with one status line. Read the last line of the response:

- `Status: DONE` — strip the status line; display the rest verbatim to the user. This is the normal path.
- `Status: BLOCKED` — display the subagent's full response (it explains which read failed). Do not retry.
- `Status: NEEDS_CONTEXT` — display the response and note that the parent's brief was incomplete (check Step 1 fields). Do not retry without fixing the brief.

Do not add commentary beyond the new-project setup note from Step 0 (if init ran). The subagent's output is the user-facing presentation.
