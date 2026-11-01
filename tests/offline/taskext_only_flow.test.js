"use strict";
// Alur dua anggota untuk edit task yang hanya mengubah ext (spec plugin Fase 1 K25; rencana 1c-0 R1–R8, Review Focus 1–4)
// + regresi payload penuh untuk edit inti normal. Server palsu bersama: baris task dengan field inti + ext; PUT hanya
// menerapkan kunci yang DIKIRIM dan menaikkan updated_at (seperti webapp.py); "anggota A" = mutasi langsung baris
// server; "perangkat B" = IndexedDB (fake-indexeddb) lewat taskrepo + pullTasks + pushOutbox yang asli.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const SP = require("../../static/offline/syncpush.js");
const { pullTasks } = require("../../static/offline/syncpull.js");
const repo = require("../../static/offline/taskrepo.js");
const X = require("../../static/offline/taskext.js");
const tagrepo = require("../../static/offline/tagrepo.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const TODAY = { today: "2026-11-01" };
const EXT_A = "demo-ext.a";
const EXT_B = "demo-ext.b";

// Kunci payload PUT penuh task — DIBEKUKAN dari baseline (syncpush.js sebelum PR 1c-0: `taskToUpdatePayload`,
// dibuktikan lewat skrip sekali jalan terhadap commit 859a2381). Baseline NYATA juga selalu memuat `context_id`
// (null bila tak ber-id; `withContextId` tanpa syarat) dan `project_id` hanya bila record tertaut proyek.
const FULL_KEYS = [
  "title", "description", "priority", "project", "context", "deadline", "gtd_status", "waiting_for", "assigned_to",
  "progress", "is_focused", "recurrence_type", "recurrence_days", "estimated_pomodoros",
];
const PAYLOAD_KEYS = FULL_KEYS.concat(["context_id"]);
const PROJECT_PAYLOAD_KEYS = FULL_KEYS.concat(["project_id", "context_id"]);

const CORE_KEYS = [
  "title", "description", "gtd_status", "priority", "project", "project_id", "context", "context_id", "deadline",
  "waiting_for", "progress", "is_focused", "assigned_to", "recurrence_type", "recurrence_days", "estimated_pomodoros",
];

function fakeServer() {
  const rows = new Map();
  const calls = [];
  let tick = 0;
  const ts = () => "2026-11-01T00:" + String(Math.floor(tick / 60)).padStart(2, "0") + ":" + String(tick++ % 60).padStart(2, "0");
  const srv = {
    calls, rows, coreWrites: 0, hook: null,
    seed(id, core, ext) {
      rows.set(id, {
        id, ext: Object.assign({}, ext || {}), updated_at: "2026-10-31T00:00:00",
        core: Object.assign({
          title: "Judul " + id, description: "", gtd_status: "next", priority: "P3", quadrant: "Q4", project: "", context: "",
          deadline: null, waiting_for: "", completed_at: null, progress: 0, is_focused: 0, assigned_to: null,
          recurrence_type: null, recurrence_days: null, recurrence_end_date: null, recurrence_notif_level: null,
          estimated_pomodoros: 1, pomodoros_done: 0,
        }, core || {}),
      });
    },
    // anggota A: mengubah baris server langsung (updated_at maju)
    memberEdit(id, core) {
      const row = rows.get(id);
      Object.assign(row.core, core);
      row.updated_at = ts();
    },
    dict(row) {
      return Object.assign({ created_at: "2026-06-01T00:00:00", parent_id: null, list_id: null }, row.core,
        { id: row.id, updated_at: row.updated_at, ext: Object.assign({}, row.ext) });
    },
    list() { return Array.from(rows.values()).map((r) => srv.dict(r)); },
    request(method, path, body) {
      calls.push({ method, path, body: JSON.parse(JSON.stringify(body || {})) });
      if (method === "GET" && path === "/api/tasks?include_done=true") return Promise.resolve({ status: 200, data: srv.list() });
      const m = /^\/api\/tasks\/(\d+)$/.exec(path);
      if (method === "PUT" && m) {
        const row = rows.get(Number(m[1]));
        if (!row) return Promise.resolve({ status: 404, data: {} });
        const b = body || {};
        let touched = false;
        for (const k of CORE_KEYS) {
          if (k in b) {
            touched = true;
            row.core[k] = k === "recurrence_days" && Array.isArray(b[k]) ? JSON.stringify(b[k])
              : k === "is_focused" ? (b[k] ? 1 : 0) : (k === "deadline" && b[k] === "" ? null : b[k]);
          }
        }
        if (touched) srv.coreWrites++;
        if (b.ext_patch) row.ext = X.applyPatch(row.ext, b.ext_patch);
        row.updated_at = ts();
        return Promise.resolve({ status: 200, data: srv.dict(row) });
      }
      return Promise.resolve({ status: 404, data: {} });
    },
  };
  // transport untuk pushOutbox; `hook` dijalankan SEKALI di dalam PUT pertama (edit lokal selama request terbang)
  const transport = {
    request(method, path, body) {
      const h = srv.hook;
      if (h && method === "PUT") {
        srv.hook = null;
        return Promise.resolve(h()).then(() => srv.request(method, path, body));
      }
      return srv.request(method, path, body);
    },
  };
  srv.transport = transport;
  return srv;
}

const noTags = () => Promise.resolve([]);
const drain = (srv, opts) => SP.pushOutbox(srv.transport, Object.assign({ tagsFor: noTags }, opts || {}));
const pull = (srv) => pullTasks(srv.list());
const getRec = (cid) => repo.getRaw(cid);
const puts = (srv) => srv.calls.filter((c) => c.method === "PUT");
const stripCalls = (srv) => { srv.calls.length = 0; };

async function allTasks() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const q = db.transaction("tasks").objectStore("tasks").getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function putRaw(rec) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function putOp(cid) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("_outbox", "readwrite");
    tx.objectStore("_outbox").add({ op: "update", entity_type: "task", cid, payload: {}, ts: Date.now() });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// perangkat B sinkron: seed server + pull → record lokal bersih ber-cid; kembalikan cid
async function deviceB(srv, id, core, ext) {
  srv.seed(id, core, ext);
  await pull(srv);
  const cid = await cidOf("task", id);
  assert.ok(cid, "record B harus ada setelah pull");
  const rec = await getRec(cid);
  assert.equal(rec.dirty, 0);
  assert.equal(X.extOnlyNow(rec), false);
  return cid;
}

// ── Review Focus 2: field inti anggota lain tidak tertimpa ───────────────────────────────────────────────────

test("push tanpa pull: A mengubah judul + status selesai + progress 40; B (basi) updateTask {ext_patch} → pushOutbox → body PUT tepat {ext_patch}; baris server mempertahankan nilai A; record B menampilkan nilai A sebelum pull", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  srv.memberEdit(1, { title: "Judul A", gtd_status: "done", progress: 40 });
  stripCalls(srv);

  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  assert.equal((await getRec(cid)).title, "Judul lama", "B masih basi sebelum push");
  await drain(srv);

  assert.deepEqual(srv.calls.map((c) => c.method), ["PUT"], "tanpa tarik: hanya satu PUT");
  assert.deepEqual(srv.calls[0].body, { ext_patch: { [EXT_A]: 1 } });
  assert.equal(srv.coreWrites, 0);
  const row = srv.rows.get(1);
  assert.equal(row.core.title, "Judul A");
  assert.equal(row.core.gtd_status, "done");
  assert.equal(row.core.progress, 40);
  assert.deepEqual(row.ext, { [EXT_A]: 1 });

  // adopsi inti dari respons PUT (R5): B menampilkan nilai A tanpa pull
  const rec = await getRec(cid);
  assert.equal(rec.title, "Judul A");
  assert.equal(rec.gtd_status, "done");
  assert.equal(rec.progress, 40);
  assert.equal(rec.dirty, 0);
  assert.deepEqual(rec.ext, { [EXT_A]: 1 });
  assert.equal("ext_only_rev" in rec, false);
  assert.equal((await outboxAll()).length, 0);
});

