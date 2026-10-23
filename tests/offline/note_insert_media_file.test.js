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
// id task note → id server (body mentah /api/scratchpad) + rewrite [tasklink:cid]; dipakai runner TaskFormModal
const TASKID_SRC = () => constLine("MEDIA_PUSH_TIMEOUT_MS") + "\n" + blockAfter(html, "async function resolveTaskServerIds(") + "\n" +
  blockAfter(html, "function rewriteTasklinkIds(") + "\n";
// window.TF palsu: idmap (cid → sid) + taskrepo.getRaw (cid → {server_id}); __pushNow dicatat.
function fakeTF(log, idmap, raws) {
  return {
    __pushNow: async () => { log.push("pushNow"); },
    TF: {
      idmap: { serverIdOf: async (cid) => { log.push("idmap " + cid); return idmap && idmap[cid]; } },
      taskrepo: { getRaw: async (cid) => { log.push("raw " + cid); return raws && raws[cid]; } },
    },
  };
}
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
const evalGroups = (onPickMedia, onPickFile, pickMediaAV = true) =>
  new Function("onPickMedia", "onPickFile", "pickMediaAV", groupsSource().replace("const SLASH_MENU_GROUPS = ", "return "))(onPickMedia, onPickFile, pickMediaAV);
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

test("menu blok: title Media mengikuti kemampuan host (pickMediaAV) — hanya gambar = 'Media — gambar'", () => {
  const fn = () => {};
  const media = (av) => insertItems(evalGroups(fn, null, av)).find((it) => it.type === "media");
  assert.equal(media(true).title, "Media — gambar, audio, atau video");
  assert.equal(media(false).title, "Media — gambar");
  const ed = editorSrc();
  assert.match(ed, /^function MilkdownEditor\(\{[^}]*\bonPickMedia = null,[^}]*\bpickMediaAV = false\b[^}]*\}\)/, "bawaan: hanya gambar");
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
  assert.match(btn, /type: "button",/);
  assert.match(btn, /onMouseDown: e => \{\s*e\.preventDefault\(\);\s*if \(noteId\) fileInputRef\.current\?\.click\(\);\s*\}/);
  assert.match(btn, /onClick: e => \{[\s\S]*?if \(e\.detail === 0 && noteId\) fileInputRef\.current\?\.click\(\);\s*\}/, "aktivasi keyboard (Enter/Spasi)");
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
  assert.match(edEl, /pickMediaAV: true/, "NoteModal menerima audio/video → title Media lengkap");
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
  assert.equal(/pickMediaAV/.test(edEl), false, "hanya gambar → title 'Media — gambar' (bawaan)");
  assert.match(edEl, /onImagePaste: handleNoteImagePaste,/);
});

// ── (f) batas 1 MB hanya untuk source: 'picker' di cabang base64 ──
const BIG = 3 * 1024 * 1024;
const OVER_MSG = "Gambar lebih dari 1 MB butuh koneksi internet dan catatan yang sudah tersimpan";
class FakeReader { readAsDataURL() { this.result = "data:image/png;base64,AAA"; if (this.onload) this.onload(); } }

async function runNoteModalPaste({ savedNoteId, fetchImpl, file, opts, online = true, ensureImpl }) {
  const calls = { order: [], toasts: [], inserts: [], atts: [], ensured: [] };
  const sandbox = {
    savedNoteId,
    __token: "tok",
    navigator: { onLine: online },
    apiUrl: (p) => "https://api.test" + p,
    FormData: class { append() {} },
    fetch: async (url) => { calls.order.push("fetch " + url); return fetchImpl(url); },
    ensureServerNoteId: async (id) => { calls.order.push("ensure " + id); calls.ensured.push(id); return ensureImpl ? ensureImpl(id) : null; },
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
const tooLarge = async () => ({ ok: false, status: 413, json: async () => ({ detail: "File terlalu besar (maks 10 MB)" }) });
const badGateway = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } });
const PICK = { source: "picker" };

