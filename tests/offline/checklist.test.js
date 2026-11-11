"use strict";
// TF.checklist — logika pohon checklist bertingkat di klien (rencana PR B R1/R2; spec checklist bertingkat §5,
// §6.4, §7.1–§7.3, §9, §11.1). Vektor pohon dan persen dipakai bersama dengan pytest (`checklist_tree.py`,
// `repository.move_subtask`), sehingga JS = Python = server.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "static/offline/checklist.js");
const C = require("../../static/offline/checklist.js");

const PERCENT = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/checklist_percent_vectors.json"), "utf8"));
const TREE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/checklist_tree_vectors.json"), "utf8"));

// Butir bentuk API (`task_id` sama → satu task).
function b(id, parent_id, sort_order, extra) {
  return Object.assign({ id, task_id: 1, parent_id, sort_order, title: "b" + id, is_done: false }, extra || {});
}
// a=1 (a1=4 (a11=6), a2=5), b=2, c=3 — urutan masukan sengaja diacak.
function pohon(extra) {
  const e = extra || {};
  return [b(3, null, 2, e[3]), b(6, 4, 0, e[6]), b(1, null, 0, e[1]), b(5, 1, 1, e[5]), b(2, null, 1, e[2]), b(4, 1, 0, e[4])];
}
const ids = (list) => list.map((x) => x.id);
const rowIds = (rows) => rows.map((r) => r.item.id);
const tanpaSubtree = (rows, items, id) => {
  const buang = new Set([id].concat(C.descendantIds(items, id)));
  return rows.filter((r) => !buang.has(r.item.id));
};
function rantai(n) {
  const rows = [b(1, null, 0)];
  for (let i = 2; i <= n; i++) rows.push(b(i, i - 1, 0));
  return rows.reverse();
}

// ── modul ────────────────────────────────────────────────────────────────────

test("modul: di browser terpasang sebagai TF.checklist (pola UMD taskdetail.js)", () => {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);
  const api = ctx.self.TF.checklist;
  for (const k of ["percent", "preorder", "topLevelCounts", "childCounts", "descendantIds", "visibleRows",
    "indentTarget", "outdentTarget", "siblingMoveTarget", "dropRange", "dropTarget", "applyMove", "maxAddDepth",
    "addParentFor", "autoScrollDelta", "loadCollapsed", "saveCollapsed", "lockFor", "adoptTaskProgress", "childCountsAll",
    "applyCreate", "applySetDone", "applyRename", "applyDelete", "moveError", "writeTaskProgress"]) {
    assert.equal(typeof api[k], "function", k);
  }
  assert.equal(api.COLLAPSE_KEY, "tf_check_collapsed");
  assert.equal(api.COLLAPSE_MAX, 500);
});

test("modul: dimuat index.html tepat setelah taskdetail.js dan ada di STATIC sw.js", () => {
  const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8");
  assert.match(html, /<script src="\/static\/offline\/taskdetail\.js"><\/script>\s*\n\s*<script src="\/static\/offline\/checklist\.js"><\/script>/);
  const sw = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");
  assert.match(sw, /"\/static\/offline\/taskdetail\.js",\s*\n\s*"\/static\/offline\/checklist\.js",/);
});

test("modul: tanpa DOM/React", () => {
  const kode = fs.readFileSync(SRC, "utf8").replace(/^\s*\/\/.*$/gm, ""); // tanpa baris komentar
  assert.doesNotMatch(kode, /\bdocument\.|\bReact\b|\bwindow\./);
});

// ── percent ──────────────────────────────────────────────────────────────────

test("percent: sesuai vektor bersama pytest", () => {
  for (const [done, total, expected] of PERCENT) assert.equal(C.percent(done, total), expected, `${done}/${total}`);
});

test("percent: total 0 → null; setengah dibulatkan ke atas (1/40 → 3)", () => {
  assert.equal(C.percent(0, 0), null);
  assert.equal(C.percent(1, 40), 3);
});

// ── preorder ─────────────────────────────────────────────────────────────────

for (const vec of TREE.preorder) {
  test("preorder vektor: " + vec.name, () => {
    const out = C.preorder(vec.rows);
    assert.deepEqual(out.map((r) => [r.id, r.depth, r.parent_id]), vec.expected);
  });
}

test("preorder: salinan baru dengan field lain utuh, masukan tidak berubah", () => {
  const items = pohon({ 1: { is_done: true } });
  const snap = JSON.stringify(items);
  const out = C.preorder(items);
  assert.equal(JSON.stringify(items), snap);
  assert.deepEqual(ids(out), [1, 4, 6, 5, 2, 3]);
  assert.equal(out[0].title, "b1");
  assert.equal(out[0].is_done, true);
  assert.notEqual(out[0], items[2]);
});

test("preorder: masukan bukan array → []", () => {
  assert.deepEqual(C.preorder(null), []);
  assert.deepEqual(C.preorder(undefined), []);
});

test("preorder: parent_id yatim diganti null pada salinan (parent_id efektif)", () => {
  const out = C.preorder([b(1, 999, 0), b(2, 1, 0)]);
  assert.deepEqual(out.map((r) => [r.id, r.depth, r.parent_id]), [[1, 0, null], [2, 1, 1]]);
});

// ── hitungan ─────────────────────────────────────────────────────────────────

test("topLevelCounts: hanya level atas (yatim ikut level atas); kosong 0/0", () => {
  const items = pohon({ 1: { is_done: true }, 4: { is_done: true }, 6: { is_done: true } });
  assert.deepEqual(C.topLevelCounts(items), { done: 1, total: 3 });
  assert.deepEqual(C.topLevelCounts(items.concat([b(9, 999, 5, { is_done: 1 })])), { done: 2, total: 4 });
  assert.deepEqual(C.topLevelCounts([]), { done: 0, total: 0 });
});

test("childCounts: anak langsung saja; daun / id tidak dikenal 0/0", () => {
  const items = pohon({ 4: { is_done: true }, 6: { is_done: true } });
  assert.deepEqual(C.childCounts(items, 1), { done: 1, total: 2 });
  assert.deepEqual(C.childCounts(items, 4), { done: 1, total: 1 });
  assert.deepEqual(C.childCounts(items, 6), { done: 0, total: 0 });
  assert.deepEqual(C.childCounts(items, 99), { done: 0, total: 0 });
});

