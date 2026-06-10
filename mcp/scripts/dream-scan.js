// Deterministic "dream" anchor for /dream (and the /compress-last gate).
//
// Why: /dream consolidates recurring knowledge into the permanent CLAUDE.md tier.
// Deciding WHAT recurs should not be an LLM guess — Brain.md already records every
// session's keywords as structured data, so tally them deterministically and feed the
// ranked result to the Haiku judge as an ANCHOR (same pattern as files-touched.js
// anchoring the compress analyzer). The LLM then only judges worthiness / re-derivation,
// never "what is frequent".
//
// A keyword is a promotion CANDIDATE when it recurs across >= MIN_SESSIONS sessions for
// the project, with at least one occurrence within RECENCY_DAYS, and is not already a
// word in the vault CLAUDE.md (no point promoting what is already permanent). Skill-name
// tokens (resume/compress/...) carry no signal in this corpus and are dropped — shared
// stoplist with pick_resume_sessions.
//
// Usage:
//   node dream-scan.js [slug] [vaultRoot] [--gate] [--today YYYY-MM-DD]
//   e.g. node dream-scan.js Jarvis System/JARVIS
//   --gate  : terse one-line summary for the /compress-last offer (near-zero output)
//   --today : override "today" for the recency bucket (testing); default = system date

import fs from 'fs';
import path from 'path';

const VAULT = process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault';

// A keyword must recur in >= MIN_SESSIONS sessions, with its most recent occurrence
// within RECENCY_DAYS, to be a promotion candidate. Tune here.
const MIN_SESSIONS = 3;
const RECENCY_DAYS = 30;

// Skill names appear in nearly every session by construction — zero discrimination
// signal. Same stoplist as pick_resume_sessions (plus 'dream' itself).
const STOPLIST = new Set(['resume', 'compress', 'recall', 'preserve', 'status', 'dream']);

const args = process.argv.slice(2);
const gate = args.includes('--gate');           // terse offer for the /compress-last hook
const markSeen = args.includes('--mark-seen');  // /dream records that current candidates were reviewed
const todayIdx = args.indexOf('--today');
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--today');
const slug = positional[0] || 'Jarvis';
const vaultRoot = positional[1] || 'System/JARVIS';
const today = todayIdx >= 0 ? args[todayIdx + 1] : new Date().toISOString().slice(0, 10);

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function daysSince(rowDate) {
  const r = new Date(rowDate + 'T00:00:00Z').getTime();
  const t = new Date(today + 'T00:00:00Z').getTime();
  return Math.floor((t - r) / 86400000);
}
function bucketWeight(days) {
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.6;
  if (days <= 90) return 0.3;
  return 0.1;
}

// Parse Brain.md table -> [{date, project, slug, keywords[]}]. Mirrors pick-resume-sessions.
function parseBrain(content) {
  const rows = [];
  let inTable = false;
  for (const line of content.split('\n')) {
    if (/^\|\s*Date\s*\|/i.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
    if (!line.startsWith('|')) { if (line.trim() === '') continue; if (inTable) break; continue; }
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length < 4) continue;
    const [date, project, slugCell, keywordsCell] = cells;
    const sName = slugCell.replace(/^\[\[\d{4}-\d{2}-\d{2}-/, '').replace(/\]\]$/, '').trim();
    const keywords = keywordsCell.split(',').map(k => k.trim()).filter(Boolean);
    rows.push({ date, project, slug: sName, keywords });
  }
  return rows;
}

const brainPath = path.join(VAULT, 'Brain.md');
if (!fs.existsSync(brainPath)) { console.error(`Brain.md not found at ${brainPath}`); process.exit(1); }
const claudePath = path.join(VAULT, vaultRoot, 'CLAUDE.md');
const claudeText = fs.existsSync(claudePath) ? fs.readFileSync(claudePath, 'utf8') : '';

const rows = parseBrain(fs.readFileSync(brainPath, 'utf8')).filter(r => r.project === slug);

// Aggregate per keyword across the project's rows. score = Σ recency-bucket weights,
// so the same keyword scores higher when it recurs AND when those recurrences are recent.
const agg = new Map();   // kw -> { count, score, lastDate, sessions[] }
for (const row of rows) {
  const w = bucketWeight(daysSince(row.date));
  for (const kw of row.keywords) {
    if (STOPLIST.has(kw.toLowerCase())) continue;
    const a = agg.get(kw) || { count: 0, score: 0, lastDate: row.date, sessions: [] };
    a.count += 1;
    a.score += w;
    if (row.date > a.lastDate) a.lastDate = row.date;
    a.sessions.push(row.slug);
    agg.set(kw, a);
  }
}

const inClaude = kw => !!claudeText && new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(claudeText);

const candidates = [...agg.entries()]
  .filter(([kw, a]) => a.count >= MIN_SESSIONS && daysSince(a.lastDate) <= RECENCY_DAYS && !inClaude(kw))
  .map(([kw, a]) => ({ kw, count: a.count, score: Number(a.score.toFixed(2)), lastDate: a.lastDate, sessions: [...new Set(a.sessions)] }))
  .sort((a, b) => (b.score !== a.score ? b.score - a.score : (b.lastDate > a.lastDate ? 1 : -1)));

// De-nag state: which candidates have already been surfaced to the user (by a prior
// gate offer or a /dream run). Lets the /compress-last gate offer each recurring topic
// ONCE instead of every save. Self-pruning: only current candidates are kept.
const candKws = candidates.map(c => c.kw);
const statePath = path.join(VAULT, vaultRoot, '.dream-state');
const readOffered = () => { try { return JSON.parse(fs.readFileSync(statePath, 'utf8')).offered || []; } catch { return []; } };
const writeState = offered => { try { fs.writeFileSync(statePath, JSON.stringify({ lastRun: today, offered }, null, 2) + '\n'); } catch {} };

if (markSeen) {            // /dream calls this after presenting proposals
  writeState(candKws);
  console.log(`marked ${candKws.length} candidate(s) as seen`);
  process.exit(0);
}

if (gate) {
  const fresh = candKws.filter(k => !readOffered().includes(k));
  writeState(candKws);     // record current set (self-prunes aged-out keywords)
  console.log(fresh.length === 0
    ? 'GATE: none'
    : `GATE: ${fresh.length} new candidate(s): ${fresh.join(', ')}`);
  process.exit(0);
}

if (candidates.length === 0) {
  console.log(`No promotion candidates for ${slug} (threshold: >=${MIN_SESSIONS} sessions, recent within ${RECENCY_DAYS}d, not already in CLAUDE.md).`);
  process.exit(0);
}

console.log(`Recurring topics not yet in permanent CLAUDE.md (project: ${slug}, as of ${today}):`);
for (const c of candidates) {
  console.log(`- ${c.kw} — ${c.count} sessions, score ${c.score}, last ${c.lastDate} · [${c.sessions.join(', ')}]`);
}
console.log(`\n(threshold: >=${MIN_SESSIONS} sessions, recent within ${RECENCY_DAYS}d; ${candidates.length} candidate(s))`);
