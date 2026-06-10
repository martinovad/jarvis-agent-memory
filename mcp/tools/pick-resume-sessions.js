import { z } from 'zod';
import fs from 'fs';
import { safePath } from '../lib/vault.js';

// Skill names — these tokens appear in essentially every Working-Memory block
// by construction (every session ends with /compress, most reference /resume,
// /status, /recall, /preserve in some way). IDF for these terms is ~0 in this
// corpus, so they carry no discrimination signal. Drop them before scoring.
const STOPLIST = new Set(['resume', 'compress', 'recall', 'preserve', 'status']);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function daysSince(rowDate, today) {
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

// Parse Brain.md table into [{date, project, slug, keywords[]}, ...].
// Slug column holds an Obsidian wiki-link [[YYYY-MM-DD-slug]]; extract just the slug.
function parseBrain(content) {
  const lines = content.split('\n');
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (/^\|\s*Date\s*\|/i.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
    if (!line.startsWith('|')) { if (line.trim() === '') continue; if (inTable) break; continue; }
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length < 4) continue;
    const [date, project, slugCell, keywordsCell] = cells;
    const slug = slugCell.replace(/^\[\[\d{4}-\d{2}-\d{2}-/, '').replace(/\]\]$/, '').trim();
    const keywords = keywordsCell.split(',').map(k => k.trim()).filter(Boolean);
    rows.push({ date, project, slug, keywords });
  }
  return rows;
}

// Extract slugs already represented in Working-Memory entries.
// WM blocks look like: **YYYY-MM-DD · slug-name** — ...
function extractWmSlugs(wmContent) {
  const slugs = new Set();
  const re = /\*\*\d{4}-\d{2}-\d{2}\s*·\s*([\w-]+)\*\*/g;
  let m;
  while ((m = re.exec(wmContent)) !== null) {
    slugs.add(m[1]);
  }
  return slugs;
}

function scoreRow(row, wmBody, today) {
  const scorableKeywords = row.keywords.filter(k => !STOPLIST.has(k.toLowerCase()));
  const matched = [];
  for (const kw of scorableKeywords) {
    const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i');
    if (re.test(wmBody)) matched.push(kw);
  }
  const overlap = matched.length;
  const days = daysSince(row.date, today);
  const bucket = bucketWeight(days);
  return { overlap, matched_keywords: matched, bucket_weight: bucket, days, score: overlap * bucket };
}

export default {
  name: 'pick_resume_sessions',
  config: {
    title: 'Pick resume sessions',
    description: 'Deterministically score Brain.md rows for the current project and return the top-N by relevance to Working-Memory. Uses word-boundary keyword matching with a stoplist for skill names, multiplied by a recency bucket weight (≤7d=1.0, ≤30d=0.6, ≤90d=0.3, >90d=0.1). Excludes rows whose slug already appears in Working-Memory.',
    inputSchema: {
      slug: z.string().describe('Project slug (matches Brain.md Project column)'),
      vault_root: z.string().describe('Vault folder for the project (e.g. System/JARVIS) — used to read Working-Memory.md'),
      today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Today in YYYY-MM-DD format, used for the recency bucket'),
      top_n: z.number().int().positive().optional().describe('Number of top picks to return (default: 3)')
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  handler: async ({ slug, vault_root, today, top_n }) => {
    const n = top_n || 3;

    const brainContent = fs.readFileSync(safePath('Brain.md'), 'utf8');
    const wmContent = fs.readFileSync(safePath(`${vault_root}/Working-Memory.md`), 'utf8');

    const wmSlugs = extractWmSlugs(wmContent);
    const allRows = parseBrain(brainContent);

    const candidates = allRows
      .filter(r => r.project === slug)
      .filter(r => !wmSlugs.has(r.slug));

    const scored = candidates.map(r => ({
      date: r.date,
      slug: r.slug,
      ...scoreRow(r, wmContent, today)
    }));

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.date !== a.date) return b.date > a.date ? 1 : -1;
      return a.slug < b.slug ? -1 : 1;
    });

    const picks = scored.slice(0, n).map(p => ({
      date: p.date,
      slug: p.slug,
      score: Number(p.score.toFixed(2)),
      matched_keywords: p.matched_keywords,
      bucket_weight: p.bucket_weight
    }));

    return { content: [{ type: 'text', text: JSON.stringify(picks, null, 2) }] };
  }
};
