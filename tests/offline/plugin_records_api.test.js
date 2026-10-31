"use strict";
// Sistem plugin Fase 1 PR 1a-2 (rencana Task 8; R17–R20): izin `records`, recordsError, recordPluginIds,
// TF.api.for(id).records = {get, list, put, remove, onChange, newId}.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const dbmod = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const PS = require("../../static/offline/plugin_sync.js");
const RT = require("../../static/plugin-runtime.js");
const build = require(path.join(__dirname, "..", "..", "compile.js"));
const V = require("../fixtures/plugin_records_vectors.json");
const P = RT.plugins;
const { PluginStorageError, PluginPermissionError } = RT.api;

const REC = {
  id: "demo-records", name: "Demo Records", version: "1.0.0", minApi: 1, defaultEnabled: true,
  slots: ["taskList.views"], permissions: ["records"], records: { note: { conflict: "lww", maxBytes: 4096 }, tag: { conflict: "lww" } },
  files: ["plugin.js"], hash: "r1",
};
const EXT = {
  id: "demo-ext", name: "Demo Ext", version: "1.0.0", minApi: 1, defaultEnabled: true,
  slots: ["taskList.views"], permissions: ["task.ext"], taskExt: { keys: ["note"] }, files: ["plugin.js"], hash: "e1",
};
const HEAT = { id: "habit-heatmap", name: "Heat", version: "1.0.0", minApi: 1, defaultEnabled: false, slots: ["dashboard.widgets"], permissions: ["storage"], files: ["plugin.js"], hash: "h1" };
const OFFREC = Object.assign({}, REC, { id: "off-records", defaultEnabled: false });
const INDEX = { v: 1, plugins: [REC, EXT, HEAT, OFFREC] };

const origOpenDB = dbmod.openDB;
let winEvents;
let origDispatch;

beforeEach(async () => {
  P._reset();
  dbmod.openDB = origOpenDB;
  dbmod._reset();
  await deleteDB(dbmod.DB_NAME);
  await P.init({ fetchIndex: () => Promise.resolve(INDEX) });
  winEvents = [];
  origDispatch = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (ev) => { winEvents.push(ev); return true; };
});
afterEach(() => {
  dbmod.openDB = origOpenDB;
  if (origDispatch === undefined) delete globalThis.dispatchEvent; else globalThis.dispatchEvent = origDispatch;
});

