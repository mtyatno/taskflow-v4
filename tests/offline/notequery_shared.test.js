"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { getNotes, getNote } = require("../../static/offline/notequery.js");

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
    cid: over.cid, server_id: over.server_id != null ? over.server_id : null,
    title: over.title || "", content: over.content || "",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false,
    list_id: over.list_id != null ? over.list_id : null,
    user_id: over.user_id != null ? over.user_id : null,
    last_edited_by: over.last_edited_by != null ? over.last_edited_by : null,
    last_editor_username: over.last_editor_username != null ? over.last_editor_username : null,
    last_editor_display_name: over.last_editor_display_name != null ? over.last_editor_display_name : null,
    created_at: "2026-06-12T00:00:00", updated_at: over.updated_at || "2026-06-12T00:00:00",
    deleted: false, dirty: 0, base_rev: null,
  }, over);
}

test("getNotes includes shared notes (list_id != null), not just personal", async () => {
  await put("scratchpad_notes", [
    note({ cid: "p", server_id: 1, title: "Personal" }),
    note({ cid: "s", server_id: 2, title: "Shared", list_id: 9 }),
  ]);
  const list = await getNotes({});
  assert.deepEqual(list.map((n) => n.title).sort(), ["Personal", "Shared"]);
});

test("shape exposes list_id, user_id, last_edited_by and last_editor fields", async () => {
  await put("scratchpad_notes", [
    note({ cid: "s", server_id: 2, title: "Shared", list_id: 9, user_id: 3, last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob" }),
  ]);
  const n = await getNote("s");
  assert.equal(n.list_id, 9);
  assert.equal(n.user_id, 3);
  assert.equal(n.last_edited_by, 7);
  assert.equal(n.last_editor_username, "bob");
  assert.equal(n.last_editor_display_name, "Bob");
});
