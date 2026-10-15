"use strict";
// Workstream A2 (audit 2026-10-15), prinsip 4: CAS/rev untuk task, note, habit, habit_log.
// Push membaca `sentRev` sebelum request; setelah sukses record ditulis lewat TFdb.mutate (satu transaksi
// baca-ubah-tulis): dirty 0 hanya bila rev masih sama; edit selama in-flight → tetap dirty + dikirim ulang.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB, mutate } = require("../../static/offline/db.js");
const { mapPut, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { pushOutbox, markPushed, tsNewer } = require("../../static/offline/syncpush.js");
const taskrepo = require("../../static/offline/taskrepo.js");
const noterepo = require("../../static/offline/noterepo.js");
const habitrepo = require("../../static/offline/habitrepo.js");

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
function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null, waiting_for: "",
    assigned_to: null, progress: 0, parent_cid: null, recurrence_type: null, recurrence_days: null,
    deleted: false, dirty: 1, base_rev: null, rev: 1,
  }, over);
}
// Transport yang membiarkan tes mengedit record "selama request in-flight" (sebelum respons tiba).
function slowTransport(handler, during) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const res = handler(method, path, body, calls.length);
      const d = during ? during(calls.length, method, path) : null;
      return Promise.resolve(d).then(() => res);
    },
  };
}

// ── TFdb.mutate ──────────────────────────────────────────────────────────────────────────────────
test("TFdb.mutate reads + writes in one transaction, resolves the saved object, undefined = no write", async () => {
  await put("tasks", [task({ cid: "a", title: "A" })]);
  const saved = await mutate("tasks", "a", (cur) => Object.assign({}, cur, { title: cur.title + "!" }));
  assert.equal(saved.title, "A!");
  assert.equal((await get("tasks", "a")).title, "A!");
  assert.equal(await mutate("tasks", "a", () => undefined), null);
  assert.equal((await get("tasks", "a")).title, "A!");
  assert.equal(await mutate("tasks", "nope", (cur) => (cur ? cur : undefined)), null);
  await assert.rejects(mutate("tasks", "a", () => { throw new Error("boom"); }), /boom/);
});

test("tsNewer: later server timestamp wins, empty base_rev loses, space format normalized", () => {
  assert.equal(tsNewer("2026-10-15T10:00:01", "2026-10-15T10:00:00"), true);
  assert.equal(tsNewer("2026-10-15T10:00:00", "2026-10-15T10:00:01"), false);
  assert.equal(tsNewer("2026-10-15 10:00:01", "2026-10-15T10:00:00"), true);
  assert.equal(tsNewer("2026-10-15T10:00:00", null), true);
  assert.equal(tsNewer(null, "2026-10-15T10:00:00"), false);
});

test("markPushed: dirty 0 only when rev unchanged; base_rev only moves forward; server_id filled when null", async () => {
  await put("tasks", [task({ cid: "a", rev: 3, base_rev: "2026-10-15T10:00:05" })]);
  await markPushed("tasks", "a", 3, "2026-10-15T10:00:01", 77, null);
  let rec = await get("tasks", "a");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.server_id, 77);
  assert.equal(rec.base_rev, "2026-10-15T10:00:05", "base_rev tidak mundur");
  await put("tasks", [task({ cid: "b", rev: 4 })]);
  await markPushed("tasks", "b", 3, "2026-10-15T10:00:01", null, null);
  rec = await get("tasks", "b");
  assert.equal(rec.dirty, 1, "rev berubah selama in-flight → tetap dirty");
  assert.equal(rec.base_rev, "2026-10-15T10:00:01");
});

// ── rev naik di setiap tulis lokal ───────────────────────────────────────────────────────────────
test("taskrepo / noterepo / habitrepo bump rev on every local write", async () => {
  const t = await taskrepo.createTask({ title: "T" }, { now: "2026-10-15T00:00:00.000Z", today: "2026-10-15" });
  assert.equal((await get("tasks", t.cid)).rev, 1);
  await taskrepo.updateTask(t.cid, { title: "T2" }, { now: "2026-10-15T00:01:00.000Z", today: "2026-10-15" });
  assert.equal((await get("tasks", t.cid)).rev, 2);
  await taskrepo.deleteTask(t.cid, { now: "2026-10-15T00:02:00.000Z" });
  assert.equal((await get("tasks", t.cid)).rev, 3);

  const n = await noterepo.createNote({ title: "N", content: "c" }, { now: "2026-10-15T00:00:00.000Z" });
  assert.equal((await get("scratchpad_notes", n.cid)).rev, 1);
  await noterepo.updateNote(n.cid, { content: "c2" }, { now: "2026-10-15T00:01:00.000Z" });
  assert.equal((await get("scratchpad_notes", n.cid)).rev, 2);
  await noterepo.togglePin(n.cid, {});
  assert.equal((await get("scratchpad_notes", n.cid)).rev, 3);
  await noterepo.deleteNote(n.cid, {});
  assert.equal((await get("scratchpad_notes", n.cid)).rev, 4);

  const h = await habitrepo.createHabit({ title: "H" }, { now: "2026-10-15T00:00:00.000Z" });
  assert.equal((await get("habits", h.cid)).rev, 1);
  await habitrepo.updateHabit(h.cid, { title: "H2" }, {});
  assert.equal((await get("habits", h.cid)).rev, 2);
  const log = await habitrepo.checkin(h.cid, "2026-10-15", "done", "", {});
  assert.equal((await get("habit_logs", log.cid)).rev, 1);
  await habitrepo.checkin(h.cid, "2026-10-15", "skipped", "sakit", {});
  assert.equal((await get("habit_logs", log.cid)).rev, 2);
  await habitrepo.deleteHabit(h.cid, {});
  assert.equal((await get("habits", h.cid)).rev, 3);
});

