"use strict";
// TF.checklistroutes — rute lokal checklist (checklist offline Fase 2, spec §4.3, E6, E7; rencana PR B2 R3).
// Respons meniru server (webapp.py): item + task_progress (POST), item + changed_ids + task_progress (PATCH/toggle),
// {items, task_progress} (move), {ok, deleted_ids, task_progress} (DELETE); task_progress lokal {done, total,
// progress} tanpa rev. Galat validasi 422 berteks persis server; butir/task tak dikenal 404.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const CR = require("../../static/offline/checklistrepo.js");
const RT = require("../../static/offline/checklistroutes.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "static/offline/checklistroutes.js");
const ITEM_KEYS = ["depth", "id", "is_done", "parent_id", "sort_order", "task_id", "title"];

beforeEach(async () => {
  CR._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
  delete globalThis.__userEpoch;
});

function put(store, recs) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    for (const r of recs) t.objectStore(store).put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}
function task(over) {
  return Object.assign({ cid: "t1", server_id: 7, title: "T", progress: 0, checklist_total: 0, dirty: 0, rev: 1, deleted: false }, over || {});
}
function rec(cid, over) {
  return Object.assign({ cid, server_id: null, task_cid: "t1", parent_cid: null, title: cid, is_done: false, sort_order: 0, created_at: null }, over || {});
}
// a(11) > a1(12); b (cid, belum tersinkron). Task t1 = 7; t2 belum tersinkron tanpa butir.
async function siapkan() {
  await put("tasks", [task(), task({ cid: "t2", server_id: null })]);
  await put("subtasks", [rec("a", { server_id: 11 }), rec("a1", { server_id: 12, parent_cid: "a" }), rec("b", { sort_order: 1 })]);
  await mapPut("subtask", 11, "a");
  await mapPut("subtask", 12, "a1");
}
const ops = async () => (await outboxAll()).filter((o) => o.entity_type === "subtasks").map((o) => [o.op, o.cid, o.payload]);
async function galat(p, status, detail) {
  await assert.rejects(p, (e) => {
    assert.equal(e.status, status);
    assert.deepEqual(e.body, { detail });
    assert.equal(e.message, detail);
    return true;
  });
}
const kunci = (o) => Object.keys(o).sort();

// ── modul ────────────────────────────────────────────────────────────────────

test("modul: di browser terpasang sebagai TF.checklistroutes", () => {
  const ctx = { self: { TF: {} } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);
  const api = ctx.self.TF.checklistroutes;
  for (const k of ["registerChecklistRoutes", "routeDecision", "parseCall"]) assert.equal(typeof api[k], "function", k);
  assert.deepEqual(JSON.parse(JSON.stringify(api.ERRORS)), { // lewat JSON: objek milik realm vm
    PARENT_NOT_FOUND: "Induk checklist tidak ditemukan",
    CYCLE: "Butir tidak bisa dipindah ke dalam dirinya sendiri",
    EMPTY_TITLE: "Teks butir tidak boleh kosong",
    NO_CHANGE: "Tidak ada perubahan",
  });
});

test("modul: teks galat sama dengan _CHECKLIST_ERRORS di webapp.py", () => {
  const py = fs.readFileSync(path.join(ROOT, "webapp.py"), "utf8");
  for (const [code, text] of Object.entries(RT.ERRORS)) assert.ok(py.includes(`"${code}": "${text}"`), code);
});

test("modul: dimuat index.html tepat setelah checklistrepo.js (sebelum taskroutes.js) dan ada di STATIC sw.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
  assert.match(html, /<script src="\/static\/offline\/checklistrepo\.js"><\/script>\s*\n\s*<script src="\/static\/offline\/checklistroutes\.js"><\/script>/);
  assert.ok(html.indexOf("/static/offline/checklistroutes.js") < html.indexOf("/static/offline/taskroutes.js"));
  const sw = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");
  assert.match(sw, /"\/static\/offline\/checklistrepo\.js",\s*\n\s*"\/static\/offline\/checklistroutes\.js",/);
});

