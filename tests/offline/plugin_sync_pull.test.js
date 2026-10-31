"use strict";
// Pull record plugin (rencana PR 1a-2 Task 6; R14, R15, R19): TF.pluginsync.pullAll + ensureOwner dan pembungkus
// malas TF.syncpull.pullPluginRecords. rawFetch palsu = server kursor seq minimal yang menjawab per URL.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const dbmod = require("../../static/offline/db.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const SPULL = require("../../static/offline/syncpull.js");
const PS = require("../../static/offline/plugin_sync.js");

const P = "demo-records";
const E = "note";
const FP = "aaaa0000";

let events = [];
let off = null;
beforeEach(async () => {
  dbmod._reset();
  await deleteDB(dbmod.DB_NAME);
  globalThis.dispatchEvent = () => true;
  events = [];
  off = PS.subscribe((ev) => { events.push(ev); });
});
afterEach(() => {
  if (off) off();
  delete globalThis.dispatchEvent;
  if (globalThis.TF) delete globalThis.TF.plugins;
});

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
const recsOf = async (pid) => (await rawAll("plugin_records")).filter((r) => r.plugin_id === (pid || P));
const rawRec = async (id, pid) => (await recsOf(pid)).find((r) => r.entity === E && r.id === id) || null;
const kv = (key, pid) => PS.kvGet(pid || P, "_sync", key);
const pluginOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin");

function resp(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}
function row(seq, id, extra) {
  return Object.assign({
    seq, entity: E, id, scope: "user", data: { t: id }, updated_at: "2026-11-01T00:00:0" + (seq % 10) + "Z",
    version: 1, deleted: false,
  }, extra || {});
}
// Server palsu: plugins[pid] = {rows, fp}. Kursor "1.<seq>.<fp>"; fp beda / tak terbaca → {reset:true}; kosong =
// tarik penuh. hook(pid, cursor, n) boleh mengembalikan respons (atau "NETWORK") menggantikan perilaku bawaan.
function makeServer() {
  const srv = { plugins: {}, calls: [], pageSize: 2, hook: null };
  srv.add = (pid, rows, fp) => { srv.plugins[pid] = { rows: rows.slice(), fp: fp || FP }; return srv.plugins[pid]; };
  srv.fetch = (url) => {
    srv.calls.push(url);
    const m = /^\/api\/plugins\/([^/?]+)\/records\?cursor=([^&]*)&limit=(\d+)$/.exec(url);
    if (!m) return Promise.resolve(resp(400, { detail: "bad url " + url }));
    const pid = decodeURIComponent(m[1]);
    const cursor = decodeURIComponent(m[2]);
    if (srv.hook) {
      const h = srv.hook(pid, cursor, srv.calls.length);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      if (h) return Promise.resolve(h);
    }
    const p = srv.plugins[pid];
    if (!p) return Promise.resolve(resp(404, { detail: { code: "PLUGIN_UNKNOWN" } }));
    let seq = 0;
    if (cursor) {
      const mm = /^1\.(\d+)\.([0-9a-f]{8})$/.exec(cursor);
      if (!mm || mm[2] !== p.fp) return Promise.resolve(resp(200, { reset: true }));
      seq = Number(mm[1]);
    }
    const rest = p.rows.filter((r) => r.seq > seq).sort((a, b) => a.seq - b.seq);
    const page = rest.slice(0, srv.pageSize);
    const last = page.length ? page[page.length - 1].seq : seq;
    const items = page.map((r) => { const x = Object.assign({}, r); delete x.seq; return x; });
    return Promise.resolve(resp(200, { items, cursor: "1." + last + "." + p.fp, more: rest.length > page.length }));
  };
  return srv;
}
const cursorOf = (url) => decodeURIComponent(/cursor=([^&]*)/.exec(url)[1]);
const pull = (srv, ids, userId) => PS.pullAll(srv.fetch, { userId: userId === undefined ? 1 : userId, ids: ids || [P] });

