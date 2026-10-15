"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { createHabit, checkin } = require("../../static/offline/habitrepo.js");
const { registerHabitRoutes } = require("../../static/offline/habitroutes.js");
const { makeRouter } = require("../../static/offline/router.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

const NOW = "2026-06-04T08:00:00.000Z";
beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function logFor(habitCid, date) {
  const db = await openDB();
  return new Promise((res) => {
    const r = db.transaction("habit_logs").objectStore("habit_logs").index("habit_date").get([habitCid, date]);
    r.onsuccess = () => res(r.result);
  });
}

test("checkin with uncheck removes log from habit_logs and enqueues outbox op", async () => {
  const h = await createHabit({ title: "Exercise" }, { now: NOW });
  await checkin(h.cid, "2026-06-04", "done", "", { now: NOW });
  
  let log = await logFor(h.cid, "2026-06-04");
  assert.ok(log, "Log should exist after done checkin");
  assert.equal(log.status, "done");

  const uncheckRes = await checkin(h.cid, "2026-06-04", "uncheck", "", { now: NOW });
  assert.equal(uncheckRes.status, "uncheck");

  log = await logFor(h.cid, "2026-06-04");
  assert.equal(log, undefined, "Log must be deleted from habit_logs after uncheck");

  const ops = await outboxAll();
  const uncheckOp = ops.find((o) => o.entity_type === "habit_log" && (o.op === "uncheck" || (o.op === "checkin" && o.payload && o.payload.status === "uncheck")));
  assert.ok(uncheckOp, "Outbox should record uncheck operation");
});

test("checkin with uncheck when no log exists resolves without error", async () => {
  const h = await createHabit({ title: "Meditation" }, { now: NOW });
  const uncheckRes = await checkin(h.cid, "2026-06-04", "uncheck", "", { now: NOW });
  assert.equal(uncheckRes.status, "uncheck");
  const log = await logFor(h.cid, "2026-06-04");
  assert.equal(log, undefined);
});

test("checkin with invalid status rejects with error", async () => {
  const h = await createHabit({ title: "Read" }, { now: NOW });
  await assert.rejects(
    () => checkin(h.cid, "2026-06-04", "invalid_status", "", { now: NOW }),
    /status harus done, skipped, atau uncheck/
  );
});

test("habitroutes forwards uncheck status via router", async () => {
  const router = makeRouter();
  registerHabitRoutes(router);

  const h = await createHabit({ title: "Journal" }, { now: NOW });
  await router.dispatch("POST", `/api/habits/${h.cid}/checkin`, { status: "done", date: "2026-06-04" });
  
  let log = await logFor(h.cid, "2026-06-04");
  assert.equal(log.status, "done");

  const routeRes = await router.dispatch("POST", `/api/habits/${h.cid}/checkin`, { status: "uncheck", date: "2026-06-04" });
  assert.equal(routeRes.status, "uncheck");

  log = await logFor(h.cid, "2026-06-04");
  assert.equal(log, undefined, "Log must be removed via router uncheck");
});

test("syncpush processes op uncheck by posting to /api/habits/:sid/checkin and removing outbox op", async () => {
  const h = await createHabit({ title: "Yoga" }, { now: NOW });
  await mapPut("habit", 42, h.cid);
  await checkin(h.cid, "2026-06-04", "done", "", { now: NOW });
  await checkin(h.cid, "2026-06-04", "uncheck", "", { now: NOW });

  const calls = [];
  const fakeTransport = {
    request(method, path, body) {
      calls.push({ method, path, body });
      if (path === "/api/habits") return Promise.resolve({ status: 200, data: { id: 42 } });
      return Promise.resolve({ status: 200, data: { ok: true, habit_id: 42, date: "2026-06-04", status: "uncheck" } });
    }
  };

  const res = await pushOutbox(fakeTransport);
  assert.ok(res.pushed >= 1, "Should push outbox items");

  const uncheckCall = calls.find((c) => c.method === "POST" && c.path === "/api/habits/42/checkin" && c.body && c.body.status === "uncheck");
  assert.ok(uncheckCall, "Should send POST /api/habits/42/checkin with status uncheck");
  assert.equal(uncheckCall.body.date, "2026-06-04");

  const remainingOps = await outboxAll();
  const uncheckOpRemaining = remainingOps.find((o) => o.entity_type === "habit_log" && o.op === "uncheck");
  assert.equal(uncheckOpRemaining, undefined, "Uncheck op should be removed from outbox after push");
});

// ── Workstream A2 (audit 2026-10-15) T9 + S13 + S8 ───────────────────────────────────────────────
const { pullHabitLogs, pullHabits, pullHabitsAndLogs } = require("../../static/offline/syncpull.js");
const { getHabitsMonthly, getHabitsMonthlyCompletion, getHabitsToday } = require("../../static/offline/habitquery.js");
const { deleteHabit, deleteLogsOfHabit, resolveDate } = require("../../static/offline/habitrepo.js");
const { todayJkt } = require("../../static/offline/habitlogic.js");

async function seed(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function allOf(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}

test("T9: uncheck on another device (log absent from the server list) deletes the clean local log inside the window", async () => {
  await seed("habits", [{ cid: "h", server_id: 5, title: "H", deleted: false, dirty: 0 }]);
  await mapPut("habit", 5, "h");
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "h", date: "2026-10-14", status: "done", skip_reason: "", dirty: 0 }, // di-uncheck di perangkat lain
    { cid: "l2", habit_cid: "h", date: "2026-10-13", status: "done", skip_reason: "", dirty: 0 }, // masih ada di server
    { cid: "l3", habit_cid: "h", date: "2026-01-01", status: "done", skip_reason: "", dirty: 0 }, // di luar jendela → bukti tidak ada
    { cid: "l4", habit_cid: "h", date: "2026-10-12", status: "done", skip_reason: "", dirty: 1 }, // dirty → local-wins
  ]);
  const r = await pullHabitLogs([{ habit_id: 5, date: "2026-10-13", status: "done", skip_reason: "" }], { from: "2026-07-17" });
  assert.equal(r.deleted, 1);
  assert.deepEqual((await allOf("habit_logs")).map((l) => l.cid).sort(), ["l2", "l3", "l4"]);
});

