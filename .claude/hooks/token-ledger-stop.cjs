// Stop hook: refresh the JARVIS token ledger + dashboard for the CURRENT session
// WITHOUT adding latency to the turn.
//
// Stop hooks block turn completion, so this returns in milliseconds: it reads the
// hook JSON from stdin, does a debounce check, then spawns a DETACHED background
// process for the actual parse/write — so transcript size never touches turn
// latency. Debounced to <=1 refresh / 15s. Always exits 0 (exit 2 would block the
// turn and risk a loop — never do that here). Node (not PowerShell) for fast cold
// start; .cjs so it's CommonJS regardless of any parent package.json.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const done = () => process.exit(0);
setTimeout(done, 2000).unref();           // safety: never hang the turn

let raw = '';
process.stdin.on('error', done);
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let tp;
  try { tp = JSON.parse(raw).transcript_path; } catch { return done(); }
  if (!tp || !fs.existsSync(tp)) return done();

  // Debounce on a marker file's mtime (bounds background CPU on long sessions).
  const marker = path.join(os.tmpdir(), 'jarvis-ledger-stop.marker');
  try { if (fs.existsSync(marker) && Date.now() - fs.statSync(marker).mtimeMs < 15000) return done(); } catch {}
  try { fs.writeFileSync(marker, '.'); } catch {}

  const proj = process.env.CLAUDE_PROJECT_DIR || 'C:\\Users\\<you>\\Active Projects\\Jarvis';
  const script = path.join(proj, 'mcp', 'scripts', 'token-report.js');
  if (!fs.existsSync(script)) return done();

  // Detached + ignored stdio: returns immediately, work runs off the critical path.
  spawn(process.execPath, [script, tp, '--ledger', '--html'],
    { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  done();
});
