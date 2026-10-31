"use strict";
// Sistem plugin Fase 1 PR 1a-1 (rencana Task 9): slot taskList.views + taskDetail.sections, tombol view dari
// index.json tanpa memuat kode plugin (viewsFor/useViews), TF.SlotView, TF.PluginIcon, aturan contributes/taskExt.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const React = require("../../static/vendor/react.production.min.js");
globalThis.React = React;
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;
after(() => { delete globalThis.React; });

const ROOT = path.join(__dirname, "..", "..");
const DEMO = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/plugins/demo-ext/manifest.json"), "utf8"));
const DEMO_MANIFEST = (() => { const m = Object.assign({}, DEMO); delete m.parts; return m; })();
const HH_MANIFEST = { id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", minApi: 1, slots: ["dashboard.widgets"], permissions: [] };

function indexWith(opts) {
  const o = opts || {};
  const demo = Object.assign({}, DEMO_MANIFEST, { defaultEnabled: o.demoOn !== false, files: ["plugin.js"], hash: "d1" }, o.demo || {});
  const hh = Object.assign({}, HH_MANIFEST, { description: "", defaultEnabled: true, files: ["plugin.js"], hash: "h1" });
  return { v: 1, plugins: [demo, hh].concat(o.extra || []) };
}

// Dispatcher hooks dengan status antar-render (useMemo/useState/useEffect berdeps) agar identitas memo teruji.
function harness() {
  const D = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const slots = [];
  return function render(Comp, props) {
    let i = 0;
    const effects = [];
    const changed = (old, deps) => !old || !deps || deps.length !== old.length || deps.some((d, j) => !Object.is(d, old[j]));
    const disp = {
      useReducer: (r, init) => { const k = i++; if (!(k in slots)) slots[k] = init; return [slots[k], (a) => { slots[k] = r(slots[k], a); }]; },
      useState: (init) => {
        const k = i++;
        if (!(k in slots)) slots[k] = typeof init === "function" ? init() : init;
        return [slots[k], (v) => { slots[k] = typeof v === "function" ? v(slots[k]) : v; }];
      },
      useEffect: (fn, deps) => { const k = i++; if (changed(slots[k] && slots[k].deps, deps)) effects.push(fn); slots[k] = { deps }; },
      useLayoutEffect: (fn, deps) => disp.useEffect(fn, deps),
      useMemo: (fn, deps) => {
        const k = i++;
        const old = slots[k];
        if (old && !changed(old.deps, deps)) return old.v;
        const v = fn();
        slots[k] = { v, deps };
        return v;
      },
      useCallback: (fn, deps) => disp.useMemo(() => fn, deps),
      useRef: (v) => { const k = i++; if (!(k in slots)) slots[k] = { current: v }; return slots[k]; },
    };
    const prev = D.current;
    D.current = disp;
    try {
      const tree = Comp(props);
      return { tree, runEffects: () => effects.map((fn) => fn()) };
    } finally {
      D.current = prev;
    }
  };
}

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props && node.props.children);
}
function findType(node, type) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const f = findType(n, type); if (f) return f; } return null; }
  if (node.type === type) return node;
  return findType(node.props && node.props.children, type);
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));

function Board() { return null; }
function Note() { return null; }
const demoFactory = () => ({ slots: { "taskList.views": [{ id: "board", component: Board }], "taskDetail.sections": [{ id: "note", component: Note }] } });

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
});

async function init(opts) {
  await P.init({ fetchIndex: () => Promise.resolve(indexWith(opts)) });
}

test("pageKindOf: proj_x → project, slist_3 → workspace, inbox/today → null", () => {
  assert.equal(P.pageKindOf("proj_x"), "project");
  assert.equal(P.pageKindOf("proj_Kantor Baru"), "project");
  assert.equal(P.pageKindOf("slist_3"), "workspace");
  for (const p of ["inbox", "today", "dashboard", "", null, undefined, 5, "project"]) assert.equal(P.pageKindOf(p), null, String(p));
});

