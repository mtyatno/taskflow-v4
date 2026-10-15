"use strict";
// S5 (audit 2026-10-15, workstream D): iframe tldraw menerapkan snapshot `load` susulan sebagai DIFF (put record
// yang berubah/baru, remove record dokumen yang hilang), melindungi record yang disentuh user & belum terkirim,
// menunda saat pointer ditekan, dan mengabaikan load basi (basedOn ≠ snapshot terakhir yang dikirim).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const appJsx = fs.readFileSync(path.join(__dirname, "../../draw-app/src/App.jsx"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

function loadDiffFn() {
  const m = appJsx.match(/const DOC_TYPES = new Set\([\s\S]*?\nfunction applySnapshotDiff\([\s\S]*?\n\}\n/);
  assert.ok(m, "applySnapshotDiff harus ada di App.jsx");
  return new Function(m[0] + "\nreturn applySnapshotDiff;")();
}
const DOC = new Set(["document", "page", "shape", "asset", "binding"]);
function fakeEditor(records) {
  const store = Object.assign({}, records);
  const log = { puts: [], removes: [], merges: 0, usable: 0 };
  const editor = {
    store: {
      scopedTypes: { document: DOC },
      schema: { migrateStoreSnapshot: (snap) => ({ type: "success", value: snap.store }), serialize: () => ({ schemaVersion: 2 }) },
      getStoreSnapshot: () => ({ store: Object.fromEntries(Object.entries(store).filter(([, r]) => DOC.has(r.typeName))), schema: { schemaVersion: 2 } }),
      mergeRemoteChanges: (fn) => { log.merges++; fn(); },
      put: (recs) => { for (const r of recs) { store[r.id] = r; log.puts.push(r.id); } },
      remove: (ids) => { for (const id of ids) { delete store[id]; log.removes.push(id); } },
      ensureStoreIsUsable: () => { log.usable++; },
    },
  };
  return { editor, store, log };
}
const shape = (id, over) => Object.assign({ id, typeName: "shape", type: "draw", x: 0, y: 0, props: { color: "black" } }, over || {});
const page = { id: "page:page", typeName: "page", name: "Page 1", index: "a1" };
const camera = { id: "camera:page:page", typeName: "camera", x: 10, y: 10, z: 1 };

test("applySnapshotDiff: puts changed/new document records, removes missing ones, leaves session records and untouched equal records alone", () => {
  const applySnapshotDiff = loadDiffFn();
  const { editor, store, log } = fakeEditor({
    "page:page": page, "camera:page:page": camera,
    "shape:S": shape("shape:S"), "shape:K": shape("shape:K", { x: 5 }), "shape:M": shape("shape:M", { x: 1 }),
  });
  const incoming = { store: {
    "page:page": Object.assign({}, page),
    "shape:K": shape("shape:K", { x: 5 }),           // sama (urutan kunci beda pun tidak di-put)
    "shape:M": shape("shape:M", { x: 99 }),          // berubah di remote
    "shape:U": shape("shape:U"),                     // baru dari remote
    // shape:S hilang → dihapus di remote
  }, schema: { schemaVersion: 2 } };
  const res = applySnapshotDiff(editor, incoming, { touched: new Set(), removed: new Set() });
  assert.deepEqual(res, { puts: 2, removes: 1 });
  assert.deepEqual(log.puts.sort(), ["shape:M", "shape:U"]);
  assert.deepEqual(log.removes, ["shape:S"]);
  assert.equal(store["shape:M"].x, 99);
  assert.ok(store["camera:page:page"], "record sesi (kamera) tidak disentuh");
  assert.equal(log.merges, 1);
  assert.equal(log.usable, 1);
  // tidak ada perbedaan → tidak ada transaksi
  const res2 = applySnapshotDiff(editor, { store: editor.store.getStoreSnapshot().store, schema: {} }, {});
  assert.deepEqual(res2, { puts: 0, removes: 0 });
  assert.equal(log.merges, 1);
});

test("applySnapshotDiff: records touched by the user and not yet posted win (not overwritten, not removed); locally removed ones are not re-added", () => {
  const applySnapshotDiff = loadDiffFn();
  const { editor, store, log } = fakeEditor({
    "page:page": page,
    "shape:T": shape("shape:T", { x: 7 }),   // coretan baru user, belum terkirim → remote belum tahu
    "shape:E": shape("shape:E", { x: 3 }),   // sedang diedit user (belum terkirim), remote juga mengubahnya
  });
  const incoming = { store: {
    "page:page": page,
    "shape:E": shape("shape:E", { x: 50 }),
    "shape:R": shape("shape:R"),             // dihapus user secara lokal (belum terkirim), masih ada di remote
  }, schema: {} };
  const res = applySnapshotDiff(editor, incoming, { touched: new Set(["shape:T", "shape:E"]), removed: new Set(["shape:R"]) });
  assert.deepEqual(res, { puts: 0, removes: 0 });
  assert.ok(store["shape:T"], "coretan belum terkirim tidak dihapus");
  assert.equal(store["shape:E"].x, 3, "edit lokal belum terkirim tidak ditimpa");
  assert.equal(store["shape:R"], undefined, "hapus lokal belum terkirim tidak dihidupkan lagi");
  assert.equal(log.merges, 0);
});

test("applySnapshotDiff: migration failure throws (caller posts loadFailed, canvas untouched)", () => {
  const applySnapshotDiff = loadDiffFn();
  const { editor, log } = fakeEditor({ "page:page": page });
  editor.store.schema.migrateStoreSnapshot = () => ({ type: "error", reason: "too new" });
  assert.throws(() => applySnapshotDiff(editor, { store: {}, schema: {} }, {}), /migrasi snapshot gagal/);
  assert.equal(log.merges, 0);
});

test("App.jsx: subsequent loads go through applySnapshotDiff, defer while pointer is down, drop stale loads (basedOn), first load still uses loadSnapshot", () => {
  const handler = appJsx.slice(appJsx.indexOf("if (e.data?.type === 'load' && editorRef.current)"), appJsx.indexOf("if (e.data?.type === 'loadError')"));
  assert.match(handler, /if \(!isEcho && loadedRef\.current\) \{/);
  assert.match(handler, /if \(basedOn != null && basedOn !== lastSnapshotStrRef\.current\) return;/);
  assert.match(handler, /if \(pointerDownRef\.current\) \{[\s\S]*?pendingLoadRef\.current = \{ snapshot, incomingStr, svgStale: !!e\.data\.svgStale \};[\s\S]*?return;/);
  assert.match(handler, /applySnapshotDiff\(editor, snapshot, \{ touched: localTouchedRef\.current, removed: localRemovedRef\.current \}\)/);
  assert.match(handler, /loadSnapshot\(editor\.store, snapshot\);/, "load pertama tetap loadSnapshot");
  // pointer dilepas → load tertunda diterapkan; blur jendela juga melepas
  assert.match(appJsx, /document\.addEventListener\('pointerup', up, true\)/);
  assert.match(appJsx, /window\.addEventListener\('blur', up\)/);
  // record yang disentuh dicatat dari listener source 'user' dan dibersihkan saat snapshot dikirim
  assert.match(appJsx, /for \(const id of Object\.keys\(ch\.added \|\| \{\}\)\) \{ localTouchedRef\.current\.add\(id\); localRemovedRef\.current\.delete\(id\); \}/);
  assert.equal((appJsx.match(/localTouchedRef\.current = new Set\(\);/g) || []).length, 2, "dibersihkan di syncToParent & pagehide");
});

test("index.html: both drawing hosts send basedOn with subsequent loads and skip a load when the iframe posted during the read", () => {
  const n = (indexHtml.match(/const basedOn = lastLoadedJsonRef\.current;\n\s*const fresh = await api\.get\(`\/api\/drawings\/\$\{(tab\.id|drawingId)\}`\);/g) || []).length;
  assert.equal(n, 2, "DrawingTabInstance & QuickDrawModal");
  assert.equal((indexHtml.match(/if \(lastLoadedJsonRef\.current !== basedOn\) return;/g) || []).length, 2);
  assert.equal((indexHtml.match(/svgStale: !!fresh\.svg_stale,\n\s*basedOn\n/g) || []).length, 2);
});