test("NoteModal.handleImagePaste: tempel (tanpa opts) tetap — base64 berapa pun ukurannya", async () => {
  const c = await runNoteModalPaste({ savedNoteId: null, fetchImpl: okUpload, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c.inserts, ["![s.png](data:image/png;base64,AAA)"]);
  assert.deepEqual(c.toasts, []);
  const c2 = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: okUpload, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c2.toasts, [], "tempel tanpa toast 'Mengunggah gambar…'");
  assert.deepEqual(c2.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);
  assert.deepEqual(c2.atts, [[{ id: 1 }, { id: 9, original_name: "a.png" }]], "daftar Lampiran ikut diperbarui");
  // tempel: server menolak → tetap jatuh ke base64 seperti dulu; cid lokal → tanpa ensureServerNoteId
  const c3 = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: tooLarge, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c3.toasts, []);
  assert.deepEqual(c3.inserts, ["![s.png](data:image/png;base64,AAA)"]);
  const c4 = await runNoteModalPaste({ savedNoteId: "c-uuid", fetchImpl: okUpload, file: { name: "s.png", size: BIG }, ensureImpl: () => 55 });
  assert.deepEqual(c4.ensured, []);
  assert.deepEqual(c4.inserts, ["![s.png](data:image/png;base64,AAA)"]);
  const c5 = await runNoteModalPaste({ savedNoteId: 12, online: false, fetchImpl: offlineFetch, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c5.order, ["fetch https://api.test/api/scratchpad/12/attachments"], "tempel offline: tetap mencoba unggah seperti dulu");
  assert.deepEqual(c5.inserts, ["![s.png](data:image/png;base64,AAA)"]);
});

test("NoteModal.handleImagePaste picker: toast unggah sebelum fetch; >1 MB tanpa server → galat, tidak disisipkan", async () => {
  let c = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.order, ["toast Mengunggah gambar…", "fetch https://api.test/api/scratchpad/12/attachments"]);
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"]]);
  assert.deepEqual(c.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);
  assert.deepEqual(c.atts, [[{ id: 1 }, { id: 9, original_name: "a.png" }]]);

  c = await runNoteModalPaste({ savedNoteId: null, fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);
  assert.ok(!c.order.some((x) => x.startsWith("fetch")));
  assert.deepEqual(c.ensured, [], "belum ada note sama sekali → tidak perlu ensureServerNoteId");

  // online tapi jaringan putus (fetch melempar) → satu-satunya jalur fallback base64 (dengan batas 1 MB)
  c = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: offlineFetch, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], [OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);

  c = await runNoteModalPaste({ savedNoteId: null, fetchImpl: okUpload, file: { name: "pas.png", size: 1024 * 1024 }, opts: PICK });
  assert.deepEqual(c.inserts, ["![pas.png](data:image/png;base64,AAA)"], "tepat 1 MB masih boleh");
});

test("NoteModal.handleImagePaste picker offline: tanpa unggah & tanpa toast 'Mengunggah', langsung base64 (batas 1 MB)", async () => {
  let c = await runNoteModalPaste({ savedNoteId: 12, online: false, fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.order, ["toast " + OVER_MSG]);
  assert.deepEqual(c.inserts, []);
  c = await runNoteModalPaste({ savedNoteId: 12, online: false, fetchImpl: okUpload, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.order, []);
  assert.deepEqual(c.inserts, ["![k.png](data:image/png;base64,AAA)"]);
  c = await runNoteModalPaste({ savedNoteId: "c-uuid", online: false, fetchImpl: okUpload, file: { name: "k.png", size: 300 }, opts: PICK, ensureImpl: () => 55 });
  assert.deepEqual(c.ensured, [], "offline → tidak mendorong outbox");
  assert.deepEqual(c.inserts, ["![k.png](data:image/png;base64,AAA)"]);
});

test("NoteModal.handleImagePaste picker: server menolak → toast detail galat, tidak disisipkan, tanpa base64", async () => {
  let c = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: tooLarge, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], ["File terlalu besar (maks 10 MB)", "error"]]);
  assert.deepEqual(c.inserts, []);
  assert.deepEqual(c.atts, []);
  c = await runNoteModalPaste({ savedNoteId: 12, fetchImpl: badGateway, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], ["Unggah gambar gagal", "error"]], "tanpa detail JSON → pesan bawaan");
  assert.deepEqual(c.inserts, []);
});

