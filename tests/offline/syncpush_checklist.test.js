"use strict";
// Push antrean checklist (checklist offline Fase 2, spec §4.4; rencana PR B2 R4; ADR-051). Entri `subtasks` ditulis
// checklistrepo dan dikirim pushOutbox berurutan per task. Transport palsu membalas bentuk respons server PR A2
// (webapp.py / repository.py: butir + task_progress {done, total, progress, rev, rev_bumped}, changed_ids,
// {items, task_progress}, {ok, deleted_ids, task_progress}).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { mapPut, serverIdOf, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const CR = require("../../static/offline/checklistrepo.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

beforeEach(async () => {
  CR._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
  delete globalThis.dispatchEvent;
});

// ── alat bantu ───────────────────────────────────────────────────────────────

function tx(stores, mode, fn) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let out;
    const r = fn(t);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  }));
}
const put = (store, recs) => tx(store, "readwrite", (t) => { for (const r of recs) t.objectStore(store).put(r); });
const get = (store, key) => tx(store, "readonly", (t) => t.objectStore(store).get(key));
const all = (store) => tx(store, "readonly", (t) => t.objectStore(store).getAll());
const revs = () => CR.getRevs();
const setRevs = (o) => tx("_meta", "readwrite", (t) => { t.objectStore("_meta").put(o, "checklist_revs"); });

function task(over) {
  return Object.assign({
    cid: "t1", server_id: 7, title: "T", description: "", gtd_status: "next", priority: "P3", quadrant: "Q4",
    project: "", context: "", deadline: null, waiting_for: "", assigned_to: null, progress: 10, checklist_total: 2,
    parent_cid: null, recurrence_type: null, recurrence_days: null, deleted: false, dirty: 0, rev: 3,
    base_rev: "2026-11-01T00:00:00", updated_at: "2026-11-01T00:00:00",
  }, over || {});
}
function rec(cid, over) {
  return Object.assign({ cid, server_id: null, task_cid: "t1", parent_cid: null, title: cid, is_done: false, sort_order: 0, created_at: null }, over || {});
}
let nextQid = 1;
function entri(op, cid, payload, over) {
  return Object.assign({ qid: nextQid++, ts: 1, retries: 0, entity_type: "subtasks", op, cid, task_cid: "t1", payload: payload || {} }, over || {});
}
const tp = (rev, bumped, over) => Object.assign({ done: 0, total: 1, progress: 0, rev, rev_bumped: bumped }, over || {});
// Butir bentuk API server (create / PATCH).
const butir = (id, over) => Object.assign({ id, task_id: 7, parent_id: null, depth: 0, title: "x", is_done: false, sort_order: 0 }, over || {});

function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve().then(() => handler(method, path, body, calls.length)).then((h) => {
        if (h === "NETWORK") throw new Error("net");
        if (h === "TIMEOUT") { const e = new Error("t"); e.name = "AbortError"; throw e; }
        return h;
      });
    },
  };
}
function tangkapEvent() {
  const seen = [];
  globalThis.dispatchEvent = (ev) => { seen.push([ev.type, ev.detail]); return true; };
  return seen;
}
const subtaskOps = async () => (await outboxAll()).filter((o) => o.entity_type === "subtasks");
const kunci = (calls) => calls.map((c) => c.method + " " + c.path);

// Task t1 (server 7) dengan butir a (server 11) > a1 (server 12) dan b (belum terkirim, create antre). Rev tersimpan 3.
async function dasar(opts) {
  const o = opts || {};
  nextQid = 1;
  await put("tasks", [task(o.task)]);
  await put("subtasks", [
    rec("a", { server_id: 11, sort_order: 0 }),
    rec("a1", { server_id: 12, parent_cid: "a", sort_order: 0 }),
    rec("b", { sort_order: 1 }),
  ]);
  await mapPut("task", 7, "t1");
  await mapPut("subtask", 11, "a");
  await mapPut("subtask", 12, "a1");
  await setRevs(o.revs || { t1: 3 });
}

