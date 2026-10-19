"use strict";
// Workstream C (audit 2026-10-15): editor note — T4 (op update digabung, tanpa PUT kosong), T5 (editor melacak
// revisi record lokal, noteSaved {cids}), prinsip 7 (salinan konflik pada 409 & pull edit-vs-edit), T6 (autosave
// offline + flush saat tutup), K4 klien (share → adopsi list_id/base_rev; PUT tanpa list_id), S15 (rewrite
// [tasklink:<cid>] → [tasklink:<sid>]), Low (api.del).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { getEntityTags, setEntityTags } = require("../../static/offline/tagrepo.js");
const noterepo = require("../../static/offline/noterepo.js");
const { pushOutbox, noteToUpdatePayload } = require("../../static/offline/syncpush.js");
const { pullNotes } = require("../../static/offline/syncpull.js");
const { listNotices, dismissNotice } = require("../../static/offline/syncconflict.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function get(store, cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(cid); q.onsuccess = () => res(q.result); });
}
async function all(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
function note(over) {
  return Object.assign({
    cid: over.cid, server_id: over.server_id != null ? over.server_id : null, title: "N", content: "c",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, meta_json: "{}",
    list_id: over.list_id != null ? over.list_id : null, user_id: 1, last_edited_by: null,
    created_at: "x", updated_at: "2026-10-15T09:00:00.000Z", deleted: false, dirty: 1, base_rev: null, rev: 1,
  }, over);
}
function srvNote(over) {
  return Object.assign({
    id: over.id, title: "S", content: "srv", tags: [], linked_to: [], linked_task_ids: [], list_id: null, user_id: 1,
    pinned: 0, meta_json: "{}", last_edited_by: 7, last_editor_username: "bob", last_editor_display_name: "Bob",
    created_at: "2026-10-01T00:00:00", updated_at: "2026-10-15T10:00:00",
  }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const h = handler(method, path, body, calls.length);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h);
    },
  };
}
// Stub window + CustomEvent supaya event UI (noteSaved, tf:outbox-queued, tf:note-tasklinks-rewritten) tertangkap.
function withWindowEvents(fn) {
  const events = [];
  const hadWindow = typeof globalThis.window !== "undefined";
  const prev = globalThis.window;
  globalThis.window = { dispatchEvent: (ev) => { events.push(ev); return true; } };
  if (typeof globalThis.CustomEvent !== "function") {
    globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  }
  return Promise.resolve().then(fn).then(
    (r) => { if (hadWindow) globalThis.window = prev; else delete globalThis.window; return { r, events }; },
    (e) => { if (hadWindow) globalThis.window = prev; else delete globalThis.window; throw e; },
  );
}

// ── T4: op update digabung per cid; tidak ada PUT untuk record bersih ────────────────────────────
test("updateNote coalesces pending update ops: three bursts of typing leave ONE update op (other ops untouched)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0 })]);
  await put("scratchpad_notes", [note({ cid: "m", server_id: 8, dirty: 0 })]);
  await outboxAdd({ op: "update", entity_type: "note", cid: "m", payload: {} });
  await outboxAdd({ op: "pin", entity_type: "note", cid: "n", payload: { pinned: true } });
  await noterepo.updateNote("n", { content: "a" }, { now: "2026-10-15T10:00:00.000Z" });
  await noterepo.updateNote("n", { content: "ab" }, { now: "2026-10-15T10:00:01.000Z" });
  await noterepo.updateNote("n", { content: "abc" }, { now: "2026-10-15T10:00:02.000Z" });
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.entity_type, o.op, o.cid]).sort(), [["note", "pin", "n"], ["note", "update", "m"], ["note", "update", "n"]]);
  const rec = await get("scratchpad_notes", "n");
  assert.equal(rec.content, "abc");
  assert.equal(rec.rev, 4);
  assert.equal(rec.dirty, 1);
});

test("coalesced op still pushes the LATEST content once (CAS rev) and leaves the record clean", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0, base_rev: "2026-10-15T08:00:00" })]);
  await mapPut("note", 7, "n");
  await noterepo.updateNote("n", { content: "v1" }, {});
  await noterepo.updateNote("n", { content: "v2" }, {});
  const tr = fakeTransport(() => ({ status: 200, data: { id: 7, updated_at: "2026-10-15T11:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls.length, 1);
  assert.equal(tr.calls[0].body.content, "v2");
  assert.equal(tr.calls[0].body.base_rev, "2026-10-15T08:00:00");
  const rec = await get("scratchpad_notes", "n");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-10-15T11:00:00");
  assert.equal((await outboxAll()).length, 0);
});

test("an update op for a CLEAN note is dropped without a PUT (no updated_at / 'edited by' bump)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0, base_rev: "2026-10-15T08:00:00" })]);
  await mapPut("note", 7, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const tr = fakeTransport(() => { throw new Error("tidak boleh PUT"); });
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await outboxAll()).length, 0);
});

