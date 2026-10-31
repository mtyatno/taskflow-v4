"use strict";
// TF.pluginstate (spec docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md §6.1; rencana PR B Task 7,
// R9–R12): cache status plugin akun di _meta + op outbox plugin_state/set ber-coalescing, pull dengan lebur
// pertama, ackPushed/dropOp, peredaman lokal.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const dbmod = require("../../static/offline/db.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const PS = require("../../static/offline/pluginstate.js");

const ID = "habit-heatmap";
const T0 = "2026-10-20T01:00:00.000Z";
let events;
const origOpenDB = dbmod.openDB;

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

const psOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin_state");
const stateOf = async () => (await metaGet(PS.STATE_KEY)) || {};
const queuedCount = () => events.filter((e) => e.type === "tf:outbox-queued").length;
function fakeFetch(plugins, status) {
  const calls = [];
  const fn = (url) => {
    calls.push(url);
    const st = status || 200;
    return Promise.resolve({ ok: st >= 200 && st < 300, status: st, json: () => Promise.resolve({ v: 1, server_time: T0, plugins }) });
  };
  fn.calls = calls;
  return fn;
}
const srv = (enabled, at) => ({ enabled, settings: {}, updated_at: at || "2026-10-25T00:00:00.000+00:00" });

test("setLocal: entri dirty + satu op; toggle kedua menggabungkan (tetap satu op, qid baru, nilai terakhir)", async () => {
  const q1 = await PS.setLocal(ID, { enabled: true }, { now: () => T0 });
  let ops = await psOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].qid, q1);
  assert.equal(ops[0].op, "set");
  assert.equal(ops[0].cid, ID);
  assert.deepEqual(ops[0].payload, { plugin_id: ID, enabled: true, updated_at: T0 });
  const q2 = await PS.setLocal(ID, { enabled: false }, { now: () => "2026-10-20T01:00:05.000Z" });
  ops = await psOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].qid, q2);
  assert.ok(q2 > q1);
  assert.equal(ops[0].payload.enabled, false);
  assert.equal(ops[0].payload.updated_at, "2026-10-20T01:00:05.000Z");
  assert.ok(!("settings" in ops[0].payload));
  const st = await stateOf();
  assert.equal(st[ID].enabled, false);
  assert.equal(st[ID].dirty, true);
  assert.equal(st[ID].updatedAt, "2026-10-20T01:00:05.000Z");
  assert.equal(queuedCount(), 2);
});

test("setLocal: coalescing menggabungkan field lama (field baru menang)", async () => {
  await PS.setLocal(ID, { settings: { a: 1 } }, { now: () => T0 });
  await PS.setLocal(ID, { enabled: true }, { now: () => "2026-10-20T02:00:00.000Z" });
  const ops = await psOps();
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].payload, { plugin_id: ID, settings: { a: 1 }, enabled: true, updated_at: "2026-10-20T02:00:00.000Z" });
  // op plugin lain tidak tersentuh
  await PS.setLocal("other-plug", { enabled: true });
  assert.equal((await psOps()).length, 2);
});

test("setLocal atomik: _outbox.add gagal → transaksi batal, cache juga tidak berubah", async () => {
  await metaSet(PS.STATE_KEY, { [ID]: { enabled: false, updatedAt: T0 } });
  dbmod.openDB = () => origOpenDB().then((db) => ({
    transaction(stores, mode) {
      const tx = db.transaction(stores, mode);
      const realOS = tx.objectStore.bind(tx);
      tx.objectStore = (name) => {
        const os = realOS(name);
        if (name !== "_outbox") return os;
        return new Proxy(os, {
          get(target, prop) {
            if (prop === "add") return () => { tx.abort(); return {}; };
            const v = target[prop];
            return typeof v === "function" ? v.bind(target) : v;
          },
        });
      };
      return tx;
    },
  }));
  await assert.rejects(PS.setLocal(ID, { enabled: true }));
  dbmod.openDB = origOpenDB;
  assert.deepEqual((await stateOf())[ID], { enabled: false, updatedAt: T0 });
  assert.equal((await psOps()).length, 0);
  assert.equal(queuedCount(), 0);
});

test("pull merge (owner tidak ada): matriks lokal {true,false,tidak ada} × server {true,false,tidak ada}", async () => {
  const LOCAL = { t: true, f: false, n: undefined };
  const SERVER = { t: true, f: false, n: undefined };
  for (const [lk, lv] of Object.entries(LOCAL)) {
    for (const [sk, sv] of Object.entries(SERVER)) {
      dbmod._reset();
      await deleteDB(dbmod.DB_NAME);
      const label = "lokal " + lk + " × server " + sk;
      const localAt = "2026-10-19T0" + Object.keys(LOCAL).indexOf(lk) + ":00:00.000Z";
      if (lv !== undefined) await metaSet(PS.STATE_KEY, { [ID]: { enabled: lv, updatedAt: localAt } });
      const res = await PS.pull(fakeFetch(sv === undefined ? {} : { [ID]: srv(sv) }), { userId: 7 });
      assert.equal(res.mode, "merge", label);
      assert.equal(await metaGet(PS.OWNER_KEY), "7", label);
      const ops = await psOps();
      const st = await stateOf();
      if (lv === true && sv !== true) {
        assert.equal(ops.length, 1, label);
        assert.deepEqual(ops[0].payload, { plugin_id: ID, enabled: true, updated_at: localAt }, label);
        assert.equal(st[ID].enabled, true, label);
        assert.equal(st[ID].updatedAt, localAt, label);
      } else {
        assert.equal(ops.length, 0, label);
        if (sv === undefined) assert.equal(st[ID], undefined, label);
        else assert.deepEqual(st[ID], { enabled: sv, updatedAt: srv(sv).updated_at, settings: {} }, label);
      }
    }
  }
});

