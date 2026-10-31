"use strict";
// Push record plugin (rencana PR 1a-2 Task 5; R10, R12, R13, R16): TF.pluginsync.pushOp lewat
// syncpush.pushOutbox sungguhan — satu item per POST, CAS op_qid, $task ditahan/ditulis ulang, heal.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const dbmod = require("../../static/offline/db.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const SP = require("../../static/offline/syncpush.js");
const PS = require("../../static/offline/plugin_sync.js");

const P = "demo-records";
const E = "note";
const PATH = "/api/plugins/demo-records/records";

beforeEach(async () => {
  dbmod._reset();
  await deleteDB(dbmod.DB_NAME);
  globalThis.dispatchEvent = () => true;
});
afterEach(() => {
  delete globalThis.dispatchEvent;
  if (globalThis.TF) delete globalThis.TF.plugins;
});

const pluginOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin");
function rawAll(store) {
  return dbmod.openDB().then((d) => new Promise((res, rej) => {
    const r = d.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function rawPut(store, recs) {
  return dbmod.openDB().then((d) => new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  }));
}
function rawClear(store) {
  return dbmod.openDB().then((d) => new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  }));
}
const rawRec = async (id) => (await rawAll("plugin_records")).find((r) => r.plugin_id === P && r.entity === E && r.id === id) || null;
const noTags = () => Promise.resolve([]);

// Server palsu: aturan LWW minimal (applied, version + 1). `hook(method, path, body)` boleh mengembalikan respons
// (atau promise respons) untuk menggantikan perilaku bawaan; null / promise null = perilaku bawaan.
function fakeServer(hook) {
  const calls = [];
  const rows = new Map();
  let nextTask = 500;
  const srv = {
    calls, rows,
    request(method, path, body) {
      calls.push({ method, path, body: JSON.parse(JSON.stringify(body || {})) });
      const h = hook ? hook(method, path, body, calls.length) : null;
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h).then((x) => x || srv.dflt(method, path, body));
    },
    dflt(method, path, body) {
      if (method === "POST" && path === "/api/tasks") {
        return Promise.resolve({ status: 200, data: { id: nextTask++, updated_at: "2026-11-01T00:00:00" } });
      }
      if (method === "POST" && path === PATH) {
        const results = body.items.map((it) => {
          const k = it.entity + "/" + it.id;
          const row = rows.get(k);
          const version = (row ? row.version : 0) + 1;
          if (it.deleted && !row) return { entity: it.entity, id: it.id, applied: true, record: null };
          const rec = { entity: it.entity, id: it.id, scope: it.scope, data: it.deleted ? {} : it.data,
            updated_at: it.updated_at, version, deleted: !!it.deleted };
          rows.set(k, rec);
          return { entity: it.entity, id: it.id, applied: true, record: rec };
        });
        return Promise.resolve({ status: 200, data: { results } });
      }
      return Promise.resolve({ status: 404, data: { detail: "Not Found" } });
    },
  };
  return srv;
}
const drain = (srv) => SP.pushOutbox(srv, { tagsFor: noTags });
const one = (res) => ({ status: 200, data: { results: [res] } });

test("upsert → POST /api/plugins/demo-records/records satu item {entity, id, scope, data, deleted:false, updated_at, base_version:null}; applied → dirty 0, version server, op hilang", async () => {
  const srv = fakeServer();
  const put = await PS.put(P, E, "n1", { t: "halo" });
  const r = await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal(srv.calls[0].method, "POST");
  assert.equal(srv.calls[0].path, PATH);
  assert.deepEqual(srv.calls[0].body, { items: [{
    entity: E, id: "n1", scope: "user", data: { t: "halo" }, deleted: false, updated_at: put.updated_at, base_version: null,
  }] });
  const raw = await rawRec("n1");
  assert.equal(raw.dirty, 0);
  assert.equal(raw.version, 1);
  assert.equal(raw.op_qid, null);
  assert.equal((await pluginOps()).length, 0);
  assert.equal(r.pushed, 1);
  assert.equal(r.failed, 0);
  assert.equal((await PS.get(P, E, "n1")).pending, false);
});

test("base_version = version terbaru saat kirim, bukan saat antre", async () => {
  const srv = fakeServer();
  await PS.put(P, E, "n1", { v: 1 });
  const raw = await rawRec("n1");
  await rawPut("plugin_records", [Object.assign({}, raw, { version: 4 })]); // mis. pull menaikkan versi setelah antre
  assert.equal((await pluginOps())[0].payload.version, null);
  await drain(srv);
  assert.equal(srv.calls[0].body.items[0].base_version, 4);
});