test("buildTaskRouter mendaftarkan semua rute checklist", () => {
  const R = buildTaskRouter();
  for (const [m, p] of [["GET", "/api/tasks/7/subtasks"], ["POST", "/api/tasks/7/subtasks"], ["PATCH", "/api/subtasks/5"],
    ["POST", "/api/subtasks/5/toggle"], ["POST", "/api/subtasks/5/move"], ["DELETE", "/api/subtasks/5"]]) {
    assert.equal(R.hasRoute(m, p), true, m + " " + p);
  }
});

// ── GET ──────────────────────────────────────────────────────────────────────

test("GET /api/tasks/:id/subtasks: lewat id server maupun cid → pre-order bentuk server", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const lewatId = await R.dispatch("GET", "/api/tasks/7/subtasks");
  assert.deepEqual(lewatId.map((x) => [x.id, x.parent_id, x.depth, x.task_id]), [[11, null, 0, 7], [12, 11, 1, 7], ["b", null, 0, 7]]);
  for (const x of lewatId) assert.deepEqual(kunci(x), ITEM_KEYS);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/t1/subtasks"), lewatId);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/t2/subtasks"), []);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/tidak-ada/subtasks"), []);
});

// ── POST tambah ──────────────────────────────────────────────────────────────

test("POST /api/tasks/:id/subtasks: butir + task_progress (tanpa rev) dan antrean create", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const r = await R.dispatch("POST", "/api/tasks/7/subtasks", { title: " x ", client_id: "ui-1", parent_id: 11 });
  assert.deepEqual(kunci(r), ITEM_KEYS.concat(["task_progress"]).sort());
  assert.deepEqual([r.title, r.parent_id, r.depth, r.sort_order, r.task_id, r.is_done], ["x", 11, 1, 1, 7, false]);
  assert.deepEqual(r.task_progress, { done: 0, total: 2, progress: 0 });
  assert.deepEqual(await ops(), [["create", r.id, { title: "x", parent_cid: "a", index: null }]]);
});

test("POST di task belum tersinkron (id = cid) dan induk cid", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const p = await R.dispatch("POST", "/api/tasks/t2/subtasks", { title: "p" });
  const c = await R.dispatch("POST", "/api/tasks/t2/subtasks", { title: "c", parent_id: p.id, index: 0 });
  assert.deepEqual([p.task_id, c.task_id, c.parent_id, c.depth], ["t2", "t2", p.id, 1]);
  assert.deepEqual((await R.dispatch("GET", "/api/tasks/t2/subtasks")).map((x) => x.id), [p.id, c.id]);
});

test("POST: galat 422 berteks server dan 404 task tidak dikenal; tanpa antrean", async () => {
  await siapkan();
  await put("tasks", [task({ cid: "t9", server_id: 9, deleted: true })]);
  const R = buildTaskRouter();
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", { title: "   " }), 422, "Teks butir tidak boleh kosong");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", {}), 422, "Teks butir tidak boleh kosong");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", undefined), 422, "Teks butir tidak boleh kosong");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", { title: "x", parent_id: 999 }), 422, "Induk checklist tidak ditemukan");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", { title: "x", index: -1 }), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", { title: "x", index: 1.5 }), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", { title: "x", parent_id: {} }), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/tasks/7/subtasks", { title: "x", client_id: 5 }), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/tasks/99/subtasks", { title: "x" }), 404, "Task not found");
  await galat(R.dispatch("POST", "/api/tasks/9/subtasks", { title: "x" }), 404, "Task not found");
  assert.deepEqual(await ops(), []);
});

// ── PATCH / toggle ───────────────────────────────────────────────────────────