// ── Prinsip 7: 409 REV_MISMATCH → salinan konflik ────────────────────────────────────────────────
test("PUT 409 REV_MISMATCH: local version becomes '(konflik) <title>' (personal, create op), original adopts server row + notice", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9, title: "Rapat", content: "versi saya", base_rev: "2026-10-15T08:00:00", linked_to_cids: '["x"]' })]);
  await mapPut("note", 7, "n");
  await setEntityTags("note", "n", ["lokal"]);
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const current = srvNote({ id: 7, list_id: 9, title: "Rapat (Bob)", content: "versi bob", tags: ["server"], updated_at: "2026-10-15T09:30:00" });
  const tr = fakeTransport(() => ({ status: 409, data: { detail: { code: "REV_MISMATCH", current: current } } }));
  const { r, events } = await withWindowEvents(() => pushOutbox(tr));
  assert.equal(r.conflictCopies, 1);
  assert.equal(tr.calls[0].body.base_rev, "2026-10-15T08:00:00");
  const rows = await all("scratchpad_notes");
  assert.equal(rows.length, 2);
  const orig = rows.find((x) => x.cid === "n");
  const copy = rows.find((x) => x.cid !== "n");
  // record asli = versi server, bersih, base_rev = revisi server, tanpa sync_error
  assert.equal(orig.title, "Rapat (Bob)");
  assert.equal(orig.content, "versi bob");
  assert.equal(orig.dirty, 0);
  assert.equal(orig.base_rev, "2026-10-15T09:30:00");
  assert.equal(orig.server_id, 7);
  assert.equal(orig.sync_error, undefined);
  assert.deepEqual(orig.notice, { kind: "conflict_copy", title: "Rapat (Bob)", copyTitle: "(konflik) Rapat", editor: "Bob" });
  assert.deepEqual((await getEntityTags("note", "n")).map((t) => t.name), ["server"]);
  // salinan = versi lokal, pribadi, belum punya server id, tag lokal ikut
  assert.equal(copy.title, "(konflik) Rapat");
  assert.equal(copy.content, "versi saya");
  assert.equal(copy.list_id, null);
  assert.equal(copy.server_id, null);
  assert.equal(copy.dirty, 1);
  assert.equal(copy.linked_to_cids, '["x"]');
  assert.deepEqual((await getEntityTags("note", copy.cid)).map((t) => t.name), ["lokal"]);
  // outbox: op update asli dibuang, hanya create salinan; UI diberi tahu
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["create", copy.cid]]);
  assert.ok(events.some((e) => e.type === "noteSaved" && e.detail.cids.includes("n") && e.detail.cids.includes(copy.cid)));
  assert.ok(events.some((e) => e.type === "tf:outbox-queued"));
  // conflict bar: notice conflict_copy dengan copyTitle; Tutup menghapusnya
  const notices = await listNotices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, "conflict_copy");
  assert.equal(notices[0].copyTitle, "(konflik) Rapat");
  await dismissNotice("note", "n");
  assert.equal((await listNotices()).length, 0);
  // drain berikutnya: salinan di-POST sebagai note baru dengan client_id-nya sendiri, tanpa list_id
  const tr2 = fakeTransport(() => ({ status: 200, data: { id: 99, updated_at: "2026-10-15T12:00:00" } }));
  await pushOutbox(tr2);
  assert.equal(tr2.calls.length, 1);
  assert.equal(tr2.calls[0].method, "POST");
  assert.equal(tr2.calls[0].body.title, "(konflik) Rapat");
  assert.equal(tr2.calls[0].body.list_id, null);
  assert.equal(tr2.calls[0].body.client_id, copy.cid);
  assert.equal(await serverIdOf(copy.cid), 99);
});

