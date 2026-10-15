"use strict";
// Temuan review independen (2026-10-15, setelah workstream A1–D):
//   R1 sync_error dibersihkan oleh push yang sukses;
//   R2 field turunan (kuadran cron Eisenhower) tetap diadopsi walau updated_at server tidak berubah (K2);
//   R3 salinan konflik note TIDAK dibuat bila isi lokal sama dengan server (gema PUT sendiri yang responsnya hilang);
//   R4 baris server hasil POST kita (client_id) dikenali → tidak ada duplikat hantu task/habit/mindmap;
//   R5 writeNote lewat CAS: autosave selama pull tidak ditimpa;
//   R10 tombstone habit tanpa op (DELETE ditolak) dipulihkan dari server;
//   R11 mark occurrence yang ditolak server tidak dihapus diam-diam oleh pull jendela.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullTasks, pullHabits, pullMindmaps, pullNotes, reconcileRecurringExceptions } = require("../../static/offline/syncpull.js");
const taskrepo = require("../../static/offline/taskrepo.js");
const noterepo = require("../../static/offline/noterepo.js");
const habitrepo = require("../../static/offline/habitrepo.js");
const mindmaprepo = require("../../static/offline/mindmaprepo.js");
const recurrence = require("../../static/offline/recurrence.js");

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
function transport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body, calls.length)); } };
}
function serverTask(over) {
  return Object.assign({
    id: 1, title: "T", description: "", gtd_status: "next", priority: "P2", quadrant: "Q2", project: "", context: "",
    deadline: "2026-10-20", waiting_for: "", completed_at: null, progress: 0, is_focused: 0, assigned_to: null,
    recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
    created_at: "2026-10-01T00:00:00", updated_at: "2026-10-10T00:00:00", list_id: null, parent_id: null, client_id: null,
  }, over);
}

// ── R1 ───────────────────────────────────────────────────────────────────────────────────────────
test("R1: sync_error dibersihkan saat push berikutnya sukses (pull tidak lagi melewati record, conflict bar tidak basi)", async () => {
  const t = await taskrepo.createTask({ title: "A" }, {});
  // POST pertama ditolak permanen (422) → sync_error; edit berikutnya → POST sukses → sync_error hilang
  let n = 0;
  const tr = transport((m, p) => {
    n++;
    if (n === 1) return { status: 422, data: { detail: "judul tidak valid" } };
    return { status: 200, data: { id: 9, updated_at: "2026-10-15T10:00:00", quadrant: "Q4" } };
  });
  await pushOutbox(tr);
  let rec = await get("tasks", t.cid);
  assert.equal(rec.sync_error.status, 422);
  await taskrepo.updateTask(t.cid, { title: "A diperbaiki" }, {});
  rec = await get("tasks", t.cid);
  assert.equal(rec.sync_error.status, 422, "updateTask tidak menghapus tanda (conflict bar masih tampil sampai terkirim)");
  // "Coba lagi" tidak ditekan; op update dari updateTask sudah antre — tetapi record masih server_id null:
  // op update dibuang (sid null) → jadikan skenario create ulang lewat retry resolveConflict
  const sc = require("../../static/offline/syncconflict.js");
  await sc.resolveConflict("task", t.cid, "retry");
  await pushOutbox(tr);
  rec = await get("tasks", t.cid);
  assert.equal(rec.server_id, 9);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.sync_error, undefined, "push sukses membersihkan sync_error");
});

// ── R2 ───────────────────────────────────────────────────────────────────────────────────────────
test("R2: kuadran dari cron (updated_at TIDAK berubah) tetap diadopsi pada record bersih", async () => {
  const s = serverTask({ id: 1, quadrant: "Q2", updated_at: "2026-10-10T00:00:00" });
  await pullTasks([s]);
  const cid = await cidOf("task", 1);
  assert.equal((await get("tasks", cid)).quadrant, "Q2");
  // cron: kuadran Q2 → Q1 tanpa bump updated_at (K2)
  const r = await pullTasks([Object.assign({}, s, { quadrant: "Q1", recurrence_notif_level: 1 })]);
  const rec = await get("tasks", cid);
  assert.equal(rec.quadrant, "Q1");
  assert.equal(rec.recurrence_notif_level, 1);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-10-10T00:00:00");
  assert.equal(r.derived, 1);
  // record dirty (edit lokal tertunda) TIDAK disentuh oleh adopsi turunan
  await taskrepo.updateTask(cid, { title: "edit lokal" }, {});
  await pullTasks([Object.assign({}, s, { quadrant: "Q3" })]);
  const rec2 = await get("tasks", cid);
  assert.equal(rec2.title, "edit lokal");
  assert.notEqual(rec2.quadrant, "Q3");
});

