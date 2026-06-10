# JARVIS — Vision

The end-state goal is a personal AI assistant in the spirit of Marvel's Jarvis: persistent, proactive, and personal. Today's implementation is a memory layer; this doc tracks what's intentionally deferred toward that vision.

For current state and runbook see `CLAUDE.md`.

## What's built (today)
Three-tier memory: vault `CLAUDE.md` (permanent), `Working-Memory.md` (rotating 3-session buffer), `Brain.md` + `Session-Logs/` (full history). Live `/compress` skill, Node.js MCP server with 10 vault tools, project-aware skills via `Projects/registry.md`. `/resume` runs on the orchestrator pattern (Haiku subagent + `pick_resume_sessions`).

## Deferred (toward the Jarvis vision)
- **Proactive recall** — agent surfaces relevant past sessions mid-conversation when topic shifts, not just on `/resume`. (UserPromptSubmit hook pattern, see mem-search by Zilliz; defer until VPS + Claude Max due to per-turn token cost.)
- **Semantic search** — embeddings layer over vault (currently keyword + frontmatter only). (mem-search local plugin; or build Haiku `/recall` over Session-Logs/ as a cheaper interim.)
- **Verbatim conversation indexing** — verbatim retrieval across all prior sessions. (Mem Palace local RAG with SQL + Chroma + symbolic index. Lower priority — current Session-Logs/ Raw Session Log + future Haiku semantic `/recall` covers ~80% of the need.)
- **Knowledge graph** — entity/relationship extraction across sessions; pattern emergence. (Karpathy LLM Wiki / Recall; lower priority — content-consumption use case, not operational memory.)
- **Cross-modal capture** — `+Inbox/`, `Calendar/` are scaffolded but unused by skills.
- **Learned profile / dreaming** — *built (Session C):* `/dream` consolidates recurring knowledge into permanent memory (deterministic `dream-scan.js` anchor → Haiku judge → approval gate), proposing CLAUDE.md promotions + Preferences-profile updates + stale demotions. Still deferred: full autonomy (headless `--yes` staging + scheduler) — slash commands can't run under `claude -p`, so it needs a Task-Scheduler + inlined-prompt path.
- **Role-aware retrieval** — per-memory-role (episodic/semantic/procedural) retrieve-then-merge in `/recall` and `/resume`, gated by a `test-recall` A/B harness. Deferred: premature at the current ~67-note scale (typed-retrieval gains are documented on far larger corpora); revisit when the vault grows or `/recall` visibly misses connected results. Folders already encode role, so the lever is a role-aware retriever, not new metadata.
- **VPS migration** — host vault + MCP remotely for cross-machine access (HTTP/SSE transport, auth, Obsidian LiveSync). (Open Brain by Nate Jones: Postgres-on-Supabase + MCP gateway is the reference implementation.)

## Design principles
- Token efficiency is first-class: ≤2% session overhead.
- Local-first; nothing leaves the machine until VPS migration.
- Skills stay simple — composition over complexity.
- Discuss architecture before writing code.