test("T9: logs of a never-pushed habit (no server id) are never deleted by the window pass", async () => {
  await seed("habits", [{ cid: "hl", server_id: null, title: "Lokal", deleted: false, dirty: 1 }]);
  await seed("habit_logs", [{ cid: "l1", habit_cid: "hl", date: "2026-10-14", status: "done", skip_reason: "", dirty: 0 }]);
  const r = await pullHabitLogs([], { from: "2026-07-17" });
  assert.equal(r.deleted, 0);
  assert.equal((await allOf("habit_logs")).length, 1);
});

test("T9: a dirty log whose status+skip_reason already equal the server's becomes clean and its checkin op is dropped", async () => {
  await seed("habits", [{ cid: "h", server_id: 5, title: "H", deleted: false, dirty: 0 }]);
  await mapPut("habit", 5, "h");
  await seed("habit_logs", [
    { cid: "same", habit_cid: "h", date: "2026-10-14", status: "skipped", skip_reason: "hujan", dirty: 1 },
    { cid: "diff", habit_cid: "h", date: "2026-10-13", status: "done", skip_reason: "", dirty: 1 },
  ]);
  await seed("_outbox", [
    { qid: 1, op: "checkin", entity_type: "habit_log", cid: "same", payload: {} },
    { qid: 2, op: "checkin", entity_type: "habit_log", cid: "diff", payload: {} },
  ]);
  const r = await pullHabitLogs([
    { habit_id: 5, date: "2026-10-14", status: "skipped", skip_reason: "hujan" },
    { habit_id: 5, date: "2026-10-13", status: "skipped", skip_reason: "" },
  ], { from: "2026-07-17" });
  assert.equal(r.confirmed, 1);
  assert.equal(r.skipped, 1);
  const logs = await allOf("habit_logs");
  assert.equal(logs.find((l) => l.cid === "same").dirty, 0);
  assert.equal(logs.find((l) => l.cid === "diff").dirty, 1);
  assert.equal(logs.find((l) => l.cid === "diff").status, "done");
  assert.deepEqual((await outboxAll()).map((o) => o.cid), ["diff"]);
});

test("T9: a server log is not resurrected locally while a local uncheck op for it is still queued", async () => {
  const h = await createHabit({ title: "Yoga" }, { now: NOW });
  await mapPut("habit", 42, h.cid);
  await checkin(h.cid, "2026-10-14", "done", "", {});
  await checkin(h.cid, "2026-10-14", "uncheck", "", {});
  const r = await pullHabitLogs([{ habit_id: 42, date: "2026-10-14", status: "done", skip_reason: "" }], { from: "2026-07-17" });
  assert.equal(r.created, 0);
  assert.equal(await logFor(h.cid, "2026-10-14"), undefined);
});

