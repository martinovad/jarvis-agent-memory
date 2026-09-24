// FTS5 ranked vault search, shared by the /recall CLI (scripts/fts-search.js) and the
// MCP search_content tool.
//
// Every search first syncs the index (mtime+size gate, sha1 confirm, transactional
// replace: ~2ms when clean, ~33ms full rebuild at current scale), then runs a
// bm25-ranked query. The DB is disposable by design: schema drift or corruption means
// delete + rebuild, never migrate.
//
// Chunking: frontmatter -> docs columns; structured head split on "## " headings
// (small sections merged into the previous chunk); everything after "## Raw Session Log"
// split per USER exchange into a separate body_raw column so bm25 column weights keep
// transcripts findable without letting them swamp curated sections.
//
// Zero dependencies: node:sqlite (FTS5 verified in Node 24.14 / SQLite 3.51.2).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

import { VAULT_POSIX as VAULT } from './vault.js';
const ROOTS = ['System/JARVIS', 'Knowledge', 'Projects'];
const DB_DIR = `${VAULT}/.jarvis-index`;
const DB_PATH = `${DB_DIR}/fts.db`;
const SCHEMA_VERSION = '1';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS docs (
  doc_id   INTEGER PRIMARY KEY,
  path     TEXT NOT NULL UNIQUE,
  type     TEXT, project TEXT, topic TEXT, date TEXT,
  mtime_ms INTEGER NOT NULL, size INTEGER NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id INTEGER PRIMARY KEY,
  doc_id   INTEGER NOT NULL,
  seq      INTEGER NOT NULL,
  heading  TEXT,
  is_raw   INTEGER NOT NULL DEFAULT 0,
  slug     TEXT DEFAULT '', keywords TEXT DEFAULT '',
  body     TEXT DEFAULT '', body_raw TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  slug, heading, keywords, body, body_raw,
  content='chunks', content_rowid='chunk_id',
  tokenize = "unicode61 remove_diacritics 2"
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, slug, heading, keywords, body, body_raw)
  VALUES (new.chunk_id, new.slug, new.heading, new.keywords, new.body, new.body_raw);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, slug, heading, keywords, body, body_raw)
  VALUES ('delete', old.chunk_id, old.slug, old.heading, old.keywords, old.body, old.body_raw);
