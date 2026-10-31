"use strict";
// syncpush cabang plugin_state/set (spec docs/superpowers/specs/2026-10-31-plugin-fase0b-design.md §6.2; rencana
// PR B Task 8, R9): PUT /api/plugins/state/<id>; 2xx → ackPushed; 404 PLUGIN_UNKNOWN → dropOp; 404 lain tetap
// (jendela deploy); 4xx lain → dropOp + failed; 401/429/5xx/jaringan → perilaku send yang ada.
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { metaGet } = require("../../static/offline/meta.js");
const PS = require("../../static/offline/pluginstate.js");
const { pushOutbox, pendingCreateCids } = require("../../static/offline/syncpush.js");

const ID = "habit-heatmap";
const T0 = "2026-10-20T01:00:00.000Z";

beforeEach(async () => {
  _reset();
  await deleteDB(DB_NAME);
  globalThis.dispatchEvent = () => true;
});
afterEach(() => { delete globalThis.dispatchEvent; });

function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve(handler(method, path, body)).then((h) => {
        if (h === "NETWORK") throw new Error("net");
        if (h === "TIMEOUT") { const e = new Error("abort"); e.name = "AbortError"; throw e; }
        return h;
      });
    },
  };
}
const psOps = async () => (await outboxAll()).filter((o) => o.entity_type === "plugin_state");
const stateOf = async () => (await metaGet(PS.STATE_KEY)) || {};
const serverOk = (body) => ({ status: 200, data: { applied: true, state: { enabled: body.enabled, settings: {}, updated_at: "2026-10-20T01:00:00.000+00:00" } } });

test("PUT ke /api/plugins/state/<id> dengan payload op; 2xx → ack (op hilang, cache = state server), pushed 1", async () => {
  await PS.setLocal(ID, { enabled: true }, { now: () => T0 });
  const tr = fakeTransport((m, p, b) => serverOk(b));
  const r = await pushOutbox(tr);
  assert.deepEqual(tr.calls, [{ method: "PUT", path: "/api/plugins/state/habit-heatmap", body: { plugin_id: ID, enabled: true, updated_at: T0 } }]);
  assert.equal(r.pushed, 1);
  assert.equal(r.failed, 0);
  assert.equal(r.remaining, 0);
  assert.deepEqual((await stateOf())[ID], { enabled: true, updatedAt: "2026-10-20T01:00:00.000+00:00", settings: {} });
});

test("401 menghentikan drain, op tetap", async () => {
  await PS.setLocal(ID, { enabled: true });
  await PS.setLocal("lain-plug", { enabled: true });
  const tr = fakeTransport(() => ({ status: 401, data: {} }));
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal(r.authExpired, true);
  assert.equal((await psOps()).length, 2);
});

test("503/500 → op tetap, op lain tetap dikirim", async () => {
  await PS.setLocal(ID, { enabled: true });
  await PS.setLocal("lain-plug", { enabled: true });
  for (const status of [503, 500]) {
    const tr = fakeTransport((m, p, b) => (p.endsWith(ID) ? { status, data: { detail: { code: "PLUGIN_UNAVAILABLE" } } } : serverOk(b)));
    await pushOutbox(tr);
    assert.equal(tr.calls.length, status === 503 ? 2 : 1);
    const ops = await psOps();
    assert.deepEqual(ops.map((o) => o.cid), [ID]);
    assert.equal((await stateOf())[ID].dirty, true);
  }
});

test("timeout/jaringan → op tetap", async () => {
  await PS.setLocal(ID, { enabled: true });
  for (const kind of ["NETWORK", "TIMEOUT"]) {
    await pushOutbox(fakeTransport(() => kind));
    assert.equal((await psOps()).length, 1, kind);
  }
});

test("404 PLUGIN_UNKNOWN → op dibuang tanpa failed", async () => {
  await PS.setLocal(ID, { enabled: true });
  const r = await pushOutbox(fakeTransport(() => ({ status: 404, data: { detail: { code: "PLUGIN_UNKNOWN" } } })));
  assert.equal(r.failed, 0);
  assert.equal((await psOps()).length, 0);
  const st = await stateOf();
  assert.equal(st[ID].enabled, true);
  assert.ok(!("dirty" in st[ID]));
});

test("404 tanpa kode (jendela deploy) → op tetap, failed 0", async () => {
  await PS.setLocal(ID, { enabled: true });
  const r = await pushOutbox(fakeTransport(() => ({ status: 404, data: { detail: "Not Found" } })));
  assert.equal(r.failed, 0);
  assert.equal((await psOps()).length, 1);
});

test("422/403 → op dibuang, failed 1, dirty bersih", async () => {
  for (const status of [422, 403, 400]) {
    await PS.setLocal(ID, { enabled: true });
    const r = await pushOutbox(fakeTransport(() => ({ status, data: { detail: { code: "PLUGIN_FORBIDDEN_TOKEN" } } })));
    assert.equal(r.failed, 1, String(status));
    assert.equal((await psOps()).length, 0, String(status));
    assert.ok(!("dirty" in (await stateOf())[ID]), String(status));
  }
});

test("op yang sudah di-coalesce di tengah drain dilewati", async () => {
  await PS.setLocal("lain-plug", { enabled: true });
  await PS.setLocal(ID, { enabled: true });
  let release;
  const gate = new Promise((res) => { release = res; });
  const tr = fakeTransport((m, p, b) => {
    if (p.endsWith("lain-plug")) {
      // pengguna mematikan habit-heatmap saat PUT lain-plug sedang berjalan
      return PS.setLocal(ID, { enabled: false }).then(() => gate).then(() => serverOk(b));
    }
    return serverOk(b);
  });
  const p1 = pushOutbox(tr);
  setTimeout(release, 10);
  await p1;
  assert.deepEqual(tr.calls.map((c) => c.path), ["/api/plugins/state/lain-plug"]);
  assert.equal((await stateOf())[ID].enabled, false);
  await pushOutbox(tr);
  const idCalls = tr.calls.filter((c) => c.path.endsWith(ID));
  assert.equal(idCalls.length, 1);
  assert.equal(idCalls[0].body.enabled, false);
  assert.equal((await psOps()).length, 0);
  assert.equal((await stateOf())[ID].enabled, false);
});

test("op plugin_state tidak menahan/dihitung sebagai create induk", async () => {
  await PS.setLocal(ID, { enabled: true });
  await outboxAdd({ entity_type: "task", op: "create", cid: "t1", payload: {} });
  const set = pendingCreateCids(await outboxAll());
  assert.ok(!set.has(ID));
  assert.ok(set.has("t1"));
});