test("childCountsAll: Map id → {done, total} anak langsung untuk setiap butir, sama dengan childCounts", () => {
  const items = pohon({ 4: { is_done: true }, 6: { is_done: true } });
  const m = C.childCountsAll(items);
  assert.ok(m instanceof Map);
  assert.deepEqual([...m.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  for (const id of [1, 2, 3, 4, 5, 6]) assert.deepEqual(m.get(id), C.childCounts(items, id), "id " + id);
  assert.deepEqual(m.get(1), { done: 1, total: 2 });
  assert.equal(m.get(99), undefined);
  assert.deepEqual([...C.childCountsAll([]).keys()], []);
  assert.deepEqual([...C.childCountsAll(null).keys()], []);
});

test("childCountsAll: pohon efektif (yatim → level atas, siklus diputus seperti preorder)", () => {
  const m = C.childCountsAll([b(1, 999, 0), b(2, 1, 0, { is_done: 1 }), b(5, 6, 0), b(6, 5, 1)]);
  assert.deepEqual(m.get(1), { done: 1, total: 1 });
  assert.deepEqual(m.get(5), { done: 0, total: 1 }); // 5 pemutus siklus (sort_order terkecil) → level atas, 6 anaknya
  assert.deepEqual(m.get(6), { done: 0, total: 0 });
});

test("childCountsAll: 2.000 butir (rantai dan lebar) < 50 ms", () => {
  const lebar = [b(1, null, 0)];
  for (let i = 2; i <= 2000; i++) lebar.push(b(i, 1, i, { is_done: i % 2 === 0 }));
  for (const items of [rantai(2000), lebar]) {
    const t0 = process.hrtime.bigint();
    const m = C.childCountsAll(items);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(m.size, 2000);
    assert.ok(ms < 50, "childCountsAll " + ms.toFixed(1) + " ms");
  }
  assert.deepEqual(C.childCountsAll(lebar).get(1), { done: 1000, total: 1999 });
});

test("descendantIds: pre-order tanpa akar; daun/id tidak dikenal []; tahan siklus", () => {
  const items = pohon();
  assert.deepEqual(C.descendantIds(items, 1), [4, 6, 5]);
  assert.deepEqual(C.descendantIds(items, 4), [6]);
  assert.deepEqual(C.descendantIds(items, 6), []);
  assert.deepEqual(C.descendantIds(items, 99), []);
  const siklus = [b(1, 2, 0), b(2, 1, 1), b(3, 2, 0)];
  assert.deepEqual(C.descendantIds(siklus, 1), [2, 3]);
  assert.deepEqual(C.descendantIds(siklus, 2), [3]);
});

// ── visibleRows ──────────────────────────────────────────────────────────────

test("visibleRows: tanpa lipatan semua baris pre-order dengan depth dan hasChildren", () => {
  const rows = C.visibleRows(pohon(), new Set());
  assert.deepEqual(rows.map((r) => [r.item.id, r.depth, r.hasChildren, r.collapsed]),
    [[1, 0, true, false], [4, 1, true, false], [6, 2, false, false], [5, 1, false, false], [2, 0, false, false], [3, 0, false, false]]);
  assert.equal(rows[1].item.depth, 1);
  assert.equal(rows[1].item.parent_id, 1);
});

test("visibleRows: turunan butir terlipat tidak tampil, butirnya collapsed", () => {
  assert.deepEqual(rowIds(C.visibleRows(pohon(), new Set([1]))), [1, 2, 3]);
  assert.equal(C.visibleRows(pohon(), new Set([1]))[0].collapsed, true);
  const r4 = C.visibleRows(pohon(), new Set([4]));
  assert.deepEqual(rowIds(r4), [1, 4, 5, 2, 3]);
  assert.deepEqual([r4[1].hasChildren, r4[1].collapsed], [true, true]);
});

test("visibleRows: lipatan bersarang, id daun di set tidak berarti terlipat, set boleh array/null", () => {
  assert.deepEqual(rowIds(C.visibleRows(pohon(), new Set([1, 4]))), [1, 2, 3]);
  const daun = C.visibleRows(pohon(), new Set([6]));
  assert.deepEqual(rowIds(daun), [1, 4, 6, 5, 2, 3]);
  assert.equal(daun[2].collapsed, false);
  assert.deepEqual(rowIds(C.visibleRows(pohon(), [4])), [1, 4, 5, 2, 3]);
  assert.deepEqual(rowIds(C.visibleRows(pohon(), null)), [1, 4, 6, 5, 2, 3]);
  assert.deepEqual(C.visibleRows([], new Set()), []);
});

// ── indent / outdent / saudara ───────────────────────────────────────────────

test("indentTarget: anak terakhir saudara sebelumnya; butir pertama → null", () => {
  const items = pohon();
  assert.equal(C.indentTarget(items, 1), null);
  assert.equal(C.indentTarget(items, 4), null);
  assert.equal(C.indentTarget(items, 6), null);
  assert.deepEqual(C.indentTarget(items, 2), { parent_id: 1, index: 2 });
  assert.deepEqual(C.indentTarget(items, 5), { parent_id: 4, index: 1 });
  assert.deepEqual(C.indentTarget(items, 3), { parent_id: 2, index: 0 });
  assert.equal(C.indentTarget(items, 99), null);
});

test("indentTarget: induk tujuan terlipat tetap dihitung semua anaknya (lipat tidak memengaruhi)", () => {
  // Lipatan hanya tampilan; target dihitung dari daftar lengkap.
  const t = C.indentTarget(pohon(), 2);
  const after = C.applyMove(pohon(), 2, t.parent_id, t.index);
  assert.deepEqual(after.map((r) => [r.id, r.depth]), [[1, 0], [4, 1], [6, 2], [5, 1], [2, 1], [3, 0]]);
});

test("outdentTarget: tepat di bawah induk; level atas → null; saudara berikutnya tetap di induk lama", () => {
  const items = pohon();
  assert.equal(C.outdentTarget(items, 1), null);
  assert.equal(C.outdentTarget(items, 2), null);
  assert.deepEqual(C.outdentTarget(items, 4), { parent_id: null, index: 1 });
  assert.deepEqual(C.outdentTarget(items, 5), { parent_id: null, index: 1 });
  assert.deepEqual(C.outdentTarget(items, 6), { parent_id: 1, index: 1 });
  assert.equal(C.outdentTarget(items, 99), null);
  const t = C.outdentTarget(items, 4);
  const after = C.applyMove(items, 4, t.parent_id, t.index);
  assert.deepEqual(after.map((r) => [r.id, r.depth, r.parent_id]),
    [[1, 0, null], [5, 1, 1], [4, 0, null], [6, 1, 4], [2, 0, null], [3, 0, null]]);
});

test("siblingMoveTarget: tukar dengan saudara sebelum/sesudah; ujung / anak tunggal / dir 0 → null", () => {
  const items = pohon();
  assert.equal(C.siblingMoveTarget(items, 1, -1), null);
  assert.deepEqual(C.siblingMoveTarget(items, 1, 1), { parent_id: null, index: 1 });
  assert.deepEqual(C.siblingMoveTarget(items, 3, -1), { parent_id: null, index: 1 });
  assert.equal(C.siblingMoveTarget(items, 3, 1), null);
  assert.deepEqual(C.siblingMoveTarget(items, 5, -1), { parent_id: 1, index: 0 });
  assert.deepEqual(C.siblingMoveTarget(items, 4, 1), { parent_id: 1, index: 1 });
  assert.equal(C.siblingMoveTarget(items, 6, -1), null);
  assert.equal(C.siblingMoveTarget(items, 6, 1), null);
  assert.equal(C.siblingMoveTarget(items, 2, 0), null);
  assert.equal(C.siblingMoveTarget(items, 99, 1), null);
  const t = C.siblingMoveTarget(items, 1, 1);
  assert.deepEqual(ids(C.applyMove(items, 1, t.parent_id, t.index)), [2, 1, 4, 6, 5, 3]);
  const u = C.siblingMoveTarget(items, 5, -1);
  assert.deepEqual(ids(C.applyMove(items, 5, u.parent_id, u.index)), [1, 5, 4, 6, 2, 3]);
});

// ── dropRange / dropTarget ───────────────────────────────────────────────────

test("dropRange: rentang tingkat di setiap celah", () => {
  const rows = C.visibleRows(pohon(), new Set()); // depth 0,1,2,1,0,0
  const got = [];
  for (let g = 0; g <= rows.length; g++) got.push(C.dropRange(rows, g));
  assert.deepEqual(got, [
    { min: 0, max: 0 }, { min: 1, max: 1 }, { min: 2, max: 2 }, { min: 1, max: 3 },
    { min: 0, max: 2 }, { min: 0, max: 1 }, { min: 0, max: 1 },
  ]);
  assert.deepEqual(C.dropRange([], 0), { min: 0, max: 0 });
});

test("dropRange: min > max dipaksa = max; celah di luar rentang di-clamp", () => {
  assert.deepEqual(C.dropRange([{ depth: 0 }, { depth: 3 }], 1), { min: 1, max: 1 });
  const rows = C.visibleRows(pohon(), new Set());
  assert.deepEqual(C.dropRange(rows, 99), C.dropRange(rows, rows.length));
  assert.deepEqual(C.dropRange(rows, -3), C.dropRange(rows, 0));
});

test("dropTarget: seret butir tanpa anak ke berbagai celah dan tingkat", () => {
  const items = pohon();
  const rows = tanpaSubtree(C.visibleRows(items, new Set()), items, 3); // 1,4,6,5,2
  assert.deepEqual(C.dropTarget(items, rows, 3, 0, 0), { parent_id: null, index: 0 });
  assert.deepEqual(C.dropTarget(items, rows, 3, 0, 5), { parent_id: null, index: 0 }); // tingkat di-clamp
  assert.deepEqual(C.dropTarget(items, rows, 3, 1, 0), { parent_id: 1, index: 0 });    // min 1
  assert.deepEqual(C.dropTarget(items, rows, 3, 3, 1), { parent_id: 1, index: 1 });
  assert.deepEqual(C.dropTarget(items, rows, 3, 3, 2), { parent_id: 4, index: 1 });
  assert.deepEqual(C.dropTarget(items, rows, 3, 3, 3), { parent_id: 6, index: 0 });
  assert.deepEqual(C.dropTarget(items, rows, 3, 4, 0), { parent_id: null, index: 1 });
  assert.deepEqual(C.dropTarget(items, rows, 3, 5, 1), { parent_id: 2, index: 0 });
});

test("dropTarget: posisi sekarang → null", () => {
  const items = pohon();
  const r3 = tanpaSubtree(C.visibleRows(items, new Set()), items, 3);
  assert.equal(C.dropTarget(items, r3, 3, 5, 0), null);
  const r5 = tanpaSubtree(C.visibleRows(items, new Set()), items, 5); // 1,4,6,2,3
  assert.equal(C.dropTarget(items, r5, 5, 3, 1), null);
  assert.deepEqual(C.dropTarget(items, r5, 5, 3, 2), { parent_id: 4, index: 1 });
  assert.deepEqual(C.dropTarget(items, r5, 5, 3, 0), { parent_id: null, index: 1 });
});

test("dropTarget: seret induk beserta subtree", () => {
  const items = pohon();
  const rows = tanpaSubtree(C.visibleRows(items, new Set()), items, 1); // 2,3
  assert.deepEqual(rowIds(rows), [2, 3]);
  assert.equal(C.dropTarget(items, rows, 1, 0, 0), null);
  assert.deepEqual(C.dropTarget(items, rows, 1, 1, 0), { parent_id: null, index: 1 });
  assert.deepEqual(C.dropTarget(items, rows, 1, 1, 1), { parent_id: 2, index: 0 });
  assert.deepEqual(C.dropTarget(items, rows, 1, 2, 0), { parent_id: null, index: 2 });
  const t = C.dropTarget(items, rows, 1, 1, 1);
  assert.deepEqual(C.applyMove(items, 1, t.parent_id, t.index).map((r) => [r.id, r.depth]),
    [[2, 0], [1, 1], [4, 2], [6, 3], [5, 2], [3, 0]]);
});

test("dropTarget: induk tujuan = butir yang diseret atau turunannya → null", () => {
  const items = pohon();
  const semua = C.visibleRows(items, new Set()); // salah pakai: subtree yang diseret tidak dibuang
  assert.equal(C.dropTarget(items, semua, 1, 1, 1), null);
  assert.equal(C.dropTarget(items, semua, 1, 2, 2), null);
  assert.equal(C.dropTarget(items, semua, 1, 3, 3), null);
});

test("dropTarget: jatuh sebagai anak butir terlipat → anak terakhir", () => {
  const items = pohon();
  const rowsA = tanpaSubtree(C.visibleRows(items, new Set([1])), items, 3); // 1(terlipat),2
  assert.deepEqual(C.dropTarget(items, rowsA, 3, 1, 1), { parent_id: 1, index: 2 });
  assert.deepEqual(C.dropTarget(items, rowsA, 3, 1, 0), { parent_id: null, index: 1 });
  const rowsA1 = tanpaSubtree(C.visibleRows(items, new Set([4])), items, 3); // 1,4(terlipat),5,2
  assert.deepEqual(C.dropTarget(items, rowsA1, 3, 2, 2), { parent_id: 4, index: 1 });
  assert.deepEqual(C.dropTarget(items, rowsA1, 3, 2, 1), { parent_id: 1, index: 1 });
});

test("dropTarget: id yang diseret tidak dikenal → null", () => {
  const items = pohon();
  assert.equal(C.dropTarget(items, C.visibleRows(items, new Set()), 99, 0, 0), null);
});

// ── applyMove ────────────────────────────────────────────────────────────────

for (const vec of TREE.move) {
  if (vec.python_only) continue; // khusus repository (index negatif): kontrak HTTP/JS menolaknya, lihat tes di bawah
  test("applyMove vektor: " + vec.name, () => {
    const out = C.applyMove(vec.rows, vec.move.id, vec.move.parent_id, vec.move.index);
    assert.deepEqual(out.map((r) => [r.id, r.depth, r.parent_id, r.sort_order]), vec.expected);
  });
}

for (const vec of TREE.move_invalid) {
  test("applyMove vektor tidak sah → null: " + vec.name, () => {
    assert.equal(C.applyMove(vec.rows, vec.move.id, vec.move.parent_id, vec.move.index), null);
  });
}

test("applyMove: vektor khusus Python (index negatif) ditolak JS → null", () => {
  const khusus = TREE.move.filter((v) => v.python_only);
  assert.ok(khusus.length >= 1);
  for (const v of khusus) assert.equal(C.applyMove(v.rows, v.move.id, v.move.parent_id, v.move.index), null, v.name);
});

test("applyMove: tidak mengubah masukan dan field lain ikut tersalin", () => {
  const items = pohon({ 3: { is_done: true } });
  const snap = JSON.stringify(items);
  const out = C.applyMove(items, 3, 1, 0);
  assert.equal(JSON.stringify(items), snap);
  const c = out.find((r) => r.id === 3);
  assert.deepEqual([c.parent_id, c.depth, c.sort_order, c.is_done, c.title], [1, 1, 0, true, "b3"]);
});

test("applyMove: posisi sama → sama dengan preorder masukan", () => {
  const items = pohon();
  assert.deepEqual(C.applyMove(items, 4, 1, 0), C.preorder(items));
  assert.deepEqual(C.applyMove(items, 3, null, null), C.preorder(items));
});

test("applyMove: tujuan tidak sah → null (id/induk tidak dikenal, diri sendiri, turunan, task lain, index bukan angka)", () => {
  const items = pohon();
  assert.equal(C.applyMove(items, 99, null, 0), null);
  assert.equal(C.applyMove(items, 1, 99, 0), null);
  assert.equal(C.applyMove(items, 1, 1, 0), null);
  assert.equal(C.applyMove(items, 1, 4, 0), null);
  assert.equal(C.applyMove(items, 1, 6, 0), null);
  assert.equal(C.applyMove(items.concat([b(50, null, 0, { task_id: 2 })]), 3, 50, 0), null);
  assert.equal(C.applyMove(items, 3, null, "x"), null);
});

test("applyMove: parent_id undefined = level atas", () => {
  assert.deepEqual(ids(C.applyMove(pohon(), 4, undefined, 1)), [1, 5, 4, 6, 2, 3]);
});

test("applyMove: index negatif / bukan bilangan bulat / bukan number → null (kontrak HTTP index int ≥ 0)", () => {
  const items = pohon();
  for (const bad of [-1, -5, 1.9, 0.5, "1", NaN, Infinity, true]) {
    assert.equal(C.applyMove(items, 3, null, bad), null, String(bad));
  }
  assert.deepEqual(ids(C.applyMove(items, 3, null, 0)), [3, 1, 4, 6, 5, 2]);
  assert.deepEqual(ids(C.applyMove(items, 3, null, 1e9)), [1, 4, 6, 5, 2, 3]); // > n tetap di-clamp ke akhir
});

// ── id campuran (checklist offline Fase 2, rencana PR B2 R1) ────────────────
// Butir yang belum tersinkron memakai cid (string) sebagai id: angka sebelum teks, teks menurut `<` biasa.

test("id campuran: sort_order sama → id angka sebelum id teks, teks menurut abjad", () => {
  const items = [b("zz", null, 0), b(7, null, 0), b("aa", null, 0), b(2, null, 0), b("m", null, 1), b(1, null, 1)];
  assert.deepEqual(ids(C.preorder(items)), [2, 7, "aa", "zz", 1, "m"]);
});

test("id campuran: parent_id string (cid) membentuk pohon; turunan, hitungan, dan target pindah ikut", () => {
  const items = [b(1, null, 0), b("c-a", 1, 0), b("c-b", "c-a", 0), b(2, null, 1, { is_done: true }), b("c-c", null, 2)];
  const flat = C.preorder(items);
  assert.deepEqual(flat.map((r) => [r.id, r.depth, r.parent_id]),
    [[1, 0, null], ["c-a", 1, 1], ["c-b", 2, "c-a"], [2, 0, null], ["c-c", 0, null]]);
  assert.deepEqual(C.descendantIds(items, 1), ["c-a", "c-b"]);
  assert.deepEqual(C.childCounts(items, "c-a"), { done: 0, total: 1 });
  assert.deepEqual(C.topLevelCounts(items), { done: 1, total: 3 });
  assert.deepEqual(C.indentTarget(items, "c-c"), { parent_id: 2, index: 0 });
  assert.deepEqual(C.outdentTarget(items, "c-b"), { parent_id: 1, index: 1 });
  const moved = C.applyMove(items, "c-c", "c-a", 0);
  assert.deepEqual(moved.map((r) => [r.id, r.depth, r.parent_id, r.sort_order]),
    [[1, 0, null, 0], ["c-a", 1, 1, 0], ["c-c", 2, "c-a", 0], ["c-b", 2, "c-a", 1], [2, 0, null, 1]]);
  assert.equal(C.applyMove(items, 1, "c-b", 0), null); // turunan sendiri
});

test("id campuran: siklus diputus pada anggota (sort_order, id) terkecil — angka lebih kecil dari teks", () => {
  const out = C.preorder([b("x", 5, 0), b(5, "x", 0)]);
  assert.deepEqual(out.map((r) => [r.id, r.depth]), [[5, 0], ["x", 1]]);
});

test("vektor pohon Fase 1 tetap lulus dengan pembanding id campuran (preorder dan applyMove)", () => {
  for (const vec of TREE.preorder) assert.deepEqual(C.preorder(vec.rows).map((r) => [r.id, r.depth, r.parent_id]), vec.expected, vec.name);
  for (const vec of TREE.move.filter((v) => !v.python_only)) {
    const out = C.applyMove(vec.rows, vec.move.id, vec.move.parent_id, vec.move.index);
    assert.deepEqual(out.map((r) => [r.id, r.depth, r.parent_id, r.sort_order]), vec.expected, vec.name);
  }
});

// ── aksi murni (rute lokal = server; vektor bersama pytest) ─────────────────

const ACTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/checklist_action_vectors.json"), "utf8"));
// Baris vektor → butir bentuk API (task_id bawaan 1, judul bawaan "v<id>", is_done bawaan false).
function barisVektor(rows) {
  return rows.map((r) => ({
    id: r.id, task_id: r.task_id != null ? r.task_id : 1, parent_id: r.parent_id, sort_order: r.sort_order,
    title: r.title != null ? r.title : "v" + r.id, is_done: !!r.is_done,
  }));
}
const bentuk = (list) => list.map((r) => [r.id, r.depth, r.parent_id, r.sort_order]);
const hitung = (list) => { const c = C.topLevelCounts(list); return [c.done, c.total]; };

test("aksi: vektor aksi bersama memuat semua jenis aksi", () => {
  for (const k of ["create", "create_invalid", "set_done", "rename", "rename_invalid", "delete"]) {
    assert.ok(Array.isArray(ACTIONS[k]) && ACTIONS[k].length > 0, k);
  }
});

for (const vec of ACTIONS.create) {
  test("applyCreate vektor: " + vec.name, () => {
    const rows = barisVektor(vec.rows);
    const snap = JSON.stringify(rows);
    const a = vec.action;
    const r = C.applyCreate(rows, { id: "new", task_id: 1, title: a.title, parent_id: a.parent_id, index: a.index });
    assert.equal(r.error, undefined);
    assert.deepEqual(bentuk(r.items), vec.expected.items);
    assert.deepEqual(bentuk([r.item]), [vec.expected.item]);
    assert.equal(r.item.title, vec.expected.title);
    assert.equal(r.item.is_done, false);
    assert.equal(r.item.task_id, 1);
    assert.deepEqual(hitung(r.items), vec.expected.counts);
    assert.equal(JSON.stringify(rows), snap, "masukan tidak berubah");
  });
}

for (const vec of ACTIONS.create_invalid) {
  test("applyCreate vektor tidak sah: " + vec.name, () => {
    const a = vec.action;
    const r = C.applyCreate(barisVektor(vec.rows), { id: "new", task_id: 1, title: a.title, parent_id: a.parent_id, index: a.index });
    assert.deepEqual(r, { error: vec.error });
  });
}

for (const vec of ACTIONS.set_done) {
  test("applySetDone vektor: " + vec.name, () => {
    const rows = barisVektor(vec.rows);
    const snap = JSON.stringify(rows);
    const r = C.applySetDone(rows, vec.action.id, vec.action.is_done);
    assert.deepEqual(r.changed_ids, vec.expected.changed_ids);
    assert.deepEqual(r.items.filter((x) => x.is_done).map((x) => x.id), vec.expected.done);
    assert.deepEqual(hitung(r.items), vec.expected.counts);
    assert.deepEqual(r.items.map((x) => x.id), C.preorder(rows).map((x) => x.id), "urutan tidak berubah");
    assert.equal(JSON.stringify(rows), snap, "masukan tidak berubah");
  });
}

for (const vec of ACTIONS.rename) {
  test("applyRename vektor: " + vec.name, () => {
    const rows = barisVektor(vec.rows);
    const r = C.applyRename(rows, vec.action.id, vec.action.title);
    assert.equal(r.item.id, vec.action.id);
    assert.equal(r.item.title, vec.expected.title);
    assert.equal(r.changed, vec.expected.changed);
    assert.deepEqual(bentuk(r.items), bentuk(C.preorder(rows)));
    assert.equal(r.items.find((x) => x.id === vec.action.id).title, vec.expected.title);
  });
}

for (const vec of ACTIONS.rename_invalid) {
  test("applyRename vektor tidak sah: " + vec.name, () => {
    assert.deepEqual(C.applyRename(barisVektor(vec.rows), vec.action.id, vec.action.title), { error: vec.error });
  });
}

for (const vec of ACTIONS.delete) {
  test("applyDelete vektor: " + vec.name, () => {
    const rows = barisVektor(vec.rows);
    const snap = JSON.stringify(rows);
    const r = C.applyDelete(rows, vec.action.id);
    assert.deepEqual(r.deleted_ids, vec.expected.deleted_ids);
    assert.deepEqual(bentuk(r.items), vec.expected.items);
    assert.deepEqual(hitung(r.items), vec.expected.counts);
    assert.equal(JSON.stringify(rows), snap, "masukan tidak berubah");
  });
}

test("aksi: id tidak dikenal → null (rute membalas 404)", () => {
  const items = pohon();
  assert.equal(C.applySetDone(items, 99, true), null);
  assert.equal(C.applyRename(items, 99, "x"), null);
  assert.equal(C.applyRename(items, 99, "  "), null, "404 diperiksa sebelum judul kosong (seperti server)");
  assert.equal(C.applyDelete(items, 99), null);
  assert.equal(C.applyDelete(items, "99"), null, "id dibandingkan apa adanya");
});

test("applyCreate: id campuran — cid baru di bawah induk ber-id server dan sebaliknya", () => {
  const items = [b(1, null, 0), b(2, null, 1)];
  const a = C.applyCreate(items, { id: "cid-1", task_id: 1, title: "anak", parent_id: 1, index: null });
  assert.deepEqual(bentuk(a.items), [[1, 0, null, 0], ["cid-1", 1, 1, 0], [2, 0, null, 1]]);
  const b2 = C.applyCreate(a.items, { id: "cid-2", task_id: 1, title: "cucu", parent_id: "cid-1", index: 0 });
  assert.deepEqual(bentuk(b2.items), [[1, 0, null, 0], ["cid-1", 1, 1, 0], ["cid-2", 2, "cid-1", 0], [2, 0, null, 1]]);
  assert.deepEqual(C.applyDelete(b2.items, "cid-1").deleted_ids, ["cid-1", "cid-2"]);
  assert.deepEqual(C.applySetDone(b2.items, 1, true).changed_ids, [1, "cid-1", "cid-2"]);
});

test("applyCreate: task_id bawaan = task butir yang ada; saudara task lain tidak ikut dinomori", () => {
  const items = [b(1, null, 0), b(9, null, 0, { task_id: 2 })];
  const r = C.applyCreate(items, { id: "n", title: "x", parent_id: null, index: 0 });
  assert.equal(r.item.task_id, 1);
  assert.deepEqual(r.items.filter((x) => x.task_id === 1).map((x) => [x.id, x.sort_order]), [["n", 0], [1, 1]]);
  assert.equal(r.items.find((x) => x.id === 9).sort_order, 0);
  assert.equal(C.applyCreate([], { id: "n", title: "x" }).item.task_id, null);
});

test("applyCreate: index null/undefined = akhir; index pecahan dibulatkan ke bawah; negatif → 0 (seperti repository)", () => {
  const items = [b(1, null, 0), b(2, null, 1), b(3, null, 2)];
  const pos = (index) => C.applyCreate(items, { id: "n", task_id: 1, title: "x", parent_id: null, index }).item.sort_order;
  assert.equal(pos(undefined), 3);
  assert.equal(pos(null), 3);
  assert.equal(pos(1.9), 1);
  assert.equal(pos(-4), 0);
});

test("applyCreate: judul bukan string → EMPTY_TITLE", () => {
  assert.deepEqual(C.applyCreate([], { id: "n", title: null }), { error: "EMPTY_TITLE" });
  assert.deepEqual(C.applyCreate([], { id: "n", title: 5 }), { error: "EMPTY_TITLE" });
  assert.deepEqual(C.applyCreate([], { id: "n" }), { error: "EMPTY_TITLE" });
});

test("applySetDone: is_done hasil berupa boolean; field lain utuh", () => {
  const items = [b(1, null, 0, { is_done: 0, title: "a" }), b(2, 1, 0, { is_done: 1 })];
  const r = C.applySetDone(items, 1, true);
  assert.deepEqual(r.items.map((x) => [x.id, x.is_done, x.title]), [[1, true, "a"], [2, 1, "b2"]]);
  assert.deepEqual(C.applySetDone(items, 2, false).items.map((x) => x.is_done), [0, false]);
});

test("applyRename: judul bukan string → EMPTY_TITLE", () => {
  assert.deepEqual(C.applyRename(pohon(), 1, null), { error: "EMPTY_TITLE" });
});

test("moveError: kode galat server untuk vektor pindah tidak sah; tujuan sah / id tidak dikenal → null", () => {
  for (const vec of TREE.move_invalid) {
    assert.equal(C.moveError(vec.rows, vec.move.id, vec.move.parent_id), vec.error, vec.name);
  }
  const items = pohon();
  assert.equal(C.moveError(items, 3, 1), null);
  assert.equal(C.moveError(items, 3, null), null);
  assert.equal(C.moveError(items, 99, 1), null);
  assert.equal(C.moveError(items.concat([b("c", 6, 0)]), 1, "c"), "CYCLE");
});

// ── kotak tambah bawah ───────────────────────────────────────────────────────

test("maxAddDepth: depth butir terakhir pre-order + 1; kosong 0", () => {
  assert.equal(C.maxAddDepth([]), 0);
  assert.equal(C.maxAddDepth(pohon()), 1);
  assert.equal(C.maxAddDepth([b(1, null, 0), b(4, 1, 0), b(6, 4, 0)]), 3);
  assert.equal(C.maxAddDepth([b(1, null, 0), b(4, 1, 0), b(6, 4, 0), b(5, 1, 1)]), 2);
});

test("addParentFor: leluhur butir terakhir pada tingkat depth−1; depth di-clamp", () => {
  const items = [b(1, null, 0), b(4, 1, 0), b(6, 4, 0)];
  assert.equal(C.addParentFor(items, 0), null);
  assert.equal(C.addParentFor(items, 1), 1);
  assert.equal(C.addParentFor(items, 2), 4);
  assert.equal(C.addParentFor(items, 3), 6);
  assert.equal(C.addParentFor(items, 9), 6);
  assert.equal(C.addParentFor(items, -1), null);
  const bercabang = items.concat([b(5, 1, 1)]); // butir terakhir pre-order = 5 (depth 1)
  assert.equal(C.addParentFor(bercabang, 1), 1);
  assert.equal(C.addParentFor(bercabang, 2), 5);
  assert.equal(C.addParentFor(bercabang, 3), 5);
  assert.equal(C.addParentFor(pohon(), 1), 3);
  assert.equal(C.addParentFor([], 1), null);
});

// ── auto-scroll ──────────────────────────────────────────────────────────────

test("autoScrollDelta: 40 px dari tepi atas negatif, tepi bawah positif, maks 16, 0 di tengah", () => {
  const rect = { top: 100, bottom: 500 };
  assert.equal(C.autoScrollDelta(100, rect), -16);
  assert.equal(C.autoScrollDelta(120, rect), -8);
  assert.equal(C.autoScrollDelta(139, rect), -1);
  assert.equal(C.autoScrollDelta(140, rect), 0);
  assert.equal(C.autoScrollDelta(300, rect), 0);
  assert.equal(C.autoScrollDelta(460, rect), 0);
  assert.equal(C.autoScrollDelta(461, rect), 1);
  assert.equal(C.autoScrollDelta(480, rect), 8);
  assert.equal(C.autoScrollDelta(500, rect), 16);
  assert.equal(C.autoScrollDelta(20, rect), -16);
  assert.equal(C.autoScrollDelta(900, rect), 16);
});

// ── penyimpanan lipat ────────────────────────────────────────────────────────

function memStorage(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    raw: m,
  };
}

test("lipat: simpan lalu muat kembali sebagai Set angka dengan urutan penambahan", () => {
  const s = memStorage();
  C.saveCollapsed(s, new Set([5, 2, 9]));
  assert.equal(s.raw.get("tf_check_collapsed"), "[5,2,9]");
  const got = C.loadCollapsed(s);
  assert.ok(got instanceof Set);
  assert.deepEqual([...got], [5, 2, 9]);
});

test("lipat: maksimal 500, yang paling lama ditambahkan dibuang lebih dulu", () => {
  const s = memStorage();
  const banyak = [];
  for (let i = 1; i <= 600; i++) banyak.push(i);
  const saved = C.saveCollapsed(s, banyak);
  const arr = JSON.parse(s.raw.get("tf_check_collapsed"));
  assert.equal(arr.length, 500);
  assert.equal(arr[0], 101);
  assert.equal(arr[499], 600);
  assert.deepEqual(saved, arr);
  assert.equal(C.loadCollapsed(s).size, 500);
});

test("lipat: JSON rusak / bukan array / entri bukan id → diabaikan tanpa galat", () => {
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "{rusak" }))], []);
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "{\"a\":1}" }))], []);
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "null" }))], []);
  assert.deepEqual([...C.loadCollapsed(memStorage())], []);
  // Fase 2: cid (teks bukan angka) kini id sah butir yang belum tersinkron; teks angka tetap jadi angka.
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "[1,\"2\",\"x\",null,1,{},1.5,\"\",\"  \"]" }))], [1, 2, "x"]);
});

