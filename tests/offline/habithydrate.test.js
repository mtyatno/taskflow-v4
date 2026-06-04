"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { hydrateHabits, hydrateLogs, ensureHabits } = require("../../static/offline/habithydrate.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function all(store) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}

test("hydrateHabits seeds habits with a stable cid (idempotent)", async () => {
  await hydrateHabits([{ id: 5, title: "Run", phase: "pagi", frequency: '["mon"]', micro_target: "", identity_pillar: "" }]);
  const cid1 = (await all("habits"))[0].cid;
  await hydrateHabits([{ id: 5, title: "Run2", phase: "pagi", frequency: '["mon"]' }]);
  const rows = await all("habits");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, cid1);
  assert.equal(rows[0].title, "Run2");
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].dirty, 0);
  assert.equal(await cidOf("habit", 5), cid1);
});

test("hydrateLogs maps server habit_id to the local habit cid", async () => {
  await hydrateHabits([{ id: 5, title: "Run", phase: "pagi" }]);
  const hcid = (await all("habits"))[0].cid;
  await hydrateLogs([{ habit_id: 5, date: "2026-06-04", status: "done", skip_reason: "" }]);
  const logs = await all("habit_logs");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].habit_cid, hcid);
  assert.equal(logs[0].status, "done");
  assert.equal(logs[0].dirty, 0);
});

test("ensureHabits fetches habits + logs once and seeds both", async () => {
  let calls = 0;
  const rawFetch = async (url) => {
    calls++;
    if (url.indexOf("/logs") !== -1) return { json: async () => [{ habit_id: 5, date: "2026-06-04", status: "done" }] };
    return { json: async () => [{ id: 5, title: "Run", phase: "pagi", frequency: '["mon"]' }] };
  };
  await ensureHabits(rawFetch);
  assert.equal(calls, 2);
  assert.equal((await all("habits")).length, 1);
  assert.equal((await all("habit_logs")).length, 1);
});