// ── kirim per jenis aksi ─────────────────────────────────────────────────────

test("create: POST {title, client_id: cid, parent_id: null, index}; id server diadopsi (+_idmap); rev maju; progress diadopsi", async () => {
  await dasar();
  await put("_outbox", [entri("create", "b", { title: "B", parent_cid: null, index: 1 })]);
  const tr = fakeTransport(() => ({ status: 200, data: Object.assign(butir(21, { title: "B", sort_order: 1 }), { task_progress: tp(4, true, { done: 1, total: 2, progress: 50 }) }) }));
  const r = await pushOutbox(tr);
  assert.deepEqual(tr.calls, [{ method: "POST", path: "/api/tasks/7/subtasks", body: { title: "B", client_id: "b", parent_id: null, index: 1 } }]);
  assert.equal(r.pushed, 1);
  assert.equal((await get("subtasks", "b")).server_id, 21);
  assert.equal(await cidOf("subtask", 21), "b");
  assert.equal((await revs()).t1, 4);
  const t = await get("tasks", "t1");
  assert.deepEqual([t.progress, t.checklist_total, t.dirty, t.rev], [50, 2, 0, 3]);
  assert.equal((await subtaskOps()).length, 0);
  assert.equal(r.checklistRejected, undefined);
});

test("create anak: induk dibuat di drain yang sama (FIFO) → parent_id = id server induk yang baru", async () => {
  await dasar();
  await put("subtasks", [rec("c", { parent_cid: "b" })]);
  await put("_outbox", [
    entri("create", "b", { title: "B", parent_cid: null, index: null }),
    entri("create", "c", { title: "C", parent_cid: "b", index: 0 }),
  ]);
  let id = 20;
  let rev = 3;
  const tr = fakeTransport(() => { id++; rev++; return { status: 200, data: Object.assign(butir(id), { task_progress: tp(rev, true) }) }; });
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => c.body), [
    { title: "B", client_id: "b", parent_id: null, index: null },
    { title: "C", client_id: "c", parent_id: 21, index: 0 },
  ]);
  assert.equal((await get("subtasks", "c")).server_id, 22);
  assert.equal((await revs()).t1, 5);
});

test("rename → PATCH {title}; set_done → PATCH {is_done} saja (cascade_cids lokal tidak dikirim)", async () => {
  await dasar();
  await put("_outbox", [
    entri("rename", "a", { title: "A baru" }),
    entri("set_done", "a", { is_done: true, cascade_cids: ["a1"] }),
  ]);
  let rev = 3;
  const tr = fakeTransport(() => { rev++; return { status: 200, data: Object.assign(butir(11), { changed_ids: [], task_progress: tp(rev, true) }) }; });
  await pushOutbox(tr);
  assert.deepEqual(tr.calls, [
    { method: "PATCH", path: "/api/subtasks/11", body: { title: "A baru" } },
    { method: "PATCH", path: "/api/subtasks/11", body: { is_done: true } },
  ]);
  assert.equal((await revs()).t1, 5);
});

test("move → POST /api/subtasks/{sid}/move {parent_id: id server induk, index}; ke level atas parent_id null", async () => {
  await dasar();
  await put("_outbox", [
    entri("move", "a1", { parent_cid: null, index: 0 }),
    entri("move", "a1", { parent_cid: "a", index: null }),
  ]);
  const tr = fakeTransport(() => ({ status: 200, data: { items: [], task_progress: tp(3, false) } }));
  await pushOutbox(tr);
  assert.deepEqual(tr.calls, [
    { method: "POST", path: "/api/subtasks/12/move", body: { parent_id: null, index: 0 } },
    { method: "POST", path: "/api/subtasks/12/move", body: { parent_id: 11, index: null } },
  ]);
  assert.equal((await revs()).t1, 3, "rev = tersimpan → tetap");
});