test("edit selama POST terbang (put di dalam transport) → op baru tetap, record tetap dirty dengan data baru, version = versi server", async () => {
  const srv = fakeServer((m, p) => (p === PATH
    ? PS.put(P, E, "n1", { v: 2 }).then(() => one({ entity: E, id: "n1", applied: true,
      record: { entity: E, id: "n1", scope: "user", data: { v: 1 }, updated_at: "2026-11-01T00:00:00Z", version: 3, deleted: false } }))
    : null));
  await PS.put(P, E, "n1", { v: 1 });
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  const raw = await rawRec("n1");
  assert.deepEqual(raw.data, { v: 2 });
  assert.equal(raw.dirty, 1);
  assert.equal(raw.version, 3);
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  assert.equal(raw.op_qid, ops[0].qid);
  // drain berikut mengirim edit baru dengan base_version 3
  const srv2 = fakeServer();
  await drain(srv2);
  assert.equal(srv2.calls[0].body.items[0].base_version, 3);
  assert.deepEqual(srv2.calls[0].body.items[0].data, { v: 2 });
});

test("applied:false + op tidak berubah → adopsi baris server, onChange lost [id]", async () => {
  const server = { entity: E, id: "n1", scope: "user", data: { v: "server" }, updated_at: "2026-11-02T00:00:00Z", version: 7, deleted: false };
  const srv = fakeServer((m, p) => (p === PATH ? one({ entity: E, id: "n1", applied: false, record: server }) : null));
  await PS.put(P, E, "n1", { v: "lokal" });
  const seen = [];
  const off = PS.subscribe((d) => seen.push(d));
  try { await drain(srv); } finally { off(); }
  const raw = await rawRec("n1");
  assert.deepEqual(raw.data, { v: "server" });
  assert.equal(raw.version, 7);
  assert.equal(raw.updated_at, "2026-11-02T00:00:00Z");
  assert.equal(raw.dirty, 0);
  assert.equal(raw.op_qid, null);
  assert.equal((await pluginOps()).length, 0);
  const lost = seen.filter((d) => d.lost);
  assert.equal(lost.length, 1);
  assert.deepEqual(lost[0].lost, ["n1"]);
  assert.deepEqual(lost[0].ids, ["n1"]);
  assert.equal(lost[0].source, "sync");
  assert.equal(lost[0].pluginId, P);
  assert.equal(lost[0].entity, E);
});

test("applied:false + edit selama terbang → data lokal baru dipertahankan, op baru tetap", async () => {
  const server = { entity: E, id: "n1", scope: "user", data: { v: "server" }, updated_at: "2026-11-02T00:00:00Z", version: 7, deleted: false };
  const srv = fakeServer((m, p) => (p === PATH
    ? PS.put(P, E, "n1", { v: "baru" }).then(() => one({ entity: E, id: "n1", applied: false, record: server }))
    : null));
  await PS.put(P, E, "n1", { v: "lokal" });
  const seen = [];
  const off = PS.subscribe((d) => seen.push(d));
  try { await drain(srv); } finally { off(); }
  const raw = await rawRec("n1");
  assert.deepEqual(raw.data, { v: "baru" });
  assert.equal(raw.dirty, 1);
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  assert.equal(raw.op_qid, ops[0].qid);
  assert.equal(seen.filter((d) => d.lost).length, 0);
});

test("tombstone applied (record null) → record dihapus keras", async () => {
  const srv = fakeServer();
  await PS.put(P, E, "n1", { v: 1 });
  await PS.remove(P, E, "n1");
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal(srv.calls[0].body.items[0].deleted, true);
  assert.equal(await rawRec("n1"), null);
  assert.equal((await pluginOps()).length, 0);
  // tombstone yang sudah ada di server (record deleted:true) → juga hapus keras
  await PS.put(P, E, "n2", { v: 1 });
  await drain(srv);
  await PS.remove(P, E, "n2");
  await drain(srv);
  assert.equal(srv.calls[2].body.items[0].base_version, 1);
  assert.equal(await rawRec("n2"), null);
});

test("FORBIDDEN_SCOPE → record dan op dihapus, onChange lost", async () => {
  const srv = fakeServer((m, p) => (p === PATH ? one({ entity: E, id: "w1", error: "FORBIDDEN_SCOPE" }) : null));
  await PS.put(P, E, "w1", { v: 1 }, { scope: "list:9" });
  const seen = [];
  const off = PS.subscribe((d) => seen.push(d));
  try { await drain(srv); } finally { off(); }
  assert.equal(srv.calls[0].body.items[0].scope, "list:9");
  assert.equal(await rawRec("w1"), null);
  assert.equal((await pluginOps()).length, 0);
  assert.deepEqual(seen.filter((d) => d.lost).map((d) => d.lost), [["w1"]]);
});

