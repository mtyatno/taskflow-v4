"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { pullLists, getLocalLists } = require("../../static/offline/listsync.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allLists() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("lists").objectStore("lists").getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
function srv(over) {
  return Object.assign({ id: over.id, name: "L", owner_id: 1, created_at: "2026-06-01T00:00:00", role: "member", member_count: 2 }, over);
}

test("pullLists creates a list record with a stable cid", async () => {
  const r = await pullLists([srv({ id: 5, name: "Team", role: "owner", member_count: 3 })]);
  assert.equal(r.created, 1);
  const rows = await allLists();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].name, "Team");
  assert.equal(rows[0].role, "owner");
  assert.equal(rows[0].member_count, 3);
  assert.equal(rows[0].dirty, 0);
  assert.equal(await cidOf("list", 5), rows[0].cid);
});

test("pullLists updates an existing list (same cid) and is idempotent", async () => {
  await pullLists([srv({ id: 5, name: "Old" })]);
  const cid1 = (await allLists())[0].cid;
  const r = await pullLists([srv({ id: 5, name: "Renamed" })]);
  assert.equal(r.updated, 1);
  const rows = await allLists();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, cid1);
  assert.equal(rows[0].name, "Renamed");
});

test("pullLists deletes a local list whose server_id vanished", async () => {
  await pullLists([srv({ id: 5 }), srv({ id: 6 })]);
  const r = await pullLists([srv({ id: 5 })]);
  assert.equal(r.deleted, 1);
  const rows = await allLists();
  assert.deepEqual(rows.map((x) => x.server_id), [5]);
});

test("getLocalLists returns the server-shaped array (id = server_id)", async () => {
  await pullLists([srv({ id: 5, name: "Team", role: "owner", member_count: 4 })]);
  const out = await getLocalLists();
  assert.deepEqual(out, [{ id: 5, name: "Team", owner_id: 1, role: "owner", member_count: 4 }]);
});
