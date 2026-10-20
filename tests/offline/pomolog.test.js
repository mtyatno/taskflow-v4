"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const pomolog = require("../../static/offline/pomolog.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function putTask(rec) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getTask(cid) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function entry(clientId, over) {
  return Object.assign({
    client_id: clientId, kind: "session", pomodoros: 1, focus_seconds: 1500,
    log_date: "2026-10-20", ended_at: "2026-10-20T09:25:00.000Z",
  }, over);
}

test("enqueue adds one pomodoro_log/create op keyed by client_id; a repeat client_id is not added again", async () => {
  assert.equal(await pomolog.enqueue("t1", entry("c1")), true);
  assert.equal(await pomolog.enqueue("t1", entry("c1")), false);
  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].entity_type, "pomodoro_log");
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].cid, "c1");
  assert.deepEqual(ops[0].payload, Object.assign({ task_cid: "t1" }, entry("c1")));
});

test("pendingByTaskCid sums pomodoros per task, ignores other op types", async () => {
  await pomolog.enqueue("t1", entry("c1"));
  await pomolog.enqueue("t1", entry("c2"));
  await pomolog.enqueue("t2", entry("c3", { kind: "overtime", pomodoros: 0 }));
  await outboxAdd({ entity_type: "task", op: "create", cid: "t1", payload: { pomodoros: 9, task_cid: "t1" } });
  const m = await pomolog.pendingByTaskCid();
  assert.equal(m.t1, 2);
  assert.equal(m.t2 || 0, 0);
});

test("pendingByTaskCid counts a cid only once even if it appears in two ops", async () => {
  await pomolog.enqueue("t1", entry("c1"));
  await outboxAdd({ entity_type: "pomodoro_log", op: "create", cid: "c1", payload: Object.assign({ task_cid: "t1" }, entry("c1")) });
  assert.equal((await pomolog.pendingByTaskCid()).t1, 1);
});

test("withPending adds the pending count for the row's cid on top of pomodoros_done", () => {
  assert.equal(pomolog.withPending({ cid: "t1", pomodoros_done: 2 }, { t1: 1 }).pomodoros_done, 3);
  assert.equal(pomolog.withPending({ cid: "t2" }, { t1: 1 }).pomodoros_done, 0);
  assert.equal(pomolog.withPending({ cid: "t2", pomodoros_done: 4 }, {}).pomodoros_done, 4);
});

test("ackPushed sets the server pomodoros_done on the record without touching dirty/rev/base_rev, and removes the op", async () => {
  await putTask({ cid: "t1", server_id: 10, pomodoros_done: 2, dirty: 1, rev: 7, base_rev: "b" });
  await pomolog.enqueue("t1", entry("c1"));
  const [op] = await outboxAll();
  await pomolog.ackPushed(op.qid, "t1", 5);
  const rec = await getTask("t1");
  assert.equal(rec.pomodoros_done, 5);
  assert.equal(rec.dirty, 1);
  assert.equal(rec.rev, 7);
  assert.equal(rec.base_rev, "b");
  assert.equal((await outboxAll()).length, 0);
});

test("ackPushed on a locally deleted (or missing) task still removes the op without error", async () => {
  await putTask({ cid: "t1", server_id: 10, pomodoros_done: 2, deleted: true, dirty: 1 });
  await pomolog.enqueue("t1", entry("c1"));
  await pomolog.enqueue("gone", entry("c2"));
  const ops = await outboxAll();
  await pomolog.ackPushed(ops[0].qid, "t1", 5);
  await pomolog.ackPushed(ops[1].qid, "gone", 5);
  assert.equal((await getTask("t1")).pomodoros_done, 2);
  assert.equal(await getTask("gone"), undefined);
  assert.equal((await outboxAll()).length, 0);
});

test("ackPushed rejects (does not hang) when the transaction aborts; the op stays queued", async () => {
  await putTask({ cid: "t1", server_id: 10, pomodoros_done: 2 });
  await pomolog.enqueue("t1", entry("c1"));
  const [op] = await outboxAll();
  const proto = Object.getPrototypeOf((await openDB()).transaction("tasks", "readonly").objectStore("tasks"));
  const realPut = proto.put;
  proto.put = function () { this.transaction.abort(); };
  let outcome;
  try {
    outcome = await Promise.race([
      pomolog.ackPushed(op.qid, "t1", 5).then(() => "resolved", (e) => "rejected:" + (e && e.message)),
      new Promise((r) => setTimeout(() => r("hang"), 500)),
    ]);
  } finally {
    proto.put = realPut;
  }
  assert.match(outcome, /^rejected:/);
  assert.equal((await outboxAll()).length, 1, "op tetap antre setelah abort");
  assert.equal((await getTask("t1")).pomodoros_done, 2);
});

test("ackPushed rejects on an abort event alone (no bubbling request error)", async () => {
  const dbmod = require("../../static/offline/db.js");
  const realOpen = dbmod.openDB;
  const fakeTx = {
    objectStore: () => ({ get: () => ({}), put: () => {}, delete: () => {} }),
    error: null,
  };
  dbmod.openDB = () => Promise.resolve({ transaction: () => { setTimeout(() => fakeTx.onabort && fakeTx.onabort(), 10); return fakeTx; } });
  let outcome;
  try {
    outcome = await Promise.race([
      pomolog.ackPushed(1, "t1", 5).then(() => "resolved", (e) => "rejected:" + (e && e.message)),
      new Promise((r) => setTimeout(() => r("hang"), 300)),
    ]);
  } finally {
    dbmod.openDB = realOpen;
  }
  assert.equal(outcome, "rejected:aborted");
});

test("index.html loads pomolog.js right after pomologic.js; sw.js caches it", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const a = html.indexOf('<script src="/static/offline/pomologic.js"></script>');
  const b = html.indexOf('<script src="/static/offline/pomolog.js"></script>');
  const c = html.indexOf('<script src="/static/offline/taskroutes.js"></script>');
  assert.ok(a > 0 && b > a && c > b);
  const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
  assert.ok(sw.includes('"/static/offline/pomolog.js"'));
});