test("PUT 409 that is NOT a rev mismatch stays a permanent error (sync_error, op dropped, content kept)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, content: "saya", base_rev: "2026-10-15T08:00:00" })]);
  await mapPut("note", 7, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const tr = fakeTransport(() => ({ status: 409, data: { detail: "judul sudah dipakai" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  const rec = await get("scratchpad_notes", "n");
  assert.equal(rec.content, "saya");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.sync_error.status, 409);
  assert.equal((await all("scratchpad_notes")).length, 1);
});

test("keepLocalAsConflictCopy keeps keystrokes made between the pull read and the write (reads inside the transaction)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, content: "v1", base_rev: "2026-10-15T08:00:00" })]);
  await mapPut("note", 7, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  await noterepo.updateNote("n", { content: "v1 + ketikan baru" }, {}); // "di sela-sela": sebelum salinan dibuat
  const r = await noterepo.keepLocalAsConflictCopy("n", srvNote({ id: 7, content: "server" }), { editor: "Bob" });
  assert.equal(r.copy.content, "v1 + ketikan baru");
  assert.equal(r.original.content, "server");
});

// ── Prinsip 7 pada pull + notice; makeConflictCopy ("Simpan versi saya") ────────────────────────
test("pullNotes edit-vs-edit: both sides preserved, original adopts server, notice present, changedCids reported", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, title: "Mine", content: "lokal", base_rev: "2026-10-15T08:00:00" })]);
  await mapPut("note", 7, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const res = await pullNotes([srvNote({ id: 7, title: "Theirs", content: "server", updated_at: "2026-10-15T09:30:00" })]);
  assert.equal(res.conflictCopies, 1);
  const rows = await all("scratchpad_notes");
  const orig = rows.find((x) => x.cid === "n");
  const copy = rows.find((x) => x.cid !== "n");
  assert.equal(orig.content, "server");
  assert.equal(orig.dirty, 0);
  assert.equal(orig.notice.kind, "conflict_copy");
  assert.equal(orig.notice.editor, "Bob");
  assert.equal(copy.content, "lokal");
  assert.equal(copy.title, "(konflik) Mine");
  assert.deepEqual(res.changedCids.sort(), ["n", copy.cid].sort());
  assert.deepEqual((await outboxAll()).map((o) => [o.op, o.cid]), [["create", copy.cid]]);
  assert.equal((await listNotices())[0].copyTitle, "(konflik) Mine");
});

test("pullNotes: never-synced note (base_rev null) matched by client_id is NOT a conflict — local wins, create op kept", async () => {
  await put("scratchpad_notes", [note({ cid: "c1", server_id: null, content: "lokal", base_rev: null })]);
  await outboxAdd({ op: "create", entity_type: "note", cid: "c1", payload: {} });
  const res = await pullNotes([srvNote({ id: 70, client_id: "c1", content: "lokal (POST hilang)", updated_at: "2026-10-15T09:00:00" })]);
  assert.equal(res.conflictCopies, 0);
  const rows = await all("scratchpad_notes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, "lokal");
  assert.deepEqual((await outboxAll()).map((o) => o.op), ["create"]);
});

test("makeConflictCopy ('Simpan versi saya'): current record copied to a personal '(konflik)' note with create op; original untouched; accepts server id", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: 9, title: "Doc", content: "versi bob (sudah di-pull)", dirty: 0, base_rev: "2026-10-15T09:30:00" })]);
  await setEntityTags("note", "n", ["t"]);
  const { r: copy, events } = await withWindowEvents(() => noterepo.makeConflictCopy(7, {}));
  assert.ok(copy && copy.cid !== "n");
  assert.equal(copy.title, "(konflik) Doc");
  assert.equal(copy.content, "versi bob (sudah di-pull)");
  assert.equal(copy.list_id, null);
  assert.deepEqual((await getEntityTags("note", copy.cid)).map((t) => t.name), ["t"]);
  const orig = await get("scratchpad_notes", "n");
  assert.equal(orig.content, "versi bob (sudah di-pull)");
  assert.equal(orig.dirty, 0);
  assert.deepEqual((await outboxAll()).map((o) => [o.op, o.cid]), [["create", copy.cid]]);
  assert.ok(events.some((e) => e.type === "tf:outbox-queued"));
  assert.equal(noterepo.conflictTitle("(konflik) X"), "(konflik) X"); // awalan tidak digandakan
});