test("pull→push: B mengedit ext offline SETELAH A mengubah judul → pullTasks + pushOutbox → nilai A bertahan di server dan di B; ext B di server", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  srv.memberEdit(1, { title: "Judul A", progress: 70 });
  await repo.updateTask(cid, { ext_patch: { [EXT_B]: "b" } }, TODAY); // offline: B belum tahu perubahan A
  assert.equal(X.extOnlyNow(await getRec(cid)), true);
  stripCalls(srv);

  await pull(srv);
  let rec = await getRec(cid);
  assert.equal(rec.title, "Judul A", "server menang untuk record ext saja");
  assert.equal(rec.progress, 70);
  assert.equal(rec.dirty, 1);
  assert.deepEqual(rec.ext, { [EXT_B]: "b" });
  assert.equal(X.extOnlyNow(rec), true);
  assert.equal((await outboxAll()).length, 1, "tepat satu op update");

  await drain(srv);
  assert.deepEqual(puts(srv).map((c) => c.body), [{ ext_patch: { [EXT_B]: "b" } }]);
  assert.equal(srv.coreWrites, 0);
  assert.equal(srv.rows.get(1).core.title, "Judul A");
  assert.equal(srv.rows.get(1).core.progress, 70);
  assert.deepEqual(srv.rows.get(1).ext, { [EXT_B]: "b" });
  rec = await getRec(cid);
  assert.equal(rec.title, "Judul A");
  assert.equal(rec.dirty, 0);
  assert.equal("ext_only_rev" in rec, false);
  assert.deepEqual(rec.ext, { [EXT_B]: "b" });
});