test("PATCH /api/subtasks/:id title → butir + changed_ids [] + task_progress; antrean rename", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const r = await R.dispatch("PATCH", "/api/subtasks/12", { title: " baru " });
  assert.deepEqual(kunci(r), ITEM_KEYS.concat(["changed_ids", "task_progress"]).sort());
  assert.deepEqual([r.id, r.title, r.changed_ids], [12, "baru", []]);
  assert.deepEqual(r.task_progress, { done: 0, total: 2, progress: 0 });
  assert.deepEqual(await ops(), [["rename", "a1", { title: "baru" }]]);
});

test("PATCH is_done true (berantai) lewat id server dan cid; antrean set_done", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const r = await R.dispatch("PATCH", "/api/subtasks/11", { is_done: true });
  assert.deepEqual([r.id, r.is_done, r.changed_ids], [11, true, [11, 12]]);
  assert.deepEqual(r.task_progress, { done: 1, total: 2, progress: 50 });
  const b = await R.dispatch("PATCH", "/api/subtasks/b", { is_done: true });
  assert.deepEqual([b.id, b.changed_ids, b.task_progress], ["b", ["b"], { done: 2, total: 2, progress: 100 }]);
  assert.deepEqual(await ops(), [["set_done", "a", { is_done: true, cascade_cids: ["a1"] }], ["set_done", "b", { is_done: true }]]);
});

test("PATCH: tidak dikenal → 404 (sebelum cek body); body kosong → 422 Tidak ada perubahan; judul kosong / tipe salah → 422", async () => {
  await siapkan();
  const R = buildTaskRouter();
  await galat(R.dispatch("PATCH", "/api/subtasks/99", {}), 404, "Subtask not found");
  await galat(R.dispatch("PATCH", "/api/subtasks/zz", { title: "x" }), 404, "Subtask not found");
  await galat(R.dispatch("PATCH", "/api/subtasks/11", {}), 422, "Tidak ada perubahan");
  await galat(R.dispatch("PATCH", "/api/subtasks/11", undefined), 422, "Tidak ada perubahan");
  await galat(R.dispatch("PATCH", "/api/subtasks/11", { title: "" }), 422, "Teks butir tidak boleh kosong");
  await galat(R.dispatch("PATCH", "/api/subtasks/11", { title: 5 }), 422, "Data tidak valid");
  await galat(R.dispatch("PATCH", "/api/subtasks/11", { is_done: "ya" }), 422, "Data tidak valid");
  assert.deepEqual(await ops(), []);
});

test("POST /api/subtasks/:id/toggle → butir + changed_ids + task_progress; antrean set_done (bukan toggle)", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const r = await R.dispatch("POST", "/api/subtasks/12/toggle");
  assert.deepEqual(kunci(r), ITEM_KEYS.concat(["changed_ids", "task_progress"]).sort());
  assert.deepEqual([r.id, r.is_done, r.changed_ids], [12, true, [12]]);
  const lagi = await R.dispatch("POST", "/api/subtasks/a1/toggle");
  assert.deepEqual([lagi.id, lagi.is_done], [12, false]);
  assert.deepEqual(await ops(), [["set_done", "a1", { is_done: true }], ["set_done", "a1", { is_done: false }]]);
  await galat(R.dispatch("POST", "/api/subtasks/99/toggle"), 404, "Subtask not found");
});

// ── pindah ───────────────────────────────────────────────────────────────────

test("POST /api/subtasks/:id/move → {items, task_progress}; antrean move {parent_cid, index}", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const r = await R.dispatch("POST", "/api/subtasks/b/move", { parent_id: 11, index: 0 });
  assert.deepEqual(kunci(r), ["items", "task_progress"]);
  assert.deepEqual(r.items.map((x) => [x.id, x.depth, x.parent_id, x.sort_order]), [[11, 0, null, 0], ["b", 1, 11, 0], [12, 1, 11, 1]]);
  for (const x of r.items) assert.deepEqual(kunci(x), ITEM_KEYS);
  assert.deepEqual(r.task_progress, { done: 0, total: 1, progress: 0 });
  assert.deepEqual(await ops(), [["move", "b", { parent_cid: "a", index: 0 }]]);
});