test("viewsFor: hanya plugin ON, sesuai pages; Inbox (null) kosong; tanpa memuat kode plugin (inject tidak dipanggil)", async () => {
  await init();
  const injected = [];
  P._setDefaultInject((url) => { injected.push(url); return Promise.resolve(); });
  const want = [{ pluginId: "demo-ext", id: "board", label: "Demo", icon: { path: "M2 4h12M2 8h12M2 12h8" } }];
  assert.deepEqual(P.viewsFor("project"), want);
  assert.deepEqual(P.viewsFor("workspace"), want);
  assert.deepEqual(P.viewsFor(null), []);
  assert.deepEqual(P.viewsFor("inbox"), []);
  await tick(5);
  assert.deepEqual(injected, []);
  P._setDefaultInject(null);
});

test("viewsFor: pages per item, urut pluginId lalu urutan manifest", async () => {
  const other = Object.assign({}, DEMO_MANIFEST, {
    id: "alpha-view", name: "Alpha", defaultEnabled: true, files: ["plugin.js"], hash: "a1",
    contributes: { "taskList.views": [
      { id: "z", label: "Zeta", icon: { path: "M1 1h2" }, pages: ["workspace"] },
      { id: "a", label: "Alfa", icon: { path: "M1 1h2" }, pages: ["project", "workspace"] },
    ] },
  });
  await init({ extra: [other] });
  assert.deepEqual(P.viewsFor("workspace").map((v) => v.pluginId + ":" + v.id), ["alpha-view:z", "alpha-view:a", "demo-ext:board"]);
  assert.deepEqual(P.viewsFor("project").map((v) => v.pluginId + ":" + v.id), ["alpha-view:a", "demo-ext:board"]);
});

test("viewsFor: item tak valid (icon.path '<script', pages asing) dilewati; slot tidak di slots dilewati", async () => {
  await init({ demo: { contributes: { "taskList.views": [
    { id: "bad", label: "Bad", icon: { path: "M0 0<script>" }, pages: ["project"] },
    { id: "alien", label: "Alien", icon: { path: "M0 0h1" }, pages: ["inbox"] },
    { id: "ok", label: "Oke", icon: { path: "M0 0h1" }, pages: ["project"] },
  ] } } });
  assert.deepEqual(P.viewsFor("project").map((v) => v.id), ["ok"]);
  P._reset();
  await init({ demo: { slots: ["taskDetail.sections"] } });
  assert.deepEqual(P.viewsFor("project"), []);
});

test("viewsFor: plugin diredam / OFF → tidak ada tombol", async () => {
  await init({ demoOn: false });
  assert.deepEqual(P.viewsFor("project"), []);
  P._reset();
  await init();
  assert.equal(P.viewsFor("project").length, 1);
  P.markFailed("demo-ext", "manifest", new Error("rusak"));
  assert.equal(P.isEnabled("demo-ext"), false);
  assert.deepEqual(P.viewsFor("project"), []);
  await tick(10);
});

test("useViews: hook mengembalikan viewsFor (identitas tetap sampai event plugins.*)", async () => {
  await init();
  const render = harness();
  const a = render(P.useViews, "project");
  const b = render(P.useViews, "project");
  assert.deepEqual(a.tree.map((v) => v.id), ["board"]);
  assert.equal(a.tree, b.tree);
  const offs = a.runEffects();
  RT.events.emit("plugins.changed", { id: "demo-ext", enabled: true });
  const c = render(P.useViews, "project");
  assert.notEqual(c.tree, a.tree);
  assert.deepEqual(render(P.useViews, null).tree, []);
  offs.forEach((off) => typeof off === "function" && off());
});

test("SlotView: sebelum load → Memuat Demo…; effect memanggil load sekali", async () => {
  await init();
  const injected = [];
  P._setDefaultInject((url) => { injected.push(url); return Promise.resolve(); });
  const render = harness();
  const props = { name: "taskList.views", pluginId: "demo-ext", viewId: "board", label: "Demo", context: { tasks: [] }, onFallback: () => {} };
  const r1 = render(RT.SlotView, props);
  assert.equal(r1.tree.props.role, "status");
  assert.equal(textOf(r1.tree), "Memuat Demo…");
  r1.runEffects();
  const r2 = render(RT.SlotView, props);
  r2.runEffects();
  await tick(5);
  assert.deepEqual(injected, ["/static/plugins/demo-ext/plugin.js?v=d1"]);
  assert.equal(RT.SlotView, RT.plugins.SlotView);
  P._setDefaultInject(null);
});

