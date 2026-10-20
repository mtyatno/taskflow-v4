"use strict";
// Kanban tahap kustom (frontend) Task 1 — cache context (tahap) offline + route lokal GET/POST /api/contexts.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { metaGet, metaSet } = require("../../static/offline/meta.js");
const CC = require("../../static/offline/contextcache.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { outboxAll } = require("../../static/offline/outbox.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const FULL_PATH = "/api/contexts?format=full&scope=all&include_archived=1";

function httpRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}
function ctx(over) {
  return Object.assign({
    id: 1, name: "C", list_id: null, user_id: 1, position: 0, color: null, archived: 0, can_manage: true,
  }, over);
}
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
    priority: "P3", quadrant: "Q4", project: "", project_id: null, context: "", context_id: null,
    deadline: null, waiting_for: "", assigned_to: null, progress: 0, parent_cid: null, list_id: null,
    recurrence_type: null, recurrence_days: null, deleted: false, dirty: 0,
  }, over);
}
async function seedCache(items) { await metaSet("contexts:v1", { at: 1, items }); }
const ids = (items) => items.map((i) => i.id);

// ── konstanta ────────────────────────────────────────────────────────────────────────────────
test("exports the documented keys and full path", () => {
  assert.equal(CC.KEY, "contexts:v1");
  assert.equal(CC.PENDING_KEY, "contexts:pending:v1");
  assert.equal(CC.FULL_PATH, FULL_PATH);
});

// ── refresh ──────────────────────────────────────────────────────────────────────────────────
test("refresh stores items and keeps old cache on failure", async () => {
  const calls = [];
  const items = [ctx({ id: 1, name: "Alpha" }), ctx({ id: 2, name: "Beta", list_id: 5 })];
  await CC.refresh((u) => { calls.push(u); return Promise.resolve(httpRes(200, items)); });
  assert.deepEqual(calls, [FULL_PATH]);
  const v = await metaGet("contexts:v1");
  assert.equal(typeof v.at, "number");
  assert.deepEqual(v.items, items);

  await assert.rejects(CC.refresh(() => Promise.resolve(httpRes(503, { detail: "OFFLINE" }))));
  await assert.rejects(CC.refresh(() => Promise.resolve(httpRes(200, { detail: "weird" }))));
  await assert.rejects(CC.refresh(() => Promise.reject(new Error("net"))));
  assert.deepEqual((await metaGet("contexts:v1")).items, items);
});

test("refresh keeps pending entries", async () => {
  const { item } = await CC.addPending(null, "Desain");
  assert.equal(item.pending, true);
  await CC.refresh(() => Promise.resolve(httpRes(200, [ctx({ id: 1, name: "Alpha" })])));
  const all = await CC.allItems();
  assert.deepEqual(all.map((i) => i.name).sort(), ["Alpha", "Desain"]);
  assert.equal(all.find((i) => i.name === "Desain").pending, true);
  assert.equal((await metaGet("contexts:pending:v1")).items.length, 1);
});

// ── sortItems / list ─────────────────────────────────────────────────────────────────────────
test("sortItems orders by position, then NOCASE name, then String(id) and does not mutate", () => {
  const input = [
    ctx({ id: 9, name: "b", position: 1 }),
    ctx({ id: 3, name: "B", position: 1 }),
    ctx({ id: 4, name: "a", position: 1 }),
    ctx({ id: 2, name: "z", position: 0 }),
    ctx({ id: 10, name: "b", position: 1 }),
  ];
  const copy = input.slice();
  assert.deepEqual(ids(CC.sortItems(input)), [2, 4, 10, 3, 9]); // "10" < "3" < "9" as strings
  assert.deepEqual(input, copy);
});

