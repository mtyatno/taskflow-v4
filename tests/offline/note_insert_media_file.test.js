"use strict";
// Toolbar note [Sketsa] [Media] [📎 File] + item "Media"/"File" di menu blok (slash "/" dan "+").
// "Media" = gambar (png/jpg/jpeg/webp) + audio/video; "📎 File" = khusus dokumen.
// Logika diambil dari static/index.html lalu dijalankan (vm / new Function); wiring host lewat regex.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const MD = require(path.join(root, "static/offline/mediadirective.js"));

const plain = (v) => JSON.parse(JSON.stringify(v));

// Lewati komentar / string mulai di j; -1 bila bukan.
function skipAt(code, j) {
  const c = code[j], n = code[j + 1];
  if (c === "/" && n === "/") { const e = code.indexOf("\n", j); return e < 0 ? code.length : e; }
  if (c === "/" && n === "*") { const e = code.indexOf("*/", j + 2); return e < 0 ? code.length : e + 1; }
  if (c === "'" || c === '"' || c === "`") {
    j++;
    while (j < code.length && code[j] !== c) { if (code[j] === "\\") j++; j++; }
    return j;
  }
  return -1;
}
// Teks dari marker sampai "}" pasangan "{" pertama sesudah marker.
function blockAfter(code, marker, from) {
  const at = code.indexOf(marker, from || 0);
  assert.ok(at >= 0, "marker tidak ditemukan: " + marker);
  const open = code.indexOf("{", at + marker.length);
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    const k = skipAt(code, j);
    if (k >= 0) { j = k; continue; }
    if (code[j] === "{") depth++;
    else if (code[j] === "}") { depth--; if (depth === 0) return code.slice(at, j + 1); }
  }
  assert.fail("blok tidak tertutup: " + marker);
}
function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, "marker not found: " + startMarker);
  const b = html.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, "end marker not found: " + endMarker);
  return html.slice(a, b);
}
function constLine(name) {
  const m = html.match(new RegExp("^const " + name + " = [^\\n]+$", "m"));
  assert.ok(m, "konstanta top-level " + name);
  return m[0];
}
const CONSTS_SRC = () => constLine("MEDIA_INLINE_IMAGE_MAX_BYTES") + "\n" + constLine("NOTE_IMAGE_EXTS") + "\n";
const toolbarSrc = () => slice("function NoteToolbar({", "\nfunction isSlashTriggerBefore(");
const editorSrc = () => slice("function MilkdownEditor({", "\nfunction createDrawingPlugin(MB)");
const noteModalSrc = () => slice("function NoteModal({", "\nfunction ");
const taskFormSrc = () => slice("function TaskFormModal({", "\nfunction ");