// ── K4 klien: share → adopsi list_id/base_rev; PUT tanpa list_id ────────────────────────────────
test("adoptServerFields after PATCH /share writes list_id + updated_at→base_rev (rev++), content stays; next PUT omits list_id and sends the new base_rev", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: null, content: "isi", dirty: 1, base_rev: "2026-10-15T08:00:00", rev: 3 })]);
  await mapPut("note", 7, "n");
  await outboxAdd({ op: "update", entity_type: "note", cid: "n", payload: {} });
  const row = srvNote({ id: 7, list_id: 9, content: "isi lama di server", updated_at: "2026-10-15T09:45:00" });
  const rec = await noterepo.adoptServerFields(7, row); // id server (seperti note.id di editor)
  assert.equal(rec.list_id, 9);
  assert.equal(rec.base_rev, "2026-10-15T09:45:00");
  assert.equal(rec.updated_at, "2026-10-15T09:45:00");
  assert.equal(rec.content, "isi"); // isi lokal tidak ditimpa
  assert.equal(rec.dirty, 1);
  assert.equal(rec.rev, 4);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 7, updated_at: "2026-10-15T10:00:00" } }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.ok(!("list_id" in tr.calls[0].body), "PUT tidak boleh membawa list_id basi");
  assert.equal(tr.calls[0].body.base_rev, "2026-10-15T09:45:00");
  assert.equal(tr.calls[0].body.content, "isi");
  // unshare: list_id null di baris server juga diadopsi
  const rec2 = await noterepo.adoptServerFields("n", srvNote({ id: 7, list_id: null, updated_at: "2026-10-15T10:30:00" }));
  assert.equal(rec2.list_id, null);
  assert.equal(await noterepo.adoptServerFields("tidak-ada", row), null);
});

test("pullNotes adopts the server list_id for a note whose updated_at equals base_rev (share without bump / stale local list_id)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, list_id: null, content: "isi", dirty: 0, base_rev: "2026-10-15T09:00:00", updated_at: "2026-10-15T09:00:00" })]);
  await put("scratchpad_notes", [note({ cid: "d", server_id: 8, list_id: 5, content: "dirty", dirty: 1, base_rev: "2026-10-15T09:00:00", updated_at: "2026-10-15T09:00:00" })]);
  await mapPut("note", 7, "n");
  await mapPut("note", 8, "d");
  await outboxAdd({ op: "update", entity_type: "note", cid: "d", payload: {} });
  const res = await pullNotes([
    srvNote({ id: 7, list_id: 9, content: "isi", updated_at: "2026-10-15T09:00:00" }),
    srvNote({ id: 8, list_id: null, content: "server", updated_at: "2026-10-15T09:00:00" }), // di-unshare pemilik
  ]);
  assert.equal(res.listAdopted, 2);
  assert.equal((await get("scratchpad_notes", "n")).list_id, 9);
  assert.equal((await get("scratchpad_notes", "n")).updated_at, "2026-10-15T09:00:00");
  const d = await get("scratchpad_notes", "d");
  assert.equal(d.list_id, null); // list_id server otoritatif juga untuk record dirty (PUT tidak mengirim list_id)
  assert.equal(d.content, "dirty"); // isi lokal tetap
  assert.equal(d.dirty, 1);
});

test("pullNotes writeNote bumps the local rev so an in-flight push cannot mark the pulled version clean with a stale sentRev", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0, base_rev: "2026-10-15T08:00:00", rev: 5 })]);
  await mapPut("note", 7, "n");
  await pullNotes([srvNote({ id: 7, content: "baru", updated_at: "2026-10-15T09:00:00" })]);
  const rec = await get("scratchpad_notes", "n");
  assert.equal(rec.content, "baru");
  assert.equal(rec.rev, 6);
});

