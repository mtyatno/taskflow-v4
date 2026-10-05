"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { createHabit, checkin } = require("../../static/offline/habitrepo.js");
const { registerHabitRoutes } = require("../../static/offline/habitroutes.js");
const { makeRouter } = require("../../static/offline/router.js");

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
