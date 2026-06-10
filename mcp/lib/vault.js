import fs from 'fs';
import path from 'path';

export const VAULT = process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault';

export function safePath(userPath) {
  const resolved = path.resolve(VAULT, userPath);
  if (!resolved.startsWith(path.resolve(VAULT))) {
    throw new Error(`Path outside vault: ${userPath}`);
  }
  return resolved;
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
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function rel(absPath) {
  return path.relative(VAULT, absPath);
}
