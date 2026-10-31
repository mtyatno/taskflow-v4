"use strict";
// TF.taskext — aturan ext klien sama dengan server task_ext.py (spec plugin Fase 1 K4/K7; rencana 1a-1 T3).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const X = require("../../static/offline/taskext.js");

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "taskext_vectors.json"), "utf8"));

function sized(ns, target, ch = "x") {
  const base = X.utf8Bytes(JSON.stringify({ [ns + ".v"]: "" }));
  const n = Math.floor((target - base) / X.utf8Bytes(ch));
  return { [ns + ".v"]: ch.repeat(n) };
}

test("vektor bersama (sisi client)", () => {
  for (const k of VECTORS.keys.valid) {
    assert.ok(X.KEY_RE.test(k), k);
    assert.equal(X.checkPatch({ [k]: 1 }), null, k);
  }
  for (const k of VECTORS.keys.invalid) {
    assert.ok(!X.KEY_RE.test(k), JSON.stringify(k));
    assert.deepEqual(X.checkPatch({ [k]: 1 }), { code: "EXT_INVALID", key: k });
  }
  for (const v of VECTORS.refs) {
    const err = X.checkPatch({ "demo-ext.a": v.value });
    if (v.client === "ok") assert.equal(err, null, JSON.stringify(v.value));
    else assert.deepEqual(err, { code: v.client, key: "demo-ext.a" }, JSON.stringify(v.value));
  }
  for (const v of VECTORS.sizes) {
    const err = X.sizeError(v.ext);
    if (v.error === null) assert.equal(err, null, v.name);
    else assert.deepEqual(err, { code: v.error, key: v.key }, v.name);
  }
});

test("applyPatch per kunci dan tidak memutasi masukan", () => {
  const ext = { "demo-ext.a": 1, "x-plug.k": 2 };
  const patch = { "demo-ext.b": 3, "demo-ext.a": null };
  const out = X.applyPatch(ext, patch);
  assert.deepEqual(out, { "x-plug.k": 2, "demo-ext.b": 3 });
  assert.deepEqual(ext, { "demo-ext.a": 1, "x-plug.k": 2 });
  assert.deepEqual(patch, { "demo-ext.b": 3, "demo-ext.a": null });
  assert.notEqual(out, ext);
  for (const bad of [undefined, null, "{}", [1], 5]) {
    assert.deepEqual(X.applyPatch(bad, { "demo-ext.a": 1 }), { "demo-ext.a": 1 });
  }
  assert.deepEqual(X.applyPatch({ "demo-ext.a": 1 }, null), { "demo-ext.a": 1 });
});

test("sizeError: batas 4096/16384 byte UTF-8 sama dengan server", () => {
  assert.equal(X.PLUGIN_MAX_BYTES, 4096);
  assert.equal(X.TOTAL_MAX_BYTES, 16384);
  const ok = sized("demo-ext", 4096);
  assert.equal(X.utf8Bytes(JSON.stringify(ok)), 4096);
  assert.equal(X.sizeError(ok), null);
  assert.deepEqual(X.sizeError(sized("demo-ext", 4097)), { code: "EXT_TOO_LARGE", key: "demo-ext" });
  const many = {};
  for (const ns of ["aaa-one", "bbb-two", "ccc-three", "ddd-four", "eee-five"]) Object.assign(many, sized(ns, 3500));
  assert.deepEqual(X.sizeError(many), { code: "EXT_TOO_LARGE", key: null });
  const base = X.utf8Bytes(JSON.stringify({ "demo-ext.v": "" }));
  const accent = { "demo-ext.v": "é".repeat(Math.floor((4097 - base + 1) / 2)) };
  assert.ok(JSON.stringify(accent).length < 4096);
  assert.deepEqual(X.sizeError(accent), { code: "EXT_TOO_LARGE", key: "demo-ext" });
  assert.equal(X.utf8Bytes("aé€😀"), 1 + 2 + 3 + 4);
});