// ── R3 ───────────────────────────────────────────────────────────────────────────────────────────
test("R3: PUT note diterima server tapi respons hilang → pull berikutnya TIDAK membuat salinan '(konflik)' (isi sama)", async () => {
  const srv = { id: 5, title: "Catatan", content: "isi v1", tags: [], linked_to: [], linked_task_ids: [], pinned: false,
    meta_json: "{}", list_id: null, user_id: 1, updated_at: "2026-10-10T00:00:00", created_at: "2026-10-01T00:00:00" };
  await pullNotes([srv]);
  const cid = await cidOf("note", 5);
  await noterepo.updateNote(cid, { content: "isi v2" }, {});
  // server sudah menerapkan v2 (updated_at maju) — klien tidak tahu (timeout) → op update masih antre
  const r = await pullNotes([Object.assign({}, srv, { content: "isi v2", updated_at: "2026-10-11T00:00:00" })]);
  const notes = (await all("scratchpad_notes")).filter((n) => !n.deleted);
  assert.equal(notes.length, 1, "tidak ada salinan konflik");
  assert.equal(r.conflictCopies, 0);
  const rec = await get("scratchpad_notes", cid);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-10-11T00:00:00");
  assert.equal(rec.notice, undefined);
  assert.equal((await outboxAll()).filter((o) => o.entity_type === "note").length, 0, "op update dibuang (sudah diterapkan server)");
  // isi BERBEDA → salinan konflik tetap dibuat (perilaku prinsip 7)
  await noterepo.updateNote(cid, { content: "isi lokal v3" }, {});
  const r2 = await pullNotes([Object.assign({}, srv, { content: "isi server v3", updated_at: "2026-10-12T00:00:00" })]);
  assert.equal(r2.conflictCopies, 1);
  const copies = (await all("scratchpad_notes")).filter((n) => n.title.indexOf("(konflik)") === 0);
  assert.equal(copies.length, 1);
  assert.equal(copies[0].content, "isi lokal v3");
  assert.equal((await get("scratchpad_notes", cid)).content, "isi server v3");
});

// ── R4 ───────────────────────────────────────────────────────────────────────────────────────────
test("R4: POST task sampai server, respons hilang → pull mengenali baris lewat client_id, retry POST → satu record", async () => {
  const t = await taskrepo.createTask({ title: "Baru" }, {});
  // server sudah menyimpan baris 42 dengan client_id = cid (respons hilang) → pull melihatnya
  await pullTasks([serverTask({ id: 42, title: "Baru", client_id: t.cid, updated_at: "2026-10-15T09:00:00" })]);
  let tasks = (await all("tasks")).filter((r) => !r.deleted);
  assert.equal(tasks.length, 1, "tidak ada duplikat hantu");
  assert.equal(await cidOf("task", 42), t.cid);
  // record lokal masih dirty (base_rev null → lokal menang), op create antre → retry POST = upsert idempoten
  const tr = transport(() => ({ status: 200, data: { id: 42, updated_at: "2026-10-15T09:00:01" } }));
  await pushOutbox(tr);
  assert.equal(tr.calls[0].body.client_id, t.cid);
  tasks = (await all("tasks")).filter((r) => !r.deleted);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].server_id, 42);
  // pull berikutnya: tetap satu record
  await pullTasks([serverTask({ id: 42, title: "Baru", client_id: t.cid, updated_at: "2026-10-15T09:00:01" })]);
  assert.equal((await all("tasks")).length, 1);
});

test("R4: duplikat hantu yang sudah terlanjur ada (dua record, satu server_id) dibersihkan: salinan bersih dibuang", async () => {
  const good = await taskrepo.createTask({ title: "Asli" }, {});
  await mapPut("task", 7, good.cid);
  await put("tasks", [Object.assign({}, await get("tasks", good.cid), { server_id: 7, dirty: 0, base_rev: "2026-10-10T00:00:00" })]);
  await put("tasks", [{ cid: "hantu", server_id: 7, title: "Asli", dirty: 0, deleted: false, base_rev: "2026-10-10T00:00:00", rev: 0,
    gtd_status: "next", priority: "P2", quadrant: "Q2" }]);
  await pullTasks([serverTask({ id: 7, title: "Asli", client_id: good.cid })]);
  const rows = await all("tasks");
  assert.deepEqual(rows.map((r) => r.cid), [good.cid]);
});

test("R4: habit & mindmap — baris server dengan client_id = cid lokal tidak membuat record kedua", async () => {
  const h = await habitrepo.createHabit({ title: "Olahraga" }, {});
  await pullHabits([{ id: 3, title: "Olahraga", phase: "pagi", micro_target: "", frequency: null, identity_pillar: "", client_id: h.cid }]);
  assert.equal((await all("habits")).length, 1);
  assert.equal(await cidOf("habit", 3), h.cid);
  const m = await mindmaprepo.createMindmap({ title: "Peta" }, {});
  await pullMindmaps([{ id: 4, title: "Peta", is_pinned: 0, updated_at: "2026-10-15T09:00:00", client_id: m.cid }],
    () => Promise.resolve({ id: 4, title: "Peta", data_json: "{}", updated_at: "2026-10-15T09:00:00", client_id: m.cid }));
  assert.equal((await all("mindmaps")).length, 1);
  assert.equal(await cidOf("mindmap", 4), m.cid);
});

