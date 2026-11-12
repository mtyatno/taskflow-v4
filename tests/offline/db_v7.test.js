"use strict";
// R9 (plan PR 1a-2): IndexedDB v7 = store plugin_records + plugin_kv, tanpa memindah data.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { DB_NAME, DB_VERSION, ENTITY_STORES, ENTITY_STORE_NAMES, PLUGIN_STORES, openDB, clearAll, subscribe, upgradeState, _reset } = TFdb;

const V6 = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/idb_v6_schema.json"), "utf8"));

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 0));
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

function rawOpen(version, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, version);
    r.onupgradeneeded = (e) => { if (o.upgrade) o.upgrade(e.target.result, e.target.transaction); };
    r.onsuccess = (e) => resolve(e.target.result);
    r.onerror = () => reject(r.error);
    if (o.onblocked) r.onblocked = o.onblocked;
  });
}

// Bangun DB v6 mentah persis dari fixture skema.
function createV6(db) {
  for (const [name, def] of Object.entries(V6.stores)) {
    const opts = {};
    if (def.keyPath !== null) opts.keyPath = def.keyPath;
    if (def.autoIncrement) opts.autoIncrement = true;
    const s = db.createObjectStore(name, opts);
    for (const [iname, idef] of Object.entries(def.indexes)) {
      s.createIndex(iname, idef.keyPath, { unique: idef.unique, multiEntry: idef.multiEntry });
    }
  }
}
const openV6 = () => rawOpen(6, { upgrade: createV6 });

async function dumpStore(db, name) {
  const tx = db.transaction(name, "readonly");
  const s = tx.objectStore(name);
  const [keys, values] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
  return { keys, values };
}

test("skema v7: plugin_records keyPath + empat indeks, plugin_kv keyPath; ENTITY_STORE_NAMES tidak memuat store plugin", async () => {
  assert.equal(DB_VERSION, 8); // v8 (pagar tab lama, db_v8.test.js) tanpa perubahan skema: skema v7 tetap
  assert.deepEqual(PLUGIN_STORES, {
    plugin_records: {
      keyPath: ["plugin_id", "entity", "id"],
      indexes: [
        ["entity", ["plugin_id", "entity"]],
        ["entity_updated", ["plugin_id", "entity", "updated_at"]],
        ["entity_dirty", ["plugin_id", "entity", "dirty"]],
        ["entity_scope", ["plugin_id", "entity", "scope"]],
      ],
    },
    plugin_kv: { keyPath: ["plugin_id", "scope", "key"], indexes: [] },
  });
  assert.ok(!ENTITY_STORE_NAMES.includes("plugin_records"));
  assert.ok(!ENTITY_STORE_NAMES.includes("plugin_kv"));
  assert.ok(!("plugin_records" in ENTITY_STORES));
  const db = await openDB();
  assert.equal(db.version, DB_VERSION);
  const tx = db.transaction(["plugin_records", "plugin_kv"], "readonly");
  const rec = tx.objectStore("plugin_records");
  assert.deepEqual(rec.keyPath, ["plugin_id", "entity", "id"]);
  assert.equal(rec.autoIncrement, false);
  assert.deepEqual(Array.from(rec.indexNames).sort(), ["entity", "entity_dirty", "entity_scope", "entity_updated"]);
  assert.deepEqual(rec.index("entity").keyPath, ["plugin_id", "entity"]);
  assert.deepEqual(rec.index("entity_updated").keyPath, ["plugin_id", "entity", "updated_at"]);
  assert.deepEqual(rec.index("entity_dirty").keyPath, ["plugin_id", "entity", "dirty"]);
  assert.deepEqual(rec.index("entity_scope").keyPath, ["plugin_id", "entity", "scope"]);
  for (const n of rec.indexNames) { assert.equal(rec.index(n).unique, false); assert.equal(rec.index(n).multiEntry, false); }
  const kv = tx.objectStore("plugin_kv");
  assert.deepEqual(kv.keyPath, ["plugin_id", "scope", "key"]);
  assert.equal(kv.indexNames.length, 0);
});

test("fixture idb_v6_schema.json cocok dengan ENTITY_STORES + store sistem v6", () => {
  assert.equal(V6.version, 6);
  const names = Object.keys(V6.stores).sort();
  assert.deepEqual(names, [...ENTITY_STORE_NAMES, "_meta", "_idmap", "_outbox", "blobs"].sort());
  assert.equal(V6.stores._outbox.autoIncrement, true);
  assert.equal(V6.stores._outbox.keyPath, "qid");
});

