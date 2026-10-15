"use strict";
// Workstream A2 (audit 2026-10-15) T8: penanda occurrence task berulang di-pull & direkonsiliasi
// (dulu tidak pernah di-pull: "selesai" di HP tetap "belum" di desktop).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { markOccurrence, getExceptions } = require("../../static/offline/recurrence.js");
const { reconcileRecurringExceptions, pullRecurringExceptions } = require("../../static/offline/syncpull.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

const NOW = "2026-10-15T08:00:00.000Z";
beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function all(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
function recurringTask(over) {
  return Object.assign({
    cid: "r1", server_id: 10, title: "Daily", gtd_status: "next", created_at: "2026-06-01T00:00:00.000Z",
    recurrence_type: "daily", recurrence_end_date: "2027-01-30", deleted: false, dirty: 0,
  }, over);
}
function httpRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}
const WIN = { from: "2026-08-16", to: "2026-12-14" };

test("reconcile creates local exceptions for server marks (mapped via idmap), dirty 0", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  const r = await reconcileRecurringExceptions({ "10": [{ occurrence_date: "2026-10-14", status: "done" }, { occurrence_date: "2026-10-13", status: "skipped" }] }, WIN);
  assert.equal(r.created, 2);
  const rows = await all("recurring_exceptions");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.task_cid === "r1" && x.dirty === 0));
  const map = await getExceptions("2026-10-01", "2026-10-31");
  assert.deepEqual(map.r1.map((x) => x.status).sort(), ["done", "skipped"]);
});

test("reconcile skips server task ids unknown to idmap (task not pulled yet)", async () => {
  const r = await reconcileRecurringExceptions({ "999": [{ occurrence_date: "2026-10-14", status: "done" }] }, WIN);
  assert.equal(r.unknownTasks, 1);
  assert.equal((await all("recurring_exceptions")).length, 0);
});

test("reconcile: a local entry with a pending mark_occurrence op wins over a different server status", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  const rec = await markOccurrence("r1", "2026-10-14", "skipped", { now: NOW }); // dirty 1 + op
  const r = await reconcileRecurringExceptions({ "10": [{ occurrence_date: "2026-10-14", status: "done" }] }, WIN);
  assert.equal(r.skipped, 1);
  const row = (await all("recurring_exceptions")).find((x) => x.cid === rec.cid);
  assert.equal(row.status, "skipped");
  assert.equal(row.dirty, 1);
  assert.equal((await outboxAll()).length, 1, "op tetap: push yang mengirim status lokal");
});