test("checkPatch: undefined/fungsi/NaN-dalam-objek → EXT_INVALID", () => {
  const K = "demo-ext.a";
  for (const v of [undefined, () => 1, NaN, Infinity, { x: NaN }, [1, undefined], { y: () => 0 },
    { d: new Date(0) }, Symbol("s"), 10n]) {
    assert.deepEqual(X.checkPatch({ [K]: v }), { code: "EXT_INVALID", key: K }, String(typeof v));
  }
  const shared = { lag: 0 };
  assert.equal(X.checkPatch({ [K]: [shared, shared] }), null); // dipakai dua kali tanpa siklus = sah
  const cyc = {}; cyc.self = cyc;
  assert.deepEqual(X.checkPatch({ [K]: cyc }), { code: "EXT_INVALID", key: K });
  for (const bad of [null, [], "x", 1, undefined, new Map()]) {
    assert.deepEqual(X.checkPatch(bad), { code: "EXT_INVALID", key: null });
  }
  assert.equal(X.checkPatch({ [K]: null }), null);
  assert.equal(X.checkPatch({ [K]: null }, { allowNull: true }), null);
  assert.deepEqual(X.checkPatch({ [K]: null }, { allowNull: false }), { code: "EXT_INVALID", key: K });
  assert.equal(X.checkPatch({ [K]: { a: [1, "s", true, null, { b: 2.5 }] } }), null);
  assert.deepEqual(X.cleanNulls({ [K]: null, "demo-ext.b": 0 }), { "demo-ext.b": 0 });
});

test("ref: angka bulat dan cid string ok; {$task: 1, x: 1}, {$task: ''}, {$task: 1.5} → EXT_TASK_REF", () => {
  const K = "demo-ext.dep";
  assert.equal(X.checkPatch({ [K]: { $task: 12 } }), null);
  assert.equal(X.checkPatch({ [K]: [{ t: { $task: "c-abc" } }] }), null);
  for (const bad of [{ $task: 1, x: 1 }, { $task: "" }, { $task: 1.5 }, { $task: true }, { $task: null },
    { $task: "x".repeat(65) }, { $task: -0.5 }]) {
    for (const wrapped of [bad, [bad], { deep: [{ x: bad }] }]) {
      assert.deepEqual(X.checkPatch({ [K]: wrapped }), { code: "EXT_TASK_REF", key: K }, JSON.stringify(wrapped));
    }
  }
  assert.ok(X.isRef({ $task: 1 }));
  assert.ok(!X.isRef({ task: 1 }));
  assert.ok(!X.isRef(null));
  assert.deepEqual(X.refsIn({ a: [{ t: { $task: 3 } }, { t: { $task: "c-1" } }], b: { $task: 5 } }).sort(),
    [3, 5, "c-1"].sort());
  assert.deepEqual(X.refsIn("x"), []);
});

test("mapRefs mengganti ref di list/objek bersarang, null menggantikan objek ref", () => {
  const src = { a: [{ t: { $task: "c-1" }, lag: 0 }, { t: { $task: 7 } }], b: { $task: "c-2" }, s: "x" };
  const out = X.mapRefs(src, (id) => (id === "c-1" ? { $task: 101 } : id === "c-2" ? null : { $task: id }));
  assert.deepEqual(out, { a: [{ t: { $task: 101 }, lag: 0 }, { t: { $task: 7 } }], b: null, s: "x" });
  // salinan dalam: sumber tidak berubah
  assert.deepEqual(src.a[0].t, { $task: "c-1" });
  assert.notEqual(out.a, src.a);
  assert.deepEqual(X.mapRefs({ $task: "c-9" }, () => null), null);
  assert.equal(X.mapRefs(5, () => null), 5);
});

test("isPlainObject: string '{}' / array / null → false", () => {
  for (const v of ["{}", [], null, undefined, 1, new Date(), new Map()]) assert.equal(X.isPlainObject(v), false);
  assert.equal(X.isPlainObject({}), true);
  assert.equal(X.isPlainObject(Object.create(null)), true);
  assert.equal(X.isPlainObject(structuredClone({ a: 1 })), true);
});

test("namespaceOf, FIELD_RE, extError", () => {
  assert.equal(X.namespaceOf("demo-ext.note"), "demo-ext");
  assert.ok(X.FIELD_RE.test("start") && !X.FIELD_RE.test("1x") && !X.FIELD_RE.test("a.b"));
  const e = X.extError("EXT_TOO_LARGE", "demo-ext");
  assert.ok(e instanceof Error);
  assert.equal(e.message, "EXT_TOO_LARGE");
  assert.equal(e.code, "EXT_TOO_LARGE");
  assert.equal(e.key, "demo-ext");
  assert.equal(e.status, 422);
});
