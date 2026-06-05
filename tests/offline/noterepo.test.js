"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { getEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { createNote } = require("../../static/offline/noterepo.js");

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
async function getNoteRow(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}

test("createNote stores a personal note, records outbox + tags", async () => {
  const rec = await createNote({ title: "Note A", content: "hello", tags: ["work"] }, { now: "2026-06-06T00:00:00Z" });
  const row = await getNoteRow(rec.cid);
  assert.equal(row.title, "Note A");
  assert.equal(row.content, "hello");
  assert.equal(row.list_id, null);
  assert.equal(row.pinned, false);
  assert.equal(row.dirty, 1);
  assert.equal(row.created_at, "2026-06-06T00:00:00Z");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "note");
  const tags = await getEntityTags("note", rec.cid);
  assert.deepEqual(tags.map((t) => t.name), ["work"]);
});

test("createNote resolves [[Title]] wikilinks to local note cids", async () => {
  await put("scratchpad_notes", [{ cid: "target", server_id: 7, title: "Target Note", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0 }]);
  const rec = await createNote({ title: "Linker", content: "see [[Target Note]]", tags: [] }, {});
  const row = await getNoteRow(rec.cid);
  assert.deepEqual(JSON.parse(row.linked_to_cids), ["target"]);
});

test("createNote resolves linked_task_ids (server id or cid) to task cids", async () => {
  await put("tasks", [{ cid: "tcid", server_id: 42, title: "T", deleted: false, dirty: 0 }]);
  const rec = await createNote({ title: "N", content: "", tags: [], linked_task_ids: [42] }, {});
  const row = await getNoteRow(rec.cid);
  assert.deepEqual(JSON.parse(row.linked_task_cids), ["tcid"]);
});