END;
`;

function freshOpen() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    db.exec(SCHEMA);
  } catch (e) {
    try { db.close(); } catch {}    // Windows: an open handle blocks the unlink in wipe()
    throw e;
  }
  return db;
}
function wipe() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
}

// Returns an open, schema-current database (auto-healing a corrupt or outdated one).
function openIndex({ rebuild = false } = {}) {
  let db;
  try {
    if (rebuild) wipe();
    db = freshOpen();
    const v = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    if (v && v.value !== SCHEMA_VERSION) { db.close(); wipe(); db = freshOpen(); }
  } catch {
    wipe();                                   // corrupt / not-a-db -> auto-heal
    db = freshOpen();
  }
  db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(SCHEMA_VERSION);
  return db;
}

// ---- vault walk -------------------------------------------------------------------
function vaultFiles() {
  const files = [];
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) files.push(p.replace(/\\/g, '/'));
    }
  };
  for (const r of ROOTS) walk(`${VAULT}/${r}`);
  if (fs.existsSync(`${VAULT}/Brain.md`)) files.push(`${VAULT}/Brain.md`);
  return files;
}
const rel = p => p.replace(VAULT + '/', '');

// ---- frontmatter + chunking ----------------------------------------------------------
function parseFrontmatter(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim().replace(/^\[|\]$/g, '');
  }
  return { fm, body: m ? txt.slice(m[0].length) : txt };
}

const RAW_SEP = '## Raw Session Log';

function splitMax(text, max) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const para of text.split(/\n\n+/)) {
    if (cur && cur.length + para.length + 2 > max) { out.push(cur); cur = ''; }
    cur = cur ? cur + '\n\n' + para : para;
  }
  if (cur) out.push(cur);
  return out;
}

function chunkNote(relPath, txt) {
  const { fm, body } = parseFrontmatter(txt);
  const stem = path.basename(relPath, '.md');
  const slug = [stem, fm.domain, fm.component].filter(Boolean).join(' ');
  const keywords = [fm.keywords, fm.topic, fm.tags].filter(Boolean).join(' ').replace(/,/g, ' ');
  const cut = body.indexOf(RAW_SEP);
  const structured = cut >= 0 ? body.slice(0, cut) : body;
  const raw = cut >= 0 ? body.slice(cut + RAW_SEP.length) : '';
  const chunks = [];

  // Structured head: preamble + "## " sections; merge tiny sections into the previous chunk.
  for (const part of structured.split(/^(?=## )/m)) {
    const text = part.trim();
    if (!text) continue;
    const h = text.match(/^## (.+)$/m);
    const heading = h ? h[1].trim() : (text.match(/^# (.+)$/m) || [, stem])[1].trim();
    if (text.length < 200 && chunks.length > 0) { chunks[chunks.length - 1].body += '\n\n' + text; continue; }
    for (const piece of splitMax(text, 4000)) chunks.push({ heading, is_raw: 0, body: piece, body_raw: '' });
  }
  if (chunks.length === 0) chunks.push({ heading: stem, is_raw: 0, body: '', body_raw: '' });

  // Raw log: one chunk per USER exchange, merged to >=1.5KB, capped at 6KB.
  if (raw.trim()) {
    let buf = '';
    const flush = () => { if (buf.trim()) for (const p of splitMax(buf, 6000)) chunks.push({ heading: 'Raw Session Log', is_raw: 1, body: '', body_raw: p }); buf = ''; };
    for (const ex of raw.split(/^(?=USER: )/m)) {
      buf += ex;
      if (buf.length >= 1500) flush();
    }
    flush();
  }
  return { fm, slug, keywords, chunks };
}

// ---- incremental refresh ---------------------------------------------------------------
function refresh(db) {
  const files = vaultFiles();
  const getDoc = db.prepare('SELECT doc_id, mtime_ms, size, hash FROM docs WHERE path=?');
  const seen = new Set();
  let changed = 0;
  for (const abs of files) {
    const r = rel(abs);
    seen.add(r);
    const st = fs.statSync(abs);
    const row = getDoc.get(r);
    if (row && row.mtime_ms === Math.trunc(st.mtimeMs) && row.size === st.size) continue;
    const txt = fs.readFileSync(abs, 'utf8');
    const hash = crypto.createHash('sha1').update(txt).digest('hex');
    if (row && row.hash === hash) {                       // touch-only change
      db.prepare('UPDATE docs SET mtime_ms=?, size=? WHERE doc_id=?').run(Math.trunc(st.mtimeMs), st.size, row.doc_id);
      continue;
    }
    const { fm, slug, keywords, chunks } = chunkNote(r, txt);
    db.exec('BEGIN');
    if (row) db.prepare('DELETE FROM chunks WHERE doc_id=?').run(row.doc_id);
    db.prepare(`INSERT INTO docs(path,type,project,topic,date,mtime_ms,size,hash) VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(path) DO UPDATE SET type=excluded.type, project=excluded.project, topic=excluded.topic,
                date=excluded.date, mtime_ms=excluded.mtime_ms, size=excluded.size, hash=excluded.hash`)
      .run(r, fm.type || null, fm.project || null, fm.topic || null, fm.date || null, Math.trunc(st.mtimeMs), st.size, hash);
    const docId = getDoc.get(r).doc_id;
    const ins = db.prepare('INSERT INTO chunks(doc_id,seq,heading,is_raw,slug,keywords,body,body_raw) VALUES(?,?,?,?,?,?,?,?)');
    chunks.forEach((c, i) => ins.run(docId, i, c.heading, c.is_raw, i === 0 ? slug : '', i === 0 ? keywords : '', c.body, c.body_raw));
    db.exec('COMMIT');
    changed++;
  }
  for (const row of db.prepare('SELECT doc_id, path FROM docs').all()) {
    if (seen.has(row.path)) continue;
    db.exec('BEGIN');
    db.prepare('DELETE FROM chunks WHERE doc_id=?').run(row.doc_id);
    db.prepare('DELETE FROM docs WHERE doc_id=?').run(row.doc_id);
    db.exec('COMMIT');
    changed++;
  }
  if (changed > 20) db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize')");
  return { notes: files.length, changed };
}

// ---- public API ------------------------------------------------------------------------

// Delete and rebuild the index. Returns { notes, chunks }.
export function rebuildIndex() {
  const db = openIndex({ rebuild: true });
  try {
    const { notes } = refresh(db);
    const chunks = db.prepare('SELECT COUNT(*) n FROM chunks').get().n;
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { notes, chunks };
  } finally { db.close(); }
}

// Recall floor + cap. Overridable for tuning.
//
// A single ABSOLUTE floor does not work here, because bm25 scales with a term's rarity.
// A rare term can score around -7, a term that appears in most notes around -0.6, and a stop
// word slightly above 0. A flat -1.0 floor would silently kill the common-but-legitimate query,
// while only the >=0 band is truly information-free.
//
// So: a narrow absolute floor kills the stop-word band, and a floor RELATIVE to the best hit
// kills a weak tail behind a strong match, which is the case that actually poisons context.
const RECALL_NOISE = Number(process.env.JARVIS_RECALL_NOISE ?? -0.05);   // score must beat this
const RECALL_RELATIVE = Number(process.env.JARVIS_RECALL_RELATIVE ?? 0.30); // ...and be within this fraction of the best
const RECALL_TOKEN_CAP = Number(process.env.JARVIS_RECALL_TOKEN_CAP ?? 2000);

// Ranked search. Returns [{ path, type, date, heading, is_raw, score, snippet }].
export function searchVault(query, limit = 5) {
  const db = openIndex();
  try {
    refresh(db);
    // Quote every term (bare '-' is the FTS5 NOT operator; kebab-case terms would be
    // syntax errors). Trailing * survives as a prefix query. AND first, OR fallback.
    const terms = String(query).split(/\s+/).filter(Boolean).map(t => {
      const prefix = t.endsWith('*');
      const clean = (prefix ? t.slice(0, -1) : t).replace(/"/g, '""');
      return `"${clean}"${prefix ? '*' : ''}`;
    });
    if (!terms.length) return [];
    const SEARCH = `
      SELECT d.path, d.type, d.date, d.mtime_ms, c.heading, c.is_raw,
             snippet(chunks_fts, -1, '**', '**', ' … ', 12) AS snip,
             bm25(chunks_fts, 6.0, 4.0, 3.0, 1.0, 0.4) AS score
      FROM chunks_fts
      JOIN chunks c ON c.chunk_id = chunks_fts.rowid
      JOIN docs d ON d.doc_id = c.doc_id
      WHERE chunks_fts MATCH ?
      ORDER BY score LIMIT 50`;
    let rows = db.prepare(SEARCH).all(terms.join(' '));
    if (rows.length === 0 && terms.length > 1) rows = db.prepare(SEARCH).all(terms.join(' OR '));

    // Recency + type adjustment (bm25 is negative: lower = better), dedupe by path.
    const now = Date.now();
    const TYPE_ADJ = { 'working-memory': -0.5 };
    for (const r of rows) {
      const t = r.date ? new Date(r.date + 'T00:00:00Z').getTime() : r.mtime_ms;
      const ageDays = Math.max(0, (now - (isNaN(t) ? r.mtime_ms : t)) / 86400000);
      r.final = r.score + 0.15 * Math.log(1 + ageDays) + (TYPE_ADJ[r.type] || 0);
    }
    const best = new Map();
    for (const r of rows) if (!best.has(r.path) || r.final < best.get(r.path).final) best.set(r.path, r);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    // Apply the floor (see the constants above) and the injection cap. A query that clears
    // nothing returns nothing, rather than handing back ranked noise as if it were an answer.
    const ranked = [...best.values()].sort((a, b) => a.final - b.final);
    if (!ranked.length || ranked[0].final > RECALL_NOISE) return [];
    const cutoff = ranked[0].final * RECALL_RELATIVE;   // scores are negative; worse = larger
    const out = [];
    let budget = RECALL_TOKEN_CAP;
    for (const r of ranked) {
      if (out.length >= limit) break;
      if (r.final > RECALL_NOISE || r.final > cutoff) continue;
      const hit = { path: r.path, type: r.type, date: r.date, heading: r.heading, is_raw: !!r.is_raw, score: Number(r.final.toFixed(3)), snippet: r.snip };
      const cost = Math.ceil((hit.path.length + String(hit.snippet || '').length) / 4);
      if (out.length && cost > budget) break;   // always return at least the top hit
      budget -= cost;
      out.push(hit);
    }
    return out;
  } finally { db.close(); }
}

// Human-readable rendering shared by the CLI and the MCP tool.
export function formatResults(results) {
  const lines = [`${results.length} result(s) found.`];
  for (const r of results) {
    const meta = [r.date, r.type, r.heading].filter(Boolean).join(' · ');
    lines.push('', `**${r.path}**${meta ? ' · ' + meta : ''}`, `> ${String(r.snippet || '').replace(/\s+/g, ' ').trim()}`);
  }
  return lines.join('\n');
}
