// resume-brief.js - builds the /resume presentation deterministically (no LLM, zero tokens).
//
// Usage: node resume-brief.js <Slug> <Vault Root> [YYYY-MM-DD]
//
// Sections, in order:
//   Working Memory   <Vault Root>/Working-Memory.md blocks (frontmatter, H1, HTML comments stripped)
//   Open Items       **OPEN:** lines from <Vault Root>/Research notes whose status starts with "active",
//                    each prefixed with its section heading. A decided item gets its marker rewritten
//                    (DECIDED/DONE + date) in the plan itself, so this list never replays stale work.
//   Last Session     structured head (Quick Resume, Decisions, Key Learnings, Files Modified, Pending)
//                    of the newest substantial Working-Memory session, capped; thinner newer ones get a
//                    Skipped line. None substantial: the newest one's Quick Resume. Never the raw log text.
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

// ---- last session ----------------------------------------------------------------------
// The structured head of the newest SUBSTANTIAL Working-Memory session: (>=1 own typed prompt AND
// >=1 real file) OR (>=2 own typed prompts AND >=1 decision). A session that only ran a save still gets
// analyzer-written Decisions about the save itself, so the typed-prompt count is what tells it apart.
// Capped at CAP tokens by a fixed cut ladder; Quick Resume and Pending are never cut.
const CAP = 1500;
const tokens = s => Math.ceil(s.length / 4);
const HEADS = ['Quick Resume', 'Decisions', 'Key Learnings', 'Files Modified', 'Pending Tasks'];
const SAVE_TARGET = /(^|\/)(Session-Logs|Decisions|Architecture)\/|(^|\/)(Working-Memory\.md|Brain\.md|Preferences\.md|\.compressed-transcripts)$/;

function parts(file) {
  const txt = stripFm(read(`${VAULT}/${vaultRoot}/Session-Logs/${file}`) || '').replace(/\r\n/g, '\n');
  const [head, raw] = txt.split(/^## Raw Session Log.*$/m);
  const sec = {};
  for (const h of HEADS) {
    const m = head.match(new RegExp(`^## ${h}[^\\n]*\\n([\\s\\S]*?)(?=^## |^---\\s*$|(?![\\s\\S]))`, 'm'));
    const body = m ? m[1].trim() : '';
    if (m) sec[h] = /^_?\(?none\)?\.?_?$/i.test(body) ? '' : body;
  }
  return { sec, raw: raw || '' };
}

// Own typed prompts in the raw log: role blocks split at a blank line; a USER block counts when,
// after dropping notifications, command output, interrupt markers and slash-command paragraphs,
// text remains - and it is the first block or follows an ASSISTANT block. Known limit: an assistant
// message quoting a log line that starts "USER: " after a blank line is counted too.
// null = no USER blocks at all (an old log format), so the prompt condition is skipped.
function ownPrompts(raw) {
  const start = raw.search(/^(USER|ASSISTANT): /m);
  if (start < 0) return null;
  const blocks = raw.slice(start).split(/\n\n(?=(?:USER|ASSISTANT): )/);
  let n = 0, users = 0;
  blocks.forEach((b, i) => {
    if (!b.startsWith('USER: ')) return;
    users++;
    if (i > 0 && !blocks[i - 1].startsWith('ASSISTANT: ')) return;
    const text = b.slice(6)
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
      .replace(/<local-command-(\w+)>[\s\S]*?<\/local-command-\1>/g, '')
      .replace(/\[Request interrupted by user[^\]]*\]/g, '');
    if (text.split(/\n\s*\n/).some(p => p.trim() && !/^\/[a-z][\w:-]*(\s|$)/i.test(p.trim()))) n++;
  });
  return users ? n : null;
}

