// Deterministic Raw Session Log extractor for /compress.
// Reads a Claude Code transcript JSONL and appends a verbatim USER/ASSISTANT
// conversation log to a session-log markdown file. No LLM involved — the
// verbatim record stays faithful by construction and off the model's token
// budget (the expensive part of /compress).
//
// Usage:
//   node extract-transcript.js <transcriptPath> <outputPath>   (appends to file)
//   node extract-transcript.js <transcriptPath> --stdout       (preview, no write)
//
// What it keeps: user `text` content and assistant `text` blocks, in order.
// What it drops: thinking, tool_use, tool_result, attachments, and every
// non-message event type; plus isMeta / isSidechain entries.
// Slash-command injections (<command-name>X</command-name>) collapse to "X".
// Consecutive same-role turns coalesce into one labeled block.

import fs from 'fs';
import path from 'path';

const VAULT = process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault';

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const [transcriptPath, outArg] = process.argv.slice(2);
if (!transcriptPath || !outArg) {
  die('usage: node extract-transcript.js <transcriptPath> <vaultRelativeOutputPath|--stdout>');
}
if (!fs.existsSync(transcriptPath)) die(`transcript not found: ${transcriptPath}`);
const STDOUT = outArg === '--stdout';
// Output is given vault-relative (e.g. System/JARVIS/Session-Logs/...); resolve
// against the vault root, same convention as migrate-brain.js / vault.js.
const outPath = STDOUT ? null : (path.isAbsolute(outArg) ? outArg : path.join(VAULT, outArg));

const entries = [];
for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { entries.push(JSON.parse(line)); } catch { /* skip malformed line */ }
}

function textBlocks(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  }
  return '';
}

// Clean a user turn: strip harness-injected context wrappers (not the user's
// words), then collapse a slash-command injection to just the command name
// (which also drops the injected skill body riding along in the same block).
function cleanUser(text) {
  text = text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  const m = text.match(/<command-name>([^<]+)<\/command-name>/);
  return m ? m[1].trim() : text;
}

const turns = [];
for (const e of entries) {
  if (e.isMeta || e.isSidechain) continue;
  if (e.type !== 'user' && e.type !== 'assistant') continue;
  if (!e.message) continue;
  let text = textBlocks(e.message.content);
  if (e.type === 'user') text = cleanUser(text);
  text = (text || '').trim();
  if (!text) continue;
  const role = e.type === 'user' ? 'USER' : 'ASSISTANT';
  const last = turns[turns.length - 1];
  if (last && last.role === role) last.text += '\n\n' + text;
  else turns.push({ role, text });
}

const userTurns = turns.filter(t => t.role === 'USER').length;
const asstTurns = turns.filter(t => t.role === 'ASSISTANT').length;
const body = turns.map(t => `${t.role}: ${t.text}`).join('\n\n');
const bytes = Buffer.byteLength(body, 'utf8');

if (STDOUT) {
  process.stdout.write(body + '\n');
  console.error(`\n[preview] ${userTurns} user / ${asstTurns} assistant turns, ${bytes} bytes`);
  process.exit(0);
}

if (!fs.existsSync(outPath)) die(`output file not found (write the session log first): ${outPath}`);
fs.appendFileSync(outPath, '\n' + body + '\n');
console.log(`Raw Session Log: ${userTurns} user / ${asstTurns} assistant turns, ${bytes} bytes appended`);
