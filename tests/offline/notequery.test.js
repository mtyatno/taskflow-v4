"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { getNotes, getNote, getRecent } = require("../../static/offline/notequery.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function note(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, content: "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-01T00:00:00", deleted: false, dirty: 0,
  }, over);
}

test("getNotes returns personal non-deleted notes ordered by updated_at DESC with display id", async () => {
  await put("scratchpad_notes", [
    note({ cid: "a", server_id: 5, title: "A", updated_at: "2026-06-02T00:00:00" }),
    note({ cid: "b", title: "B", updated_at: "2026-06-03T00:00:00" }),
    note({ cid: "c", title: "Gone", deleted: true }),
    note({ cid: "d", title: "Shared", list_id: 9 }),
  ]);
  const rows = await getNotes({});
  assert.deepEqual(rows.map((r) => r.id), ["b", 5]); // b newest; a has server_id 5; deleted+shared excluded
});

test("getNotes filters by q (title/content) and includes tags + pinned in shape", async () => {
  await put("scratchpad_notes", [note({ cid: "a", title: "Groceries", content: "milk", pinned: true })]);
  await setEntityTags("note", "a", ["home"]);
  const byTitle = await getNotes({ q: "groc" });
  assert.equal(byTitle.length, 1);
  assert.deepEqual(byTitle[0].tags, ["home"]);
  assert.equal(byTitle[0].pinned, true);
  const byContent = await getNotes({ q: "milk" });
  assert.equal(byContent.length, 1);
  assert.equal((await getNotes({ q: "zzz" })).length, 0);
});

test("getNotes filters by tag", async () => {
  await put("scratchpad_notes", [note({ cid: "a", title: "A" }), note({ cid: "b", title: "B" })]);
  await setEntityTags("note", "a", ["work"]);
  const rows = await getNotes({ tag: "work" });
  assert.deepEqual(rows.map((r) => r.id), ["a"]);
});

test("getNote shapes linked_to and linked_tasks via display ids", async () => {
  await put("tasks", [{ cid: "t1", server_id: 11, title: "Task One", priority: "P2", gtd_status: "next", deleted: false }]);
  await put("scratchpad_notes", [
    note({ cid: "tgt", server_id: 8, title: "Target" }),
    note({ cid: "main", title: "Main", linked_to_cids: '["tgt"]', linked_task_cids: '["t1"]' }),
  ]);
  const row = await getNote("main");
  assert.deepEqual(row.linked_to, [8]);
  assert.deepEqual(row.linked_task_ids, [11]);
  assert.deepEqual(row.linked_tasks, [{ id: 11, title: "Task One", priority: "P2", gtd_status: "next" }]);
});

test("getRecent returns the 5 most recent personal notes", async () => {
  const recs = [];
  for (let i = 0; i < 7; i++) recs.push(note({ cid: "n" + i, title: "N" + i, updated_at: "2026-06-0" + (i + 1) + "T00:00:00" }));
  await put("scratchpad_notes", recs);
  const rows = await getRecent();
  assert.equal(rows.length, 5);
  assert.equal(rows[0].id, "n6"); // newest first
});
