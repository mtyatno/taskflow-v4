"use strict";
// Workstream A1 (audit 2026-10-15): ketahanan sinkron — klasifikasi respons push (K3/T13), 401 ≠ ganti
// pengguna (K1), pull defensif (T1/prinsip 5), dirty tanpa op → antre ulang (prinsip 2), tsEpoch (S9),
// ensureNoteCid client_id (S17), conflict bar sync_error (retry / discard_local).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { pushOutbox, classify, markSyncError, healStrandedNotes, healStrandedDrawings } = require("../../static/offline/syncpush.js");
const {
  pullTasks, pullAndReconcile, pullNotes, pullNotesAndReconcile, pullMindmaps, pullMindmapsAndReconcile,
  pullHabits, pullHabitLogs, pullHabitsAndLogs, tsEpoch, ensureNoteCid,
} = require("../../static/offline/syncpull.js");
const { pullAndReconcileLists } = require("../../static/offline/listsync.js");
const { listConflicts, resolveConflict } = require("../../static/offline/syncconflict.js");

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
function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null, waiting_for: "",
    assigned_to: null, progress: 0, parent_cid: null, recurrence_type: null, recurrence_days: null,
    deleted: false, dirty: 1, base_rev: null, updated_at: "2026-10-10T00:00:00",
  }, over);
}
function note(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: "N", content: "c",
    linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null, user_id: null,
    created_at: "x", updated_at: "2026-10-10T00:00:00", deleted: false, dirty: 1, base_rev: null,
  }, over);
}
function srvTask(over) {
  return Object.assign({
    id: over.id, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", completed_at: null, progress: 0,
    is_focused: 0, assigned_to: null, parent_id: null, list_id: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-06-01T00:00:00", updated_at: "2026-06-04T00:00:00",
  }, over);
}
function srvNote(over) {
  return Object.assign({ id: over.id, title: "S", content: "srv", tags: [], linked_to: [], linked_task_ids: [], list_id: null, user_id: 1, pinned: 0, updated_at: "2026-06-04T00:00:00" }, over);
}
function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const h = handler(method, path, body);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h);
    },
  };
}
// Response-like seperti __syncRawFetch (SW mengembalikan 503 {detail:"OFFLINE"} untuk X-TF-Sync saat offline)
function httpRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}
// Event tf:auth-expired dikirim ke `window` bila ada, jika tidak ke root (globalThis) — pasang stub window.
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

// ── classify ─────────────────────────────────────────────────────────────────────────────────────
test("classify maps status codes per prinsip 3", () => {
  assert.equal(classify({ status: 200 }), "ok");
  assert.equal(classify({ status: 201 }), "ok");
  assert.equal(classify({ status: 401 }), "auth");
  assert.equal(classify({ status: 429 }), "retry");
  assert.equal(classify({ status: 500 }), "retry");
  assert.equal(classify({ status: 503 }), "retry");
  assert.equal(classify({ status: 403 }), "forbidden");
  assert.equal(classify({ status: 404 }), "gone");
  for (const st of [400, 409, 413, 422]) assert.equal(classify({ status: st }), "permanent");
  assert.equal(classify(null), "retry");
});

test("markSyncError sets sync_error {status, detail, at} and keeps dirty as is", async () => {
  await put("tasks", [task({ cid: "a", dirty: 1 })]);
  await markSyncError("tasks", "a", { status: 422, data: { detail: [{ msg: "title too long" }] } });
  const rec = await get("tasks", "a");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.sync_error.status, 422);
  assert.equal(rec.sync_error.detail, "title too long");
  assert.ok(rec.sync_error.at);
});

