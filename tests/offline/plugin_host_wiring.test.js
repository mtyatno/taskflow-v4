// Integrasi host sistem plugin Fase 0a di index.html (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md
// §4.1, §4.2, §4.5, §4.6; rencana Task 5, R1–R3): <script> runtime, init + bindHost di App, slot Dashboard,
// emit task.completed dan pomodoro.ended.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");

// Jumlah baris index.html di main sebelum Fase 0a (6bb0c7e). Batas spec: +60 baris bersih per fase plugin.
const BASELINE_LINES = 46049;
const MAX_ADDED_LINES = 60;

function fnSource(name) {
  const s = html.indexOf(`function ${name}(`);
  assert.ok(s >= 0, `${name} harus ada`);
  const e = html.indexOf("\n}\n", s);
  assert.ok(e > s, `${name} akhir`);
  return html.slice(s, e);
}
const app = fnSource("App");
const dash = fnSource("Dashboard");

test("plugin-runtime.js dimuat setelah modul offline (meta, safehtml, themes, herobg) dan tepat sebelum ui-components.js", () => {
  const tag = '<script src="/static/plugin-runtime.js"></script>';
  const at = html.indexOf(tag);
  assert.ok(at > 0, "tag script plugin-runtime.js");
  assert.equal(html.indexOf(tag, at + 1), -1, "hanya sekali");
  const ui = html.indexOf('<script src="/static/ui-components.js"></script>');
  assert.ok(ui > at, "sebelum ui-components.js");
  assert.match(html.slice(at + tag.length, ui), /^\s*$/, "tepat sebelum ui-components.js");
  for (const dep of ["meta.js", "habitquery.js", "taskroutes.js", "safehtml.js", "themes.js", "herobg.js", "introgate.js"]) {
    const d = html.indexOf(`<script src="/static/offline/${dep}"></script>`);
    assert.ok(d > 0 && d < at, dep + " dimuat lebih dulu");
  }
});

test("plugin-runtime.js ada di STATIC sw.js (precache shell)", () => {
  assert.match(sw, /^\s*"\/static\/plugin-runtime\.js",/m);
});

test("App memanggil TF.plugins.init dan bindHost (toast, openTask, navigate, userId)", () => {
  assert.match(app, /window\.TF\?\.plugins\?\.init\(\)/);
  const at = app.indexOf("plugins?.bindHost({");
  assert.ok(at > 0, "bindHost dipanggil");
  const call = app.slice(at, app.indexOf("});", at));
  assert.match(call, /toast: showToast/);
  assert.match(call, /openTask: id => openTaskById\(id\)/);
  assert.match(call, /navigate: p => setPage\(p === "focus" \? "today" : p\)/);
  assert.match(call, /userId: user\?\.id/);
});

test("handleDone memancarkan task.completed setelah sukses lokal (R2)", () => {
  const s = app.indexOf("const handleDone = async taskId => {");
  assert.ok(s > 0);
  const body = app.slice(s, app.indexOf("\n  };", s));
  const done = body.indexOf("setTasks(prev => markTasksDoneLocal(prev, [taskId]));");
  const emit = body.indexOf('window.TF?.events?.emit("task.completed", {');
  assert.ok(done > 0 && emit > done, "emit setelah markTasksDoneLocal");
  assert.ok(emit < body.indexOf("} catch (err) {"), "hanya di jalur sukses");
  assert.match(body.slice(emit, body.indexOf("\n", emit)), /taskId,.*completedAt: new Date\(\)\.toISOString\(\)/);
});

test("tiga titik pencatatan Pomodoro memancarkan pomodoro.ended tanpa menunggu api.post", () => {
  const lines = html.split("\n");
  const emits = lines.map((l, i) => [l, i]).filter(([l]) => l.includes('emit("pomodoro.ended"'));
  assert.equal(emits.length, 3);
  for (const [l, i] of emits) {
    assert.match(l, /window\.TF\?\.events\?\.emit\("pomodoro\.ended", \{taskId: \w+, kind: [^,]+, pomodoros: [^,]+, focusSeconds: [^,]+, endedAt: [^}]+\}\);/);
    assert.doesNotMatch(l, /await/);
    const prev = lines.slice(Math.max(0, i - 12), i).join("\n");
    assert.match(prev, /api\.post\("\/api\/tasks\/" \+ \w+ \+ "\/pomodoros"/, "setelah api.post baris " + (i + 1));
  }
  assert.ok(emits.some(([l]) => /kind: "session"/.test(l)));
});

test("Dashboard merender <TF.Slot name=dashboard.widgets> setelah grid GTD, dengan guard", () => {
  const gtd = dash.indexOf('className: "gtd-grid dash-grid-2"');
  const slot = dash.indexOf('name: "dashboard.widgets"');
  const proj = dash.indexOf("/* ── Proyek aktif ── */");
  assert.ok(gtd > 0 && slot > gtd && slot < proj, "slot di antara grid GTD dan Proyek aktif");
  const guard = dash.indexOf("window.TF && window.TF.Slot && /*#__PURE__*/React.createElement(window.TF.Slot, {");
  assert.ok(guard > gtd && guard < slot, "dibungkus guard window.TF && window.TF.Slot");
  const block = dash.slice(slot, dash.indexOf("})", slot));
  assert.match(block, /context: \{/);
  assert.match(block, /user: user \? \{ id: user\.id, username: user\.username \} : null/);
  assert.match(block, /now: new Date\(\)/);
  assert.match(block, /onTaskClick/);
  assert.match(block, /showToast/);
});

test("index.html bertambah ≤ 60 baris (Lampiran A #13)", () => {
  const lines = (html.match(/\n/g) || []).length;
  assert.ok(lines - BASELINE_LINES <= MAX_ADDED_LINES, `index.html +${lines - BASELINE_LINES} baris (batas ${MAX_ADDED_LINES})`);
});
