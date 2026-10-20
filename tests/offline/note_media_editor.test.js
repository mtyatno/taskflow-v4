"use strict";
// Task 5 (media di note): editor — node Milkdown `media`, tombol 🎬, unggah dari note.
// Logika diambil dengan potongan static/index.html lalu dijalankan di vm (pola render_markdown_media.test.js).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(rootDir, "static/index.html"), "utf8");
const MD = require(path.join(rootDir, "static/offline/mediadirective.js"));

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, "marker not found: " + startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(b > a, "end marker not found: " + endMarker);
  return html.slice(a, b);
}

const UPLOAD_BLOCK_START = "// ── Unggah media dari editor note ──";
const UPLOAD_BLOCK_END = "// ── Akhir unggah media dari editor note ──";

// Sandbox berisi blok unggah (ensureServerNoteId, beginNoteMediaUpload, ensureMediaUploadManager).
function uploadCtx(win) {
  const timers = [];
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout(fn, ms) { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout(t) { if (t) t.cleared = true; },
    Promise,
    __token: "tok-1",
    apiUrl: (p) => "https://api.test" + p,
    navigator: { onLine: true },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  sandbox.window = Object.assign(sandbox, win || {});
  vm.createContext(sandbox);
  vm.runInContext(slice(UPLOAD_BLOCK_START, UPLOAD_BLOCK_END), sandbox);
  vm.runInContext(
    "this.ensureServerNoteId = ensureServerNoteId; this.beginNoteMediaUpload = beginNoteMediaUpload;" +
    "this.ensureMediaUploadManager = ensureMediaUploadManager; this.MEDIA_PUSH_TIMEOUT_MS = MEDIA_PUSH_TIMEOUT_MS;",
    sandbox
  );
  sandbox.__timers = timers;
  return sandbox;
}

const plain = (v) => JSON.parse(JSON.stringify(v)); // objek dari realm vm → bandingkan sebagai data
const flush = () => new Promise((r) => setImmediate(r));

test("ensureServerNoteId: id angka langsung tanpa push; cid lokal → pushNow lalu idmap; tetap kosong → null", async () => {
  let pushes = 0;
  const idmap = new Map();
  const ctx = uploadCtx({
    __pushNow: () => { pushes++; idmap.set("cid-a", 77); return Promise.resolve({ pushed: 1 }); },
    TF: {
      idmap: { serverIdOf: (cid) => Promise.resolve(idmap.get(cid)) },
      noterepo: { getNoteRaw: (cid) => Promise.resolve(cid === "cid-b" ? { cid, server_id: 88 } : null) },
    },
  });
  assert.equal(await ctx.ensureServerNoteId(42), 42);
  assert.equal(await ctx.ensureServerNoteId("42"), 42);
  assert.equal(pushes, 0, "id server tidak memicu push");
  assert.equal(await ctx.ensureServerNoteId("cid-a"), 77);
  assert.equal(pushes, 1);
  // idmap kosong → baris lokal server_id
  assert.equal(await ctx.ensureServerNoteId("cid-b"), 88);
  assert.equal(await ctx.ensureServerNoteId("cid-c"), null);
  assert.equal(await ctx.ensureServerNoteId(null), null);
  assert.equal(await ctx.ensureServerNoteId(""), null);
  assert.equal(ctx.MEDIA_PUSH_TIMEOUT_MS, 5000);
});

test("ensureServerNoteId: pushNow menggantung → dibatasi 5 dtk lalu null; pushNow melempar → tetap lanjut", async () => {
  const ctx = uploadCtx({ __pushNow: () => new Promise(() => {}), TF: { idmap: { serverIdOf: () => Promise.resolve(undefined) } } });
  const p = ctx.ensureServerNoteId("cid-x");
  await flush();
  const t = ctx.__timers.find((x) => x.ms === 5000 && !x.cleared);
  assert.ok(t, "batas waktu 5000 ms dipasang");
  t.fn();
  assert.equal(await p, null);

  const ctx2 = uploadCtx({ __pushNow: () => Promise.reject(new Error("x")), TF: { idmap: { serverIdOf: () => Promise.resolve(5) } } });
  assert.equal(await ctx2.ensureServerNoteId("cid-y"), 5);
  // tanpa __pushNow / TF sama sekali → null, tidak melempar
  const ctx3 = uploadCtx({});
  assert.equal(await ctx3.ensureServerNoteId("cid-z"), null);
});

function fakeFile(name, size) { return { name, size, type: "video/mp4", lastModified: 1 }; }

function flowDeps(over) {
  const log = [];
  const deps = Object.assign({
    MD,
    toast: (m) => log.push(["toast", m]),
    ensureId: async (id) => { log.push(["ensure", id]); return 9; },
    insert: (md) => { log.push(["insert", md]); return true; },
    manager: { start: (o) => { log.push(["start", o.noteId, o.cid, o.file.name]); return Promise.resolve(); } },
    onServerId: (sid) => log.push(["sid", sid]),
  }, over || {});
  return { deps, log };
}

test("beginNoteMediaUpload: validasi format/ukuran dengan teks persis, tanpa direktif", async () => {
  const ctx = uploadCtx({});
  let { deps, log } = flowDeps();
  assert.equal(await ctx.beginNoteMediaUpload(Object.assign({ file: fakeFile("a.exe", 10), noteId: 1 }, deps)), null);
  assert.deepEqual(log, [["toast", "Format tidak didukung"]]);
  ({ deps, log } = flowDeps());
  assert.equal(await ctx.beginNoteMediaUpload(Object.assign({ file: fakeFile("a.mp4", 2048 * 1024 * 1024 + 1), noteId: 1 }, deps)), null);
  assert.deepEqual(log, [["toast", "File terlalu besar (maks 2 GB)"]]);
  ({ deps, log } = flowDeps());
  const okCid = await ctx.beginNoteMediaUpload(Object.assign({ file: fakeFile("a.MOV", 2048 * 1024 * 1024), noteId: 1 }, deps));
  assert.ok(okCid, "tepat 2048 MiB masih boleh");
});

test("beginNoteMediaUpload: id server null → toast persis, TANPA direktif dan tanpa unggah", async () => {
  const ctx = uploadCtx({});
  const { deps, log } = flowDeps({ ensureId: async () => null });
  assert.equal(await ctx.beginNoteMediaUpload(Object.assign({ file: fakeFile("v.mp4", 10), noteId: "cid-local" }, deps)), null);
  assert.deepEqual(log, [["toast", "Simpan catatan dulu, lalu lampirkan media"]]);
});

test("beginNoteMediaUpload: urutan ensureId → insert direktif → start(noteId server, cid sama)", async () => {
  const ctx = uploadCtx({});
  const { deps, log } = flowDeps();
  const cid = await ctx.beginNoteMediaUpload(Object.assign({ file: fakeFile('kl"ip.mp4', 10), noteId: "cid-local" }, deps));
  assert.match(cid, /^[0-9a-zA-Z_-]{1,64}$/);
  assert.deepEqual(log.map((x) => x[0]), ["ensure", "sid", "insert", "start"]);
  assert.equal(log[0][1], "cid-local");
  assert.equal(log[2][1], "\n\n" + MD.formatMediaDirective({ cid, name: 'kl"ip.mp4' }) + "\n\n");
  assert.deepEqual(log[3], ["start", 9, cid, 'kl"ip.mp4']);
});

test("beginNoteMediaUpload: editor gagal menyisipkan → unggahan tidak dimulai (tanpa baris yatim)", async () => {
  const ctx = uploadCtx({});
  const { deps, log } = flowDeps({ insert: () => false });
  assert.equal(await ctx.beginNoteMediaUpload(Object.assign({ file: fakeFile("v.mp4", 10), noteId: 3 }, deps)), null);
  assert.ok(!log.some((x) => x[0] === "start"), JSON.stringify(log));
});

test("ensureMediaUploadManager: dibuat sekali, online → kick, beforeunload saat hasActive, toast gagal sekali per cid", () => {
  const listeners = {};
  let created = 0;
  let depsSeen = null;
  const subs = [];
  let active = false;
  let kicks = 0;
  const toasts = [];
  const ctx = uploadCtx({
    fetch() { return Promise.resolve(); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    __showToast: (m, t) => toasts.push([m, t]),
    TF: {
      mediaupload: {
        createManager(deps) {
          created++;
          depsSeen = deps;
          return { kick() { kicks++; }, hasActive: () => active, subscribe(fn) { subs.push(fn); return () => {}; },
            start() {}, get() { return null; } };
        },
      },
    },
  });
  const m1 = ctx.ensureMediaUploadManager();
  const m2 = ctx.ensureMediaUploadManager();
  assert.equal(created, 1);
  assert.equal(m1, m2);
  assert.equal(ctx.window.__mediaUploads, m1);
  assert.equal(depsSeen.getToken(), "tok-1");
  assert.equal(depsSeen.apiUrl("/x"), "https://api.test/x");
  assert.equal(depsSeen.isOnline(), true);
  ctx.navigator.onLine = false;
  assert.equal(depsSeen.isOnline(), false);
  assert.equal(typeof depsSeen.fetch, "function");
  assert.ok(depsSeen.storage, "storage = localStorage");

  assert.equal((listeners.online || []).length, 1);
  listeners.online[0]();
  assert.equal(kicks, 1);

  assert.equal((listeners.beforeunload || []).length, 1);
  const ev = () => ({ prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } });
  const e1 = ev();
  listeners.beforeunload[0](e1);
  assert.equal(e1.prevented, false);
  active = true;
  const e2 = ev();
  listeners.beforeunload[0](e2);
  assert.equal(e2.prevented, true);
  assert.equal(e2.returnValue, "");

  assert.equal(subs.length, 1);
  subs[0]("c1", { phase: "uploading" });
  subs[0]("c1", { phase: "failed", error: "Kuota penuh" });
  subs[0]("c1", { phase: "failed", error: "Kuota penuh" });
  subs[0]("c2", { phase: "failed", error: "File berbeda — pilih file yang sama dengan yang diunggah", retryable: true });
  assert.deepEqual(toasts, [["Kuota penuh", "error"]]);

  // modul absen → null, tidak melempar
  const bare = uploadCtx({ addEventListener() {} });
  assert.equal(bare.ensureMediaUploadManager(), null);
});

// ── createMediaPlugin (node Milkdown) dengan MB palsu ──
function pluginCtx(withModule) {
  const sandbox = { console: { warn() {}, log() {}, error() {} } };
  sandbox.window = sandbox;
  if (withModule) sandbox.TF = { mediadirective: MD };
  vm.createContext(sandbox);
  vm.runInContext(slice("function createMediaPlugin(MB) {", "\nfunction remarkHighlightPlugin()") + "\nthis.createMediaPlugin = createMediaPlugin;", sandbox);
  return sandbox;
}
const fakeMB = {
  $node: (name, fn) => ({ kind: "node", name, spec: fn() }),
  $remark: (name, fn) => ({ kind: "remark", name, plugin: fn() }),
};

test("createMediaPlugin: node `media` atom, parse mediaDirective → attrs, toMarkdown → formatMediaDirective", () => {
  const ctx = pluginCtx(true);
  const out = ctx.createMediaPlugin(fakeMB);
  assert.equal(out.length, 2);
  const remark = out.find((x) => x.kind === "remark");
  const node = out.find((x) => x.kind === "node");
  assert.equal(remark.name, "media-remark");
  assert.equal(remark.plugin, MD.remarkMediaPlugin);
  assert.equal(node.name, "media");
  const spec = node.spec;
  assert.equal(spec.atom, true);
  assert.deepEqual(Object.keys(spec.attrs).sort(), ["cid", "name"]);

  // markdown → mdast (remark plugin) → node attrs
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: '::media[ab-1]{name="x \\"y\\".mp4"}' }] }] };
  MD.remarkMediaPlugin()(tree);
  const mnode = tree.children[0].children.find((n) => n.type === "mediaDirective");
  assert.ok(mnode);
  assert.equal(spec.parseMarkdown.match(mnode), true);
  assert.equal(spec.parseMarkdown.match({ type: "text" }), false);
  const added = [];
  spec.parseMarkdown.runner({ addNode: (t, a) => added.push([t, a]) }, mnode, "MEDIA_TYPE");
  assert.deepEqual(plain(added), [["MEDIA_TYPE", { cid: "ab-1", name: 'x "y".mp4' }]]);

  // node → markdown
  const pmNode = { type: { name: "media" }, attrs: { cid: "ab-1", name: 'x "y".mp4' } };
  assert.equal(spec.toMarkdown.match(pmNode), true);
  assert.equal(spec.toMarkdown.match({ type: { name: "drawing" }, attrs: {} }), false);
  const emitted = [];
  spec.toMarkdown.runner({ addNode: (t, c, v) => emitted.push([t, c, v]) }, pmNode);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], "text");
  assert.equal(emitted[0][2], MD.formatMediaDirective({ cid: "ab-1", name: 'x "y".mp4' }));
  // round-trip: keluaran (juga bentuk ter-escape remark-stringify) terbaca lagi sama
  for (const txt of [emitted[0][2], emitted[0][2].replace("::media[", "\\::media\\[").replace("]{", "\\]{")]) {
    const p = MD.parseMediaDirective(txt);
    assert.deepEqual({ cid: p.cid, name: p.name }, { cid: "ab-1", name: 'x "y".mp4' });
  }
});

