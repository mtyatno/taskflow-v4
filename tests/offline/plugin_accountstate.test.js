"use strict";
// Sistem plugin Fase 0b — runtime memakai status AKUN (TF.pluginstate) ∧ ¬peredaman lokal (spec §6.3; rencana
// PR B Task 9, R13–R14): setEnabled → setLocal, reloadState dari pull, peredaman hanya di perangkat ini,
// "Aktifkan lagi"/hash baru menghapus peredaman, fallback 0a tanpa TF.pluginstate.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const PS = require("../../static/offline/pluginstate.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const HH = "habit-heatmap";
const T0 = "2026-10-20T00:00:00.000Z";
const T1 = "2026-10-30T00:00:00.000Z";
const INDEX = {
  v: 1,
  plugins: [
    { id: HH, name: "Heatmap Habit", description: "d", version: "1.0.0", permissions: ["storage"], defaultEnabled: false, files: ["plugin.js"], hash: "abcd1234" },
    { id: "zeta-widget", name: "Zeta", description: "z", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "ffff0000" },
  ],
};
const manifest = (over) => Object.assign({ id: HH, name: "Heatmap Habit", version: "1.0.0", minApi: 1, slots: ["dashboard.widgets"], permissions: ["storage"] }, over);
const comp = () => null;
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));
const plugOps = () => outboxAll().then((all) => all.filter((o) => o.entity_type === "plugin_state"));
function rawFetch(plugins) {
  return () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ v: 1, server_time: T1, plugins }) });
}
const row = (enabled, at) => ({ enabled, settings: {}, updated_at: at || T1 });
let toasts;

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  toasts = [];
});
async function init() {
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  P.bindHost({ toast: (m, t) => toasts.push([m, t]), userId: 7 });
}

test("setEnabled → setLocal (op plugin_state), isEnabled seketika, plugins.changed; accountEnabled/knownIds", async () => {
  await init();
  assert.deepEqual(P.knownIds(), [HH, "zeta-widget"]);
  assert.equal(P.accountEnabled(HH), false);
  const seen = [];
  const off = RT.events.on("plugins.changed", (p) => seen.push(p));
  const pr = P.setEnabled(HH, true);
  assert.equal(P.isEnabled(HH), true, "seketika (optimistis)");
  await pr;
  off();
  assert.deepEqual(seen, [{ id: HH, enabled: true }]);
  assert.equal(P.accountEnabled(HH), true);
  const ops = await plugOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].cid, HH);
  assert.equal(ops[0].payload.enabled, true);
  assert.equal((await metaGet(PS.STATE_KEY))[HH].enabled, true);
  await tick();
  assert.equal(P.list()[0].pending, true);
});

test("pull mengubah cache → reloadState mengaktifkan/mematikan + plugins.changed", async () => {
  await metaSet(PS.OWNER_KEY, "7");
  await init();
  let made = 0, disabled = 0;
  P.register(manifest(), () => { made++; return { onDisable() { disabled++; }, slots: { "dashboard.widgets": [{ id: "g", component: comp }] } }; });
  assert.equal(made, 0, "OFF: factory belum dipanggil");
  const seen = [];
  RT.events.on("plugins.changed", (p) => seen.push(p));
  await PS.pull(rawFetch({ [HH]: row(true) }), { userId: 7, known: P.knownIds() });
  await tick();
  assert.equal(P.isEnabled(HH), true);
  assert.equal(made, 1, "ON dari pull → activate");
  assert.equal(P.contributions("dashboard.widgets").length, 1);
  assert.deepEqual(seen, [{ id: HH, enabled: true }]);
  await PS.pull(rawFetch({ [HH]: row(false), "zeta-widget": row(false) }), { userId: 7, known: P.knownIds() });
  await tick();
  assert.equal(P.isEnabled(HH), false);
  assert.equal(P.isEnabled("zeta-widget"), false);
  assert.equal(disabled, 1);
  assert.deepEqual(P.contributions("dashboard.widgets"), []);
  assert.deepEqual(seen.slice(1).map((p) => p.id + ":" + p.enabled).sort(), [HH + ":false", "zeta-widget:false"]);
  const changed = await P.reloadState();
  assert.deepEqual(changed, [], "tanpa perubahan → kosong");
});