test("tarik penuh pertama: dua halaman (more) → semua record bersih, kursor di plugin_kv, gen 1, resetting false", async () => {
  const srv = makeServer();
  srv.add(P, [row(1, "a"), row(2, "b"), row(3, "c", { scope: "list:7", version: 4 })]);
  const r = await pull(srv);
  assert.equal(srv.calls.length, 2);
  assert.equal(srv.calls[0], "/api/plugins/demo-records/records?cursor=&limit=500");
  assert.equal(cursorOf(srv.calls[1]), "1.2." + FP);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plugins[P], { pulled: 3, removed: 0, reset: false, pages: 2 });
  const recs = await recsOf();
  assert.equal(recs.length, 3);
  for (const rec of recs) {
    assert.equal(rec.dirty, 0);
    assert.equal(rec.deleted, 0);
    assert.equal(rec.op_qid, null);
    assert.equal(rec.sync_gen, 1);
  }
  const c = await rawRec("c");
  assert.equal(c.scope, "list:7");
  assert.equal(c.version, 4);
  assert.deepEqual(c.data, { t: "c" });
  assert.equal(await kv("cursor"), "1.3." + FP);
  assert.equal(await kv("gen"), 1);
  assert.equal(await kv("resetting"), false);
  assert.deepEqual((await PS.get(P, E, "a")).data, { t: "a" });
  // onChange source "sync" per halaman, ids = yang ditulis
  assert.deepEqual(events.map((e) => [e.pluginId, e.entity, e.ids, e.source]),
    [[P, E, ["a", "b"], "sync"], [P, E, ["c"], "sync"]]);
  assert.equal((await pluginOps()).length, 0);
});

test("delta: hanya item baru/berubah; tombstone → record lokal dihapus", async () => {
  const srv = makeServer();
  const p = srv.add(P, [row(1, "a"), row(2, "b"), row(3, "c")]);
  await pull(srv);
  srv.calls.length = 0;
  events = [];
  p.rows = [row(2, "b"), row(3, "c"), row(4, "d"), row(5, "a", { deleted: true, data: {}, version: 2 }),
    row(6, "b", { data: { t: "b2" }, version: 2 })];
  srv.pageSize = 10;
  const r = await pull(srv);
  assert.equal(srv.calls.length, 1);
  assert.equal(cursorOf(srv.calls[0]), "1.3." + FP);
  assert.deepEqual(r.plugins[P], { pulled: 2, removed: 1, reset: false, pages: 1 });
  assert.equal(await rawRec("a"), null);
  assert.deepEqual((await rawRec("b")).data, { t: "b2" });
  assert.equal((await rawRec("b")).version, 2);
  assert.ok(await rawRec("c"));
  assert.ok(await rawRec("d"));
  assert.equal(await kv("cursor"), "1.6." + FP);
  assert.equal(await kv("gen"), 1);
  assert.deepEqual(events.length, 1);
  assert.deepEqual(events[0].ids.slice().sort(), ["a", "b", "d"]);
  assert.equal(events[0].source, "sync");
});

test("record lokal dirty tidak ditimpa pull (data, op_qid tetap)", async () => {
  const srv = makeServer();
  await PS.put(P, E, "a", { mine: 1 });
  await PS.put(P, E, "b", { mine: 2 });
  const before = { a: await rawRec("a"), b: await rawRec("b") };
  srv.add(P, [row(1, "a", { data: { theirs: 1 }, version: 3 }), row(2, "b", { deleted: true, data: {} }), row(3, "c")]);
  srv.pageSize = 10;
  const r = await pull(srv);
  assert.deepEqual(r.plugins[P], { pulled: 1, removed: 0, reset: false, pages: 1 });
  for (const id of ["a", "b"]) {
    const now = await rawRec(id);
    assert.deepEqual(now.data, before[id].data);
    assert.equal(now.op_qid, before[id].op_qid);
    assert.equal(now.dirty, 1);
    assert.equal(now.version, null);
    assert.equal(now.updated_at, before[id].updated_at);
    assert.equal(now.sync_gen, 1); // ditandai "terlihat" di gen ini → tidak tersapu setelah ack
  }
  const ops = await pluginOps();
  assert.equal(ops.length, 2);
  assert.ok(await rawRec("c"));
});

