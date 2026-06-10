// One-shot migration: drop the Summary column from Brain.md.
// Old schema: | Date | Project | Slug | Summary | Keywords |
// New schema: | Date | Project | Slug | Keywords |
//
// Summary content is preserved in Session-Logs/{date}-{slug}.md ("Quick Resume Context").
//
// Safety:
//   1. Read-only validate parse first; abort if any data row fails.
//   2. Backup Brain.md as Brain.md.bak-<ts> + Brain.md.bak-<ts>.json (parsed structure).
//   3. Write Brain-new.md alongside; do NOT touch Brain.md until verified.
//   4. Roundtrip verify: parse Brain-new.md, confirm (date,project,slug) set is identical.
//   5. Atomic swap: rename Brain.md -> Brain.md.legacy, rename Brain-new.md -> Brain.md.
//
// Run with --dry-run to print the proposed Brain.md without writing.

import fs from 'fs';
import path from 'path';

const VAULT = process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault';
const BRAIN_PATH = path.join(VAULT, 'Brain.md');
const DRY_RUN = process.argv.includes('--dry-run');

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// Parse the Brain.md table. Returns { frontmatter, preTable, header, sep, rows, postTable }
// where rows is an array of { date, project, slug, summary, keywords, raw }.
function parseBrain(content) {
  const fmMatch = content.match(/^(---\n[\s\S]*?\n---\n)/);
  const frontmatter = fmMatch ? fmMatch[1] : '';
  const afterFm = content.slice(frontmatter.length);

  const lines = afterFm.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\|\s*Date\s*\|/i.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) die('No table header (| Date | ...) found in Brain.md');

  const sepIdx = headerIdx + 1;
  if (!/^\|[\s:|-]+\|$/.test(lines[sepIdx].trim())) {
    die(`Expected separator row after header at line ${sepIdx + 1}, got: ${lines[sepIdx]}`);
  }

  const preTable = lines.slice(0, headerIdx).join('\n');
  const header = lines[headerIdx];
  const sep = lines[sepIdx];

  const headerCells = header.split('|').map(s => s.trim()).filter(s => s.length > 0);
  const expectedOld = ['Date', 'Project', 'Slug', 'Summary', 'Keywords'];
  const expectedNew = ['Date', 'Project', 'Slug', 'Keywords'];
  const isOld = headerCells.length === expectedOld.length &&
                headerCells.every((c, i) => c.toLowerCase() === expectedOld[i].toLowerCase());
  const isNew = headerCells.length === expectedNew.length &&
                headerCells.every((c, i) => c.toLowerCase() === expectedNew[i].toLowerCase());
  if (!isOld && !isNew) {
    die(`Unexpected header columns: ${JSON.stringify(headerCells)}`);
  }
  if (isNew) {
    console.log('Brain.md already in new schema — nothing to migrate.');
    process.exit(0);
  }

  const rows = [];
  let postStart = lines.length;
  for (let i = sepIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      postStart = i;
      break;
    }
    if (!line.startsWith('|')) {
      postStart = i;
      break;
    }
    const cells = line.split('|').slice(1, -1).map(s => s.trim());
    if (cells.length !== 5) {
      die(`Row ${i + 1} has ${cells.length} cells (expected 5): ${line}`);
    }
    const [date, project, slug, summary, keywords] = cells;
    if (!date || !project || !slug) {
      die(`Row ${i + 1} missing required fields: ${line}`);
    }
    rows.push({ date, project, slug, summary, keywords, raw: line });
  }
  const postTable = lines.slice(postStart).join('\n');

  return { frontmatter, preTable, header, sep, rows, postTable };
}

// Build the new Brain.md content with Summary column removed.
function buildNew(parsed) {
  const newHeader = '| Date | Project | Slug | Keywords |';
  const newSep    = '|------|---------|------|----------|';
  const newRows = parsed.rows.map(r =>
    `| ${r.date} | ${r.project} | ${r.slug} | ${r.keywords} |`
  );
  const parts = [];
  if (parsed.frontmatter) parts.push(parsed.frontmatter.replace(/\n$/, ''));
  if (parsed.preTable.trim()) parts.push(parsed.preTable);
  parts.push(newHeader);
  parts.push(newSep);
  parts.push(...newRows);
  if (parsed.postTable.trim()) parts.push(parsed.postTable.replace(/^\n/, ''));
  return parts.join('\n') + (parsed.postTable.endsWith('\n') ? '' : '\n');
}

