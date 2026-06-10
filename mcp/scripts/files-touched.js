// Deterministic "files touched" extractor for /compress and /compress-last.
//
// Why: the compress analyzer (an LLM) reliably MISREPORTS "Files Modified" on long
// sessions — file changes live in tool_use blocks, which the cleaned transcript
// strips, so the analyzer is left to infer them from prose and anchors on whatever
// framing dominates (a build session can read as "research", Files Modified: none).
// File paths are structured data, so extract them deterministically instead. The
// printed list doubles as an ANCHOR fed to the analyzer so its whole summary
// reflects the actual work, not just the discussion.
//
// Captured: Write / Edit / MultiEdit (file_path), NotebookEdit (notebook_path),
// and the vault MCP writers write_note / append_note (path). NOT captured:
// Bash/PowerShell changes (git, node-driven writes) — they carry no structured
// path; the source files behind them are captured via Write/Edit.
//
// Usage: node files-touched.js <transcriptPath>

import fs from 'fs';
import path from 'path';

const VAULT = process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault';

const norm = p => p.replace(/\\/g, '/');
const lcDrive = p => p.replace(/^([a-zA-Z]):/, (_, d) => d.toLowerCase() + ':');
const VAULT_N = lcDrive(norm(VAULT));
// Canonical key: absolute, forward-slashed, drive-letter lowercased. Vault-relative
// paths (from write_note/append_note) resolve against the vault root, so the same
// file referenced both ways — e.g. append_note "Brain.md" and Edit on the absolute
// "<vault>/Brain.md" — collapses to one entry with combined ops.
const canon = p => {
  const n = lcDrive(norm(p));
  return path.isAbsolute(n) ? n : lcDrive(norm(path.join(VAULT, n)));
};
// Display vault files as vault-relative; everything else as the canonical absolute.
const display = key => (key.startsWith(VAULT_N + '/') ? key.slice(VAULT_N.length + 1) : key);
// A file that was touched but no longer exists was deleted later in the session
// (via a Bash/PowerShell rm — no structured path to catch directly). Flag it.
const exists = key => fs.existsSync(key);

const [transcriptPath] = process.argv.slice(2);
if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  console.error('usage: node files-touched.js <transcriptPath>');
  process.exit(1);
}

// tool name -> function picking the path from its input
const FILE_TOOLS = {
  Write: i => i.file_path,
  Edit: i => i.file_path,
  MultiEdit: i => i.file_path,
  NotebookEdit: i => i.notebook_path,
  mcp__jarvis__write_note: i => i.path,
  mcp__jarvis__append_note: i => i.path,
};

const seen = new Map();   // path -> Map(op -> count)
for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  const content = e.message && e.message.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b.type !== 'tool_use' || !FILE_TOOLS[b.name]) continue;
    const p = FILE_TOOLS[b.name](b.input || {});
    if (!p) continue;
    const op = b.name.replace('mcp__jarvis__', '');
    const key = canon(p);
    const ops = seen.get(key) || new Map();
    ops.set(op, (ops.get(op) || 0) + 1);
    seen.set(key, ops);
  }
}

if (seen.size === 0) { console.log('(no file-mutating tool calls found)'); process.exit(0); }

console.log([...seen.entries()]
  .map(([key, ops]) => [display(key), ops, key])
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([disp, ops, key]) => {
    const o = [...ops.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(', ');
    return `- \`${disp}\` — ${o}${exists(key) ? '' : ' (removed)'}`;
  })
  .join('\n'));