test("list orders by position then name; archived only with includeArchived; pending included", async () => {
  await seedCache([
    ctx({ id: 1, name: "Two", position: 2 }),
    ctx({ id: 2, name: "Zero", position: 0 }),
    ctx({ id: 3, name: "One", position: 1 }),
    ctx({ id: 4, name: "Old", position: 4, archived: 1 }),
    ctx({ id: 5, name: "W", position: 0, list_id: 7 }),
  ]);
  // pending di scope pribadi dengan posisi di akhir: max(0..4)+1 = 5 → tetap terakhir; paksa posisi 3 lewat meta
  await metaSet("contexts:pending:v1", { items: [
    { id: "c-1", cid: "c-1", name: "Pend", list_id: null, user_id: null, position: 3, color: null, archived: false, can_manage: true, pending: true },
  ] });
  assert.deepEqual(ids(await CC.list(null)), [2, 3, 1, "c-1"]);
  assert.deepEqual(ids(await CC.list(null, { includeArchived: true })), [2, 3, 1, "c-1", 4]);
  assert.deepEqual(ids(await CC.list(7)), [5]);
  assert.deepEqual(ids(await CC.list("7")), [5], "list_id from a query string is a string");
});

// ── names ────────────────────────────────────────────────────────────────────────────────────
test("names falls back to task contexts in scope", async () => {
  const W = 7;
  await put("tasks", [
    task({ cid: "a", context: "@home" }),
    task({ cid: "b", context: "@kantor", list_id: W }),
  ]);
  assert.deepEqual(await CC.names(null), ["@home"]);
  assert.deepEqual(await CC.names(W), ["@kantor"]);
});

test("names: cache names by position first, then unseen task names NOCASE-sorted; archived hidden", async () => {
  await seedCache([
    ctx({ id: 1, name: "Zebra", position: 0 }),
    ctx({ id: 2, name: "Alpha", position: 1 }),
    ctx({ id: 3, name: "Old", position: 2, archived: 1 }),
    ctx({ id: 4, name: "Ws", position: 0, list_id: 7 }),
  ]);
  await put("tasks", [
    task({ cid: "a", context: "alpha" }),   // sudah ada (NOCASE)
    task({ cid: "b", context: "mango" }),
    task({ cid: "c", context: "Banana" }),
    task({ cid: "d", context: "BANANA" }),  // dup antar nama task
    task({ cid: "e", context: "x", list_id: 7 }),
    task({ cid: "f", context: "gone", deleted: true }),
    task({ cid: "g", context: "fin", gtd_status: "done" }),
  ]);
  await CC.addPending(null, "Pend");
  assert.deepEqual(await CC.names(null), ["Zebra", "Alpha", "Pend", "Banana", "mango"]);
  assert.deepEqual(await CC.names(7), ["Ws", "x"]);
});

// ── findId ───────────────────────────────────────────────────────────────────────────────────
test("findId is NOCASE, scope-aware and includes archived and pending items", () => {
  const items = [
    ctx({ id: 1, name: "Alpha" }),
    ctx({ id: 2, name: "Old", archived: 1 }),
    ctx({ id: 3, name: "Alpha", list_id: 7 }),
    { id: "c-1", cid: "c-1", name: "Pend", list_id: null, pending: true },
  ];
  assert.equal(CC.findId(items, null, "ALPHA"), 1);
  assert.equal(CC.findId(items, 7, "alpha"), 3);
  assert.equal(CC.findId(items, "7", "alpha"), 3);
  assert.equal(CC.findId(items, 8, "alpha"), null);
  assert.equal(CC.findId(items, null, "old"), 2);
  assert.equal(CC.findId(items, null, "pend"), "c-1");
  assert.equal(CC.findId(items, null, ""), null);
  assert.equal(CC.findId(items, null, null), null);
  assert.equal(CC.findId(null, null, "x"), null);
});

// ── addPending ───────────────────────────────────────────────────────────────────────────────
test("addPending creates a pending item with a cid and the documented shape", async () => {
  const { item, created } = await CC.addPending(null, "  Desain  ");
  assert.equal(created, true);
  assert.equal(item.name, "Desain");
  assert.equal(typeof item.cid, "string");
  assert.ok(item.cid.length > 0);
  assert.deepEqual(item, {
    id: item.cid, cid: item.cid, name: "Desain", list_id: null, user_id: null, position: 0,
    color: null, archived: false, can_manage: true, pending: true,
  });
  assert.deepEqual(await CC.pendingByCid(item.cid), item);
  assert.equal(await CC.pendingByCid("nope"), null);
});

