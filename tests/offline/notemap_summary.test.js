"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const NM = require("../../static/offline/notemap.js");

test("spec example", () => {
  const s = NM.summarizeSection("Fokus ke kanal organik dulu karena biaya iklan naik. Target tiga bulan pertama adalah 1.000 pengguna aktif.\n- [ ] Riset kata kunci\n- [x] Buat kalender konten\n- [ ] Kerja sama komunitas\n");
  assert.equal(s.excerpt, "Fokus ke kanal organik dulu karena biaya iklan naik.");
  assert.deepEqual(s.items, ["Riset kata kunci", "Buat kalender konten", "Kerja sama komunitas"]);
  assert.equal(s.more, 0);
  assert.deepEqual(s.counts, { checkDone: 1, checkTotal: 3, images: 0, tables: 0 });
});
test("decimal not split; short sentence merges within paragraph", () => {
  assert.equal(NM.summarizeSection("Target 1.000 pengguna aktif. Lainnya.").excerpt, "Target 1.000 pengguna aktif.");
  assert.equal(NM.summarizeSection("Oke. Ini kalimat kedua yang cukup panjang.").excerpt, "Oke. Ini kalimat kedua yang cukup panjang.");
});
test("excerpt truncates at a word boundary", () => {
  const ex = NM.summarizeSection(("kata ").repeat(60) + "akhir.").excerpt;
  assert.ok(ex.length <= 121 && ex.endsWith("…") && !ex.endsWith(" …"));
});
test("items capped at 3 with more, each ≤ 40 chars", () => {
  const s = NM.summarizeSection("- satu\n- dua\n- tiga\n- empat\n- " + "panjang ".repeat(10) + "\n");
  assert.deepEqual(s.items, ["satu", "dua", "tiga"]); assert.equal(s.more, 2);
  const long = NM.summarizeSection("- " + "panjang ".repeat(10) + "\n").items[0];
  assert.ok(long.length <= 41 && long.endsWith("…"));
});
test("cleaning: wikilinks, links, formatting, images, draw, tasklink, code, callout, toggle", () => {
  const s = NM.summarizeSection("Lihat [[Catatan Lain]] dan [situs](http://x) untuk **detail**. ![g](a.png)\n::draw[abc]{title=\"G\"}\n[tasklink:xyz]\n```js\nconst a = 1;\n```\n");
  assert.equal(s.excerpt, "Lihat Catatan Lain dan situs untuk detail.");
  assert.equal(s.counts.images, 2);
  assert.equal(NM.summarizeSection("> [!NOTE]\n> Penting sekali untuk dibaca.\n").excerpt, "Penting sekali untuk dibaca.");
  assert.equal(NM.summarizeSection("<details>\n<summary>Ringkas</summary>\n\nIsi toggle.\n</details>\n").excerpt, "Ringkas");
});
test("counts tables and nested checklists; empty → null", () => {
  const s = NM.summarizeSection("| a | b |\n|---|---|\n| 1 | 2 |\n- [x] a\n  - [ ] b\n");
  assert.deepEqual(s.counts, { checkDone: 1, checkTotal: 2, images: 0, tables: 1 });
  assert.equal(NM.summarizeSection("  \n\n"), null);
  assert.equal(NM.summarizeSection("```\nkode saja\n```\n"), null);
});
test("no quadratic regex blow-up on pathological bodies (each < 200 ms)", () => {
  const time = (s) => { const t0 = performance.now(); NM.summarizeSection(s); return performance.now() - t0; };
  for (const s of ["a<b ".repeat(50000), "[a".repeat(50000), "![".repeat(50000), "[](".repeat(30000), "::draw[".repeat(12000),
    "::draw[]{".repeat(10000), "[tasklink:".repeat(8000), "[[".repeat(40000), "|a\n|" + "-".repeat(80000) + "x\n", "> ".repeat(40000) + "x"]) {
    const ms = time(s); assert.ok(ms < 200, JSON.stringify(s.slice(0, 12)) + " took " + ms.toFixed(0) + " ms");
  }
});
test("bounded patterns still clean ordinary markup", () => {
  const s = NM.summarizeSection("Lihat <b>tebal</b> [[Wiki]] [teks](http://u/a) ![g](a.png) ::draw[x]{t=1} [tasklink:q] akhir.\n|a|\n|:-:|\n");
  assert.equal(s.excerpt, "Lihat tebal Wiki teks akhir.");
  assert.equal(s.counts.images, 2); assert.equal(s.counts.tables, 1);
});
