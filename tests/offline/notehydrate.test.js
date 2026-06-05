"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { hydrateNotes, ensureNotes } = require("../../static/offline/notehydrate.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function allNotes() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").getAll(); q.onsuccess = () => res(q.result || []); });
}

test("hydrateNotes seeds personal notes (dirty 0, base_rev=updated_at) and skips shared", async () => {
  await hydrateNotes([
    { id: 1, title: "Personal", content: "x", list_id: null, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
    { id: 2, title: "Shared", content: "y", list_id: 9, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
  ]);
  const rows = await allNotes();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 1);
  assert.equal(rows[0].dirty, 0);
  assert.equal(rows[0].base_rev, "2026-06-05T00:00:00");
  assert.equal(rows[0].list_id, null);
});

test("hydrateNotes resolves linked_to server ids to local cids (two-pass)", async () => {
  await hydrateNotes([
    { id: 1, title: "A", content: "", list_id: null, linked_to: [2], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
    { id: 2, title: "B", content: "", list_id: null, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" },
  ]);
  const rows = await allNotes();
  const a = rows.find((r) => r.server_id === 1);
  const bCid = await cidOf("note", 2);
  assert.deepEqual(JSON.parse(a.linked_to_cids), [bCid]);
});

test("hydrateNotes resolves linked_task_ids via task idmap", async () => {
  await mapPut("task", 42, "tcid");
  await hydrateNotes([{ id: 1, title: "A", content: "", list_id: null, linked_to: [], linked_task_ids: [42], updated_at: "2026-06-05T00:00:00" }]);
  const rows = await allNotes();
  assert.deepEqual(JSON.parse(rows[0].linked_task_cids), ["tcid"]);
});

test("ensureNotes fetches /api/scratchpad and seeds", async () => {
  const rawFetch = () => Promise.resolve({ json: () => Promise.resolve([{ id: 1, title: "P", content: "", list_id: null, linked_to: [], linked_task_ids: [], updated_at: "2026-06-05T00:00:00" }]) });
  await ensureNotes(rawFetch);
  assert.equal((await allNotes()).length, 1);
});