// ── 401 ──────────────────────────────────────────────────────────────────────────────────────────
test("push 401 stops the drain, keeps every op, and dispatches tf:auth-expired", async () => {
  await put("tasks", [task({ cid: "a" }), task({ cid: "b" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "b", payload: {} },
  ]);
  const tr = fakeTransport(() => ({ status: 401, data: { detail: "Could not validate credentials" } }));
  const { r, events } = await withWindowEvents(() => pushOutbox(tr));
  assert.equal(tr.calls.length, 1, "drain berhenti setelah 401 pertama");
  assert.equal(r.pushed, 0);
  assert.equal(r.remaining, 2);
  assert.equal(r.authExpired, true);
  assert.equal(events.filter((e) => e.type === "tf:auth-expired").length, 1);
  assert.equal((await get("tasks", "a")).sync_error, undefined); // bukan error permanen
  assert.equal((await get("tasks", "a")).dirty, 1);
});

test("push 401 on a note create keeps the op and the local note intact", async () => {
  await put("scratchpad_notes", [note({ cid: "n", content: "ketikan offline" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "note", cid: "n", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 401, data: {} }));
  await withWindowEvents(() => pushOutbox(tr));
  assert.equal((await outboxAll()).length, 1);
  assert.equal((await get("scratchpad_notes", "n")).content, "ketikan offline");
});

// ── 429 ──────────────────────────────────────────────────────────────────────────────────────────
test("push 429 keeps the op and continues with the next op", async () => {
  await put("tasks", [task({ cid: "a" }), task({ cid: "b" })]);
  await put("_outbox", [
    { qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "b", payload: {} },
  ]);
  let n = 0;
  const tr = fakeTransport(() => (n++ === 0 ? { status: 429, data: {} } : { status: 201, data: { id: 2 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.remaining, 1);
  assert.equal((await outboxAll())[0].cid, "a");
  assert.equal((await get("tasks", "a")).sync_error, undefined);
});

// ── 422 → sync_error → conflict bar → retry / discard_local ──────────────────────────────────────
test("push 422 drops the op, marks the record dirty + sync_error, and it shows in listConflicts", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "Judul panjang", description: "edit" })]);
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 422, data: { detail: [{ msg: "ensure this value has at most 200 characters" }] } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  assert.equal(r.remaining, 0);
  const rec = await get("tasks", "a");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.description, "edit");
  assert.equal(rec.sync_error.status, 422);
  assert.match(rec.sync_error.detail, /200 characters/);
  const conflicts = await listConflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].entity, "task");
  assert.equal(conflicts[0].conflict, "sync_error");
  assert.equal(conflicts[0].status, 422);
  assert.equal(conflicts[0].title, "Judul panjang");
});

test("resolveConflict retry clears sync_error and queues an update (server_id set) that then pushes", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, dirty: 1, sync_error: { status: 422, detail: "x", at: "t" } })]);
  await mapPut("task", 10, "a");
  await resolveConflict("task", "a", "retry");
  const rec = await get("tasks", "a");
  assert.equal(rec.sync_error, undefined);
  assert.equal(rec.dirty, 1);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal((await listConflicts()).length, 0);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 10, updated_at: "2026-10-15T01:00:00" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal((await get("tasks", "a")).dirty, 0);
});

test("resolveConflict retry queues a create when the record has no server_id", async () => {
  await put("scratchpad_notes", [note({ cid: "n", sync_error: { status: 413, detail: "too large", at: "t" } })]);
  await resolveConflict("note", "n", "retry");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "note");
});

test("resolveConflict discard_local clears dirty + sync_error + base_rev so the next pull adopts the server version", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, dirty: 1, base_rev: "2026-06-04T00:00:00", description: "lokal", sync_error: { status: 422, detail: "x", at: "t" } })]);
  await mapPut("task", 10, "a");
  await outboxAdd({ op: "update", entity_type: "task", cid: "a", payload: {} });
  await resolveConflict("task", "a", "discard_local");
  const rec = await get("tasks", "a");
  assert.equal(rec.sync_error, undefined);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, null);
  assert.equal((await outboxAll()).length, 0);
  // pull berikutnya: versi server menimpa (updated_at server ≠ base_rev null)
  const res = await pullTasks([srvTask({ id: 10, title: "Server", description: "server" })]);
  assert.equal(res.updated, 1);
  assert.equal((await get("tasks", "a")).description, "server");
});