const rec = (id) => RT.api.for(id || "demo-records").records;
const pluginOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin");
const rawAll = (store) => dbmod.openDB().then((d) => new Promise((res, rej) => {
  const r = d.transaction(store, "readonly").objectStore(store).getAll();
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
const base = (over) => Object.assign({ id: "demo-records", name: "Demo", version: "1.0.0", minApi: 1, slots: [], permissions: ["records"] }, over || {});

test("validateManifest: records diterima dengan izin records; vektor manifests (sisi runtime) sama dengan compile.js", () => {
  assert.ok(P.KNOWN_PERMISSIONS.includes("records"));
  assert.ok(!P.RESERVED_PERMISSIONS.includes("records"));
  assert.ok(V.manifests.length > 20);
  assert.ok(V.manifests.some((v) => v.name === "maxBytes null"), "vektor maxBytes null terkunci");
  assert.deepEqual(P.validateManifest(base({ records: REC.records }), INDEX), { ok: true, reason: null });
  for (const v of V.manifests) {
    const m = base({ permissions: v.permissions });
    if (v.records !== null) m.records = v.records;
    const got = P.recordsError(m);
    const want = build.validateRecords(m);
    assert.equal(got, want, v.name + ": pesan identik dengan compile.js");
    if (v.error === null) assert.equal(got, null, v.name);
    else assert.ok(typeof got === "string" && got.startsWith(v.error), v.name + ": " + got);
    // lewat validateManifest: izin tak dikenal sudah ditolak lebih dulu, sisanya alasan records
    const r = P.validateManifest(m, INDEX);
    if (v.error === null) assert.equal(r.ok, true, v.name + ": " + r.reason);
    else {
      assert.equal(r.ok, false, v.name);
      assert.ok(r.reason.startsWith(v.error), v.name + ": " + r.reason);
    }
  }
  assert.equal(P.validateManifest(base({ permissions: ["records"] }), INDEX).reason, "izin records butuh manifest.records");
});

test("recordPluginIds: hanya plugin ON berizin records", async () => {
  assert.deepEqual(P.recordPluginIds(), ["demo-records"]);
  await P.setEnabled("off-records", true);
  assert.deepEqual(P.recordPluginIds(), ["demo-records", "off-records"]);
  await P.setEnabled("demo-records", false);
  assert.deepEqual(P.recordPluginIds(), ["off-records"]);
  P._reset();
  assert.deepEqual(P.recordPluginIds(), [], "indeks belum dimuat → []");
});

test("put/get/list/remove lewat api.for('demo-records').records → bentuk publik {entity,id,scope,data,updated_at,version,pending}", async () => {
  const r = await rec().put("note", "n1", { t: "halo" });
  assert.deepEqual(Object.keys(r).sort(), ["data", "entity", "id", "pending", "scope", "updated_at", "version"]);
  assert.equal(r.entity, "note");
  assert.equal(r.id, "n1");
  assert.equal(r.scope, "user");
  assert.deepEqual(r.data, { t: "halo" });
  assert.equal(r.version, null);
  assert.equal(r.pending, true);
  assert.ok(!isNaN(Date.parse(r.updated_at)));
  assert.ok(!("dirty" in r) && !("op_qid" in r) && !("plugin_id" in r) && !("deleted" in r));
  const g = await rec().get("note", "n1");
  assert.deepEqual(g, r);
  g.data.t = "diubah";
  assert.deepEqual((await rec().get("note", "n1")).data, { t: "halo" }, "salinan");
  await rec().put("note", "n2", { t: "dua" }, { scope: "list:5" });
  const all = await rec().list("note");
  assert.deepEqual(all.items.map((x) => x.id), ["n1", "n2"]);
  assert.equal(all.next, null);
  const sc = await rec().list("note", { scope: "list:5" });
  assert.deepEqual(sc.items.map((x) => x.id), ["n2"]);
  const pg = await rec().list("note", { limit: 1 });
  assert.equal(pg.items.length, 1);
  assert.equal(pg.next, "n1");
  assert.deepEqual((await rec().list("note", { limit: 1, after: pg.next })).items.map((x) => x.id), ["n2"]);
  assert.equal(await rec().remove("note", "n1"), true);
  assert.equal(await rec().get("note", "n1"), null);
  assert.equal(await rec().remove("note", "n1"), false);
  assert.equal(await rec().get("note", "tak-ada"), null);
  assert.equal((await pluginOps()).length, 2, "satu op per record");
});

test("put id null → id uuid; newId unik", async () => {
  const r = await rec().put("note", null, { a: 1 });
  assert.ok(/^[A-Za-z0-9:@._-]{1,80}$/.test(r.id));
  assert.ok(r.id.length >= 8);
  assert.ok(await rec().get("note", r.id));
  const a = rec().newId();
  const b = rec().newId();
  assert.equal(typeof a, "string");
  assert.notEqual(a, b);
  assert.ok(!(rec("demo-ext").newId === undefined), "newId selalu ada, tanpa izin pun");
});

test("entitas tidak dideklarasikan / data terlalu besar (> 4096) / scope list:abc → PluginStorageError tanpa menulis", async () => {
  const bad = [
    () => rec().put("nope", "x", { a: 1 }),
    () => rec().get("nope", "x"),
    () => rec().list("nope"),
    () => rec().remove("nope", "x"),
    () => rec().put("note", "x", { s: "a".repeat(5000) }),
    () => rec().put("note", "x", { a: 1 }, { scope: "list:abc" }),
    () => rec().put("note", "x", { a: 1 }, { scope: "project:1" }),
    () => rec().put("note", "bad id!", { a: 1 }),
    () => rec().put("Bad", "x", { a: 1 }),
    () => rec().list("note", { limit: 0 }),
    () => rec().list("note", { limit: 1001 }),
    () => rec().put("note", "x", { r: { $task: true } }),
  ];
  for (const f of bad) {
    await assert.rejects(f(), (e) => {
      assert.ok(e instanceof PluginStorageError, String(e && e.message));
      assert.equal(e.name, "PluginStorageError");
      return true;
    });
  }
  const big = await rec().put("note", "x", { s: "a".repeat(5000) }).catch((e) => e);
  assert.equal(big.code, "TOO_LARGE");
  const sc = await rec().put("note", "x", { a: 1 }, { scope: "list:abc" }).catch((e) => e);
  assert.equal(sc.code, "INVALID");
  assert.equal(sc.detail, "scope");
  assert.equal((await rawAll("plugin_records")).length, 0);
  assert.equal((await pluginOps()).length, 0);
  assert.equal(P.failures("demo-records").length, 0, "salah pakai bukan kegagalan plugin");
  // maxBytes tidak diset (tag) → batas 65536; deklarasi maxBytes diteruskan ke pluginsync.put
  assert.ok(await rec().put("tag", "t", { s: "a".repeat(5000) }));
  // SCOPE_IMMUTABLE
  await rec().put("note", "n1", { a: 1 }, { scope: "user" });
  const im = await rec().put("note", "n1", { a: 2 }, { scope: "list:3" }).catch((e) => e);
  assert.ok(im instanceof PluginStorageError);
  assert.equal(im.code, "SCOPE_IMMUTABLE");
});

test("tanpa izin records (demo-ext) → PluginPermissionError untuk semua fungsi, failures bertambah", async () => {
  const r = rec("demo-ext");
  const calls = [
    () => r.get("note", "x"),
    () => r.list("note"),
    () => r.put("note", "x", {}),
    () => r.remove("note", "x"),
    () => r.onChange(() => {}),
  ];
  let n = 0;
  for (const f of calls) {
    let err;
    try { await f(); } catch (e) { err = e; }
    assert.ok(err instanceof PluginPermissionError, "fungsi " + n);
    n += 1;
    assert.equal(P.failures("demo-ext").length >= 1, true);
  }
  assert.ok(P.failures("demo-ext").length >= 1);
  assert.equal((await rawAll("plugin_records")).length, 0);
  assert.ok(typeof rec("habit-heatmap").newId === "function");
});

test("onChange: local dari put, sync dari pull (pluginsync memancarkan), lost diteruskan; peristiwa plugin lain tidak sampai; pendengar error dihitung", async () => {
  const got = [];
  const off = rec().onChange((ev) => got.push(ev));
  await rec().put("note", "n1", { a: 1 });
  assert.deepEqual(got, [{ entity: "note", ids: ["n1"], source: "local" }]);
  PS._internals.emit({ pluginId: "demo-records", entity: "note", ids: ["n2", "n3"], source: "sync" });
  PS._internals.emit({ pluginId: "demo-records", entity: "note", ids: ["n1"], source: "sync", lost: ["n1"] });
  assert.deepEqual(got[1], { entity: "note", ids: ["n2", "n3"], source: "sync" });
  assert.deepEqual(got[2], { entity: "note", ids: ["n1"], source: "sync", lost: ["n1"] });
  PS._internals.emit({ pluginId: "off-records", entity: "note", ids: ["z"], source: "sync" });
  assert.equal(got.length, 3, "plugin lain tidak sampai");
  got[1].ids.push("zzz");
  const other = [];
  const off2 = rec().onChange((ev) => other.push(ev));
  PS._internals.emit({ pluginId: "demo-records", entity: "note", ids: ["q"], source: "sync" });
  assert.deepEqual(other[0].ids, ["q"]);
  off(); off();
  PS._internals.emit({ pluginId: "demo-records", entity: "note", ids: ["r"], source: "sync" });
  assert.equal(got.length, 4, "off idempoten dan menghentikan (4 = termasuk peristiwa q sebelum off)");
  assert.equal(other.length, 2, "pendengar lain tidak ikut berhenti");
  off2();
  assert.equal(P.failures("demo-records").length, 0);
  // pendengar yang melempar / promise reject → markFailed("listener")
  const off3 = rec().onChange(() => { throw new Error("boom"); });
  PS._internals.emit({ pluginId: "demo-records", entity: "note", ids: ["s"], source: "sync" });
  assert.equal(P.failures("demo-records").filter((f) => f.kind === "listener").length, 1);
  off3();
  const off4 = rec().onChange(() => Promise.reject(new Error("async-boom")));
  PS._internals.emit({ pluginId: "demo-records", entity: "note", ids: ["s"], source: "sync" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(P.failures("demo-records").filter((f) => f.kind === "listener").length, 2);
  off4();
  assert.throws(() => rec().onChange("bukan fungsi"), TypeError);
});

test("tombstone dan record plugin lain tidak pernah dikembalikan", async () => {
  await rec().put("note", "n1", { a: 1 });
  await rec().put("note", "n2", { a: 2 });
  await PS.put("off-records", "note", "n1", { x: 9 });
  await PS.put("demo-ext", "note", "n9", { x: 9 });
  assert.equal(await rec().remove("note", "n1"), true);
  assert.equal(await rec().get("note", "n1"), null);
  assert.deepEqual((await rec().list("note")).items.map((x) => x.id), ["n2"]);
  assert.deepEqual((await rec("off-records").list("note")).items.map((x) => x.id), ["n1"]);
  assert.deepEqual((await rec().list("note")).items.map((x) => x.data), [{ a: 2 }]);
  assert.equal(await rec().get("note", "n9"), null);
  // bangkit kembali setelah tombstone
  const r = await rec().put("note", "n1", { a: 3 });
  assert.deepEqual((await rec().get("note", "n1")).data, { a: 3 });
  assert.equal(r.pending, true);
});
