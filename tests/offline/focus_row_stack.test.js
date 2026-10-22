"use strict";

// Baris task halaman Fokus di HP (<= 768 px): ⭐, Fokus, chevron ditumpuk dalam satu kolom vertikal
// di kanan agar judul mendapat sisa lebar. Desktop/tablet > 768 px dan urutan DOM tidak berubah.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function mediaBlocks(query) {
  const out = [];
  let i = 0;
  while ((i = css.indexOf("@media " + query, i)) >= 0) {
    const open = css.indexOf("{", i);
    let depth = 1, j = open + 1;
    while (depth && j < css.length) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
    out.push(css.slice(open + 1, j - 1));
    i = j;
  }
  return out;
}
const SEL = ".ftask-row:not(.is-static)";
function stackBlock() {
  const blocks = mediaBlocks("(max-width: 768px)").filter(b => b.includes(SEL + " {"));
  assert.equal(blocks.length, 1, "satu blok @media (max-width: 768px) untuk kolom tombol baris task");
  return blocks[0];
}
function rule(block, sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = block.match(new RegExp("(^|\\n)\\s*" + esc + " \\{([^}]*)\\}"));
  assert.ok(m, "aturan " + sel + " harus ada");
  return m[2];
}
const px = (decl, prop) => { const m = decl.match(new RegExp("(^|[ ;])" + prop + ": (\\d+)px")); return m ? Number(m[2]) : null; };

test("urutan DOM baris: judul, ⭐, Fokus, chevron (tidak berubah)", () => {
  const start = indexHtml.indexOf('className: "ftask-row",');
  const end = indexHtml.indexOf('className: "ftask-panel"', start);
  const src = indexHtml.slice(start, end);
  const iMain = src.indexOf('className: "ftask-main"');
  const iStar = src.indexOf("className: `ftask-star");
  const iFocus = src.indexOf("className: `ftask-focus-btn");
  const iChev = src.indexOf('className: "ftask-chevron"');
  assert.ok(iMain > 0 && iMain < iStar && iStar < iFocus && iFocus < iChev);
});

test("HP: baris task jadi grid — judul di kolom tengah selebar sisa, tombol satu kolom kanan", () => {
  const b = stackBlock();
  const row = rule(b, SEL);
  assert.match(row, /display: grid/);
  assert.match(row, /grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(row, /grid-template-rows: auto auto auto 1fr/, "baris ke-4 fleksibel menyerap tinggi judul agar tombol tetap rapat di atas");
  assert.match(row, /align-items: start/, "kolom tombol rata atas");
  assert.match(rule(b, SEL + " > .check-btn"), /grid-column: 1; grid-row: 1 \/ -1/);
  assert.match(rule(b, SEL + " > .ftask-main"), /grid-column: 2; grid-row: 1 \/ -1/);
});

test("HP: urutan atas→bawah ⭐ (baris 1), Fokus (baris 2), chevron (baris 3) di kolom 3; target sentuh ≥ 32 px", () => {
  const b = stackBlock();
  const rows = { ".ftask-star": 1, ".ftask-focus-btn": 2, ".ftask-chevron": 3 };
  for (const [cls, n] of Object.entries(rows)) {
    const d = rule(b, SEL + " > " + cls);
    assert.match(d, new RegExp("grid-column: 3; grid-row: " + n + ";"), cls);
    assert.ok(px(d, "width") >= 32 && px(d, "height") >= 32, cls + " ≥ 32 px");
  }
  assert.match(rule(b, SEL + " > .ftask-star"), /margin: 0/);
  assert.match(rule(b, SEL + " > .ftask-chevron"), /margin: 0/, "margin-top lama chevron dinetralkan");
});

test("desktop/tablet: aturan dasar baris tetap horizontal (flex)", () => {
  assert.match(css, /\n\.ftask-row \{ display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px; cursor: pointer; \}/);
  assert.match(css, /\n\.ftask-star \{ display: inline-flex;[^}]*width: 36px; height: 36px;/);
  // tidak ada aturan grid baris task di luar blok HP
  const outside = css.split("@media").map((s, i) => (i === 0 ? s : "")).join("");
  assert.ok(!outside.includes(SEL));
  // aturan statis (Berulang hari ini) tidak disentuh
  assert.ok(!css.includes(".ftask-row.is-static { display: grid"));
});
