"use strict";
// Petakan C2: noterepo.applyMapEdit — compare-and-set tulis isi note dari edit peta.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { applyMapEdit, getNoteRaw, setCurrentUser } = require("../../static/offline/noterepo.js");

let events;
beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME);
  events = [];
  globalThis.window = { dispatchEvent: (e) => events.push(e) };
  globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i.detail; } };
  setCurrentUser({ user_id: 5 });
});

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
const base = { server_id: null, linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, deleted: false, dirty: 0, rev: 1 };
async function seed() {
  await put("scratchpad_notes", [
    Object.assign({}, base, { cid: "n1", title: "A", content: "# A\n" }),
    Object.assign({}, base, { cid: "n2", title: "Lain", content: "" }),
  ]);
}

test("ok writes, coalesces one update op, recomputes wikilinks, emits noteSaved", async () => {
  await seed();
  const r = await applyMapEdit("n1", "# A\n", { markdown: "# A\n[[Lain]]\n", title: "Baru" });
  assert.ok(r.ok); const n = await getNoteRaw("n1");
  assert.deepEqual([n.content, n.title, n.dirty], ["# A\n[[Lain]]\n", "Baru", 1]);
  assert.deepEqual(JSON.parse(n.linked_to_cids), ["n2"]);
  assert.equal(n.rev, 2);
  assert.equal(n.last_edited_by, 5);
  assert.equal(n.last_editor_username, null);
  assert.equal(n.last_editor_display_name, null);
  assert.equal((await outboxAll()).filter((o) => o.cid === "n1" && o.op === "update").length, 1);
  assert.equal(events[0].type, "noteSaved"); assert.equal(events[0].detail.source, "notemap");
  assert.deepEqual(events[0].detail.cids, ["n1"]);
});
test("stale content is not overwritten", async () => {
  await seed();
  const r = await applyMapEdit("n1", "# versi lama\n", { markdown: "# X\n", title: "X" });
  assert.ok(r.stale); assert.equal((await getNoteRaw("n1")).content, "# A\n"); assert.equal((await outboxAll()).length, 0);
  assert.equal(r.note.content, "# A\n"); assert.equal(events.length, 0);
});
test("missing note", async () => { assert.deepEqual(await applyMapEdit("zz", "", { markdown: "", title: "" }), { missing: true }); });
test("deleted note is missing", async () => {
  await put("scratchpad_notes", [Object.assign({}, base, { cid: "d1", title: "D", content: "x", deleted: true })]);
  assert.deepEqual(await applyMapEdit("d1", "x", { markdown: "y", title: "D" }), { missing: true });
});