test("resolveConflict discard_local deletes a never-pushed record (server_id null)", async () => {
  await put("scratchpad_notes", [note({ cid: "n", sync_error: { status: 422, detail: "x", at: "t" } })]);
  await outboxAdd({ op: "create", entity_type: "note", cid: "n", payload: {} });
  await resolveConflict("note", "n", "discard_local");
  assert.equal(await get("scratchpad_notes", "n"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("listConflicts covers habits and drawings (sync_error) and access_lost", async () => {
  await put("habits", [{ cid: "h", server_id: 5, title: "Lari", dirty: 1, sync_error: { status: 400, detail: "bad", at: "t" } }]);
  await put("drawings", [{ cid: "d", server_id: null, title: "Sketsa", dirty: 1, rev: 1, sync_error: { status: 422, detail: "data_json too large", at: "t" } }]);
  await put("scratchpad_notes", [note({ cid: "n", list_id: 9, conflict: "access_lost" })]);
  const list = await listConflicts();
  const byCid = Object.fromEntries(list.map((c) => [c.cid, c]));
  assert.equal(byCid.h.entity, "habit"); assert.equal(byCid.h.conflict, "sync_error");
  assert.equal(byCid.d.entity, "drawing"); assert.equal(byCid.d.status, 422);
  assert.equal(byCid.n.entity, "note"); assert.equal(byCid.n.conflict, "access_lost");
});

test("resolveConflict retry on a drawing queues the create/update op shape syncpush expects", async () => {
  await put("drawings", [{ cid: "d", server_id: null, title: "Sketsa", svg_preview: "", is_pinned: 0, dirty: 1, rev: 1, sync_error: { status: 422, detail: "x", at: "t" } }]);
  await resolveConflict("drawing", "d", "retry");
  let ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "drawing"); assert.equal(ops[0].op, "create"); assert.equal(ops[0].payload.title, "Sketsa");
  await put("drawings", [{ cid: "e", server_id: 7, title: "Peta", svg_preview: "", is_pinned: 0, dirty: 1, rev: 2, sync_error: { status: 422, detail: "x", at: "t" } }]);
  await resolveConflict("drawing", "e", "retry");
  ops = (await outboxAll()).filter((o) => o.cid === "e");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal((await get("drawings", "e")).sync_error, undefined);
});

test("resolveConflict keep_as_new on access_lost drops list_id so the re-create is personal", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, list_id: 7, conflict: "access_lost" })]);
  await mapPut("task", 10, "a");
  await resolveConflict("task", "a", "keep_as_new");
  const rec = await get("tasks", "a");
  assert.equal(rec.conflict, undefined);
  assert.equal(rec.list_id, null);
  assert.equal(rec.server_id, null);
  assert.equal(await cidOf("task", 10), undefined);
  assert.equal((await outboxAll())[0].op, "create");
});

test("drawing 422 on create → sync_error, and healStrandedDrawings/pull do not requeue it (T13)", async () => {
  await put("drawings", [{ cid: "d", server_id: null, title: "Besar", svg_preview: "", is_pinned: 0, dirty: 1, rev: 1, deleted: false }]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "drawing", cid: "d", payload: { title: "Besar" } }]);
  const tr = fakeTransport(() => ({ status: 422, data: { detail: "data_json terlalu besar" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.failed, 1);
  assert.equal((await outboxAll()).length, 0);
  const rec = await get("drawings", "d");
  assert.equal(rec.sync_error.status, 422);
  assert.equal(await healStrandedDrawings(), 0);
  // push berikutnya: tidak ada upload ulang
  const tr2 = fakeTransport(() => { throw new Error("must not re-upload"); });
  await pushOutbox(tr2);
  assert.equal(tr2.calls.length, 0);
});

test("healStrandedNotes skips notes with sync_error", async () => {
  await put("scratchpad_notes", [
    note({ cid: "ok", server_id: null }),
    note({ cid: "bad", server_id: null, sync_error: { status: 422, detail: "x", at: "t" } }),
  ]);
  assert.equal(await healStrandedNotes(), 1);
  assert.deepEqual((await outboxAll()).map((o) => o.cid), ["ok"]);
});

test("drawing 403 on create flags access_lost instead of deleting the record", async () => {
  await put("drawings", [{ cid: "d", server_id: null, title: "Sketsa", svg_preview: "", is_pinned: 0, dirty: 1, rev: 1, deleted: false }]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "drawing", cid: "d", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 403, data: {} }));
  await pushOutbox(tr);
  const rec = await get("drawings", "d");
  assert.equal(rec.conflict, "access_lost");
  assert.equal((await outboxAll()).length, 0);
});

