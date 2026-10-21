"use strict";

// Slash menu editor note: tutup dengan Esc / klik di luar menu (2026-10-21).
// Menu dari tombol "+" → "/" sisipan "+" ikut dihapus (bila masih utuh); "/" ketikan pengguna dibiarkan
// dan menu tidak langsung muncul lagi selama kursor belum bergerak / dokumen belum berubah.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const webappPy = fs.readFileSync(path.join(root, "webapp.py"), "utf8");

const editorMatch = indexHtml.match(/function MilkdownEditor\(\{[\s\S]*?^function /m);
const editorCode = editorMatch ? editorMatch[0] : "";

// Helper murni top-level (di antara isPlusSlashIntact dan komentar block handle)
function helpers() {
  const start = indexHtml.indexOf("function isPlusSlashIntact(");
  assert.ok(start > 0, "isPlusSlashIntact harus ada");
  const end = indexHtml.indexOf("// Block handle ala Notion (+ / ⋮⋮)", start);
  assert.ok(end > start, "helper dismiss slash harus sebelum komentar block handle");
  const src = indexHtml.slice(start, end);
  return new Function(src + "\nreturn { isPlusSlashIntact, nextSlashDismissState, shouldShowSlashMenu, isSlashOutsideTarget };")();
}

// Dokumen palsu: daftar paragraf; posisi ala ProseMirror (paragraf i mulai di offset, isi di offset+1)
function fakeDoc(paras) {
  const blocks = [];
  let off = 0;
  for (const t of paras) { blocks.push({ start: off, text: t }); off += t.length + 2; }
  return {
    content: { size: off },
    resolve(pos) {
      if (pos < 0 || pos > off) throw new RangeError("posisi di luar dokumen");
      const b = blocks.find(x => pos > x.start && pos <= x.start + 1 + x.text.length);
      if (!b) return { parent: { isTextblock: false, textContent: "" }, parentOffset: 0 };
      return { parent: { isTextblock: true, textContent: b.text }, parentOffset: pos - b.start - 1 };
    }
  };
}

test("isPlusSlashIntact: hanya '/' tunggal sisipan '+' yang boleh dihapus", () => {
  const { isPlusSlashIntact } = helpers();
  // ["Isi", "/"] → paragraf "/" mulai di 5, "/" di posisi 6
  const doc = fakeDoc(["Isi", "/"]);
  assert.equal(isPlusSlashIntact(doc, 6), true);
  assert.equal(isPlusSlashIntact(doc, 5), false, "posisi batas paragraf, bukan karakter '/'");
  assert.equal(isPlusSlashIntact(doc, 1), false, "paragraf lain");
  assert.equal(isPlusSlashIntact(doc, null), false);
  assert.equal(isPlusSlashIntact(doc, undefined), false);
  assert.equal(isPlusSlashIntact(doc, -1), false);
  assert.equal(isPlusSlashIntact(doc, 999), false, "di luar dokumen → tidak melempar");
  assert.equal(isPlusSlashIntact(null, 6), false);
  // pengguna sudah mengetik setelah "/" → jangan hapus teks pengguna
  assert.equal(isPlusSlashIntact(fakeDoc(["Isi", "/head"]), 6), false);
  assert.equal(isPlusSlashIntact(fakeDoc(["Isi", "x/"]), 6), false);
  assert.equal(isPlusSlashIntact(fakeDoc(["Isi", ""]), 6), false);
});

test("nextSlashDismissState: posisi '/' dipetakan, dismissed dibersihkan saat mengetik/bergerak", async (t) => {
  const { nextSlashDismissState } = helpers();
  const tr = (opts = {}) => ({
    docChanged: !!opts.docChanged,
    selectionSet: !!opts.selectionSet,
    mapping: { mapResult: (pos, assoc) => {
      assert.equal(assoc, 1, "assoc 1: karakter '/' setelah posisi");
      return opts.map ? opts.map(pos) : { pos, deleted: false };
    } }
  });
  await t.test("awal kosong", () => {
    assert.deepEqual(nextSlashDismissState(undefined, tr(), undefined), { plusPos: null, dismissed: false });
  });
  await t.test("meta plusPos dari tombol +", () => {
    const s = nextSlashDismissState({ plusPos: null, dismissed: true }, tr({ docChanged: true, selectionSet: true }), { plusPos: 6, dismissed: false });
    assert.deepEqual(s, { plusPos: 6, dismissed: false });
  });
  await t.test("perubahan dokumen menggeser posisi", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ docChanged: true, map: p => ({ pos: p + 3, deleted: false }) }));
    assert.deepEqual(s, { plusPos: 9, dismissed: false });
  });
  await t.test("'/' terhapus → lupakan posisi", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ docChanged: true, map: p => ({ pos: p, deleted: true }) }));
    assert.equal(s.plusPos, null);
  });
  await t.test("tanpa perubahan dokumen → posisi tetap (mapping tidak dipanggil)", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ map: () => { throw new Error("tak boleh"); } }));
    assert.deepEqual(s, { plusPos: 6, dismissed: false });
  });
  await t.test("dismissed bertahan pada transaksi meta saja, hilang saat mengetik / kursor pindah", () => {
    assert.equal(nextSlashDismissState({ plusPos: null, dismissed: true }, tr()).dismissed, true);
    assert.equal(nextSlashDismissState({ plusPos: null, dismissed: true }, tr({ docChanged: true })).dismissed, false);
    assert.equal(nextSlashDismissState({ plusPos: null, dismissed: true }, tr({ selectionSet: true })).dismissed, false);
  });
  await t.test("meta dismiss (Esc / klik luar) menang atas pembersihan", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ docChanged: true, map: p => ({ pos: p, deleted: true }) }), { plusPos: null, dismissed: true });
    assert.deepEqual(s, { plusPos: null, dismissed: true });
  });
});