for (const code of ["INVALID", "SCOPE_IMMUTABLE"]) {
  test(`${code} → op dibuang, sync_error, result.failed 1; put berikutnya menghapus sync_error`, async () => {
    const srv = fakeServer((m, p) => (p === PATH ? one({ entity: E, id: "n1", error: code, detail: "data" }) : null));
    await PS.put(P, E, "n1", { v: 1 });
    const r = await drain(srv);
    assert.equal(r.failed, 1);
    assert.equal(r.pushed, 0);
    assert.equal((await pluginOps()).length, 0);
    const raw = await rawRec("n1");
    assert.equal(raw.dirty, 1);
    assert.equal(raw.op_qid, null);
    assert.equal(raw.sync_error.code, code);
    assert.equal(raw.sync_error.detail, "data");
    assert.equal(typeof raw.sync_error.at, "string");
    assert.equal((await PS.get(P, E, "n1")).error, code);
    // heal tidak mengantre ulang record ber-sync_error
    const r2 = await drain(srv);
    assert.equal(srv.calls.length, 1);
    assert.equal(r2.failed, 0);
    await PS.put(P, E, "n1", { v: 2 });
    assert.equal("sync_error" in (await rawRec("n1")), false);
    assert.equal((await pluginOps()).length, 1);
  });
}

test("404 PLUGIN_UNKNOWN → op dibuang + sync_error; heal tidak mengantre ulang", async () => {
  const srv = fakeServer((m, p) => (p === PATH ? { status: 404, data: { detail: { code: "PLUGIN_UNKNOWN" } } } : null));
  await PS.put(P, E, "n1", { v: 1 });
  await drain(srv);
  assert.equal((await pluginOps()).length, 0);
  const raw = await rawRec("n1");
  assert.equal(raw.sync_error.code, "PLUGIN_UNKNOWN");
  assert.equal(raw.dirty, 1);
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal((await pluginOps()).length, 0);
});

test("404 tanpa kode (jendela deploy) → op tetap, request sekali per drain", async () => {
  const srv = fakeServer((m, p) => (p === PATH ? { status: 404, data: { detail: "Not Found" } } : null));
  await PS.put(P, E, "n1", { v: 1 });
  const r = await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal(r.failed, 0);
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  const raw = await rawRec("n1");
  assert.equal(raw.op_qid, ops[0].qid);
  assert.equal("sync_error" in raw, false);
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  assert.equal((await pluginOps()).length, 1);
});

test("503 → op tetap (retry)", async () => {
  const srv = fakeServer((m, p) => (p === PATH ? { status: 503, data: { detail: { code: "PLUGIN_UNAVAILABLE" } } } : null));
  await PS.put(P, E, "n1", { v: 1 });
  await PS.put(P, E, "n2", { v: 1 });
  const r = await drain(srv);
  assert.equal(srv.calls.length, 2); // drain lanjut ke op berikutnya
  assert.equal(r.failed, 2);
  assert.equal((await pluginOps()).length, 2);
  assert.equal("sync_error" in (await rawRec("n1")), false);
});

test("401 → drain berhenti, op tetap", async () => {
  const srv = fakeServer((m, p) => (p === PATH ? { status: 401, data: {} } : null));
  await PS.put(P, E, "n1", { v: 1 });
  await PS.put(P, E, "n2", { v: 1 });
  const r = await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal(r.authExpired, true);
  assert.equal((await pluginOps()).length, 2);
});

test("4xx lain (413 TOO_LARGE) → op dibuang + sync_error + gagal", async () => {
  const srv = fakeServer((m, p) => (p === PATH ? { status: 413, data: { detail: { code: "TOO_LARGE" } } } : null));
  await PS.put(P, E, "n1", { v: 1 });
  const r = await drain(srv);
  assert.equal(r.failed, 1);
  assert.equal((await pluginOps()).length, 0);
  assert.equal((await rawRec("n1")).sync_error.code, "TOO_LARGE");
});

test("op basi (sudah di-coalesce saat drain memakai snapshot) → tidak ada request", async () => {
  // Request pertama (n1) mengedit n2 → op n2 di snapshot digantikan op baru (tidak ada di snapshot).
  const srv = fakeServer((m, p, body) => (p === PATH && body.items[0].id === "n1"
    ? PS.put(P, E, "n2", { v: 2 }).then(() => null)
    : null));
  await PS.put(P, E, "n1", { v: 1 });
  await PS.put(P, E, "n2", { v: 1 });
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal(srv.calls[0].body.items[0].id, "n1");
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].cid, "demo-records/note/n2");
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  assert.deepEqual(srv.calls[1].body.items[0].data, { v: 2 });
});