// ── edit selama in-flight (K5 digeneralisasi) ────────────────────────────────────────────────────
test("task: edit during an in-flight PUT keeps the newer local version dirty and re-pushes it", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "v1", rev: 1, dirty: 1 })]);
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  const tr = slowTransport(
    (m, p, b) => ({ status: 200, data: { id: 10, title: b.title, updated_at: "2026-10-15T10:00:0" + (b.title === "v1" ? "1" : "2"), quadrant: "Q1" } }),
    (n) => (n === 1 ? taskrepo.updateTask("a", { title: "v2" }, { now: "2026-10-15T10:00:00.500Z", today: "2026-10-15" }) : null),
  );
  const r1 = await pushOutbox(tr);
  assert.equal(r1.pushed, 1);
  let rec = await get("tasks", "a");
  assert.equal(rec.title, "v2", "versi lokal yang lebih baru tidak ditimpa objek pra-request");
  assert.equal(rec.dirty, 1, "masih dirty: edit terjadi selama in-flight");
  assert.equal(rec.base_rev, "2026-10-15T10:00:01");
  assert.equal(rec.quadrant, "Q4", "field turunan server tidak diadopsi saat rev berubah");
  const ops = await outboxAll();
  assert.equal(ops.length, 1, "op update susulan ada (dari updateTask), tidak digandakan");
  assert.equal(ops[0].op, "update");
  // drain berikutnya mengirim v2 lalu bersih
  const r2 = await pushOutbox(tr);
  assert.equal(r2.pushed, 1);
  assert.equal(tr.calls[1].body.title, "v2");
  rec = await get("tasks", "a");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.quadrant, "Q1", "field turunan server diadopsi saat rev tidak berubah");
  assert.equal(rec.base_rev, "2026-10-15T10:00:02");
  assert.equal((await outboxAll()).length, 0);
});

test("task: create response adopts quadrant/recurrence_end_date/completed_at and clears recurrence_renew_pending", async () => {
  await put("tasks", [task({ cid: "a", title: "R", recurrence_type: "daily", recurrence_end_date: "2027-01-01", recurrence_renew_pending: 1, rev: 2 })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} }]);
  const tr = slowTransport(() => ({ status: 201, data: { id: 5, updated_at: "2026-10-15T10:00:00", quadrant: "Q2", recurrence_end_date: "2027-01-13", completed_at: null, recurrence_notif_level: null } }));
  await pushOutbox(tr);
  const rec = await get("tasks", "a");
  assert.equal(rec.server_id, 5);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.quadrant, "Q2");
  assert.equal(rec.recurrence_end_date, "2027-01-13");
  assert.equal(rec.recurrence_renew_pending, undefined);
  assert.equal(await serverIdOf("a"), 5);
});

test("task: a dirty record left without an op after a successful push gets an update op requeued", async () => {
  await put("tasks", [task({ cid: "a", server_id: 10, title: "v1", rev: 1, dirty: 1 })]);
  await mapPut("task", 10, "a");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "a", payload: {} }]);
  // edit "mentah" selama in-flight: rev naik tanpa op (jalur bug) → requeueIfDirty menambah op update
  const tr = slowTransport(
    () => ({ status: 200, data: { id: 10, updated_at: "2026-10-15T10:00:01" } }),
    (n) => (n === 1 ? mutate("tasks", "a", (cur) => Object.assign({}, cur, { title: "v2", rev: 2, dirty: 1 })) : null),
  );
  await pushOutbox(tr);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal(ops[0].cid, "a");
  assert.equal((await get("tasks", "a")).dirty, 1);
});

test("note: edit during an in-flight PUT keeps the newer local content dirty and re-pushes it", async () => {
  await put("scratchpad_notes", [{
    cid: "n", server_id: 7, title: "N", content: "v1", linked_task_cids: "[]", linked_to_cids: "[]", pinned: false, list_id: null,
    created_at: "x", updated_at: "2026-10-15T09:00:00", deleted: false, dirty: 1, base_rev: "2026-10-15T08:00:00", rev: 1,
  }]);
  await mapPut("note", 7, "n");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "note", cid: "n", payload: {} }]);
  const tr = slowTransport(
    (m, p, b) => ({ status: 200, data: { id: 7, updated_at: b.content === "v1" ? "2026-10-15T10:00:01" : "2026-10-15T10:00:02" } }),
    (n) => (n === 1 ? noterepo.updateNote("n", { content: "v2" }, { now: "2026-10-15T10:00:00.500Z" }) : null),
  );
  await pushOutbox(tr);
  let rec = await get("scratchpad_notes", "n");
  assert.equal(rec.content, "v2");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.base_rev, "2026-10-15T10:00:01");
  await pushOutbox(tr);
  assert.equal(tr.calls[1].body.content, "v2");
  rec = await get("scratchpad_notes", "n");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-10-15T10:00:02");
  assert.equal((await outboxAll()).length, 0);
});