// Helper murni top-level (MEDIA_INLINE_IMAGE_MAX_BYTES, NOTE_IMAGE_EXTS, mediaPickAction, noteMediaAccept).
function loadHelpers(extra) {
  const sandbox = Object.assign({}, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(
    CONSTS_SRC() + blockAfter(html, "function mediaPickAction(") + "\n" + blockAfter(html, "function noteMediaAccept(") +
      "\nthis.mediaPickAction = mediaPickAction; this.noteMediaAccept = noteMediaAccept;" +
      "\nthis.MEDIA_INLINE_IMAGE_MAX_BYTES = MEDIA_INLINE_IMAGE_MAX_BYTES; this.NOTE_IMAGE_EXTS = NOTE_IMAGE_EXTS;",
    sandbox
  );
  return sandbox;
}

// ── (a) mediaPickAction ──
test("konstanta: batas 1 MB + ekstensi gambar = _ALLOWED_ATTACH_MIME server (png, jpeg, webp)", () => {
  const H = loadHelpers();
  assert.equal(H.MEDIA_INLINE_IMAGE_MAX_BYTES, 1024 * 1024);
  assert.deepEqual(plain(H.NOTE_IMAGE_EXTS), ["png", "jpg", "jpeg", "webp"]);
  assert.ok(html.indexOf("function mediaPickAction(") > html.indexOf("async function beginNoteMediaUpload("), "dekat beginNoteMediaUpload");
});

test("mediaPickAction: gambar → image (tanpa memandang online/note/allowAV, ekstensi huruf besar juga)", () => {
  const H = loadHelpers();
  const f = (name) => ({ name, size: 10 });
  for (const n of ["a.png", "FOTO.JPG", "b.jpeg", "c.WebP", "nama.dengan.titik.png"]) {
    assert.deepEqual(plain(H.mediaPickAction(f(n), { allowAV: true, online: true, hasNote: true, MD })), { kind: "image" }, n);
    assert.deepEqual(plain(H.mediaPickAction(f(n), { allowAV: false, online: false, hasNote: false, MD })), { kind: "image" }, n + " offline");
    assert.deepEqual(plain(H.mediaPickAction(f(n), { allowAV: true, online: true, hasNote: true, MD: null })), { kind: "image" }, n + " tanpa MD");
  }
});

test("mediaPickAction: audio/video → av, atau galat offline / note belum tersimpan / tanpa AV", () => {
  const H = loadHelpers();
  const mp3 = { name: "rekaman.mp3", size: 10 };
  const ok = { allowAV: true, online: true, hasNote: true, MD };
  assert.deepEqual(plain(H.mediaPickAction(mp3, ok)), { kind: "av" });
  assert.deepEqual(plain(H.mediaPickAction({ name: "Klip.MOV", size: 1 }, ok)), { kind: "av" });
  assert.deepEqual(plain(H.mediaPickAction(mp3, { ...ok, online: false })),
    { kind: "error", message: "Butuh koneksi internet untuk mengunggah audio/video" });
  assert.deepEqual(plain(H.mediaPickAction(mp3, { ...ok, online: false, hasNote: false })),
    { kind: "error", message: "Butuh koneksi internet untuk mengunggah audio/video" }, "offline dicek lebih dulu");
  assert.deepEqual(plain(H.mediaPickAction(mp3, { ...ok, hasNote: false })),
    { kind: "error", message: "Simpan note dulu, lalu lampirkan audio/video" });
  assert.deepEqual(plain(H.mediaPickAction(mp3, { ...ok, allowAV: false })), { kind: "error", message: "Format tidak didukung" });
  assert.deepEqual(plain(H.mediaPickAction(mp3, { ...ok, MD: null })), { kind: "error", message: "Format tidak didukung" }, "MD absen");
  assert.deepEqual(plain(H.mediaPickAction(mp3, { ...ok, MD: undefined })), { kind: "error", message: "Format tidak didukung" });
});

test("mediaPickAction: format lain / tanpa ekstensi → Format tidak didukung", () => {
  const H = loadHelpers();
  const ok = { allowAV: true, online: true, hasNote: true, MD };
  for (const n of ["laporan.pdf", "animasi.gif", "README", "png", "", "arsip.png.zip"]) {
    assert.deepEqual(plain(H.mediaPickAction({ name: n, size: 1 }, ok)), { kind: "error", message: "Format tidak didukung" }, JSON.stringify(n));
  }
});

// ── (b) grup Sisipkan ──
function groupsSource() {
  const start = html.indexOf("const SLASH_MENU_GROUPS = [");
  assert.ok(start > 0);
  return html.slice(start, html.indexOf("];", start) + 2);
}
const evalGroups = (onPickMedia, onPickFile) =>
  new Function("onPickMedia", "onPickFile", groupsSource().replace("const SLASH_MENU_GROUPS = ", "return "))(onPickMedia, onPickFile);
const insertItems = (groups) => groups.find((g) => g.label === "Sisipkan").items;

test("menu blok: Sisipkan = Tabel, Divider, Sketsa, Task, Media, File (glyph fImage/fFile)", () => {
  const fn = () => {};
  const items = insertItems(evalGroups(fn, fn));
  assert.deepEqual(items.map((it) => [it.glyph, it.label, it.type]), [
    ["sTable", "Tabel", "table"],
    ["sDivider", "Divider", "hr"],
    ["pPalette", "Sketsa", "draw"],
    ["nPin", "Task", "task"],
    ["fImage", "Media", "media"],
    ["fFile", "File", "file"],
  ]);
  const byType = Object.fromEntries(items.map((it) => [it.type, it]));
  assert.equal(byType.media.title, "Media — gambar, audio, atau video");
  assert.equal(byType.file.title, "File — PDF/dokumen sebagai lampiran");
  assert.ok(!byType.media.wide && !byType.file.wide && !byType.media.hint && !byType.file.hint);
  const G = new Function(slice("const VIEW_GLYPHS = {", "function ViewGlyph(").replace("const VIEW_GLYPHS = ", "return "))();
  assert.ok(typeof G.fImage === "string" && G.fImage.length > 0 && typeof G.fFile === "string" && G.fFile.length > 0);
});

test("menu blok: Media/File bersyarat pada onPickMedia/onPickFile (grup lain tak berubah)", () => {
  const fn = () => {};
  assert.deepEqual(insertItems(evalGroups(fn, null)).map((it) => it.type), ["table", "hr", "draw", "task", "media"]);
  assert.deepEqual(insertItems(evalGroups(null, fn)).map((it) => it.type), ["table", "hr", "draw", "task", "file"]);
  assert.deepEqual(insertItems(evalGroups(undefined, undefined)).map((it) => it.type), ["table", "hr", "draw", "task"]);
  const g = evalGroups(fn, fn);
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [["Teks", 7], ["Daftar", 3], ["Sisipkan", 6], ["Tautan", 1]]);
});