test("habit checkin 422 marks the log sync_error and pullHabitLogs then leaves it alone (no requeue)", async () => {
  await put("habits", [{ cid: "h", server_id: 5, title: "H", dirty: 0, deleted: false }]);
  await mapPut("habit", 5, "h");
  await put("habit_logs", [{ cid: "l", habit_cid: "h", date: "2026-10-14", status: "done", skip_reason: "", dirty: 1 }]);
  await put("_outbox", [{ qid: 1, op: "checkin", entity_type: "habit_log", cid: "l", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 422, data: { detail: "bad date" } }));
  await pushOutbox(tr);
  const log = await get("habit_logs", "l");
  assert.equal(log.sync_error.status, 422);
  assert.equal((await outboxAll()).length, 0);
  const res = await pullHabitLogs([{ habit_id: 5, date: "2026-10-14", status: "skipped", skip_reason: "" }]);
  assert.equal(res.requeued, 0);
  assert.equal((await get("habit_logs", "l")).status, "done");
});

// ── Prinsip 2: dirty tanpa op → antre ulang, jangan timpa ────────────────────────────────────────
test("pullTasks requeues a dirty task without an outbox op instead of overwriting it", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, dirty: 1, base_rev: "2026-06-04T00:00:00", description: "edit lokal", updated_at: "2026-06-05T00:00:00" })]);
  await mapPut("task", 10, "a");
  const res = await pullTasks([srvTask({ id: 10, description: "server", updated_at: "2026-06-04T00:00:00" })]);
  assert.equal(res.requeued, 1);
  assert.equal(res.updated, 0);
  assert.equal((await get("tasks", "a")).description, "edit lokal");
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "task"); assert.equal(ops[0].op, "update"); assert.equal(ops[0].cid, "a");
});

test("pullTasks requeues a create for a dirty local-only task (server_id null) without an op", async () => {
  await put("tasks", [task({ cid: "x", server_id: null, dirty: 1 })]);
  const res = await pullTasks([]);
  assert.equal(res.requeued, 1);
  assert.equal((await outboxAll())[0].op, "create");
  assert.ok(await get("tasks", "x"));
});

test("pullTasks never overwrites or deletes a record with sync_error", async () => {
  await put("tasks", [
    task({ cid: "a", server_id: 10, dirty: 1, base_rev: "old", description: "lokal", sync_error: { status: 422, detail: "x", at: "t" } }),
    task({ cid: "b", server_id: 11, dirty: 1, base_rev: "old", sync_error: { status: 422, detail: "x", at: "t" } }),
  ]);
  await mapPut("task", 10, "a"); await mapPut("task", 11, "b");
  const res = await pullTasks([srvTask({ id: 10, description: "server", updated_at: "new" })], () => Promise.resolve({ status: 404 }));
  assert.equal(res.requeued, 0);
  assert.equal(res.deleted, 0);
  assert.equal((await get("tasks", "a")).description, "lokal");
  assert.ok(await get("tasks", "b"));
  assert.equal((await outboxAll()).length, 0);
});

test("pullNotes requeues a dirty note without an op and keeps local content", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 1, base_rev: "2026-06-04T00:00:00", content: "lokal", updated_at: "2026-06-05T00:00:00" })]);
  await mapPut("note", 7, "n");
  const res = await pullNotes([srvNote({ id: 7, content: "server", updated_at: "2026-06-04T00:00:00" })]);
  assert.equal(res.requeued, 1);
  assert.equal((await get("scratchpad_notes", "n")).content, "lokal");
  assert.equal((await outboxAll())[0].op, "update");
});

test("pullMindmaps requeues a dirty mindmap without an op and keeps local data", async () => {
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "Mine", data_json: "{\"local\":1}", pinned: false, list_id: null, created_at: "x", updated_at: "2026-06-11T00:00:00", deleted: false, dirty: 1, base_rev: "2026-06-10T00:00:00" }]);
  await mapPut("mindmap", 5, "m");
  const rows = [{ id: 5, title: "Srv", is_pinned: 0, list_id: null, created_at: "x", updated_at: "2026-06-10T00:00:00" }];
  const res = await pullMindmaps(rows, () => Promise.resolve(Object.assign({}, rows[0], { data_json: "{\"srv\":1}" })));
  assert.equal(res.requeued, 1);
  assert.equal((await get("mindmaps", "m")).data_json, "{\"local\":1}");
  assert.equal((await outboxAll())[0].entity_type, "mindmap");
});