const bullets = body => body.split('\n').filter(l => /^- /.test(l));
const pathOf = b => { const t = b.match(/`([^`]+)`/); return (t ? t[1] : b.slice(2).split(/\s+/).find(w => /\/|\.\w{1,5}\b/.test(w)) || '').replace(/[),.:;]+$/, ''); };
const realFiles = body => bullets(body).filter(b => { const p = pathOf(b); return !p || !SAVE_TARGET.test(p); }).length;
function decisionCount(body) {
  const rows = body.split('\n').filter(l => /^\|/.test(l) && !/^\|[\s|:-]+\|$/.test(l)).length;
  return (rows ? rows - 1 : 0) + body.split('\n').filter(l => /^([-*] |### )/.test(l)).length;
}

// Returns null when substantial, else the reason it was skipped.
function thin(file) {
  if (!file) return 'no log';
  const { sec, raw } = parts(file);
  if (!('Quick Resume' in sec)) return 'no structured head';
  const own = ownPrompts(raw), files = realFiles(sec['Files Modified'] || ''), dec = decisionCount(sec['Decisions'] || '');
  if (own === null) return files || dec ? null : 'no files or decisions';
  if (own === 0) return 'no typed prompt';
  if (files || (own >= 2 && dec)) return null;
  return dec ? `${own} typed prompt, no files` : 'no files or decisions';
}

// Cut renderings. Files: bullet -> its path; Decisions: first column + any "Decision" column
// (tables) or the text before the first " — ", " - " or ". " (bullets).
const filesAsPaths = body => bullets(body).map(b => `- ${pathOf(b) || b.slice(2).split(/ — | \(/)[0]}`).join('\n');
function decisionsShort(body) {
  const lines = body.split('\n');
  const hdr = lines.find(l => /^\|/.test(l));
  const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const keep = hdr ? cells(hdr).map((c, i) => i === 0 || /^decision$/i.test(c)) : [];
  return lines.map(l => {
    if (/^\|[\s|:-]+\|$/.test(l)) return `|${keep.filter(Boolean).map(() => '---').join('|')}|`;
    if (/^\|/.test(l)) return `| ${cells(l).filter((_, i) => keep[i]).join(' | ')} |`;
    if (/^[-*] /.test(l)) { const cut = l.slice(2).search(/ — | - |\. /); return cut < 0 ? l : l.slice(0, cut + 2); }
    return /^### /.test(l) ? l : null;
  }).filter(l => l !== null).join('\n');
}
// Top-level bullets with their continuation lines, so "first 3" keeps whole learnings.
const items = body => body.split(/\n(?=- )/).filter(b => /^- /.test(b));

function lastSessionBlock(date, s, file, skipped) {
  const { sec } = parts(file);
  const nFiles = bullets(sec['Files Modified'] || '').length, learn = items(sec['Key Learnings'] || ''), nDec = decisionCount(sec['Decisions'] || '');
  const st = { files: 'full', kl: 'full', dec: 'full' };
  const view = {
    'Quick Resume': () => sec['Quick Resume'],
    'Decisions': () => ({ full: sec['Decisions'], short: decisionsShort(sec['Decisions'] || ''), count: `${nDec} decisions, see log` })[st.dec],
    'Key Learnings': () => ({ full: sec['Key Learnings'], k3: [...learn.slice(0, 3), `- +${learn.length - 3} more, see log`].join('\n'), count: `${learn.length} learnings, see log` })[st.kl],
    'Files Modified': () => ({ full: sec['Files Modified'], paths: filesAsPaths(sec['Files Modified'] || ''), count: `${nFiles} files, see log` })[st.files],
    'Pending Tasks': () => sec['Pending Tasks'],
  };
  const cutNames = () => [
    st.files === 'paths' && 'Files Modified as paths', st.files === 'count' && 'Files Modified as a count',
    st.kl === 'k3' && `Key Learnings to the first 3 of ${learn.length}`, st.kl === 'count' && 'Key Learnings as a count',
    st.dec === 'short' && 'Decisions without rationale', st.dec === 'count' && 'Decisions as a count',
  ].filter(Boolean);
  const render = over => {
    const lines = [`## Last Session - ${date} · ${s}`, ...skipped];
    for (const h of HEADS) {
      const body = sec[h] && view[h]();
      if (body) lines.push(`### ${h === 'Pending Tasks' ? `Pending at end of session (${date})` : h}`, body);
    }
    const cuts = cutNames();
    if (cuts.length) lines.push(`_Cut to fit ${CAP} tokens: ${cuts.join('; ')}._`);
    if (over) lines.push(`_Over the ${CAP}-token cap after every cut._`);
    return lines.join('\n\n');
  };
  const ladder = [
    () => nFiles && (st.files = 'paths'), () => nFiles && (st.files = 'count'),
    () => learn.length > 3 && (st.kl = 'k3'), () => nDec && (st.dec = 'short'),
    () => learn.length && (st.kl = 'count'), () => nDec && (st.dec = 'count'),
  ];
  let block = render(false);
  for (const step of ladder) {
    if (tokens(block) <= CAP) return block;
    if (step()) block = render(false);
  }
  return tokens(block) <= CAP ? block : render(true);
}

const entries = [...wm.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\*\*(\d{4}-\d{2}-\d{2})\s*·\s*([\w-]+)\*\*/g)].map(m => [m[1], m[2]]);
const skipped = [];
let shown = false;
for (const [date, s] of entries) {
  const file = logFor(date, s);
  const why = thin(file);
  if (why) { skipped.push(`_Skipped ${date} · ${s} (${why})._`); continue; }
  out.push(lastSessionBlock(date, s, file, skipped));
  shown = true;
  break;
}
if (!shown && entries.length) {
  const [date, s] = entries[0];
  const file = logFor(date, s);
  const qr = file && quickResume(file);
  if (qr) out.push([`## Last Session - ${date} · ${s}`, ...skipped, qr, '_No substantial session in Working-Memory; showing the newest._'].join('\n\n'));
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
