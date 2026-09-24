// SessionStart hook: loads JARVIS working memory into Claude's context and flags
// unsaved sessions. Deterministic, zero tool calls. Plain stdout from a SessionStart
// hook is added to Claude's context.
//
// For a working directory registered in <vault>/Projects/registry.md it prints:
//   1. that project's Working-Memory.md (frontmatter, H1 and HTML comments stripped)
//   2. one line if earlier transcripts for this project are not saved to the vault
// Unregistered directories print nothing. "Unsaved" is defined in mcp/lib/sessions.js.
//
// Usage (settings.json, SessionStart, matcher "startup|clear|compact"):
//   node ".../mcp/scripts/session-context.js"
//
// CLI (used by /compress-last, run from the project directory):
//   node ".../mcp/scripts/session-context.js" --pending [--oldest-first]
// prints one line per unsaved session, newest first: "<date> meta=<yes|no> <transcript path>",
// or NONE, or UNREGISTERED. The current session is read from CLAUDE_CODE_SESSION_ID.

import fs from 'fs';
import { VAULT, projectFor, unsavedSessions } from '../lib/sessions.js';

if (process.argv.includes('--pending')) {
  printPending();
} else {
  let raw = '';
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    try { run(JSON.parse(raw.replace(/^﻿/, '') || '{}')); } catch { /* never block a session start */ }
  });
}

function run(input) {
  const cwd = String(input.cwd || process.cwd());
  const project = projectFor(cwd);
  if (!project) return;

  const out = [];
  const wm = read(`${VAULT}/${project.vaultRoot}/Working-Memory.md`);
  if (wm) {
    const body = wm.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^# .*$/m, '').replace(/\n{3,}/g, '\n\n').trim();
    if (body) out.push(`JARVIS working memory (${project.vaultRoot}/Working-Memory.md, loaded at session start; use as background, don't recite it unless asked or /resume is run):`, body);
  }

  let pending = [];   // a failure here must not cost the session its Working-Memory
  try { pending = unsavedSessions({ cwd, vaultRoot: project.vaultRoot, sessionId: String(input.session_id || '') }); } catch {}
  if (process.env.JARVIS_HOOK_DEBUG) console.error('pending:', pending.map(p => p.file).join(', ') || '(none)');
  if (pending.length) {
    const latest = pending.map(p => p.date).sort().pop();
    out.push(`JARVIS: ${pending.length} earlier session${pending.length > 1 ? 's are' : ' is'} not saved to the vault (latest ${latest}). Mention this once in your first reply and suggest /compress-last.`);
  }
  if (out.length) process.stdout.write(out.join('\n\n') + '\n');
}

function printPending() {
  const project = projectFor(process.cwd());
  if (!project) return console.log('UNREGISTERED');
  const list = unsavedSessions({ cwd: process.cwd(), vaultRoot: project.vaultRoot, sessionId: process.env.CLAUDE_CODE_SESSION_ID || '' });
  if (process.argv.includes('--oldest-first')) list.reverse();
  console.log(list.length ? list.map(s => `${s.date} meta=${s.meta ? 'yes' : 'no'} ${s.path}`).join('\n') : 'NONE');
}

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