function task(cid) {
  return {
    cid, server_id: null, title: cid, description: "", gtd_status: "next",
    priority: "P3", quadrant: "Q4", project: "", context: "", deadline: null, waiting_for: "",
    assigned_to: null, progress: 0, parent_cid: null, recurrence_type: null, recurrence_days: null,
    deleted: false, dirty: 1, rev: 1, ext: {},
  };
}

test("$task ke cid ber-create antre → op ditahan tanpa request; setelah POST task sukses di drain yang sama rewriteTaskRefs menulis id server → drain berikut mengirim angka", async () => {
  // op record plugin lebih dulu (qid lebih kecil) daripada create task → pasti ditahan di drain pertama
  await PS.put(P, E, "n1", { link: { $task: "c-task-1" }, list: [{ $task: 12 }] });
  await rawPut("tasks", [task("c-task-1")]);
  await outboxAdd({ entity_type: "task", op: "create", cid: "c-task-1", payload: {} });
  const before = await rawRec("n1");
  const srv = fakeServer();
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.path), ["/api/tasks"]);
  const raw = await rawRec("n1");
  assert.deepEqual(raw.data, { link: { $task: 500 }, list: [{ $task: 12 }] });
  assert.equal(raw.dirty, 1);
  assert.equal(raw.updated_at, before.updated_at);
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  assert.equal(raw.op_qid, ops[0].qid);
  await drain(srv);
  assert.equal(srv.calls.length, 2);
  assert.deepEqual(srv.calls[1].body.items[0].data, { link: { $task: 500 }, list: [{ $task: 12 }] });
  assert.equal(srv.calls[1].body.items[0].updated_at, before.updated_at);
});

test("$task ke cid ber-create antre, op record SETELAH create → create terkirim lebih dulu, record terkirim dengan angka (bukan null)", async () => {
  await rawPut("tasks", [task("c-task-2")]);
  await outboxAdd({ entity_type: "task", op: "create", cid: "c-task-2", payload: {} });
  await PS.put(P, E, "n1", { link: { $task: "c-task-2" } });
  const srv = fakeServer();
  await drain(srv);
  // op lama di snapshot sudah digantikan oleh rewrite → tidak dikirim di drain ini
  assert.deepEqual(srv.calls.map((c) => c.path), ["/api/tasks"]);
  await drain(srv);
  assert.deepEqual(srv.calls[1].body.items[0].data, { link: { $task: 500 } });
});

test("$task ke cid tanpa id dan tanpa create → null di payload, data lokal tetap", async () => {
  const srv = fakeServer();
  await PS.put(P, E, "n1", { link: { $task: "c-hilang" }, n: [{ $task: 3 }] });
  await drain(srv);
  assert.equal(srv.calls.length, 1);
  assert.deepEqual(srv.calls[0].body.items[0].data, { link: null, n: [{ $task: 3 }] });
  // data lokal tidak ditimpa sampai ack; respons server palsu mengembalikan data terkirim → diadopsi
  const raw = await rawRec("n1");
  assert.equal(raw.dirty, 0);
});

test("pushOp langsung: resolusi $task hanya mengubah payload, bukan data lokal", async () => {
  // jalur pushOp langsung: data lokal tidak diubah oleh resolusi ref (hanya payload)
  await PS.put(P, E, "n1", { link: { $task: "c-hilang" } });
  const op = (await pluginOps())[0];
  const sent = [];
  const send = (m, p, b) => { sent.push(b); return Promise.resolve({ status: 404, data: { detail: "Not Found" } }); };
  const result = { pushed: 0, failed: 0 };
  await PS.pushOp(op, { send, pending: new Set(), resolveRefs: SP.resolveExtRefs, result });
  assert.deepEqual(sent[0].items[0].data, { link: null });
  assert.deepEqual((await rawRec("n1")).data, { link: { $task: "c-hilang" } });
});

