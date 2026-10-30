"use strict";
// Sistem plugin Fase 0a — TF.Slot dan PluginBoundary (spec §4.5, K13).
// Tanpa react-dom/server: React UMD vendor + dispatcher hooks palsu untuk memanggil Slot langsung,
// lalu memeriksa pohon elemen yang dikembalikan; lifecycle PluginBoundary dipanggil langsung.
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const React = require("../../static/vendor/react.production.min.js");
globalThis.React = React;
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;
after(() => { delete globalThis.React; });

const INDEX = {
  v: 1,
  plugins: [
    { id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "1", slots: ["dashboard.widgets"] },
    { id: "other-plugin", name: "Other", version: "1.0.0", permissions: [], defaultEnabled: false, files: ["plugin.js"], hash: "2", slots: ["dashboard.widgets"] },
  ],
};
const MANIFEST = { id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", minApi: 1, slots: ["dashboard.widgets"], permissions: [] };
function Grid() { return null; }

// Dispatcher hooks minimal: useReducer/useState/useEffect/useRef/useMemo/useCallback.
function renderWithHooks(Comp, props) {
  const D = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const effects = [];
  const prev = D.current;
  D.current = {
    useReducer: (r, init) => [init, () => {}],
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useEffect: (fn) => effects.push(fn),
    useLayoutEffect: (fn) => effects.push(fn),
    useRef: (v) => ({ current: v }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  };
  try {
    return { tree: Comp(props), effects };
  } finally {
    D.current = prev;
  }
}

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
});

test("sebelum init selesai → null", () => {
  const { tree } = renderWithHooks(RT.Slot, { name: "dashboard.widgets", context: {} });
  assert.equal(tree, null);
});

test("tanpa kontribusi → null (tanpa wadah); effect memicu load plugin ON yang menyumbang slot", async () => {
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  const injected = [];
  P._setDefaultInject((url, kind) => { injected.push(url); return Promise.resolve(); });
  const { tree, effects } = renderWithHooks(RT.Slot, { name: "dashboard.widgets", context: {} });
  assert.equal(tree, null);
  const cleanups = effects.map((fn) => fn());
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(injected, ["/static/plugins/habit-heatmap/plugin.js?v=1"]); // other-plugin OFF → tidak diminta
  cleanups.forEach((c) => typeof c === "function" && c());
  P._setDefaultInject(null);
});

test("kontribusi dibungkus PluginBoundary dalam wadah; context dibekukan; api plugin diteruskan", async () => {
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.register(MANIFEST, () => ({ slots: { "dashboard.widgets": [{ id: "grid", order: 1, component: Grid }] } }));
  const ctx = { user: { id: 1, username: "u" } };
  const { tree } = renderWithHooks(RT.Slot, { name: "dashboard.widgets", context: ctx });
  assert.equal(tree.type, "div");
  assert.equal(tree.props["data-plugin-slot"], "dashboard.widgets");
  assert.match(tree.props.className, /dash-plugins/);
  const kids = React.Children.toArray(tree.props.children);
  assert.equal(kids.length, 1);
  const b = kids[0];
  assert.equal(b.type, P.PluginBoundary);
  assert.equal(b.props.pluginId, "habit-heatmap");
  const inner = b.props.children;
  assert.equal(inner.type, Grid);
  assert.ok(Object.isFrozen(inner.props.context));
  assert.notEqual(inner.props.context, ctx);
  assert.equal(inner.props.context.user, ctx.user);
  assert.equal(inner.props.api, RT.api.for("habit-heatmap"));
});

test("PluginBoundary: getDerivedStateFromError + componentDidCatch → markFailed(render); render null setelah gagal", async () => {
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  const B = P.PluginBoundary;
  assert.ok(B.prototype instanceof React.Component);
  assert.deepEqual(B.getDerivedStateFromError(new Error("x")), { failed: true });
  const inst = new B({ pluginId: "habit-heatmap", children: "anak" });
  assert.equal(inst.render(), "anak");
  inst.componentDidCatch(new Error("render rusak"), {});
  assert.equal(P.failures("habit-heatmap")[0].kind, "render");
  inst.state = { failed: true };
  assert.equal(inst.render(), null);
});

test("_debugThrow: kontribusi berikutnya melempar; dua kali → OFF", async () => {
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.register(MANIFEST, () => ({ slots: { "dashboard.widgets": [{ id: "grid", order: 1, component: Grid }] } }));
  const seen = [];
  RT.events.on("plugins.changed", (p) => seen.push(p.id));
  for (let i = 0; i < 2; i++) {
    P._debugThrow("habit-heatmap");
    const { tree } = renderWithHooks(RT.Slot, { name: "dashboard.widgets", context: {} });
    const b = React.Children.toArray(tree.props.children)[0];
    const Inner = b.props.children.type;
    assert.notEqual(Inner, Grid);
    let caught = null;
    try { Inner(b.props.children.props); } catch (e) { caught = e; }
    assert.ok(caught);
    new P.PluginBoundary(b.props).componentDidCatch(caught, {});
  }
  assert.equal(P.isEnabled("habit-heatmap"), false);
  assert.ok(seen.length >= 2);
  const { tree } = renderWithHooks(RT.Slot, { name: "dashboard.widgets", context: {} });
  assert.equal(tree, null);
});

test("kunci boundary berubah setiap _debugThrow (boundary di-mount ulang)", async () => {
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.register(MANIFEST, () => ({ slots: { "dashboard.widgets": [{ id: "grid", order: 1, component: Grid }] } }));
  const key = () => React.Children.toArray(renderWithHooks(RT.Slot, { name: "dashboard.widgets" }).tree.props.children)[0].key;
  const k1 = key();
  P._debugThrow("habit-heatmap");
  assert.notEqual(key(), k1);
});
