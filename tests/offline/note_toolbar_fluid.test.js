"use strict";
// Task 2b (2026-10-23): toolbar editor note fluid — satu baris bila muat, wrap ke baris kedua bila tidak;
// tidak pernah scroll horizontal / meluber keluar layar; label tombol disembunyikan (ikon saja) saat sempit.
// Source assertions pada static/app.css dan NoteToolbar di static/index.html.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function toolbarSrc() {
  const i = html.indexOf("function NoteToolbar(");
  assert.ok(i >= 0, "NoteToolbar tidak ditemukan");
  const j = html.indexOf("\nfunction ", i + 10);
  return html.slice(i, j > i ? j : i + 40000);
}

// Semua deklarasi untuk selector `.note-toolbar` persis (di luar maupun di dalam @media / @container).
function ruleBodies(src, selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sels = m[1].split(",").map(s => s.trim());
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

// Isi blok at-rule bertingkat satu (mis. @media (max-width: 768px) { ... }).
function atBlocks(src, head) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = src.indexOf(head, from);
    if (i < 0) break;
    const open = src.indexOf("{", i);
    let depth = 0, k = open;
    for (; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}") { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(open + 1, k));
    from = k + 1;
  }
  return out;
}

test(".note-toolbar membungkus (flex-wrap: wrap) dengan row-gap, tanpa nowrap", () => {
  const bodies = ruleBodies(css, ".note-toolbar");
  assert.ok(bodies.length >= 1, "aturan .note-toolbar tidak ada");
  const all = bodies.join(";");
  assert.match(all, /flex-wrap:\s*wrap\b/);
  assert.doesNotMatch(all, /flex-wrap:\s*nowrap/, ".note-toolbar tidak boleh nowrap (di mana pun)");
  assert.match(all, /row-gap:\s*\d+px/);
  assert.match(all, /max-width:\s*100%/);
  assert.match(all, /min-width:\s*0/);
});

test(".note-toolbar tidak pernah overflow-x auto/scroll (juga di media query HP) — dropdown tidak terpotong", () => {
  const all = ruleBodies(css, ".note-toolbar").join(";");
  assert.doesNotMatch(all, /overflow(-x)?:\s*(auto|scroll|hidden)/);
  for (const b of atBlocks(css, "@media")) {
    for (const body of ruleBodies(b, ".note-toolbar")) {
      assert.doesNotMatch(body, /overflow(-x)?:\s*(auto|scroll)/, "media query masih membuat toolbar scroll horizontal");
    }
  }
  assert.doesNotMatch(css, /\.note-toolbar::-webkit-scrollbar/, "sisa scrollbar tersembunyi toolbar harus dihapus");
});

test("container query: toolbar adalah container notetb dan label .ntb-label disembunyikan saat sempit", () => {
  const all = ruleBodies(css, ".note-toolbar").join(";");
  assert.match(all, /container:\s*notetb\s*\/\s*inline-size/);
  const blocks = atBlocks(css, "@container notetb (max-width:");
  assert.ok(blocks.length >= 1, "@container notetb (max-width: …) tidak ada");
  assert.ok(blocks.some(b => /\.ntb-label\s*\{[^}]*display:\s*none/.test(b)), "label tidak disembunyikan di container sempit");
  // Toolbar tidak boleh jadi stacking context sendiri: z-index pada .note-toolbar akan mengurung dropdown
  // (z-index 300/1000) di bawah block handle (30) / footer sticky (10) modal.
  assert.doesNotMatch(all, /z-index\s*:/, ".note-toolbar tidak boleh ber-z-index");
});