// Verify the new content roundtrips to the same (date,project,slug) set.
function verify(originalRows, newContent) {
  const reparsed = parseBrain(newContent);
  if (reparsed.rows.length !== originalRows.length) {
    die(`Row count mismatch: original=${originalRows.length} new=${reparsed.rows.length}`);
  }
  const origKeys = new Set(originalRows.map(r => `${r.date}|${r.project}|${r.slug}`));
  const newKeys  = new Set(reparsed.rows.map(r => `${r.date}|${r.project}|${r.slug}`));
  if (origKeys.size !== newKeys.size) die('Duplicate keys after migration');
  for (const k of origKeys) {
    if (!newKeys.has(k)) die(`Key missing after migration: ${k}`);
  }
  return true;
}

function main() {
  if (!fs.existsSync(BRAIN_PATH)) die(`Brain.md not found at ${BRAIN_PATH}`);

  const original = fs.readFileSync(BRAIN_PATH, 'utf8');
  const parsed = parseBrain(original);

  console.log(`Parsed ${parsed.rows.length} rows from Brain.md`);
  console.log(`Schema: 5-column (old) -> 4-column (new, Summary dropped)`);

  const newContent = buildNew(parsed);

  // Reparse the new content with a relaxed parser (since header changed shape)
  // — we inline a quick check rather than reusing parseBrain (which would exit on "already migrated").
  const reLines = newContent.split('\n');
  const reHeaderIdx = reLines.findIndex(l => /^\|\s*Date\s*\|/i.test(l));
  if (reHeaderIdx === -1) die('Verification failed: new content has no table header');
  const reRows = [];
  for (let i = reHeaderIdx + 2; i < reLines.length; i++) {
    if (!reLines[i].startsWith('|') || /^\s*$/.test(reLines[i])) break;
    const cells = reLines[i].split('|').slice(1, -1).map(s => s.trim());
    if (cells.length !== 4) die(`New row ${i + 1} has ${cells.length} cells (expected 4)`);
    reRows.push({ date: cells[0], project: cells[1], slug: cells[2], keywords: cells[3] });
  }
  if (reRows.length !== parsed.rows.length) {
    die(`Roundtrip row count mismatch: orig=${parsed.rows.length} new=${reRows.length}`);
  }
  const origKeys = new Set(parsed.rows.map(r => `${r.date}|${r.project}|${r.slug}`));
  const newKeys = new Set(reRows.map(r => `${r.date}|${r.project}|${r.slug}`));
  for (const k of origKeys) {
    if (!newKeys.has(k)) die(`Roundtrip key missing: ${k}`);
  }
  console.log(`Roundtrip verified: ${reRows.length} rows, all (date,project,slug) keys preserved`);

  if (DRY_RUN) {
    console.log('\n----- DRY RUN: proposed Brain.md content below -----\n');
    console.log(newContent);
    console.log('\n----- end dry run, no files written -----');
    return;
  }

  // Real run.
  const ts = timestamp();
  const bakMd   = `${BRAIN_PATH}.bak-${ts}`;
  const bakJson = `${BRAIN_PATH}.bak-${ts}.json`;
  const newPath = path.join(path.dirname(BRAIN_PATH), 'Brain-new.md');
  const legacy  = `${BRAIN_PATH}.legacy`;

  fs.writeFileSync(bakMd, original, 'utf8');
  fs.writeFileSync(bakJson, JSON.stringify({
    timestamp: ts,
    rows: parsed.rows.map(r => ({
      date: r.date, project: r.project, slug: r.slug, summary: r.summary, keywords: r.keywords
    }))
  }, null, 2), 'utf8');
  console.log(`Backup written: ${bakMd}`);
  console.log(`Backup written: ${bakJson}`);

  fs.writeFileSync(newPath, newContent, 'utf8');
  console.log(`Wrote staging file: ${newPath}`);

  fs.renameSync(BRAIN_PATH, legacy);
  fs.renameSync(newPath, BRAIN_PATH);
  console.log(`Swapped: ${BRAIN_PATH} (new) <- ${legacy} (preserved)`);
  console.log(`\nMigration complete. ${parsed.rows.length} rows migrated.`);
}

main();