test("move: galat CYCLE / PARENT_NOT_FOUND berteks server; parent_id wajib ada; index tidak sah → 422; 404", async () => {
  await siapkan();
  const R = buildTaskRouter();
  await galat(R.dispatch("POST", "/api/subtasks/11/move", { parent_id: 11 }), 422, "Butir tidak bisa dipindah ke dalam dirinya sendiri");
  await galat(R.dispatch("POST", "/api/subtasks/11/move", { parent_id: 12, index: 0 }), 422, "Butir tidak bisa dipindah ke dalam dirinya sendiri");
  await galat(R.dispatch("POST", "/api/subtasks/b/move", { parent_id: 999 }), 422, "Induk checklist tidak ditemukan");
  await galat(R.dispatch("POST", "/api/subtasks/b/move", { index: 0 }), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/subtasks/b/move", undefined), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/subtasks/b/move", { parent_id: null, index: -2 }), 422, "Data tidak valid");
  await galat(R.dispatch("POST", "/api/subtasks/99/move", { parent_id: null }), 404, "Subtask not found");
  const top = await R.dispatch("POST", "/api/subtasks/12/move", { parent_id: null });
  assert.deepEqual(top.items.map((x) => [x.id, x.depth]), [[11, 0], ["b", 0], [12, 0]]);
  assert.deepEqual(await ops(), [["move", "a1", { parent_cid: null, index: null }]]);
});

// ── hapus ────────────────────────────────────────────────────────────────────

test("DELETE /api/subtasks/:id → {ok, deleted_ids, task_progress}; antrean delete untuk akar tersinkron", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const r = await R.dispatch("DELETE", "/api/subtasks/11");
  assert.deepEqual(r, { ok: true, deleted_ids: [11, 12], task_progress: { done: 0, total: 1, progress: 0 } });
  assert.deepEqual(await ops(), [["delete", "a", {}]]);
  await galat(R.dispatch("DELETE", "/api/subtasks/11"), 404, "Subtask not found");
});

test("DELETE butir yang belum terkirim: antrean create-nya dibuang tanpa delete", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const n = await R.dispatch("POST", "/api/tasks/7/subtasks", { title: "n" });
  const r = await R.dispatch("DELETE", "/api/subtasks/" + n.id);
  assert.deepEqual(r.deleted_ids, [n.id]);
  assert.deepEqual(await ops(), []);
});

// ── keputusan routing ────────────────────────────────────────────────────────

test("parseCall: hanya endpoint checklist (metode + path), query dan garis miring akhir diabaikan", () => {
  assert.deepEqual(RT.parseCall("get", "/api/tasks/7/subtasks?x=1"), { kind: "task", method: "GET", id: "7" });
  assert.deepEqual(RT.parseCall("POST", "/api/tasks/t-1/subtasks/"), { kind: "task", method: "POST", id: "t-1" });
  assert.deepEqual(RT.parseCall("PATCH", "/api/subtasks/5"), { kind: "item", method: "PATCH", id: "5", action: "" });
  assert.deepEqual(RT.parseCall("DELETE", "/api/subtasks/c-1"), { kind: "item", method: "DELETE", id: "c-1", action: "" });
  assert.deepEqual(RT.parseCall("POST", "/api/subtasks/5/toggle"), { kind: "item", method: "POST", id: "5", action: "toggle" });
  assert.deepEqual(RT.parseCall("POST", "/api/subtasks/5/move"), { kind: "item", method: "POST", id: "5", action: "move" });
  for (const [m, p] of [["PUT", "/api/subtasks/5"], ["POST", "/api/subtasks/5"], ["GET", "/api/subtasks/5"],
    ["GET", "/api/subtasks/5/toggle"], ["DELETE", "/api/tasks/7/subtasks"], ["GET", "/api/tasks/7/notes"],
    ["GET", "/api/checklists?task_ids=1"], ["GET", "/api/tasks/7"]]) {
    assert.equal(RT.parseCall(m, p), null, m + " " + p);
  }
});