test("MilkdownEditor: prop onPickMedia/onPickFile disimpan di ref; grup dibangun di efek mount", () => {
  const ed = editorSrc();
  assert.match(ed, /^function MilkdownEditor\(\{[^}]*\bonPickMedia = null,[^}]*\bonPickFile = null\b[^}]*\}\)/);
  assert.match(ed, /const onPickMediaRef = React\.useRef\(onPickMedia\);\s*React\.useEffect\(\(\) => \{ onPickMediaRef\.current = onPickMedia; \}, \[onPickMedia\]\);/);
  assert.match(ed, /const onPickFileRef = React\.useRef\(onPickFile\);\s*React\.useEffect\(\(\) => \{ onPickFileRef\.current = onPickFile; \}, \[onPickFile\]\);/);
  const mountAt = ed.indexOf("if (!containerRef.current) return;");
  assert.ok(mountAt > 0 && ed.indexOf("const SLASH_MENU_GROUPS = [") > mountAt, "SLASH_MENU_GROUPS di dalam efek mount");
});

// ── (c) doSlashAction media/file ──
function isSlashTriggerBefore() {
  return new Function(blockAfter(html, "function isSlashTriggerBefore(") + "\nreturn isSlashTriggerBefore;")();
}
// text = isi textblock sebelum kursor; textblock mulai di posisi dokumen 1.
function fakeView(text, log) {
  const parent = { isTextblock: true, textBetween: (a, b) => text.slice(a, b) };
  const $from = { parent, parentOffset: text.length, start: () => 1, pos: 1 + text.length };
  const state = { selection: { $from }, tr: { delete: (a, b) => ({ op: "delete", a, b }) } };
  const view = { dispatch: (tr) => log.push(["dispatch", tr.op, tr.a, tr.b]) };
  return { state, view };
}
function runSlashCase(type, text) {
  const block = blockAfter(editorSrc(), "case '" + type + "':");
  const body = block.slice(block.indexOf("{"));
  const log = [];
  const { state, view } = fakeView(text, log);
  const ref = (name) => ({ current: () => log.push([name]) });
  const fn = new Function("type", "state", "view", "isSlashTriggerBefore", "onPickMediaRef", "onPickFileRef", "onInsertDrawingRef", "onInsertTaskRef", body);
  const ret = fn(type, state, view, isSlashTriggerBefore(), ref("media"), ref("file"), ref("draw"), ref("task"));
  return { log, ret, body };
}

test("doSlashAction media/file: hapus '/' pemicu lalu panggil ref secara sinkron, lalu return", () => {
  for (const [type, name] of [["media", "media"], ["file", "file"]]) {
    let r = runSlashCase(type, "abc /");
    assert.deepEqual(r.log, [["dispatch", "delete", 5, 6], [name]], type + ": '/' dihapus dulu, lalu ref");
    assert.equal(r.ret, undefined);
    assert.match(r.body, /return;\s*\}$/, type + ": keluar tanpa dispatch tr basi");
    r = runSlashCase(type, "/");
    assert.deepEqual(r.log, [["dispatch", "delete", 1, 2], [name]], type + ": '/' di awal blok (tombol +)");
    r = runSlashCase(type, "and/");
    assert.deepEqual(r.log, [[name]], type + ": '/' asli teks dibiarkan");
  }
});