test("delete → DELETE; id server dari _idmap walau record butir sudah dihapus lokal; _idmap deleted_ids dibersihkan", async () => {
  await dasar();
  await tx("subtasks", "readwrite", (t) => { t.objectStore("subtasks").delete("a"); t.objectStore("subtasks").delete("a1"); });
  await put("_outbox", [entri("delete", "a", {})]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true, deleted_ids: [11, 12], task_progress: tp(4, true) } }));
  const r = await pushOutbox(tr);
  assert.deepEqual(kunci(tr.calls), ["DELETE /api/subtasks/11"]);
  assert.equal(r.pushed, 1);
  assert.equal((await revs()).t1, 4);
  assert.equal(await serverIdOf("a"), undefined);
  assert.equal(await serverIdOf("a1"), undefined);
  assert.equal((await subtaskOps()).length, 0);
});

test("delete 404 = sukses (tidak dihitung ditolak); tanpa task_progress → rev dikosongkan", async () => {
  await dasar();
  await put("_outbox", [entri("delete", "a", {})]);
  const seen = tangkapEvent();
  const r = await pushOutbox(fakeTransport(() => ({ status: 404, data: { detail: "Subtask not found" } })));
  assert.equal((await subtaskOps()).length, 0);
  assert.equal(r.checklistRejected, undefined);
  assert.equal((await revs()).t1, null);
  assert.deepEqual(seen, []);
});

test("entri tidak dikenal dibuang tanpa request", async () => {
  await dasar();
  await put("_outbox", [entri("putar", "a", {})]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await subtaskOps()).length, 0);
});

test("create yang butirnya sudah ber-id server (terkirim sebelumnya) → dibuang tanpa POST; record hilang → dibuang", async () => {
  await dasar();
  await put("_outbox", [entri("create", "a", { title: "A", parent_cid: null, index: 0 }), entri("create", "hilang", { title: "H", parent_cid: null, index: null })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await subtaskOps()).length, 0);
});

// ── aturan rev (ADR-051) ─────────────────────────────────────────────────────

for (const [nama, stored, resp, harap] of [
  ["rev_bumped dan rev = tersimpan + 1 → maju", 3, tp(4, true), 4],
  ["rev = tersimpan (kirim ulang tanpa perubahan) → tetap", 3, tp(3, false), 3],
  ["rev_bumped tetapi rev = tersimpan + 2 (perangkat lain ikut mengubah) → dikosongkan", 3, tp(5, true), null],
  ["tanpa rev_bumped tetapi rev = tersimpan + 1 (kenaikan milik perangkat lain) → dikosongkan", 3, tp(4, false), null],
  ["tersimpan null tidak pernah dimajukan", null, tp(4, true), null],
  ["rev mundur → dikosongkan", 3, tp(2, true), null],
]) {
  test("rev: " + nama, async () => {
    await dasar({ revs: { t1: stored } });
    await put("_outbox", [entri("rename", "a", { title: "Z" })]);
    await pushOutbox(fakeTransport(() => ({ status: 200, data: Object.assign(butir(11), { changed_ids: [], task_progress: resp }) })));
    assert.equal((await revs()).t1, harap);
  });
}

test("rev: task tanpa rev tersimpan (kunci tidak ada) → dikosongkan (null, diambil ulang)", async () => {
  await dasar({ revs: {} });
  await put("_outbox", [entri("rename", "a", { title: "Z" })]);
  await pushOutbox(fakeTransport(() => ({ status: 200, data: Object.assign(butir(11), { changed_ids: [], task_progress: tp(1, true) }) })));
  const r = await revs();
  assert.ok("t1" in r);
  assert.equal(r.t1, null);
});

// ── progress (E5) ────────────────────────────────────────────────────────────

