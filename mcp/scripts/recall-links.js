// 1-hop link neighborhood for /recall v2 ("local search" lite).
//
// Given the note paths of search hits, returns their connected neighbors — both
// outbound [[links]] AND backlinks — grouped by CoALA memory role (working / episodic
// / semantic / index), so /recall surfaces not just the match but the memory connected
// to it. This is what makes the [[links]] machine-useful instead of decorative.
//
// Cheap by construction: the links are already authored in markdown, so traversal is
// pure local file resolution — no LLM, no embeddings, none of GraphRAG's indexing cost
// (cf. A-MEM's linked-note multi-hop gains without the extraction overhead).
//
// Session logs are read only up to "## Raw Session Log" so [[...]] inside the verbatim
// conversation never creates spurious edges.
//
// Usage: node recall-links.js <hitPath> [hitPath2 ...]
//   hitPath: vault-relative or absolute path of a search hit.

import fs from 'fs';
import path from 'path';

const VAULT = (process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault').replace(/\\/g, '/');
const ROOTS = ['System/JARVIS', 'Knowledge', 'Projects'];

const hits = process.argv.slice(2)
  .map(p => p.replace(/\\/g, '/').replace(new RegExp('^.*JARVIS-Vault/', 'i'), '').replace(/^\/+/, ''));
if (hits.length === 0) { console.error('usage: node recall-links.js <hitPath> [hitPath2 ...]'); process.exit(1); }

// Index every vault note.
const files = [];
function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.md')) files.push(p.replace(/\\/g, '/'));
  }
}
for (const r of ROOTS) walk(`${VAULT}/${r}`);
if (fs.existsSync(`${VAULT}/Brain.md`)) files.push(`${VAULT}/Brain.md`);

const rel = p => p.replace(VAULT + '/', '');
const baseName = p => path.basename(p, '.md');
const allRel = files.map(rel);
const relSet = new Set(allRel);

const byBase = new Map();
for (const r of allRel) { const b = baseName(r); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(r); }

// Resolve a [[link target]] to vault-relative path(s). Qualified (has '/') → path-suffix
// match (unique); bare basename → every file with that name (handles the log/decision
// same-name overlap by connecting to both).
function resolve(target) {
  target = target.split('#')[0].split('|')[0].trim();
  if (!target) return [];
  if (target.includes('/')) {
    const want = (target.endsWith('.md') ? target : target + '.md').toLowerCase();
    return allRel.filter(r => r.toLowerCase().endsWith(want));
  }
  return byBase.get(target) || [];
}

const linkRe = /\[\[([^\]]+)\]\]/g;
function readForLinks(relPath) {
  let txt;
  try { txt = fs.readFileSync(`${VAULT}/${relPath}`, 'utf8'); } catch { return ''; }
  const cut = txt.indexOf('## Raw Session Log');   // ignore verbatim conversation
  return cut >= 0 ? txt.slice(0, cut) : txt;
}
function outbound(relPath) {
  const out = new Set(); let m; const txt = readForLinks(relPath);
  while ((m = linkRe.exec(txt))) for (const t of resolve(m[1])) if (t !== relPath) out.add(t);
  return out;
}

// Outbound map for every note (needed for backlinks).
const outMap = new Map(allRel.map(r => [r, outbound(r)]));

const role = r =>
  /\/Session-Logs\//i.test(r) ? 'episodic'
  : (/\/Architecture\//i.test(r) || /\/Decisions\//i.test(r) || /CLAUDE(-archive)?\.md$/i.test(r)) ? 'semantic'
  : /Working-Memory\.md$/i.test(r) ? 'working'
  : (/Brain\.md$/i.test(r) || /Index\.md$/i.test(r)) ? 'index'
  : 'other';

function label(r) {
  let txt; try { txt = fs.readFileSync(`${VAULT}/${r}`, 'utf8').slice(0, 800); } catch { return baseName(r); }
  const fm = txt.match(/^---\n([\s\S]*?)\n---/);
  if (fm) { const d = fm[1].match(/^(?:domain|component):\s*(.+)$/m); if (d) return d[1].trim(); }
  const body = txt.replace(/^---\n[\s\S]*?\n---/, '');
  const h = body.match(/^#+\s+(.+)$/m);
  return h ? h[1].trim() : baseName(r);
}

const hitSet = new Set(hits.filter(h => relSet.has(h)));
const neighbors = new Set();
for (const h of hits) {
  for (const o of (outMap.get(h) || [])) if (!hitSet.has(o)) neighbors.add(o);          // outbound
  for (const [r, outs] of outMap) if (outs.has(h) && !hitSet.has(r)) neighbors.add(r);   // backlinks
}

if (neighbors.size === 0) { console.log('(no linked neighbors)'); process.exit(0); }

const groups = {};
for (const r of neighbors) (groups[role(r)] ||= []).push(r);
const order = ['working', 'episodic', 'semantic', 'index', 'other'];
const titles = { working: 'Working', episodic: 'Episodic (sessions)', semantic: 'Semantic (decisions/architecture)', index: 'Index', other: 'Other' };
console.log('Connected (1-hop):');
for (const g of order) {
  if (!groups[g]) continue;
  console.log(`\n${titles[g]}:`);
  for (const r of groups[g].sort()) console.log(`- [[${r}]] — ${label(r)}`);
}
