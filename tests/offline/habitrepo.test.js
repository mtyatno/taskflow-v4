"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { getEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { createHabit, updateHabit, deleteHabit, checkin } = require("../../static/offline/habitrepo.js");

const NOW = "2026-06-04T08:00:00.000Z";
beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function getHabitRaw(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").get(cid); q.onsuccess = () => res(q.result); });
}
async function logFor(habitCid, date) {
  const db = await openDB();
  return new Promise((res) => {
    const r = db.transaction("habit_logs").objectStore("habit_logs").index("habit_date").get([habitCid, date]);
    r.onsuccess = () => res(r.result);
  });
}

test("createHabit strips tags, defaults phase/frequency, enqueues outbox, persists tags", async () => {
  const h = await createHabit({ title: "Olahraga #pagi", micro_target: "10 menit" }, { now: NOW });
  assert.equal(h.title, "Olahraga");
  assert.equal(h.phase, "pagi");
  assert.equal(h.frequency, JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]));
  assert.equal(h.micro_target, "10 menit");
  assert.equal(h.dirty, 1);
  assert.deepEqual((await getEntityTags("habit", h.cid)).map((t) => t.name), ["pagi"]);
  const ops = await outboxAll();
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "habit");
});

test("updateHabit changes fields and re-derives tags", async () => {
  const h = await createHabit({ title: "A #one", phase: "pagi" }, { now: NOW });
  const u = await updateHabit(h.cid, { title: "B #two", phase: "malam", frequency: ["mon"] }, { now: NOW });
  assert.equal(u.title, "B");
  assert.equal(u.phase, "malam");
  assert.equal(u.frequency, JSON.stringify(["mon"]));
  assert.deepEqual((await getEntityTags("habit", h.cid)).map((t) => t.name), ["two"]);
});

test("deleteHabit tombstones the habit and enqueues a delete op", async () => {
  const h = await createHabit({ title: "Gone" }, { now: NOW });
  await deleteHabit(h.cid, { now: NOW });
  assert.equal((await getHabitRaw(h.cid)).deleted, true);
  assert.ok((await outboxAll()).some((o) => o.op === "delete" && o.entity_type === "habit"));
});

test("checkin upserts a habit_log by (habit,date) and enqueues a checkin op", async () => {
  const h = await createHabit({ title: "Run" }, { now: NOW });
  await checkin(h.cid, "2026-06-04", "done", "", { now: NOW });
  assert.equal((await logFor(h.cid, "2026-06-04")).status, "done");
  await checkin(h.cid, "2026-06-04", "skipped", "sakit", { now: NOW });
  const log = await logFor(h.cid, "2026-06-04");
  assert.equal(log.status, "skipped");
  assert.equal(log.skip_reason, "sakit");
  assert.ok((await outboxAll()).some((o) => o.op === "checkin" && o.entity_type === "habit_log"));
});