test("createMediaPlugin: toDOM kartu editor (atribut data, contenteditable=false), parseDOM membaca balik", () => {
  const ctx = pluginCtx(true);
  const spec = ctx.createMediaPlugin(fakeMB).find((x) => x.kind === "node").spec;
  const dom = spec.toDOM({ attrs: { cid: "c-9", name: "<b>v</b>.mp3" } });
  assert.equal(dom[0], "div");
  const a = dom[1];
  assert.equal(a.class, "note-media-card editor-media-card");
  assert.equal(a["data-media-card"], "");
  assert.equal(a["data-media-cid"], "c-9");
  assert.equal(a["data-media-name"], "<b>v</b>.mp3"); // atribut DOM (setAttribute) → aman tanpa escape manual
  assert.equal(a.contenteditable, "false");
  assert.ok(dom.length >= 3, "punya isi awal (memuat)");
  assert.ok(!JSON.stringify(dom.slice(2)).includes("<b>"), "nama tidak muncul sebagai HTML/teks anak mentah");
  const pd = spec.parseDOM[0];
  assert.match(pd.tag, /data-media-card/);
  const fakeEl = { getAttribute: (k) => ({ "data-media-cid": "c-9", "data-media-name": "n.mp3" })[k] };
  assert.deepEqual(plain(pd.getAttrs(fakeEl)), { cid: "c-9", name: "n.mp3" });
});

