"use strict";
// Push ext per kunci (spec plugin Fase 1 K5/K7; rencana 1a-1 T5, R3, R9, R10).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB, mutate } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const SP = require("../../static/offline/syncpush.js");
const repo = require("../../static/offline/taskrepo.js");
const X = require("../../static/offline/taskext.js");

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
function task(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null, waiting_for: "",
    assigned_to: null, progress: 0, parent_cid: null, recurrence_type: null, recurrence_days: null,
    deleted: false, dirty: 1, rev: 1, ext: {},
  }, over);
}
const getRec = (cid) => repo.getRaw(cid);

// Server palsu: menyimpan ext + field inti per id dan menerapkan aturan server (POST ext tanpa null, PUT ext_patch
// per kunci, PUT hanya menerapkan kunci inti yang DIKIRIM seperti webapp.py; respons = baris penuh).
// mode "old" = server pra-1a-1 (abaikan ext/ext_patch, respons tanpa ext); "string" = ext dikirim mentah "{}".
const CORE_KEYS = [
  "title", "description", "gtd_status", "priority", "quadrant", "project", "project_id", "context", "context_id",
  "deadline", "waiting_for", "completed_at", "progress", "is_focused", "assigned_to",
  "recurrence_type", "recurrence_days", "recurrence_end_date", "recurrence_notif_level",
  "estimated_pomodoros", "pomodoros_done",
];
function fakeServer(opts) {
  const o = opts || {};
  const rows = new Map();
  let next = 100;
  let tick = 0;
  const calls = [];
  const takeCore = (row, body) => { for (const k of CORE_KEYS) if (body && k in body) row.core[k] = body[k]; };
  const srv = {
    calls, rows, mode: o.mode || "new", fail: o.fail || (() => null), lastTs: null,
    seed(id, ext, core) { rows.set(id, { id, ext: Object.assign({}, ext || {}), core: Object.assign({}, core || {}) }); },
    request(method, path, body) {
      calls.push({ method, path, body: JSON.parse(JSON.stringify(body || {})) });
      const f = srv.fail(method, path, body);
      if (f) return Promise.resolve(f);
      const ts = "2026-11-01T00:00:" + String(10 + (tick++)).padStart(2, "0");
      srv.lastTs = ts;
      const out = (row) => {
        const d = Object.assign({ quadrant: "Q4" }, row.core, { id: row.id, updated_at: ts });
        if (srv.mode === "new") d.ext = Object.assign({}, row.ext);
        else if (srv.mode === "string") d.ext = "{}";
        return { status: 200, data: d };
      };
      if (method === "POST" && path === "/api/tasks") {
        const row = { id: next++, ext: {}, core: {} };
        takeCore(row, body);
        if (srv.mode === "new" && body.ext) row.ext = X.cleanNulls(body.ext);
        rows.set(row.id, row);
        return Promise.resolve(out(row));
      }
      const m = /^\/api\/tasks\/(\d+)$/.exec(path);
      if (method === "PUT" && m) {
        const row = rows.get(Number(m[1])) || { id: Number(m[1]), ext: {}, core: {} };
        rows.set(row.id, row);
        takeCore(row, body);
        if (srv.mode === "new" && body.ext_patch) row.ext = X.applyPatch(row.ext, body.ext_patch);
        return Promise.resolve(out(row));
      }
      return Promise.resolve({ status: 404, data: {} });
    },
  };
  return srv;
}
const noTags = () => Promise.resolve([]);
const drain = (srv) => SP.pushOutbox(srv, { tagsFor: noTags });

async function syncedTask(cid, sid, over) {
  await put("tasks", [task(Object.assign({ cid, server_id: sid, dirty: 0 }, over || {}))]);
  await mapPut("task", sid, cid);
}