test("lipat: id cid (butir belum tersinkron) disimpan dan dimuat apa adanya; teks kosong / > 64 karakter dibuang", () => {
  const s = memStorage();
  const cid = "0f8b6c2e-3a51-4c5e-9a4f-7d1e2b3c4d5e";
  const saved = C.saveCollapsed(s, new Set([5, cid, "7", "x".repeat(65), "", " "]));
  assert.deepEqual(saved, [5, cid, 7]);
  assert.deepEqual([...C.loadCollapsed(s)], [5, cid, 7]);
  const rows = C.visibleRows([b(cid, null, 0), b("anak", cid, 0)], C.loadCollapsed(s));
  assert.deepEqual(rows.map((r) => [r.item.id, r.collapsed]), [[cid, true]]);
});

test("lipat: storage melempar atau null → set kosong, simpan tidak melempar", () => {
  const melempar = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceeded"); } };
  assert.deepEqual([...C.loadCollapsed(melempar)], []);
  assert.doesNotThrow(() => C.saveCollapsed(melempar, [1, 2]));
  assert.deepEqual([...C.loadCollapsed(null)], []);
  assert.doesNotThrow(() => C.saveCollapsed(null, [1]));
  assert.doesNotThrow(() => C.saveCollapsed(memStorage(), null));
});