// ── Kombinasi edit sebelum push (tabel R3) ────────────────────────────────────────────────────────────────────

test("B: ext lalu judul sebelum push → satu PUT penuh berisi judul B + ext_patch", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  stripCalls(srv);
  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  await repo.updateTask(cid, { title: "Judul B" }, TODAY);
  assert.equal(X.extOnlyNow(await getRec(cid)), false);
  await drain(srv);
  assert.equal(srv.calls.length, 1, "op kedua dibuang: record sudah bersih");
  const body = srv.calls[0].body;
  assert.deepEqual(Object.keys(body), PAYLOAD_KEYS.concat(["ext_patch"]));
  assert.equal(body.title, "Judul B");
  assert.deepEqual(body.ext_patch, { [EXT_A]: 1 });
  assert.equal(srv.rows.get(1).core.title, "Judul B");
  assert.deepEqual(srv.rows.get(1).ext, { [EXT_A]: 1 });
  assert.equal((await getRec(cid)).dirty, 0);
});

test("B: judul lalu ext sebelum push → satu PUT penuh (sama)", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  stripCalls(srv);
  await repo.updateTask(cid, { title: "Judul B" }, TODAY);
  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  assert.equal(X.extOnlyNow(await getRec(cid)), false, "record kotor tanpa penanda + patch ext → tetap penuh");
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  const body = srv.calls[0].body;
  assert.deepEqual(Object.keys(body), PAYLOAD_KEYS.concat(["ext_patch"]));
  assert.equal(body.title, "Judul B");
  assert.deepEqual(body.ext_patch, { [EXT_A]: 1 });
  assert.equal(srv.rows.get(1).core.title, "Judul B");
});

test("B: 200 task masing-masing satu ext_patch → 200 PUT {ext_patch}, 0 PUT penuh, server tidak mencatat perubahan inti", async () => {
  const srv = fakeServer();
  for (let i = 1; i <= 200; i++) srv.seed(i, { title: "T" + i });
  await pull(srv);
  const tasks = await allTasks();
  assert.equal(tasks.length, 200);
  for (const t of tasks) {
    // anggota lain mengubah judul tiap task: B basi di semua baris
    srv.memberEdit(t.server_id, { title: "A" + t.server_id });
  }
  stripCalls(srv);
  for (const t of tasks) await repo.updateTask(t.cid, { ext_patch: { [EXT_A]: t.server_id } }, TODAY);
  for (let guard = 0; guard < 10 && (await outboxAll()).length; guard++) await drain(srv);
  const ps = puts(srv);
  assert.equal(ps.length, 200);
  assert.equal(ps.filter((c) => Object.keys(c.body).join() !== "ext_patch").length, 0, "0 PUT penuh");
  assert.equal(srv.coreWrites, 0);
  for (const t of tasks) {
    const row = srv.rows.get(t.server_id);
    assert.equal(row.core.title, "A" + t.server_id);
    assert.deepEqual(row.ext, { [EXT_A]: t.server_id });
  }
  assert.equal((await outboxAll()).length, 0);
  assert.equal((await allTasks()).filter((t) => t.dirty).length, 0);
});