// Ambang hasil pengukuran (temporary_files/e2e_note_toolbar_fluid.py, Chromium): isi berlabel butuh lebar
// toolbar >= 472px untuk 2 baris → label disembunyikan di <= 519px (margin ±10% untuk metrik font perangkat);
// isi ikon-saja (padding rapat) 2 baris mulai lebar toolbar ±290px (viewport 360).
test("container sempit (<= 519px): label disembunyikan, padding tombol & margin pemisah dirapatkan", () => {
  const blocks = atBlocks(css, "@container notetb (max-width: 519px)");
  assert.equal(blocks.length, 1, "@container notetb (max-width: 519px) harus ada tepat satu");
  const b = blocks[0];
  assert.match(b, /\.note-toolbar \.ntb-label\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(b, /\.note-toolbar button\s*\{\s*padding:\s*0 5px;?\s*\}/);
  assert.match(b, /\.note-toolbar \.sep\s*\{\s*margin:\s*2px 1px;?\s*\}/);
});

test("tombol berlabel memakai span.ntb-label dan punya title + aria-label bermakna", () => {
  const src = toolbarSrc();
  for (const label of ["Template", "Task", "Sketsa", "Wiki", "Media", "File", "Kertas"]) {
    const span = new RegExp('className:\\s*"ntb-label"[^)]*\\}\\s*,\\s*"' + label + '"\\)');
    assert.match(src, span, "label " + label + " tidak memakai span.ntb-label");
    assert.match(src, new RegExp('"aria-label":\\s*"' + label + '"'), "aria-label " + label + " tidak ada");
  }
  // title tetap ada untuk tombol-tombol tersebut
  for (const t of ["Terapkan template", "Tambah link task inline", "Sisipkan sketsa yang ada atau buat sketsa baru",
                   "Mode Kertas", "Internal link [[wiki]]"]) {
    assert.ok(src.includes('title: "' + t + '"'), "title hilang: " + t);
  }
  assert.match(src, /title: onInsertMedia \? "Sisipkan media: gambar, audio, atau video" : "Sisipkan gambar"/);
  assert.match(src, /title: noteId \? "Lampirkan file \(PDF, dokumen, spreadsheet\)" : "Simpan note dulu"/);
});

test("dropdown Heading ditandai data-ntb-pop dan dijaga tetap di dalam toolbar (geser kiri bila meluber)", () => {
  const src = toolbarSrc();
  assert.match(src, /"data-ntb-pop": "heading"/);
  assert.match(html, /\nfunction keepPopInToolbar\(anchor\) \{[\s\S]{0,600}?closest\(".note-toolbar"\)/);
  assert.match(src, /React\.useLayoutEffect\(\(\) => \{\s*if \(hOpen\) keepPopInToolbar\(hRef\.current\)/);
});

// Permintaan Bapak 2026-10-23 05:55: tombol "+" (Format lainnya) dan dropdown-nya dihapus; isinya jadi tombol biasa.
test("tombol + Format lainnya dihapus (tanpa moreOpen/moreRef/data-ntb-pop more)", () => {
  const src = toolbarSrc();
  assert.doesNotMatch(src, /Format lainnya/);
  assert.doesNotMatch(src, /moreOpen|setMoreOpen|moreRef/);
  assert.doesNotMatch(src, /"data-ntb-pop": "more"/);
  assert.doesNotMatch(src, /name: "plus"/, "ikon + tidak lagi dipakai di toolbar");
});

function btnBody(src, title) {
  const t = src.indexOf('title: "' + title + '"');
  assert.ok(t >= 0, "tombol tidak ada: " + title);
  const s = src.lastIndexOf('React.createElement("button", {', t);
  const e = src.indexOf("/*#__PURE__*/", t);
  return { start: s, title: t, body: src.slice(s, e > t ? e : t + 400) };
}

test("Numbered/Strikethrough/Table/Wiki tampil langsung di toolbar, perintah sama seperti dulu di dropdown", () => {
  const src = toolbarSrc();
  const cases = [
    ["Numbered list", /cmd\(window\.MilkdownBundle\?\.wrapInOrderedListCommand\?\.key\)/, "listOrdered"],
    ["Strikethrough", /cmd\(window\.MilkdownBundle\?\.toggleStrikethroughCommand\?\.key\)/, "strikethrough"],
    ["Insert table", /cmd\(window\.MilkdownBundle\?\.insertTableCommand\?\.key\)/, "table"],
    ["Internal link [[wiki]]", /insertText\('\[\['\)/, "link"],
  ];
  for (const [title, call, icon] of cases) {
    const b = btnBody(src, title).body;
    assert.match(b, /onPointerDown: e => \{\s*e\.preventDefault\(\);/, title + ": onPointerDown + preventDefault");
    assert.match(b, call, title + ": perintah");
    assert.ok(b.includes('name: "' + icon + '"'), title + ": ikon " + icon);
  }
});

test("urutan: Strikethrough setelah Inline code, Numbered setelah Bullet, Table+Wiki di kelompok sisip setelah Sketsa", () => {
  const src = toolbarSrc();
  const pos = t => btnBody(src, t).title;
  const between = (a, b) => src.slice(pos(a) + 1, btnBody(src, b).start);
  // bersebelahan langsung (tanpa sep di antaranya)
  assert.ok(pos("Inline code") < pos("Strikethrough"));
  assert.doesNotMatch(between("Inline code", "Strikethrough"), /className: "sep"|title: "/);
  assert.ok(pos("Bullet list") < pos("Numbered list"));
  assert.doesNotMatch(between("Bullet list", "Numbered list"), /className: "sep"|title: "/);
  assert.ok(pos("Numbered list") < pos("Checklist / Task"));
  // Sketsa | sep | Table Wiki | sep | Horizontal rule
  const sk = pos("Sisipkan sketsa yang ada atau buat sketsa baru");
  assert.ok(sk < pos("Insert table") && pos("Insert table") < pos("Internal link [[wiki]]")
    && pos("Internal link [[wiki]]") < pos("Horizontal rule"));
  assert.equal((between("Sisipkan sketsa yang ada atau buat sketsa baru", "Insert table").match(/className: "sep"/g) || []).length, 1);
  assert.doesNotMatch(between("Insert table", "Internal link [[wiki]]"), /className: "sep"|title: "/);
  assert.equal((between("Internal link [[wiki]]", "Horizontal rule").match(/className: "sep"/g) || []).length, 1);
});