// ── kunci Progress ───────────────────────────────────────────────────────────

test("lockFor: hitungan dimuat dan total > 0 → {done,total,percent}", () => {
  assert.deepEqual(C.lockFor({ checklist_total: 5 }, { done: 3, total: 5, loaded: true }), { done: 3, total: 5, percent: 60 });
  assert.deepEqual(C.lockFor({}, { done: 1, total: 3, loaded: true }), { done: 1, total: 3, percent: 33 });
});

test("lockFor: belum dimuat dan task.checklist_total > 0 → {pending:true}", () => {
  assert.deepEqual(C.lockFor({ checklist_total: 2 }, null), { pending: true });
  assert.deepEqual(C.lockFor({ checklist_total: 2 }, { done: 0, total: 0, loaded: false }), { pending: true });
});

test("lockFor: muat gagal (counts.failed) dan task.checklist_total > 0 → {pending:true}; tanpa checklist_total → null", () => {
  assert.deepEqual(C.lockFor({ checklist_total: 3 }, { done: 0, total: 0, loaded: true, failed: true }), { pending: true });
  assert.equal(C.lockFor({ checklist_total: 0 }, { done: 0, total: 0, loaded: true, failed: true }), null);
  assert.equal(C.lockFor({}, { done: 0, total: 0, loaded: true, failed: true }), null);
});