test("reconcile: a pending local mark whose status equals the server's is confirmed (dirty 0, op dropped)", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  const rec = await markOccurrence("r1", "2026-10-14", "done", { now: NOW });
  const r = await reconcileRecurringExceptions({ "10": [{ occurrence_date: "2026-10-14", status: "done" }] }, WIN);
  assert.equal(r.confirmed, 1);
  const row = (await all("recurring_exceptions")).find((x) => x.cid === rec.cid);
  assert.equal(row.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("reconcile adopts the server status for a local entry without a pending op (also legacy dirty ones)", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  await put("recurring_exceptions", [
    { cid: "e1", task_cid: "r1", occurrence_date: "2026-10-14", status: "skipped", created_at: NOW, dirty: 0 },
    { cid: "e2", task_cid: "r1", occurrence_date: "2026-10-13", status: "skipped", created_at: NOW, dirty: 1 }, // legacy: push lama tak membersihkan dirty
  ]);
  const r = await reconcileRecurringExceptions({ "10": [{ occurrence_date: "2026-10-14", status: "done" }, { occurrence_date: "2026-10-13", status: "done" }] }, WIN);
  assert.equal(r.updated, 2);
  const rows = await all("recurring_exceptions");
  assert.ok(rows.every((x) => x.status === "done" && x.dirty === 0));
});

test("reconcile deletes clean local entries inside the window that are absent on the server, keeps the rest", async () => {
  await put("tasks", [recurringTask({}), recurringTask({ cid: "local", server_id: null })]);
  await mapPut("task", 10, "r1");
  await put("recurring_exceptions", [
    { cid: "gone", task_cid: "r1", occurrence_date: "2026-10-10", status: "done", created_at: NOW, dirty: 0 }, // absen di server → hapus
    { cid: "old", task_cid: "r1", occurrence_date: "2026-01-10", status: "done", created_at: NOW, dirty: 0 }, // di luar jendela → biarkan
    { cid: "pend", task_cid: "r1", occurrence_date: "2026-10-11", status: "done", created_at: NOW, dirty: 1 }, // op tertunda → biarkan
    { cid: "unsynced", task_cid: "local", occurrence_date: "2026-10-12", status: "done", created_at: NOW, dirty: 0 }, // task belum di-push → biarkan
  ]);
  await outboxAdd({ op: "mark_occurrence", entity_type: "recurring_exception", cid: "pend", payload: { task_cid: "r1", occurrence_date: "2026-10-11", status: "done" } });
  const r = await reconcileRecurringExceptions({ "10": [] }, WIN);
  assert.equal(r.deleted, 1);
  assert.deepEqual((await all("recurring_exceptions")).map((x) => x.cid).sort(), ["old", "pend", "unsynced"]);
});

test("reconcile also deletes window entries of a known task that has no key at all in the server map", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  await put("recurring_exceptions", [{ cid: "gone", task_cid: "r1", occurrence_date: "2026-10-10", status: "done", created_at: NOW, dirty: 0 }]);
  const r = await reconcileRecurringExceptions({}, WIN);
  assert.equal(r.deleted, 1);
  assert.equal((await all("recurring_exceptions")).length, 0);
});

test("pullRecurringExceptions requests a ±60-day window, throws on !ok and changes nothing", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  await put("recurring_exceptions", [{ cid: "keep", task_cid: "r1", occurrence_date: "2026-10-10", status: "done", created_at: NOW, dirty: 0 }]);
  let url = null;
  await assert.rejects(pullRecurringExceptions((u) => { url = u; return Promise.resolve(httpRes(503, { detail: "OFFLINE" })); }, { today: "2026-10-15" }), /http 503/);
  assert.equal(url, "/api/recurring/exceptions?from=2026-08-16&to=2026-12-14");
  assert.equal((await all("recurring_exceptions")).length, 1);
  // 200 → rekonsiliasi berjalan (entri absen di jendela dihapus, entri server dibuat)
  const r = await pullRecurringExceptions(() => Promise.resolve(httpRes(200, { "10": [{ occurrence_date: "2026-10-14", status: "done" }] })), { today: "2026-10-15" });
  assert.equal(r.created, 1);
  assert.equal(r.deleted, 1);
});

test("end to end: mark on device A pushes (dirty 0), device B pulls and the local route serves the mark", async () => {
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  await markOccurrence("r1", "2026-10-14", "done", { now: NOW });
  const calls = [];
  const tr = { request(m, p, b) { calls.push({ m, p, b }); return Promise.resolve({ status: 200, data: { ok: true } }); } };
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(calls[0].p, "/api/tasks/10/occurrences/2026-10-14/mark");
  const row = (await all("recurring_exceptions"))[0];
  assert.equal(row.dirty, 0, "setelah terkirim entri bersih → pull jendela bisa merekonsiliasinya");
  // "perangkat B": store kosong, pull dari server
  _reset(); await deleteDB(DB_NAME);
  await put("tasks", [recurringTask({})]);
  await mapPut("task", 10, "r1");
  await pullRecurringExceptions(() => Promise.resolve(httpRes(200, { "10": [{ occurrence_date: "2026-10-14", status: "done" }] })), { today: "2026-10-15" });
  const R = buildTaskRouter();
  const map = await R.dispatch("GET", "/api/recurring/exceptions?from=2026-10-01&to=2026-10-31", undefined);
  assert.deepEqual(map["10"], [{ occurrence_date: "2026-10-14", status: "done" }]);
});
