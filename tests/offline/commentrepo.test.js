"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf, mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { metaGet } = require("../../static/offline/meta.js");
const { setCurrentUser } = require("../../static/offline/chatrepo.js");
const repo = require("../../static/offline/commentrepo.js");

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
  return new Promise((res, rej) => {
    const r = db.transaction("scratchpad_notes", "readonly").objectStore("scratchpad_notes").get(cid);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function setNote(over) { await put("scratchpad_notes", [Object.assign({}, await getNote("n1"), over)]); }
async function commentOps() { return (await outboxAll()).filter((o) => o.entity_type === "comment"); }
function srv(over) {
  return Object.assign({
    id: 100, note_id: 10, list_id: 7, parent_id: null, user_id: 2, username: "rina", display_name: "Rina",
    body: "server body", quote: "q", resolved_at: null, resolved_by: null, resolved_by_name: null,
    edited_at: null, deleted_at: null, client_id: null,
    created_at: "2026-10-21T08:00:00+07:00", updated_at: "2026-10-21T08:00:00+07:00",
  }, over);
}

beforeEach(async () => {
  _reset(); await deleteDB(DB_NAME);
  setCurrentUser({ user_id: 1, username: "me", display_name: "Me" });
  await put("scratchpad_notes", [{ cid: "n1", server_id: 10, list_id: 7, deleted: false }]);
  await mapPut("note", 10, "n1");
});

test("exports constants and raw helpers", () => {
  assert.equal(repo.CURSOR_KEY, "comments_cursor");
  assert.equal(repo.READS_KEY, "comment_reads");
  for (const k of ["getRaw", "putRaw", "deleteRaw", "shape", "listForNote", "threads", "parts", "create", "edit",
    "resolve", "remove", "discard", "mergePulled", "clearSynced", "markRead", "seedReadMarkers", "decorateNotes"]) {
    assert.equal(typeof repo[k], "function", k);
  }
});

test("create stores pending record with note list/note id, user names and a create op", async () => {
  const c = await repo.create("n1", { body: "halo", quote: "kutip" });
  assert.equal(c.pending, true);
  assert.equal(c.id, c.cid);
  const rec = await repo.getRaw(c.cid);
  assert.equal(rec.pending, "create");
  assert.equal(rec.list_id, 7);
  assert.equal(rec.note_id, 10);
  assert.equal(rec.note_cid, "n1");
  assert.equal(rec.quote, "kutip");
  assert.equal(rec.user_id, 1);
  assert.equal(rec.display_name, "Me");
  assert.equal(rec.client_id, c.cid);
  assert.equal(rec.created_at, rec.updated_at);
  const ops = await commentOps();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["create", c.cid]]);
});

test("reply to a reply flattens to the thread and drops the quote", async () => {
  const t = await repo.create("n1", { body: "thread", quote: "x" });
  const r1 = await repo.create("n1", { body: "r1", quote: "y", parent_id: t.cid });
  const r2 = await repo.create("n1", { body: "r2", parent_id: r1.cid });
  assert.equal((await repo.getRaw(r1.cid)).quote, null);
  const rec2 = await repo.getRaw(r2.cid);
  assert.equal(rec2.parent_cid, t.cid);
  assert.equal(rec2.parent_id, null);
  assert.equal(r2.parent_id, t.cid);
  // reply to a server thread via its server id
  await repo.mergePulled([srv({ id: 200 })]);
  const r3 = await repo.create("n1", { body: "r3", parent_id: 200 });
  const rec3 = await repo.getRaw(r3.cid);
  assert.equal(rec3.parent_id, 200);
  assert.equal(rec3.parent_cid, await cidOf("comment", 200));
  assert.equal(r3.parent_id, 200);
});

test("create on a private note rejects 409 NOTE_NOT_SHARED; missing note 404", async () => {
  await setNote({ list_id: null });
  await assert.rejects(repo.create("n1", { body: "x" }), (e) => e.status === 409 && e.code === "NOTE_NOT_SHARED"
    && e.message === "Catatan ini belum dibagikan ke workspace");
  await assert.rejects(repo.create("nope", { body: "x" }), (e) => e.status === 404 && e.message === "Note not found");
  assert.equal((await commentOps()).length, 0);
});