test("pullHabits requeues a dirty habit without an op (update) and skips one with sync_error", async () => {
  await put("habits", [
    { cid: "h", server_id: 5, title: "Lokal", phase: "pagi", micro_target: "", frequency: "[]", identity_pillar: "", dirty: 1, deleted: false },
    { cid: "e", server_id: 6, title: "Err", phase: "pagi", micro_target: "", frequency: "[]", identity_pillar: "", dirty: 1, deleted: false, sync_error: { status: 422, detail: "x", at: "t" } },
  ]);
  await mapPut("habit", 5, "h"); await mapPut("habit", 6, "e");
  const res = await pullHabits([{ id: 5, title: "Server", phase: "pagi" }]);
  assert.equal(res.requeued, 1);
  assert.equal(res.deleted, 0); // "e" hilang dari server tapi punya sync_error → dipertahankan
  assert.equal((await get("habits", "h")).title, "Lokal");
  assert.ok(await get("habits", "e"));
  const ops = await outboxAll();
  assert.equal(ops.length, 1); assert.equal(ops[0].entity_type, "habit"); assert.equal(ops[0].op, "update"); assert.equal(ops[0].cid, "h");
});

test("pullHabitLogs requeues a dirty log without a checkin op", async () => {
  await put("habits", [{ cid: "h", server_id: 5, title: "H", dirty: 0, deleted: false }]);
  await mapPut("habit", 5, "h");
  await put("habit_logs", [{ cid: "l", habit_cid: "h", date: "2026-10-14", status: "done", skip_reason: "", dirty: 1 }]);
  const res = await pullHabitLogs([{ habit_id: 5, date: "2026-10-14", status: "skipped", skip_reason: "" }]);
  assert.equal(res.requeued, 1);
  assert.equal((await get("habit_logs", "l")).status, "done");
  const ops = await outboxAll();
  assert.equal(ops.length, 1); assert.equal(ops[0].op, "checkin"); assert.equal(ops[0].cid, "l");
});

// ── T1 / prinsip 5: respons pull gagal → throw, tidak ada yang dihapus ───────────────────────────
test("pullAndReconcile throws on 503/401 and deletes nothing", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, dirty: 0, base_rev: "x" })]);
  await mapPut("task", 10, "a");
  for (const status of [503, 401, 500]) {
    await assert.rejects(pullAndReconcile(() => Promise.resolve(httpRes(status, { detail: "OFFLINE" }))), /http/);
    assert.ok(await get("tasks", "a"), "task tetap ada setelah " + status);
  }
  // objek biasa {ok:false} (tanpa json) juga dianggap gagal
  await assert.rejects(pullAndReconcile(() => Promise.resolve({ ok: false, status: 503 })));
  assert.ok(await get("tasks", "a"));
});

test("pullNotesAndReconcile / pullMindmapsAndReconcile / pullHabitsAndLogs / pullAndReconcileLists throw on a failed list response", async () => {
  await put("scratchpad_notes", [note({ cid: "n", server_id: 7, dirty: 0, base_rev: "x" })]);
  await put("mindmaps", [{ cid: "m", server_id: 5, title: "M", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "u", deleted: false, dirty: 0, base_rev: "u" }]);
  await put("habits", [{ cid: "h", server_id: 3, title: "H", dirty: 0, deleted: false }]);
  await put("lists", [{ cid: "l", server_id: 2, name: "L", role: "member", dirty: 0 }]);
  const bad = () => Promise.resolve(httpRes(503, { detail: "OFFLINE" }));
  await assert.rejects(pullNotesAndReconcile(bad), /http 503/);
  await assert.rejects(pullMindmapsAndReconcile(bad), /http 503/);
  await assert.rejects(pullHabitsAndLogs(bad), /http 503/);
  await assert.rejects(pullAndReconcileLists(bad), /http 503/);
  assert.ok(await get("scratchpad_notes", "n"));
  assert.ok(await get("mindmaps", "m"));
  assert.ok(await get("habits", "h"));
  assert.ok(await get("lists", "l"));
  // body bukan daftar (mis. {detail:...} dengan 200) juga tidak boleh menghapus list
  await assert.rejects(pullAndReconcileLists(() => Promise.resolve(httpRes(200, { detail: "weird" }))));
  assert.ok(await get("lists", "l"));
});

