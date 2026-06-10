// Deterministic token-usage report for Claude Code session transcripts.
// Reads usage already recorded in the JSONL — no OTEL, no infra, no LLM.
//
// Modes (the full terminal report prints only on a bare run; the flags do their
// work quietly with a one-line confirmation, so they're safe to pipe/redirect):
//   node token-report.js <transcript>            terminal report for one session
//   node token-report.js <transcript> --ledger   upsert a compact record into the
//                                                 vault token ledger (jsonl)
//   node token-report.js --html                  render dashboard.html from the ledger
//
// Two usage sources in a transcript:
//  - assistant `message.usage`   -> MAIN thread (full input/cache/output split)
//  - `Agent` tool_result <usage> -> SUBAGENT totals (subagent_tokens; older runs: total_tokens). Subagent
//    turns aren't recorded as message.usage in the parent file, so their cost is
//    invisible unless we read the Agent result — the local equivalent of OTEL's
//    per-subagent agent_id spans, without standing up a collector.
//
// Data/render split: the ledger (small, append-only, model-readable) is the data
// layer; dashboard.html is the human view, generated from the ledger and never
// re-ingested into a model context. Sibling to extract-transcript.js.

import fs from 'fs';
import path from 'path';

const VAULT = process.env.JARVIS_VAULT_PATH || 'C:\\Users\\<you>\\Documents\\JARVIS-Vault';
const METRICS_DIR = path.join(VAULT, 'System', 'JARVIS', 'Metrics');
const LEDGER = path.join(METRICS_DIR, 'token-ledger.jsonl');
const DASHBOARD = path.join(METRICS_DIR, 'dashboard.html');

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }
const fmt = n => Number(n).toLocaleString('en-US');
const pad = (s, w) => String(s).padStart(w);

// Atomic write: temp file (unique per process) then rename over the target, so
// concurrent background runs (the Stop hook can fire several) never tear a file.
// Windows rename overwrites; if the target is briefly locked, fall back to copy.
function writeAtomic(target, content) {
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  for (let i = 0; i < 3; i++) {
    try { fs.renameSync(tmp, target); return; }
    catch { if (i === 2) { try { fs.copyFileSync(tmp, target); } catch {} try { fs.unlinkSync(tmp); } catch {} } }
  }
}

const args = process.argv.slice(2);
const htmlMode = args.includes('--html');
const ledgerMode = args.includes('--ledger');
const transcriptPath = args.find(a => !a.startsWith('--'));

// ---- analysis -------------------------------------------------------------
function analyze(file) {
  if (!fs.existsSync(file)) die(`transcript not found: ${file}`);
  const rows = [];
  const agentCalls = new Map();   // tool_use_id -> { model, desc }
  const subUsage = new Map();     // tool_use_id -> { total, tools, dur }
  let firstTs = null, lastTs = null, firstUserText = null;
  const web = { search: 0, fetch: 0 };

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (e.timestamp) { if (!firstTs) firstTs = e.timestamp; lastTs = e.timestamp; }

    if (e.type === 'user' && firstUserText === null && e.message) {
      const c = typeof e.message.content === 'string' ? e.message.content
        : Array.isArray(e.message.content) ? e.message.content.map(b => b.text || '').join(' ') : '';
      if (c.trim()) firstUserText = c;
    }

    const content = e.message && e.message.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use' && b.name === 'Agent') {
          agentCalls.set(b.id, { model: (b.input && b.input.model) || 'inherit', desc: (b.input && b.input.description) || '' });
        }
        if (b.type === 'tool_result') {
          const t = typeof b.content === 'string' ? b.content
            : Array.isArray(b.content) ? b.content.map(x => x.text || '').join('') : '';
          const m = t.match(/<usage>([\s\S]*?)<\/usage>/);
          if (m) {
            const num = re => Number((m[1].match(re) || [])[1] || 0);
            subUsage.set(b.tool_use_id, { total: num(/(?:subagent_tokens|total_tokens):\s*(\d+)/), tools: num(/tool_uses:\s*(\d+)/), dur: num(/duration_ms:\s*(\d+)/) });
          }
        }
      }
    }
    if (e.type === 'assistant' && e.message && e.message.usage) {
      const u = e.message.usage;
      const stu = u.server_tool_use || {};
      web.search += stu.web_search_requests || 0;
      web.fetch += stu.web_fetch_requests || 0;
      rows.push({
        model: e.message.model || 'unknown',
        in: u.input_tokens || 0, cc: u.cache_creation_input_tokens || 0,
        cr: u.cache_read_input_tokens || 0, out: u.output_tokens || 0,
      });
    }
  }
  if (rows.length === 0) die('no assistant messages with usage found');

  const sum = (r, k) => r.reduce((a, x) => a + x[k], 0);
  const total = { in: sum(rows, 'in'), cc: sum(rows, 'cc'), cr: sum(rows, 'cr'), out: sum(rows, 'out') };
  const totalIn = total.in + total.cc + total.cr;
  const byModel = [...new Set(rows.map(x => x.model))].map(model => {
    const r = rows.filter(x => x.model === model);
    return { model, turns: r.length, in: sum(r, 'in'), cc: sum(r, 'cc'), cr: sum(r, 'cr'), out: sum(r, 'out') };
  });
  const subs = [...agentCalls].filter(([id]) => subUsage.has(id)).map(([id, info]) => ({ ...info, ...subUsage.get(id) }));
  const top = rows.map((x, i) => ({ model: x.model, idx: i + 1, tot: x.in + x.cc + x.cr }))
    .sort((a, b) => b.tot - a.tot).slice(0, 5);

  return {
    file: file.split(/[\\/]/).pop(), firstTs, lastTs,
    date: (lastTs || firstTs || '').slice(0, 10),
    mainTurns: rows.length, byModel, total, totalIn,
    cacheRatio: totalIn > 0 ? +(total.cr / totalIn * 100).toFixed(1) : 0,
    web, subs, subTotal: subs.reduce((a, s) => a + s.total, 0), top,
    // meta = a thin throwaway compress-run. Must be BOTH: started with a
    // /compress(-last) command AND short — a session that began with a compress
    // and then pivoted into real work (many turns) is genuine work, not meta.
    kind: (/<command-name>\/compress/.test(firstUserText || '') && rows.length < 60) ? 'meta' : 'work',
  };
}