test("merging: create -> edit -> resolve keeps one op with new body and resolved_at", async () => {
  const c = await repo.create("n1", { body: "a" });
  await repo.edit(c.cid, "b");
  await repo.resolve(c.cid, true);
  const ops = await commentOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  const rec = await repo.getRaw(c.cid);
  assert.equal(rec.body, "b");
  assert.ok(rec.resolved_at);
  assert.equal(rec.resolved_by, 1);
  assert.equal(rec.resolved_by_name, "Me");
  assert.equal(rec.pending, "create");
});

test("merging: create -> remove leaves no record and no op", async () => {
  const c = await repo.create("n1", { body: "a" });
  await repo.remove(c.cid);
  assert.equal(await repo.getRaw(c.cid), undefined);
  assert.equal((await commentOps()).length, 0);
});

test("removing a pending thread also removes its pending replies", async () => {
  const t = await repo.create("n1", { body: "t" });
  const r = await repo.create("n1", { body: "r", parent_id: t.cid });
  await repo.remove(t.cid);
  assert.equal(await repo.getRaw(t.cid), undefined);
  assert.equal(await repo.getRaw(r.cid), undefined);
  assert.equal((await commentOps()).length, 0);
});

test("server comment: two edits -> one edit op, server_copy keeps server body; discard restores", async () => {
  await repo.mergePulled([srv({ id: 100 })]);
  const cid = await cidOf("comment", 100);
  await repo.edit(cid, "satu");
  const e2 = await repo.edit(cid, "dua");
  assert.equal(e2.body, "dua");
  assert.equal(e2.pending, true);
  let ops = await commentOps();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["edit", cid]]);
  let rec = await repo.getRaw(cid);
  assert.equal(rec.pending, "edit");
  assert.equal(rec.server_copy.body, "server body");
  assert.ok(rec.edited_at);
  await repo.discard(cid);
  rec = await repo.getRaw(cid);
  assert.equal(rec.body, "server body");
  assert.equal(rec.edited_at, null);
  assert.equal(rec.pending, null);
  assert.equal(rec.server_copy, null);
  assert.equal(rec.sync_error, null);
  assert.equal((await commentOps()).length, 0);
});

test("server comment: remove drops edit/resolve ops and queues one delete", async () => {
  await repo.mergePulled([srv({ id: 100 })]);
  const cid = await cidOf("comment", 100);
  await repo.edit(cid, "x");
  await repo.resolve(cid, true);
  assert.equal((await commentOps()).length, 2);
  const pr = await repo.create("n1", { body: "unsent reply", parent_id: 100 });
  await repo.remove(cid);
  await repo.remove(cid).catch(() => {});
  const ops = await commentOps();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["delete", cid]]);
  const rec = await repo.getRaw(cid);
  assert.equal(rec.pending, "delete");
  assert.ok(rec.deleted_at);
  assert.equal(await repo.getRaw(pr.cid), undefined);
  assert.deepEqual(await repo.listForNote("n1"), []);
});

test("discard of a pending create removes record and op", async () => {
  const c = await repo.create("n1", { body: "a" });
  await repo.discard(c.cid);
  assert.equal(await repo.getRaw(c.cid), undefined);
  assert.equal((await commentOps()).length, 0);
});

test("resolve on a reply rejects 422 without changes", async () => {
  await repo.mergePulled([srv({ id: 100 }), srv({ id: 101, parent_id: 100 })]);
  const rcid = await cidOf("comment", 101);
  await assert.rejects(repo.resolve(rcid, true), (e) => e.status === 422 && e.message === "Hanya thread yang bisa diselesaikan");
  const t = await repo.create("n1", { body: "t" });
  const r = await repo.create("n1", { body: "r", parent_id: t.cid });
  await assert.rejects(repo.resolve(r.cid, true), (e) => e.status === 422);
  assert.equal((await repo.getRaw(rcid)).pending, null);
  assert.equal((await commentOps()).length, 2); // only the two creates
  await assert.rejects(repo.edit("missing", "x"), (e) => e.status === 404 && e.message === "Komentar tidak ditemukan");
});

test("resolve on a server thread sets resolver and queues one resolve op; unresolve clears", async () => {
  await repo.mergePulled([srv({ id: 100 })]);
  const cid = await cidOf("comment", 100);
  const a = await repo.resolve(cid, true);
  assert.ok(a.resolved_at);
  assert.equal(a.resolved_by, 1);
  const b = await repo.resolve(cid, false);
  assert.equal(b.resolved_at, null);
  assert.equal(b.resolved_by, null);
  assert.deepEqual((await commentOps()).map((o) => o.op), ["resolve"]);
  assert.equal((await repo.getRaw(cid)).server_copy.resolved_at, null);
});