test("reset (keluar workspace): kursor dikosongkan, tarik penuh, record list:W bersih yang tidak terlihat dihapus, record dirty list:W dipertahankan (lalu FORBIDDEN_SCOPE di push)", async () => {
  const srv = makeServer();
  const p = srv.add(P, [row(1, "u1"), row(2, "w1", { scope: "list:7" }), row(3, "w2", { scope: "list:7" })]);
  await pull(srv);
  await PS.put(P, E, "w2", { edit: true }, { scope: "list:7" });
  srv.calls.length = 0;
  events = [];
  // dikeluarkan dari workspace 7: fp berubah, baris list:7 tidak lagi terlihat
  p.fp = "bbbb1111";
  p.rows = [row(1, "u1"), row(4, "u2")];
  const r = await pull(srv);
  assert.deepEqual(srv.calls.map(cursorOf), ["1.3." + FP, ""]);
  assert.deepEqual(r.plugins[P], { pulled: 2, removed: 1, reset: true, pages: 1 });
  assert.equal(await rawRec("w1"), null);
  const w2 = await rawRec("w2");
  assert.equal(w2.dirty, 1);
  assert.deepEqual(w2.data, { edit: true });
  assert.equal((await rawRec("u1")).sync_gen, 2);
  assert.ok(await rawRec("u2"));
  assert.equal(await kv("gen"), 2);
  assert.equal(await kv("resetting"), false);
  assert.equal(await kv("cursor"), "1.4.bbbb1111");
  assert.ok(events.some((e) => e.ids.includes("w1")));
  assert.equal((await pluginOps()).length, 1);
});

test("anggota baru: reset → tarik penuh memasukkan record list:W lama", async () => {
  const srv = makeServer();
  const p = srv.add(P, [row(2, "u1")]);
  await pull(srv);
  assert.equal(await kv("cursor"), "1.2." + FP);
  // diundang ke workspace 7: baris lama (seq < kursor) kini terlihat, fp berubah
  p.fp = "cccc2222";
  p.rows = [row(1, "w-old", { scope: "list:7" }), row(2, "u1")];
  const r = await pull(srv);
  assert.equal(r.plugins[P].reset, true);
  const w = await rawRec("w-old");
  assert.ok(w);
  assert.equal(w.scope, "list:7");
  assert.equal(w.dirty, 0);
  assert.ok(await rawRec("u1"));
  assert.equal(await kv("gen"), 2);
});

test("terputus di tengah tarik penuh (halaman 2 gagal) → sinkron berikut lanjut dari kursor dengan gen sama; sapu hanya setelah halaman terakhir", async () => {
  const srv = makeServer();
  srv.add(P, [row(1, "a"), row(2, "b"), row(3, "c")]);
  // record bersih basi (mis. sisa sebelum reset) — tidak ada di server
  await rawPut("plugin_records", [{ plugin_id: P, entity: E, id: "stale", scope: "user", data: {}, updated_at: "2026-10-01T00:00:00Z",
    version: 1, deleted: 0, dirty: 0, op_qid: null }]);
  srv.hook = (pid, cursor, n) => (n === 2 ? resp(503, { detail: { code: "PLUGIN_UNAVAILABLE" } }) : null);
  const r1 = await pull(srv);
  assert.equal(r1.errors.length, 1);
  assert.equal(r1.errors[0].pluginId, P);
  assert.equal(r1.errors[0].status, 503);
  assert.equal(r1.errors[0].code, "PLUGIN_UNAVAILABLE");
  assert.equal(r1.plugins[P], undefined);
  assert.equal(await kv("cursor"), "1.2." + FP);
  assert.equal(await kv("gen"), 1);
  assert.equal(await kv("resetting"), true);
  assert.ok(await rawRec("stale"), "belum disapu sebelum halaman terakhir");
  assert.ok(await rawRec("a"));
  srv.hook = null;
  srv.calls.length = 0;
  const r2 = await pull(srv);
  assert.deepEqual(srv.calls.map(cursorOf), ["1.2." + FP]);
  assert.deepEqual(r2.plugins[P], { pulled: 1, removed: 1, reset: false, pages: 1 });
  assert.equal(await rawRec("stale"), null);
  assert.ok(await rawRec("a"));
  assert.ok(await rawRec("c"));
  assert.equal(await kv("gen"), 1);
  assert.equal(await kv("resetting"), false);
});