test("upgrade v6 → versi sekarang (v7 + v8 tanpa skema) mempertahankan seluruh data lama", async () => {
  const v6 = await openV6();
  const seed = {
    tasks: [{ cid: "t-1", server_id: 11, title: "A", gtd_status: "inbox", list_cid: "l-1", parent_cid: null, updated_at: "2026-10-01T00:00:00Z", dirty: 1, ext: { "demo-ext": { x: 1 } }, ext_dirty: { "demo-ext": true } },
            { cid: "t-2", server_id: 12, title: "B", gtd_status: "next", updated_at: "2026-10-02T00:00:00Z", dirty: 0 }],
    note_comments: [{ cid: "c-1", server_id: 5, note_cid: "n-1", note_id: 9, list_id: 3, body: "halo" }],
    _idmap: [{ key: "tasks:11", cid: "t-1" }],
    blobs: [{ id: "b-1", data: new Uint8Array([1, 2, 3]), type: "image/png" }],
  };
  const tx = v6.transaction([...Object.keys(seed), "_meta", "_outbox"], "readwrite");
  for (const [name, rows] of Object.entries(seed)) for (const r of rows) tx.objectStore(name).add(r);
  tx.objectStore("_meta").put({ v: 1, enabled: { "demo-ext": true } }, "plugins:state:v1");
  for (let i = 1; i <= 3; i++) tx.objectStore("_outbox").add({ entity_type: "task", op: "update", cid: "t-" + i, ts: i, retries: 0 });
  await done(tx);
  const names = Array.from(v6.objectStoreNames);
  const before = {};
  const indexBefore = {};
  for (const n of names) {
    before[n] = await dumpStore(v6, n);
    indexBefore[n] = Array.from(v6.transaction(n, "readonly").objectStore(n).indexNames);
  }
  assert.equal(before._outbox.keys.length, 3);
  v6.close();

  _reset();
  const db = await openDB();
  assert.equal(db.version, DB_VERSION);
  for (const n of names) {
    assert.ok(db.objectStoreNames.contains(n), "store hilang: " + n);
    const after = await dumpStore(db, n);
    assert.deepEqual(after, before[n], "data berubah di store " + n);
    assert.deepEqual(Array.from(db.transaction(n, "readonly").objectStore(n).indexNames), indexBefore[n], "indeks berubah di " + n);
  }
  // qid berikutnya = 4 (autoIncrement terjaga)
  const t2 = db.transaction("_outbox", "readwrite");
  const qid = await req(t2.objectStore("_outbox").add({ entity_type: "task", op: "update", cid: "t-9", ts: 9, retries: 0 }));
  await done(t2);
  assert.equal(qid, 4);
  // dua store baru kosong
  for (const n of ["plugin_records", "plugin_kv"]) {
    assert.equal((await dumpStore(db, n)).keys.length, 0);
  }
});

test("upgrade v1 legacy → versi sekarang: queue dipindah, cache dihapus, store plugin ada", async () => {
  const v1 = await rawOpen(1, { upgrade: (db) => {
    db.createObjectStore("cache");
    db.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
  } });
  const tx = v1.transaction("queue", "readwrite");
  tx.objectStore("queue").add({ kind: "task", action: "create", payload: { title: "x" } });
  await done(tx);
  v1.close();
  const db = await openDB();
  assert.equal(db.version, DB_VERSION);
  assert.equal(db.objectStoreNames.contains("queue"), false);
  assert.equal(db.objectStoreNames.contains("cache"), false);
  const all = await req(db.transaction("_outbox", "readonly").objectStore("_outbox").getAll());
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, "task");
  assert.ok(db.objectStoreNames.contains("plugin_records"));
  assert.ok(db.objectStoreNames.contains("plugin_kv"));
});