test("doSlashAction media/file: ref null aman; jalur generik mengecualikan media/file", () => {
  const block = blockAfter(editorSrc(), "case 'media':");
  const body = block.slice(block.indexOf("{"));
  const log = [];
  const { state, view } = fakeView("/", log);
  const fn = new Function("type", "state", "view", "isSlashTriggerBefore", "onPickMediaRef", "onPickFileRef", body);
  assert.doesNotThrow(() => fn("media", state, view, isSlashTriggerBefore(), { current: null }, { current: null }));
  assert.doesNotThrow(() => fn("file", state, view, isSlashTriggerBefore(), { current: undefined }, { current: undefined }));
  assert.match(editorSrc(), /if \(type !== 'draw' && type !== 'task' && type !== 'media' && type !== 'file'\) \{\s*const sel0 = view\.state\.selection;/);
});

// ── (d) accept input ──
test("accept Media = gambar + MEDIA_EXTS (bila AV diizinkan); accept 📎 tanpa gambar", () => {
  const H = loadHelpers();
  const img = ".png,.jpg,.jpeg,.webp";
  assert.equal(H.noteMediaAccept(false, MD), img);
  assert.equal(H.noteMediaAccept(true, MD), img + "," + MD.MEDIA_EXTS.map((x) => "." + x).join(","));
  assert.ok(H.noteMediaAccept(true, MD).includes(".mp3") && H.noteMediaAccept(true, MD).includes(".mov"));
  assert.equal(H.noteMediaAccept(true, null), img, "MD absen → hanya gambar");
  assert.equal(H.noteMediaAccept(true, {}), img);
  const tb = toolbarSrc();
  assert.match(tb, /noteMediaAccept\(!!onInsertMedia, window\.TF && window\.TF\.mediadirective\)/);
  assert.match(tb, /ref: mediaInputRef,\s*type: "file",\s*accept: mediaAccept,/);
  const m = tb.match(/ref: fileInputRef,\s*type: "file",\s*accept: "([^"]*)"/);
  assert.ok(m, "input 📎 punya accept literal");
  assert.equal(m[1], ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.vsd,.vsdx,.vsdm,.mpp,.mpt,.dwg,.dxf");
  assert.equal(/\.(png|jpe?g|webp)\b/.test(m[1]), false, "gambar dikeluarkan dari 📎");
});

// ── Toolbar: tombol Media + 📎 File ──
test("NoteToolbar: tombol Media (ViewGlyph fImage + 'Media'), tidak nonaktif offline/note belum tersimpan", () => {
  const tb = toolbarSrc();
  assert.match(tb, /^function NoteToolbar\(\{[^}]*\bonInsertImage,[^}]*\bpickerRef,/);
  assert.match(tb, /const hasMediaBtn = !!\(onInsertMedia \|\| onInsertImage\);/);
  const i = tb.indexOf('className: "note-media-insert-btn"');
  assert.ok(i > 0);
  const start = tb.lastIndexOf("hasMediaBtn ? React.createElement(\"button\", {", i);
  assert.ok(start > 0 && i - start < 80, "tombol Media dirender bila hasMediaBtn");
  const btn = tb.slice(start, tb.indexOf('"Media")', i) + 8);
  assert.match(btn, /type: "button",\s*className: "note-media-insert-btn"/);
  assert.match(btn, /onMouseDown: e => \{\s*e\.preventDefault\(\);\s*openMediaPicker\(\);\s*\}/);
  assert.match(btn, /onClick: e => \{[\s\S]*?if \(e\.detail === 0\) openMediaPicker\(\);\s*\}/, "aktivasi keyboard");
  assert.match(btn, /title: onInsertMedia \? "Sisipkan media: gambar, audio, atau video" : "Sisipkan gambar"/);
  assert.match(btn, /React\.createElement\(ViewGlyph, \{ name: "fImage", size: 14, key: "ic" \}\)/);
  assert.match(btn, /React\.createElement\("span", \{ key: "tx", className: "ntb-label", style: \{ marginLeft: 4 \} \}, "Media"\)/);
  assert.equal(/disabled|opacity|mediaOnline/.test(btn), false, "tidak lagi nonaktif");
  assert.equal(/mediaOnline/.test(tb), false, "status online tak lagi dipantau di toolbar");
  assert.equal(tb.includes("🎬"), false, "emoji 🎬 dihapus");
  assert.equal(tb.includes("Audio/Video"), false);
  assert.match(tb, /hasMediaBtn \? React\.createElement\("input", \{\s*ref: mediaInputRef,/);
  assert.match(tb, /onChange: handleMediaPicked/);
});

test("NoteToolbar: tombol 📎 File (paperclip + 'File'), title & disabled tetap", () => {
  const tb = toolbarSrc();
  const i = tb.indexOf('title: noteId ? "Lampirkan file (PDF, dokumen, spreadsheet)" : "Simpan note dulu"');
  assert.ok(i > 0, "title 📎 baru");
  const btn = tb.slice(tb.lastIndexOf('React.createElement("button", {', i), tb.indexOf('"File")', i) + 7);
  assert.match(btn, /onMouseDown: e => \{\s*e\.preventDefault\(\);\s*if \(noteId\) fileInputRef\.current\?\.click\(\);\s*\}/);
  assert.match(btn, /disabled: uploading \|\| !noteId,/);
  assert.match(btn, /opacity: noteId \? 1 : 0\.4/);
  assert.match(btn, /React\.createElement\(Icon, \{ name: "paperclip", size: 14, key: "ic" \}\)/);
  assert.match(btn, /React\.createElement\("span", \{ key: "tx", className: "ntb-label", style: \{ marginLeft: 4 \} \}, "File"\)/);
  assert.match(tb, /onChange: handleAttachFile/);
});

test("NoteToolbar: urutan Sketsa … Media, 📎 File, lalu mic", () => {
  const tb = toolbarSrc();
  const sketsa = tb.indexOf('"Sketsa")');
  const media = tb.indexOf('"Media")');
  const fileInput = tb.indexOf("ref: fileInputRef,");
  const file = tb.indexOf('"File")');
  const mic = tb.indexOf('className: "note-mic-btn"');
  assert.ok(sketsa > 0 && sketsa < media && media < fileInput && fileInput < file && file < mic, [sketsa, media, fileInput, file, mic].join(","));
  assert.ok(tb.indexOf("ref: mediaInputRef,") < media, "input media sebelum tombolnya");
});

// Handler toolbar dijalankan dengan stub.
function toolbarCtx(o) {
  const calls = { image: [], av: [], toasts: [], mediaClicks: 0, fileClicks: 0 };
  const sandbox = {
    onInsertImage: o.onInsertImage === false ? undefined : (f) => calls.image.push(f.name),
    onInsertMedia: o.onInsertMedia === false ? undefined : (f) => calls.av.push(f.name),
    noteId: o.noteId,
    uploading: !!o.uploading,
    navigator: { onLine: o.online !== false },
    mediaInputRef: { current: o.noMediaInput ? null : { click: () => calls.mediaClicks++ } },
    fileInputRef: { current: { click: () => calls.fileClicks++ } },
    window: { TF: { mediadirective: MD }, __showToast: (m, t) => calls.toasts.push([m, t]) },
  };
  vm.createContext(sandbox);
  const tb = toolbarSrc();
  vm.runInContext(
    CONSTS_SRC() + blockAfter(html, "function mediaPickAction(") + "\n" +
      blockAfter(tb, "const sayToolbarError = ") + ";\n" +
      blockAfter(tb, "const handleMediaPicked = ") + ";\n" +
      blockAfter(tb, "const openMediaPicker = ") + ";\n" +
      blockAfter(tb, "const openFilePicker = ") + ";\n" +
      "this.handleMediaPicked = handleMediaPicked; this.openMediaPicker = openMediaPicker; this.openFilePicker = openFilePicker;",
    sandbox
  );
  return { sb: sandbox, calls };
}
const pickEvent = (name) => ({ target: { files: name == null ? [] : [{ name, size: 10 }], value: "C:\\fakepath\\" + name } });

test("NoteToolbar handleMediaPicked: image → onInsertImage, av → onInsertMedia, galat → toast; value direset", () => {
  let { sb, calls } = toolbarCtx({ noteId: 5 });
  let e = pickEvent("FOTO.JPG");
  sb.handleMediaPicked(e);
  assert.equal(e.target.value, "");
  assert.deepEqual(plain(calls.image), ["FOTO.JPG"]);
  sb.handleMediaPicked(pickEvent("a.mp3"));
  assert.deepEqual(plain(calls.av), ["a.mp3"]);
  sb.handleMediaPicked(pickEvent("doc.pdf"));
  assert.deepEqual(plain(calls.toasts), [["Format tidak didukung", "error"]]);
  e = pickEvent(null);
  sb.handleMediaPicked(e);
  assert.equal(e.target.value, "");
  assert.equal(calls.toasts.length, 1, "tanpa file → tidak ada apa-apa");

  ({ sb, calls } = toolbarCtx({ noteId: 5, online: false }));
  sb.handleMediaPicked(pickEvent("a.mp3"));
  sb.handleMediaPicked(pickEvent("b.png"));
  assert.deepEqual(plain(calls.toasts), [["Butuh koneksi internet untuk mengunggah audio/video", "error"]]);
  assert.deepEqual(plain(calls.image), ["b.png"], "gambar tetap bisa offline");

  ({ sb, calls } = toolbarCtx({ noteId: null }));
  sb.handleMediaPicked(pickEvent("a.mp3"));
  assert.deepEqual(plain(calls.toasts), [["Simpan note dulu, lalu lampirkan audio/video", "error"]]);

  // TaskFormModal: tanpa onInsertMedia → hanya gambar
  ({ sb, calls } = toolbarCtx({ noteId: null, onInsertMedia: false }));
  sb.handleMediaPicked(pickEvent("a.mp3"));
  sb.handleMediaPicked(pickEvent("c.webp"));
  assert.deepEqual(plain(calls.toasts), [["Format tidak didukung", "error"]]);
  assert.deepEqual(plain(calls.image), ["c.webp"]);
});

test("NoteToolbar pickerRef: media() klik input media; file() butuh note & tidak saat mengunggah", () => {
  let { sb, calls } = toolbarCtx({ noteId: null });
  sb.openMediaPicker();
  assert.equal(calls.mediaClicks, 1, "media selalu boleh (note belum tersimpan)");
  sb.openFilePicker();
  assert.equal(calls.fileClicks, 0);
  assert.deepEqual(plain(calls.toasts), [["Simpan note dulu, lalu lampirkan file", "error"]]);

  ({ sb, calls } = toolbarCtx({ noteId: 7, uploading: true }));
  sb.openFilePicker();
  assert.equal(calls.fileClicks, 0);
  assert.equal(calls.toasts.length, 0, "sedang mengunggah → diabaikan");

  ({ sb, calls } = toolbarCtx({ noteId: 7, online: false }));
  sb.openFilePicker();
  assert.equal(calls.fileClicks, 1);

  ({ sb, calls } = toolbarCtx({ noteId: 7, noMediaInput: true }));
  assert.doesNotThrow(() => sb.openMediaPicker(), "tanpa tombol Media → no-op");

  const tb = toolbarSrc();
  assert.match(tb, /const api = \{ media: openMediaPicker, file: openFilePicker \};\s*pickerRef\.current = api;/);
  assert.match(tb, /return \(\) => \{ if \(pickerRef\.current === api\) pickerRef\.current = null; \};/, "dibersihkan saat unmount");
  assert.equal(/await[^\n]*\n[^\n]*\.click\(\)/.test(blockAfter(tb, "const openFilePicker = ")), false, "click() sinkron");
});

// ── (e) host ──
test("NoteModal: Media gambar via handleImagePaste(picker), pickerRef, menu blok Media + File", () => {
  const nm = noteModalSrc();
  assert.match(nm, /const notePickRef = React\.useRef\(null\);/);
  const tbEl = blockAfter(nm, "React.createElement(NoteToolbar, ");
  assert.match(tbEl, /onInsertImage: f => handleImagePaste\(f, \{ source: 'picker' \}\),/);
  assert.match(tbEl, /pickerRef: notePickRef/);
  assert.match(tbEl, /onInsertMedia: handleInsertMedia/);
  const edEl = blockAfter(nm, "React.createElement(MilkdownEditor, ");
  assert.match(edEl, /onPickMedia: \(\) => notePickRef\.current\?\.media\?\.\(\)/);
  assert.match(edEl, /onPickFile: \(\) => notePickRef\.current\?\.file\?\.\(\)/);
  assert.match(edEl, /onImagePaste: handleImagePaste,/, "tempel tetap tanpa opts");
});

test("TaskFormModal: Media hanya gambar; menu blok hanya Media (tanpa File)", () => {
  const tf = taskFormSrc();
  assert.match(tf, /const notePickRef = React\.useRef\(null\);/);
  const tbEl = blockAfter(tf, "React.createElement(NoteToolbar, ");
  assert.match(tbEl, /onInsertImage: f => handleNoteImagePaste\(f, \{ source: 'picker' \}\),/);
  assert.match(tbEl, /pickerRef: notePickRef/);
  assert.match(tbEl, /noteId: null,/);
  assert.equal(/onInsertMedia/.test(tbEl), false);
  const edEl = blockAfter(tf, "React.createElement(MilkdownEditor, ");
  assert.match(edEl, /onPickMedia: \(\) => notePickRef\.current\?\.media\?\.\(\)/);
  assert.equal(/onPickFile/.test(edEl), false, "📎 selalu nonaktif di TaskFormModal");
  assert.match(edEl, /onImagePaste: handleNoteImagePaste,/);
});

// ── (f) batas 1 MB hanya untuk source: 'picker' di cabang base64 ──
const BIG = 3 * 1024 * 1024;
const OVER_MSG = "Gambar lebih dari 1 MB butuh koneksi internet dan catatan yang sudah tersimpan";
class FakeReader { readAsDataURL() { this.result = "data:image/png;base64,AAA"; if (this.onload) this.onload(); } }

async function runNoteModalPaste({ savedNoteId, fetchImpl, file, opts }) {
  const calls = { order: [], toasts: [], inserts: [], atts: [] };
  const sandbox = {
    savedNoteId,
    __token: "tok",
    apiUrl: (p) => "https://api.test" + p,
    FormData: class { append() {} },
    fetch: async (url) => { calls.order.push("fetch " + url); return fetchImpl(url); },
    insertImageMd: (md) => calls.inserts.push(md),
    showToast: (m, t) => { calls.order.push("toast " + m); calls.toasts.push([m, t]); },
    setAttachments: (fn) => calls.atts.push(fn([{ id: 1 }])),
    FileReader: FakeReader,
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(CONSTS_SRC() + blockAfter(noteModalSrc(), "const handleImagePaste = ") + ";\nthis.fn = handleImagePaste;", sandbox);
  await sandbox.fn(file, opts);
  return plain(calls);
}
const okUpload = async () => ({ ok: true, json: async () => ({ id: 9, original_name: "a.png" }) });
const offlineFetch = async () => { throw new TypeError("Failed to fetch"); };

test("NoteModal.handleImagePaste: tempel (tanpa opts) tetap — base64 berapa pun ukurannya", async () => {
  const c = await runNoteModalPaste({ savedNoteId: null, fetchImpl: okUpload, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c.inserts, ["![s.png](data:image/png;base64,AAA)"]);
  assert.deepEqual(c.toasts, []);
  const c2 = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: okUpload, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c2.toasts, [], "tempel tanpa toast 'Mengunggah gambar…'");
  assert.deepEqual(c2.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);
  assert.deepEqual(c2.atts, [[{ id: 1 }, { id: 9, original_name: "a.png" }]], "daftar Lampiran ikut diperbarui");
});

test("NoteModal.handleImagePaste picker: toast unggah sebelum fetch; >1 MB tanpa server → galat, tidak disisipkan", async () => {
  let c = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: { source: "picker" } });
  assert.deepEqual(c.order, ["toast Mengunggah gambar…", "fetch https://api.test/api/scratchpad/12/attachments"]);
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"]]);
  assert.deepEqual(c.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);
  assert.deepEqual(c.atts, [[{ id: 1 }, { id: 9, original_name: "a.png" }]]);

  c = await runNoteModalPaste({ savedNoteId: null, fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: { source: "picker" } });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);
  assert.ok(!c.order.some((x) => x.startsWith("fetch")));

  c = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: offlineFetch, file: { name: "f.png", size: BIG }, opts: { source: "picker" } });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], [OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);

  c = await runNoteModalPaste({ savedNoteId: "c-uuid", fetchImpl: okUpload, file: { name: "kecil.png", size: 500 * 1024 }, opts: { source: "picker" } });
  assert.deepEqual(c.toasts, [], "id offline → langsung base64, tanpa toast unggah");
  assert.deepEqual(c.inserts, ["![kecil.png](data:image/png;base64,AAA)"]);

  c = await runNoteModalPaste({ savedNoteId: null, fetchImpl: okUpload, file: { name: "pas.png", size: 1024 * 1024 }, opts: { source: "picker" } });
  assert.deepEqual(c.inserts, ["![pas.png](data:image/png;base64,AAA)"], "tepat 1 MB masih boleh");
});