// ── R5 ───────────────────────────────────────────────────────────────────────────────────────────
test("R5: writeNote CAS — autosave yang masuk di tengah pull tidak ditimpa versi server", async () => {
  const srv = { id: 5, title: "N", content: "server v1", tags: [], linked_to: [], linked_task_ids: [], pinned: false,
    meta_json: "{}", list_id: null, user_id: 1, updated_at: "2026-10-10T00:00:00", created_at: "2026-10-01T00:00:00" };
  await pullNotes([srv]);
  const cid = await cidOf("note", 5);
  // Simulasi: pull membaca record bersih (rev 0), lalu sebelum menulis, editor menyimpan (rev naik, dirty 1)
  const pullP = pullNotes([Object.assign({}, srv, { content: "server v2", updated_at: "2026-10-11T00:00:00" })]);
  await noterepo.updateNote(cid, { content: "ketikan pengguna" }, {});
  await pullP;
  const rec = await get("scratchpad_notes", cid);
  // salah satu dari dua hasil sah: edit pengguna dipertahankan (CAS batal) atau sudah jadi salinan konflik — tidak pernah hilang
  const copies = (await all("scratchpad_notes")).filter((n) => n.title.indexOf("(konflik)") === 0);
  const kept = rec.content === "ketikan pengguna" || copies.some((c) => c.content === "ketikan pengguna");
  assert.ok(kept, "ketikan pengguna tidak boleh hilang");
});

// ── R10 ──────────────────────────────────────────────────────────────────────────────────────────
test("R10: tombstone habit tanpa op delete (DELETE ditolak permanen) dipulihkan dari server pada pull", async () => {
  await pullHabits([{ id: 3, title: "Baca", phase: "pagi", micro_target: "", frequency: null, identity_pillar: "" }]);
  const cid = await cidOf("habit", 3);
  await habitrepo.deleteHabit(cid, {});
  const tr = transport(() => ({ status: 400, data: { detail: "tidak boleh" } }));
  await pushOutbox(tr);
  assert.equal((await outboxAll()).length, 0, "op delete dibuang (permanen)");
  let rec = await get("habits", cid);
  assert.equal(rec.deleted, true);
  await pullHabits([{ id: 3, title: "Baca", phase: "pagi", micro_target: "", frequency: null, identity_pillar: "" }]);
  rec = await get("habits", cid);
  assert.equal(rec.deleted, false, "habit hidup lagi (server masih punya)");
  assert.equal(rec.dirty, 0);
});

// ── R11 ──────────────────────────────────────────────────────────────────────────────────────────
test("R11: mark occurrence ditolak server (400) → record tetap ada dengan sync_error; pull jendela tidak menghapusnya", async () => {
  await put("tasks", [{ cid: "tk", server_id: 11, title: "Rutin", recurrence_type: "daily", created_at: "2026-10-01T00:00:00",
    recurrence_end_date: "2026-12-31", deleted: false, dirty: 0, rev: 0, gtd_status: "next", priority: "P2", quadrant: "Q2" }]);
  await mapPut("task", 11, "tk");
  const exc = await recurrence.markOccurrence("tk", "2026-10-14", "done", {});
  const tr = transport(() => ({ status: 400, data: { detail: "Tanggal di luar masa recurring" } }));
  await pushOutbox(tr);
  let rec = await get("recurring_exceptions", exc.cid);
  assert.equal(rec.sync_error.status, 400);
  assert.equal((await outboxAll()).length, 0);
  const r = await reconcileRecurringExceptions({ "11": [] }, { from: "2026-09-01", to: "2026-11-30" });
  rec = await get("recurring_exceptions", exc.cid);
  assert.ok(rec, "tidak dihapus diam-diam");
  assert.equal(r.deleted, 0);
  // conflict bar menampilkannya; penandaan ulang = percobaan baru (sync_error hilang, dirty lagi)
  const sc = require("../../static/offline/syncconflict.js");
  const list = await sc.listConflicts();
  assert.ok(list.some((c) => c.entity === "recurring_exception" && c.cid === exc.cid && c.conflict === "sync_error"));
  await recurrence.markOccurrence("tk", "2026-10-14", "skipped", {});
  rec = await get("recurring_exceptions", exc.cid);
  assert.equal(rec.sync_error, undefined);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.status, "skipped");
});