test("shouldShowSlashMenu: '/' terakhir, kecuali baru saja ditutup", () => {
  const { shouldShowSlashMenu } = helpers();
  assert.equal(shouldShowSlashMenu("/", { dismissed: false }), true);
  assert.equal(shouldShowSlashMenu("abc /", undefined), true);
  assert.equal(shouldShowSlashMenu("and/", null), true, "perilaku bawaan SlashProvider dipertahankan");
  assert.equal(shouldShowSlashMenu("/", { dismissed: true }), false);
  assert.equal(shouldShowSlashMenu("/h", { dismissed: false }), false);
  assert.equal(shouldShowSlashMenu("", {}), false);
  assert.equal(shouldShowSlashMenu(undefined, {}), false, "getContent undefined (editor tanpa fokus)");
});

test("isSlashOutsideTarget: klik di menu / handle bukan 'di luar'", () => {
  const { isSlashOutsideTarget } = helpers();
  const item = {}, scrollArea = {}, addBtn = {}, editorText = {}, header = {};
  const menu = { contains: n => n === menu || n === item || n === scrollArea };
  const handle = { contains: n => n === handle || n === addBtn };
  assert.equal(isSlashOutsideTarget(item, menu, [handle]), false, "item menu");
  assert.equal(isSlashOutsideTarget(scrollArea, menu, [handle]), false, "area scroll menu");
  assert.equal(isSlashOutsideTarget(menu, menu, [handle]), false);
  assert.equal(isSlashOutsideTarget(addBtn, menu, [handle]), false, "tombol + (onBlockAdd membereskan '/' lama)");
  assert.equal(isSlashOutsideTarget(editorText, menu, [handle]), true);
  assert.equal(isSlashOutsideTarget(header, menu, [handle, null]), true);
  assert.equal(isSlashOutsideTarget(header, menu), true);
  assert.equal(isSlashOutsideTarget(null, menu, [handle]), false);
});