test("listForNote follows the note's current workspace (Review Focus 4)", async () => {
  await repo.mergePulled([srv({ id: 100, created_at: "2026-10-21T09:00:00+07:00" })]);
  const c = await repo.create("n1", { body: "lokal" }); // created now (later than 100)
  let rows = await repo.listForNote("n1");
  assert.deepEqual(rows.map((r) => r.body), ["server body", "lokal"]);
  assert.equal(rows[0].id, 100);
  assert.equal(rows[0].pending, false);
  // comment pulled before note mapping existed: only note_id, no note_cid
  const raw = await repo.getRaw(await cidOf("comment", 100));
  assert.equal(raw.note_cid, "n1");
  await repo.putRaw(Object.assign({}, raw, { note_cid: null }));
  rows = await repo.listForNote("n1");
  assert.equal(rows.length, 2);
  await setNote({ list_id: 9 });
  assert.deepEqual(await repo.listForNote("n1"), []);
  await setNote({ list_id: null });
  assert.deepEqual(await repo.listForNote("n1"), []);
  assert.deepEqual(await repo.listForNote("nope"), []);
  assert.ok(c.cid);
});

test("listForNote orders by epoch time, not string", async () => {
  // 08:30+07:00 == 01:30Z, which is earlier than 02:00Z even though the string sorts later
  await repo.mergePulled([srv({ id: 100, created_at: "2026-10-21T08:30:00+07:00" })]);
  await repo.putRaw({ cid: "zz", server_id: null, note_cid: "n1", note_id: 10, list_id: 7, parent_id: null,
    parent_cid: null, user_id: 1, body: "z", created_at: "2026-10-21T02:00:00.000Z", deleted_at: null,
    pending: "create", sync_error: null, server_copy: null });
  const rows = await repo.listForNote("n1");
  assert.deepEqual(rows.map((r) => r.body), ["server body", "z"]);
});

test("threads attaches replies via server parent_id and splits open/done; parts splits mentions", async () => {
  await repo.mergePulled([
    srv({ id: 100 }),
    srv({ id: 101, parent_id: 100, created_at: "2026-10-21T08:05:00+07:00" }),
    srv({ id: 102, resolved_at: "2026-10-21T08:10:00+07:00", created_at: "2026-10-21T08:01:00+07:00" }),
  ]);
  // simulate reply whose parent_cid is unknown (pulled before parent)
  const rc = await cidOf("comment", 101);
  await repo.putRaw(Object.assign({}, await repo.getRaw(rc), { parent_cid: null }));
  const rows = await repo.listForNote("n1");
  const open = repo.threads(rows, "open");
  assert.equal(open.length, 1);
  assert.equal(open[0].id, 100);
  assert.deepEqual(open[0].replies.map((r) => r.id), [101]);
  const done = repo.threads(rows, "done");
  assert.deepEqual(done.map((t) => t.id), [102]);
  assert.deepEqual(repo.parts("hai @rina!"), [{ s: "hai ", m: false }, { s: "@rina", m: true }, { s: "!", m: false }]);
  assert.deepEqual(repo.parts(""), []);
});