test("terputus di tengah tarik penuh: record dirty yang di-ack di antaranya (LWW kalah, seq lama) tidak tersapu", async () => {
  const srv = makeServer();
  srv.add(P, [row(1, "a", { data: { srv: 1 }, version: 2 }), row(2, "b"), row(3, "c")]);
  await PS.put(P, E, "a", { mine: 1 });
  srv.hook = (pid, cursor, n) => (n === 2 ? "NETWORK" : null);
  const r1 = await pull(srv);
  assert.equal(r1.errors.length, 1);
  // push: applied false → adopsi baris server (bersih), tanpa seq baru di server
  const a = await rawRec("a");
  const outbox = await pluginOps();
  await PS.pushOp(outbox[0], { send: () => Promise.resolve({ status: 200, data: { results: [{ entity: E, id: "a", applied: false,
    record: { entity: E, id: "a", scope: "user", data: { srv: 1 }, updated_at: "2026-11-01T00:00:01Z", version: 2, deleted: false } }] } }) });
  assert.equal((await rawRec("a")).dirty, 0);
  assert.equal(a.sync_gen, 1);
  srv.hook = null;
  await pull(srv);
  assert.ok(await rawRec("a"), "record yang terlihat di gen ini tidak disapu");
  assert.equal(await kv("resetting"), false);
});

test("reset dua kali dalam satu sinkron → berhenti (tanpa loop)", async () => {
  const srv = makeServer();
  srv.add(P, [row(1, "a"), row(2, "b"), row(3, "c")]);
  await rawPut("plugin_kv", [{ plugin_id: P, scope: "_sync", key: "cursor", value: "1.9.deadbeef" },
    { plugin_id: P, scope: "_sync", key: "gen", value: 3 }]);
  srv.hook = (pid, cursor) => (cursor ? resp(200, { reset: true }) : null);
  const r = await pull(srv);
  assert.deepEqual(srv.calls.map(cursorOf), ["1.9.deadbeef", "", "1.2." + FP]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plugins[P], { pulled: 2, removed: 0, reset: true, pages: 1 });
  assert.equal(await kv("cursor"), "1.2." + FP);
  assert.equal(await kv("gen"), 4);
  assert.equal(await kv("resetting"), true);
});

test("≤ 50 halaman per plugin per sinkron", async () => {
  const srv = makeServer();
  srv.add(P, []);
  srv.hook = (pid, cursor) => {
    const s = cursor ? Number(cursor.split(".")[1]) : 0;
    const r = row(s + 1, "r" + (s + 1));
    delete r.seq;
    return resp(200, { items: [r], cursor: "1." + (s + 1) + "." + FP, more: true });
  };
  const r = await pull(srv);
  assert.equal(srv.calls.length, 50);
  assert.deepEqual(r.plugins[P], { pulled: 50, removed: 0, reset: false, pages: 50 });
  assert.equal(await kv("cursor"), "1.50." + FP);
  assert.equal(await kv("resetting"), true);
  assert.equal((await recsOf()).length, 50);
});