// ── Hapus lokal hanya setelah GET per item 404 eksplisit ─────────────────────────────────────────
test("pullAndReconcile deletes a clean task missing from the list only when GET /api/tasks/:id is 404", async () => {
  await put("tasks", [
    task({ cid: "gone", server_id: 10, dirty: 0, base_rev: "x" }),
    task({ cid: "flaky", server_id: 11, dirty: 0, base_rev: "x" }),
    task({ cid: "racing", server_id: 12, dirty: 0, base_rev: "x" }),
  ]);
  await mapPut("task", 10, "gone"); await mapPut("task", 11, "flaky"); await mapPut("task", 12, "racing");
  const rawFetch = (u) => {
    if (u === "/api/tasks?include_done=true") return Promise.resolve(httpRes(200, []));
    if (u === "/api/tasks/10") return Promise.resolve(httpRes(404, { detail: "Task not found" }));
    if (u === "/api/tasks/11") return Promise.resolve(httpRes(500, { detail: "boom" }));
    if (u === "/api/tasks/12") return Promise.resolve(httpRes(200, srvTask({ id: 12 }))); // ada (daftar basi/parsial)
    return Promise.resolve(null);
  };
  const res = await pullAndReconcile(rawFetch);
  assert.equal(res.deleted, 1);
  assert.equal(await get("tasks", "gone"), undefined);
  assert.ok(await get("tasks", "flaky"), "GET 500 bukan bukti terhapus");
  assert.ok(await get("tasks", "racing"), "GET 200 → record dipertahankan");
});

test("pullTasks with a fetchOne that returns null (offline) keeps the record; without fetchOne old behavior deletes", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, dirty: 0, base_rev: "x" })]);
  await mapPut("task", 10, "a");
  let res = await pullTasks([], () => Promise.resolve(null));
  assert.equal(res.deleted, 0); assert.equal(res.skipped, 1);
  assert.ok(await get("tasks", "a"));
  res = await pullTasks([]);
  assert.equal(res.deleted, 1);
  assert.equal(await get("tasks", "a"), undefined);
});

test("pullNotesAndReconcile confirms deletion per item via GET /api/scratchpad/:id (404 → delete, 500/null → keep)", async () => {
  await put("scratchpad_notes", [
    note({ cid: "gone", server_id: 7, dirty: 0, base_rev: "x" }),
    note({ cid: "keep", server_id: 8, dirty: 0, base_rev: "x" }),
    note({ cid: "keep2", server_id: 9, dirty: 0, base_rev: "x" }),
  ]);
  await mapPut("note", 7, "gone"); await mapPut("note", 8, "keep"); await mapPut("note", 9, "keep2");
  const rawFetch = (u) => {
    if (u === "/api/scratchpad") return Promise.resolve(httpRes(200, []));
    if (u === "/api/scratchpad/7") return Promise.resolve(httpRes(404, { detail: "nf" }));
    if (u === "/api/scratchpad/8") return Promise.resolve(httpRes(500, { detail: "boom" }));
    return Promise.reject(new Error("net"));
  };
  const res = await pullNotesAndReconcile(rawFetch);
  assert.equal(res.deleted, 1);
  assert.equal(await get("scratchpad_notes", "gone"), undefined);
  assert.equal(await cidOf("note", 7), undefined);
  assert.ok(await get("scratchpad_notes", "keep"));
  assert.ok(await get("scratchpad_notes", "keep2"));
});

test("pullMindmapsAndReconcile confirms deletion per item (404 → delete, 503 → keep)", async () => {
  const mm = (cid, sid) => ({ cid, server_id: sid, title: "M", data_json: "{}", pinned: false, list_id: null, created_at: "x", updated_at: "u", deleted: false, dirty: 0, base_rev: "u" });
  await put("mindmaps", [mm("gone", 5), mm("keep", 6)]);
  await mapPut("mindmap", 5, "gone"); await mapPut("mindmap", 6, "keep");
  const rawFetch = (u) => {
    if (u === "/api/mindmaps") return Promise.resolve(httpRes(200, []));
    if (u === "/api/mindmaps/5") return Promise.resolve(httpRes(404, { detail: "nf" }));
    return Promise.resolve(httpRes(503, { detail: "OFFLINE" }));
  };
  const res = await pullMindmapsAndReconcile(rawFetch);
  assert.equal(res.deleted, 1);
  assert.equal(await get("mindmaps", "gone"), undefined);
  assert.ok(await get("mindmaps", "keep"));
});