test("NoteModal.handleImagePaste picker: note masih cid lokal + online → ensureServerNoteId lalu unggah", async () => {
  let c = await runNoteModalPaste({ savedNoteId: "c-uuid", fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: PICK, ensureImpl: () => 55 });
  assert.deepEqual(c.order, ["ensure c-uuid", "toast Mengunggah gambar…", "fetch https://api.test/api/scratchpad/55/attachments"]);
  assert.deepEqual(c.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);
  assert.deepEqual(c.atts, [[{ id: 1 }, { id: 9, original_name: "a.png" }]]);

  c = await runNoteModalPaste({ savedNoteId: "c-uuid", fetchImpl: okUpload, file: { name: "kecil.png", size: 500 * 1024 }, opts: PICK, ensureImpl: () => null });
  assert.deepEqual(c.order, ["ensure c-uuid"], "id server belum ada → base64, tanpa toast unggah");
  assert.deepEqual(c.inserts, ["![kecil.png](data:image/png;base64,AAA)"]);

  c = await runNoteModalPaste({ savedNoteId: "c-uuid", fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: PICK, ensureImpl: () => { throw new Error("x"); } });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]], "ensureServerNoteId gagal → seperti tanpa id server");
  assert.deepEqual(c.inserts, []);
});

async function runTaskFormPaste({ savedId, content, fetchImpl, file, opts, noShowToast, online = true, taskIds, idmap, raws }) {
  const calls = { order: [], toasts: [], inserts: [], events: [], bodies: [], tf: [] };
  const view = {
    state: { tr: { replaceSelection: (sl) => ({ scrollIntoView: () => ({ md: sl }) }) } },
    dispatch: (x) => calls.inserts.push(x.md),
    focus() {},
  };
  const parser = (md) => ({ content: { size: 1 }, slice: () => md });
  const editor = { action: (fn) => fn({ get: (k) => (k === "VIEW" ? view : parser) }) };
  const toast = (m, t) => { calls.order.push("toast " + m); calls.toasts.push([m, t]); };
  const savedRef = { current: savedId };
  const sandbox = {
    noteMilkdownRef: { current: editor },
    noteSavedIdRef: savedRef,
    noteForm: { title: "Judul", content: content || "" },
    notePaperConfig: {},
    extractTaskIdsFromContent: () => (taskIds || []).slice(),
    __token: "tok",
    setTimeout, clearTimeout,
    navigator: { onLine: online },
    apiUrl: (p) => "https://api.test" + p,
    FormData: class { append() {} },
    fetch: async (url, init) => {
      calls.order.push("fetch " + url);
      if (init && typeof init.body === "string") calls.bodies.push(JSON.parse(init.body));
      return fetchImpl(url, init);
    },
    FileReader: FakeReader,
    CustomEvent: class { constructor(n) { this.type = n; } },
    window: Object.assign({ MilkdownBundle: { editorViewCtx: "VIEW", parserCtx: "PARSER" }, dispatchEvent: (e) => calls.events.push(e.type) },
      fakeTF(calls.tf, idmap, raws)),
  };
  if (noShowToast) sandbox.window.__showToast = toast; else sandbox.showToast = toast;
  vm.createContext(sandbox);
  vm.runInContext(CONSTS_SRC() + TASKID_SRC() + blockAfter(taskFormSrc(), "const handleNoteImagePaste = ") + ";\nthis.fn = handleNoteImagePaste;", sandbox);
  await sandbox.fn(file, opts);
  calls.savedId = savedRef.current;
  return plain(calls);
}
const createThenUpload = async (url) => url.endsWith("/api/scratchpad")
  ? { ok: true, json: async () => ({ id: 33 }) }
  : { ok: true, json: async () => ({ id: 4, original_name: "f.png" }) };

