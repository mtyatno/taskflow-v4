"use strict";
// Sistem plugin Fase 0a — fasad TF.api v1: data, ui, env, log (spec §4.7).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset: resetDB, openDB } = require("../../static/offline/db.js");
const RT = require("../../static/plugin-runtime.js");
const P = RT.plugins;

const INDEX = { v: 1, plugins: [{ id: "habit-heatmap", name: "Heatmap Habit", version: "1.0.0", permissions: ["storage"], defaultEnabled: true, files: ["plugin.js"], hash: "1" }] };

beforeEach(async () => {
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
});

async function seed(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function habit(over) {
  return Object.assign({ server_id: null, title: over.cid, phase: "pagi", micro_target: "", frequency: "[]", identity_pillar: "", deleted: false }, over);
}

test("apiVersion 1; for(id) stabil dan beku", () => {
  assert.equal(RT.api.apiVersion, 1);
  const a = RT.api.for("habit-heatmap");
  assert.equal(a, RT.api.for("habit-heatmap"));
  assert.ok(Object.isFrozen(a));
  for (const k of ["events", "storage", "data", "ui", "env", "log"]) assert.ok(a[k], k);
  assert.equal(a.fetch, undefined);
});

test("data.habits.list dan logs menyaring rentang, log terhapus, dan habit terhapus", async () => {
  await seed("habits", [habit({ cid: "h1", server_id: 10 }), habit({ cid: "h2" }), habit({ cid: "h3", deleted: true })]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "h1", date: "2026-10-01", status: "done" },
    { cid: "l2", habit_cid: "h1", date: "2026-10-15", status: "done" },
    { cid: "l3", habit_cid: "h2", date: "2026-10-31", status: "skipped" },
    { cid: "l4", habit_cid: "h2", date: "2026-11-01", status: "done" },
    { cid: "l5", habit_cid: "h3", date: "2026-10-10", status: "done" },
    { cid: "l6", habit_cid: "h1", date: "2026-10-20", status: "done", deleted: true },
    { cid: "l7", habit_cid: "h1", date: "2026-09-30", status: "done" },
  ]);
  const d = RT.api.for("habit-heatmap").data;
  const habits = await d.habits.list();
  assert.deepEqual(habits.map((h) => h.id).sort(), [10, "h2"].sort());
  const logs = await d.habits.logs({ from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(logs.map((l) => l.cid).sort(), ["l1", "l2", "l3"]);
  const l1 = logs.find((l) => l.cid === "l1");
  assert.equal(l1.habitId, 10);
  assert.equal(l1.status, "done");
  assert.equal(l1.date, "2026-10-01");
  assert.equal(logs.find((l) => l.cid === "l3").habitId, "h2");
  const all = await d.habits.logs({});
  assert.equal(all.length, 5);
});

test("data.tasks.list lewat router lokal: includeDone dan since", async () => {
  const base = { list_id: null, parent_cid: null, priority: "P2", quadrant: "Q2", project: "", context: "", deadline: null, deleted: false, title: "t" };
  await seed("tasks", [
    Object.assign({}, base, { cid: "t1", server_id: 1, gtd_status: "next", updated_at: "2026-10-01T00:00:00Z" }),
    Object.assign({}, base, { cid: "t2", server_id: 2, gtd_status: "done", completed_at: "2026-10-30T05:00:00Z", updated_at: "2026-10-30T05:00:00Z" }),
    Object.assign({}, base, { cid: "t3", gtd_status: "done", completed_at: "2026-09-01T05:00:00Z", updated_at: "2026-09-01T05:00:00Z" }),
    Object.assign({}, base, { cid: "t4", gtd_status: "next", deleted: true }),
  ]);
  const d = RT.api.for("habit-heatmap").data;
  const active = await d.tasks.list();
  assert.deepEqual(active.map((t) => t.id), [1]);
  const all = await d.tasks.list({ includeDone: true });
  assert.deepEqual(all.map((t) => t.id).sort(), [1, 2, "t3"].sort());
  const recent = await d.tasks.list({ includeDone: true, since: "2026-10-15T00:00:00+07:00" });
  assert.deepEqual(recent.map((t) => t.id), [2]);
});

test("ui: lewat bindHost; navigate hanya halaman inti", () => {
  const calls = [];
  P.bindHost({ toast: (m, t) => calls.push(["toast", m, t]), openTask: (id) => calls.push(["open", id]), navigate: (p) => calls.push(["nav", p]) });
  const ui = RT.api.for("habit-heatmap").ui;
  ui.toast("Halo", "success");
  ui.openTask(12);
  for (const p of ["dashboard", "focus", "inbox", "settings"]) ui.navigate(p);
  assert.throws(() => ui.navigate("admin"), (e) => e.name === "PluginPermissionError");
  assert.deepEqual(calls, [["toast", "Halo", "success"], ["open", 12], ["nav", "dashboard"], ["nav", "focus"], ["nav", "inbox"], ["nav", "settings"],
    ["toast", "Plugin Heatmap Habit mengalami error", "error"]]); // pelanggaran izin dihitung sebagai error (§8)
  assert.equal(P.failures("habit-heatmap")[0].kind, "permission");
  assert.equal(ui.sanitize("<img src=x onerror=alert(1)><mark>ok</mark>").indexOf("<img"), -1);
  assert.ok(ui.sanitize("<mark>ok</mark>").includes("<mark>ok</mark>")); // allowlist safehtml (br/details/summary/mark)
});

test("env: online, platform, theme, today, userId", () => {
  const env = RT.api.for("habit-heatmap").env;
  assert.equal(typeof env.online, "boolean");
  assert.equal(env.platform, "web");
  globalThis.__TAURI__ = {};
  try { assert.equal(env.platform, "tauri"); } finally { delete globalThis.__TAURI__; }
  assert.deepEqual(env.theme, { palette: "default", mode: "light" });
  const prevDoc = globalThis.document;
  globalThis.document = { documentElement: { getAttribute: (n) => ({ "data-palette": "sakura", "data-theme": "dark" })[n] } };
  try { assert.deepEqual(env.theme, { palette: "sakura", mode: "dark" }); } finally { globalThis.document = prevDoc; }
  assert.match(env.today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(env.today(), RT.jktDate(Date.now()));
  P.bindHost({ userId: () => "42" });
  assert.equal(env.userId, "42");
});

test("log berprefiks [plugin:<id>]", () => {
  const orig = console.info;
  const got = [];
  console.info = (...a) => got.push(a);
  try { RT.api.for("habit-heatmap").log.info("halo", 1); } finally { console.info = orig; }
  assert.deepEqual(got, [["[plugin:habit-heatmap]", "halo", 1]]);
});