test("pull merge: updatedAt tak terbaca → op ber-updated_at epoch", async () => {
  await metaSet(PS.STATE_KEY, { [ID]: { enabled: true, updatedAt: "kemarin" } });
  await PS.pull(fakeFetch({}), { userId: 1 });
  const ops = await psOps();
  assert.equal(ops[0].payload.updated_at, "1970-01-01T00:00:00.000Z");
});

test("pull merge: op tertunda menang (toggle sebelum sinkron pertama)", async () => {
  await PS.setLocal(ID, { enabled: false }, { now: () => T0 });
  const res = await PS.pull(fakeFetch({ [ID]: srv(true) }), { userId: 1 });
  assert.equal(res.mode, "merge");
  const st = await stateOf();
  assert.equal(st[ID].enabled, false);
  const ops = await psOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].payload.enabled, false);
});

test("pull foreign: owner berbeda → op plugin_state lama dibuang, cache = server", async () => {
  await PS.setLocal(ID, { enabled: true });
  await PS.setLocal("lain-plug", { enabled: true });
  await outboxAdd({ entity_type: "task", op: "create", cid: "t1", payload: {} });
  await metaSet(PS.OWNER_KEY, "1");
  const res = await PS.pull(fakeFetch({ "lain-plug": srv(false) }), { userId: 2 });
  assert.equal(res.mode, "foreign");
  assert.equal((await psOps()).length, 0);
  assert.equal((await outboxAll()).length, 1, "op entitas lain tetap");
  const st = await stateOf();
  assert.equal(st[ID], undefined);
  assert.deepEqual(st["lain-plug"], { enabled: false, updatedAt: srv(false).updated_at, settings: {} });
  assert.equal(await metaGet(PS.OWNER_KEY), "2");
});

test("pull normal: tanpa op → adopsi server persis; tidak ada di server → entri dihapus; dengan op → dilewati", async () => {
  await metaSet(PS.OWNER_KEY, "5");
  await metaSet(PS.STATE_KEY, {
    a1x: { enabled: true, updatedAt: T0 },
    b2x: { enabled: true, updatedAt: T0 },
  });
  await PS.setLocal("c3x", { enabled: true }, { now: () => T0 });
  const res = await PS.pull(fakeFetch({ a1x: srv(false), c3x: srv(false) }), { userId: 5 });
  assert.equal(res.mode, "normal");
  const st = await stateOf();
  assert.deepEqual(st.a1x, { enabled: false, updatedAt: srv(false).updated_at, settings: {} });
  assert.equal(st.b2x, undefined);
  assert.equal(st.c3x.enabled, true);
  assert.equal(st.c3x.dirty, true);
  assert.deepEqual(res.changed.slice().sort(), ["a1x", "b2x"]);
  // userId angka vs owner string dianggap sama
  assert.equal((await PS.pull(fakeFetch({}), { userId: "5" })).mode, "normal");
});

test("pull: 404 / 503 → throw, cache tidak berubah", async () => {
  await metaSet(PS.STATE_KEY, { [ID]: { enabled: true, updatedAt: T0 } });
  for (const status of [404, 503]) {
    await assert.rejects(PS.pull(fakeFetch({}, status), { userId: 1 }), (err) => err.status === status && /http/.test(err.message));
  }
  assert.deepEqual(await stateOf(), { [ID]: { enabled: true, updatedAt: T0 } });
  assert.equal(await metaGet(PS.OWNER_KEY), undefined);
  assert.equal((await psOps()).length, 0);
});

test("pull: userId null → tanpa perubahan (tanpa request)", async () => {
  const f = fakeFetch({ [ID]: srv(true) });
  const res = await PS.pull(f, { userId: null });
  assert.deepEqual(res, { changed: [], mode: "normal" });
  assert.equal(f.calls.length, 0);
  assert.equal(await metaGet(PS.OWNER_KEY), undefined);
});

test("pull: known membatasi id", async () => {
  await metaSet(PS.STATE_KEY, { "gone-plug": { enabled: true, updatedAt: T0 } });
  const f = fakeFetch({ [ID]: srv(true), "srv-only": srv(true) });
  await PS.pull(f, { userId: 1, known: [ID] });
  assert.deepEqual(f.calls, ["/api/plugins/state"]);
  const st = await stateOf();
  assert.equal(st[ID].enabled, true);
  assert.equal(st["srv-only"], undefined);
  assert.equal(st["gone-plug"].enabled, true, "id di luar known tidak disentuh");
  assert.equal((await psOps()).length, 0, "tidak ada op untuk plugin yang tidak dikenal");
});

