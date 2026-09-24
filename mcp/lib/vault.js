import fs from 'fs';
import os from 'os';
import path from 'path';

// The one definition of where the vault lives. The default is derived rather than written out,
// so it carries no machine's user name and still resolves on a host that isn't Windows.
export const VAULT = process.env.JARVIS_VAULT_PATH || path.join(os.homedir(), 'Documents', 'JARVIS-Vault');

// Forward-slash spelling, for the modules that build vault paths by string concatenation.
export const VAULT_POSIX = VAULT.replace(/\\/g, '/');

// Resolve a vault-relative path and refuse anything outside the vault. path.relative is
// used instead of a string prefix check, so a sibling folder such as "JARVIS-Vault-old"
// can't pass (it resolves to "..\JARVIS-Vault-old\...").
export function safePath(userPath) {
  const root = path.resolve(VAULT);
  const resolved = path.resolve(root, userPath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`Path outside vault: ${userPath}`);
  }
  return resolved;
}

// For write tools: safePath, and the transcript archive is read-only (it holds the only copy of
// transcripts Claude Code has already deleted).
export function writablePath(userPath) {
  const full = safePath(userPath);
  const first = path.relative(path.resolve(VAULT), full).split(path.sep)[0].toLowerCase();
  if (first === '.jarvis-archive') throw new Error(`Path is read-only (transcript archive): ${userPath}`);
  return full;
}

export function walkVault(dir = VAULT, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      walkVault(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

// Write via a temp file + rename so a crash or a concurrent Obsidian save never
// leaves a half-written note.
export function writeFileAtomic(target, content) {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try { fs.renameSync(tmp, target); }
  catch { try { fs.copyFileSync(tmp, target); } finally { try { fs.unlinkSync(tmp); } catch {} } }   // never leave the temp file behind
}

export function rel(absPath) {
  return path.relative(VAULT, absPath);
}