test("MilkdownEditor: wiring dismiss slash menu", async (t) => {
  await t.test("plugin state + Esc hanya saat menu tampil, stopPropagation (modal tidak ikut tertutup)", () => {
    assert.match(editorCode, /const slashDismissKey = MB\.PluginKey \? new MB\.PluginKey\('note-slash-dismiss'\) : null;/);
    const m = editorCode.match(/const slashDismissPlugin = [\s\S]*?\n    \}\)\) : null;/);
    assert.ok(m, "slashDismissPlugin harus ada");
    assert.match(m[0], /apply: \(tr, value\) => nextSlashDismissState\(value, tr, tr\.getMeta\(slashDismissKey\)\)/);
    assert.match(m[0], /handleKeyDown: \(view, e\) => \{\s*if \(e\.key !== 'Escape' \|\| !isSlashMenuShown\(\)\) return false;\s*e\.stopPropagation\(\);\s*dismissSlashMenu\(view\);\s*return true;/);
    assert.match(editorCode, /\.use\(slashDismissPlugin \|\| \[\]\)\.use\(slashPair\)/);
  });
  await t.test("dismissSlashMenu: sembunyikan, hapus '/' sisipan '+' bila utuh, tandai dismissed", () => {
    const start = editorCode.indexOf("const dismissSlashMenu = (view) => {");
    assert.ok(start > 0);
    const src = editorCode.slice(start, editorCode.indexOf("\n    };", start));
    assert.match(src, /slashProvider\.hide\(\)/);
    assert.match(src, /isPlusSlashIntact\(view\.state\.doc, st\.plusPos\)\) tr\.delete\(st\.plusPos, st\.plusPos \+ 1\)/);
    assert.match(src, /tr\.setMeta\(slashDismissKey, \{ plusPos: null, dismissed: true \}\)/);
    assert.match(src, /view\.dispatch\(tr\)/);
  });
  await t.test("klik di luar: pointerdown capture di document, dilepas saat destroy", () => {
    assert.match(editorCode, /const onSlashOutsidePointer = \(e\) => \{\s*if \(!isSlashMenuShown\(\) \|\| !isSlashOutsideTarget\(e\.target, slashMenu, \[handleEl\]\)\) return;/);
    assert.match(editorCode, /document\.addEventListener\('pointerdown', onSlashOutsidePointer, true\);/);
    assert.match(editorCode, /document\.removeEventListener\('pointerdown', onSlashOutsidePointer, true\);/);
    const v = editorCode.match(/ctx\.set\(slashPair\.key, \{[\s\S]*?\n      \}\);/);
    assert.ok(v);
    assert.match(v[0], /destroy: \(\) => \{[^}]*document\.removeEventListener\('pointerdown', onSlashOutsidePointer, true\);[^}]*provider\.destroy\(\);/);
  });
  await t.test("SlashProvider memakai shouldShow yang menghormati dismissed", () => {
    assert.match(editorCode, /new MB\.SlashProvider\(\{ content: slashMenu, root: document\.body, middleware: \[slashClampToViewport\], shouldShow: \(view\) => shouldShowSlashMenu\(provider\.getContent\(view\), slashDismissKey \? slashDismissKey\.getState\(view\.state\) : null\) \}\)/);
  });
  await t.test("onBlockAdd mencatat posisi '/' sisipan dan membuang '/' '+' sebelumnya", () => {
    const start = editorCode.indexOf("const onBlockAdd = () => {");
    const src = editorCode.slice(start, editorCode.indexOf("\n    };", start));
    assert.match(src, /tr\.setMeta\(slashDismissKey, \{ plusPos: tr\.selection\.from - 1, dismissed: false \}\)/);
    assert.match(src, /prev && isPlusSlashIntact\(state\.doc, prev\.plusPos\)\) tr\.delete\(prev\.plusPos, prev\.plusPos \+ 1\)/);
    assert.match(src, /const at = tr\.mapping\.map\(pos\);/);
    assert.ok(src.indexOf("insertText('/')") < src.indexOf("plusPos: tr.selection.from - 1"), "meta setelah '/' diketik");
  });
  await t.test("item menu tetap mousedown preventDefault (tidak dihitung klik luar karena di dalam menu)", () => {
    assert.match(editorCode, /el\.addEventListener\('mousedown', e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\);/);
  });
});

test("cache bust v449", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v449-slash-menu-dismiss";/m);
  assert.match(webappPy, /sw_cache = "taskflow-v449-slash-menu-dismiss"/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v449-slash-menu-dismiss";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v449-slash-menu-dismiss"/);
});