test("B: dua ext pada task yang sama sebelum push → 1 PUT", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  stripCalls(srv);
  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  await repo.updateTask(cid, { ext_patch: { [EXT_B]: 2 } }, TODAY);
  assert.equal((await outboxAll()).length, 2);
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.deepEqual(srv.calls[0].body, { ext_patch: { [EXT_A]: 1, [EXT_B]: 2 } });
  assert.equal((await outboxAll()).length, 0);
});

// ── Review Focus 4: edit inti normal tetap payload penuh persis ───────────────────────────────────────────────

const CORE_PATCHES = [
  ["title", { title: "Judul baru" }, (b) => assert.match(b.title, /^Judul baru/)],
  ["gtd_status done", { gtd_status: "done" }, (b) => assert.equal(b.gtd_status, "done")],
  ["progress", { progress: 50 }, (b) => assert.equal(b.progress, 50)],
  ["is_focused", { is_focused: 1 }, (b) => assert.equal(b.is_focused, true)],
  ["deadline", { deadline: "2026-11-20" }, (b) => assert.equal(b.deadline, "2026-11-20")],
  ["assigned_to", { assigned_to: 9 }, (b) => assert.equal(b.assigned_to, 9)],
  ["berulang", { recurrence_type: "weekly", recurrence_days: [1] }, (b) => {
    assert.equal(b.recurrence_type, "weekly");
    assert.deepEqual(b.recurrence_days, [1]);
  }],
  ["description", { description: "isi" }, (b) => assert.equal(b.description, "isi")],
];

for (const [label, patch, check] of CORE_PATCHES) {
  test(`edit inti normal (${label}) → kunci payload persis FULL_KEYS (+ context_id); sama dengan taskToUpdatePayload; title = judul + tag lokal`, async () => {
    const srv = fakeServer();
    const cid = await deviceB(srv, 1, { title: "Judul lama" });
    await tagrepo.addEntityTags("task", cid, ["kopi", "teh"]);
    stripCalls(srv);
    await repo.updateTask(cid, patch, TODAY);
    const rec = await getRec(cid);
    assert.equal(X.extOnlyNow(rec), false);
    assert.equal("ext_only_rev" in rec, false, "patch inti tidak pernah menyetel penanda");
    await drain(srv, { tagsFor: () => Promise.resolve(["kopi", "teh"]) });
    assert.equal(srv.calls.length, 1);
    const body = srv.calls[0].body;
    assert.deepEqual(Object.keys(body), PAYLOAD_KEYS);
    const expected = SP.taskToUpdatePayload(rec, ["kopi", "teh"], [], []);
    assert.deepEqual(Object.keys(expected), PAYLOAD_KEYS, "baseline: taskToUpdatePayload memang menghasilkan FULL_KEYS");
    assert.deepEqual(body, JSON.parse(JSON.stringify(expected)));
    assert.match(body.title, / #kopi #teh$/, "title = judul + tag lokal");
    check(body);
    assert.equal(srv.coreWrites, 1);
  });
}

test("edit inti normal pada record ber-project_id/context_id → FULL_KEYS + project_id + context_id", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama", project: "Proyek", project_id: 5, context: "Tahap", context_id: 6 });
  const before = await getRec(cid);
  assert.equal(before.project_id, 5);
  assert.equal(before.context_id, 6);
  stripCalls(srv);
  await repo.updateTask(cid, { progress: 10 }, TODAY);
  await drain(srv);
  assert.deepEqual(Object.keys(srv.calls[0].body), PROJECT_PAYLOAD_KEYS);
  assert.equal(srv.calls[0].body.project_id, 5);
  assert.equal(srv.calls[0].body.context_id, 6);
});

test("record lama di IndexedDB (dirty, ext_dirty, tanpa penanda — data dari versi 1b) → payload penuh", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  const rec = await getRec(cid);
  // tulis mentah seperti 1b: dirty + ext_dirty, tanpa ext_only_rev
  await putRaw(Object.assign({}, rec, { dirty: 1, rev: (rec.rev || 0) + 1, ext: { [EXT_A]: 1 }, ext_dirty: [EXT_A] }));
  await putOp(cid);
  assert.equal(X.extOnlyNow(await getRec(cid)), false);
  stripCalls(srv);
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.deepEqual(Object.keys(srv.calls[0].body), PAYLOAD_KEYS.concat(["ext_patch"]));
  assert.deepEqual(srv.calls[0].body.ext_patch, { [EXT_A]: 1 });
  assert.equal(srv.coreWrites, 1);
  assert.equal((await getRec(cid)).dirty, 0);
});