test("addPending reuses an existing item (NOCASE, incl archived and pending) in the same scope only", async () => {
  await seedCache([
    ctx({ id: 1, name: "Alpha" }),
    ctx({ id: 2, name: "Old", archived: 1 }),
    ctx({ id: 3, name: "Beta", list_id: 7 }),
  ]);
  const a = await CC.addPending(null, " ALPHA ");
  assert.equal(a.created, false);
  assert.equal(a.item.id, 1);
  const o = await CC.addPending(null, "old");
  assert.equal(o.created, false);
  assert.equal(o.item.id, 2);
  const diff = await CC.addPending(null, "Beta"); // Beta ada di scope 7, bukan pribadi
  assert.equal(diff.created, true);
  const first = await CC.addPending(null, "Desain");
  const again = await CC.addPending(null, "desain");
  assert.equal(again.created, false);
  assert.equal(again.item.cid, first.item.cid);
  assert.equal((await metaGet("contexts:pending:v1")).items.length, 2); // Beta (pribadi) + Desain
});

test("addPending appends at max position + 1 per scope (0 when scope is empty)", async () => {
  await seedCache([
    ctx({ id: 1, name: "A", position: 0 }),
    ctx({ id: 2, name: "B", position: 4, archived: 1 }),
    ctx({ id: 3, name: "W", position: 9, list_id: 7 }),
  ]);
  assert.equal((await CC.addPending(null, "N1")).item.position, 5);
  assert.equal((await CC.addPending(null, "N2")).item.position, 6);
  assert.equal((await CC.addPending(7, "W2")).item.position, 10);
  assert.equal((await CC.addPending(8, "Empty")).item.position, 0);
});

test("addPending with an empty or blank name rejects", async () => {
  await assert.rejects(CC.addPending(null, "  "), { message: "Nama tahap tidak boleh kosong" });
  await assert.rejects(CC.addPending(null, ""), { message: "Nama tahap tidak boleh kosong" });
  await assert.rejects(CC.addPending(null, null), { message: "Nama tahap tidak boleh kosong" });
  assert.equal(await metaGet("contexts:pending:v1"), undefined);
});

test("concurrent addPending calls do not lose entries", async () => {
  const res = await Promise.all([CC.addPending(null, "A"), CC.addPending(null, "B"), CC.addPending(null, "a")]);
  assert.deepEqual(res.map((r) => r.created), [true, true, false]);
  assert.deepEqual((await CC.allItems()).map((i) => i.name).sort(), ["A", "B"]);
});

// ── resolvePending / dropPending ─────────────────────────────────────────────────────────────
test("resolvePending swaps pending for server item", async () => {
  await seedCache([ctx({ id: 1, name: "Alpha" })]);
  const { item } = await CC.addPending(null, "Desain");
  await CC.resolvePending(item.cid, ctx({ id: 42, name: "Desain", position: 1 }));
  assert.equal(await CC.pendingByCid(item.cid), null);
  const all = await CC.allItems();
  assert.deepEqual(ids(all), [1, 42]);
  assert.equal(all.some((i) => i.pending), false);
  // upsert berdasarkan id: server item yang sama menimpa, tidak menggandakan
  await CC.resolvePending("none", ctx({ id: 42, name: "Desain2", position: 1 }));
  const again = await CC.allItems();
  assert.deepEqual(ids(again), [1, 42]);
  assert.equal(again.find((i) => i.id === 42).name, "Desain2");
});

test("resolvePending works with an empty cache and keeps other pending entries", async () => {
  const a = await CC.addPending(null, "A");
  const b = await CC.addPending(null, "B");
  await CC.resolvePending(a.item.cid, ctx({ id: 7, name: "A" }));
  assert.deepEqual((await CC.allItems()).map((i) => i.name).sort(), ["A", "B"]);
  assert.equal((await CC.pendingByCid(b.item.cid)).name, "B");
});

test("dropPending removes only that entry", async () => {
  const a = await CC.addPending(null, "A");
  const b = await CC.addPending(null, "B");
  await CC.dropPending(a.item.cid);
  assert.equal(await CC.pendingByCid(a.item.cid), null);
  assert.equal((await CC.pendingByCid(b.item.cid)).name, "B");
  await CC.dropPending("unknown");
  assert.deepEqual((await CC.allItems()).map((i) => i.name), ["B"]);
});