test("progress diadopsi hanya dari respons entri terakhir task itu (tanpa nilai antara yang melompat)", async () => {
  await dasar();
  await put("tasks", [task({ progress: 100, checklist_total: 2 })]);
  await put("_outbox", [entri("set_done", "a", { is_done: true }), entri("rename", "a", { title: "Q" })]);
  const tulis = [];
  let n = 0;
  const tr = fakeTransport(async () => {
    tulis.push((await get("tasks", "t1")).progress);
    n++;
    return { status: 200, data: Object.assign(butir(11), { changed_ids: [], task_progress: tp(3 + n, true, { done: n, total: 2, progress: n === 1 ? 50 : 100 }) }) };
  });
  await pushOutbox(tr);
  assert.deepEqual(tulis, [100, 100], "progress lokal tidak ditimpa nilai antara 50");
  assert.equal((await get("tasks", "t1")).progress, 100);
});

// ── menunggu (urutan per task) ───────────────────────────────────────────────

test("task belum terkirim: create task gagal sementara (500) → entri checklist tetap antre tanpa request", async () => {
  await dasar({ task: { cid: "t2", server_id: null, dirty: 1 }, revs: {} });
  await put("tasks", [task()]);
  await put("subtasks", [rec("n", { task_cid: "t2" })]);
  await put("_outbox", [
    { qid: 50, ts: 1, retries: 0, entity_type: "task", op: "create", cid: "t2", payload: {} },
    entri("create", "n", { title: "N", parent_cid: null, index: null }, { task_cid: "t2", qid: 51 }),
  ]);
  const tr = fakeTransport((m, p) => (p === "/api/tasks" ? { status: 500, data: {} } : { status: 200, data: {} }));
  await pushOutbox(tr);
  assert.deepEqual(kunci(tr.calls), ["POST /api/tasks"]);
  assert.equal((await subtaskOps()).length, 1);
});

test("task baru terkirim di drain yang sama: id server dicatat (noteTaskServerId), rev 0 disimpan, butir dikirim dan rev maju ke 1", async () => {
  nextQid = 60;
  await put("tasks", [task({ cid: "t2", server_id: null, dirty: 1, progress: 0, checklist_total: 1 })]);
  await put("subtasks", [rec("n", { task_cid: "t2" })]);
  await put("_outbox", [
    { qid: 50, ts: 1, retries: 0, entity_type: "task", op: "create", cid: "t2", payload: {} },
    entri("create", "n", { title: "N", parent_cid: null, index: null }, { task_cid: "t2" }),
  ]);
  await CR.start();
  const tr = fakeTransport((m, p) => {
    if (p === "/api/tasks") return { status: 201, data: { id: 70, title: "T", updated_at: "2026-11-12T00:00:00", progress: 0, checklist_total: 0, checklist_rev: 0 } };
    return { status: 200, data: Object.assign(butir(31, { task_id: 70 }), { task_progress: tp(1, true, { done: 0, total: 1, progress: 0 }) }) };
  });
  await pushOutbox(tr);
  assert.deepEqual(kunci(tr.calls), ["POST /api/tasks", "POST /api/tasks/70/subtasks"]);
  assert.equal((await revs()).t2, 1);
  assert.equal(CR.knowsTask(70), true);
  assert.equal((await get("subtasks", "n")).server_id, 31);
});

test("task baru tanpa butir lokal → rev tidak disimpan; rev kosong (null) tidak ditimpa 0", async () => {
  await put("tasks", [task({ cid: "t2", server_id: null, dirty: 1 }), task({ cid: "t3", server_id: null, dirty: 1 })]);
  await put("subtasks", [rec("m", { task_cid: "t3" })]);
  await setRevs({ t3: null });
  await put("_outbox", [
    { qid: 1, ts: 1, retries: 0, entity_type: "task", op: "create", cid: "t2", payload: {} },
    { qid: 2, ts: 1, retries: 0, entity_type: "task", op: "create", cid: "t3", payload: {} },
  ]);
  let id = 80;
  await pushOutbox(fakeTransport(() => ({ status: 201, data: { id: ++id, updated_at: "2026-11-12T00:00:00" } })));
  const r = await revs();
  assert.equal("t2" in r, false);
  assert.equal(r.t3, null);
});

