"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { getHabits, getHabitsToday, getHabitsMonthly } = require("../../static/offline/habitquery.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function seed(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function habit(over) {
  return Object.assign({ cid: over.cid, server_id: null, title: over.cid, phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false }, over);
}

test("getHabits lists non-deleted habits with id; frequency stays a string", async () => {
  await seed("habits", [habit({ cid: "a", server_id: 10, title: "A" }), habit({ cid: "b", title: "B", deleted: true })]);
  const rows = await getHabits({});
  assert.deepEqual(rows.map((r) => r.cid), ["a"]);
  assert.equal(rows[0].id, 10);
  assert.equal(typeof rows[0].frequency, "string");
});

test("getHabits filters by tag", async () => {
  await seed("habits", [habit({ cid: "a", title: "A" }), habit({ cid: "b", title: "B" })]);
  await setEntityTags("habit", "a", ["pagi"]);
  const rows = await getHabits({ tag: "pagi" });
  assert.deepEqual(rows.map((r) => r.cid), ["a"]);
});

test("getHabitsToday assembles today_status/streak/week_log with frequency as array", async () => {
  await seed("habits", [habit({ cid: "a", server_id: 10, title: "Run", frequency: JSON.stringify(["mon", "tue"]) })]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "a", date: "2026-06-04", status: "done", skip_reason: "" },
    { cid: "l2", habit_cid: "a", date: "2026-06-03", status: "done", skip_reason: "" },
  ]);
  const rows = await getHabitsToday({ today: "2026-06-04" });
  assert.equal(rows[0].id, 10);
  assert.equal(rows[0].today_status, "done");
  assert.equal(rows[0].streak, 2);
  assert.deepEqual(rows[0].frequency, ["mon", "tue"]);
  assert.equal(rows[0].week_log.length, 7);
});

test("getHabitsMonthly aggregates done counts for the month", async () => {
  await seed("habits", [habit({ cid: "a", title: "Run" })]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "a", date: "2026-06-01", status: "done" },
    { cid: "l2", habit_cid: "a", date: "2026-06-02", status: "skipped" },
  ]);
  const m = await getHabitsMonthly({ today: "2026-06-02" });
  assert.equal(m.days_in_month, 30);
  assert.equal(m.days[0].done, 1);
  assert.equal(m.today_day, 2);
});
