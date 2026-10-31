"use strict";
// TF.pluginsync (rencana PR 1a-2 Task 4; R8, R10, R11, R17 sisi penyimpanan): record plugin lokal di IndexedDB,
// tepat satu op outbox per record (coalescing op_qid), onChange. Push/pull belum ada di berkas ini.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const dbmod = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const TE = require("../../static/offline/taskext.js");
const PS = require("../../static/offline/plugin_sync.js");
const V = require("../fixtures/plugin_records_vectors.json");

const P = "demo-records";
const E = "note";
const origOpenDB = dbmod.openDB;
let events;

beforeEach(async () => {
  dbmod.openDB = origOpenDB;
  dbmod._reset();
  await deleteDB(dbmod.DB_NAME);
  events = [];
  globalThis.dispatchEvent = (ev) => { events.push(ev); return true; };
});
afterEach(() => {
  dbmod.openDB = origOpenDB;
  delete globalThis.dispatchEvent;
});

const pluginOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin");
function rawAll(store) {
  return dbmod.openDB().then((d) => new Promise((res, rej) => {
    const r = d.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const rawRec = async (id, entity, pid) =>
  (await rawAll("plugin_records")).find((r) => r.plugin_id === (pid || P) && r.entity === (entity || E) && r.id === id) || null;
const rejects = (p, code, detail) => assert.rejects(p, (e) => {
  assert.equal(e.code, code);
  if (detail !== undefined) assert.equal(e.detail, detail);
  return true;
});

test("put baru → record dirty 1, version null, satu op upsert dengan cid pid/entity/id, op_qid = qid", async () => {
  const rec = await PS.put(P, E, "n1", { t: "halo" }, { scope: "user" });
  assert.equal(rec.id, "n1");
  assert.equal(rec.scope, "user");
  assert.equal(rec.version, null);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.deleted, 0);
  assert.ok(!isNaN(Date.parse(rec.updated_at)));
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "upsert");
  assert.equal(ops[0].cid, "demo-records/note/n1");
  assert.equal(PS.opCid(P, E, "n1"), "demo-records/note/n1");
  assert.equal(ops[0].retries, 0);
  assert.equal(typeof ops[0].ts, "number");
  assert.deepEqual(ops[0].payload.data, { t: "halo" });
  const raw = await rawRec("n1");
  assert.equal(raw.op_qid, ops[0].qid);
  assert.equal(raw.dirty, 1);
  assert.equal(raw.deleted, 0);
  assert.deepEqual(raw.data, { t: "halo" });
});

test("scope bawaan 'user'; id null → newId()", async () => {
  const rec = await PS.put(P, E, null, { a: 1 });
  assert.equal(rec.scope, "user");
  assert.ok(PS.newId().length >= 8);
  assert.notEqual(PS.newId(), PS.newId());
  assert.ok(/^[A-Za-z0-9:@._-]{1,80}$/.test(rec.id));
  assert.ok(await PS.get(P, E, rec.id));
});

test("20 put pada record yang sama → tepat satu op di _outbox, op_qid menunjuk op terakhir, payload = isi terakhir", async () => {
  for (let i = 0; i < 20; i++) await PS.put(P, E, "n1", { i });
  const ops = await pluginOps();
  assert.equal(ops.length, 1);
  assert.equal((await rawAll("_outbox")).length, 1);
  assert.deepEqual(ops[0].payload.data, { i: 19 });
  const raw = await rawRec("n1");
  assert.equal(raw.op_qid, ops[0].qid);
  assert.deepEqual(raw.data, { i: 19 });
  // record berbeda → op berbeda
  await PS.put(P, E, "n2", { i: 0 });
  assert.equal((await pluginOps()).length, 2);
});

test("put dan op ditulis atomik: transaksi gagal (abort dipaksa) → record dan outbox tidak berubah", async () => {
  await PS.put(P, E, "n1", { v: 1 });
  const before = { rec: await rawAll("plugin_records"), ob: await rawAll("_outbox") };
  const proto = IDBObjectStore.prototype;
  const origPut = proto.put;
  proto.put = function (...a) {
    if (this.name === "plugin_records") throw new Error("paksa gagal");
    return origPut.apply(this, a);
  };
  try {
    await assert.rejects(PS.put(P, E, "n1", { v: 2 }), /paksa gagal/);
    await assert.rejects(PS.put(P, E, "baru", { v: 2 }), /paksa gagal/);
    await assert.rejects(PS.remove(P, E, "n1"), /paksa gagal/);
  } finally { proto.put = origPut; }
  assert.deepEqual(await rawAll("plugin_records"), before.rec);
  assert.deepEqual(await rawAll("_outbox"), before.ob);
  assert.equal(events.filter((e) => e.type === "tf:plugin-records").length, 1); // hanya put pertama
});

test("remove → tombstone (deleted 1, dirty 1) + op delete menggantikan op upsert; get/list tidak mengembalikannya; remove record tak ada → false tanpa op", async () => {
  await PS.put(P, E, "n1", { v: 1 });
  await PS.put(P, E, "n2", { v: 2 });
  assert.equal(await PS.remove(P, E, "n1"), true);
  const raw = await rawRec("n1");
  assert.equal(raw.deleted, 1);
  assert.equal(raw.dirty, 1);
  const ops = (await pluginOps()).filter((o) => o.cid.endsWith("/n1"));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "delete");
  assert.equal(raw.op_qid, ops[0].qid);
  assert.equal((await pluginOps()).length, 2);
  assert.equal(await PS.get(P, E, "n1"), null);
  assert.deepEqual((await PS.list(P, E)).items.map((r) => r.id), ["n2"]);
  // remove kedua kali / record tak ada → false, tanpa op baru
  const n = (await rawAll("_outbox")).length;
  assert.equal(await PS.remove(P, E, "n1"), false);
  assert.equal(await PS.remove(P, E, "tidak-ada"), false);
  assert.equal((await rawAll("_outbox")).length, n);
  // put ulang membangkitkan tombstone, tetap satu op
  await PS.put(P, E, "n1", { v: 3 });
  const again = (await pluginOps()).filter((o) => o.cid.endsWith("/n1"));
  assert.equal(again.length, 1);
  assert.equal(again[0].op, "upsert");
  assert.equal((await PS.get(P, E, "n1")).data.v, 3);
});

test("remove mengambil versi terakhir yang dikenal server dan tidak menghapus keras record yang belum diterima server", async () => {
  await PS.put(P, E, "n1", { v: 1 });
  await PS.remove(P, E, "n1");
  const raw = await rawRec("n1");
  assert.ok(raw, "tombstone tetap ada sampai ack");
  assert.equal(raw.version, null);
});

test("list: urut id, limit/next, after, filter scope lewat indeks entity_scope; tombstone dilewati; limit 1–1000", async () => {
  for (const id of ["c", "a", "e", "b", "d"]) await PS.put(P, E, id, { id }, { scope: id === "b" || id === "d" ? "list:7" : "user" });
  await PS.put(P, E, "z", {});
  await PS.remove(P, E, "z");
  await PS.remove(P, E, "c");
  const all = await PS.list(P, E);
  assert.deepEqual(all.items.map((r) => r.id), ["a", "b", "d", "e"]);
  assert.equal(all.next, null);
  const p1 = await PS.list(P, E, { limit: 2 });
  assert.deepEqual(p1.items.map((r) => r.id), ["a", "b"]);
  assert.equal(p1.next, "b");
  const p2 = await PS.list(P, E, { limit: 2, after: p1.next });
  assert.deepEqual(p2.items.map((r) => r.id), ["d", "e"]);
  assert.equal(p2.next, null);
  assert.deepEqual((await PS.list(P, E, { after: "d" })).items.map((r) => r.id), ["e"]);
  // scope
  const sl = await PS.list(P, E, { scope: "list:7" });
  assert.deepEqual(sl.items.map((r) => r.id), ["b", "d"]);
  const su = await PS.list(P, E, { scope: "user", limit: 1 });
  assert.deepEqual(su.items.map((r) => r.id), ["a"]);
  assert.equal(su.next, "a");
  const su2 = await PS.list(P, E, { scope: "user", limit: 1, after: su.next });
  assert.deepEqual(su2.items.map((r) => r.id), ["e"]); // c tombstone dilewati
  assert.equal(su2.next, null);
  assert.deepEqual((await PS.list(P, E, { scope: "list:7", after: "b" })).items.map((r) => r.id), ["d"]);
  assert.deepEqual((await PS.list(P, E, { scope: "list:9" })).items, []);
  // limit 1–1000
  await rejects(PS.list(P, E, { limit: 0 }), "INVALID", "limit");
  await rejects(PS.list(P, E, { limit: 1001 }), "INVALID", "limit");
  await rejects(PS.list(P, E, { limit: 1.5 }), "INVALID", "limit");
  assert.equal((await PS.list(P, E, { limit: 1000 })).items.length, 4);
});

test("list entitas lain / plugin lain tidak bocor", async () => {
  await PS.put(P, E, "n1", { a: 1 });
  await PS.put(P, "todo", "n1", { a: 2 });
  await PS.put("other-plug", E, "n1", { a: 3 });
  await PS.put(P, "notez", "n9", { a: 4 });
  assert.deepEqual((await PS.list(P, E)).items.map((r) => r.data.a), [1]);
  assert.deepEqual((await PS.list(P, E, { scope: "user" })).items.map((r) => r.data.a), [1]);
  assert.deepEqual((await PS.list("other-plug", E)).items.map((r) => r.data.a), [3]);
  assert.equal((await PS.get(P, "todo", "n1")).data.a, 2);
  assert.equal(await PS.get(P, E, "n9"), null);
});

test("vektor bersama (sisi client): id/entitas/scope/ukuran/ref", async () => {
  for (const id of V.ids.valid) await PS.put(P, E, id, {});
  for (const id of V.ids.invalid) await rejects(PS.put(P, E, id, {}), "INVALID", "id");
  for (const e of V.entities.valid) await PS.put(P, e, "x", {});
  for (const e of V.entities.invalid) await rejects(PS.put(P, e, "x", {}), "INVALID", "entity");
  for (const s of V.scopes.valid) await PS.put(P, "scoped", "x" + s.length + s.slice(-3), {}, { scope: s });
  for (const s of V.scopes.invalid) await rejects(PS.put(P, "scoped", "q", {}, { scope: s }), "INVALID", "scope");
  assert.equal((await PS.list(P, "scoped")).items.length, V.scopes.valid.length);
  for (const c of V.sizes) {
    const p = PS.put(P, "sized", "s", c.data, { decl: { maxBytes: c.maxBytes } });
    if (c.error === null) await p;
    else if (c.error === "size") await rejects(p, "TOO_LARGE");
    else await rejects(p, "INVALID", c.error);
  }
  for (const r of V.refs) {
    assert.equal(TE.checkValue(r.value), r.client === "ok" ? null : r.client, JSON.stringify(r.value));
    const p = PS.put(P, "reffed", "r", { v: r.value });
    if (r.client === "ok") await p;
    else await rejects(p, "INVALID", "task_ref");
  }
});

test("scope tidak bisa diubah", async () => {
  await PS.put(P, E, "n1", { a: 1 }, { scope: "user" });
  await rejects(PS.put(P, E, "n1", { a: 2 }, { scope: "list:3" }), "SCOPE_IMMUTABLE");
  assert.equal((await PS.get(P, E, "n1")).data.a, 1);
  assert.equal((await pluginOps()).length, 1);
  await PS.put(P, E, "n1", { a: 3 }, { scope: "user" });
  assert.equal((await PS.get(P, E, "n1")).data.a, 3);
  // tombstone tetap mengunci scope
  await PS.remove(P, E, "n1");
  await rejects(PS.put(P, E, "n1", {}, { scope: "list:3" }), "SCOPE_IMMUTABLE");
});

test("data bukan objek / fungsi / NaN → INVALID", async () => {
  for (const bad of [null, undefined, [], "x", 5, true, () => 1]) await rejects(PS.put(P, E, "n1", bad), "INVALID", "data");
  await rejects(PS.put(P, E, "n1", { f() {} }), "INVALID", "data");
  await rejects(PS.put(P, E, "n1", { n: NaN }), "INVALID", "data");
  await rejects(PS.put(P, E, "n1", { n: Infinity }), "INVALID", "data");
  await rejects(PS.put(P, E, "n1", { d: new Date() }), "INVALID", "data");
  await rejects(PS.put(P, E, "n1", { u: undefined }), "INVALID", "data");
  assert.equal(await rawRec("n1"), null);
  assert.equal((await pluginOps()).length, 0);
});

test("ref $task cid string dan angka diterima, {$task: 1.5} ditolak", async () => {
  await PS.put(P, E, "a", { t: { $task: 12 } });
  await PS.put(P, E, "b", { t: { $task: "c-1b2f" } });
  await rejects(PS.put(P, E, "c", { t: { $task: 1.5 } }), "INVALID", "task_ref");
  await rejects(PS.put(P, E, "c", { t: { $task: "" } }), "INVALID", "task_ref");
  assert.deepEqual((await PS.list(P, E)).items.map((r) => r.id), ["a", "b"]);
});

test("put menghapus sync_error dan memakai updated_at baru; version dipertahankan", async () => {
  await PS.put(P, E, "n1", { a: 1 });
  const d = await dbmod.openDB();
  await new Promise((res, rej) => {
    const tx = d.transaction("plugin_records", "readwrite");
    const st = tx.objectStore("plugin_records");
    const g = st.get([P, E, "n1"]);
    g.onsuccess = () => {
      const r = g.result;
      r.sync_error = { code: "INVALID", at: "x" };
      r.version = 4;
      r.updated_at = "2000-01-01T00:00:00.000Z";
      st.put(r);
    };
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  assert.equal((await PS.toPublic(await rawRec("n1"))).error, "INVALID");
  const rec = await PS.put(P, E, "n1", { a: 2 });
  assert.ok(!("sync_error" in rec));
  assert.equal(rec.version, 4);
  assert.ok(rec.updated_at > "2020");
  assert.ok(!("sync_error" in (await rawRec("n1"))));
});

test("subscribe: put/remove memancarkan source local setelah transaksi selesai; pendengar error tidak memutus pendengar lain", async () => {
  const got = [];
  const origWarn = console.warn;
  console.warn = () => {};
  const offBad = PS.subscribe(() => { throw new Error("boom"); });
  const off = PS.subscribe(async (ev) => { got.push({ ev, seen: await PS.get(P, E, "n1") }); });
  try {
    await PS.put(P, E, "n1", { a: 1 });
    await PS.remove(P, E, "n1");
  } finally { console.warn = origWarn; }
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].ev, { pluginId: P, entity: E, ids: ["n1"], source: "local" });
  assert.ok(got[0].seen, "pendengar put melihat record yang sudah tersimpan");
  assert.equal(got[1].ev.source, "local");
  assert.equal(got[1].seen, null, "pendengar remove melihat tombstone (tidak terlihat)");
  const win = events.filter((e) => e.type === "tf:plugin-records");
  assert.equal(win.length, 2);
  assert.deepEqual(win[0].detail, { pluginId: P, entity: E, ids: ["n1"], source: "local" });
  assert.equal(events.filter((e) => e.type === "tf:outbox-queued").length, 2);
  off(); offBad();
  await PS.put(P, E, "n2", {});
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(got.length, 2);
  assert.throws(() => PS.subscribe(null), TypeError);
});

test("toPublic: pending = dirty 1, error dari sync_error, data salinan dalam (mutasi hasil tidak mengubah IndexedDB)", async () => {
  await PS.put(P, E, "n1", { a: { b: [1, 2] } }, { scope: "list:4" });
  const pub = await PS.get(P, E, "n1");
  assert.deepEqual(Object.keys(pub).sort(), ["data", "entity", "id", "pending", "scope", "updated_at", "version"]);
  assert.equal(pub.pending, true);
  assert.equal(pub.entity, E);
  assert.equal(pub.scope, "list:4");
  pub.data.a.b.push(99);
  pub.data.x = 1;
  assert.deepEqual((await PS.get(P, E, "n1")).data, { a: { b: [1, 2] } });
  assert.deepEqual((await rawRec("n1")).data, { a: { b: [1, 2] } });
  const clean = PS.toPublic({ plugin_id: P, entity: E, id: "q", scope: "user", data: { k: 1 }, updated_at: "t", version: 3, dirty: 0, deleted: 0 });
  assert.deepEqual(clean, { entity: E, id: "q", scope: "user", data: { k: 1 }, updated_at: "t", version: 3, pending: false });
  const errd = PS.toPublic({ plugin_id: P, entity: E, id: "q", scope: "user", data: {}, updated_at: "t", version: 3, dirty: 1, deleted: 0, sync_error: { code: "INVALID", detail: "size", at: "t" } });
  assert.equal(errd.error, "INVALID");
  assert.equal(errd.pending, true);
  const src = { a: [1] };
  const copy = PS.toPublic({ plugin_id: P, entity: E, id: "q", scope: "user", data: src, updated_at: "t", version: 1, dirty: 0, deleted: 0 });
  copy.data.a.push(2);
  assert.deepEqual(src, { a: [1] });
});

test("kvGet/kvSet: keyPath [plugin_id, scope, key]", async () => {
  assert.equal(await PS.kvGet(P, "_sync", "cursor"), undefined);
  await PS.kvSet(P, "_sync", "cursor", "1.5.abc");
  assert.equal(await PS.kvGet(P, "_sync", "cursor"), "1.5.abc");
  await PS.kvSet(P, "_sync", "gen", 3);
  await PS.kvSet("other", "_sync", "cursor", "x");
  assert.equal(await PS.kvGet(P, "_sync", "cursor"), "1.5.abc");
  assert.equal(await PS.kvGet(P, "_sync", "gen"), 3);
  const raw = await rawAll("plugin_kv");
  assert.equal(raw.length, 3);
  const row = raw.find((r) => r.plugin_id === P && r.key === "cursor");
  assert.equal(row.scope, "_sync");
  assert.equal(row.value, "1.5.abc");
  await PS.kvSet(P, "_sync", "cursor", "1.9.abc");
  assert.equal(await PS.kvGet(P, "_sync", "cursor"), "1.9.abc");
  assert.equal((await rawAll("plugin_kv")).length, 3);
});

test("ENTITY = plugin dan modul terpasang di TF.pluginsync", () => {
  assert.equal(PS.ENTITY, "plugin");
  assert.equal(globalThis.TF.pluginsync, PS);
  assert.equal(typeof PS._internals, "object");
});
