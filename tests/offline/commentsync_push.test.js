"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { serverIdOf, mapPut, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

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
async function get(store, key) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); });
}
const getC = (cid) => get("note_comments", cid);
function fakeTransport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); const h = handler(method, path, body); if (h === "NETWORK") return Promise.reject(new Error("net")); return Promise.resolve(h); } };
}
function note(over) {
  return Object.assign({ cid: "n1", server_id: 50, list_id: 7, title: "N", content: "", meta_json: "{}", dirty: 0, rev: 1 }, over);
}
function comment(over) {
  return Object.assign({
    cid: "k1", server_id: null, note_cid: "n1", note_id: 50, list_id: 7, parent_cid: null, parent_id: null,
    user_id: 1, username: "a", display_name: "A", body: "halo", quote: "teks", resolved_at: null, resolved_by: null,
    resolved_by_name: null, edited_at: null, deleted_at: null, client_id: over && over.cid ? over.cid : "k1",
    created_at: "2026-10-21T01:00:00Z", updated_at: "2026-10-21T01:00:00Z",
    pending: "create", sync_error: null, server_copy: null,
  }, over);
}
function serverRow(over) {
  return Object.assign({
    id: 900, note_id: 50, list_id: 7, parent_id: null, user_id: 1, username: "a", display_name: "A",
    body: "halo", quote: "teks", resolved_at: null, resolved_by: null, resolved_by_name: null, edited_at: null,
    deleted_at: null, client_id: "k1", created_at: "2026-10-21T01:00:05Z", updated_at: "2026-10-21T01:00:05Z",
  }, over);
}
// komentar yang sudah sinkron lalu diubah lokal
function synced(over, copy) {
  const base = comment({ server_id: 900, pending: null });
  const sc = {};
  for (const k of ["note_id", "list_id", "parent_id", "user_id", "username", "display_name", "body", "quote", "resolved_at",
    "resolved_by", "resolved_by_name", "edited_at", "deleted_at", "client_id", "created_at", "updated_at"]) sc[k] = base[k];
  return Object.assign(base, { server_copy: Object.assign(sc, copy || {}) }, over);
}

test("create: POST memakai client_id, adopsi server_id + idmap, pending null", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [comment()]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  const tr = fakeTransport((m, p, b) => {
    assert.equal(m, "POST");
    assert.equal(p, "/api/scratchpad/50/comments");
    assert.deepEqual(b, { body: "halo", quote: "teks", parent_id: null, client_id: "k1" });
    return { status: 201, data: serverRow() };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  const rec = await getC("k1");
  assert.equal(rec.server_id, 900);
  assert.equal(rec.pending, null);
  assert.equal(rec.created_at, "2026-10-21T01:00:05Z");
  assert.equal(await serverIdOf("k1"), 900);
  assert.equal(await cidOf("comment", 900), "k1");
  assert.equal((await outboxAll()).length, 0);
});

test("Review Focus 1: note baru (op create antre) lalu komentar → satu drain, komentar memakai sid baru", async () => {
  await put("scratchpad_notes", [note({ server_id: null, dirty: 1 })]);
  await put("note_comments", [comment({ note_id: null })]);
  await put("_outbox", [
    { qid: 1, entity_type: "note", op: "create", cid: "n1" },
    { qid: 2, entity_type: "comment", op: "create", cid: "k1" },
  ]);
  const tr = fakeTransport((m, p) => {
    if (p === "/api/scratchpad") return { status: 200, data: { id: 77, updated_at: "2026-10-21T01:00:01Z" } };
    if (p === "/api/scratchpad/77/comments") return { status: 201, data: serverRow({ note_id: 77 }) };
    throw new Error("unexpected " + m + " " + p);
  });
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => c.path), ["/api/scratchpad", "/api/scratchpad/77/comments"]);
  const rec = await getC("k1");
  assert.equal(rec.server_id, 900);
  assert.equal(rec.note_id, 77);
  assert.equal((await outboxAll()).length, 0);
});