test("lockFor: selain itu null (termasuk dimuat dengan total 0 walau checklist_total basi)", () => {
  assert.equal(C.lockFor({ checklist_total: 4 }, { done: 0, total: 0, loaded: true }), null);
  assert.equal(C.lockFor({ checklist_total: 0 }, null), null);
  assert.equal(C.lockFor({}, null), null);
  assert.equal(C.lockFor(null, null), null);
});

// ── kedalaman ekstrem ────────────────────────────────────────────────────────

test("2.000 tingkat: semua fungsi pohon iteratif tanpa RangeError", () => {
  const n = 2000;
  const items = rantai(n);
  const out = C.preorder(items);
  assert.equal(out.length, n);
  assert.equal(out[n - 1].depth, n - 1);
  assert.equal(C.descendantIds(items, 1).length, n - 1);
  assert.equal(C.visibleRows(items, new Set()).length, n);
  assert.equal(C.visibleRows(items, new Set([1])).length, 1);
  assert.deepEqual(C.topLevelCounts(items), { done: 0, total: 1 });
  assert.equal(C.maxAddDepth(items), n);
  assert.equal(C.addParentFor(items, 1), 1);
  assert.deepEqual(C.outdentTarget(items, n), { parent_id: n - 2, index: 1 });
  const moved = C.applyMove(items, n, null, 0);
  assert.deepEqual([moved[0].id, moved[0].depth, moved[n - 1].depth], [n, 0, n - 2]);
  const rows = tanpaSubtree(C.visibleRows(items, new Set()), items, n);
  assert.deepEqual(C.dropTarget(items, rows, n, 0, 0), { parent_id: null, index: 0 });
  const siklus = items.map((r) => (r.id === 1 ? Object.assign({}, r, { parent_id: n }) : r));
  assert.equal(C.preorder(siklus).length, n);
});

