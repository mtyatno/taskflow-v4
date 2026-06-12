"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { pullNotes } = require("../../static/offline/syncpull.js");

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
async function getAll(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
function srv(over) {
  return Object.assign({
    id: over.id, title: over.title || "S", content: over.content || "", pinned: false,
    list_id: over.list_id != null ? over.list_id : null,
    last_edited_by: over.last_edited_by != null ? over.last_edited_by : null,
    last_editor_username: over.last_editor_username != null ? over.last_editor_username : null,
    last_editor_display_name: over.last_editor_display_name != null ? over.last_editor_display_name : null,
    user_id: over.user_id != null ? over.user_id : 1,
    linked_to: [], linked_task_ids: [], tags: [],
    created_at: "2026-06-12T00:00:00", updated_at: over.updated_at || "2026-06-12T00:00:00",
  }, over);
}
function localNote(over) {
  return Object.assign({
    cid: over.cid, server_id: over.server_id, title: over.title || "L", content: over.content || "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false,
    list_id: over.list_id != null ? over.list_id : null, user_id: 1, last_edited_by: null,
    created_at: "x", updated_at: over.updated_at || "2026-06-12T00:00:00",
    deleted: false, dirty: over.dirty != null ? over.dirty : 0, base_rev: over.base_rev || "2026-06-12T00:00:00",
  }, over);
}

test("pullNotes reconciles shared notes (no longer personal-only) + carries collaborator fields", async () => {
  const res = await pullNotes([srv({ id: 5, title: "Remote", list_id: 9, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob" })]);
  assert.equal(res.created, 1);
  const local = (await getAll("scratchpad_notes"))[0];
  assert.equal(local.list_id, 9);
  assert.equal(local.last_editor_display_name, "Bob");
});

test("LWW-loss on a dirty shared note attaches an overwritten notice", async () => {
  await put("scratchpad_notes", [localNote({ cid: "n", server_id: 5, list_id: 9, dirty: 1, title: "MineOld", updated_at: "2026-06-12T01:00:00", base_rev: "2026-06-12T00:00:00" })]);
  await mapPut("note", 5, "n");
  const res = await pullNotes([srv({ id: 5, list_id: 9, title: "Theirs", updated_at: "2026-06-12T05:00:00", last_edited_by: 7, last_editor_display_name: "Bob" })]);
  assert.equal(res.lwwResolved, 1);
  const local = (await getAll("scratchpad_notes"))[0];
  assert.equal(local.title, "Theirs");
  assert.equal(local.notice.kind, "overwritten");
  assert.equal(local.notice.editor, "Bob");
});

test("shared dirty note vanished from server -> conflict remote_deleted (not silent keep)", async () => {
  await put("scratchpad_notes", [localNote({ cid: "n", server_id: 5, list_id: 9, dirty: 1, title: "Mine" })]);
  await mapPut("note", 5, "n");
  const res = await pullNotes([]);
  const local = (await getAll("scratchpad_notes"))[0];
  assert.equal(local.conflict, "remote_deleted");
});
