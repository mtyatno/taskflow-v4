"use strict";
// Sistem plugin Fase 0a — registry, manifest, status ON/OFF per perangkat (spec §4.3, §4.4).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const INDEX = {
  v: 1,
  plugins: [
    { id: "habit-heatmap", name: "Heatmap Habit", description: "d", version: "1.0.0", permissions: ["storage"], defaultEnabled: false, files: ["plugin.js"], hash: "abcd1234" },
    { id: "zeta-widget", name: "Zeta", description: "z", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "ffff0000" },
    { id: "alpha-widget", name: "Alpha", description: "a", version: "1.0.0", permissions: [], defaultEnabled: true, files: ["plugin.js"], hash: "00001111" },
  ],
};

function manifest(over) {
  return Object.assign({ id: "habit-heatmap", name: "Heatmap Habit", description: "d", version: "1.0.0", minApi: 1, slots: ["dashboard.widgets"], permissions: ["storage"], defaultEnabled: false, builtin: true }, over);
}
const comp = () => null;

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
});

async function init(index) {
  await P.init({ fetchIndex: () => Promise.resolve(index || INDEX) });
}

test("konstanta slot dan izin", () => {
  assert.deepEqual(P.KNOWN_SLOTS, ["dashboard.widgets"]);
  assert.deepEqual(P.KNOWN_PERMISSIONS, ["storage"]);
  for (const p of ["network", "task.ext", "records", "settings.project", "notifications", "location", "secrets", "noteBlocks", "bot", "timerHooks"]) {
    assert.ok(P.RESERVED_PERMISSIONS.includes(p), p);
  }
});

test("validateManifest: valid → ok; tiap pelanggaran → alasan berbeda", () => {
  assert.deepEqual(P.validateManifest(manifest(), INDEX), { ok: true, reason: null });
  const bad = [
    manifest({ id: "Bad_Id" }),
    manifest({ version: "1" }),
    manifest({ minApi: 2 }),
    manifest({ slots: ["x.y"] }),
    manifest({ permissions: ["network"] }),
    manifest({ permissions: ["kamera"] }),
    manifest({ id: "not-listed" }),
  ];
  const reasons = bad.map((m) => {
    const r = P.validateManifest(m, INDEX);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.reason, "string");
    return r.reason;
  });
  assert.equal(new Set(reasons).size, reasons.length, reasons.join(" | "));
});

test("init: membaca index, list() memakai defaultEnabled bila belum ada status", async () => {
  await init();
  const rows = P.list();
  assert.deepEqual(rows.map((r) => r.id), ["habit-heatmap", "zeta-widget", "alpha-widget"]);
  const hh = rows[0];
  assert.deepEqual(hh, { id: "habit-heatmap", name: "Heatmap Habit", description: "d", version: "1.0.0", permissions: ["storage"], enabled: false, loaded: false, failed: null });
  assert.equal(P.isEnabled("zeta-widget"), true);
  assert.equal(P.isEnabled("nope"), false);
  assert.deepEqual(await metaGet("plugins:index:v1"), INDEX);
});

test("init: fetch gagal → fallback index di _meta; status tersimpan dipakai", async () => {
  await metaSet("plugins:index:v1", INDEX);
  await metaSet("plugins:state:v1", { "habit-heatmap": { enabled: true, updatedAt: "2026-10-30T00:00:00.000Z" } });
  await P.init({ fetchIndex: () => Promise.reject(new Error("offline")) });
  assert.equal(P.list().length, 3);
  assert.equal(P.isEnabled("habit-heatmap"), true);
});

test("register untuk id yang tidak ada di index → diabaikan", async () => {
  await init();
  let called = 0;
  P.register(manifest({ id: "rogue-plugin" }), () => { called++; return {}; });
  assert.equal(called, 0);
  assert.equal(P.list().find((r) => r.id === "rogue-plugin"), undefined);
});

test("register untuk id OFF → factory tidak dipanggil; setEnabled ON + load → dipanggil", async () => {
  await init();
  let called = 0;
  P.register(manifest(), () => { called++; return { slots: { "dashboard.widgets": [{ id: "grid", order: 1, component: comp }] } }; });
  assert.equal(called, 0);
  assert.deepEqual(P.contributions("dashboard.widgets"), []);
  await P.setEnabled("habit-heatmap", true);
  assert.equal(await P.load("habit-heatmap"), true);
  assert.equal(called, 1);
  assert.equal(P.contributions("dashboard.widgets").length, 1);
  assert.equal(P.list()[0].loaded, true);
});

test("contributions urut order lalu pluginId", async () => {
  await init();
  P.register(manifest({ id: "zeta-widget", permissions: [] }), () => ({ slots: { "dashboard.widgets": [{ id: "z", order: 5, component: comp }] } }));
  P.register(manifest({ id: "alpha-widget", permissions: [] }), () => ({ slots: { "dashboard.widgets": [{ id: "a2", order: 5, component: comp }, { id: "a1", order: 1, component: comp }] } }));
  const list = P.contributions("dashboard.widgets");
  assert.deepEqual(list.map((c) => c.pluginId + "/" + c.id), ["alpha-widget/a1", "alpha-widget/a2", "zeta-widget/z"]);
  assert.equal(list[0].component, comp);
  assert.equal(list[0].order, 1);
  assert.deepEqual(P.contributions("x.y"), []);
});

test("setEnabled menulis _meta plugins:state:v1 dan memancarkan plugins.changed", async () => {
  await init();
  const seen = [];
  const off = RT.events.on("plugins.changed", (p) => seen.push(p));
  await P.setEnabled("habit-heatmap", true);
  off();
  const st = await metaGet("plugins:state:v1");
  assert.equal(st["habit-heatmap"].enabled, true);
  assert.match(st["habit-heatmap"].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(seen, [{ id: "habit-heatmap", enabled: true }]);
  assert.equal(P.isEnabled("habit-heatmap"), true);
  await assert.rejects(P.setEnabled("nope", true));
});

test("OFF memanggil onDisable dan menghapus kontribusi; ON lagi memanggil factory lagi", async () => {
  await init();
  let disabled = 0, enabled = 0, made = 0;
  P.register(manifest({ id: "zeta-widget", permissions: [] }), () => {
    made++;
    return { onEnable() { enabled++; }, onDisable() { disabled++; }, slots: { "dashboard.widgets": [{ id: "z", order: 1, component: comp }] } };
  });
  assert.equal(made, 1);
  assert.equal(enabled, 1);
  assert.equal(P.contributions("dashboard.widgets").length, 1);
  await P.setEnabled("zeta-widget", false);
  assert.equal(disabled, 1);
  assert.deepEqual(P.contributions("dashboard.widgets"), []);
  await P.setEnabled("zeta-widget", true);
  assert.equal(made, 2);
  assert.equal(P.contributions("dashboard.widgets").length, 1);
});

test("kontribusi untuk slot yang tidak dideklarasikan manifest diabaikan", async () => {
  await init();
  P.register(manifest({ id: "zeta-widget", permissions: [], slots: [] }), () => ({ slots: { "dashboard.widgets": [{ id: "z", component: comp }] } }));
  assert.deepEqual(P.contributions("dashboard.widgets"), []);
});