// ---- text report ----------------------------------------------------------
function printText(s) {
  const W = 14;
  console.log(`\nTOKEN REPORT — ${s.file}`);
  console.log(`Span: ${s.firstTs || '?'} -> ${s.lastTs || '?'}  ·  ${s.mainTurns} main-thread turns, ${s.subs.length} subagent call(s)\n`);
  console.log('MAIN THREAD (parent context — full usage breakdown)');
  console.log(`${' '.repeat(16)}${pad('input', W)}${pad('cache_create', W)}${pad('cache_read', W)}${pad('output', W)}`);
  const line = (label, b) => console.log(`${label.padEnd(16)}${pad(fmt(b.in), W)}${pad(fmt(b.cc), W)}${pad(fmt(b.cr), W)}${pad(fmt(b.out), W)}`);
  for (const b of s.byModel) line(b.model.replace('claude-', ''), b);
  console.log('-'.repeat(16 + W * 4));
  line('TOTAL', s.total);
  console.log(`\nCache hit ratio: ${s.cacheRatio}%  (cache_read / total input)`);
  console.log(`Web tool calls:  ${s.web.search} search, ${s.web.fetch} fetch`);
  if (s.subs.length) {
    console.log('\nSUBAGENTS (Agent tool — subagent_tokens; cost is OFF the parent budget)');
    for (const x of s.subs) console.log(`  ${x.model.padEnd(10)} ${pad(fmt(x.total), 11)} tok  ${pad(x.tools, 3)} tools  ${pad((x.dur / 1000).toFixed(1) + 's', 7)}  ${x.desc}`);
    console.log(`  ${'TOTAL'.padEnd(10)} ${pad(fmt(s.subTotal), 11)} tok`);
  }
  console.log('\nTop main-thread turns by total input:');
  for (const t of s.top) console.log(`  #${pad(t.idx, 3)}  ${t.model.replace('claude-', '').padEnd(12)} ${pad(fmt(t.tot), 10)}`);
  console.log('');
}

// ---- ledger (upsert, idempotent by transcript basename) -------------------
function upsertLedger(s) {
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  let recs = [];
  if (fs.existsSync(LEDGER)) {
    for (const l of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { recs.push(JSON.parse(l)); } catch { /* skip */ }
    }
  }
  recs = recs.filter(r => r.transcript !== s.file);
  recs.push({
    transcript: s.file, date: s.date, kind: s.kind, mainTurns: s.mainTurns,
    input: s.totalIn, cacheRead: s.total.cr, cacheRatio: s.cacheRatio,
    output: s.total.out, subTokens: s.subTotal, subCalls: s.subs.length,
    models: s.byModel.map(b => b.model.replace('claude-', '')),
  });
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  writeAtomic(LEDGER, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`Ledger: upserted ${s.file} (${recs.length} sessions) -> ${LEDGER}`);
}