test("pullMindmapsAndReconcile never writes an error body as a mindmap", async () => {
  const rows = [{ id: 5, title: "Srv", is_pinned: 0, list_id: null, created_at: "x", updated_at: "u" }];
  const rawFetch = (u) => (u === "/api/mindmaps" ? Promise.resolve(httpRes(200, rows)) : Promise.resolve(httpRes(404, { detail: "nf" })));
  const res = await pullMindmapsAndReconcile(rawFetch);
  assert.equal(res.created, 1); // dihitung, tetapi tidak ada record yang ditulis tanpa body valid
  assert.equal((await all("mindmaps")).length, 0);
});

// ── S9: tsEpoch ──────────────────────────────────────────────────────────────────────────────────
test("tsEpoch normalizes the SQLite space format and treats tz-less strings as UTC", () => {
  assert.equal(tsEpoch("2026-10-14 02:42:33"), Date.parse("2026-10-14T02:42:33Z"));
  assert.equal(tsEpoch("2026-10-14 02:42:33.123"), Date.parse("2026-10-14T02:42:33.123Z"));
  assert.equal(tsEpoch("2026-10-14T02:42:33"), Date.parse("2026-10-14T02:42:33Z"));
  assert.equal(tsEpoch("2026-10-14T02:42:33+07:00"), Date.parse("2026-10-14T02:42:33+07:00"));
  assert.equal(tsEpoch("2026-10-14 02:42:33+07:00"), Date.parse("2026-10-14T02:42:33+07:00"));
  assert.ok(tsEpoch("2026-10-14 02:42:33") > 0);
  assert.equal(tsEpoch(null), 0);
  assert.equal(tsEpoch("garbage"), 0);
});

// ── S17: ensureNoteCid matches server client_id ──────────────────────────────────────────────────
test("ensureNoteCid maps a server row to the local note whose cid equals its client_id", async () => {
  await put("scratchpad_notes", [note({ cid: "local-cid-1", server_id: null, dirty: 1 })]);
  const cache = {};
  const cid = await ensureNoteCid(55, cache, { id: 55, client_id: "local-cid-1" });
  assert.equal(cid, "local-cid-1");
  assert.equal(await cidOf("note", 55), "local-cid-1");
  assert.equal(await serverIdOf("local-cid-1"), 55);
});

test("ensureNoteCid uses the server client_id as the fresh cid when nothing matches locally", async () => {
  const cache = {};
  assert.equal(await ensureNoteCid(56, cache, { id: 56, client_id: "other-device-cid" }), "other-device-cid");
  assert.ok(await ensureNoteCid(57, cache, { id: 57 })); // tanpa client_id → cid acak baru
  assert.notEqual(await ensureNoteCid(57, {}, { id: 57 }), "other-device-cid");
});

test("pullNotes does not create a duplicate for a note created offline whose POST response was lost (client_id match)", async () => {
  await put("scratchpad_notes", [note({ cid: "c1", server_id: null, dirty: 1, content: "lokal", updated_at: "2026-06-05T00:00:00" })]);
  await outboxAdd({ op: "create", entity_type: "note", cid: "c1", payload: {} });
  await pullNotes([srvNote({ id: 70, client_id: "c1", content: "lokal", updated_at: "2026-06-04T00:00:00" })]);
  const notes = await all("scratchpad_notes");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].cid, "c1");
  assert.equal(await serverIdOf("c1"), 70);
});

// ── index.html: sync() terisolasi per langkah, push selalu di akhir; isOfflineErr; conflict bar ──────
const fs = require("node:fs");
const path = require("node:path");
const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

