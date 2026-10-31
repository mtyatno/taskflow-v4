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

// Baseline Fase 1: jumlah baris index.html di main 8a16cd4 (Fase 0b = 46092 di 33dda23b, Fase 0a = 46049 di 6bb0c7e).
// Batas spec: +60 baris bersih untuk seluruh Fase 1 (spec Fase 1 K20, rencana PR 1a-1 R17).
const BASELINE_LINES = 46095;
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

// ── Fase 0b (spec docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md §6.2–§6.4; rencana PR B Task 11) ──
test("pluginstate.js dimuat tepat sekali, setelah meta.js/outbox.js dan sebelum syncpush.js; ada di STATIC sw.js", () => {
  const tag = '<script src="/static/offline/pluginstate.js"></script>';
  const at = html.indexOf(tag);
  assert.ok(at > 0, "tag pluginstate.js");
  assert.equal(html.indexOf(tag, at + 1), -1, "hanya sekali");
  for (const dep of ["meta.js", "outbox.js", "db.js"]) {
    const d = html.indexOf(`<script src="/static/offline/${dep}"></script>`);
    assert.ok(d > 0 && d < at, dep + " lebih dulu");
  }
  assert.ok(html.indexOf('<script src="/static/offline/syncpush.js"></script>') > at, "sebelum syncpush.js");
  assert.match(sw, /^\s*"\/static\/offline\/pluginstate\.js",/m);
});

test("sync(): langkah pluginstate.pull terisolasi (step) setelah pull sketsa, sebelum pushOutbox", () => {
  const s = html.indexOf("function sync() {");
  const body = html.slice(s, html.indexOf("\n}\n", s));
  const pull = body.indexOf("pluginstate.pull(__syncRawFetch");
  assert.ok(pull > 0, "langkah pull ada");
  const stepAt = body.lastIndexOf("step(", pull);
  assert.ok(stepAt > 0 && body.slice(stepAt, pull).indexOf(".then(") < 0, "dibungkus step(");
  assert.ok(pull > body.indexOf("pullDrawingsAndReconcile"), "setelah pull sketsa");
  assert.ok(pull < body.indexOf("syncpush.pushOutbox(__syncTransport)"), "sebelum pushOutbox");
  assert.match(body, /window\.TF\.pluginstate \? window\.TF\.pluginstate\.pull\(__syncRawFetch, \{ userId: runUid, known: window\.TF\.plugins\?\.knownIds\?\.\(\) \?\? null \}\) : null/);
});

test("bindHost meneruskan fetch (network: true), isOfflineErr, pushNow", () => {
  const at = app.indexOf("plugins?.bindHost({");
  const line = app.slice(at, app.indexOf("\n", at));
  assert.ok(line.includes("fetch: (p, o) => api.fetch(p, { ...o, network: true })"), "fetch");
  assert.match(line, /isOfflineErr[,\s}]/);
  assert.ok(line.includes("pushNow: () => window.__pushNow()"), "pushNow");
});

// ── Fase 1 PR 1a-1 (spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §6, §7.1; rencana Task 11) ──
test("taskext.js + dbupgrade.js dimuat tepat sekali, tepat setelah db.js dan sebelum taskrepo/hydrate/syncpush; keduanya di STATIC", () => {
  const db = '<script src="/static/offline/db.js"></script>';
  const tx = '<script src="/static/offline/taskext.js"></script>';
  const up = '<script src="/static/offline/dbupgrade.js"></script>';
  const at = html.indexOf(db);
  assert.ok(at > 0);
  for (const tag of [tx, up]) {
    const i = html.indexOf(tag);
    assert.ok(i > at, tag + " setelah db.js");
    assert.equal(html.indexOf(tag, i + 1), -1, tag + " hanya sekali");
  }
  assert.match(html.slice(at, html.indexOf(up) + up.length), /^<script src="\/static\/offline\/db\.js"><\/script>\s*<script src="\/static\/offline\/taskext\.js"><\/script>\s*<script src="\/static\/offline\/dbupgrade\.js"><\/script>$/);
  // taskrepo.js/hydrate.js membaca root.TF.taskext saat dimuat → taskext.js wajib lebih dulu.
  for (const dep of ["taskrepo.js", "hydrate.js", "syncpush.js", "syncpull.js"]) {
    const d = html.indexOf(`<script src="/static/offline/${dep}"></script>`);
    assert.ok(d > html.indexOf(tx), dep + " setelah taskext.js");
  }
  assert.ok(html.indexOf('<script src="/static/plugin-runtime.js"></script>') > html.indexOf(tx), "plugin-runtime setelah taskext.js");
  const sDb = sw.indexOf('"/static/offline/db.js",');
  const sTx = sw.indexOf('"/static/offline/taskext.js",');
  const sUp = sw.indexOf('"/static/offline/dbupgrade.js",');
  assert.ok(sDb > 0 && sTx > sDb && sUp > sTx, "STATIC: db.js → taskext.js → dbupgrade.js");
  assert.equal(sw.indexOf('"/static/offline/taskext.js",', sTx + 1), -1);
  assert.equal(sw.indexOf('"/static/offline/dbupgrade.js",', sUp + 1), -1);
});