test("plugin diredam: pull yang mengembalikan ON tidak menyalakannya (tanpa siklus); perangkat lain tidak terpengaruh", async () => {
  await metaSet(PS.OWNER_KEY, "7");
  await metaSet(PS.STATE_KEY, { [HH]: { enabled: true, updatedAt: T0 } });
  await init();
  let made = 0;
  P.register(manifest(), () => { made++; return {}; });
  assert.equal(made, 1);
  P.markFailed(HH, "render", new Error("satu"));
  P.markFailed(HH, "render", new Error("dua"));
  assert.equal(P.isEnabled(HH), false);
  assert.equal(P.accountEnabled(HH), true, "status akun tetap ON");
  assert.equal(P.list()[0].suppressed, "render");
  assert.equal(P.list()[0].enabled, false);
  await tick();
  assert.deepEqual(await plugOps(), [], "tanpa op plugin_state (perangkat lain tidak dimatikan)");
  assert.equal((await PS.suppressed())[HH].hash, "abcd1234");
  await PS.pull(rawFetch({ [HH]: row(true) }), { userId: 7, known: P.knownIds() });
  await tick();
  assert.equal(P.isEnabled(HH), false, "pull ON tidak menyalakan plugin yang diredam");
  assert.equal(made, 1);
  assert.deepEqual(await plugOps(), []);
  // sesi berikutnya tetap diredam
  P._reset();
  await init();
  assert.equal(P.isEnabled(HH), false);
  assert.equal(P.accountEnabled(HH), true);
});

test("Aktifkan lagi (setEnabled true) menghapus peredaman dan menulis setLocal", async () => {
  await metaSet(PS.OWNER_KEY, "7");
  await metaSet(PS.STATE_KEY, { [HH]: { enabled: true, updatedAt: T0 } });
  await init();
  P.register(manifest(), () => { throw new Error("factory rusak"); });
  assert.equal(P.isEnabled(HH), false);
  assert.equal(P.list()[0].suppressed, "factory");
  await tick();
  P.register(manifest(), () => ({}));
  await P.setEnabled(HH, true);
  await tick();
  assert.equal(P.isEnabled(HH), true);
  assert.equal(P.list()[0].suppressed, undefined);
  assert.deepEqual(await PS.suppressed(), {});
  assert.equal((await plugOps()).length, 1);
  assert.equal(P.list()[0].failed, null);
});

test("hash indeks berubah saat init → peredaman dihapus", async () => {
  await metaSet(PS.OWNER_KEY, "7");
  await metaSet(PS.STATE_KEY, { [HH]: { enabled: true, updatedAt: T0 } });
  await PS.suppress(HH, "render", "lama0000");
  await PS.suppress("zeta-widget", "render", "ffff0000");
  await init();
  assert.equal(P.isEnabled(HH), true, "hash berbeda → tidak diredam lagi");
  assert.equal(P.isEnabled("zeta-widget"), false, "hash sama → tetap diredam");
  assert.deepEqual(Object.keys(await PS.suppressed()), ["zeta-widget"]);
});

test("list(): pending true selama ada op, hilang setelah ackPushed; plugins.changed dipancarkan saat pending berubah", async () => {
  await metaSet(PS.OWNER_KEY, "7");
  await init();
  await P.setEnabled(HH, true);
  await tick();
  assert.equal(P.list()[0].pending, true);
  const seen = [];
  RT.events.on("plugins.changed", (p) => seen.push(p));
  const [op] = await plugOps();
  await PS.ackPushed(op.qid, HH, row(true, T0));
  await tick();
  assert.ok(!P.list()[0].pending);
  assert.equal(P.isEnabled(HH), true);
  assert.equal(seen.length, 1, "kartu Pengaturan perlu render ulang");
});