test("register → komponen dalam PluginBoundary dengan context beku, identitas context sama untuk props context yang sama", async () => {
  await init();
  P._setDefaultInject(() => { P.register(DEMO_MANIFEST, demoFactory); return Promise.resolve(); });
  const render = harness();
  const ctx = { tasks: [{ id: 1, title: "a" }] };
  const props = { name: "taskList.views", pluginId: "demo-ext", viewId: "board", label: "Demo", context: ctx, onFallback: () => {} };
  render(RT.SlotView, props).runEffects();
  await tick(5);
  const r = render(RT.SlotView, props);
  assert.equal(r.tree.type, "div");
  assert.equal(r.tree.props.className, "tf-plugin-view");
  assert.equal(r.tree.props["data-plugin-view"], "demo-ext:board");
  const boundary = React.Children.toArray(r.tree.props.children)[0];
  assert.equal(boundary.type, P.PluginBoundary);
  assert.equal(boundary.props.pluginId, "demo-ext");
  const inner = boundary.props.children;
  assert.equal(inner.type, Board);
  assert.ok(Object.isFrozen(inner.props.context));
  assert.notEqual(inner.props.context, ctx);
  assert.deepEqual(inner.props.context.tasks, ctx.tasks);
  assert.equal(inner.props.api.id, "demo-ext");
  const again = render(RT.SlotView, Object.assign({}, props));
  assert.equal(React.Children.toArray(again.tree.props.children)[0].props.children.props.context, inner.props.context, "context sama → objek beku sama");
  const changed = render(RT.SlotView, Object.assign({}, props, { context: { tasks: [] } }));
  assert.notEqual(React.Children.toArray(changed.tree.props.children)[0].props.children.props.context, inner.props.context);
  P._setDefaultInject(null);
});

test("load gagal → Demo tidak bisa dimuat + Kembali ke Normal memanggil onFallback", async () => {
  await init();
  P._setDefaultInject(() => Promise.reject(new Error("404")));
  const render = harness();
  let fallback = 0;
  const props = { name: "taskList.views", pluginId: "demo-ext", viewId: "board", label: "Demo", context: {}, onFallback: () => { fallback++; } };
  render(RT.SlotView, props).runEffects();
  await tick(5);
  const r = render(RT.SlotView, props);
  assert.match(textOf(r.tree), /Demo tidak bisa dimuat/);
  const btn = findType(r.tree, "button");
  assert.ok(btn);
  assert.equal(btn.props.type, "button");
  assert.equal(textOf(btn), "Kembali ke Normal");
  btn.props.onClick();
  assert.equal(fallback, 1);
  P._setDefaultInject(null);
});

test("register tanpa view board → tidak bisa dimuat", async () => {
  await init();
  P._setDefaultInject(() => { P.register(DEMO_MANIFEST, () => ({ slots: { "taskDetail.sections": [{ id: "note", component: Note }] } })); return Promise.resolve(); });
  const render = harness();
  const props = { name: "taskList.views", pluginId: "demo-ext", viewId: "board", label: "Demo", context: {}, onFallback: () => {} };
  render(RT.SlotView, props).runEffects();
  await tick(5);
  assert.match(textOf(render(RT.SlotView, props).tree), /Demo tidak bisa dimuat/);
  P._setDefaultInject(null);
});

test("SlotView: plugin OFF → null", async () => {
  await init({ demoOn: false });
  const render = harness();
  const r = render(RT.SlotView, { name: "taskList.views", pluginId: "demo-ext", viewId: "board", label: "Demo", context: {}, onFallback: () => {} });
  assert.equal(r.tree, null);
});