async function runTaskFormPaste({ savedId, content, fetchImpl, file, opts, noShowToast }) {
  const calls = { order: [], toasts: [], inserts: [], events: [] };
  const view = {
    state: { tr: { replaceSelection: (sl) => ({ scrollIntoView: () => ({ md: sl }) }) } },
    dispatch: (x) => calls.inserts.push(x.md),
    focus() {},
  };
  const parser = (md) => ({ content: { size: 1 }, slice: () => md });
  const editor = { action: (fn) => fn({ get: (k) => (k === "VIEW" ? view : parser) }) };
  const toast = (m, t) => { calls.order.push("toast " + m); calls.toasts.push([m, t]); };
  const sandbox = {
    noteMilkdownRef: { current: editor },
    noteSavedIdRef: { current: savedId },
    noteForm: { title: "Judul", content: content || "" },
    notePaperConfig: {},
    extractTaskIdsFromContent: () => [],
    __token: "tok",
    apiUrl: (p) => "https://api.test" + p,
    FormData: class { append() {} },
    fetch: async (url, init) => { calls.order.push("fetch " + url); return fetchImpl(url, init); },
    FileReader: FakeReader,
    CustomEvent: class { constructor(n) { this.type = n; } },
    window: { MilkdownBundle: { editorViewCtx: "VIEW", parserCtx: "PARSER" }, dispatchEvent: (e) => calls.events.push(e.type) },
  };
  if (noShowToast) sandbox.window.__showToast = toast; else sandbox.showToast = toast;
  vm.createContext(sandbox);
  vm.runInContext(CONSTS_SRC() + blockAfter(taskFormSrc(), "const handleNoteImagePaste = ") + ";\nthis.fn = handleNoteImagePaste;", sandbox);
  await sandbox.fn(file, opts);
  return plain(calls);
}