// ── S15: rewrite [tasklink:<cid>] → [tasklink:<sid>] ─────────────────────────────────────────────
test("rewriteTaskLinks rewrites every note containing the cid (plain + escaped), marks dirty + queues ONE update op, emits event", async () => {
  await put("scratchpad_notes", [
    note({ cid: "a", server_id: 1, dirty: 0, rev: 2, content: "lihat [tasklink:t-cid-1] dan \\[tasklink:t-cid-1\\]", updated_at: "2026-10-15T09:00:00.000Z" }),
    note({ cid: "b", server_id: 2, dirty: 0, content: "tanpa link" }),
    note({ cid: "c", server_id: 3, dirty: 0, content: "[tasklink:t-cid-10] bukan t-cid-1" }),
    note({ cid: "del", server_id: 4, dirty: 0, deleted: true, content: "[tasklink:t-cid-1]" }),
  ]);
  const { r: done, events } = await withWindowEvents(() => noterepo.rewriteTaskLinks("t-cid-1", 55));
  assert.deepEqual(done, ["a"]);
  const a = await get("scratchpad_notes", "a");
  assert.equal(a.content, "lihat [tasklink:55] dan \\[tasklink:55\\]");
  assert.equal(a.dirty, 1);
  assert.equal(a.rev, 3);
  assert.equal(a.updated_at, "2026-10-15T09:00:00.000Z"); // bukan editan pengguna: updated_at tetap
  assert.equal((await get("scratchpad_notes", "c")).content, "[tasklink:t-cid-10] bukan t-cid-1");
  assert.equal((await get("scratchpad_notes", "del")).content, "[tasklink:t-cid-1]");
  assert.deepEqual((await outboxAll()).map((o) => [o.op, o.cid]), [["update", "a"]]);
  const ev = events.find((e) => e.type === "tf:note-tasklinks-rewritten");
  assert.deepEqual(ev.detail, { task_cid: "t-cid-1", task_id: 55, cids: ["a"] });
  assert.ok(events.some((e) => e.type === "tf:outbox-queued"));
  assert.deepEqual(await noterepo.rewriteTaskLinks("tidak-ada", 1), []);
});

test("task create push rewrites tasklinks in notes and the note update is pushed on the next drain", async () => {
  await put("tasks", [{
    cid: "t-cid-1", server_id: null, title: "Beli susu", description: "", gtd_status: "inbox", priority: "P2", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", assigned_to: null, progress: 0, parent_cid: null,
    recurrence_type: null, recurrence_days: null, deleted: false, dirty: 1, base_rev: null, rev: 1,
  }]);
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0, base_rev: "2026-10-15T08:00:00", content: "todo: [tasklink:t-cid-1]", linked_task_cids: '["t-cid-1"]' })]);
  await mapPut("note", 7, "n");
  await outboxAdd({ op: "create", entity_type: "task", cid: "t-cid-1", payload: {} });
  const tr = fakeTransport((m, p) => (p === "/api/tasks" ? { status: 200, data: { id: 55, updated_at: "2026-10-15T09:00:00" } } : { status: 200, data: { id: 7, updated_at: "2026-10-15T09:00:05" } }));
  await pushOutbox(tr);
  assert.equal((await get("scratchpad_notes", "n")).content, "todo: [tasklink:55]");
  await pushOutbox(tr);
  const putCall = tr.calls.find((c) => c.method === "PUT" && c.path === "/api/scratchpad/7");
  assert.ok(putCall, "note harus di-PUT dengan id server");
  assert.equal(putCall.body.content, "todo: [tasklink:55]");
  assert.deepEqual(putCall.body.linked_task_ids, [55]); // cid task di linked_task_cids → id server saat push
  assert.equal((await get("scratchpad_notes", "n")).dirty, 0);
});

test("updateNote keeps cid task ids in linked_task_cids (editor no longer filters to numeric ids)", async () => {
  await put("tasks", [{ cid: "t-cid-1", server_id: null, title: "T", deleted: false, dirty: 1 }, { cid: "t2", server_id: 42, title: "U", deleted: false, dirty: 0 }]);
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0 })]);
  await noterepo.updateNote("n", { content: "[tasklink:t-cid-1] [tasklink:42]", linked_task_ids: ["t-cid-1", 42] }, {});
  assert.deepEqual(JSON.parse((await get("scratchpad_notes", "n")).linked_task_cids), ["t-cid-1", "t2"]);
});

// ── notequery.shape: cid + base_rev untuk editor ──────────────────────────────────────────────────
test("GET /api/scratchpad/:id (local) exposes cid + base_rev so the editor can track the record revision", async () => {
  const { getNote } = require("../../static/offline/notequery.js");
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0, base_rev: "2026-10-15T08:00:00" })]);
  const shaped = await getNote("n");
  assert.equal(shaped.id, 7);
  assert.equal(shaped.cid, "n");
  assert.equal(shaped.base_rev, "2026-10-15T08:00:00");
});

// ── index.html: NoteModal, sync() noteSaved {cids}, conflict bar, api.del ────────────────────────
const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const noteModal = (indexHtml.match(/function NoteModal\([\s\S]*?\n\}\n/) || [""])[0];