// ── refNameOf / payloadContextId (F1) ────────────────────────────────────────────────────────
test("refNameOf mirrors projectcache rules for context fields", () => {
  assert.equal(CC.refNameOf(null), null);
  assert.equal(CC.refNameOf({ context: "x", context_id: null }), null);
  assert.equal(CC.refNameOf({ context: "x", context_id: 5, context_ref_name: "Old" }), "Old");
  assert.equal(CC.refNameOf({ context: "x", context_id: 5 }), "x");
  assert.equal(CC.refNameOf({ context_id: 5 }), "");
});

test("payloadContextId follows F1 and drops cids", () => {
  const items = [
    ctx({ id: 5, name: "Bar" }), ctx({ id: 7, name: "Baz" }), ctx({ id: 8, name: "Qux", list_id: 3 }),
    { id: "c-9", cid: "c-9", name: "Pend", list_id: null, pending: true },
  ];
  // teks sama dengan ref (NOCASE) → id record apa adanya, walau cache sudah rename / hapus
  const same = { context: "foo", context_id: 5, context_ref_name: "Foo", list_id: null };
  assert.equal(CC.payloadContextId(same, items), 5);
  assert.equal(CC.payloadContextId(same, []), 5);
  assert.equal(CC.payloadContextId({ context: "Foo", context_id: 5, list_id: null }, items), 5, "legacy: text is the ref");
  // id ada di cache tapi di scope lain → null
  assert.equal(CC.payloadContextId({ context: "Qux", context_id: 8, context_ref_name: "Qux", list_id: null }, items), null);
  // teks beda → findId di scope record
  assert.equal(CC.payloadContextId({ context: "baz", context_id: 5, context_ref_name: "Foo", list_id: null }, items), 7);
  assert.equal(CC.payloadContextId({ context: "Brand new", context_id: 5, context_ref_name: "Foo", list_id: null }, items), null);
  assert.equal(CC.payloadContextId({ context: "Qux", context_id: 5, context_ref_name: "Foo", list_id: null }, items), null, "id in another scope");
  assert.equal(CC.payloadContextId({ context: "Qux", context_id: 5, context_ref_name: "Foo", list_id: 3 }, items), 8);
  // context_id berupa cid → null; hasil findId yang berupa cid pending → null
  assert.equal(CC.payloadContextId({ context: "Foo", context_id: "c-9", context_ref_name: "Foo", list_id: null }, items), null);
  assert.equal(CC.payloadContextId({ context: "pend", context_id: 5, context_ref_name: "Foo", list_id: null }, items), null);
  // tanpa id / tanpa cache → null
  assert.equal(CC.payloadContextId({ context: "Foo", context_id: null, list_id: null }, items), null);
  assert.equal(CC.payloadContextId(same, null), null);
  assert.equal(CC.payloadContextId(null, items), null);
});

// ── route lokal ──────────────────────────────────────────────────────────────────────────────
test("local GET /api/contexts: no query → names; ?format=full&list_id=7 only scope 7", async () => {
  await seedCache([
    ctx({ id: 1, name: "Pers", position: 1 }),
    ctx({ id: 2, name: "Arch", position: 0, archived: 1 }),
    ctx({ id: 3, name: "Ws", list_id: 7 }),
    ctx({ id: 4, name: "Ws2", list_id: 7, position: 1 }),
    ctx({ id: 5, name: "Other", list_id: 8 }),
  ]);
  await put("tasks", [task({ cid: "a", context: "@home" }), task({ cid: "b", context: "@kantor", list_id: 7 })]);
  const R = buildTaskRouter();
  assert.deepEqual(await R.dispatch("GET", "/api/contexts", undefined), ["Pers", "@home"]);
  assert.deepEqual(await R.dispatch("GET", "/api/contexts?list_id=7", undefined), ["Ws", "Ws2", "@kantor"]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full", undefined)), [1]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&include_archived=1", undefined)), [2, 1]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&include_archived=true", undefined)), [2, 1]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&list_id=7", undefined)), [3, 4]);
});