test("rewriteTaskRefs tidak mengubah updated_at", async () => {
  await PS.put(P, E, "n1", { a: { $task: "c-x" } });
  await PS.put(P, E, "n2", { a: { $task: "c-lain" } });
  const b1 = await rawRec("n1");
  const b2 = await rawRec("n2");
  const seen = [];
  const off = PS.subscribe((d) => seen.push(d));
  let n;
  try { n = await PS.rewriteTaskRefs("c-x", 42); } finally { off(); }
  assert.equal(n, 1);
  const a1 = await rawRec("n1");
  assert.deepEqual(a1.data, { a: { $task: 42 } });
  assert.equal(a1.updated_at, b1.updated_at);
  assert.equal(a1.dirty, 1);
  assert.notEqual(a1.op_qid, b1.op_qid);
  assert.deepEqual(await rawRec("n2"), b2);
  const ops = await pluginOps();
  assert.equal(ops.length, 2); // tetap satu op per record
  assert.deepEqual(ops.find((o) => o.qid === a1.op_qid).payload.data, { a: { $task: 42 } });
  assert.deepEqual(seen.map((d) => [d.entity, d.ids, d.source]), [[E, ["n1"], "sync"]]);
});

test("heal: record dirty tanpa op (outbox dikosongkan) → satu op baru; record ber-sync_error / plugin tidak di indeks → tidak", async () => {
  await PS.put(P, E, "n1", { v: 1 });
  await PS.remove(P, E, "n1");
  await PS.put(P, E, "n2", { v: 2 });
  await PS.put("lain", E, "x1", { v: 3 });
  await PS.put(P, E, "bad", { v: 4 });
  await rawClear("_outbox");
  const bad = await rawRec("bad");
  await rawPut("plugin_records", [Object.assign({}, bad, { sync_error: { code: "INVALID", at: "x" } })]);

  assert.equal(await PS.healStranded([P]), 2);
  let ops = await pluginOps();
  assert.equal(ops.length, 2);
  const byCid = Object.fromEntries(ops.map((o) => [o.cid, o]));
  assert.equal(byCid["demo-records/note/n1"].op, "delete");
  assert.equal(byCid["demo-records/note/n2"].op, "upsert");
  assert.equal((await rawRec("n1")).op_qid, byCid["demo-records/note/n1"].qid);
  // idempoten: op sudah ada → tidak diantre lagi
  assert.equal(await PS.healStranded([P]), 0);
  // null (indeks tidak diketahui) → semua plugin
  assert.equal(await PS.healStranded(null), 1);
  ops = await pluginOps();
  assert.equal(ops.length, 3);
  assert.ok(ops.some((o) => o.cid === "lain/note/x1"));
});

test("heal lewat pushOutbox memakai TF.plugins.knownIds(): plugin tidak di indeks → tidak diantre/dikirim", async () => {
  await PS.put(P, E, "n1", { v: 1 });
  await PS.put("lain", E, "x1", { v: 1 });
  await rawClear("_outbox");
  globalThis.TF.plugins = { knownIds: () => [P] };
  const srv = fakeServer();
  await drain(srv);
  assert.deepEqual(srv.calls.map((c) => c.body.items[0].id), ["n1"]);
  assert.equal((await rawRec("n1")).dirty, 0);
  assert.equal((await pluginOps()).length, 0);
});

test("modul pluginsync tidak ada → op plugin tetap antre (tidak dibuang fallback)", async () => {
  await PS.put(P, E, "n1", { v: 1 });
  const key = require.resolve("../../static/offline/plugin_sync.js");
  const mod = require.cache[key];
  const saved = mod.exports;
  mod.exports = null;
  const srv = fakeServer();
  try { await drain(srv); } finally { mod.exports = saved; }
  assert.equal(srv.calls.length, 0);
  assert.equal((await pluginOps()).length, 1);
  // modul lama (Task 4, tanpa pushOp) → sama
  mod.exports = Object.assign({}, saved, { pushOp: undefined, healStranded: undefined });
  try { await drain(srv); } finally { mod.exports = saved; }
  assert.equal(srv.calls.length, 0);
  assert.equal((await pluginOps()).length, 1);
});

test("emit: array lost disalin per pendengar (pendengar yang mengubahnya tidak memengaruhi yang lain)", async () => {
  const got = [];
  const off1 = PS.subscribe((d) => { d.lost.push("x"); d.ids.push("y"); });
  const off2 = PS.subscribe((d) => got.push(d));
  const evs = [];
  globalThis.dispatchEvent = (ev) => { evs.push(ev); return true; };
  const orig = globalThis.CustomEvent;
  try {
    PS._internals.emit({ pluginId: P, entity: E, ids: ["a"], source: "sync", lost: ["a"] });
  } finally { off1(); off2(); }
  assert.deepEqual(got[0].lost, ["a"]);
  assert.deepEqual(got[0].ids, ["a"]);
  if (orig && evs.length) assert.deepEqual(evs[0].detail.lost, ["a"]);
});