test("Review Focus 1: op note update antre dan gagal 500 → komentar tidak dikirim, tetap antre", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note({ dirty: 1, rev: 2 })]);
  await put("note_comments", [comment()]);
  await put("_outbox", [
    { qid: 1, entity_type: "note", op: "update", cid: "n1" },
    { qid: 2, entity_type: "comment", op: "create", cid: "k1" },
  ]);
  const tr = fakeTransport((m, p) => (p === "/api/scratchpad/50" ? { status: 500, data: {} } : { status: 201, data: serverRow() }));
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => c.path), ["/api/scratchpad/50"]);
  const ops = await outboxAll();
  assert.equal(ops.length, 2);
  assert.equal((await getC("k1")).pending, "create");
});

test("Review Focus 2: thread + balasan sama-sama pending → satu drain, balasan memakai parent_id server", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [
    comment({ cid: "t1" }),
    comment({ cid: "r1", parent_cid: "t1", quote: null, body: "balas", created_at: "2026-10-21T01:00:02Z" }),
  ]);
  await put("_outbox", [
    { qid: 1, entity_type: "comment", op: "create", cid: "t1" },
    { qid: 2, entity_type: "comment", op: "create", cid: "r1" },
  ]);
  const tr = fakeTransport((m, p, b) => (b.client_id === "t1"
    ? { status: 201, data: serverRow({ id: 901, client_id: "t1" }) }
    : { status: 201, data: serverRow({ id: 902, client_id: "r1", parent_id: 901, body: "balas", quote: null }) }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 2);
  assert.equal(tr.calls.length, 2);
  assert.equal(tr.calls[1].body.parent_id, 901);
  assert.equal(tr.calls[1].body.quote, null);
  assert.equal((await getC("r1")).server_id, 902);
  assert.equal((await getC("r1")).parent_id, 901);
  assert.equal((await outboxAll()).length, 0);
});

test("Review Focus 2: create thread 503 → balasan ditahan (tidak dikirim)", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [comment({ cid: "t1" }), comment({ cid: "r1", parent_cid: "t1", quote: null })]);
  await put("_outbox", [
    { qid: 1, entity_type: "comment", op: "create", cid: "t1" },
    { qid: 2, entity_type: "comment", op: "create", cid: "r1" },
  ]);
  const tr = fakeTransport(() => ({ status: 503, data: {} }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal((await outboxAll()).length, 2);
});

for (const [status, code, message] of [
  [409, "not_shared", "Catatan ini sudah tidak dibagikan ke workspace."],
  [404, "access", "Kamu sudah tidak punya akses ke catatan ini."],
  [403, "access", "Kamu sudah tidak punya akses ke catatan ini."],
  [422, "invalid", "Komentar tidak valid."],
]) {
  test(`create → ${status}: sync_error ${code}, op hilang, record tetap`, async () => {
    await mapPut("note", 50, "n1");
    await put("scratchpad_notes", [note()]);
    await put("note_comments", [comment()]);
    await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
    const tr = fakeTransport(() => ({ status, data: { detail: status === 409 ? { code: "NOTE_NOT_SHARED" } : "x" } }));
    const r = await pushOutbox(tr);
    assert.equal(r.failed, 1);
    const rec = await getC("k1");
    assert.ok(rec);
    assert.equal(rec.body, "halo");
    assert.deepEqual(rec.sync_error, { code, message });
    assert.equal((await outboxAll()).length, 0);
  });
}

test("create: note tanpa sid dan tanpa op note → sync_error access, tanpa request", async () => {
  // note create gagal permanen (sync_error) → healStrandedNotes tidak mengantre ulang
  await put("scratchpad_notes", [note({ server_id: null, sync_error: { status: 422 } })]);
  await put("note_comments", [comment({ note_id: null })]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  const tr = fakeTransport(() => { throw new Error("no request expected"); });
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await getC("k1")).sync_error.code, "access");
  assert.equal((await outboxAll()).length, 0);
});