// ── adoptTaskProgress (Task 2; spec §7.8, ADR-048) ───────────────────────────
// Menulis progress/checklist_total ke record task lokal (dicari lewat _idmap) TANPA menyentuh dirty/rev/base_rev/
// updated_at/ext — angka ini field turunan server, bukan editan pengguna.

const { deleteDB } = require("./setup.js");
const TFdb = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");

async function siapkanTask(rec, serverId) {
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
  const db = await TFdb.openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put(rec);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  if (serverId != null) await mapPut("task", serverId, rec.cid);
}
async function bacaTask(cid) {
  const db = await TFdb.openDB();
  return new Promise((res) => { const q = db.transaction("tasks").objectStore("tasks").get(cid); q.onsuccess = () => res(q.result); });
}
function rekam(over) {
  return Object.assign({
    cid: "t1", server_id: 7, title: "T", progress: 10, checklist_total: 0, dirty: 0, rev: 3,
    base_rev: "2026-11-01T00:00:00", updated_at: "2026-11-01T00:00:00", ext: { "demo-ext.a": 1 }, deleted: false,
  }, over || {});
}

test("adoptTaskProgress: menulis progress dan checklist_total tanpa mengubah dirty/rev/base_rev/updated_at/ext", async () => {
  await siapkanTask(rekam(), 7);
  assert.equal(await C.adoptTaskProgress(7, { done: 1, total: 3, progress: 33 }), true);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [33, 3]);
  assert.deepEqual([r.dirty, r.rev, r.base_rev, r.updated_at], [0, 3, "2026-11-01T00:00:00", "2026-11-01T00:00:00"]);
  assert.deepEqual(r.ext, { "demo-ext.a": 1 });
  assert.equal(r.title, "T");
});