test("bindHost userId berubah → reloadState", async () => {
  await metaSet(PS.OWNER_KEY, "7");
  await init();
  assert.equal(P.isEnabled(HH), false);
  await metaSet(PS.STATE_KEY, { [HH]: { enabled: true, updatedAt: T1 } });
  await metaSet(PS.OWNER_KEY, "8");
  P.bindHost({ toast: () => {}, userId: 7 });
  await tick();
  assert.equal(P.isEnabled(HH), false, "userId sama → tidak dibaca ulang");
  P.bindHost({ toast: () => {}, userId: 8 });
  await tick();
  assert.equal(P.isEnabled(HH), true, "userId berubah → dibaca ulang");
});

test("tanpa TF.pluginstate → perilaku 0a (persistState, OFF otomatis tersimpan di plugins:state:v1)", async () => {
  P._setPluginStateModule(null);
  await init();
  await P.setEnabled(HH, true);
  assert.equal((await metaGet(PS.STATE_KEY))[HH].enabled, true);
  assert.deepEqual(await plugOps(), []);
  P.markFailed(HH, "render", new Error("satu"));
  P.markFailed(HH, "render", new Error("dua"));
  assert.equal(P.isEnabled(HH), false);
  await tick();
  assert.equal((await metaGet(PS.STATE_KEY))[HH].enabled, false);
  assert.equal(await metaGet(PS.SUPPRESSED_KEY), undefined);
  assert.deepEqual(await P.reloadState(), []);
});

test("manifest berizin network valid; izin dicadangkan lain tetap ditolak", async () => {
  await init();
  assert.deepEqual(P.validateManifest(manifest({ permissions: ["network"] }), INDEX), { ok: true, reason: null });
  assert.equal(P.validateManifest(manifest({ permissions: ["records"] }), INDEX).ok, false);
});

test("list() item plugin yang tidak tertunda/diredam berbentuk 0a (tanpa kunci pending/suppressed)", async () => {
  await init();
  const it = P.list()[0];
  assert.equal("pending" in it, false);
  assert.equal("suppressed" in it, false);
});

test("cache milik akun lain (owner ≠ userId ter-bind) diabaikan → default, sampai pull menulis owner yang benar (review PR B)", async () => {
  await metaSet(PS.STATE_KEY, { [HH]: { enabled: true, updatedAt: T1 }, "zeta-widget": { enabled: false, updatedAt: T1 } });
  await metaSet(PS.OWNER_KEY, "7");
  P.bindHost({ toast: () => {}, userId: 9 });
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  assert.equal(P.isEnabled(HH), false, "status ON akun 7 tidak dipakai untuk akun 9");
  assert.equal(P.isEnabled("zeta-widget"), true, "defaultEnabled");
  assert.equal(P.accountEnabled(HH), false);
  // Akun berganti di sesi yang sama (bindHost) → cache akun lama juga diabaikan.
  P.bindHost({ toast: () => {}, userId: 7 });
  await tick();
  assert.equal(P.isEnabled(HH), true, "owner cocok → cache dipakai");
  P.bindHost({ toast: () => {}, userId: 9 });
  await tick();
  assert.equal(P.isEnabled(HH), false);
  // Pull akun 9 (server: HH ON) menulis owner 9 → status server dipakai.
  await PS.pull(rawFetch({ [HH]: row(true) }), { userId: 9, known: [HH, "zeta-widget"] });
  await tick(30);
  assert.equal(await metaGet(PS.OWNER_KEY), "9");
  assert.equal(P.isEnabled(HH), true);
  assert.equal(P.isEnabled("zeta-widget"), true);
});

test("cache tanpa owner (0a) atau tanpa userId ter-bind tetap dipakai (lebur pertama)", async () => {
  await metaSet(PS.STATE_KEY, { [HH]: { enabled: true, updatedAt: T0 } });
  await init();
  assert.equal(P.isEnabled(HH), true, "owner tidak ada");
  P._reset();
  await metaSet(PS.OWNER_KEY, "7");
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  assert.equal(P.isEnabled(HH), true, "userId belum di-bind");
});
