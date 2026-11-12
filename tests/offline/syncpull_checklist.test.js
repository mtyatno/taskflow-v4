"use strict";
// Pull checklist (checklist offline Fase 2, spec §4.2 + aturan rev 0; rencana PR B2 R5). pullChecklists(rawFetch)
// membandingkan `checklist_rev` record task (field turunan dari pull task) dengan rev tersimpan checklistrepo, lalu
// mengunduh lewat GET /api/checklists?task_ids= (≤ 200 per permintaan) hanya task yang berubah dan tanpa antrean (E5).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const CR = require("../../static/offline/checklistrepo.js");
const { pullChecklists, pullTasks } = require("../../static/offline/syncpull.js");
const fs = require("node:fs");
const path = require("node:path");

beforeEach(async () => {
  CR._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
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
const setRevs = (o) => tx("_meta", "readwrite", (t) => { t.objectStore("_meta").put(o, "checklist_revs"); });
const metaGet = (k) => get("_meta", k);

function task(cid, sid, rev, over) {
  return Object.assign({ cid, server_id: sid, title: cid, deleted: false, dirty: 0, rev: 1, progress: 0, checklist_total: 0 },
    rev === undefined ? {} : { checklist_rev: rev }, over || {});
}
function rec(cid, task_cid, over) {
  return Object.assign({ cid, server_id: null, task_cid, parent_cid: null, title: cid, is_done: false, sort_order: 0, created_at: null }, over || {});
}
const item = (id, over) => Object.assign({ id, task_id: 7, parent_id: null, depth: 0, title: "s" + id, is_done: false, sort_order: 0 }, over || {});

// rawFetch palsu: `answer(url)` → {status, body} | "NETWORK"; mencatat URL.
function fakeFetch(answer) {
  const urls = [];
  const fn = (u) => {
    urls.push(u);
    return Promise.resolve().then(() => answer(u, urls.length)).then((a) => {
      if (a === "NETWORK") throw new TypeError("Failed to fetch");
      return { ok: a.status >= 200 && a.status < 300, status: a.status, json: () => Promise.resolve(a.body) };
    });
  };
  fn.urls = urls;
  return fn;
}
const idsOf = (u) => decodeURIComponent(u.split("task_ids=")[1] || "").split(",").filter(Boolean).map(Number);
// Server palsu: {sid: {rev, items}}; id yang tidak ada → dilewati (seperti webapp).
function server(map) {
  return fakeFetch((u) => {
    const out = {};
    for (const id of idsOf(u)) if (map[id]) out[String(id)] = map[id];
    return { status: 200, body: out };
  });
}

// ── keputusan unduh ──────────────────────────────────────────────────────────

test("rev server 0 dan kunci rev belum ada → rev 0 disimpan tanpa unduh; task tanpa id server / terhapus diabaikan", async () => {
  await put("tasks", [task("t1", 7, 0), task("t2", null, 0), task("t3", 9, 0, { deleted: true }), task("t4", 10, 0)]);
  await setRevs({ t4: null });
  const f = server({ 10: { rev: 0, items: [] } });
  const r = await pullChecklists(f);
  assert.equal(f.urls.length, 1, "t4 (rev kosong) tetap diunduh");
  assert.deepEqual(idsOf(f.urls[0]), [10]);
  const revs = await CR.getRevs();
  assert.equal(revs.t1, 0);
  assert.equal(revs.t4, 0);
  assert.equal("t2" in revs, false);
  assert.equal("t3" in revs, false);
  assert.equal(r.zero, 1);
});

test("unduhan awal: rev ≥ 1 tanpa rev tersimpan → GET /api/checklists → butir + rev ditulis, siap (checklists_hydrated)", async () => {
  await put("tasks", [task("t1", 7, 3)]);
  await CR.start();
  const f = server({ 7: { rev: 3, items: [item(11), item(12, { parent_id: 11, depth: 1, title: "anak" })] } });
  const r = await pullChecklists(f);
  assert.equal(f.urls[0], "/api/checklists?task_ids=7");
  assert.equal((await CR.getRevs()).t1, 3);
  const items = await CR.itemsForTask("t1");
  assert.deepEqual(items.map((i) => [i.id, i.parent_id, i.title]), [[11, null, "s11"], [12, 11, "anak"]]);
  assert.equal(await metaGet("checklists_hydrated"), true);
  assert.equal(CR.isReady(), true);
  assert.equal(CR.knowsTask(7), true);
  assert.equal(r.replaced, 1);
  assert.equal(r.hydrated, true);
});

test("rev server ≠ tersimpan (termasuk null) → diunduh ulang; cid butir yang dikenal dipertahankan", async () => {
  await put("tasks", [task("t1", 7, 5), task("t2", 8, 2)]);
  await put("subtasks", [rec("a", "t1", { server_id: 11 }), rec("b", "t2", { server_id: 21 })]);
  await mapPut("subtask", 11, "a");
  await mapPut("subtask", 21, "b");
  await setRevs({ t1: 4, t2: null });
  const f = server({ 7: { rev: 5, items: [item(11, { title: "baru" }), item(13)] }, 8: { rev: 2, items: [] } });
  await pullChecklists(f);
  assert.deepEqual(idsOf(f.urls[0]).sort(), [7, 8]);
  assert.equal((await get("subtasks", "a")).title, "baru");
  assert.equal(await cidOf("subtask", 11), "a");
  assert.equal(await get("subtasks", "b"), undefined, "butir yang hilang dari server dihapus");
  assert.deepEqual(await CR.getRevs(), { t1: 5, t2: 2 });
});

test("rev sama → tidak diunduh; tidak ada yang perlu diunduh → tetap ditandai siap", async () => {
  await put("tasks", [task("t1", 7, 4)]);
  await setRevs({ t1: 4 });
  const f = server({});
  const r = await pullChecklists(f);
  assert.equal(f.urls.length, 0);
  assert.equal(await metaGet("checklists_hydrated"), true);
  assert.equal(r.hydrated, true);
});

test("E5: task yang masih punya entri antrean subtasks tidak diunduh (isi lokal dan rev tetap)", async () => {
  await put("tasks", [task("t1", 7, 9), task("t2", 8, 2)]);
  await put("subtasks", [rec("n", "t1")]);
  await put("_outbox", [{ ts: 1, retries: 0, entity_type: "subtasks", op: "create", cid: "n", task_cid: "t1", payload: { title: "n", parent_cid: null, index: null } }]);
  await setRevs({ t1: 4 });
  const f = server({ 7: { rev: 9, items: [] }, 8: { rev: 2, items: [item(21)] } });
  const r = await pullChecklists(f);
  assert.deepEqual(f.urls.map(idsOf), [[8]]);
  assert.ok(await get("subtasks", "n"));
  assert.equal((await CR.getRevs()).t1, 4);
  assert.equal(r.skipped, 1);
});

test("antrean muncul di antara keputusan dan penggantian → replaceTaskChecklist menolak, butir lokal utuh", async () => {
  await put("tasks", [task("t1", 7, 9)]);
  await put("subtasks", [rec("a", "t1", { server_id: 11 })]);
  await setRevs({ t1: 4 });
  const f = fakeFetch(async () => {
    await put("_outbox", [{ ts: 1, retries: 0, entity_type: "subtasks", op: "rename", cid: "a", task_cid: "t1", payload: { title: "x" } }]);
    return { status: 200, body: { 7: { rev: 9, items: [] } } };
  });
  await pullChecklists(f);
  assert.ok(await get("subtasks", "a"));
  assert.equal((await CR.getRevs()).t1, 4);
});

test("batch ≤ 200 id per permintaan, berurutan", async () => {
  const tasks = [];
  const map = {};
  for (let i = 1; i <= 450; i++) { tasks.push(task("t" + i, 1000 + i, 1)); map[1000 + i] = { rev: 1, items: [] }; }
  await put("tasks", tasks);
  const f = server(map);
  const r = await pullChecklists(f);
  assert.deepEqual(f.urls.map((u) => idsOf(u).length), [200, 200, 50]);
  assert.ok(f.urls.every((u) => u.startsWith("/api/checklists?task_ids=")));
  assert.equal(Object.keys(await CR.getRevs()).length, 450);
  assert.equal(r.hydrated, true);
});

test("task tanpa kunci di respons batch (tidak ada / tanpa akses) → checklist lokal dibuang (purgeTask)", async () => {
  await put("tasks", [task("t1", 7, 3), task("t2", 8, 3)]);
  await put("subtasks", [rec("a", "t1", { server_id: 11 }), rec("b", "t2", { server_id: 21 })]);
  await setRevs({ t1: 2, t2: 2 });
  const f = server({ 8: { rev: 3, items: [item(21)] } });
  const r = await pullChecklists(f);
  assert.equal(await get("subtasks", "a"), undefined);
  assert.ok(await get("subtasks", "b"));
  const revs = await CR.getRevs();
  assert.equal("t1" in revs, false);
  assert.equal(revs.t2, 3);
  assert.equal(r.purged, 1);
});

test("rev server tidak diketahui (record tanpa checklist_rev): tanpa kunci → diunduh; kunci angka → dilewati; kunci null → SELALU diunduh (CATATAN-1)", async () => {
  await put("tasks", [task("t1", 7, undefined), task("t2", 8, undefined), task("t3", 9, undefined)]);
  await setRevs({ t2: 5, t3: null });
  const f = server({ 7: { rev: 2, items: [item(11)] }, 9: { rev: 0, items: [] } });
  await pullChecklists(f);
  assert.deepEqual(f.urls.map(idsOf), [[7, 9]]);
  assert.deepEqual(await CR.getRevs(), { t1: 2, t2: 5, t3: 0 });
});

test("task yang sedang konflik (menunggu keputusan pengguna) tidak diunduh / dibuang", async () => {
  await put("tasks", [task("t1", 7, 3, { conflict: "remote_deleted" })]);
  await put("subtasks", [rec("a", "t1", { server_id: 11 })]);
  await setRevs({ t1: 2 });
  const f = server({});
  await pullChecklists(f);
  assert.equal(f.urls.length, 0);
  assert.ok(await get("subtasks", "a"));
});

// ── gagal ────────────────────────────────────────────────────────────────────

for (const [nama, jawab] of [["jaringan", "NETWORK"], ["5xx", { status: 503, body: { detail: "OFFLINE" } }], ["401", { status: 401, body: {} }], ["body bukan objek", { status: 200, body: null }]]) {
  test("gagal " + nama + " → tidak melempar, batch berikutnya tidak diminta, belum siap, rev tidak berubah", async () => {
    const tasks = [];
    for (let i = 1; i <= 250; i++) tasks.push(task("t" + i, 1000 + i, 1));
    await put("tasks", tasks);
    const f = fakeFetch(() => jawab);
    const r = await pullChecklists(f);
    assert.equal(f.urls.length, 1);
    assert.equal(await metaGet("checklists_hydrated"), undefined);
    assert.deepEqual(await CR.getRevs(), {});
    assert.equal(r.hydrated, false);
    assert.equal(r.failed, true);
  });
}

test("gagal sesudah sebagian batch: batch yang sukses tetap tersimpan; sudah siap sebelumnya tetap siap", async () => {
  const tasks = [];
  const map = {};
  for (let i = 1; i <= 250; i++) { tasks.push(task("t" + i, 1000 + i, 1)); map[1000 + i] = { rev: 1, items: [] }; }
  await put("tasks", tasks);
  await tx("_meta", "readwrite", (t) => { t.objectStore("_meta").put(true, "checklists_hydrated"); });
  const f = fakeFetch((u, n) => (n === 1 ? { status: 200, body: Object.fromEntries(idsOf(u).map((id) => [String(id), map[id]])) } : "NETWORK"));
  await pullChecklists(f);
  assert.equal(Object.keys(await CR.getRevs()).length, 200);
  assert.equal(await metaGet("checklists_hydrated"), true);
});

test("memori checklistrepo dimuat ulang di akhir (refresh): perubahan tab lain ikut terbaca", async () => {
  await put("tasks", [task("t1", 7, 2)]);
  await CR.start();
  await setRevs({ t1: 2 }); // ditulis "tab lain" langsung ke IndexedDB
  assert.equal(CR.knowsTask("t1"), false);
  await pullChecklists(server({}));
  assert.equal(CR.knowsTask("t1"), true);
});

// ── pull task: task yang hilang dari server membuang checklist-nya ───────────

test("pullTasks: task yang dikonfirmasi hilang dari server → checklist lokal dibuang (purgeTask)", async () => {
  await put("tasks", [task("t1", 7, 2, { gtd_status: "next", base_rev: "2026-06-04T00:00:00", updated_at: "2026-06-04T00:00:00" })]);
  await mapPut("task", 7, "t1");
  await put("subtasks", [rec("a", "t1", { server_id: 11 })]);
  await put("_outbox", [{ ts: 1, retries: 0, entity_type: "subtasks", op: "rename", cid: "a", task_cid: "t1", payload: { title: "x" } }]);
  await setRevs({ t1: 2 });
  await pullTasks([], () => Promise.resolve({ status: 404 }));
  assert.equal(await get("tasks", "t1"), undefined);
  assert.equal((await all("subtasks")).length, 0);
  assert.equal((await outboxAll()).length, 0);
  assert.equal("t1" in (await CR.getRevs()), false);
});

// ── siklus sinkron (index.html) ──────────────────────────────────────────────

test("index.html: pullChecklists tepat sesudah pullAndReconcile, sebelum langkah lain dan push; terisolasi step(); aman tanpa fungsi", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const pull = html.indexOf("window.TF.syncpull.pullAndReconcile(__syncRawFetch)");
  const langkah = "step(() => (window.TF.syncpull.pullChecklists ? window.TF.syncpull.pullChecklists(__syncRawFetch) : null))";
  const cl = html.indexOf(langkah);
  const next = html.indexOf("window.TF.syncpull.pullRecurringExceptions", pull);
  const push = html.indexOf("window.TF.syncpush.pushOutbox(__syncTransport)) //", pull);
  assert.ok(pull > 0 && cl > pull && cl < next && next < push, [pull, cl, next, push].join(","));
  assert.equal(html.indexOf(langkah, cl + 1), -1, "satu langkah saja");
  const antara = html.slice(pull, cl);
  assert.match(antara, /\.catch\(stepFailed\)\s*\n\s*\/\/[^\n]*\n\s*\.then\(\(\) => $/);
});