test("adoptTaskProgress: nilai sama → tanpa tulis (false)", async () => {
  await siapkanTask(rekam({ progress: 33, checklist_total: 3 }), 7);
  assert.equal(await C.adoptTaskProgress(7, { done: 1, total: 3, progress: 33 }), false);
  assert.equal(await C.adoptTaskProgress("7", { done: 1, total: 3, progress: 33 }), false);
  assert.equal("checklist_adopted_at" in (await bacaTask("t1")), false);
});

test("adoptTaskProgress: menulis cap waktu lokal checklist_adopted_at (penjaga pull basi) tanpa dirty/rev", async () => {
  await siapkanTask(rekam(), 7);
  const sebelum = Date.now();
  assert.equal(await C.adoptTaskProgress(7, { done: 2, total: 3, progress: 67 }), true);
  const r = await bacaTask("t1");
  assert.equal(typeof r.checklist_adopted_at, "number");
  assert.ok(r.checklist_adopted_at >= sebelum && r.checklist_adopted_at <= Date.now());
  assert.deepEqual([r.dirty, r.rev], [0, 3]);
});

test("checklist_adopted_at tidak ikut payload push (create maupun update)", () => {
  const TFpush = require("../../static/offline/syncpush.js");
  const rec = rekam({ checklist_adopted_at: 123, checklist_total: 3, progress: 67, gtd_status: "next", priority: "P3" });
  const upd = TFpush.taskToUpdatePayload(rec, [], [], []);
  const cre = TFpush.taskToCreatePayload(rec, [], null, [], []);
  for (const pl of [upd, cre]) {
    assert.equal("checklist_adopted_at" in pl, false);
    assert.equal("checklist_total" in pl, false);
  }
});

test("adoptTaskProgress: id server berupa string dipetakan sama", async () => {
  await siapkanTask(rekam(), 7);
  assert.equal(await C.adoptTaskProgress("7", { done: 2, total: 2, progress: 100 }), true);
  assert.equal((await bacaTask("t1")).progress, 100);
});

test("adoptTaskProgress: id tidak dikenal / tp tidak sah → false tanpa galat", async () => {
  await siapkanTask(rekam(), 7);
  assert.equal(await C.adoptTaskProgress(99, { done: 0, total: 1, progress: 0 }), false);
  assert.equal(await C.adoptTaskProgress(null, { done: 0, total: 1, progress: 0 }), false);
  assert.equal(await C.adoptTaskProgress(7, null), false);
  assert.equal(await C.adoptTaskProgress(7, {}), false);
  assert.equal(await C.adoptTaskProgress(7, { done: 0, total: "x", progress: 5 }), false);
  assert.equal(await C.adoptTaskProgress(7, { done: 0, total: -1, progress: 5 }), false);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [10, 0]);
});

test("adoptTaskProgress: record dirty tetap dirty (rev tetap), nilai progress ikut diperbarui", async () => {
  await siapkanTask(rekam({ dirty: 1, rev: 5 }), 7);
  assert.equal(await C.adoptTaskProgress(7, { done: 3, total: 5, progress: 60 }), true);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total, r.dirty, r.rev], [60, 5, 1, 5]);
});

