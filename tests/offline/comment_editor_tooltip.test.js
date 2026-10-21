"use strict";

// Komentar note — perbaikan tumpang-tindih di editor: tooltip format Milkdown (B/I/S/<>) dan
// gelembung "Komentari" dulu sama-sama memosisikan diri di atas seleksi sehingga saling menutupi.
// Sekarang di editor desktop tombol "Komentari" menjadi bagian tooltip format (satu toolbar);
// gelembung terpisah di NoteModal hanya dipakai di layar sentuh (bar bawah). Cek sumber index.html.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("MilkdownEditor: prop onCommentSelection disimpan di ref (nilai terbaru)", () => {
  const src = fnSource("MilkdownEditor");
  assert.match(src, /^\s*onCommentSelection = null\b/m);
  assert.match(src, /const onCommentSelectionRef = React\.useRef\(onCommentSelection\)/);
  assert.match(src, /onCommentSelectionRef\.current = onCommentSelection/);
});

test("MilkdownEditor: tooltip format memuat tombol Komentari (bukan elemen terpisah)", () => {
  const src = fnSource("MilkdownEditor");
  assert.match(src, /milkdown-tooltip-cmt/);
  assert.match(src, /tooltipEl\.appendChild\(cmtSepEl\)/);
  assert.match(src, /tooltipEl\.appendChild\(cmtBtnEl\)/);
  assert.match(src, /'Komentari'/);
  // tampil hanya bila host memberi handler dan bukan UI sentuh (sentuh memakai bar bawah)
  assert.match(src, /cmtBtnEl\.hidden = cmtSepEl\.hidden = !\(onCommentSelectionRef\.current && !isTouchUI\)/);
  // klik: teks seleksi DOM → handler host; mousedown tidak mencuri seleksi
  const at = src.indexOf("cmtBtnEl.addEventListener('click'");
  assert.ok(at > 0, "click handler");
  const body = src.slice(at, at + 900);
  assert.match(body, /window\.getSelection\(\)/);
  assert.match(body, /onCommentSelectionRef\.current\(/);
});

test("NoteModal: editor meneruskan onCommentSelection; gelembung terpisah hanya untuk sentuh", () => {
  const src = fnSource("NoteModal");
  assert.match(src, /onCommentSelection: cmtNote \? text => \{/);
  assert.match(src, /window\.TF\.commentui\.normalizeQuote\(text\)/);
  assert.match(src, /React\.createElement\(CommentSelectionBubble, \{\s*containerRef: paperWrapRef,\s*touchOnly: true,/);
});

test("NotePanel (pembaca, tanpa tooltip format) tetap memakai gelembung desktop", () => {
  const src = fnSource("NotePanel");
  const at = src.indexOf("React.createElement(CommentSelectionBubble");
  assert.ok(at > 0);
  assert.doesNotMatch(src.slice(at, at + 200), /touchOnly/);
});

test("CommentSelectionBubble: touchOnly → tidak merender gelembung di desktop", () => {
  const src = fnSource("CommentSelectionBubble");
  assert.match(src, /^\s*touchOnly = false\b/m);
  assert.match(src, /if \(!sel \|\| touchOnly && !touch\) return null;/);
});

test("CSS: pemisah + tombol Komentari di tooltip", () => {
  assert.match(appCss, /\.milkdown-tooltip-sep \{/);
  assert.match(appCss, /\.milkdown-tooltip-btn\.milkdown-tooltip-cmt \{/);
  assert.match(appCss, /\.milkdown-tooltip \[hidden\] \{ display: none !important; \}/);
});