// ---- html dashboard (rendered from the ledger) ----------------------------
function renderHtml() {
  if (!fs.existsSync(LEDGER)) die(`no ledger yet: ${LEDGER} (run with --ledger first)`);
  const recs = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>JARVIS — Token Ledger</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0d1117; color:#c9d1d9; font:14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; margin:0; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; } .sub { color:#8b949e; margin:0 0 20px; }
  .cards { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px 16px; min-width:140px; }
  .card .v { font-size:20px; font-weight:600; color:#58a6ff; } .card .k { color:#8b949e; font-size:12px; }
  table { border-collapse:collapse; width:100%; } th,td { padding:7px 10px; text-align:right; border-bottom:1px solid #21262d; }
  th { color:#8b949e; font-weight:600; cursor:pointer; user-select:none; text-align:right; } th:first-child,td:first-child { text-align:left; }
  th:hover { color:#c9d1d9; } tr:hover td { background:#161b22; }
  .bar { display:inline-block; height:8px; background:#1f6feb; border-radius:2px; vertical-align:middle; }
  .ratio-hi { color:#3fb950; } .ratio-lo { color:#d29922; }
  tr.meta td { opacity:.5; } .tag { font-size:11px; color:#8b949e; }
</style></head><body>
<h1>JARVIS — Token Ledger</h1>
<p class="sub">Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${recs.length} sessions · click a header to sort</p>
<div class="cards" id="cards"></div>
<table id="t"><thead><tr>
  <th data-k="date">Date</th><th data-k="mainTurns">Turns</th><th data-k="input">Total input</th>
  <th data-k="cacheRead">Cache read</th><th data-k="cacheRatio">Cache %</th><th data-k="output">Output</th>
  <th data-k="subTokens">Subagent tok</th><th data-k="subCalls">Sub calls</th><th data-k="kind">Type</th>
</tr></thead><tbody></tbody></table>
<script>
const recs = ${JSON.stringify(recs)};
const fmt = n => Number(n||0).toLocaleString('en-US');
const maxIn = Math.max(...recs.map(r=>r.input||0), 1);
let sortK='date', asc=false;
function render(){
  recs.sort((a,b)=>{ const x=a[sortK], y=b[sortK]; const c = x<y?-1:x>y?1:0; return asc?c:-c; });
  const tb = document.querySelector('#t tbody'); tb.innerHTML='';
  for(const r of recs){
    const w = Math.round((r.input||0)/maxIn*80);
    const rc = (r.cacheRatio>=90)?'ratio-hi':'ratio-lo';
    tb.insertAdjacentHTML('beforeend',
      '<tr class="'+(r.kind==='meta'?'meta':'')+'"><td title="'+r.transcript+'">'+r.date+'</td><td>'+fmt(r.mainTurns)+'</td>'+
      '<td><span class="bar" style="width:'+w+'px"></span> '+fmt(r.input)+'</td>'+
      '<td>'+fmt(r.cacheRead)+'</td><td class="'+rc+'">'+(r.cacheRatio||0)+'%</td>'+
      '<td>'+fmt(r.output)+'</td><td>'+fmt(r.subTokens)+'</td><td>'+(r.subCalls||0)+'</td>'+
      '<td class="tag">'+(r.kind||'work')+'</td></tr>');
  }
}
function cards(){
  const sum=k=>recs.reduce((a,r)=>a+(r[k]||0),0);
  const avg=k=>recs.length?Math.round(recs.reduce((a,r)=>a+(r[k]||0),0)/recs.length):0;
  const data=[['Sessions',recs.length],['Total input',fmt(sum('input'))],['Avg input/session',fmt(avg('input'))],
    ['Avg cache %',(recs.length?Math.round(recs.reduce((a,r)=>a+(r.cacheRatio||0),0)/recs.length):0)+'%'],
    ['Subagent tok',fmt(sum('subTokens'))]];
  document.getElementById('cards').innerHTML = data.map(([k,v])=>'<div class="card"><div class="v">'+v+'</div><div class="k">'+k+'</div></div>').join('');
}
document.querySelectorAll('th').forEach(th=>th.onclick=()=>{ const k=th.dataset.k; asc = (k===sortK)?!asc:false; sortK=k; render(); });
cards(); render();
</script></body></html>`;
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  writeAtomic(DASHBOARD, html);
  console.log(`Dashboard: ${recs.length} sessions -> ${DASHBOARD}`);
}

// ---- dispatch -------------------------------------------------------------
if (htmlMode && !transcriptPath) { renderHtml(); }
else {
  if (!transcriptPath) die('usage: node token-report.js <transcript> [--ledger] | --html');
  const s = analyze(transcriptPath);
  // Side-effects FIRST, so a truncated/broken stdout (piped to `head`, or
  // PowerShell `Select-Object -First n`, which kills the upstream process) can
  // never lose the ledger/dashboard write.
  if (ledgerMode) upsertLedger(s);
  if (htmlMode) renderHtml();
  // The full terminal report is only for a bare interactive run. In update mode
  // it's discarded noise (and the only output big enough to break a truncated
  // pipe); upsertLedger/renderHtml already print a one-line confirmation.
  if (!ledgerMode && !htmlMode) printText(s);
}