test("adoptTaskProgress: progress null/bukan angka → hanya checklist_total diperbarui", async () => {
  await siapkanTask(rekam({ progress: 42, checklist_total: 2 }), 7);
  assert.equal(await C.adoptTaskProgress(7, { done: 0, total: 0, progress: null }), true);
  let r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [42, 0]);
  assert.equal(await C.adoptTaskProgress(7, { done: 1, total: 4, progress: "x" }), true);
  r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [42, 4]);
});

test("adoptTaskProgress: total 0 (level atas terakhir dihapus) → checklist_total 0, progress = nilai terakhir (K11)", async () => {
  await siapkanTask(rekam({ progress: 50, checklist_total: 2 }), 7);
  assert.equal(await C.adoptTaskProgress(7, { done: 0, total: 0, progress: 50 }), true);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [50, 0]);
});

test("adoptTaskProgress: ext, ext_dirty, dan penanda ext saja tidak disentuh", async () => {
  const X = require("../../static/offline/taskext.js");
  const rec = rekam({ dirty: 1, rev: 6, ext: { "demo-ext.a": 2 }, ext_dirty: ["demo-ext.a"] });
  rec[X.EXT_ONLY_KEY] = 6;
  await siapkanTask(rec, 7);
  assert.equal(X.extOnlyNow(await bacaTask("t1")), true);
  assert.equal(await C.adoptTaskProgress(7, { done: 1, total: 2, progress: 50 }), true);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [50, 2]);
  assert.deepEqual(r.ext, { "demo-ext.a": 2 });
  assert.deepEqual(r.ext_dirty, ["demo-ext.a"]);
  assert.equal(r[X.EXT_ONLY_KEY], 6);
  assert.equal(X.extOnlyNow(r), true);
  assert.deepEqual([r.dirty, r.rev], [1, 6]);
});

test("adoptTaskProgress saat push berjalan: setelah respons PUT record bersih dan progress tidak tertimpa", async () => {
  const { outboxAdd, outboxAll } = require("../../static/offline/outbox.js");
  const TFpush = require("../../static/offline/syncpush.js");
  await siapkanTask(rekam({ cid: "q1", server_id: 9, progress: 10, quadrant: "Q4", gtd_status: "next", dirty: 1, rev: 4 }), 9);
  await outboxAdd({ op: "update", entity_type: "task", cid: "q1", payload: {} });
  let lepas;
  const gerbang = new Promise((r) => { lepas = r; });
  const minta = [];
  const transport = {
    request: (method, url, body) => {
      minta.push([method, url, body && body.progress]);
      // Respons PUT dibuat server SEBELUM centang (progress lama 10), tiba SETELAH adopsi progress baru.
      return gerbang.then(() => ({ status: 200, data: {
        id: 9, title: "T", gtd_status: "next", quadrant: "Q4", progress: 10, checklist_total: 3,
        updated_at: "2026-11-02T00:00:00", created_at: "2026-11-01T00:00:00",
      } }));
    },
  };
  const push = TFpush.pushOutbox(transport);
  for (let i = 0; i < 50 && !minta.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(minta.length, 1, "PUT harus sudah terkirim sebelum adopsi");
  assert.equal(await C.adoptTaskProgress(9, { done: 2, total: 3, progress: 67 }), true);
  lepas();
  await push;
  const r = await bacaTask("q1");
  assert.deepEqual([r.dirty, r.rev, r.progress, r.checklist_total, r.base_rev], [0, 4, 67, 3, "2026-11-02T00:00:00"]);
  assert.equal((await outboxAll()).length, 0);
});

// writeTaskProgress (Fase 2, rencana PR B2 R2): inti adoptTaskProgress dengan cid task lokal — dipakai checklistrepo
// untuk progress hasil aksi lokal (task belum tersinkron tidak punya id server). Satu-satunya penulis store tasks di
// checklist.js tetap satu (pagar penulis).

test("writeTaskProgress: menulis progress/checklist_total + cap checklist_adopted_at lewat cid, tanpa dirty/rev/base_rev", async () => {
  await siapkanTask(rekam({ server_id: null, dirty: 1, rev: 4 }), null);
  const sebelum = Date.now();
  assert.equal(await C.writeTaskProgress("t1", { done: 1, total: 2, progress: 50 }), true);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total, r.dirty, r.rev, r.base_rev, r.updated_at],
    [50, 2, 1, 4, "2026-11-01T00:00:00", "2026-11-01T00:00:00"]);
  assert.ok(r.checklist_adopted_at >= sebelum);
  assert.equal(await C.writeTaskProgress("t1", { done: 1, total: 2, progress: 50 }), false, "nilai sama → tanpa tulis");
});

test("writeTaskProgress: cid tidak ada / tp tidak sah → false; progress null → hanya checklist_total", async () => {
  await siapkanTask(rekam({ progress: 42, checklist_total: 2 }), 7);
  assert.equal(await C.writeTaskProgress("nihil", { done: 0, total: 1, progress: 0 }), false);
  assert.equal(await C.writeTaskProgress(null, { done: 0, total: 1, progress: 0 }), false);
  assert.equal(await C.writeTaskProgress("t1", { done: 0, total: -1, progress: 0 }), false);
  assert.equal(await C.writeTaskProgress("t1", null), false);
  assert.equal(await C.writeTaskProgress("t1", { done: 0, total: 0, progress: null }), true);
  const r = await bacaTask("t1");
  assert.deepEqual([r.progress, r.checklist_total], [42, 0]);
});

test("writeTaskProgress: adoptTaskProgress memakainya (satu penulis store tasks di checklist.js)", () => {
  const kode = fs.readFileSync(SRC, "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.equal((kode.match(/TFdb\.mutate\(/g) || []).length, 1);
  assert.match(kode, /function adoptTaskProgress[\s\S]*?writeTaskProgress\(/);
});

test("adoptTaskProgress: record task tidak ada walau idmap ada → false", async () => {
  await siapkanTask(rekam({ cid: "lain" }), null);
  await mapPut("task", 8, "hilang");
  assert.equal(await C.adoptTaskProgress(8, { done: 1, total: 1, progress: 100 }), false);
});

test("adoptTaskProgress: di browser memakai TF.idmap dan TF.db (dibaca saat dipanggil)", async () => {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), ctx);
  const ditulis = [];
  ctx.self.TF.idmap = { cidOf: (type, id) => Promise.resolve(type === "task" && id === 5 ? "c5" : undefined) };
  ctx.self.TF.db = {
    mutate: (store, key, fn) => {
      const next = fn({ cid: key, progress: 0, checklist_total: 0, dirty: 0, rev: 1 });
      if (next) ditulis.push([store, key, next.progress, next.checklist_total, next.rev]);
      return Promise.resolve(next || null);
    },
  };
  assert.equal(await ctx.self.TF.checklist.adoptTaskProgress(5, { done: 1, total: 2, progress: 50 }), true);
  assert.equal(await ctx.self.TF.checklist.adoptTaskProgress(6, { done: 1, total: 2, progress: 50 }), false);
  assert.deepEqual(ditulis, [["tasks", "c5", 50, 2, 1]]);
});