test("task tanpa id server dan tanpa create antre (sync_error) → entri checklist ditahan, tidak dibuang", async () => {
  await dasar({ task: { server_id: null, sync_error: { status: 422 } }, revs: {} });
  await tx("_idmap", "readwrite", (t) => { t.objectStore("_idmap").delete("task:7"); });
  await put("_outbox", [entri("rename", "a", { title: "Z" })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await subtaskOps()).length, 1);
});

test("task sedang konflik (remote_deleted / access_lost) → entri checklist ditahan seperti op task", async () => {
  await dasar({ task: { conflict: "access_lost" } });
  await put("_outbox", [entri("rename", "a", { title: "Z" })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await subtaskOps()).length, 1);
  assert.equal(r.checklistRejected, undefined);
});

test("entri rusak tanpa task_cid dibuang (tidak macet di setiap drain)", async () => {
  await dasar();
  await put("_outbox", [entri("rename", "a", { title: "Z" }, { task_cid: undefined })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await subtaskOps()).length, 0);
  assert.equal(r.failed, 0);
});

test("task tidak ada / terhapus lokal → checklist-nya dibuang (purgeTask) tanpa request", async () => {
  await dasar();
  await put("tasks", [task({ deleted: true })]);
  await put("_outbox", [entri("rename", "a", { title: "Z" }), entri("create", "x", { title: "X", parent_cid: null, index: null }, { task_cid: "hilang" })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal((await subtaskOps()).length, 0);
  assert.equal((await all("subtasks")).length, 0);
  assert.equal("t1" in (await revs()), false);
});

test("induk dengan create antre yang gagal sementara → anak ditahan, entri task itu sesudahnya ikut ditahan; task lain jalan", async () => {
  await dasar();
  await put("tasks", [task({ cid: "t9", server_id: 9 })]);
  await put("subtasks", [rec("c", { parent_cid: "b" }), rec("z", { task_cid: "t9", server_id: 90 })]);
  await mapPut("subtask", 90, "z");
  await put("_outbox", [
    entri("create", "b", { title: "B", parent_cid: null, index: null }),
    entri("create", "c", { title: "C", parent_cid: "b", index: null }),
    entri("rename", "a", { title: "A2" }),
    entri("rename", "z", { title: "Z2" }, { task_cid: "t9" }),
  ]);
  const tr = fakeTransport((m, p) => (p === "/api/tasks/7/subtasks" ? { status: 503, data: {} }
    : { status: 200, data: Object.assign(butir(90), { changed_ids: [], task_progress: tp(1, true) }) }));
  const r = await pushOutbox(tr);
  assert.deepEqual(kunci(tr.calls), ["POST /api/tasks/7/subtasks", "PATCH /api/subtasks/90"]);
  assert.deepEqual((await subtaskOps()).map((o) => o.cid), ["b", "c", "a"]);
  assert.equal(r.failed, 1);
  assert.equal(r.checklistRejected, undefined);
});

test("galat sementara: 429 / timeout menahan task; jaringan dan 401 menghentikan drain; entri tetap", async () => {
  for (const [jawab, berhenti] of [[{ status: 429, data: {} }, false], ["TIMEOUT", false], ["NETWORK", true], [{ status: 401, data: {} }, true]]) {
    CR._reset();
    TFdb._reset();
    await deleteDB(TFdb.DB_NAME);
    await dasar();
    await put("tasks", [task({ cid: "t9", server_id: 9 })]);
    await put("subtasks", [rec("z", { task_cid: "t9", server_id: 90 })]);
    await mapPut("subtask", 90, "z");
    await put("_outbox", [
      entri("rename", "a", { title: "A2" }),
      entri("rename", "a1", { title: "A3" }),
      entri("rename", "z", { title: "Z2" }, { task_cid: "t9" }),
    ]);
    const tr = fakeTransport((m, p) => (p === "/api/subtasks/90" ? { status: 200, data: Object.assign(butir(90), { task_progress: tp(1, true) }) } : jawab));
    await pushOutbox(tr);
    assert.deepEqual(kunci(tr.calls), berhenti ? ["PATCH /api/subtasks/11"] : ["PATCH /api/subtasks/11", "PATCH /api/subtasks/90"], String(jawab));
    const sisa = (await subtaskOps()).map((o) => o.cid);
    assert.deepEqual(sisa, berhenti ? ["a", "a1", "z"] : ["a", "a1"], String(jawab));
    assert.equal((await revs()).t1, 3, "galat sementara tidak menyentuh rev");
  }
});

// ── ditolak ──────────────────────────────────────────────────────────────────

test("ditolak 422/404/403: entri dibuang, rev dikosongkan, dihitung; satu event tf:checklist-rejected {count}", async () => {
  await dasar();
  await put("_outbox", [
    entri("rename", "a", { title: "A2" }),
    entri("set_done", "a1", { is_done: true }),
    entri("move", "a1", { parent_cid: null, index: 0 }),
    entri("rename", "a", { title: "A3" }),
  ]);
  const seen = tangkapEvent();
  const jawab = [{ status: 404, data: { detail: "Subtask not found" } }, { status: 403, data: {} }, { status: 422, data: { detail: "Induk checklist tidak ditemukan" } },
    { status: 200, data: Object.assign(butir(11), { changed_ids: [], task_progress: tp(9, true) }) }];
  const r = await pushOutbox(fakeTransport((m, p, b, i) => jawab[i - 1]));
  assert.equal(r.checklistRejected, 3);
  assert.equal((await subtaskOps()).length, 0);
  assert.equal((await revs()).t1, null, "rev dikosongkan dan tidak dimajukan respons sesudahnya");
  assert.deepEqual(seen, [["tf:checklist-rejected", { count: 3 }]]);
});

test("create ditolak: entri lain butir itu (tanpa id server, tanpa create antre) ikut dibuang; anaknya ditolak saat diproses", async () => {
  await dasar();
  await put("subtasks", [rec("c", { parent_cid: "b" })]);
  await put("_outbox", [
    entri("create", "b", { title: "B", parent_cid: "a", index: null }),
    entri("rename", "b", { title: "B2" }),
    entri("set_done", "b", { is_done: true }),
    entri("create", "c", { title: "C", parent_cid: "b", index: null }),
    entri("rename", "a1", { title: "A1" }),
  ]);
  const seen = tangkapEvent();
  const tr = fakeTransport((m, p) => (m === "POST" ? { status: 422, data: { detail: "Induk checklist tidak ditemukan" } }
    : { status: 200, data: Object.assign(butir(12), { changed_ids: [], task_progress: tp(5, true) }) }));
  const r = await pushOutbox(tr);
  assert.deepEqual(kunci(tr.calls), ["POST /api/tasks/7/subtasks", "PATCH /api/subtasks/12"], "create c tidak dikirim (induk yatim)");
  assert.equal(r.checklistRejected, 2);
  assert.equal((await subtaskOps()).length, 0);
  assert.deepEqual(seen, [["tf:checklist-rejected", { count: 2 }]]);
  assert.equal((await revs()).t1, null);
});

test("induk tanpa id server dan tanpa create antre → ditolak (dibuang + dihitung) tanpa request", async () => {
  await dasar();
  await put("subtasks", [rec("c", { parent_cid: "b" })]);
  await put("_outbox", [entri("create", "c", { title: "C", parent_cid: "b", index: null }), entri("move", "a1", { parent_cid: "b", index: 0 })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.checklistRejected, 2);
  assert.equal((await subtaskOps()).length, 0);
  assert.equal((await revs()).t1, null);
});

test("butir tanpa id server dan tanpa create antre (rename/set_done yatim) → ditolak tanpa request", async () => {
  await dasar();
  await put("_outbox", [entri("rename", "b", { title: "B2" })]);
  const tr = fakeTransport(() => ({ status: 200, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.checklistRejected, 1);
});

test("tanpa penolakan → tidak ada event tf:checklist-rejected", async () => {
  await dasar();
  await put("_outbox", [entri("rename", "a", { title: "Z" })]);
  const seen = tangkapEvent();
  await pushOutbox(fakeTransport(() => ({ status: 200, data: Object.assign(butir(11), { task_progress: tp(4, true) }) })));
  assert.deepEqual(seen, []);
});

// ── antrean berubah selama drain ─────────────────────────────────────────────

test("entri dibaca ulang dari _outbox: entri yang dibuang aksi lokal selama drain tidak dikirim; payload yang ditulis ulang dipakai", async () => {
  await dasar();
  await put("subtasks", [rec("c", { parent_cid: "b" })]);
  await put("_outbox", [
    entri("rename", "a", { title: "A2" }),
    entri("create", "c", { title: "C", parent_cid: "b", index: 2 }),
    entri("rename", "a1", { title: "A3" }),
  ]);
  const tr = fakeTransport(async (m, p, b, i) => {
    if (i === 1) {
      // selama PATCH pertama: aksi lokal menulis ulang create c ke level atas dan membuang rename a1
      const ops = await subtaskOps();
      const c = ops.find((o) => o.cid === "c");
      await put("_outbox", [Object.assign({}, c, { payload: { title: "C", parent_cid: null, index: null } })]);
      await tx("_outbox", "readwrite", (t) => { t.objectStore("_outbox").delete(ops.find((o) => o.cid === "a1").qid); });
    }
    return { status: 200, data: Object.assign(butir(40 + i), { task_progress: tp(3 + i, true) }) };
  });
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => [c.method, c.path, c.body]), [
    ["PATCH", "/api/subtasks/11", { title: "A2" }],
    ["POST", "/api/tasks/7/subtasks", { title: "C", client_id: "c", parent_id: null, index: null }],
  ]);
});

test("butir dihapus lokal saat create-nya terkirim (hantu): DELETE id server itu di drain yang sama", async () => {
  await dasar();
  await put("_outbox", [entri("create", "b", { title: "B", parent_cid: null, index: null })]);
  const tr = fakeTransport(async (m, p, b, i) => {
    if (i === 1) {
      // aksi hapus lokal selama POST: record + entri create dibuang (checklistrepo.remove)
      await tx(["subtasks", "_outbox"], "readwrite", (t) => { t.objectStore("subtasks").delete("b"); t.objectStore("_outbox").delete(1); });
      return { status: 200, data: Object.assign(butir(21), { task_progress: tp(4, true) }) };
    }
    return { status: 200, data: { ok: true, deleted_ids: [21], task_progress: tp(5, true) } };
  });
  const r = await pushOutbox(tr);
  assert.deepEqual(kunci(tr.calls), ["POST /api/tasks/7/subtasks", "DELETE /api/subtasks/21"]);
  assert.equal((await subtaskOps()).length, 0);
  assert.equal((await revs()).t1, 5);
  assert.equal(r.checklistRejected, undefined);
  assert.equal(await cidOf("subtask", 21), undefined);
});

test("hantu: DELETE gagal sementara → entri delete {server_id} tetap antre dan dikirim di drain berikutnya", async () => {
  await dasar();
  await put("_outbox", [entri("create", "b", { title: "B", parent_cid: null, index: null })]);
  const tr = fakeTransport(async (m, p, b, i) => {
    if (i === 1) {
      await tx(["subtasks", "_outbox"], "readwrite", (t) => { t.objectStore("subtasks").delete("b"); t.objectStore("_outbox").delete(1); });
      return { status: 200, data: Object.assign(butir(21), { task_progress: tp(4, true) }) };
    }
    return { status: 502, data: {} };
  });
  await pushOutbox(tr);
  const sisa = await subtaskOps();
  assert.deepEqual(sisa.map((o) => [o.op, o.cid, o.payload]), [["delete", "b", { server_id: 21 }]]);
  const tr2 = fakeTransport(() => ({ status: 404, data: {} }));
  await pushOutbox(tr2);
  assert.deepEqual(kunci(tr2.calls), ["DELETE /api/subtasks/21"]);
  assert.equal((await subtaskOps()).length, 0);
});