test("routeDecision sebelum siap (unduhan awal belum selesai): id angka ke jaringan (v502); id cid selalu lokal (F2)", async () => {
  await siapkan();
  await CR.start();
  assert.equal(CR.isReady(), false);
  // cid: server selalu menolak id bukan angka → lokal walau belum siap (task yang dibuat offline bisa diberi checklist)
  for (const [m, p] of [["GET", "/api/tasks/t2/subtasks"], ["POST", "/api/tasks/t2/subtasks"], ["PATCH", "/api/subtasks/b"],
    ["POST", "/api/subtasks/b/toggle"], ["POST", "/api/subtasks/b/move"], ["DELETE", "/api/subtasks/b"]]) {
    assert.equal(RT.routeDecision(m, p), true, m + " " + p);
  }
  for (const [m, p] of [["GET", "/api/tasks/7/subtasks"], ["POST", "/api/tasks/7/subtasks"], ["PATCH", "/api/subtasks/11"],
    ["POST", "/api/subtasks/11/toggle"], ["DELETE", "/api/subtasks/11"]]) {
    assert.equal(RT.routeDecision(m, p), false, m + " " + p);
  }
  assert.equal(RT.routeDecision("GET", "/api/tasks/7"), null);
});

test("sebelum siap: task dibuat offline langsung bisa diberi checklist lewat rute lokal; GET cid tak dikenal tetap []", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const n = await R.dispatch("POST", "/api/tasks/t2/subtasks", { title: "pertama" });
  assert.equal(RT.routeDecision("PATCH", "/api/subtasks/" + n.id), true);
  await R.dispatch("PATCH", "/api/subtasks/" + n.id, { is_done: true });
  assert.deepEqual((await R.dispatch("GET", "/api/tasks/t2/subtasks")).map((x) => [x.title, x.is_done]), [["pertama", true]]);
  assert.deepEqual(await R.dispatch("GET", "/api/tasks/tidak-dikenal/subtasks"), []);
  await galat(R.dispatch("POST", "/api/tasks/tidak-dikenal/subtasks", { title: "x" }), 404, "Task not found");
});

// ── api.fetch (index.html): memori kesiapan dimuat sebelum keputusan routing checklist (perbaikan review S2a) ──

const HTML = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
const API_SRC = HTML.match(/\nconst api = \{[\s\S]*?\n\};/)[0];
function loadApi(win) {
  return new Function("window", "schedulePush", API_SRC + "\nreturn api;")(win, () => {});
}

test("api.fetch: path checklist menunggu checklistrepo.start() SEBELUM shouldRouteLocally; path lain tidak", async () => {
  const urutan = [];
  let lepas;
  const muat = new Promise((r) => { lepas = r; });
  const router = { hasRoute: () => true, dispatch: (m, u) => { urutan.push("dispatch " + u); return Promise.resolve([]); } };
  const win = { TF: {
    taskroutes: { buildTaskRouter: () => router, shouldRouteLocally: (r, m, u) => { urutan.push("putuskan " + u); return true; } },
    checklistroutes: { parseCall: RT.parseCall },
    checklistrepo: { start: () => { urutan.push("start"); return muat; } },
  } };
  const api = loadApi(win);
  const p = api.fetch("/api/tasks/7/subtasks");
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(urutan, ["start"], "keputusan menunggu memori dimuat");
  lepas();
  await p;
  assert.deepEqual(urutan, ["start", "putuskan /api/tasks/7/subtasks", "dispatch /api/tasks/7/subtasks"]);
  urutan.length = 0;
  await api.fetch("/api/tasks/7");
  assert.deepEqual(urutan, ["putuskan /api/tasks/7", "dispatch /api/tasks/7"], "bukan checklist → tanpa start");
});