test("pageScopePred dipakai kanbanDonePool", () => {
  const pred = fnSource("pageScopePred");
  assert.match(pred, /slist_/);
  assert.match(pred, /proj_/);
  assert.match(pred, /isPersonalProjectTask\(t, /);
  const pool = fnSource("kanbanDonePool");
  assert.match(pool, /pageScopePred\(page\)/);
});

test("TaskListView: tombol view plugin dari useViews, pilihan per halaman, cabang SlotView sebelum Kanban di dalam liveWrap", () => {
  const tl = fnSource("TaskListView");
  assert.ok(tl.includes("const pageKind = window.TF?.plugins?.pageKindOf?.(page) ?? null;"));
  assert.ok(tl.includes("const extViews = window.TF?.plugins?.useViews ? window.TF.plugins.useViews(pageKind) : [];"));
  assert.ok(tl.includes('"tf_viewmode_ext:"'));
  assert.ok(tl.includes("window.TF.SlotView"));
  assert.ok(tl.includes('name: "taskList.views"'));
  assert.match(tl, /onFallback: \(\) => handleViewMode\("normal"\)/);
  assert.ok(tl.includes("window.TF.PluginIcon"));
  // pilihan dibaca ulang saat halaman berganti; handleViewMode menghapus kunci per halaman
  assert.match(tl, /useEffect\(\(\) => \{\s*setExtPick\(readExtPick\(\)\);\s*\}, \[page\]\)/);
  const hv = tl.slice(tl.indexOf("const handleViewMode = val => {"), tl.indexOf("};", tl.indexOf("const handleViewMode = val => {")));
  assert.match(hv, /localStorage\.removeItem\("tf_viewmode_ext:" \+ page\)/);
  // tf_viewmode tetap hanya di handleViewMode dan efek reset Kanban
  assert.equal((tl.match(/localStorage\.setItem\("tf_viewmode"/g) || []).length, 2);
  assert.match(hv, /localStorage\.setItem\("tf_viewmode"/);
  // context stabil: useMemo yang deps-nya tidak memuat `filtered`
  const m = tl.indexOf("const extCtx = React.useMemo(");
  assert.ok(m > 0, "extCtx useMemo");
  const depsAt = tl.indexOf("} : null, [", tl.indexOf("scopeTasks:", m));
  assert.ok(depsAt > m, "deps useMemo extCtx");
  const deps = tl.slice(depsAt, tl.indexOf("]);", depsAt));
  assert.doesNotMatch(deps, /\bfiltered\b/);
  for (const d of ["page", "tasks", "allTasks", "fPriority", "fSearch", "collaborators", "currentUser", "liveOn", "sel.ref"]) {
    assert.ok(new RegExp("\\b" + d.replace(".", "\\.") + "\\b").test(deps), "deps memuat " + d);
  }
  const ctxSrc = tl.slice(m, depsAt);
  for (const k of ["page", "pageKind", "listId", "projectName", "tasks", "scopeTasks", "collaborators", "currentUser", "onTaskClick", "isSelected", "liveEdit", "showToast"]) {
    assert.ok(new RegExp("\\b" + k + "\\b").test(ctxSrc), "context memuat " + k);
  }
  assert.match(ctxSrc, /pageScopePred\(page\)/);
  assert.match(ctxSrc, /applyPanelFilters\(/);
  assert.match(ctxSrc, /extCbRef\.current/);
  // cabang render
  const lw = tl.indexOf("liveWrap(loading ?");
  const ev = tl.indexOf("extView ? /*#__PURE__*/React.createElement(window.TF.SlotView", lw);
  const kb = tl.indexOf("kanbanOn ? /*#__PURE__*/React.createElement(\"div\"", lw);
  assert.ok(lw > 0 && ev > lw && kb > ev, "extView ? … sebelum kanbanOn ? di dalam liveWrap(");
  // tombol inti tidak ditekan saat view plugin aktif
  assert.ok(tl.includes('"aria-pressed": viewMode === mode && !extView'));
  assert.ok(tl.includes('"aria-pressed": viewMode === "kanban" && !extView'));
  assert.match(tl, /extViews\.map\(v => /);
});

test("TaskDetailBody: TF.Slot taskDetail.sections setelah td-desc-wrap dan sebelum DetailTabs, context dimemo", () => {
  const tdb = fnSource("TaskDetailBody");
  const desc = tdb.indexOf('className: "td-desc-wrap"');
  const slot = tdb.indexOf('name: "taskDetail.sections"');
  const tabs = tdb.indexOf("React.createElement(DetailTabs, {");
  assert.ok(desc > 0 && slot > desc && tabs > slot, "urutan td-desc-wrap → slot → DetailTabs");
  assert.ok(tdb.includes('window.TF?.Slot && React.createElement(window.TF.Slot, { name: "taskDetail.sections", context: tdPluginCtx })'));
  assert.match(tdb, /const tdPluginCtx = React\.useMemo\(\(\) => \(\{ task, variant, collaborators, onOpenTask, showToast: window\.__showToast \}\), \[task, variant, collaborators, onOpenTask\]\);/);
});

test("bindHost meneruskan updateTaskExt (PUT ext_patch), patchTaskExt (TF.taskext.applyPatch), refreshTasks", () => {
  const at = app.indexOf("plugins?.bindHost({");
  const line = app.slice(at, app.indexOf("\n", at));
  assert.ok(line.includes("updateTaskExt: (id, p) => api.put(`/api/tasks/${id}`, { ext_patch: p })"), "updateTaskExt");
  assert.ok(line.includes("patchTaskExt: (id, p) => setTasks(prev => prev.map(t => t.id === id ? { ...t, ext: window.TF.taskext.applyPatch(t.ext, p) } : t))"), "patchTaskExt");
  assert.ok(line.includes("refreshTasks: () => window.__refreshTasks?.()"), "refreshTasks");
});

test("index.html PR 1a-1 bertambah ≤ 35 baris (spec Fase 1 §12)", () => {
  const lines = (html.match(/\n/g) || []).length;
  assert.ok(lines - BASELINE_LINES <= 35, `index.html +${lines - BASELINE_LINES} baris`);
});