test("index.html NoteModal: snapshot-based autosave, no navigator.onLine guard, revision check before saving", () => {
  assert.ok(noteModal.length > 1000, "NoteModal harus ada");
  const autosave = noteModal.match(/\/\/ Autosave: debounced 2\.5s[\s\S]*?\}, \[title, content, tags, linkedTaskIds, paperConfig\]\);/);
  assert.ok(autosave, "efek autosave harus ada");
  assert.ok(!/navigator\.onLine/.test(autosave[0]), "T6: guard navigator.onLine dihapus dari autosave");
  assert.match(autosave[0], /noteSnapOf\(editorStateRef\.current\) === lastSavedSnapRef\.current/, "T4: tidak menyimpan bila sama dengan snapshot");
  assert.match(noteModal, /const autosaveNow = async \(\) => \{[\s\S]*?recordChangedElsewhere\(fresh\)[\s\S]*?showRemoteBanner\(fresh\)/, "T5: cek revisi record lokal sebelum menyimpan");
  assert.match(noteModal, /const loadedBaseRevRef = useRef\(note\?\.base_rev \?\? null\);/);
  assert.match(noteModal, /if \(saved && saved\.updated_at\) lastKnownAtRef\.current = saved\.updated_at;/, "T5: lastKnownAt diperbarui setelah autosave sendiri");
  // S15: autosave mengirim semua id (termasuk cid), tidak lagi hanya angka
  assert.match(noteModal, /linked_task_ids: st\.linkedTaskIds,/);
  assert.ok(!/linked_task_ids: linkedTaskIds\.filter\(id => typeof id === 'number'\)/.test(noteModal));
});

test("index.html NoteModal: flush on close/unmount, noteSaved listener for personal notes too, server poll via window.__syncRawFetch", () => {
  assert.match(noteModal, /const flushAutosave = async \(\) => \{/);
  assert.match(noteModal, /useEffect\(\(\) => \(\) => \{ try \{ flushAutosaveRef\.current\(\); \} catch \(_\) \{\} \}, \[\]\);/, "flush saat unmount");
  assert.match(noteModal, /await flushAutosave\(\);\s*\} catch \{\}\s*\}\s*onClose\(\);/, "tombol ✕ memakai flush, bukan PUT tanpa syarat");
  assert.match(noteModal, /window\.addEventListener\("noteSaved", handler\);/);
  assert.match(noteModal, /if \(cids && myCid && !cids\.includes\(myCid\)\) return;/);
  const poll = noteModal.match(/\/\/ Polling 5 detik untuk note bersama[\s\S]*?\}, \[note\?\.id, noteListId\]\);/);
  assert.ok(poll, "poll note bersama harus ada");
  assert.match(poll[0], /window\.__syncRawFetch/);
  assert.match(poll[0], /window\.__syncNow/);
  assert.match(poll[0], /await checkLocalRevision\(\);/, "fallback ke record lokal");
  assert.match(indexHtml, /window\.__syncRawFetch = __syncRawFetch;/);
  // S15: node tasklink di editor diganti id server tanpa reset kursor
  assert.match(noteModal, /window\.addEventListener\("tf:note-tasklinks-rewritten", handler\);/);
  assert.match(noteModal, /tr\.setNodeMarkup\(pos, undefined, \{ \.\.\.node\.attrs, taskId: d\.task_id \}\)/);
});

