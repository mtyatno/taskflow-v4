"use strict";
// Dashboard welcome vs sinkron awal (spec 2026-10-20 §4.3–4.5): keputusan murni, penanda _meta, data lokal.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { metaGet } = require("../../static/offline/meta.js");
const {
  MARKER_KEY, decideIntro, hasLocalData, hasLocalTasks, readInitialSync, markInitialSync, currentUserId,
} = require("../../static/offline/introgate.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

const base = { hasData: false, initialSyncDone: false, online: true, syncRunning: false, lastSyncFailed: false };

test("decideIntro: hasData menang atas semua", () => {
  assert.equal(decideIntro({ hasData: true, initialSyncDone: false, online: false, syncRunning: true, lastSyncFailed: true }), "dashboard");
});
test("decideIntro: penanda ada → welcome, juga offline", () => {
  assert.equal(decideIntro({ ...base, initialSyncDone: true, online: false }), "welcome");
});
test("decideIntro: tanpa penanda + offline → offline_empty (walau lastSyncFailed)", () => {
  assert.equal(decideIntro({ ...base, online: false, lastSyncFailed: true }), "offline_empty");
});
test("decideIntro: online + syncRunning → syncing (walau lastSyncFailed)", () => {
  assert.equal(decideIntro({ ...base, syncRunning: true, lastSyncFailed: true }), "syncing");
});
test("decideIntro: online, tidak berjalan, gagal → sync_error", () => {
  assert.equal(decideIntro({ ...base, lastSyncFailed: true }), "sync_error");
});
test("decideIntro: online, belum mulai → syncing", () => {
  assert.equal(decideIntro({ ...base }), "syncing");
});

test("hasLocalData: kosong → false", async () => {
  assert.equal(await hasLocalData(), false);
});
test("hasLocalData: hanya task deleted:true → false", async () => {
  await put("tasks", [{ cid: "t1", deleted: true }]);
  await put("scratchpad_notes", [{ cid: "n1", deleted: true }]);
  assert.equal(await hasLocalData(), false);
});
test("hasLocalData: note saja (deleted:false) → true", async () => {
  await put("scratchpad_notes", [{ cid: "n1", deleted: false }]);
  assert.equal(await hasLocalData(), true);
});
test("hasLocalData: task saja → true", async () => {
  await put("tasks", [{ cid: "t0", deleted: true }, { cid: "t1", deleted: false }]);
  assert.equal(await hasLocalData(), true);
});

test("hasLocalTasks: kosong → false", async () => {
  assert.equal(await hasLocalTasks(), false);
});
test("hasLocalTasks: hanya task deleted:true → false", async () => {
  await put("tasks", [{ cid: "t1", deleted: true }]);
  assert.equal(await hasLocalTasks(), false);
});
test("hasLocalTasks: note saja → false (note tidak masuk state App)", async () => {
  await put("scratchpad_notes", [{ cid: "n1", deleted: false }]);
  assert.equal(await hasLocalTasks(), false);
});
test("hasLocalTasks: ada task hidup → true", async () => {
  await put("tasks", [{ cid: "t0", deleted: true }, { cid: "t1", deleted: false }]);
  assert.equal(await hasLocalTasks(), true);
});

test("readInitialSync: belum ada → false", async () => {
  assert.equal(await readInitialSync("7"), false);
});
test("markInitialSync lalu readInitialSync: user sama true, akun lain false, null false", async () => {
  await markInitialSync("7");
  assert.equal(await readInitialSync("7"), true);
  assert.equal(await readInitialSync(7), true);
  assert.equal(await readInitialSync("8"), false);
  assert.equal(await readInitialSync(null), false);
});
test("markInitialSync menyimpan {user_id, at ISO}", async () => {
  await markInitialSync("7");
  const m = await metaGet(MARKER_KEY);
  assert.equal(MARKER_KEY, "initial_sync:v1");
  assert.equal(m.user_id, "7");
  assert.equal(typeof m.at, "string");
  assert.ok(!Number.isNaN(Date.parse(m.at)));
});
test("markInitialSync: userId null → no-op", async () => {
  await markInitialSync(null);
  assert.equal(await metaGet(MARKER_KEY), undefined);
});
test("currentUserId: tanpa localStorage → null", () => {
  assert.equal(currentUserId(), null);
});
