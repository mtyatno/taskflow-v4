"use strict";

// Komentar note (PR 3, Task 4): panel komentar dipasang di pembaca (NotePanel) dan editor (NoteModal),
// tombol header, gelembung seleksi, sorotan CSS Custom Highlight. Cek sumber: index.html dibaca sebagai teks.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

// Ambang panel samping per host: pembaca 760px (mockup jendela 1360px), editor 900px.
const WIDE_PX = { NotePanel: 760, NoteModal: 900 };

for (const host of ["NotePanel", "NoteModal"]) {
  test(`${host} memasang tombol, panel, gelembung seleksi, dan sorotan`, () => {
    const src = fnSource(host);
    assert.match(src, /React\.createElement\(NoteCommentsButton\b/);
    assert.match(src, /React\.createElement\(NoteCommentsPanel\b/);
    assert.match(src, /React\.createElement\(CommentSelectionBubble\b/);
    assert.match(src, /TF\.commenthighlight\.apply\(/);
    assert.match(src, /TF\.commenthighlight\.clear\(/);
    assert.match(src, /useNoteComments\(/);
    assert.match(src, new RegExp(`useHostWide\\(cmtHostRef, ${WIDE_PX[host]}\\)`));
    const other = WIDE_PX[host === "NotePanel" ? "NoteModal" : "NotePanel"];
    assert.ok(!new RegExp(`useHostWide\\(cmtHostRef, ${other}\\)`).test(src), `${host} must not use ${other}px`);
    assert.match(src, /tf_cmt_panel_open/);
    assert.match(src, /scrollIntoView\(\{\s*block:\s*"center"/);
    assert.ok(!/window\.confirm\([^)]*[Kk]omentar/.test(src), "no window.confirm for comments");
  });
}

test("NoteModal mensyaratkan note tersimpan dan noteListId != null (note pribadi tanpa komentar)", () => {
  const src = fnSource("NoteModal");
  assert.match(src, /note\?\.id\s*&&\s*noteListId\s*!=\s*null/);
  // hook hanya aktif untuk note workspace: list_id diambil dari noteListId (state editor)
  assert.match(src, /list_id:\s*noteListId/);
  assert.match(src, /useNoteComments\(cmtNote\b/);
  // sorotan pada elemen .ProseMirror, dihitung ulang 200 ms setelah content berubah
  assert.match(src, /\.ProseMirror/);
  assert.match(src, /,\s*200\)/);
});

test("NotePanel: hanya note workspace, consumeOpen saat mount, klik sorotan → threadAt", () => {
  const src = fnSource("NotePanel");
  assert.match(src, /note\.list_id\s*!=\s*null/);
  assert.match(src, /consumeOpen\(/);
  assert.match(src, /caretPositionFromPoint/);
  assert.match(src, /caretRangeFromPoint/);
  assert.match(src, /threadAt\(/);
  assert.match(src, /collectSegments\(/);
});

test("editor di atas pembaca: NotePanel menahan panel/sorotan selama NoteModal terpasang", () => {
  const modal = fnSource("NoteModal");
  const panel = fnSource("NotePanel");
  assert.match(modal, /dispatchEvent\(new CustomEvent\("tf:cmt-modal"\)\)/);
  assert.match(panel, /addEventListener\("tf:cmt-modal"/);
  assert.match(panel, /cmtOpen && !cmtUnderModal/);
  assert.match(panel, /if \(cmtUnderModal\) return;/);
});

test("NoteCommentsButton: pil header dengan ikon fChat, aria-pressed, label jumlah terbuka", () => {
  const src = fnSource("NoteCommentsButton");
  assert.match(src, /borderRadius:\s*20/);
  assert.match(src, /"fChat"/);
  assert.match(src, /"aria-pressed"/);
  assert.match(src, /"Komentar"/);
  assert.match(src, /`Komentar, \$\{[^}]+\} terbuka`/);
});

test("CommentSelectionBubble: selectionchange, dalam containerRef, normalizeQuote, teks persis", () => {
  const src = fnSource("CommentSelectionBubble");
  assert.match(src, /"selectionchange"/);
  assert.match(src, /containerRef\.current/);
  assert.match(src, /\.contains\(/);
  assert.match(src, /normalizeQuote\(/);
  assert.match(src, /position:\s*"fixed"/);
  assert.match(src, /\(hover: none\)/);
  assert.match(src, /"Komentari"/);
  assert.match(src, /"Komentari teks terpilih"/);
});

test("header editor di HP: pil Komentar ringkas (label disembunyikan ≤768px, khusus NoteModal)", () => {
  const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");
  assert.match(fnSource("NoteCommentsButton"), /className: "note-act-label cmt-btn-label"/);
  assert.match(fnSource("NoteModal"), /React\.createElement\(NoteCommentsButton, \{\s*className: "cmt-hdr-btn--modal",/);
  assert.ok(!fnSource("NotePanel").includes("cmt-hdr-btn--modal"), "reader keeps its own label rule");
  assert.match(appCss, /@media \(max-width: 768px\) \{\s*\.cmt-hdr-btn--modal \.cmt-btn-label \{ display: none; \}/);
  // ✕ tetap di layar 375px: aksi header editor boleh turun baris di HP
  assert.match(fnSource("NoteModal"), /className: "note-modal-hdr-actions",/);
  assert.match(appCss, /\.note-modal-hdr-actions \{ flex-wrap: wrap;/);
  // aturan berada di blok .cmt- (bukan di ekor file)
  const at = appCss.indexOf(".cmt-hdr-btn--modal .cmt-btn-label");
  assert.ok(at > appCss.indexOf(".cmt-touchbar {") && at < appCss.indexOf("::highlight(cmt)"), "rule sits with the other .cmt- rules");
});

test("useHostWide memakai ResizeObserver", () => {
  const src = fnSource("useHostWide");
  assert.match(src, /ResizeObserver/);
  assert.match(src, /minPx/);
});

test("komponen host baru berada di blok NoteComments (sebelum NoteModal)", () => {
  const blockStart = indexHtml.indexOf("// ═══ DEPENDENCIES: NoteComments ═══");
  const modal = indexHtml.indexOf("\nfunction NoteModal({");
  for (const name of ["NoteCommentsButton", "CommentSelectionBubble", "useHostWide"]) {
    const at = indexHtml.indexOf(`\nfunction ${name}(`);
    assert.ok(at > blockStart && at < modal, `${name} must sit in the NoteComments block`);
  }
});
