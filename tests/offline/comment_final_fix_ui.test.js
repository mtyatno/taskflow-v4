"use strict";

// Komentar note PR 3, perbaikan review akhir: badge daftar ikut diperbarui (I-2), tanpa SSE ganda
// saat editor di atas pembaca (M-1), ToC tidak menutupi panel samping (M-3), komposer setelah akses
// hilang (M-4). Cek sumber: index.html/app.css dibaca sebagai teks.

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

const LOST_TEXT = "Kamu sudah tidak punya akses ke catatan ini.";

// ── I-2 ──
test("I-2: useNoteComments memancarkan tf:comments-changed lokal setelah read dan mutasi", () => {
  const helper = fnSource("notifyCommentsChanged");
  assert.match(helper, /new CustomEvent\("tf:comments-changed", \{ detail: \{ source: "local", note_ids: \[noteId\] \} \}\)/);
  const src = fnSource("useNoteComments");
  // read POST sukses → kabari (bukan di catch)
  assert.match(src, /comments\/read`, \{\}\)\.then\(\(\) => notifyCommentsChanged\(nid\), \(\) => \{\}\)/);
  assert.match(src, /const afterChange = useCallback\(\(\) => \{\s*notifyCommentsChanged\(noteId\);\s*return reload\(\);/);
  // fungsi pasca-mutasi diekspor dan dipakai panel
  assert.match(src, /afterChange/);
  // SSE comments_changed → setelah pull, daftar ikut dikabari
  assert.match(src, /const done = \(\) => \{ if \(disposed\) return; reload\(\); notifyCommentsChanged\(noteId\); \};/);
  // listener hook sendiri mengabaikan sumber lokal
  assert.match(src, /detail\.source === "local"\) return;/);
});

test("I-2: kedua host memberi panel reload pasca-mutasi (afterChange)", () => {
  for (const host of ["NotePanel", "NoteModal"]) {
    const src = fnSource(host);
    assert.match(src, /reload: cmt\.afterChange/, host);
    assert.ok(!/reload: cmt\.reload/.test(src), `${host} must not pass raw reload`);
  }
});

test("I-2: panel memakai reload untuk create/edit/resolve/delete/discard", () => {
  const composer = fnSource("CommentComposer");
  assert.match(composer, /reload && reload\(\)/);
  const card = fnSource("CommentThreadCard");
  assert.ok((card.match(/reload && reload\(\)/g) || []).length >= 3, "edit, resolve, discard");
  const panel = fnSource("NoteCommentsPanel");
  assert.match(panel, /api\.del\(`[^`]*`\)\.then\(\(\) => \{\s*setDeleteTarget\(null\);\s*reload && reload\(\);/);
});

test("I-2: NotesPage mendengar tf:comments-changed, refetch ter-debounce, dibersihkan", () => {
  const src = fnSource("NotesPage");
  assert.match(src, /window\.addEventListener\("tf:comments-changed", onCmt\)/);
  assert.match(src, /window\.removeEventListener\("tf:comments-changed", onCmt\)/);
  assert.match(src, /setTimeout\(\(\) => \{[^}]*fetchNotes\(q, activeTags, filterUntagged, notesTab\)[^}]*\}, 500\)/);
  assert.match(src, /clearTimeout\(cmtListTimer\)/);
});

// ── M-1 ──
test("M-1: pembaca di bawah editor tidak memegang SSE sendiri (opsi live)", () => {
  const hook = fnSource("useNoteComments");
  assert.match(hook, /live = true/);
  assert.match(hook, /if \(!live \|\| serverId == null \|\| gone/);
  const panel = fnSource("NotePanel");
  assert.match(panel, /useNoteComments\(note, \{[^}]*live: !cmtUnderModal/);
});

// ── M-3 ──
test("M-3: panel samping terbuka → host diberi kelas, ToC bergeser 380px (di blok .cmt-)", () => {
  assert.match(fnSource("NotePanel"), /cmt-side-open/);
  assert.match(fnSource("NoteModal"), /cmt-side-open/);
  const i = appCss.indexOf(".cmt-side-open { --cmt-side-w: 380px; }");
  assert.ok(i > 0, "host class sets the panel width variable");
  assert.match(appCss, /\.floating-toc-anchor \{\s*position: fixed;\s*right: calc\(16px \+ var\(--cmt-side-w, 0px\)\);/);
  assert.match(appCss, /\.floating-toc-anchor\.floating-toc-anchor--modal \{\s*right: calc\(8px \+ var\(--cmt-side-w, 0px\)\);/);
  // berada di samping aturan .cmt- lain, bukan di akhir file
  const side = appCss.indexOf(".cmt-panel--side {");
  assert.ok(side > 0 && i > side && i - side < 400, "right after .cmt-panel--side");
  assert.ok(appCss.length - i > 2000, "not at file end");
});

// ── M-4 ──
test("M-4: akses hilang → hook mengembalikan gone, komposer nonaktif dengan teks persis", () => {
  const hook = fnSource("useNoteComments");
  assert.match(hook, /comments_access_lost[\s\S]{0,200}setGone\(true\)/);
  assert.match(hook, /return \{[\s\S]*\bgone\b[\s\S]*\}/);
  assert.ok(indexHtml.includes(`const CMT_LOST_TEXT = "${LOST_TEXT}";`), "exact text");
  const composer = fnSource("CommentComposer");
  assert.match(composer, /\}, CMT_LOST_TEXT\)\);/);
  assert.match(composer, /showToast\(CMT_LOST_TEXT, "error"\)/);
  assert.match(composer, /if \(lost\)/);
  // galat lokal Note not found saat kirim → pesan yang sama, bukan toast mentah
  assert.match(composer, /noteGone\(err\)/);
  const panel = fnSource("NoteCommentsPanel");
  assert.match(panel, /lost: !!gone/);
  for (const host of ["NotePanel", "NoteModal"]) assert.match(fnSource(host), /gone: cmt\.gone/, host);
});