test("createMediaPlugin: tanpa TF.mediadirective / MB → [] (editor tetap jalan)", () => {
  assert.deepEqual(plain(pluginCtx(false).createMediaPlugin(fakeMB)), []);
  assert.deepEqual(plain(pluginCtx(true).createMediaPlugin(null)), []);
});

// ── Struktural ──
test("Editor: createMediaPlugin terdaftar di rantai .use(), hidrasi kartu media di editor, klik kartu tidak diteruskan", () => {
  assert.ok(/\.use\(createDrawingPlugin\(MB\)\)\.use\(createMediaPlugin\(MB\)\)/.test(html), "plugin terdaftar");
  const ed = slice("function MilkdownEditor({", "\nfunction createDrawingPlugin(MB)");
  assert.ok(/mediaNoteId/.test(ed) && /mediaNoteOwnerId/.test(ed), "prop id note untuk kartu");
  assert.ok(/window\.hydrateMediaCards\(containerRef\.current, \{\s*noteId: mediaNoteId,\s*noteOwnerId: mediaNoteOwnerId\s*\}\)/.test(ed), "hidrasi kartu di editor");
  assert.ok(/MutationObserver/.test(ed), "DOM node dibuat ulang ProseMirror → hidrasi ulang");
  assert.ok(/closest\('\.editor-media-card'\)/.test(ed), "handleContainerClick punya cabang kartu media");
});