test("api.fetch: tanpa checklistrepo/checklistroutes (modul lama) atau start() gagal → tetap memutuskan seperti biasa", async () => {
  for (const extra of [{}, { checklistroutes: { parseCall: RT.parseCall } },
    { checklistroutes: { parseCall: RT.parseCall }, checklistrepo: {} },
    { checklistroutes: { parseCall: RT.parseCall }, checklistrepo: { start: () => Promise.reject(new Error("IndexedDB mati")) } }]) {
    const seen = [];
    const router = { hasRoute: () => true, dispatch: () => Promise.resolve("ok") };
    const win = { TF: Object.assign({ taskroutes: { buildTaskRouter: () => router, shouldRouteLocally: (r, m, u) => { seen.push(u); return true; } } }, extra) };
    assert.equal(await loadApi(win).fetch("/api/subtasks/5", { method: "PATCH", body: "{}" }), "ok");
    assert.deepEqual(seen, ["/api/subtasks/5"]);
  }
});

test("routeDecision sesudah siap: task/butir dikenal atau belum tersinkron → lokal; selain itu jaringan", async () => {
  await siapkan();
  await put("tasks", [task({ cid: "t3", server_id: 8 }), task({ cid: "t4", server_id: 9 })]);
  await CR.start();
  await CR.markHydrated();
  await CR.setRev("t3", 0);
  assert.equal(CR.isReady(), true);
  const lokal = [["GET", "/api/tasks/7/subtasks"], ["GET", "/api/tasks/8/subtasks"], ["GET", "/api/tasks/t2/subtasks"],
    ["POST", "/api/tasks/7/subtasks"], ["POST", "/api/tasks/t2/subtasks"], ["POST", "/api/tasks/8/subtasks"],
    ["PATCH", "/api/subtasks/11"], ["PATCH", "/api/subtasks/b"], ["POST", "/api/subtasks/12/toggle"],
    ["POST", "/api/subtasks/b/move"], ["DELETE", "/api/subtasks/12"], ["DELETE", "/api/subtasks/cid-lain"]];
  for (const [m, p] of lokal) assert.equal(RT.routeDecision(m, p), true, m + " " + p);
  // task dikenal di store tetapi tanpa rev tersimpan dan tanpa butir (mis. akses baru) / tidak dikenal → jaringan
  const jaringan = [["GET", "/api/tasks/9/subtasks"], ["GET", "/api/tasks/99/subtasks"], ["POST", "/api/tasks/9/subtasks"],
    ["PATCH", "/api/subtasks/99"], ["POST", "/api/subtasks/99/toggle"], ["DELETE", "/api/subtasks/99"]];
  for (const [m, p] of jaringan) assert.equal(RT.routeDecision(m, p), false, m + " " + p);
});

test("routeDecision: butir baru dari aksi lokal / unduhan langsung dikenal tanpa muat ulang", async () => {
  await siapkan();
  await CR.start();
  await CR.markHydrated();
  assert.equal(RT.routeDecision("PATCH", "/api/subtasks/40"), false);
  await CR.replaceTaskChecklist("t1", [{ id: 40, task_id: 7, parent_id: null, depth: 0, title: "s", is_done: false, sort_order: 0 }], 3);
  assert.equal(RT.routeDecision("PATCH", "/api/subtasks/40"), true);
  assert.equal(RT.routeDecision("PATCH", "/api/subtasks/11"), false, "hilang dari server");
});

test("rute lokal tidak memakai jaringan: task_progress tanpa rev/rev_bumped di semua respons", async () => {
  await siapkan();
  const R = buildTaskRouter();
  const all = [
    await R.dispatch("POST", "/api/tasks/7/subtasks", { title: "x" }),
    await R.dispatch("PATCH", "/api/subtasks/11", { title: "y" }),
    await R.dispatch("POST", "/api/subtasks/11/toggle"),
    await R.dispatch("POST", "/api/subtasks/b/move", { parent_id: null, index: 0 }),
    await R.dispatch("DELETE", "/api/subtasks/b"),
  ];
  for (const r of all) assert.deepEqual(kunci(r.task_progress), ["done", "progress", "total"]);
});
