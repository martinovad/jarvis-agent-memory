// Deterministic "user asks" extractor for /compress and /compress-last.
//
// Why: on long, multi-topic sessions the compress analyzer (an LLM reading the
// cleaned, tool-call-stripped conversation) can drop whole threads — it compresses
// lossily and the LATER asks fall out (a lost-in-the-middle effect). User requests
// are structured enough to extract deterministically: this prints a numbered
// table-of-contents of every user turn (first ~15 words), fed to the analyzer as an
// ANCHOR so every distinct ask is accounted for, not just whatever framing dominates.
//
// Captured: real user text turns (type:user with text), in order. Skipped: tool_result
// turns, isMeta/isSidechain entries, harness-injected wrappers (ide/system-reminder);
// a slash-command turn collapses to its command name. Consecutive turns sharing the
// same opening (interrupt -> resend) are de-duplicated.
//
// Usage: node user-asks.js <transcriptPath>

import fs from 'fs';

const [transcriptPath] = process.argv.slice(2);
if (!transcriptPath || !fs.existsSync(transcriptPath)) {
  console.error('usage: node user-asks.js <transcriptPath>');
  process.exit(1);
}

const WORDS = 15;

// Same cleaning as extract-transcript.js: strip harness-injected wrappers (not the
// user's words), collapse a slash-command injection to just the command name.
function cleanUser(text) {
  text = text
    .replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '')
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/g, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\[Request interrupted by user\]/g, '');   // harness marker, not the user's words
  const m = text.match(/<command-name>([^<]+)<\/command-name>/);
  return (m ? m[1].trim() : text).replace(/\s+/g, ' ').trim();
}

const firstWords = t => {
  const w = t.split(' ');
  return w.length > WORDS ? w.slice(0, WORDS).join(' ') + '…' : t;
};

const asks = [];
let prev = '';
for (const line of fs.readFileSync(transcriptPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e; try { e = JSON.parse(line); } catch { continue; }
  if (e.type !== 'user' || e.isMeta || e.isSidechain || !e.message) continue;
  const content = e.message.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const clean = cleanUser(text);
  if (!clean) continue;                 // pure tool_result / empty turn
  const head = firstWords(clean);
  if (head === prev) continue;          // interrupt -> resend dedupe
  prev = head;
  asks.push(head);
}

if (asks.length === 0) { console.log('(no user asks found)'); process.exit(0); }
console.log(asks.map((a, i) => `${i + 1}. ${a}`).join('\n'));
