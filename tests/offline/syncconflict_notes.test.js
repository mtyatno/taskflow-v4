"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { listConflicts, resolveConflict, listNotices, dismissNotice } = require("../../static/offline/syncconflict.js");

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
async function getNote(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("scratchpad_notes").objectStore("scratchpad_notes").get(cid); q.onsuccess = () => res(q.result); });
}
function note(over) {
  return Object.assign({ cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "N", content: "", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: 9, user_id: 1, last_edited_by: null, created_at: "x", updated_at: "x", deleted: false, dirty: 1, base_rev: null }, over);
}

test("listConflicts includes note conflicts tagged entity=note", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, conflict: "remote_deleted", title: "Gone" })]);
  const list = await listConflicts();
  const noteC = list.find((c) => c.entity === "note");
  assert.ok(noteC);
  assert.equal(noteC.cid, "n");
  assert.equal(noteC.title, "Gone");
});

test("resolveConflict('note', cid, 'discard') removes the note + idmap + op", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, conflict: "remote_deleted" })]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  await resolveConflict("note", "n", "discard");
  assert.equal(await getNote("n"), undefined);
  assert.equal(await serverIdOf("n"), undefined);
});

test("listNotices surfaces note notices; dismissNotice clears them", async () => {
  await put("scratchpad_notes", [note({ cid: "n", notice: { kind: "overwritten", title: "Doc", editor: "Bob" } })]);
  const notices = await listNotices();
  const n = notices.find((x) => x.entity === "note");
  assert.ok(n);
  assert.equal(n.editor, "Bob");
  await dismissNotice("note", "n");
  assert.equal((await listNotices()).length, 0);
  assert.equal((await getNote("n")).notice, undefined);
});

test("resolveConflict still works for tasks (entity='task', backward-compatible)", async () => {
  await put("tasks", [{ cid: "t", server_id: 3, title: "T", conflict: "remote_deleted", list_id: null }]);
  await mapPut("task", 3, "t");
  await resolveConflict("task", "t", "discard");
  const db = await openDB();
  const got = await new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get("t"); q.onsuccess = () => res(q.result); });
  assert.equal(got, undefined);
});