test("mergePulled: upsert, tombstone, skip pending, adopt own client_id, replaceForNoteId", async () => {
  let res = await repo.mergePulled([srv({ id: 100 }), srv({ id: 101, note_id: 11, list_id: 7 })]);
  assert.deepEqual(res.changedNoteIds.sort(), [10, 11]);
  const cid100 = await cidOf("comment", 100);
  const rec100 = await repo.getRaw(cid100);
  assert.equal(rec100.server_id, 100);
  assert.equal(rec100.note_cid, "n1");
  assert.equal((await repo.getRaw(await cidOf("comment", 101))).note_cid, null);
  // update existing keeps cid
  await repo.mergePulled([srv({ id: 100, body: "baru" })]);
  assert.equal(await cidOf("comment", 100), cid100);
  assert.equal((await repo.getRaw(cid100)).body, "baru");
  // pending local edit is skipped
  await repo.edit(cid100, "lokal");
  await repo.mergePulled([srv({ id: 100, body: "server lagi" })]);
  assert.equal((await repo.getRaw(cid100)).body, "lokal");
  // tombstone removes
  const cid101 = await cidOf("comment", 101);
  await repo.mergePulled([srv({ id: 101, note_id: 11, deleted_at: "2026-10-21T09:00:00+07:00", body: "", quote: null })]);
  assert.equal(await repo.getRaw(cid101), undefined);
  assert.equal(await cidOf("comment", 101), undefined);
  // adopt own create via client_id (POST response lost)
  const mine = await repo.create("n1", { body: "punyaku" });
  await repo.mergePulled([srv({ id: 300, client_id: mine.cid, user_id: 1, body: "punyaku" })]);
  const adopted = await repo.getRaw(mine.cid);
  assert.equal(adopted.server_id, 300);
  assert.equal(adopted.pending, null);
  assert.equal(await cidOf("comment", 300), mine.cid);
  assert.deepEqual((await commentOps()).map((o) => o.op), ["edit"]);
  assert.equal((await repo.listForNote("n1")).filter((r) => r.body === "punyaku").length, 1);
  // replaceForNoteId: drop non-pending missing ones, keep pending
  await repo.mergePulled([srv({ id: 400 })]);
  const p = await repo.create("n1", { body: "belum terkirim" });
  res = await repo.mergePulled([srv({ id: 300, client_id: mine.cid, user_id: 1, body: "punyaku" })], { replaceForNoteId: 10 });
  assert.ok(res.changedNoteIds.includes(10));
  assert.equal(await cidOf("comment", 400), undefined);
  assert.ok(await repo.getRaw(cid100)); // pending edit kept
  assert.ok(await repo.getRaw(p.cid)); // pending create kept
  assert.ok(await repo.getRaw(mine.cid));
});

test("clearSynced removes only records without pending or sync_error", async () => {
  await repo.mergePulled([srv({ id: 100 }), srv({ id: 101 })]);
  const c101 = await cidOf("comment", 101);
  await repo.putRaw(Object.assign({}, await repo.getRaw(c101), { sync_error: { code: "rejected", message: "x" } }));
  const p = await repo.create("n1", { body: "p" });
  await repo.clearSynced();
  assert.equal(await cidOf("comment", 100), undefined);
  assert.ok(await repo.getRaw(c101));
  assert.ok(await repo.getRaw(p.cid));
});

test("decorateNotes, markRead and seedReadMarkers", async () => {
  await put("scratchpad_notes", [{ cid: "n2", server_id: 20, list_id: 7, deleted: false }]);
  await mapPut("note", 20, "n2");
  await repo.mergePulled([srv({ id: 100 }), srv({ id: 101, resolved_at: "2026-10-21T08:30:00+07:00" })]);
  await repo.create("n2", { body: "punyaku" });
  let rows = await repo.decorateNotes([{ cid: "n1", list_id: 7 }, { cid: "n2", list_id: 7 }, { cid: "n3", list_id: null }]);
  assert.equal(rows[0].comment_open_count, 1);
  assert.equal(rows[0].comment_unread, true);
  assert.equal(rows[1].comment_open_count, 1);
  assert.equal(rows[1].comment_unread, false); // own comment
  assert.equal(rows[2].comment_open_count, 0);
  assert.equal(rows[2].comment_unread, false);
  await repo.markRead("n1");
  await repo.markRead("n1");
  rows = await repo.decorateNotes([{ cid: "n1", list_id: 7 }]);
  assert.equal(rows[0].comment_unread, false);
  const readOps = (await outboxAll()).filter((o) => o.entity_type === "comment_read");
  assert.deepEqual(readOps.map((o) => [o.op, o.cid]), [["mark", "n1"]]);
  // workspace moved: cached comments no longer counted
  await setNote({ list_id: 9 });
  rows = await repo.decorateNotes([{ cid: "n1", list_id: 9 }]);
  assert.equal(rows[0].comment_open_count, 0);
  // seedReadMarkers fills only missing markers for notes the server says are read
  const before = (await metaGet("comment_reads")).n1;
  await repo.seedReadMarkers([
    { id: 10, comment_unread: false }, { id: 20, comment_unread: false }, { id: 99, comment_unread: false },
  ], "2027-01-01T00:00:00Z");
  const reads = await metaGet("comment_reads");
  assert.equal(reads.n1, before);
  assert.equal(reads.n2, "2027-01-01T00:00:00Z");
  assert.equal(Object.keys(reads).length, 2);
  await repo.seedReadMarkers([{ id: 10, comment_unread: true }], "2028-01-01T00:00:00Z");
  assert.equal((await metaGet("comment_reads")).n1, before);
});
