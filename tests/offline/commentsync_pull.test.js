"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullComments, pullNotesAndReconcile } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getAll(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result); });
}
async function get(store, key) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); });
}
function serverRow(over) {
  return Object.assign({
    id: 900, note_id: 50, list_id: 7, parent_id: null, user_id: 2, username: "b", display_name: "B",
    body: "halo", quote: null, resolved_at: null, resolved_by: null, resolved_by_name: null, edited_at: null,
    deleted_at: null, client_id: null, created_at: "2026-10-21T01:00:05Z", updated_at: "2026-10-21T01:00:05Z",
  }, over);
}
function local(over) {
  return Object.assign({
    cid: "k1", server_id: null, note_cid: "n1", note_id: 50, list_id: 7, parent_cid: null, parent_id: null,
    user_id: 1, username: "a", display_name: "A", body: "halo", quote: null, resolved_at: null, resolved_by: null,
    resolved_by_name: null, edited_at: null, deleted_at: null, client_id: "k1",
    created_at: "2026-10-21T01:00:00Z", updated_at: "2026-10-21T01:00:00Z",
    pending: "create", sync_error: null, server_copy: null,
  }, over);
}
function feed(pages, urls) {
  let i = 0;
  return (url) => { urls.push(url); const p = pages[Math.min(i, pages.length - 1)]; i++; return Promise.resolve({ json: () => Promise.resolve(p) }); };
}

test("dua halaman: keduanya di-merge, kursor tersimpan, URL kedua memakai kursor ter-encode", async () => {
  await mapPut("note", 50, "n1");
  const urls = [];
  const r = await pullComments(feed([
    { items: [serverRow({ id: 1 })], cursor: "2026-10-21T08:00:00+07:00|1", more: true },
    { items: [serverRow({ id: 2, note_id: 51 })], cursor: "2026-10-21T09:00:00+07:00|2", more: false },
  ], urls));
  assert.deepEqual(urls, [
    "/api/note-comments?since=&limit=500",
    "/api/note-comments?since=" + encodeURIComponent("2026-10-21T08:00:00+07:00|1") + "&limit=500",
  ]);
  assert.ok(urls[1].includes("%2B07%3A00"));
  assert.equal(r.pulled, 2);
  assert.equal(r.reset, false);
  assert.deepEqual(r.changedNoteIds.sort(), [50, 51]);
  assert.equal((await getAll("note_comments")).length, 2);
  assert.equal(await metaGet("comments_cursor"), "2026-10-21T09:00:00+07:00|2");
});

test("kursor tersimpan dipakai pull berikutnya; halaman tanpa item tetap memajukan kursor", async () => {
  await metaSet("comments_cursor", "c0");
  const urls = [];
  const r = await pullComments(feed([{ items: [], cursor: "c1", more: false }], urls));
  assert.equal(urls[0], "/api/note-comments?since=c0&limit=500");
  assert.equal(r.pulled, 0);
  assert.equal(await metaGet("comments_cursor"), "c1");
});

test("Review Focus 5: reset → komentar non-pending terhapus, pending tetap, lalu pull dari awal", async () => {
  await mapPut("comment", 700, "old");
  await put("note_comments", [
    local({ cid: "old", server_id: 700, pending: null, client_id: "old" }),
    local({ cid: "mine", pending: "create", client_id: "mine" }),
  ]);
  await metaSet("comments_cursor", "stale");
  const urls = [];
  const r = await pullComments(feed([
    { reset: true, items: [], cursor: "", more: false },
    { items: [serverRow({ id: 1 })], cursor: "c9", more: false },
  ], urls));
  assert.equal(urls[0], "/api/note-comments?since=stale&limit=500");
  assert.equal(urls[1], "/api/note-comments?since=&limit=500");
  assert.equal(r.reset, true);
  assert.equal(r.pulled, 1);
  assert.equal(await get("note_comments", "old"), undefined);
  assert.ok(!(await cidOf("comment", 700)));
  assert.ok(await get("note_comments", "mine"));
  assert.equal(await metaGet("comments_cursor"), "c9");
});

test("reset kedua dalam satu run berhenti dengan reset: true", async () => {
  const urls = [];
  const r = await pullComments(feed([{ reset: true, items: [], cursor: "", more: false }], urls));
  assert.equal(urls.length, 2);
  assert.equal(r.reset, true);
  assert.equal(r.pulled, 0);
});

test("maksimum 50 halaman", async () => {
  const urls = [];
  await pullComments(feed([{ items: [], cursor: "x", more: true }], urls));
  assert.equal(urls.length, 50);
});

test("gagal jaringan → reject", async () => {
  await assert.rejects(pullComments(() => Promise.reject(new Error("net"))));
});

test("Review Focus 3: pull mengembalikan komentar kita sendiri → adopsi server_id, push tidak POST lagi", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [{ cid: "n1", server_id: 50, list_id: 7, title: "N", content: "", meta_json: "{}", dirty: 0, rev: 1 }]);
  await put("note_comments", [local()]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  await pullComments(feed([{ items: [serverRow({ id: 900, user_id: 1, client_id: "k1" })], cursor: "c1", more: false }], []));
  const rec = await get("note_comments", "k1");
  assert.equal(rec.server_id, 900);
  assert.equal(rec.pending, null);
  assert.equal((await getAll("note_comments")).length, 1);
  const calls = [];
  const tr = { request(m, p) { calls.push(m + " " + p); return Promise.resolve({ status: 500, data: {} }); } };
  await pushOutbox(tr);
  assert.equal(calls.length, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("pullNotesAndReconcile menanam penanda baca untuk note comment_unread:false", async () => {
  const srv = { id: 5, title: "P", content: "", updated_at: "2026-06-03T00:00:00", comment_unread: false, list_id: 7 };
  const rawFetch = () => Promise.resolve({ json: () => Promise.resolve([srv]) });
  await pullNotesAndReconcile(rawFetch);
  const cid = await cidOf("note", 5);
  assert.ok(cid);
  const reads = await metaGet("comment_reads");
  assert.ok(reads && typeof reads[cid] === "string");
});