test("create lalu resolve lokal (leburan) → setelah create sukses ada PATCH resolve", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [comment({ resolved_at: "2026-10-21T01:00:03Z", resolved_by: 1, resolved_by_name: "A" })]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  const tr = fakeTransport((m, p, b) => {
    if (m === "POST") return { status: 201, data: serverRow() };
    assert.equal(m, "PATCH");
    assert.equal(p, "/api/note-comments/900");
    assert.deepEqual(b, { resolved: true });
    return { status: 200, data: serverRow({ resolved_at: "2026-10-21T01:00:09Z", resolved_by: 1, resolved_by_name: "A" }) };
  });
  await pushOutbox(tr);
  const mid = await getC("k1");
  assert.equal(mid.server_id, 900);
  assert.equal(mid.pending, "resolve");
  assert.ok(mid.resolved_at);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.entity_type, o.op, o.cid]), [["comment", "resolve", "k1"]]);
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => c.method), ["POST", "PATCH"]);
  const rec = await getC("k1");
  assert.equal(rec.pending, null);
  assert.equal(rec.server_copy, null);
  assert.equal(rec.resolved_at, "2026-10-21T01:00:09Z");
  assert.equal((await outboxAll()).length, 0);
});

test("edit sukses → adopsi, pending null, server_copy null", async () => {
  await put("note_comments", [synced({ body: "baru", pending: "edit" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "edit", cid: "k1" }]);
  const tr = fakeTransport((m, p, b) => {
    assert.equal(m, "PATCH"); assert.equal(p, "/api/note-comments/900"); assert.deepEqual(b, { body: "baru" });
    return { status: 200, data: serverRow({ body: "baru", edited_at: "2026-10-21T02:00:00Z" }) };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  const rec = await getC("k1");
  assert.equal(rec.body, "baru");
  assert.equal(rec.edited_at, "2026-10-21T02:00:00Z");
  assert.equal(rec.pending, null);
  assert.equal(rec.server_copy, null);
});

test("edit sukses sementara op resolve masih antre → resolved_* lokal dipertahankan, pending resolve", async () => {
  await put("note_comments", [synced({ body: "baru", pending: "resolve", resolved_at: "2026-10-21T02:00:00Z", resolved_by: 1, resolved_by_name: "A" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [
    { qid: 1, entity_type: "comment", op: "edit", cid: "k1" },
    { qid: 2, entity_type: "comment", op: "resolve", cid: "k1" },
  ]);
  const tr = fakeTransport((m, p, b) => (b.body != null
    ? { status: 200, data: serverRow({ body: "baru", edited_at: "x" }) }
    : { status: 503, data: {} }));
  await pushOutbox(tr);
  const rec = await getC("k1");
  assert.equal(rec.body, "baru");
  assert.equal(rec.resolved_at, "2026-10-21T02:00:00Z");
  assert.equal(rec.pending, "resolve");
  assert.ok(rec.server_copy);
  assert.equal(rec.server_copy.body, "baru"); // salinan server maju ke versi terbaru
  assert.deepEqual((await outboxAll()).map((o) => o.op), ["resolve"]);
});

test("edit 403 → body kembali dari server_copy, sync_error rejected, semua op komentar dibuang", async () => {
  await put("note_comments", [synced({ body: "baru", pending: "edit" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [
    { qid: 1, entity_type: "comment", op: "edit", cid: "k1" },
    { qid: 2, entity_type: "comment", op: "resolve", cid: "k1" },
  ]);
  const tr = fakeTransport(() => ({ status: 403, data: { detail: "no" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  assert.equal(tr.calls.length, 1);
  const rec = await getC("k1");
  assert.equal(rec.body, "halo");
  assert.equal(rec.pending, null);
  assert.equal(rec.server_copy, null);
  assert.deepEqual(rec.sync_error, { code: "rejected", message: "Perubahan tidak tersimpan." });
  assert.equal((await outboxAll()).length, 0);
});

test("edit 404 → record lokal + balasannya hilang, idmap dihapus", async () => {
  await put("note_comments", [
    synced({ body: "baru", pending: "edit" }),
    comment({ cid: "r9", server_id: 905, parent_cid: "k1", parent_id: 900, pending: null }),
  ]);
  await mapPut("comment", 900, "k1");
  await mapPut("comment", 905, "r9");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "edit", cid: "k1" }]);
  const tr = fakeTransport(() => ({ status: 404, data: { detail: "Komentar tidak ditemukan" } }));
  await pushOutbox(tr);
  assert.equal(await getC("k1"), undefined);
  assert.equal(await getC("r9"), undefined);
  assert.equal(await cidOf("comment", 900), undefined);
  assert.equal(await cidOf("comment", 905), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("resolve 422 → resolved_* kembali dari server_copy, rejected", async () => {
  await put("note_comments", [synced({ pending: "resolve", resolved_at: "2026-10-21T02:00:00Z", resolved_by: 1, resolved_by_name: "A" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "resolve", cid: "k1" }]);
  const tr = fakeTransport(() => ({ status: 422, data: { detail: "Hanya thread yang bisa diselesaikan" } }));
  await pushOutbox(tr);
  const rec = await getC("k1");
  assert.equal(rec.resolved_at, null);
  assert.equal(rec.sync_error.code, "rejected");
  assert.equal((await outboxAll()).length, 0);
});

test("delete sukses → DELETE, record + balasan hilang", async () => {
  await put("note_comments", [
    synced({ pending: "delete", deleted_at: "2026-10-21T02:00:00Z" }),
    comment({ cid: "r9", server_id: 905, parent_cid: "k1", parent_id: 900, pending: null }),
  ]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "delete", cid: "k1" }]);
  const tr = fakeTransport((m, p) => { assert.equal(m, "DELETE"); assert.equal(p, "/api/note-comments/900"); return { status: 200, data: { ok: true } }; });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(await getC("k1"), undefined);
  assert.equal(await getC("r9"), undefined);
  assert.equal(await cidOf("comment", 900), undefined);
});

test("delete 404 → record hilang", async () => {
  await put("note_comments", [synced({ pending: "delete", deleted_at: "2026-10-21T02:00:00Z" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "delete", cid: "k1" }]);
  await pushOutbox(fakeTransport(() => ({ status: 404, data: {} })));
  assert.equal(await getC("k1"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("delete 500 → op tetap, record tetap", async () => {
  await put("note_comments", [synced({ pending: "delete", deleted_at: "2026-10-21T02:00:00Z" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "delete", cid: "k1" }]);
  await pushOutbox(fakeTransport(() => ({ status: 500, data: {} })));
  assert.equal((await getC("k1")).pending, "delete");
  assert.equal((await outboxAll()).length, 1);
});

test("delete 403 → tombstone batal (server_copy), rejected", async () => {
  await put("note_comments", [synced({ pending: "delete", deleted_at: "2026-10-21T02:00:00Z" })]);
  await mapPut("comment", 900, "k1");
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "delete", cid: "k1" }]);
  await pushOutbox(fakeTransport(() => ({ status: 403, data: {} })));
  const rec = await getC("k1");
  assert.equal(rec.deleted_at, null);
  assert.equal(rec.pending, null);
  assert.equal(rec.sync_error.code, "rejected");
  assert.equal((await outboxAll()).length, 0);
});

test("komentar dihapus lokal saat create in-flight → DELETE server diantre", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [comment()]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  const { remove } = require("../../static/offline/commentrepo.js");
  const calls = [];
  const tr = {
    calls,
    request(method, path, body) {
      calls.push(method + " " + path);
      if (method === "POST") return remove("k1").then(() => ({ status: 201, data: serverRow() }));
      return Promise.resolve({ status: 200, data: { ok: true } });
    },
  };
  await pushOutbox(tr);
  assert.deepEqual((await outboxAll()).map((o) => o.op), ["delete"]);
  assert.equal(await getC("k1") && (await getC("k1")).deleted_at != null, true);
  await pushOutbox(tr);
  assert.deepEqual(calls, ["POST /api/scratchpad/50/comments", "DELETE /api/note-comments/900"]);
  assert.equal(await getC("k1"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("comment_read → POST /read, op hilang", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("_outbox", [{ qid: 1, entity_type: "comment_read", op: "mark", cid: "n1" }]);
  const tr = fakeTransport((m, p) => { assert.equal(m, "POST"); assert.equal(p, "/api/scratchpad/50/comments/read"); return { status: 200, data: { ok: true } }; });
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal((await outboxAll()).length, 0);
});

test("comment_read 403 → op dibuang", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("_outbox", [{ qid: 1, entity_type: "comment_read", op: "mark", cid: "n1" }]);
  await pushOutbox(fakeTransport(() => ({ status: 403, data: {} })));
  assert.equal((await outboxAll()).length, 0);
});

test("comment_read: note tanpa sid dan tanpa op note → op dibuang tanpa request", async () => {
  await put("scratchpad_notes", [note({ server_id: null, sync_error: { status: 422 } })]);
  await put("_outbox", [{ qid: 1, entity_type: "comment_read", op: "mark", cid: "n1" }]);
  const tr = fakeTransport(() => { throw new Error("no request expected"); });
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("comment_read: note tanpa sid dengan op create note yang gagal 503 → ditahan", async () => {
  await put("scratchpad_notes", [note({ server_id: null, dirty: 1 })]);
  await put("_outbox", [
    { qid: 1, entity_type: "note", op: "create", cid: "n1" },
    { qid: 2, entity_type: "comment_read", op: "mark", cid: "n1" },
  ]);
  const tr = fakeTransport(() => ({ status: 503, data: {} }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal((await outboxAll()).length, 2);
});

test("create body 'halo\\n' dan server mengembalikan 'halo' (strip) → tidak ada edit palsu, pending null", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [comment({ body: "halo\n" })]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  const tr = fakeTransport(() => ({ status: 201, data: serverRow({ body: "halo" }) }));
  await pushOutbox(tr);
  const rec = await getC("k1");
  assert.equal(rec.pending, null);
  assert.equal(rec.body, "halo");
  assert.equal(rec.server_copy, null);
  assert.equal((await outboxAll()).length, 0);
  assert.equal(tr.calls.length, 1);
});

test("edit lokal selama POST create in-flight → op edit diantre, isi lokal dipertahankan", async () => {
  await mapPut("note", 50, "n1");
  await put("scratchpad_notes", [note()]);
  await put("note_comments", [comment()]);
  await put("_outbox", [{ qid: 1, entity_type: "comment", op: "create", cid: "k1" }]);
  const calls = [];
  const tr = {
    request(method, path, body) {
      calls.push(method);
      if (method !== "POST") return Promise.resolve({ status: 200, data: serverRow({ body: "baru", edited_at: "x" }) });
      return getC("k1").then((r) => put("note_comments", [Object.assign({}, r, { body: "baru" })]))
        .then(() => ({ status: 201, data: serverRow() }));
    },
  };
  await pushOutbox(tr);
  const rec = await getC("k1");
  assert.equal(rec.server_id, 900);
  assert.equal(rec.body, "baru");
  assert.equal(rec.pending, "edit");
  assert.equal(rec.server_copy.body, "halo");
  assert.deepEqual((await outboxAll()).map((o) => o.op), ["edit"]);
  await pushOutbox(tr);
  assert.deepEqual(calls, ["POST", "PATCH"]);
  assert.equal((await getC("k1")).pending, null);
});