test("note: create during which the user keeps typing → server_id set, content kept, re-pushed as update", async () => {
  const n = await noterepo.createNote({ title: "N", content: "v1" }, { now: "2026-10-15T09:00:00.000Z" });
  const tr = slowTransport(
    (m, p, b) => (m === "POST"
      ? { status: 200, data: { id: 50, updated_at: "2026-10-15T10:00:01" } }
      : { status: 200, data: { id: 50, updated_at: "2026-10-15T10:00:02" } }),
    (k, m) => (m === "POST" ? noterepo.updateNote(n.cid, { content: "v2" }, { now: "2026-10-15T10:00:00.500Z" }) : null),
  );
  await pushOutbox(tr);
  let rec = await get("scratchpad_notes", n.cid);
  assert.equal(rec.server_id, 50);
  assert.equal(rec.content, "v2");
  assert.equal(rec.dirty, 1);
  await pushOutbox(tr);
  assert.equal(tr.calls[1].method, "PUT");
  assert.equal(tr.calls[1].path, "/api/scratchpad/50");
  assert.equal(tr.calls[1].body.content, "v2");
  rec = await get("scratchpad_notes", n.cid);
  assert.equal(rec.dirty, 0);
});

test("habit: edit during an in-flight /update keeps the newer local version dirty and re-pushes it", async () => {
  await put("habits", [{ cid: "h", server_id: 7, title: "v1", phase: "pagi", micro_target: "", frequency: '["mon"]', identity_pillar: "", deleted: false, dirty: 1, rev: 1 }]);
  await mapPut("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = slowTransport(
    () => ({ status: 200, data: { ok: true, id: 7 } }),
    (n) => (n === 1 ? habitrepo.updateHabit("h", { title: "v2" }, {}) : null),
  );
  await pushOutbox(tr);
  let rec = await get("habits", "h");
  assert.equal(rec.title, "v2");
  assert.equal(rec.dirty, 1);
  await pushOutbox(tr);
  assert.equal(tr.calls[1].body.title, "v2");
  rec = await get("habits", "h");
  assert.equal(rec.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("habit create: check-in made while the POST is in flight is sent on the next drain with the new server id", async () => {
  const h = await habitrepo.createHabit({ title: "H" }, { now: "2026-10-15T00:00:00.000Z" });
  let logCid = null;
  const tr = slowTransport(
    (m, p) => (p === "/api/habits" ? { status: 200, data: { id: 42 } } : { status: 200, data: { ok: true } }),
    (k, m, p) => (p === "/api/habits"
      ? habitrepo.checkin(h.cid, "2026-10-15", "done", "", {}).then((log) => { logCid = log.cid; })
      : null),
  );
  const r1 = await pushOutbox(tr);
  // op checkin ditambahkan setelah drain dimulai → drain berikutnya mengirimnya (habit sudah punya server id)
  assert.equal(r1.pushed, 1);
  assert.equal((await get("habits", h.cid)).server_id, 42);
  const r2 = await pushOutbox(tr);
  assert.equal(r2.pushed, 1);
  assert.equal(tr.calls[1].path, "/api/habits/42/checkin");
  assert.equal((await get("habit_logs", logCid)).dirty, 0);
});

test("habit_log: re-check-in during an in-flight checkin keeps the newer status dirty and re-pushes it", async () => {
  await put("habits", [{ cid: "h", server_id: 7, title: "H", deleted: false, dirty: 0 }]);
  await mapPut("habit", 7, "h");
  await put("habit_logs", [{ cid: "l", habit_cid: "h", date: "2026-10-15", status: "done", skip_reason: "", dirty: 1, rev: 1 }]);
  await put("_outbox", [{ qid: 1, op: "checkin", entity_type: "habit_log", cid: "l", payload: {} }]);
  const tr = slowTransport(
    () => ({ status: 200, data: { ok: true } }),
    (n) => (n === 1 ? habitrepo.checkin("h", "2026-10-15", "skipped", "hujan", {}) : null),
  );
  await pushOutbox(tr);
  let log = await get("habit_logs", "l");
  assert.equal(log.status, "skipped");
  assert.equal(log.dirty, 1);
  assert.equal((await outboxAll()).filter((o) => o.op === "checkin").length, 1);
  await pushOutbox(tr);
  assert.deepEqual(tr.calls[1].body, { date: "2026-10-15", status: "skipped", skip_reason: "hujan" });
  log = await get("habit_logs", "l");
  assert.equal(log.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});