test("pullHabitsAndLogs requests the log list with an explicit `since` equal to the client window start", async () => {
  const urls = [];
  const rawFetch = (u) => {
    urls.push(u);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };
  await pullHabitsAndLogs(rawFetch);
  const logUrl = urls.find((u) => u.startsWith("/api/habits/logs"));
  const m = /since=(\d{4}-\d{2}-\d{2})$/.exec(logUrl);
  assert.ok(m, "since harus dikirim: " + logUrl);
  const [y, mo, d] = todayJkt().split("-").map(Number);
  const expect = new Date(Date.UTC(y, mo - 1, d) - 90 * 86400000).toISOString().slice(0, 10);
  assert.equal(m[1], expect);
});

test("S13: deleteHabit (local) removes the habit's logs and their checkin/uncheck ops", async () => {
  const h = await createHabit({ title: "Lari" }, { now: NOW });
  const other = await createHabit({ title: "Baca" }, { now: NOW });
  await checkin(h.cid, "2026-10-14", "done", "", {});
  await checkin(h.cid, "2026-10-13", "done", "", {});
  await checkin(h.cid, "2026-10-12", "uncheck", "", {});
  await checkin(other.cid, "2026-10-14", "done", "", {});
  await deleteHabit(h.cid, {});
  const logs = await allOf("habit_logs");
  assert.deepEqual(logs.map((l) => l.habit_cid), [other.cid]);
  const ops = await outboxAll();
  assert.ok(!ops.some((o) => o.entity_type === "habit_log" && (o.payload && o.payload.habit_cid === h.cid)), "op log habit yang dihapus dibuang");
  assert.ok(ops.some((o) => o.entity_type === "habit_log" && o.payload && o.payload.habit_cid === other.cid), "op log habit lain tetap");
  assert.ok(ops.some((o) => o.entity_type === "habit" && o.op === "delete" && o.cid === h.cid));
  assert.equal(await deleteLogsOfHabit("nope"), 0);
});

test("S13: pullHabits deleting a habit gone from the server also deletes its logs", async () => {
  await seed("habits", [{ cid: "h", server_id: 5, title: "H", deleted: false, dirty: 0 }]);
  await mapPut("habit", 5, "h");
  await seed("habit_logs", [{ cid: "l1", habit_cid: "h", date: "2026-10-14", status: "done", skip_reason: "", dirty: 0 }]);
  const r = await pullHabits([]);
  assert.equal(r.deleted, 1);
  assert.equal((await allOf("habits")).length, 0);
  assert.equal((await allOf("habit_logs")).length, 0);
});

test("S13: orphan logs (habit missing or deleted) are excluded from monthly stats and completion", async () => {
  await seed("habits", [
    { cid: "live", server_id: 1, title: "Live", phase: "pagi", frequency: '["mon"]', deleted: false },
    { cid: "dead", server_id: 2, title: "Dead", phase: "pagi", frequency: '["mon"]', deleted: true },
  ]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "live", date: "2026-10-01", status: "done", skip_reason: "" },
    { cid: "l2", habit_cid: "dead", date: "2026-10-01", status: "done", skip_reason: "" },
    { cid: "l3", habit_cid: "ghost", date: "2026-10-01", status: "done", skip_reason: "" },
  ]);
  const m = await getHabitsMonthly({ today: "2026-10-02" });
  assert.equal(m.days[0].done, 1);
  const c = await getHabitsMonthlyCompletion({ today: "2026-10-02" });
  assert.deepEqual(c.days, [{ date: "2026-10-01", total_habits: 1, done_count: 1 }]);
  const today = await getHabitsToday({ today: "2026-10-01" });
  assert.deepEqual(today.map((h) => h.cid), ["live"]);
});

test("S8: habitrepo.checkin defaults the date to the Jakarta day when the caller omits or garbles it", async () => {
  assert.equal(resolveDate(undefined), todayJkt());
  assert.equal(resolveDate(""), todayJkt());
  assert.equal(resolveDate("2026-10-14T23:59:00"), "2026-10-14");
  assert.equal(resolveDate("2026-10-14"), "2026-10-14");
  const h = await createHabit({ title: "Air" }, { now: NOW });
  const log = await checkin(h.cid, undefined, "done", "", {});
  assert.equal(log.date, todayJkt());
});