test("Slot taskDetail.sections → wadah td-plugin-sections; tanpa kontribusi → null", async () => {
  await init();
  const render = harness();
  assert.equal(render(RT.Slot, { name: "taskDetail.sections", context: { task: { id: 1 } } }).tree, null);
  P.register(DEMO_MANIFEST, demoFactory);
  const r = harness()(RT.Slot, { name: "taskDetail.sections", context: { task: { id: 1 } } });
  assert.equal(r.tree.props.className, "td-plugin-sections");
  assert.equal(r.tree.props["data-plugin-slot"], "taskDetail.sections");
  const kids = React.Children.toArray(r.tree.props.children);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].props.children.type, Note);
  // view taskList.views tidak pernah tampil lewat Slot dasbor
  assert.equal(P.contributions("dashboard.widgets").length, 0);
});

test("PluginIcon: svg 16×16 stroke currentColor, aria-hidden; path tidak sah → null", () => {
  const el = RT.PluginIcon({ path: "M2 4h12" });
  assert.equal(el.type, "svg");
  assert.equal(el.props.viewBox, "0 0 16 16");
  assert.equal(el.props.width, 16);
  assert.equal(el.props.stroke, "currentColor");
  assert.equal(el.props.fill, "none");
  assert.equal(el.props["aria-hidden"], "true");
  assert.equal(el.props.children.type, "path");
  assert.equal(el.props.children.props.d, "M2 4h12");
  assert.equal(RT.PluginIcon({ path: "M2 4h12", size: 20 }).props.width, 20);
  assert.equal(RT.PluginIcon({ path: "M0 0<script>" }), null);
  assert.equal(RT.PluginIcon({}), null);
});

test("validateManifest: contributes/taskExt salah → alasan; task.ext kini izin dikenal", async () => {
  await init();
  const idx = indexWith();
  assert.deepEqual(P.validateManifest(DEMO_MANIFEST, idx), { ok: true, reason: null });
  const bad = [
    { contributes: { "taskList.views": [{ id: "board", label: "Demo", icon: { path: "<" }, pages: ["project"] }] } },
    { contributes: { "taskList.views": [{ id: "board", label: "Demo", icon: { path: "M1 1" }, pages: [] }] } },
    { contributes: { "dashboard.widgets": [] } },
    { slots: ["taskList.views"] },
    { permissions: [] },
    { taskExt: undefined },
    { taskExt: { keys: ["x-y"] } },
  ];
  for (const extra of bad) {
    const m = Object.assign({}, DEMO_MANIFEST, extra);
    if ("taskExt" in extra && extra.taskExt === undefined) delete m.taskExt;
    const v = P.validateManifest(m, idx);
    assert.equal(v.ok, false, JSON.stringify(extra));
    assert.equal(typeof v.reason, "string");
  }
});

test("aturan contributes/taskExt runtime = compile.js (vektor sama)", () => {
  const build = require(path.join(ROOT, "compile.js"));
  const view = (o) => Object.assign({ id: "board", label: "Demo", icon: { path: "M2 4h12" }, pages: ["project"] }, o);
  const cases = [
    {},
    { contributes: { "taskList.views": [view({ pages: [] })] } },
    { contributes: { "taskList.views": [view({ pages: ["inbox"] })] } },
    { contributes: { "taskList.views": [view({ pages: ["project", "project"] })] } },
    { contributes: { "taskList.views": [view({ icon: { path: "M2 4<script>" } })] } },
    { contributes: { "taskList.views": [view({ icon: { path: "M" + "1 ".repeat(1100) } })] } },
    { contributes: { "taskList.views": [view(), view()] } },
    { contributes: { "taskList.views": [view({ label: "x".repeat(41) })] } },
    { contributes: { "taskList.views": [view({ label: "x".repeat(40) })] } },
    { contributes: { "taskDetail.sections": [{ id: "note", label: "x", order: "1" }] } },
    { contributes: { "taskDetail.sections": [{ id: "note", label: "x" }] } },
    { contributes: [] },
    { taskExt: { keys: [] } },
    { taskExt: { keys: ["a", "a"] } },
    { permissions: [], taskExt: { keys: ["a"] } },
  ];
  for (const extra of cases) {
    const m = Object.assign({}, DEMO_MANIFEST, extra);
    const compileOk = build.validateContributes(m) === null && build.validateTaskExt(m) === null;
    const runtimeOk = P.validateManifest(m).ok;
    assert.equal(runtimeOk, compileOk, JSON.stringify(extra).slice(0, 100));
  }
});