test("halaman ditulis atomik: kursor tidak maju bila transaksi record gagal", async () => {
  const srv = makeServer();
  const p = srv.add(P, [row(1, "a")]);
  await pull(srv);
  p.rows.push(row(2, "b"));
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) {
    if (this.name === "plugin_records") throw new Error("disk penuh");
    return orig.call(this, v, k);
  };
  let r;
  try { r = await pull(srv); } finally { IDBObjectStore.prototype.put = orig; }
  assert.equal(r.errors.length, 1);
  assert.equal(await kv("cursor"), "1.1." + FP);
  assert.equal(await rawRec("b"), null);
  const r2 = await pull(srv);
  assert.deepEqual(r2.errors, []);
  assert.ok(await rawRec("b"));
  assert.equal(await kv("cursor"), "1.2." + FP);
});

test("404 PLUGIN_UNKNOWN → plugin dilewati; 404 tanpa kode → error dilaporkan, plugin lain tetap ditarik", async () => {
  const srv = makeServer();
  srv.add("p-old", [row(1, "x")]);
  srv.add("p-ok", [row(1, "y")]);
  srv.hook = (pid) => (pid === "p-old" ? resp(404, { detail: "Not Found" }) : null);
  const r = await PS.pullAll(srv.fetch, { userId: 1, ids: ["p-gone", "p-old", "p-ok"] });
  assert.deepEqual(srv.calls.map((u) => u.split("/")[3]), ["p-gone", "p-old", "p-ok"]);
  assert.equal(r.plugins["p-gone"].skipped, "PLUGIN_UNKNOWN");
  assert.equal(r.plugins["p-gone"].pages, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].pluginId, "p-old");
  assert.equal(r.errors[0].status, 404);
  assert.equal(r.errors[0].code, null);
  assert.equal(r.plugins["p-ok"].pulled, 1);
  assert.ok(await rawRec("y", "p-ok"));
  assert.equal(await kv("cursor", "p-old"), undefined);
  // galat jaringan pada satu plugin juga terisolasi
  srv.hook = (pid) => (pid === "p-old" ? "NETWORK" : null);
  const r2 = await PS.pullAll(srv.fetch, { userId: 1, ids: ["p-old", "p-ok"] });
  assert.equal(r2.errors.length, 1);
  assert.equal(r2.errors[0].pluginId, "p-old");
  assert.ok(r2.plugins["p-ok"]);
});

test("respons 2xx tak terbaca → error, kursor tidak berubah", async () => {
  const srv = makeServer();
  srv.add(P, []);
  srv.hook = () => resp(200, { items: "nope" });
  const r = await pull(srv);
  assert.equal(r.errors.length, 1);
  assert.equal(await kv("cursor"), undefined);
});

test("hanya ids yang diberikan (plugin ON) yang ditarik", async () => {
  const srv = makeServer();
  srv.add("p-on", [row(1, "a")]);
  srv.add("p-off", [row(1, "b")]);
  const r = await PS.pullAll(srv.fetch, { userId: 1, ids: ["p-on"] });
  assert.deepEqual(srv.calls.map((u) => u.split("/")[3]), ["p-on"]);
  assert.deepEqual(Object.keys(r.plugins), ["p-on"]);
  assert.equal((await recsOf("p-off")).length, 0);
  srv.calls.length = 0;
  await PS.pullAll(srv.fetch, { userId: 1, ids: [] });
  await PS.pullAll(srv.fetch, { userId: 1 });
  assert.equal(srv.calls.length, 0);
});