test("PUT mengirim ext_patch hanya kunci ext_dirty; 2xx dengan ext objek → ext = ext server, ext_dirty hilang, dirty 0", async () => {
  const srv = fakeServer();
  srv.seed(7, { "demo-ext.a": 1, "lain.k": 5 });
  await syncedTask("t", 7, { ext: { "demo-ext.a": 1, "demo-ext.b": 2 }, ext_dirty: ["demo-ext.b", "demo-ext.gone"], dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.deepEqual(srv.calls[0].body.ext_patch, { "demo-ext.b": 2, "demo-ext.gone": null });
  const rec = await getRec("t");
  assert.deepEqual(rec.ext, { "demo-ext.a": 1, "lain.k": 5, "demo-ext.b": 2 });
  assert.equal("ext_dirty" in rec, false);
  assert.equal(rec.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("record tanpa ext_dirty → payload PUT tanpa kunci ext_patch", async () => {
  const srv = fakeServer();
  srv.seed(7, { "demo-ext.a": 1 });
  await syncedTask("t", 7, { title: "baru", ext: { "demo-ext.a": 1 }, dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  await drain(srv);
  assert.equal("ext_patch" in srv.calls[0].body, false);
  assert.equal("ext" in srv.calls[0].body, false);
  // ext server tetap (perangkat ini tidak menyentuh plugin)
  assert.deepEqual(srv.rows.get(7).ext, { "demo-ext.a": 1 });
});

test("POST tanpa ext → payload tanpa kunci ext", async () => {
  const srv = fakeServer();
  await put("tasks", [task({ cid: "a" }), task({ cid: "b", ext: undefined })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "a", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "b", payload: {} }]);
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  for (const c of srv.calls) assert.equal("ext" in c.body, false);
  assert.deepEqual((await getRec("a")).ext, {});
});

test("POST dengan ext → payload ext; respons ext diadopsi, ext_dirty hilang", async () => {
  const srv = fakeServer();
  const t = await repo.createTask({ title: "a", ext: { "demo-ext.note": "hai" } }, { today: "2026-11-01" });
  await drain(srv);
  assert.deepEqual(srv.calls[0].body.ext, { "demo-ext.note": "hai" });
  const rec = await getRec(t.cid);
  assert.equal(rec.server_id, 100);
  assert.deepEqual(rec.ext, { "demo-ext.note": "hai" });
  assert.equal("ext_dirty" in rec, false);
  assert.equal(rec.dirty, 0);
});

for (const mode of ["old", "string"]) {
  const label = mode === "old" ? "2xx tanpa ext" : "ext '{}' (string) diperlakukan sama";
  test(`jendela deploy: ${label} → ext_dirty tetap, dirty 1, satu op susulan, PUT hanya sekali di drain ini; drain kedua dengan ext objek → bersih`, async () => {
    const srv = fakeServer({ mode });
    srv.seed(7, {});
    await syncedTask("t", 7, { ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"], dirty: 1 });
    await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
    await drain(srv);
    assert.equal(srv.calls.length, 1);
    let rec = await getRec("t");
    assert.deepEqual(rec.ext_dirty, ["demo-ext.a"]);
    assert.deepEqual(rec.ext, { "demo-ext.a": 1 });
    assert.equal(rec.dirty, 1);
    let ops = await outboxAll();
    assert.equal(ops.length, 1);
    assert.equal(ops[0].op, "update");
    // drain berikutnya (server masih lama): tetap satu PUT, tidak menumpuk op
    await drain(srv);
    assert.equal(srv.calls.length, 2);
    assert.equal((await outboxAll()).length, 1);
    // server di-restart
    srv.mode = "new";
    await drain(srv);
    assert.equal(srv.calls.length, 3);
    assert.deepEqual(srv.calls[2].body.ext_patch, { "demo-ext.a": 1 });
    rec = await getRec("t");
    assert.equal("ext_dirty" in rec, false);
    assert.equal(rec.dirty, 0);
    assert.deepEqual(srv.rows.get(7).ext, { "demo-ext.a": 1 });
    ops = await outboxAll();
    assert.equal(ops.length, 0);
  });
}

test("jendela deploy: POST tanpa ext di respons → op update susulan membawa ext_patch", async () => {
  const srv = fakeServer({ mode: "old" });
  const t = await repo.createTask({ title: "a", ext: { "demo-ext.a": 1 } }, { today: "2026-11-01" });
  await drain(srv);
  let rec = await getRec(t.cid);
  assert.equal(rec.server_id, 100);
  assert.deepEqual(rec.ext_dirty, ["demo-ext.a"]);
  assert.equal(rec.dirty, 1);
  srv.mode = "new";
  await drain(srv);
  assert.equal(srv.calls[1].method, "PUT");
  assert.deepEqual(srv.calls[1].body.ext_patch, { "demo-ext.a": 1 });
  rec = await getRec(t.cid);
  assert.equal("ext_dirty" in rec, false);
});

test("edit selama in-flight (rev naik) → ext_dirty tidak dibersihkan", async () => {
  const srv = fakeServer();
  srv.seed(7, {});
  await syncedTask("t", 7, { ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"], dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  const inner = srv.request;
  let first = true;
  srv.request = (m, p, b) => {
    if (!first) return inner(m, p, b);
    first = false;
    return repo.updateTask("t", { ext_patch: { "demo-ext.b": 2 } }, { today: "2026-11-01" }).then(() => inner(m, p, b));
  };
  await drain(srv);
  const rec = await getRec("t");
  assert.deepEqual(rec.ext_dirty.slice().sort(), ["demo-ext.a", "demo-ext.b"]);
  assert.deepEqual(rec.ext, { "demo-ext.a": 1, "demo-ext.b": 2 });
  assert.equal(rec.dirty, 1);
  await drain(srv);
  assert.deepEqual(srv.calls[1].body.ext_patch, { "demo-ext.a": 1, "demo-ext.b": 2 });
  assert.equal("ext_dirty" in (await getRec("t")), false);
});

test("$task cid ber-server-id → dikirim angka", async () => {
  const srv = fakeServer();
  srv.seed(7, {});
  await syncedTask("other", 55);
  await syncedTask("t", 7, {
    ext: { "demo-ext.after": { $task: "other" }, "demo-ext.deps": [{ t: { $task: "other" } }, { t: { $task: 9 } }] },
    ext_dirty: ["demo-ext.after", "demo-ext.deps"], dirty: 1,
  });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  await drain(srv);
  assert.deepEqual(srv.calls[0].body.ext_patch, {
    "demo-ext.after": { $task: 55 }, "demo-ext.deps": [{ t: { $task: 55 } }, { t: { $task: 9 } }],
  });
});

test("$task cid tanpa server id dan tanpa create antre → null", async () => {
  const srv = fakeServer();
  srv.seed(7, {});
  await syncedTask("t", 7, {
    ext: { "demo-ext.after": { $task: "hilang" }, "demo-ext.deps": [{ t: { $task: "hilang" } }] },
    ext_dirty: ["demo-ext.after", "demo-ext.deps"], dirty: 1,
  });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  await drain(srv);
  assert.deepEqual(srv.calls[0].body.ext_patch, { "demo-ext.after": null, "demo-ext.deps": [{ t: null }] });
});

test("op update dengan ref ke cid ber-create antre → ditahan (tanpa request); setelah create sukses → id server terkirim", async () => {
  let createDown = true;
  const srv = fakeServer({ fail: (m, p) => (createDown && m === "POST" ? { status: 503, data: {} } : null) });
  srv.seed(7, {});
  await put("tasks", [task({ cid: "A" })]);
  await syncedTask("B", 7, { ext: { "demo-ext.after": { $task: "A" } }, ext_dirty: ["demo-ext.after"], dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "A", payload: {} },
    { qid: 2, op: "update", entity_type: "task", cid: "B", payload: {} }]);
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST"]); // PUT B ditahan
  assert.equal((await outboxAll()).length, 2);
  createDown = false;
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST", "POST", "PUT"]);
  assert.deepEqual(srv.calls[2].body.ext_patch, { "demo-ext.after": { $task: 100 } });
  assert.deepEqual((await getRec("B")).ext, { "demo-ext.after": { $task: 100 } });
  assert.equal((await outboxAll()).length, 0);
});

test("create saling merujuk A↔B (keduanya baru) → tidak deadlock; ref akhirnya id server di kedua task", async () => {
  const srv = fakeServer();
  await put("tasks", [
    task({ cid: "A", ext: { "demo-ext.after": { $task: "B" }, "demo-ext.note": "a" }, ext_dirty: ["demo-ext.after", "demo-ext.note"] }),
    task({ cid: "B", ext: { "demo-ext.after": { $task: "A" } }, ext_dirty: ["demo-ext.after"] }),
  ]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "A", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "B", payload: {} }]);
  await drain(srv);
  // POST A tanpa kunci ref (B belum punya id), POST B sudah membawa id server A
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST", "POST"]);
  assert.deepEqual(srv.calls[0].body.ext, { "demo-ext.note": "a" });
  assert.deepEqual(srv.calls[1].body.ext, { "demo-ext.after": { $task: 100 } });
  let A = await getRec("A");
  assert.deepEqual(A.ext, { "demo-ext.note": "a", "demo-ext.after": { $task: 101 } });
  assert.deepEqual(A.ext_dirty, ["demo-ext.after"]);
  assert.equal(A.dirty, 1);
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["update", "A"]]);
  await drain(srv);
  assert.equal(srv.calls[2].method, "PUT");
  assert.equal(srv.calls[2].path, "/api/tasks/100");
  assert.deepEqual(srv.calls[2].body.ext_patch, { "demo-ext.after": { $task: 101 } });
  assert.deepEqual(srv.rows.get(100).ext, { "demo-ext.note": "a", "demo-ext.after": { $task: 101 } });
  assert.deepEqual(srv.rows.get(101).ext, { "demo-ext.after": { $task: 100 } });
  A = await getRec("A");
  assert.equal("ext_dirty" in A, false);
  assert.equal(A.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("rewriteTaskExtRefs mengganti {$task: cid} di task lain setelah POST sukses", async () => {
  await put("tasks", [
    task({ cid: "X", server_id: 7, dirty: 0, rev: 3, ext: { "demo-ext.deps": [{ t: { $task: "N" } }, { t: { $task: 5 } }], "demo-ext.k": 1 } }),
    task({ cid: "Y", server_id: 8, dirty: 0, rev: 1, ext: { "demo-ext.k": { $task: "lain" } } }),
    task({ cid: "Z", server_id: 9, dirty: 0, deleted: true, ext: { "demo-ext.k": { $task: "N" } } }),
  ]);
  const n = await SP.rewriteTaskExtRefs("N", 300);
  assert.equal(n, 1);
  const x = await getRec("X");
  assert.deepEqual(x.ext, { "demo-ext.deps": [{ t: { $task: 300 } }, { t: { $task: 5 } }], "demo-ext.k": 1 });
  assert.deepEqual(x.ext_dirty, ["demo-ext.deps"]);
  assert.equal(x.dirty, 1);
  assert.equal(x.rev, 4);
  assert.deepEqual((await getRec("Y")).ext, { "demo-ext.k": { $task: "lain" } });
  assert.deepEqual((await getRec("Z")).ext, { "demo-ext.k": { $task: "N" } });
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => [o.op, o.cid]), [["update", "X"]]);
  // tanpa ref → 0, tanpa op baru
  assert.equal(await SP.rewriteTaskExtRefs("tidak-ada", 1), 0);
  assert.equal((await outboxAll()).length, 1);
});

test("422 EXT_* dari server → failPermanent seperti 422 lain (sync_error)", async () => {
  const srv = fakeServer({ fail: () => ({ status: 422, data: { detail: { code: "EXT_TOO_LARGE", key: "demo-ext" } } }) });
  await syncedTask("t", 7, { ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"], dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  const r = await drain(srv);
  assert.equal(r.failed, 1);
  const rec = await getRec("t");
  assert.equal(rec.sync_error.status, 422);
  assert.match(rec.sync_error.detail, /EXT_TOO_LARGE/);
  assert.equal(rec.dirty, 1);
  assert.deepEqual(rec.ext_dirty, ["demo-ext.a"]);
  assert.equal((await outboxAll()).length, 0);
});

test("extPatchOf / resolveExtRefs murni", async () => {
  assert.equal(SP.extPatchOf({ ext: { "a.b": 1 } }), null);
  assert.equal(SP.extPatchOf({ ext: { "a.b": 1 }, ext_dirty: [] }), null);
  assert.deepEqual(SP.extPatchOf({ ext: { "abc.b": 1 }, ext_dirty: ["abc.b", "abc.c"] }), { "abc.b": 1, "abc.c": null });
  assert.deepEqual(SP.extPatchOf({ ext: "{}", ext_dirty: ["abc.c"] }), { "abc.c": null });
  await put("tasks", [task({ cid: "P" })]);
  const r = await SP.resolveExtRefs({ "abc.x": { $task: "P" }, "abc.y": { $task: 3 }, "abc.z": 1 }, new Set(["P"]));
  assert.deepEqual(r, { value: { "abc.y": { $task: 3 }, "abc.z": 1 }, held: ["abc.x"] });
});

test("taskAdopt: ext objek diadopsi dan kunci tertahan ditempel kembali", () => {
  const next = { ext: { "abc.x": { $task: "P" }, "abc.y": 1 }, ext_dirty: ["abc.x", "abc.y"], dirty: 0 };
  SP.taskAdopt({ ext: { "abc.y": 1, "lain.q": 2 } }, ["abc.x"])(next);
  assert.deepEqual(next.ext, { "abc.y": 1, "lain.q": 2, "abc.x": { $task: "P" } });
  assert.deepEqual(next.ext_dirty, ["abc.x"]);
  assert.equal(next.dirty, 1);
  const plain = { ext: { "abc.y": 1 }, dirty: 0 };
  SP.taskAdopt({})(plain);
  assert.deepEqual(plain.ext, { "abc.y": 1 });
  assert.equal(plain.dirty, 0);
});

// ── PR 1c-0 Task 3: push ext saja (K25; rencana R3, R4, R5, R6) ─────────────────────────────────────────────
const H = require("../../static/offline/hydrate.js");
const PC = require("../../static/offline/projectcache.js");
const CC = require("../../static/offline/contextcache.js");
const TODAY = { today: "2026-11-01" };
const SERVER_CORE = { title: "judul server", gtd_status: "done", progress: 60, assigned_to: 42, deadline: "2026-12-24" };
const EXT_ONLY = (rec) => X.extOnlyNow(rec);

// task sinkron (bersih) + edit ext lewat repo → penanda ext saja sah, satu op update antre
async function extEdited(srv, patch, over) {
  srv.seed(7, { "demo-ext.a": 0, "lain.k": 5 }, SERVER_CORE);
  await syncedTask("t", 7, Object.assign({ title: "judul lama", ext: { "demo-ext.a": 0, "lain.k": 5 } }, over || {}));
  await repo.updateTask("t", { ext_patch: patch || { "demo-ext.a": 1 } }, TODAY);
  const rec = await getRec("t");
  assert.equal(EXT_ONLY(rec), true);
  return rec;
}
function spyOn(obj, name) {
  const orig = obj[name];
  const spy = { n: 0, restore() { obj[name] = orig; } };
  obj[name] = function () { spy.n++; return orig.apply(this, arguments); };
  return spy;
}

test("record ext saja → PUT body tepat {ext_patch: kunci ext_dirty}; tagsFor/projectItems tidak dipanggil", async () => {
  const srv = fakeServer();
  await extEdited(srv);
  let tagCalls = 0;
  const pSpy = spyOn(PC, "allItems");
  const cSpy = spyOn(CC, "allItems");
  try {
    await SP.pushOutbox(srv, { tagsFor: () => { tagCalls++; return Promise.resolve(["x"]); } });
  } finally { pSpy.restore(); cSpy.restore(); }
  assert.equal(srv.calls.length, 1);
  assert.equal(srv.calls[0].method, "PUT");
  assert.deepEqual(srv.calls[0].body, { ext_patch: { "demo-ext.a": 1 } });
  assert.equal(tagCalls, 0);
  assert.equal(pSpy.n, 0);
  assert.equal(cSpy.n, 0);
  // field inti server tidak tertimpa
  assert.equal(srv.rows.get(7).core.title, "judul server");
});

test("respons PUT ext saja → judul/status/progress/assigned_to/deadline server diadopsi, base_rev = updated_at respons, ext server, ext_dirty hilang, dirty 0, tanpa ext_only_rev, rev tetap", async () => {
  const srv = fakeServer();
  const before = await extEdited(srv);
  const r = await drain(srv);
  assert.equal(r.pushed, 1);
  const rec = await getRec("t");
  assert.equal(rec.title, "judul server");
  assert.equal(rec.gtd_status, "done");
  assert.equal(rec.progress, 60);
  assert.equal(rec.assigned_to, 42);
  assert.equal(rec.deadline, "2026-12-24");
  assert.equal(rec.base_rev, srv.lastTs);
  assert.deepEqual(rec.ext, { "demo-ext.a": 1, "lain.k": 5 });
  assert.equal("ext_dirty" in rec, false);
  assert.equal(rec.dirty, 0);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal(rec.rev, before.rev);
  assert.equal((await outboxAll()).length, 0);
});

test("PUT ext saja terbang + edit judul di dalam transport → inti TIDAK diadopsi (judul lokal baru tetap), dirty 1, satu op susulan; drain berikut → PUT penuh berjudul baru", async () => {
  const srv = fakeServer();
  await extEdited(srv);
  const inner = srv.request;
  let first = true;
  srv.request = (m, p, b) => {
    if (!first) return inner(m, p, b);
    first = false;
    return repo.updateTask("t", { title: "judul lokal" }, TODAY).then(() => inner(m, p, b));
  };
  await drain(srv);
  assert.deepEqual(srv.calls[0].body, { ext_patch: { "demo-ext.a": 1 } });
  let rec = await getRec("t");
  assert.equal(rec.title, "judul lokal");
  assert.equal(rec.gtd_status, "next"); // status server tidak diadopsi saat ada edit inti lokal
  assert.equal(rec.dirty, 1);
  assert.equal(EXT_ONLY(rec), false);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  assert.equal(srv.calls[1].body.title, "judul lokal");
  assert.equal("priority" in srv.calls[1].body, true);
  assert.deepEqual(srv.calls[1].body.ext_patch, { "demo-ext.a": 1 });
  assert.equal(srv.rows.get(7).core.title, "judul lokal");
  rec = await getRec("t");
  assert.equal(rec.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("PUT ext saja terbang + edit ext lain di dalam transport → inti diadopsi, ext_dirty kunci baru tetap, penanda = rev baru; drain berikut → {ext_patch} kunci baru", async () => {
  const srv = fakeServer();
  await extEdited(srv);
  const inner = srv.request;
  let first = true;
  srv.request = (m, p, b) => {
    if (!first) return inner(m, p, b);
    first = false;
    return repo.updateTask("t", { ext_patch: { "demo-ext.b": 2 } }, TODAY).then(() => inner(m, p, b));
  };
  await drain(srv);
  let rec = await getRec("t");
  assert.equal(rec.title, "judul server");
  assert.equal(rec.gtd_status, "done");
  assert.equal(rec.dirty, 1);
  assert.ok(rec.ext_dirty.indexOf("demo-ext.b") >= 0);
  assert.equal(rec.ext.b, undefined);
  assert.equal(rec.ext["demo-ext.b"], 2);
  assert.equal(EXT_ONLY(rec), true);
  assert.equal(rec.ext_only_rev, rec.rev);
  assert.equal((await outboxAll()).length, 1);
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  assert.deepEqual(Object.keys(srv.calls[1].body), ["ext_patch"]);
  assert.equal(srv.calls[1].body.ext_patch["demo-ext.b"], 2);
  assert.equal(srv.rows.get(7).core.title, "judul server");
  rec = await getRec("t");
  assert.equal(rec.dirty, 0);
  assert.deepEqual(rec.ext, { "demo-ext.a": 1, "demo-ext.b": 2, "lain.k": 5 });
});

test("dua op update untuk record yang sama (dua edit ext) → satu PUT; op kedua dibuang tanpa request (record bersih)", async () => {
  const srv = fakeServer();
  await extEdited(srv);
  await repo.updateTask("t", { ext_patch: { "demo-ext.b": 2 } }, TODAY);
  assert.equal((await outboxAll()).length, 2);
  const r = await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.deepEqual(srv.calls[0].body, { ext_patch: { "demo-ext.a": 1, "demo-ext.b": 2 } });
  assert.equal(r.pushed, 1);
  assert.equal((await outboxAll()).length, 0);
  assert.equal((await getRec("t")).dirty, 0);
});

test("op update untuk record dirty 0 → tanpa request, op hilang, result.pushed tidak bertambah", async () => {
  const srv = fakeServer();
  srv.seed(7, {});
  await syncedTask("t", 7);
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  const r = await drain(srv);
  assert.equal(srv.calls.length, 0);
  assert.equal(r.pushed, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("record ext saja dengan ref ke cid ber-create antre → ditahan tanpa request (seperti sekarang)", async () => {
  let createDown = true;
  const srv = fakeServer({ fail: (m) => (createDown && m === "POST" ? { status: 503, data: {} } : null) });
  await put("tasks", [task({ cid: "A" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "A", payload: {} }]);
  await extEdited(srv, { "demo-ext.after": { $task: "A" } });
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST"]);
  assert.equal((await outboxAll()).length, 2);
  assert.equal(EXT_ONLY(await getRec("t")), true);
  createDown = false;
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST", "POST", "PUT"]);
  assert.deepEqual(srv.calls[2].body, { ext_patch: { "demo-ext.after": { $task: 100 } } });
  const rec = await getRec("t");
  assert.equal(rec.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("ext saja + respons tanpa ext objek (server lama, R10 1a-1) → inti diadopsi, ext_dirty tetap, dirty 1, penanda = rev, satu op susulan; drain kedua dengan ext objek → bersih", async () => {
  const srv = fakeServer({ mode: "old" });
  await extEdited(srv);
  await drain(srv);
  let rec = await getRec("t");
  assert.equal(rec.title, "judul server");
  assert.deepEqual(rec.ext_dirty, ["demo-ext.a"]);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.ext_only_rev, rec.rev);
  assert.equal(EXT_ONLY(rec), true);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  srv.mode = "new";
  await drain(srv);
  assert.deepEqual(srv.calls[1].body, { ext_patch: { "demo-ext.a": 1 } });
  rec = await getRec("t");
  assert.equal(rec.dirty, 0);
  assert.equal("ext_dirty" in rec, false);
  assert.equal("ext_only_rev" in rec, false);
  assert.equal((await outboxAll()).length, 0);
});

test("modul hydrate tidak ada (stub TF.hydrate tanpa coreFromServer) → payload penuh", async () => {
  const srv = fakeServer();
  await extEdited(srv);
  const saved = H.coreFromServer;
  delete H.coreFromServer;
  try { await drain(srv); } finally { H.coreFromServer = saved; }
  const body = srv.calls[0].body;
  assert.equal(body.title, "judul lama");
  assert.equal("gtd_status" in body, true);
  assert.deepEqual(body.ext_patch, { "demo-ext.a": 1 });
  assert.equal(srv.rows.get(7).core.title, "judul lama");
});

test("payload penuh tidak berubah: record kotor tanpa penanda dengan ext_dirty → taskToUpdatePayload + ext_patch persis seperti sebelumnya", async () => {
  const srv = fakeServer();
  srv.seed(7, {});
  await syncedTask("t", 7, {
    title: "kotor", deadline: "2026-11-05", progress: 30, assigned_to: 3, is_focused: 1,
    ext: { "demo-ext.a": 1 }, ext_dirty: ["demo-ext.a"], dirty: 1, rev: 4,
  });
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  const rec = await getRec("t");
  assert.equal(EXT_ONLY(rec), false);
  await SP.pushOutbox(srv, { tagsFor: () => Promise.resolve(["x", "y"]) });
  const expected = Object.assign(SP.taskToUpdatePayload(rec, ["x", "y"], [], []), { ext_patch: { "demo-ext.a": 1 } });
  assert.deepEqual(srv.calls[0].body, JSON.parse(JSON.stringify(expected)));
  assert.deepEqual(Object.keys(srv.calls[0].body), Object.keys(expected));
});

test("POST create dengan held → taskAdopt menandai dirty 1 + penanda = rev → op susulan mengirim {ext_patch}", async () => {
  let pDown = true;
  const srv = fakeServer({ fail: (m, p, b) => (pDown && m === "POST" && b && b.title === "P" ? { status: 503, data: {} } : null) });
  await put("tasks", [
    task({ cid: "P", title: "P" }),
    task({ cid: "N", title: "N", ext: { "demo-ext.after": { $task: "P" }, "demo-ext.note": "n" }, ext_dirty: ["demo-ext.after", "demo-ext.note"] }),
  ]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "task", cid: "P", payload: {} },
    { qid: 2, op: "create", entity_type: "task", cid: "N", payload: {} }]);
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST", "POST"]);
  assert.deepEqual(srv.calls[1].body.ext, { "demo-ext.note": "n" });
  let N = await getRec("N");
  assert.equal(N.dirty, 1);
  assert.equal(N.ext_only_rev, N.rev);
  assert.equal(EXT_ONLY(N), true);
  assert.deepEqual((await outboxAll()).map((o) => [o.op, o.cid]), [["create", "P"], ["update", "N"]]);
  pDown = false;
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.method), ["POST", "POST", "POST", "PUT"]);
  assert.deepEqual(srv.calls[3].body, { ext_patch: { "demo-ext.after": { $task: 101 } } });
  N = await getRec("N");
  assert.equal(N.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

test("rewriteTaskExtRefs pada record bersih → penanda = rev baru; pada record kotor inti → tanpa penanda", async () => {
  await put("tasks", [
    task({ cid: "C", server_id: 7, dirty: 0, rev: 3, ext: { "demo-ext.k": { $task: "N" } } }),
    task({ cid: "D", server_id: 8, dirty: 1, rev: 5, title: "edit inti", ext: { "demo-ext.k": { $task: "N" } } }),
  ]);
  assert.equal(await SP.rewriteTaskExtRefs("N", 300), 2);
  const c = await getRec("C");
  assert.equal(c.rev, 4);
  assert.equal(c.ext_only_rev, 4);
  assert.equal(EXT_ONLY(c), true);
  const d = await getRec("D");
  assert.equal(d.rev, 6);
  assert.equal("ext_only_rev" in d, false);
  assert.equal(EXT_ONLY(d), false);
});

for (const store of ["scratchpad_notes", "mindmaps", "habits"]) {
  test(`markPushed tanpa adoptAny (${store}) → perilaku lama`, async () => {
    await put(store, [{ cid: "c", server_id: null, title: "x", dirty: 1, rev: 2, base_rev: "2026-10-01T00:00:00",
      sync_error: { status: 422 }, recreate_of_sid: 5 }]);
    await SP.markPushed(store, "c", 2, "2026-11-01T00:00:00", 9, null);
    const db = await openDB();
    const got = await new Promise((res) => { const r = db.transaction(store).objectStore(store).get("c"); r.onsuccess = () => res(r.result); });
    assert.deepEqual(got, { cid: "c", server_id: 9, title: "x", dirty: 0, rev: 2, base_rev: "2026-11-01T00:00:00" });
    // rev berubah selama terbang → tetap dirty
    await mutate(store, "c", (cur) => Object.assign({}, cur, { rev: 3, dirty: 1 }));
    await SP.markPushed(store, "c", 2, "2026-11-01T00:00:01", null, null);
    const got2 = await new Promise((res) => { const r = db.transaction(store).objectStore(store).get("c"); r.onsuccess = () => res(r.result); });
    assert.deepEqual(got2, { cid: "c", server_id: 9, title: "x", dirty: 1, rev: 3, base_rev: "2026-11-01T00:00:01" });
  });
}

test("markPushed adoptAny dipanggil sebelum adopt, juga saat rev berubah; adopt hanya bila rev sama", async () => {
  await put("tasks", [task({ cid: "t", server_id: 7, rev: 2 })]);
  const seen = [];
  const adoptAny = (next, cur, unchanged) => { seen.push(["any", unchanged, cur.rev]); next.marked = 1; };
  const adopt = (next) => { seen.push(["adopt", next.marked]); };
  await SP.markPushed("tasks", "t", 2, "2026-11-01T00:00:00", null, adopt, adoptAny);
  assert.deepEqual(seen, [["any", true, 2], ["adopt", 1]]);
  seen.length = 0;
  await SP.markPushed("tasks", "t", 1, "2026-11-01T00:00:01", null, adopt, adoptAny);
  assert.deepEqual(seen, [["any", false, 2]]);
});

test("422 EXT_* pada PUT ext saja → sync_error, penanda tetap (retry mengirim ext saja)", async () => {
  let down = true;
  const srv = fakeServer({ fail: () => (down ? { status: 422, data: { detail: { code: "EXT_TOO_LARGE", key: "demo-ext" } } } : null) });
  await extEdited(srv);
  const r = await drain(srv);
  assert.equal(r.failed, 1);
  assert.deepEqual(srv.calls[0].body, { ext_patch: { "demo-ext.a": 1 } });
  let rec = await getRec("t");
  assert.equal(rec.sync_error.status, 422);
  assert.equal(EXT_ONLY(rec), true);
  assert.equal((await outboxAll()).length, 0);
  // "Coba lagi" (syncconflict retry): sync_error dibersihkan, op diantre ulang → tetap ext saja
  down = false;
  await mutate("tasks", "t", (cur) => { const n = Object.assign({}, cur); delete n.sync_error; return n; });
  await put("_outbox", [{ qid: 9, op: "update", entity_type: "task", cid: "t", payload: {} }]);
  await drain(srv);
  assert.deepEqual(srv.calls[1].body, { ext_patch: { "demo-ext.a": 1 } });
  rec = await getRec("t");
  assert.equal(rec.dirty, 0);
  assert.equal(rec.title, "judul server");
});
