// One-off: extract inline <script> (no src) from static/index.html,
// write each to a temp file, and node --check them for syntax.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const htmlPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'static', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, i = 0, fail = false;
const dir = path.join(__dirname, 'tmp_scripts');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

while ((m = re.exec(html))) {
  i++;
  const code = m[1];
  if (!code.trim()) continue;
  const f = path.join(dir, `script_${i}.js`);
  fs.writeFileSync(f, code);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fail = true;
    console.error(`SCRIPT #${i} SYNTAX ERROR:\n${e.stderr ? e.stderr.toString() : e.message}`);
  }
}
console.log(fail ? 'FAIL' : `OK — ${i} inline scripts parse clean (checked ${fs.readdirSync(dir).length})`);
process.exit(fail ? 1 : 0);