test("TaskFormModal.handleNoteImagePaste: tempel tetap; picker → toast unggah / batas 1 MB di base64", async () => {
  let c = await runTaskFormPaste({ savedId: null, fetchImpl: okUpload, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c.inserts, ["![s.png](data:image/png;base64,AAA)"], "tempel: base64 tanpa batas");
  assert.deepEqual(c.toasts, []);

  c = await runTaskFormPaste({ savedId: null, fetchImpl: okUpload, file: { name: "s.png", size: BIG }, opts: { source: "picker" } });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);

  c = await runTaskFormPaste({ savedId: null, fetchImpl: okUpload, file: { name: "s.png", size: BIG }, opts: { source: "picker" }, noShowToast: true });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]], "tanpa prop showToast → window.__showToast");

  c = await runTaskFormPaste({ savedId: null, fetchImpl: okUpload, file: { name: "k.png", size: 200 }, opts: { source: "picker" } });
  assert.deepEqual(c.inserts, ["![k.png](data:image/png;base64,AAA)"]);

  // note dibuat dulu (konten ada), lalu toast unggah tepat sebelum fetch lampiran
  const createThenUpload = async (url) => url.endsWith("/api/scratchpad")
    ? { ok: true, json: async () => ({ id: 33 }) }
    : { ok: true, json: async () => ({ id: 4, original_name: "f.png" }) };
  c = await runTaskFormPaste({ savedId: null, content: "isi", fetchImpl: createThenUpload, file: { name: "f.png", size: BIG }, opts: { source: "picker" } });
  assert.deepEqual(c.order, [
    "fetch https://api.test/api/scratchpad",
    "toast Mengunggah gambar…",
    "fetch https://api.test/api/scratchpad/33/attachments",
  ]);
  assert.deepEqual(c.inserts, ["![f.png](/api/scratchpad/attachments/4/view)"]);

  c = await runTaskFormPaste({ savedId: 33, fetchImpl: okUpload, file: { name: "f.png", size: BIG } });
  assert.deepEqual(c.toasts, [], "tempel: tanpa toast unggah");
  assert.deepEqual(c.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);

  c = await runTaskFormPaste({ savedId: 33, fetchImpl: offlineFetch, file: { name: "f.png", size: BIG }, opts: { source: "picker" } });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], [OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);
});

// ── Alias ketik "/sketsa": "gambar" kini berarti foto → bukan alias sketsa lagi ──
test("alias ketik pembuka sketsa: draw|canvas|sketsa (tanpa gambar) di kedua host", () => {
  const lines = html.match(/const drawMatch = textBefore\.match\(\/[^\n]*\);/g) || [];
  assert.equal(lines.length, 2, "NoteModal + TaskFormModal");
  for (const line of lines) {
    assert.equal(line, "const drawMatch = textBefore.match(/(?:^|\\n)\\/(draw|canvas|sketsa)$/i);");
    const re = new Function("return " + line.slice("const drawMatch = textBefore.match(".length, -2))();
    assert.ok(re.test("/sketsa") && re.test("teks\n/Sketsa") && re.test("/draw") && re.test("/canvas"));
    assert.equal(re.test("/gambar"), false, "/gambar tidak membuka sketsa");
  }
  assert.equal((html.match(/\/\/ \/draw, \/canvas, \/sketsa slash command — buka drawing insert modal/g) || []).length, 2);
  assert.equal(/\/gambar, \/sketsa slash command/.test(html), false);
  assert.equal(/\(draw\|canvas\|gambar\|sketsa\)/.test(html), false);
});