test("local GET /api/contexts?format=full&scope=all: personal first, then per list_id, each sorted", async () => {
  await seedCache([
    ctx({ id: 1, name: "W8", list_id: 8, position: 0 }),
    ctx({ id: 2, name: "W7b", list_id: 7, position: 1 }),
    ctx({ id: 3, name: "P1", position: 1 }),
    ctx({ id: 4, name: "W7a", list_id: 7, position: 0 }),
    ctx({ id: 5, name: "P0", position: 0 }),
  ]);
  const { item } = await CC.addPending(null, "Pend"); // pribadi, posisi 2
  const R = buildTaskRouter();
  const got = await R.dispatch("GET", "/api/contexts?format=full&scope=all", undefined);
  assert.deepEqual(ids(got), [5, 3, item.cid, 4, 2, 1]);
});

test("POST /api/contexts creates a pending item and exactly one outbox op; a duplicate name adds no op", async () => {
  const R = buildTaskRouter();
  const res = await R.dispatch("POST", "/api/contexts", { name: "Desain", list_id: null });
  assert.equal(res.name, "Desain");
  assert.equal(res.pending, true);
  assert.equal(res.id, res.cid);
  let ob = await outboxAll();
  assert.equal(ob.length, 1);
  assert.equal(ob[0].op, "create");
  assert.equal(ob[0].entity_type, "context");
  assert.equal(ob[0].cid, res.cid);
  assert.deepEqual(ob[0].payload, { cid: res.cid });

  const dup = await R.dispatch("POST", "/api/contexts", { name: "DESAIN", list_id: null });
  assert.equal(dup.cid, res.cid);
  assert.equal((await outboxAll()).length, 1);

  const ws = await R.dispatch("POST", "/api/contexts", { name: "Desain", list_id: 7 });
  assert.notEqual(ws.cid, res.cid);
  assert.equal(ws.list_id, 7);
  ob = await outboxAll();
  assert.equal(ob.length, 2);

  // item baru langsung tampil di GET lokal
  assert.deepEqual(await R.dispatch("GET", "/api/contexts", undefined), ["Desain"]);
  assert.deepEqual(await R.dispatch("GET", "/api/contexts?list_id=7", undefined), ["Desain"]);
});

test("POST /api/contexts rejects a blank name and adds no op", async () => {
  const R = buildTaskRouter();
  await assert.rejects(R.dispatch("POST", "/api/contexts", { name: "  " }), { message: "Nama tahap tidak boleh kosong" });
  await assert.rejects(R.dispatch("POST", "/api/contexts", undefined), { message: "Nama tahap tidak boleh kosong" });
  assert.equal((await outboxAll()).length, 0);
});

test("PATCH/DELETE/PUT order are not served locally", () => {
  const R = buildTaskRouter();
  assert.equal(R.hasRoute("PATCH", "/api/contexts/3"), false);
  assert.equal(R.hasRoute("DELETE", "/api/contexts/3"), false);
  assert.equal(R.hasRoute("PUT", "/api/contexts/order"), false);
  assert.equal(R.hasRoute("GET", "/api/contexts"), true);
  assert.equal(R.hasRoute("POST", "/api/contexts"), true);
});

// ── fix round 1 ──────────────────────────────────────────────────────────────────────────────
test("scope=all mirrors the server: archived hidden unless include_archived is 1/true", async () => {
  await seedCache([
    ctx({ id: 1, name: "P0", position: 0 }),
    ctx({ id: 2, name: "POld", position: 1, archived: 1 }),
    ctx({ id: 3, name: "W7", list_id: 7, position: 0 }),
    ctx({ id: 4, name: "W7Old", list_id: 7, position: 1, archived: 1 }),
  ]);
  const R = buildTaskRouter();
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&scope=all", undefined)), [1, 3]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&scope=all&include_archived=0", undefined)), [1, 3]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&scope=all&include_archived=1", undefined)), [1, 2, 3, 4]);
  assert.deepEqual(ids(await R.dispatch("GET", "/api/contexts?format=full&scope=all&include_archived=true", undefined)), [1, 2, 3, 4]);
});

