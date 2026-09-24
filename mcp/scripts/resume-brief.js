// resume-brief.js - builds the /resume presentation deterministically (no LLM, zero tokens).
//
// Usage: node resume-brief.js <Slug> <Vault Root> [YYYY-MM-DD]
//
// Sections, in order:
//   Working Memory   <Vault Root>/Working-Memory.md blocks (frontmatter, H1, HTML comments stripped)
//   Open Items       **OPEN:** lines from <Vault Root>/Research notes whose status starts with "active",
//                    each prefixed with its section heading. A decided item gets its marker rewritten
//                    (DECIDED/DONE + date) in the plan itself, so this list never replays stale work.
//   Latest Session   Quick Resume Context of the newest Working-Memory entry's session log
//   Older Related    top-3 sessions by pick_resume_sessions scoring (Working-Memory sessions excluded),
//                    one line each; /recall fetches details on demand
//   Preferences      Knowledge/Preferences.md, H1 stripped, subheadings as bold lines
// Prints "BLOCKED: <reason>" when Working-Memory.md can't be read.

import fs from 'fs';
import pick from '../tools/pick-resume-sessions.js';

import { VAULT_POSIX as VAULT } from '../lib/vault.js';
const [slug, vaultRoot, todayArg] = process.argv.slice(2);
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const stripFm = txt => txt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
const tidy = txt => txt.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

if (!slug || !vaultRoot) { console.log('BLOCKED: usage: node resume-brief.js <Slug> <Vault Root> [YYYY-MM-DD]'); process.exit(1); }
const d = new Date();
const today = todayArg || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const wm = read(`${VAULT}/${vaultRoot}/Working-Memory.md`);
if (wm === null) { console.log(`BLOCKED: cannot read ${vaultRoot}/Working-Memory.md`); process.exit(1); }

const out = [];
const wmBody = tidy(stripFm(wm).replace(/<!--[\s\S]*?-->/g, '').replace(/^# .*$/m, ''));
out.push(`## Working Memory - ${slug}`, wmBody || '_Working-Memory is empty._');

// ---- open items from active plans ------------------------------------------------------
let research = [];
try { research = fs.readdirSync(`${VAULT}/${vaultRoot}/Research`).filter(f => f.endsWith('.md')).sort(); } catch {}
for (const f of research) {
  const txt = read(`${VAULT}/${vaultRoot}/Research/${f}`) || '';
  const fm = (txt.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
  if (!/^status:\s*active/im.test(fm)) continue;
  const items = [];
  let heading = '', fence = false;
  for (const line of stripFm(txt).split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { heading = h[1].replace(/^\d+[a-z]?\.\s*/, '').trim(); continue; }
    // Backtick-guarded: a plan that documents the convention writes `**OPEN:**` in prose.
    const o = line.match(/(?<!`)\*\*OPEN:\*\*(?!`)\s*(.*)$/);
    if (o) items.push(`- **${heading}:** ${o[1].trim()}`);
  }
  if (items.length) out.push(`## Open Items - [[Research/${f.replace(/\.md$/, '')}]]`, items.join('\n'));
}

// ---- latest session --------------------------------------------------------------------
// Session log path for a date + slug; falls back to any log ending in the slug (a log can be
// filed under its save date while Brain.md / Working-Memory carry the work date).
const logs = (() => { try { return fs.readdirSync(`${VAULT}/${vaultRoot}/Session-Logs`); } catch { return []; } })();
const logFor = (date, s) => logs.includes(`${date}-${s}.md`) ? `${date}-${s}.md` : logs.filter(f => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${s}\\.md$`).test(f)).sort().pop();   // exact slug; s is [\w-]+

// Quick Resume Context section, or the first paragraph for logs that predate that heading.
// Only the structured head counts: the Raw Session Log below can quote other sessions' sections.
function quickResume(file) {
  const body = stripFm(read(`${VAULT}/${vaultRoot}/Session-Logs/${file}`) || '').replace(/\r\n/g, '\n').split(/^## Raw Session Log/m)[0];
  const q = body.match(/^## Quick Resume Context\n([\s\S]*?)(?=^## |^---\s*$|(?![\s\S]))/m);
  if (q) return q[1].trim();
  return (body.replace(/^# .*$/m, '').trim().split(/\n\s*\n/)[0] || '').trim();
}

const firstEntry = wm.replace(/<!--[\s\S]*?-->/g, '').match(/\*\*(\d{4}-\d{2}-\d{2})\s*·\s*([\w-]+)\*\*/);
if (firstEntry) {
  const [, date, s] = firstEntry;
  const file = logFor(date, s);
  const qr = file && quickResume(file);
  if (qr) out.push(`## Latest Session - ${date} · ${s}`, qr);
}

// ---- older related sessions ------------------------------------------------------------
const firstSentence = txt => {
  const flat = txt.replace(/\s+/g, ' ').trim();
  const sentence = (flat.match(/^(.+?[.!?])(?=\s+[A-Z`"(*]|$)/) || [, flat])[1];
  const words = sentence.split(' ');
  return words.length > 30 ? `${words.slice(0, 30).join(' ')}…` : sentence;
};
try {
  const res = await pick.handler({ slug, vault_root: vaultRoot, today });
  const lines = JSON.parse(res.content[0].text).map(p => {
    const file = logFor(p.date, p.slug);
    const qr = file && quickResume(file);
    return `- ${p.date} · ${p.slug}${qr ? ` - ${firstSentence(qr)}` : ''}`;
  });
  if (lines.length) out.push('## Older Related Sessions', lines.join('\n'));
} catch { /* no Brain.md or no rows: omit the section */ }

// ---- preferences -----------------------------------------------------------------------
const prefs = read(`${VAULT}/Knowledge/Preferences.md`);
out.push('## Preferences', prefs === null ? '_Preferences.md not found._'
  : tidy(stripFm(prefs).replace(/^# .*$/m, '').replace(/^#{2,6}\s+(.*)$/gm, '**$1**')));

console.log(out.join('\n\n'));