test("TaskFormModal.handleNoteImagePaste: tempel tetap; picker → toast unggah / batas 1 MB di base64", async () => {
  let c = await runTaskFormPaste({ savedId: null, fetchImpl: okUpload, file: { name: "s.png", size: BIG } });
  assert.deepEqual(c.inserts, ["![s.png](data:image/png;base64,AAA)"], "tempel: base64 tanpa batas");
  assert.deepEqual(c.toasts, []);
  assert.deepEqual(c.order, [], "tempel dengan isi kosong: note tidak dibuat (seperti dulu)");

  c = await runTaskFormPaste({ savedId: null, online: false, fetchImpl: okUpload, file: { name: "s.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);

  c = await runTaskFormPaste({ savedId: null, online: false, fetchImpl: okUpload, file: { name: "s.png", size: BIG }, opts: PICK, noShowToast: true });
  assert.deepEqual(c.toasts, [[OVER_MSG, "error"]], "tanpa prop showToast → window.__showToast");

  c = await runTaskFormPaste({ savedId: null, online: false, fetchImpl: okUpload, file: { name: "k.png", size: 200 }, opts: PICK });
  assert.deepEqual(c.inserts, ["![k.png](data:image/png;base64,AAA)"]);

  // note dibuat dulu (konten ada), lalu toast unggah tepat sebelum fetch lampiran
  c = await runTaskFormPaste({ savedId: null, content: "isi", fetchImpl: createThenUpload, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.order, [
    "fetch https://api.test/api/scratchpad",
    "toast Mengunggah gambar…",
    "fetch https://api.test/api/scratchpad/33/attachments",
  ]);
  assert.deepEqual(c.inserts, ["![f.png](/api/scratchpad/attachments/4/view)"]);
  assert.equal(c.savedId, 33);

  c = await runTaskFormPaste({ savedId: 33, fetchImpl: okUpload, file: { name: "f.png", size: BIG } });
  assert.deepEqual(c.toasts, [], "tempel: tanpa toast unggah");
  assert.deepEqual(c.inserts, ["![a.png](/api/scratchpad/attachments/9/view)"]);

  // online tapi fetch melempar (jaringan) → fallback base64 dengan batas 1 MB
  c = await runTaskFormPaste({ savedId: 33, fetchImpl: offlineFetch, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], [OVER_MSG, "error"]]);
  assert.deepEqual(c.inserts, []);
});

test("TaskFormModal.handleNoteImagePaste picker online + isi kosong: note tetap dibuat lalu gambar diunggah", async () => {
  const c = await runTaskFormPaste({ savedId: null, content: "", fetchImpl: createThenUpload, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.order, [
    "fetch https://api.test/api/scratchpad",
    "toast Mengunggah gambar…",
    "fetch https://api.test/api/scratchpad/33/attachments",
  ]);
  assert.equal(c.bodies[0].content, "");
  assert.equal(c.bodies[0].title, "Judul");
  assert.deepEqual(c.inserts, ["![f.png](/api/scratchpad/attachments/4/view)"]);
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"]], "tanpa toast galat 1 MB");
  assert.equal(c.savedId, 33);
  assert.deepEqual(c.events, ["noteSaved"]);
});

test("TaskFormModal.handleNoteImagePaste picker offline: tanpa membuat note/unggah, tanpa toast 'Mengunggah'", async () => {
  let c = await runTaskFormPaste({ savedId: null, content: "isi", online: false, fetchImpl: createThenUpload, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.order, []);
  assert.deepEqual(c.inserts, ["![k.png](data:image/png;base64,AAA)"]);
  assert.equal(c.savedId, null);
  c = await runTaskFormPaste({ savedId: 33, online: false, fetchImpl: okUpload, file: { name: "f.png", size: BIG }, opts: PICK });
  assert.deepEqual(c.order, ["toast " + OVER_MSG]);
  assert.deepEqual(c.inserts, []);
});

test("TaskFormModal.handleNoteImagePaste picker: server menolak → toast detail, tidak disisipkan, tanpa base64", async () => {
  let c = await runTaskFormPaste({ savedId: 33, fetchImpl: tooLarge, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], ["File terlalu besar (maks 10 MB)", "error"]]);
  assert.deepEqual(c.inserts, []);
  c = await runTaskFormPaste({ savedId: 33, fetchImpl: badGateway, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.toasts, [["Mengunggah gambar…", "info"], ["Unggah gambar gagal", "error"]]);
  assert.deepEqual(c.inserts, []);
  // pembuatan note ditolak server → galat juga, tanpa unggah/base64
  const createRejected = async (url) => url.endsWith("/api/scratchpad")
    ? { ok: false, status: 422, json: async () => ({ detail: "Judul terlalu panjang" }) }
    : { ok: true, json: async () => ({ id: 4 }) };
  c = await runTaskFormPaste({ savedId: null, content: "isi", fetchImpl: createRejected, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.order, ["fetch https://api.test/api/scratchpad", "toast Judul terlalu panjang"]);
  assert.deepEqual(c.inserts, []);
  assert.equal(c.savedId, null);
  // 422 validasi FastAPI: detail berupa ARRAY → pesan umum, bukan "[object Object]"
  const create422 = async (url) => url.endsWith("/api/scratchpad")
    ? { ok: false, status: 422, json: async () => ({ detail: [{ type: "int_parsing", loc: ["body", "linked_task_ids", 1], msg: "Input should be a valid integer", input: "c-1" }] }) }
    : { ok: true, json: async () => ({ id: 4 }) };
  c = await runTaskFormPaste({ savedId: null, content: "isi", fetchImpl: create422, file: { name: "k.png", size: 300 }, opts: PICK });
  assert.deepEqual(c.toasts, [["Unggah gambar gagal", "error"]]);
  assert.deepEqual(c.inserts, []);
  // tempel: server menolak → tetap fallback base64 seperti dulu
  c = await runTaskFormPaste({ savedId: 33, fetchImpl: tooLarge, file: { name: "k.png", size: 300 } });
  assert.deepEqual(c.toasts, []);
  assert.deepEqual(c.inserts, ["![k.png](data:image/png;base64,AAA)"]);
});

test("TaskFormModal.handleNoteImagePaste: id task cid (task belum di-push) → id server di body create; tak terselesaikan dibuang", async () => {
  const c = await runTaskFormPaste({
    savedId: null, content: "isi [tasklink:7] [tasklink:c-aa] \\[tasklink:c-bb\\] [tasklink:c-zz]", fetchImpl: createThenUpload,
    file: { name: "f.png", size: 300 }, opts: PICK,
    taskIds: [7, "c-aa", "c-bb", "c-zz"], idmap: { "c-aa": 41 }, raws: { "c-bb": { server_id: 42 } },
  });
  const body = c.bodies[0];
  assert.deepEqual(body.linked_task_ids, [7, 41, 42], "hanya integer (server: list[int])");
  assert.equal(body.linked_task_id, 7);
  assert.equal(body.content, "isi [tasklink:7] [tasklink:41] \\[tasklink:42\\] [tasklink:c-zz]");
  assert.equal(c.tf[0], "pushNow", "outbox didorong dulu agar task inline punya id server");
  assert.deepEqual(c.inserts, ["![f.png](/api/scratchpad/attachments/4/view)"]);
  const c2 = await runTaskFormPaste({ savedId: null, content: "isi", fetchImpl: createThenUpload, file: { name: "f.png", size: 300 }, opts: PICK, taskIds: [7] });
  assert.deepEqual(c2.tf, [], "semua id sudah angka → tanpa pushNow / idmap");
  assert.deepEqual(c2.bodies[0].linked_task_ids, [7]);
});

test("resolveTaskServerIds / rewriteTasklinkIds: angka lolos, cid → idmap lalu server_id task lokal, sisanya dibuang", async () => {
  const log = [];
  const sb = Object.assign({ setTimeout, clearTimeout }, { window: fakeTF(log, { "c-aa": 41 }, { "c-bb": { server_id: 42 }, "c-cc": { server_id: null } }) });
  vm.createContext(sb);
  vm.runInContext(TASKID_SRC() + "this.resolve = resolveTaskServerIds; this.rewrite = rewriteTasklinkIds;", sb);
  const r = plain(await sb.resolve([7, "12", "c-aa", "c-bb", "c-cc", "c-zz", 7, "c-aa"]));
  assert.deepEqual(r.ids, [7, 12, 41, 42]);
  assert.deepEqual(r.map, { "c-aa": 41, "c-bb": 42 });
  assert.equal(log.filter((x) => x === "pushNow").length, 1);
  assert.equal(log[0], "pushNow");
  assert.equal(sb.rewrite("a [tasklink:c-aa] [tasklink:c-aab] \\[tasklink:c-bb\\] [tasklink:c-zz]", r.map),
    "a [tasklink:41] [tasklink:c-aab] \\[tasklink:42\\] [tasklink:c-zz]", "hanya tautan utuh");
  assert.equal(sb.rewrite("tanpa", {}), "tanpa");
  // tanpa TF / __pushNow menggantung → tetap selesai (batas waktu), cid dibuang
  const sb2 = { setTimeout: (fn) => setImmediate(fn), clearTimeout: () => {}, window: { __pushNow: () => new Promise(() => {}) } };
  vm.createContext(sb2);
  vm.runInContext(TASKID_SRC() + "this.resolve = resolveTaskServerIds;", sb2);
  assert.deepEqual(plain(await sb2.resolve([5, "c-x"])), { ids: [5], map: {} });
});

// ── Simpan quick-note TaskFormModal: gambar sudah membuat note server → perbarui note itu, bukan note kedua ──
async function runQuickNoteSubmit({ savedId, fetchImpl, content, taskIds, idmap, raws, postImpl }) {
  const calls = { order: [], posts: [], events: [], saved: 0, alerts: [], loading: [], syncs: 0, tf: [] };
  const submittedRef = { current: false };
  const sandbox = {
    noteSavedIdRef: { current: savedId },
    noteSubmittedRef: submittedRef,
    setTimeout, clearTimeout,
    noteForm: { title: "Judul", content: content == null ? "isi #tag ![a](/api/scratchpad/attachments/4/view)" : content },
    notePaperConfig: { enabled: true },
    extractTaskIdsFromContent: () => (taskIds || [7]).slice(),
    __token: "tok",
    apiUrl: (p) => "https://api.test" + p,
    fetch: async (url, init) => {
      calls.order.push((init && init.method) + " " + url);
      calls.lastInit = { method: init.method, headers: init.headers, body: JSON.parse(init.body) };
      return fetchImpl(url, init);
    },
    api: { post: async (url, body) => { calls.order.push("api.post " + url); calls.posts.push(body); if (postImpl) return postImpl(); return { id: "c1" }; } },
    setLoading: (v) => calls.loading.push(v),
    alert: (m) => calls.alerts.push(m),
    onSave: () => { calls.saved++; },
    CustomEvent: class { constructor(n) { this.type = n; } },
    window: Object.assign({ dispatchEvent: (e) => calls.events.push(e.type), __syncNow: async () => { calls.syncs++; } },
      fakeTF(calls.tf, idmap, raws)),
  };
  vm.createContext(sandbox);
  const tf = taskFormSrc();
  const block = blockAfter(tf, 'if (mode === "note")', tf.indexOf("const handleSubmit = async (e, opts) => {"));
  vm.runInContext(TASKID_SRC() + "this.fn = async function () { const mode = 'note';\n" + block + "\n};", sandbox);
  await sandbox.fn();
  await new Promise((r) => setImmediate(r));
  calls.submitted = submittedRef.current;
  return plain(calls);
}
const EXPECTED_NOTE_BODY = {
  title: "Judul",
  content: "isi #tag ![a](/api/scratchpad/attachments/4/view)",
  tags: ["tag"],
  linked_task_ids: [7],
  linked_task_id: 7,
  meta_json: JSON.stringify({ paper_mode: { enabled: true } }),
};

test("TaskFormModal simpan quick-note: tanpa note server → api.post lokal seperti dulu", async () => {
  const c = await runQuickNoteSubmit({ savedId: null, fetchImpl: async () => assert.fail("tanpa fetch mentah") });
  assert.deepEqual(c.order, ["api.post /api/scratchpad"]);
  assert.deepEqual(c.posts, [EXPECTED_NOTE_BODY]);
  assert.deepEqual(c.events, ["noteSaved"]);
  assert.equal(c.saved, 1);
  assert.equal(c.syncs, 0);
});

test("TaskFormModal simpan quick-note: gambar sudah membuat note server → PUT note itu (tanpa note kedua) + sync", async () => {
  const c = await runQuickNoteSubmit({ savedId: 33, fetchImpl: async () => ({ ok: true, json: async () => ({ id: 33 }) }) });
  assert.deepEqual(c.order, ["PUT https://api.test/api/scratchpad/33"], "tidak ada api.post → hanya satu note");
  assert.deepEqual(c.lastInit.body, EXPECTED_NOTE_BODY);
  assert.equal(c.lastInit.headers.Authorization, "Bearer tok");
  assert.equal(c.lastInit.headers["Content-Type"], "application/json");
  assert.equal(c.syncs, 1, "sync pull mengadopsi note server ke daftar lokal");
  assert.deepEqual(c.events, ["noteSaved"]);
  assert.equal(c.saved, 1);
  assert.deepEqual(c.alerts, []);
  assert.equal(c.submitted, true, "simpan sukses → note server TIDAK dihapus saat modal ditutup");
});

test("TaskFormModal simpan quick-note: PUT mentah memetakan id task cid → id server; api.post lokal tetap memakai cid", async () => {
  const content = "isi [tasklink:7] [tasklink:c-aa] [tasklink:c-zz]";
  let c = await runQuickNoteSubmit({ savedId: 33, content, taskIds: [7, "c-aa", "c-zz"], idmap: { "c-aa": 41 },
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 33 }) }) });
  assert.deepEqual(c.lastInit.body.linked_task_ids, [7, 41]);
  assert.equal(c.lastInit.body.linked_task_id, 7);
  assert.equal(c.lastInit.body.content, "isi [tasklink:7] [tasklink:41] [tasklink:c-zz]");
  assert.deepEqual(c.order, ["PUT https://api.test/api/scratchpad/33"]);
  c = await runQuickNoteSubmit({ savedId: 33, content, taskIds: [7, "c-aa", "c-zz"], idmap: { "c-aa": 41 },
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(c.posts[0].linked_task_ids, [7, "c-aa", "c-zz"], "router lokal menerima cid (S15)");
  assert.equal(c.posts[0].content, content);
  c = await runQuickNoteSubmit({ savedId: null, content, taskIds: [7, "c-aa"], idmap: { "c-aa": 41 }, fetchImpl: async () => assert.fail() });
  assert.deepEqual(c.tf, [], "tanpa note server: tidak perlu memetakan id task");
});

test("TaskFormModal simpan quick-note: PUT gagal (jaringan / non-ok) → api.post lokal agar isi tidak hilang", async () => {
  let c = await runQuickNoteSubmit({ savedId: 33, fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(c.order, ["PUT https://api.test/api/scratchpad/33", "api.post /api/scratchpad"]);
  assert.deepEqual(c.posts, [EXPECTED_NOTE_BODY]);
  assert.equal(c.saved, 1);
  assert.equal(c.syncs, 0);
  c = await runQuickNoteSubmit({ savedId: 33, fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ detail: "Note not found" }) }) });
  assert.deepEqual(c.order, ["PUT https://api.test/api/scratchpad/33", "api.post /api/scratchpad"]);
  assert.equal(c.saved, 1);
  assert.equal(c.submitted, true, "isi lokal merujuk lampiran note server → jangan dihapus");
  c = await runQuickNoteSubmit({ savedId: 33, fetchImpl: async () => { throw new TypeError("x"); }, postImpl: async () => { throw new Error("gagal lokal"); } });
  assert.equal(c.saved, 0);
  assert.equal(c.submitted, false, "simpan gagal → tetap dianggap belum tersimpan");
});

// ── Modal ditutup tanpa simpan sukses → note server yatim (dibuat demi lampiran) dihapus ──
function runDiscard(serverId, submitted, fetchImpl) {
  const calls = { order: [], inits: [], syncs: 0 };
  const sb = {
    __token: "tok",
    apiUrl: (p) => "https://api.test" + p,
    fetch: (url, init) => { calls.order.push(init.method + " " + url); calls.inits.push(init); return (fetchImpl || (async () => ({ ok: true })))(url, init); },
    window: { __syncNow: async () => { calls.syncs++; } },
  };
  vm.createContext(sb);
  vm.runInContext(blockAfter(html, "function discardOrphanQuickNote(") + "\nthis.fn = discardOrphanQuickNote;", sb);
  const ret = sb.fn(serverId, submitted);
  return { calls, ret };
}

test("discardOrphanQuickNote: DELETE note server bila belum disimpan; tidak setelah simpan / id lokal / kosong", async () => {
  let r = runDiscard(33, false);
  await r.ret;
  assert.deepEqual(r.calls.order, ["DELETE https://api.test/api/scratchpad/33"]);
  assert.equal(r.calls.inits[0].headers.Authorization, "Bearer tok");
  assert.equal(r.calls.syncs, 1, "sync agar note yang sempat diadopsi lokal ikut hilang");
  for (const [id, sub] of [[33, true], [null, false], ["c-uuid", false], ["0", false], [undefined, false]]) {
    r = runDiscard(id, sub);
    assert.equal(r.ret, null);
    assert.deepEqual(r.calls.order, [], String(id) + "/" + sub);
  }
  r = runDiscard("33", false, async () => { throw new TypeError("Failed to fetch"); });
  await r.ret; // gagal diabaikan (tidak melempar)
  assert.deepEqual(r.calls.order, ["DELETE https://api.test/api/scratchpad/33"]);
  assert.equal(r.calls.syncs, 0);
});

test("TaskFormModal: unmount tanpa simpan sukses → discardOrphanQuickNote; noteSubmittedRef di-set setelah simpan note", () => {
  const tf = taskFormSrc();
  assert.match(tf, /const noteSubmittedRef = React\.useRef\(false\);/);
  assert.match(tf, /React\.useEffect\(\(\) => \(\) => \{\s*discardOrphanQuickNote\(noteSavedIdRef\.current, noteSubmittedRef\.current\);\s*\}, \[\]\);/);
  const block = blockAfter(tf, 'if (mode === "note")', tf.indexOf("const handleSubmit = async (e, opts) => {"));
  assert.ok(block.indexOf("noteSubmittedRef.current = true;") < block.indexOf("onSave();"), "ditandai sebelum onSave (modal ditutup)");
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