test("index.html NoteModal: banner offers 'Muat perubahan' and 'Simpan versi saya' (conflict copy of the pulled version); share adopts server fields", () => {
  assert.match(noteModal, /"Muat perubahan"\)/);
  assert.match(noteModal, /"Simpan versi saya"\)/);
  const simpan = noteModal.match(/\/\/ "Simpan versi saya" \(prinsip 7\)[\s\S]*?"Simpan versi saya"\)/);
  assert.ok(simpan);
  assert.match(simpan[0], /window\.TF\?\.noterepo\?\.makeConflictCopy/);
  assert.match(simpan[0], /await persistEditor\(\);/);
  assert.match(noteModal, /applyFreshToEditor\(conflictBanner\.rec\)/);
  // K4 klien di kedua call site /share — PR 3 Task 5: satu PATCH di executeNoteShare, kedua pemanggil
  // (NoteModal & NotePanel) lewat confirmNoteShareWithDrawings dan mengadopsi field server di onShared.
  const shares = indexHtml.match(/api\.patch\(`\/api\/scratchpad\/\$\{noteId\}\/share`/g) || [];
  assert.equal(shares.length, 1);
  assert.equal((indexHtml.match(/await confirmNoteShareWithDrawings\(\{/g) || []).length, 2);
  assert.equal((indexHtml.match(/onShared: async updated => \{\n[\s\S]{0,600}?window\.TF\?\.noterepo\?\.adoptServerFields/g) || []).length, 2);
  assert.equal((indexHtml.match(/window\.TF\?\.noterepo\?\.adoptServerFields/g) || []).length, 2);
});

test("index.html sync(): noteSaved carries detail.cids from pullNotes.changedCids (also when only conflict copies / list_id changed)", async () => {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  assert.ok(m);
  const events = [];
  const win = {
    TF: {
      syncpull: {
        pullAndReconcile: () => Promise.resolve({}),
        pullNotesAndReconcile: () => Promise.resolve({ created: 0, updated: 0, deleted: 0, relinked: 0, conflictCopies: 1, changedCids: ["n", "copy"] }),
      },
      syncpush: { pushOutbox: () => Promise.resolve({ pushed: 0 }) },
    },
    dispatchEvent(ev) { events.push(ev); },
  };
  class CE { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const sync = new Function("window", "renderConflicts", "schedulePush", "__syncRawFetch", "__syncTransport", "runSyncExclusive", "CustomEvent",
    "let __syncPending = null;\n" + m[0] + "\nreturn sync;")(win, () => {}, () => {}, () => {}, {}, (task) => Promise.resolve().then(task), CE);
  await sync();
  const ev = events.find((e) => e.type === "noteSaved");
  assert.ok(ev, "noteSaved harus dikirim");
  assert.deepEqual(ev.detail.cids, ["n", "copy"]);
  // tidak ada perubahan → tidak ada event
  events.length = 0;
  win.TF.syncpull.pullNotesAndReconcile = () => Promise.resolve({ created: 0, updated: 0, deleted: 0, relinked: 0, conflictCopies: 0, listAdopted: 0, changedCids: [] });
  await sync();
  assert.equal(events.filter((e) => e.type === "noteSaved").length, 0);
});

test("index.html conflict bar: conflict_copy notice text (both render paths) + overwritten kept; scheduled push re-renders the bar", () => {
  const nl = indexHtml.match(/const __entityNoun = [\s\S]*?\nfunction noticeText\(n\) \{[\s\S]*?\n\}/);
  assert.ok(nl, "noticeText harus ada");
  const noticeText = new Function(nl[0] + "\nreturn noticeText;")();
  assert.equal(
    noticeText({ entity: "note", kind: "conflict_copy", title: "Rapat", copyTitle: "(konflik) Rapat", editor: "Bob" }),
    "✂ Edit offline-mu pada 'Rapat' disimpan sebagai '(konflik) Rapat' karena catatan diubah di perangkat lain (Bob).",
  );
  assert.equal(noticeText({ entity: "mindmap", kind: "conflict_copy", title: "Peta", copyTitle: "(konflik) Peta" }),
    "✂ Edit offline-mu pada 'Peta' disimpan sebagai '(konflik) Peta' karena peta diubah di perangkat lain.");
  assert.equal(noticeText({ kind: "overwritten", title: "Doc", editor: "Bob" }), "🔔 Edit offline-mu pada 'Doc' ditimpa oleh Bob.");
  assert.equal(noticeText({ kind: "delete_refused", title: "Doc" }), "🔔 'Doc' tidak bisa dihapus — hanya pemilik yang bisa menghapus.");
  const rc = indexHtml.match(/function renderConflicts\(\) \{[\s\S]*?\n\}/);
  assert.equal((rc[0].match(/label\.textContent = noticeText\(n\);/g) || []).length, 2, "kedua jalur render notice memakai noticeText");
  assert.match(rc[0], /b\.textContent = "Tutup";/);
  assert.match(indexHtml, /if \(r && \(r\.busy \|\| r\.requeued\)\) schedulePush\(\); renderConflicts\(\); \}\)/, "push terjadwal → conflict bar diperbarui");
});

test("index.html: api.delete (nonexistent) replaced by api.del", () => {
  assert.equal((indexHtml.match(/api\.delete\(/g) || []).length, 0);
  assert.match(indexHtml, /await api\.del\(`\/api\/note-templates\/\$\{t\.id\}`\);/);
  assert.match(indexHtml, /await api\.del\("\/api\/ext-auth\/revoke"\);/);
});