test("dirty 0/1 dan indeks majemuk: dirty 1 muncul di entity_dirty only([pid, entity, 1]), dirty true tidak", async () => {
  const db = await openDB();
  const tx = db.transaction("plugin_records", "readwrite");
  const s = tx.objectStore("plugin_records");
  const base = { plugin_id: "p", entity: "e", scope: "user", data: {}, updated_at: "2026-11-01T00:00:00Z", version: null, deleted: 0, op_qid: null };
  s.put({ ...base, id: "a", dirty: 1 });
  s.put({ ...base, id: "b", dirty: 0 });
  s.put({ ...base, id: "c", dirty: true });
  s.put({ ...base, id: "d", dirty: 1, entity: "other" });
  await done(tx);
  const rs = db.transaction("plugin_records", "readonly").objectStore("plugin_records");
  const dirty = await req(rs.index("entity_dirty").getAll(IDBKeyRange.only(["p", "e", 1])));
  assert.deepEqual(dirty.map((r) => r.id), ["a"]);
  const clean = await req(rs.index("entity_dirty").getAll(IDBKeyRange.only(["p", "e", 0])));
  assert.deepEqual(clean.map((r) => r.id), ["b"]);
  const ent = await req(rs.index("entity").getAll(IDBKeyRange.only(["p", "e"])));
  assert.deepEqual(ent.map((r) => r.id).sort(), ["a", "b", "c"]);
  const sc = await req(rs.index("entity_scope").getAll(IDBKeyRange.only(["p", "e", "user"])));
  assert.equal(sc.length, 3);
  const upd = await req(rs.index("entity_updated").getAll(IDBKeyRange.bound(["p", "e", "2026-11-01"], ["p", "e", "2026-12"])));
  assert.equal(upd.length, 3);
});

test("tab lain (koneksi v6 tanpa handler) menahan upgrade → event blocked; ditutup → openDB resolve versi sekarang + unblocked", async () => {
  const events = [];
  const off = subscribe((ev) => events.push(ev.type));
  const old = await openV6(); // tab pra-1a-1: tanpa onversionchange
  let resolved = false;
  const p = openDB().then((db) => { resolved = true; return db; });
  for (let i = 0; i < 20 && !events.includes("blocked"); i++) await tick(5);
  assert.deepEqual(events, ["blocked"]);
  assert.equal(upgradeState().blocked, true);
  assert.equal(resolved, false);
  old.close();
  const db = await p;
  assert.equal(db.version, DB_VERSION);
  assert.ok(db.objectStoreNames.contains("plugin_records"));
  assert.deepEqual(events, ["blocked", "unblocked"]);
  assert.deepEqual(upgradeState(), { blocked: false, upgradedElsewhere: false });
  off();
});

test("koneksi versi sekarang menerima versionchange dari tab lain (open mentah versi berikutnya) → DB_UPGRADED_ELSEWHERE", async () => {
  const events = [];
  const off = subscribe((ev) => events.push(ev.type));
  await openDB();
  let rawBlocked = false;
  const raw = await rawOpen(DB_VERSION + 1, { onblocked: () => { rawBlocked = true; } });
  assert.equal(raw.version, DB_VERSION + 1);
  assert.equal(rawBlocked, false);
  await assert.rejects(openDB(), { code: "DB_UPGRADED_ELSEWHERE" });
  assert.deepEqual(events, ["upgraded-elsewhere"]);
  raw.close();
  off();
});

test("rollback: kode yang membuka v6 pada DB versi sekarang → VersionError", async () => {
  const db = await openDB();
  assert.equal(db.version, DB_VERSION);
  db.close();
  _reset();
  await assert.rejects(rawOpen(6), (err) => err && err.name === "VersionError");
});

test("sumber db.js tidak pernah DB_VERSION < 8", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../static/offline/db.js"), "utf8");
  const m = src.match(/const\s+DB_VERSION\s*=\s*(\d+)\s*;/);
  assert.ok(m, "deklarasi DB_VERSION tidak ditemukan");
  assert.ok(Number(m[1]) >= 8, "DB_VERSION diturunkan di bawah 8: " + m[1]);
  assert.match(src, /jangan pernah diturunkan/i);
  assert.match(src, /Revert fitur ≠ turunkan versi/);
});

test("clearAll mengosongkan plugin_records dan plugin_kv", async () => {
  const db = await openDB();
  const tx = db.transaction(["plugin_records", "plugin_kv", "tasks"], "readwrite");
  tx.objectStore("plugin_records").put({ plugin_id: "p", entity: "e", id: "a", scope: "user", data: {}, dirty: 0 });
  tx.objectStore("plugin_kv").put({ plugin_id: "p", scope: "_sync", key: "cursor", value: "1.5.abc" });
  tx.objectStore("tasks").put({ cid: "t-1" });
  await done(tx);
  await clearAll();
  for (const n of ["plugin_records", "plugin_kv", "tasks"]) {
    assert.equal((await dumpStore(db, n)).keys.length, 0, n + " harus kosong");
  }
});