test("NoteToolbar: tombol \"🎬 Audio/Video\", input accept dari MEDIA_EXTS, title offline persis, listener online/offline", () => {
  const tb = slice("function NoteToolbar({", "\nfunction MilkdownEditor({");
  assert.ok(tb.includes("onInsertMedia"), "prop onInsertMedia");
  assert.ok(tb.includes('"🎬 Audio/Video"'), "label tombol persis");
  assert.ok(tb.includes("'Butuh koneksi internet untuk mengunggah audio/video'"), "title offline persis");
  assert.ok(/addEventListener\('online'/.test(tb) && /addEventListener\('offline'/.test(tb), "status online dipantau");
  assert.ok(/removeEventListener\('online'/.test(tb) && /removeEventListener\('offline'/.test(tb));
  assert.ok(/accept: mediaAccept/.test(tb), "input media memakai accept dari MEDIA_EXTS");
  // accept terhitung = semua ekstensi .ext
  const accept = MD.MEDIA_EXTS.map((x) => "." + x).join(",");
  assert.ok(accept.includes(".mp3") && accept.includes(".mov"));
  assert.ok(/MEDIA_EXTS\.map\(x => '\.' \+ x\)\.join\(','\)/.test(tb), "accept dibangun dari MEDIA_EXTS");
  assert.ok(/disabled: !mediaOnline \|\| !noteId/.test(tb), "nonaktif saat offline / note belum ada");
});

test("NoteModal: onInsertMedia ke toolbar, id server untuk kartu editor, pemilik note", () => {
  const nm = slice("function NoteModal({", "\nfunction ");
  assert.ok(/onInsertMedia: handleInsertMedia/.test(nm));
  assert.ok(/beginNoteMediaUpload\(/.test(nm) && /ensureServerNoteId/.test(nm) && /ensureMediaUploadManager\(\)/.test(nm));
  assert.ok(/mediaNoteId: mediaNoteIdForCards/.test(nm), "editor menerima id server untuk hidrasi");
  assert.ok(/mediaNoteOwnerId: mediaNoteOwnerId/.test(nm));
});

test("App: manajer unggah dibuat lewat ensureMediaUploadManager (sekali, penjaga tingkat modul)", () => {
  const app = slice("function App() {", "\n  const [user, setUser]");
  assert.ok(/ensureMediaUploadManager\(\)/.test(app), "App memanggil pembuat manajer");
  const blk = slice(UPLOAD_BLOCK_START, UPLOAD_BLOCK_END);
  assert.ok(/if \(window\.__mediaUploads\) return window\.__mediaUploads;/.test(blk), "penjaga sekali");
  assert.ok(blk.indexOf(UPLOAD_BLOCK_START) === 0 && html.indexOf(UPLOAD_BLOCK_START) > html.indexOf("// ── Akhir kartu media note ──"));
});

// ── fix wave item 4: logout menghentikan unggahan media ──
test("clearLocalUserData: abortAll manajer unggah + hapus tf_media_uploads", async () => {
  const blk = slice("async function clearLocalUserData() {", "window.clearLocalUserData = clearLocalUserData;");
  const removed = [];
  let aborted = 0;
  const sandbox = {
    window: { __mediaUploads: { abortAll() { aborted++; } } },
    localStorage: { removeItem(k) { removed.push(k); } },
    Promise, URL,
  };
  vm.createContext(sandbox);
  vm.runInContext(blk + "\nthis.clearLocalUserData = clearLocalUserData;", sandbox);
  await sandbox.clearLocalUserData();
  assert.equal(aborted, 1);
  assert.ok(removed.includes("tf_media_uploads"), removed.join(","));
  // manajer absen / abortAll melempar → tidak mematahkan logout
  sandbox.window.__mediaUploads = { abortAll() { throw new Error("x"); } };
  await sandbox.clearLocalUserData();
  sandbox.window.__mediaUploads = null;
  await sandbox.clearLocalUserData();
});

test("logout manual: abortAll dipanggil sebelum POST /api/auth/logout dan sebelum token dihapus", () => {
  const blk = slice("const logout = useCallback(async () => {", "initialLoad.current = true;");
  const iAbort = blk.indexOf("__mediaUploads?.abortAll");
  assert.ok(iAbort > 0, "abortAll tidak dipanggil di logout");
  assert.ok(iAbort < blk.indexOf('api.post("/api/auth/logout"'));
  assert.ok(iAbort < blk.indexOf("tokenStore.clear()"));
});