test("addPending normalises list_id: numeric string → number, ''/undefined/null → null", async () => {
  const a = await CC.addPending("7", "A");
  assert.strictEqual(a.item.list_id, 7);
  const b = await CC.addPending(7, "B");
  assert.strictEqual(b.item.list_id, 7);
  for (const [i, v] of [["", "C"], [undefined, "D"], [null, "E"]]) {
    const r = await CC.addPending(i, v);
    assert.strictEqual(r.item.list_id, null);
  }
  // "7" dan 7 adalah scope yang sama → dipakai ulang
  const dup = await CC.addPending(7, "a");
  assert.equal(dup.created, false);
  assert.strictEqual(dup.item.list_id, 7);
  // lewat route (body string / angka)
  const R = buildTaskRouter();
  assert.strictEqual((await R.dispatch("POST", "/api/contexts", { name: "Rs", list_id: "9" })).list_id, 9);
  assert.strictEqual((await R.dispatch("POST", "/api/contexts", { name: "Rn", list_id: 9 })).list_id, 9);
  assert.strictEqual((await R.dispatch("POST", "/api/contexts", { name: "Rp", list_id: "" })).list_id, null);
});

test("mutations reject on a failed metaGet and leave existing pending entries untouched", async () => {
  const meta = require("../../static/offline/meta.js");
  const keep = await CC.addPending(null, "Keep");
  const other = await CC.addPending(null, "Other");
  const before = await metaGet("contexts:pending:v1");
  const real = meta.metaGet;
  const failOn = (key) => { meta.metaGet = (k) => (k === key ? Promise.reject(new Error("idb read failed")) : real(k)); };
  try {
    for (const key of ["contexts:pending:v1", "contexts:v1"]) {
      failOn(key);
      await assert.rejects(CC.addPending(null, "New " + key), { message: "idb read failed" });
      if (key === "contexts:pending:v1") { // dropPending hanya membaca daftar pending
        await assert.rejects(CC.dropPending(keep.item.cid), { message: "idb read failed" });
      }
      await assert.rejects(CC.resolvePending(keep.item.cid, ctx({ id: 5, name: "Keep" })), { message: "idb read failed" });
    }
  } finally { meta.metaGet = real; }
  assert.deepEqual(await metaGet("contexts:pending:v1"), before);
  assert.equal(await metaGet("contexts:v1"), undefined);
  // display reads keep swallowing
  meta.metaGet = () => Promise.reject(new Error("idb read failed"));
  try {
    assert.deepEqual(await CC.allItems(), []);
    assert.deepEqual(await CC.list(null), []);
  } finally { meta.metaGet = real; }
  // a failed mutation does not poison later ones
  const ok = await CC.addPending(null, "After");
  assert.equal(ok.created, true);
  assert.deepEqual((await CC.allItems()).map((i) => i.name), ["Keep", "Other", "After"]);
  assert.equal(other.created, true);
});

// ── final review: "+ Tahap" dengan nama yang sudah ada ─────────────────────────────────────────
test("POST /api/contexts reports created and archived so the board can react to an existing name", async () => {
  await seedCache([ctx({ id: 4, name: "Lama", archived: true }), ctx({ id: 5, name: "Aktif" })]);
  const R = buildTaskRouter();
  const fresh = await R.dispatch("POST", "/api/contexts", { name: "Baru", list_id: null });
  assert.equal(fresh.created, true);
  assert.equal(fresh.archived, false);
  const again = await R.dispatch("POST", "/api/contexts", { name: "baru", list_id: null }); // pending
  assert.equal(again.created, false);
  assert.equal(again.pending, true);
  assert.equal(again.archived, false);
  const live = await R.dispatch("POST", "/api/contexts", { name: "AKTIF", list_id: null });
  assert.equal(live.created, false);
  assert.equal(live.id, 5);
  assert.equal(live.archived, false);
  const arch = await R.dispatch("POST", "/api/contexts", { name: "lama", list_id: null });
  assert.equal(arch.created, false);
  assert.equal(arch.archived, true);
  assert.equal(arch.id, 4);
  assert.equal((await outboxAll()).length, 1); // hanya "Baru"
  // flag respons tidak ikut tersimpan di cache/pending
  const stored = await CC.allItems();
  assert.ok(stored.every((c) => !("created" in c)));
});