test("index.html sync(): one failing pull step does not skip the others and pushOutbox still runs", async () => {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function sync() harus ada");
  const calls = [];
  const fail = (name) => () => { calls.push(name); return Promise.reject(Object.assign(new Error("http 503"), { status: 503 })); };
  const okStep = (name) => () => { calls.push(name); return Promise.resolve({ created: 0, updated: 0, deleted: 0 }); };
  const win = {
    TF: {
      syncpull: { pullAndReconcile: fail("tasks"), pullHabitsAndLogs: okStep("habits"), pullNotesAndReconcile: fail("notes"), pullMindmapsAndReconcile: okStep("mindmaps"), pullDrawingsAndReconcile: okStep("drawings") },
      listsync: { pullAndReconcileLists: okStep("lists") },
      syncpush: { pushOutbox: () => { calls.push("push"); return Promise.resolve({ pushed: 1, remaining: 0 }); } },
    },
    dispatchEvent() {},
  };
  const sync = new Function("window", "renderConflicts", "schedulePush", "__syncRawFetch", "__syncTransport", "runSyncExclusive", "CustomEvent",
    "let __syncPending = null;\n" + m[0] + "\nreturn sync;")(win, () => {}, () => {}, () => {}, {}, (task) => Promise.resolve().then(task), function () {});
  const r = await sync();
  assert.deepEqual(calls, ["tasks", "lists", "habits", "notes", "mindmaps", "drawings", "push"]);
  assert.equal(r.pushed, 1);
});

test("index.html sync(): a 401 during pull goes through handleAuthExpired", async () => {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  let expired = 0;
  const win = {
    TF: {
      syncpull: { pullAndReconcile: () => Promise.reject(Object.assign(new Error("http 401"), { status: 401 })) },
      syncpush: { pushOutbox: () => Promise.resolve({ pushed: 0 }) },
    },
    dispatchEvent() {},
  };
  const sync = new Function("window", "renderConflicts", "schedulePush", "__syncRawFetch", "__syncTransport", "runSyncExclusive", "CustomEvent", "handleAuthExpired",
    "let __syncPending = null;\n" + m[0] + "\nreturn sync;")(win, () => {}, () => {}, () => {}, {}, (task) => Promise.resolve().then(task), function () {}, () => { expired++; });
  await sync();
  assert.equal(expired, 1);
});

test("index.html: local router errors are tagged __local and isOfflineErr ignores them (S14)", () => {
  assert.match(indexHtml, /eLocal\.__local = true;/);
  const m = indexHtml.match(/const isOfflineErr = (err => .*);\n/);
  assert.ok(m, "isOfflineErr harus ada");
  const isOfflineErr = new Function("navigator", "return " + m[1] + ";")({ onLine: false });
  assert.equal(isOfflineErr(Object.assign(new Error("Task not found"), { __local: true })), false, "error router lokal saat offline bukan error jaringan");
  assert.equal(isOfflineErr(new TypeError("Failed to fetch")), true);
  assert.equal(isOfflineErr(new Error("OFFLINE")), true);
});

test("index.html: conflict bar renders sync_error (retry / discard_local) and access_lost (keep_as_new / discard) rows", () => {
  const m = indexHtml.match(/function renderConflicts\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, "renderConflicts harus ada");
  const code = m[0];
  assert.match(code, /c\.conflict === "sync_error"/);
  assert.match(code, /gagal disinkronkan/);
  assert.match(code, /\["Coba lagi", "retry"\], \["Buang perubahan lokal", "discard_local"\]/);
  assert.match(code, /c\.conflict === "access_lost"/);
  assert.match(code, /akses ke list ini hilang/);
  assert.match(code, /\["Simpan sebagai baru", "keep_as_new"\], \["Buang", "discard"\]/);
  assert.match(code, /dihapus di perangkat lain, tapi ada perubahan lokal/, "baris remote_deleted tetap ada");
});

test("index.html: expired-session handling never wipes local data and the login screen shows the toast", () => {
  const hae = indexHtml.match(/function handleAuthExpired\(\) \{[\s\S]*?\n\}/);
  assert.ok(hae);
  assert.ok(!hae[0].includes("clearLocalUserData("));
  assert.match(hae[0], /window\.__onAuthExpired/);
  assert.match(indexHtml, /window\.addEventListener\("tf:auth-expired", handleAuthExpired\);/);
  assert.match(indexHtml, /Sesi berakhir — masuk lagi\. Perubahan offline tetap tersimpan dan akan dikirim setelah masuk\./);
  // toast dirender juga pada cabang !user (form login)
  const loginBranch = indexHtml.match(/if \(!user\) \{\s*return \/\*#__PURE__\*\/React\.createElement\(React\.Fragment[\s\S]*?\n  \}/);
  assert.ok(loginBranch, "cabang !user harus ada");
  assert.match(loginBranch[0], /React\.createElement\(Toast, \{/);
});