// ── Hapus tag (R8) dan carry-over review ──────────────────────────────────────────────────────────────────────

test("hapus tag lokal pada task ext saja lalu push → PUT penuh dengan title tanpa #tag", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul" });
  await tagrepo.addEntityTags("task", cid, ["kopi"]);
  stripCalls(srv);
  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  assert.equal(X.extOnlyNow(await getRec(cid)), true);
  const R = buildTaskRouter();
  assert.deepEqual(await R.dispatch("DELETE", "/api/tasks/1/tags/kopi"), { ok: true });
  assert.equal(X.extOnlyNow(await getRec(cid)), false);
  await drain(srv, { tagsFor: undefined }); // tagsFor bawaan: baca entity_tags lokal
  assert.equal(srv.calls.length, 1);
  const body = srv.calls[0].body;
  assert.deepEqual(Object.keys(body), PAYLOAD_KEYS.concat(["ext_patch"]));
  assert.equal(body.title, "Judul", "title tanpa #kopi");
  assert.deepEqual(body.ext_patch, { [EXT_A]: 1 });
});

test("hapus tag saat PUT ext saja terbang → record tetap dirty, PUT berikutnya penuh (title dengan tag yang tersisa), tidak ada edit hilang", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul" });
  await tagrepo.addEntityTags("task", cid, ["kopi", "teh"]);
  stripCalls(srv);
  await repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  // anggota A mengubah inti sebelum PUT terbang: respons memuat nilai A, sehingga "inti tidak diadopsi" terbedakan
  srv.memberEdit(1, { title: "Judul A", progress: 30 });
  const R = buildTaskRouter();
  srv.hook = () => R.dispatch("DELETE", "/api/tasks/1/tags/kopi");
  await drain(srv, { tagsFor: undefined });
  assert.deepEqual(srv.calls[0].body, { ext_patch: { [EXT_A]: 1 } }, "PUT yang terbang memang ext saja");
  let rec = await getRec(cid);
  assert.equal(rec.dirty, 1, "rev berubah selama terbang → record tetap kotor");
  assert.equal(X.extOnlyNow(rec), false);
  assert.equal(rec.title, "Judul", "inti dari respons (Judul A) TIDAK diadopsi: record sudah bukan ext saja");
  assert.equal(rec.progress, 0);
  assert.equal(srv.rows.get(1).core.title, "Judul A");
  assert.equal((await outboxAll()).length, 1, "op susulan");
  await drain(srv, { tagsFor: undefined });
  assert.equal(srv.calls.length, 2);
  const body = srv.calls[1].body;
  assert.deepEqual(Object.keys(body).slice(0, PAYLOAD_KEYS.length), PAYLOAD_KEYS, "PUT berikutnya penuh");
  assert.equal(body.title, "Judul #teh");
  rec = await getRec(cid);
  assert.equal(rec.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("end-to-end pushOutbox: PUT penuh terbang, lalu edit ext → PUT berikutnya penuh (judul + ext_patch)", async () => {
  const srv = fakeServer();
  const cid = await deviceB(srv, 1, { title: "Judul lama" });
  stripCalls(srv);
  await repo.updateTask(cid, { title: "Judul B" }, TODAY);
  srv.hook = () => repo.updateTask(cid, { ext_patch: { [EXT_A]: 1 } }, TODAY);
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.deepEqual(Object.keys(srv.calls[0].body), PAYLOAD_KEYS, "PUT pertama penuh tanpa ext");
  let rec = await getRec(cid);
  assert.equal(rec.dirty, 1);
  assert.equal(X.extOnlyNow(rec), false, "record kotor tanpa penanda + edit ext → tetap penuh");
  assert.equal((await outboxAll()).length, 1);
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  const body = srv.calls[1].body;
  assert.deepEqual(Object.keys(body), PAYLOAD_KEYS.concat(["ext_patch"]));
  assert.equal(body.title, "Judul B");
  assert.deepEqual(body.ext_patch, { [EXT_A]: 1 });
  rec = await getRec(cid);
  assert.equal(rec.dirty, 0);
  assert.deepEqual(srv.rows.get(1).ext, { [EXT_A]: 1 });
});
