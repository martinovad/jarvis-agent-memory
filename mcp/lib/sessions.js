// sessions.js - which Claude Code sessions of a registered project still need saving to the vault.
//
// One definition of "unsaved", shared by the SessionStart hook (session-context.js) and /compress-last
// (via `session-context.js --pending`).
//
// A transcript is NOT unsaved when it is: the current session (the newest transcript if the session
// id is unknown), listed in <Vault Root>/.compressed-transcripts, empty, a session with no assistant
// reply, a thin meta-run (starts with /compress-last and nothing else was typed), or a continuation copy
// (Claude Code writes the whole conversation into a new file after an idle "continue"; a transcript
// whose message ids are all contained in a newer, larger transcript is covered by it).

import fs from 'fs';
import os from 'os';
import path from 'path';

import { VAULT_POSIX as VAULT } from './vault.js';
export { VAULT };
const CLAUDE_DIR = (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).replace(/\\/g, '/');
const MAX_SCAN_BYTES = 64 * 1024 * 1024;   // bound the copy check so session start stays fast

const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Projects/registry.md rows: [{ path, slug, vaultRoot }]
export function registry() {
  const rows = [];
  for (const line of (read(`${VAULT}/Projects/registry.md`) || '').split(/\r?\n/)) {
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length >= 3 && /^([A-Za-z]:|\/)/.test(cells[0])) rows.push({ path: norm(cells[0]), slug: cells[1], vaultRoot: cells[2] });
  }
  return rows;
}

export function projectFor(cwd) {
  const c = norm(cwd).toLowerCase();
  return registry().find(r => r.path.toLowerCase() === c) || null;
}

// Unsaved sessions, newest first: [{ file, path, date, meta }]. meta = starts with /compress-last.
// activeMs (for callers outside a session): treat transcripts written within that many
// ms as live instead of skipping only the newest one.
export function unsavedSessions({ cwd, vaultRoot, sessionId, activeMs }) {
  // Claude Code's folder name: every non-alphanumeric character becomes "-".
  const dir = `${CLAUDE_DIR}/projects/${norm(cwd).replace(/[^a-zA-Z0-9]/g, '-')}`;
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); }
  catch { if (process.env.JARVIS_HOOK_DEBUG) console.error(`no transcript folder: ${dir}`); return []; }
  const tracked = new Set((read(`${VAULT}/${vaultRoot}/.compressed-transcripts`) || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean));
  const all = files.flatMap(f => { try { const st = fs.statSync(`${dir}/${f}`); return [{ f, size: st.size, mtime: st.mtimeMs }]; } catch { return []; } })
    .filter(x => x.size > 0).sort((a, b) => b.mtime - a.mtime);

  const current = sessionId ? `${sessionId}.jsonl` : activeMs ? null : all[0]?.f;
  const candidates = all.filter(x => x.f !== current && !tracked.has(x.f) && !(activeMs && Date.now() - x.mtime < activeMs));
  if (!candidates.length) return [];

  const idCache = new Map();
  let budget = MAX_SCAN_BYTES;
  const ids = x => {
    if (idCache.has(x.f)) return idCache.get(x.f);
    let set = null;
    if (x.size <= budget) {
      budget -= x.size;
      set = new Set();
      const txt = read(`${dir}/${x.f}`) || '';
      for (const m of txt.matchAll(/"id":"(msg_[A-Za-z0-9]+)"/g)) set.add(m[1]);
    }
    idCache.set(x.f, set);
    return set;
  };
  const firstUser = x => {
    const buf = Buffer.alloc(Math.min(x.size, 1024 * 1024));
    const fd = fs.openSync(`${dir}/${x.f}`, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    return buf.toString('utf8').split('\n', 40).find(l => l.includes('"type":"user"')) || '';
  };
  // Prompts the person typed (skill expansions, tool results and harness messages don't count); stops at `stopAt`.
  const typedPrompts = (x, stopAt) => {
    let n = 0;
    for (const l of (read(`${dir}/${x.f}`) || '').split('\n')) {
      if (!l.includes('"type":"user"')) continue;
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e.type !== 'user' || e.isMeta || e.isSidechain || !e.message) continue;
      const c = e.message.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('') : '';
      if (text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<local-command-(\w+)>[\s\S]*?<\/local-command-\1>/g, '').trim() && ++n >= stopAt) break;
    }
    return n;
  };

  const pending = [];
  for (const c of candidates) {
    let meta;
    try { meta = /<command-name>\/compress/.test(firstUser(c)); } catch { continue; }   // removed since listing
    // Nothing to save: no assistant reply at all, or a thin meta-run (the command and nothing typed after it).
    if (c.size < 4 * 1024 * 1024) {
      const replies = ((read(`${dir}/${c.f}`) || '').match(/"type":"assistant"/g) || []).length;
      if (replies === 0) continue;
    }
    if (meta && typedPrompts(c, 2) < 2) continue;
    const mine = ids(c);
    // A copy is covered by any newer transcript that contains all its messages (the same
    // conversation continued); only that newest copy needs saving. Identical copies: the newest covers the rest.
    const covers = (o, other) => other.size > mine.size || (other.size === mine.size && (o.mtime > c.mtime || (o.mtime === c.mtime && o.f > c.f)));
    const covered = mine && mine.size > 0 && all.some(o => o.f !== c.f && o.mtime >= c.mtime && (() => { const other = ids(o); return other && covers(o, other) && [...mine].every(id => other.has(id)); })());
    if (!covered) pending.push({ file: c.f, path: `${dir}/${c.f}`, date: localDate(c.mtime), meta });
  }
  return pending;
}
