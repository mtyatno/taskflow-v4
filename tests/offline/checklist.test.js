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
    "addParentFor", "autoScrollDelta", "loadCollapsed", "saveCollapsed", "lockFor"]) {
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
  test("applyMove vektor: " + vec.name, () => {
    const out = C.applyMove(vec.rows, vec.move.id, vec.move.parent_id, vec.move.index);
    assert.deepEqual(out.map((r) => [r.id, r.depth, r.parent_id, r.sort_order]), vec.expected);
  });
}

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

test("applyMove: parent_id undefined = level atas; index desimal dipotong seperti int() Python", () => {
  const items = pohon();
  assert.deepEqual(ids(C.applyMove(items, 4, undefined, 1)), [1, 5, 4, 6, 2, 3]);
  assert.deepEqual(ids(C.applyMove(items, 3, null, 1.9)), [1, 4, 6, 5, 3, 2]);
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

test("lipat: JSON rusak / bukan array / entri bukan angka → diabaikan tanpa galat", () => {
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "{rusak" }))], []);
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "{\"a\":1}" }))], []);
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "null" }))], []);
  assert.deepEqual([...C.loadCollapsed(memStorage())], []);
  assert.deepEqual([...C.loadCollapsed(memStorage({ tf_check_collapsed: "[1,\"2\",\"x\",null,1]" }))], [1, 2]);
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