test("ackPushed: tanpa op lain → cache = server, dirty hilang; dengan op lebih baru → cache tetap niat lokal", async () => {
  const q1 = await PS.setLocal(ID, { enabled: true }, { now: () => T0 });
  await PS.ackPushed(q1, ID, srv(true, "2026-10-20T01:00:00.000+00:00"));
  assert.equal((await psOps()).length, 0);
  assert.deepEqual((await stateOf())[ID], { enabled: true, updatedAt: "2026-10-20T01:00:00.000+00:00", settings: {} });

  // Review Focus 1: op ON sedang di-PUT, pengguna mematikan → op OFF baru; ack ON tidak menimpa niat OFF.
  const qOn = await PS.setLocal(ID, { enabled: true }, { now: () => "2026-10-20T03:00:00.000Z" });
  const opOn = (await psOps())[0];
  await PS.setLocal(ID, { enabled: false }, { now: () => "2026-10-20T03:00:01.000Z" });
  // op ON sudah ter-coalesce (qid lama tidak ada); ackPushed atas qid lama tidak menghapus op OFF
  await PS.ackPushed(qOn, ID, srv(true, "2026-10-20T03:00:00.000+00:00"));
  const ops = await psOps();
  assert.equal(ops.length, 1);
  assert.notEqual(ops[0].qid, opOn.qid);
  assert.equal(ops[0].payload.enabled, false);
  const st = await stateOf();
  assert.equal(st[ID].enabled, false);
  assert.equal(st[ID].dirty, true);
});

test("dropOp membersihkan dirty; hasPending", async () => {
  assert.equal(await PS.hasPending(ID), false);
  const q = await PS.setLocal(ID, { enabled: true });
  assert.equal(await PS.hasPending(ID), true);
  assert.equal(await PS.hasPending("lain-plug"), false);
  await PS.dropOp(q, ID);
  assert.equal(await PS.hasPending(ID), false);
  const st = await stateOf();
  assert.equal(st[ID].enabled, true);
  assert.ok(!("dirty" in st[ID]));
});

test("snapshot: state, pending, suppressed, owner dalam satu bacaan", async () => {
  await PS.setLocal(ID, { enabled: true }, { now: () => T0 });
  await PS.suppress("lain-plug", "render", "abcd1234");
  await metaSet(PS.OWNER_KEY, "3");
  const s = await PS.snapshot();
  assert.equal(s.state[ID].enabled, true);
  assert.deepEqual(s.pending, [ID]);
  assert.equal(s.suppressed["lain-plug"].reason, "render");
  assert.equal(s.owner, "3");
});

test("suppress/unsuppress/pruneSuppressed(hash)", async () => {
  await PS.suppress(ID, "render", "h1");
  await PS.suppress("lain-plug", "factory", "h2");
  let s = await PS.suppressed();
  assert.equal(s[ID].reason, "render");
  assert.equal(s[ID].hash, "h1");
  assert.match(s[ID].at, /^\d{4}-\d\d-\d\dT/);
  await PS.unsuppress(ID);
  s = await PS.suppressed();
  assert.equal(s[ID], undefined);
  assert.equal(s["lain-plug"].reason, "factory");
  await PS.suppress(ID, "render", "h1");
  const removed = await PS.pruneSuppressed({ [ID]: "h1", "lain-plug": "h9" });
  assert.deepEqual(removed, ["lain-plug"]);
  s = await PS.suppressed();
  assert.deepEqual(Object.keys(s), [ID]);
  // status akun tidak tersentuh
  assert.deepEqual(await stateOf(), {});
});

test("clearAll → snapshot kosong (default)", async () => {
  await PS.setLocal(ID, { enabled: true });
  await PS.suppress(ID, "render", "h");
  await metaSet(PS.OWNER_KEY, "1");
  await dbmod.clearAll();
  const s = await PS.snapshot();
  assert.deepEqual(s, { state: {}, pending: [], suppressed: {}, owner: null });
});

test("subscribe dipanggil dengan ids yang berubah; event tf:plugin-state terpancar; off melepas", async () => {
  const seen = [];
  const off = PS.subscribe((e) => seen.push(e.ids.slice()));
  await PS.setLocal(ID, { enabled: true });
  await PS.suppress(ID, "render", "h");
  await PS.pull(fakeFetch({ "srv-plug": srv(true) }), { userId: 1 });
  assert.deepEqual(seen[0], [ID]);
  assert.deepEqual(seen[1], [ID]);
  assert.ok(seen[2].includes("srv-plug"));
  const ev = events.filter((e) => e.type === "tf:plugin-state");
  assert.equal(ev.length, 3);
  assert.deepEqual(ev[0].detail.ids, [ID]);
  off();
  await PS.unsuppress(ID);
  assert.equal(seen.length, 3);
  // pendengar yang melempar tidak menggagalkan pengubah
  const off2 = PS.subscribe(() => { throw new Error("x"); });
  await PS.setLocal(ID, { enabled: false });
  off2();
});