test("pemilik berbeda → record, kv, dan op plugin akun lama dihapus sebelum request; pemilik sama → tidak", async () => {
  const srv = makeServer();
  srv.add(P, [row(1, "a"), row(2, "b")]);
  srv.pageSize = 10;
  // pertama kali (tanpa owner): owner ditulis, tidak menghapus apa pun
  await PS.put(P, E, "local", { x: 1 });
  const r0 = await pull(srv, [P], 1);
  assert.deepEqual(r0.errors, []);
  assert.equal(await PS.kvGet("_host", "_sync", "owner"), "1");
  assert.ok(await rawRec("local"));
  assert.equal((await pluginOps()).length, 1);
  await outboxAdd({ entity_type: "task", op: "update", cid: "t-1", payload: {} });
  // pemilik sama → tidak menghapus
  await pull(srv, [], 1);
  assert.ok(await rawRec("local"));
  assert.equal(await kv("cursor"), "1.2." + FP);
  // pemilik berbeda → dihapus sebelum request pertama
  let seen = null;
  const r = await PS.pullAll((url) => {
    if (seen) return srv.fetch(url);
    return Promise.all([recsOf(), pluginOps(), kv("cursor")]).then(([recs, ops, cur]) => {
      seen = { recs: recs.length, ops: ops.length, kvCursor: cur, cursor: cursorOf(url) };
      return srv.fetch(url);
    });
  }, { userId: 2, ids: [P] });
  assert.deepEqual(r.errors, []);
  assert.equal(seen.recs, 0);
  assert.equal(seen.ops, 0);
  assert.equal(seen.kvCursor, undefined);
  assert.equal(seen.cursor, "");
  assert.equal(await PS.kvGet("_host", "_sync", "owner"), "2");
  assert.equal(await rawRec("local"), null);
  assert.ok(await rawRec("a"));
  const ops = await outboxAll();
  assert.equal(ops.filter((o) => o.entity_type === "plugin").length, 0);
  assert.equal(ops.filter((o) => o.entity_type === "task").length, 1);
  assert.equal(await kv("gen"), 1);
});

test("ensureOwner langsung: first / same / foreign; tanpa userId → pullAll tidak melakukan apa pun", async () => {
  assert.equal(await PS.ensureOwner("5"), "first");
  assert.equal(await PS.ensureOwner(5), "same");
  await PS.put(P, E, "a", { x: 1 });
  assert.equal(await PS.ensureOwner("6"), "foreign");
  assert.equal((await recsOf()).length, 0);
  assert.equal((await pluginOps()).length, 0);
  const srv = makeServer();
  srv.add(P, [row(1, "a")]);
  const r = await PS.pullAll(srv.fetch, { userId: null, ids: [P] });
  assert.deepEqual(r, { plugins: {}, errors: [] });
  assert.equal(srv.calls.length, 0);
  assert.equal(await PS.kvGet("_host", "_sync", "owner"), "6");
});

test("syncpull.pullPluginRecords: pembungkus malas ke pullAll; error dikumpulkan dilempar di akhir; modul tidak ada → null", async () => {
  const srv = makeServer();
  srv.add("p-ok", [row(1, "y")]);
  const ok = await SPULL.pullPluginRecords(srv.fetch, { userId: 1, ids: ["p-ok"] });
  assert.equal(ok.plugins["p-ok"].pulled, 1);
  // ids tidak diberikan → TF.plugins.recordPluginIds()
  globalThis.TF = globalThis.TF || {};
  globalThis.TF.plugins = { recordPluginIds: () => ["p-ok"] };
  srv.calls.length = 0;
  await SPULL.pullPluginRecords(srv.fetch, { userId: 1 });
  assert.equal(srv.calls.length, 1);
  delete globalThis.TF.plugins;
  srv.hook = (pid) => (pid === "p-bad" ? resp(500, {}) : null);
  srv.calls.length = 0;
  await assert.rejects(SPULL.pullPluginRecords(srv.fetch, { userId: 1, ids: ["p-bad", "p-ok"] }), (e) => {
    assert.equal(e.result.errors.length, 1);
    assert.equal(e.result.errors[0].pluginId, "p-bad");
    assert.ok(e.result.plugins["p-ok"]);
    return true;
  });
  assert.equal(srv.calls.length, 2);
  const key = require.resolve("../../static/offline/plugin_sync.js");
  const saved = require.cache[key].exports;
  try {
    require.cache[key].exports = null;
    assert.equal(await SPULL.pullPluginRecords(srv.fetch, { userId: 1, ids: ["p-ok"] }), null);
    require.cache[key].exports = { put() {} };
    assert.equal(await SPULL.pullPluginRecords(srv.fetch, { userId: 1, ids: ["p-ok"] }), null);
  } finally { require.cache[key].exports = saved; }
});
