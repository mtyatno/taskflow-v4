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
  return new Function(src + "\nreturn { isPlusSlashIntact, plusSlashRemovalRange, docRestoreRange, nextSlashDismissState, shouldShowSlashMenu, isSlashOutsideTarget };")();
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
      return { parent: { isTextblock: true, textContent: b.text }, parentOffset: pos - b.start - 1, depth: 1,
               before: () => b.start, after: () => b.start + b.text.length + 2,
               node: (d) => (d === 0 ? { childCount: blocks.length } : null) };
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

test("plusSlashRemovalRange: paragraf '+' dihapus utuh, kecuali satu-satunya blok", () => {
  const { plusSlashRemovalRange } = helpers();
  // ["Satu", "/", "Dua"]: "/" paragraf mulai di 6, karakter "/" di 7, paragraf berakhir di 9
  assert.deepEqual(plusSlashRemovalRange(fakeDoc(["Satu", "/", "Dua"]), 7), { from: 6, to: 9, whole: true });
  // di akhir dokumen
  assert.deepEqual(plusSlashRemovalRange(fakeDoc(["Satu", "/"]), 7), { from: 6, to: 9, whole: true });
  // satu-satunya blok → hanya "/" (dokumen tidak boleh kosong tanpa blok)
  assert.deepEqual(plusSlashRemovalRange(fakeDoc(["/"]), 1), { from: 1, to: 2, whole: false });
  // tidak utuh → null (teks pengguna tidak disentuh)
  assert.equal(plusSlashRemovalRange(fakeDoc(["Satu", "/x"]), 7), null);
  assert.equal(plusSlashRemovalRange(fakeDoc(["Satu", "/"]), null), null);
});

test("nextSlashDismissState: posisi '/' dipetakan, dismissed dibersihkan saat mengetik/bergerak", async (t) => {
  const { nextSlashDismissState } = helpers();
  const tr = (opts = {}) => ({
    docChanged: !!opts.docChanged,
    selectionSet: !!opts.selectionSet,
    getMeta: (k) => (k === "appendedTransaction" ? opts.appended : undefined),
    mapping: { mapResult: (pos, assoc) => {
      assert.equal(assoc, 1, "assoc 1: karakter '/' setelah posisi");
      return opts.map ? opts.map(pos) : { pos, deleted: false };
    } }
  });
  await t.test("awal kosong", () => {
    assert.deepEqual(nextSlashDismissState(undefined, tr(), undefined), { plusPos: null, dismissed: false, orig: null });
  });
  await t.test("meta plusPos dari tombol +", () => {
    const s = nextSlashDismissState({ plusPos: null, dismissed: true }, tr({ docChanged: true, selectionSet: true }), { plusPos: 6, dismissed: false });
    assert.deepEqual(s, { plusPos: 6, dismissed: false, orig: null });
  });
  await t.test("perubahan dokumen menggeser posisi", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ docChanged: true, map: p => ({ pos: p + 3, deleted: false }) }));
    assert.deepEqual(s, { plusPos: 9, dismissed: false, orig: null });
  });
  await t.test("'/' terhapus → lupakan posisi", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ docChanged: true, map: p => ({ pos: p, deleted: true }) }));
    assert.equal(s.plusPos, null);
  });
  await t.test("tanpa perubahan dokumen → posisi tetap (mapping tidak dipanggil)", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ map: () => { throw new Error("tak boleh"); } }));
    assert.deepEqual(s, { plusPos: 6, dismissed: false, orig: null });
  });
  await t.test("dismissed bertahan pada transaksi meta saja, hilang saat mengetik / kursor pindah", () => {
    assert.equal(nextSlashDismissState({ plusPos: null, dismissed: true }, tr()).dismissed, true);
    assert.equal(nextSlashDismissState({ plusPos: null, dismissed: true }, tr({ docChanged: true })).dismissed, false);
    assert.equal(nextSlashDismissState({ plusPos: null, dismissed: true }, tr({ selectionSet: true })).dismissed, false);
  });
  await t.test("meta dismiss (Esc / klik luar) menang atas pembersihan", () => {
    const s = nextSlashDismissState({ plusPos: 6, dismissed: false }, tr({ docChanged: true, map: p => ({ pos: p, deleted: true }) }), { plusPos: null, dismissed: true });
    assert.deepEqual(s, { plusPos: null, dismissed: true, orig: null });
  });
});

test("nextSlashDismissState: dokumen asal (sebelum '+') untuk pemulihan persis", async (t) => {
  const { nextSlashDismissState } = helpers();
  const D0 = { name: "doc-asal" };
  const tr = (opts = {}) => ({
    docChanged: !!opts.docChanged, selectionSet: !!opts.selectionSet,
    getMeta: (k) => (k === "appendedTransaction" ? opts.appended : undefined),
    mapping: { mapResult: (pos) => (opts.map ? opts.map(pos) : { pos, deleted: false }) }
  });
  await t.test("meta '+' menyimpan orig", () => {
    const s = nextSlashDismissState(undefined, tr({ docChanged: true }), { plusPos: 7, dismissed: false, orig: D0 });
    assert.deepEqual(s, { plusPos: 7, dismissed: false, orig: D0 });
  });
  await t.test("transaksi appendTransaction (paragraf trailing, dsb.) mempertahankan orig", () => {
    const s = nextSlashDismissState({ plusPos: 7, dismissed: false, orig: D0 }, tr({ docChanged: true, appended: {} }));
    assert.equal(s.orig, D0);
    assert.equal(s.plusPos, 7);
  });
  await t.test("tanpa perubahan dokumen mempertahankan orig", () => {
    assert.equal(nextSlashDismissState({ plusPos: 7, dismissed: false, orig: D0 }, tr({ selectionSet: true })).orig, D0);
  });
  await t.test("suntingan pengguna lain → orig dibuang (jatuh ke hapus paragraf)", () => {
    const s = nextSlashDismissState({ plusPos: 7, dismissed: false, orig: D0 }, tr({ docChanged: true }));
    assert.equal(s.orig, null);
    assert.equal(s.plusPos, 7);
  });
  await t.test("'/' terhapus → orig ikut dibuang", () => {
    const s = nextSlashDismissState({ plusPos: 7, dismissed: false, orig: D0 }, tr({ docChanged: true, appended: {}, map: p => ({ pos: p, deleted: true }) }));
    assert.deepEqual(s, { plusPos: null, dismissed: false, orig: null });
  });
});

test("docRestoreRange: rentang minimal untuk kembali ke dokumen asal", () => {
  const { docRestoreRange } = helpers();
  const mk = (start, end) => ({ content: { findDiffStart: () => start, findDiffEnd: () => end } });
  const cur = { content: {} };
  assert.equal(docRestoreRange(mk(null, null), cur), null, "dokumen sama → null");
  assert.equal(docRestoreRange(null, cur), null);
  // tanpa tumpang tindih
  assert.deepEqual(docRestoreRange(mk(6, { a: 6, b: 9 }), cur), { start: 6, endA: 6, endB: 9 });
  // tumpang tindih (teks sama di kedua sisi) → digeser
  assert.deepEqual(docRestoreRange(mk(7, { a: 5, b: 8 }), cur), { start: 7, endA: 7, endB: 10 });
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
  const item = {}, scrollArea = {}, editorText = {}, header = {}, dragBtn = {};
  const addBtn = { contains: n => n === addBtn };
  const menu = { contains: n => n === menu || n === item || n === scrollArea };
  const handle = { contains: n => n === handle || n === addBtn };
  assert.equal(isSlashOutsideTarget(item, menu, [handle]), false, "item menu");
  assert.equal(isSlashOutsideTarget(scrollArea, menu, [handle]), false, "area scroll menu");
  assert.equal(isSlashOutsideTarget(menu, menu, [handle]), false);
  assert.equal(isSlashOutsideTarget(addBtn, menu, [addBtn]), false, "tombol + (onBlockAdd membereskan '/' lama)");
  assert.equal(isSlashOutsideTarget(editorText, menu, [handle]), true);
  assert.equal(isSlashOutsideTarget(dragBtn, menu, [addBtn]), true, "⋮⋮ (bukan tombol +) = di luar");
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
    // Esc dilewati bila sudah dikonsumsi autocomplete (defaultPrevented); menu tampil ATAU masih menunggu debounce
    assert.match(m[0], /handleKeyDown: \(view, e\) => \{\s*(?:\/\/[^\n]*\s*)?if \(e\.key !== 'Escape' \|\| e\.defaultPrevented\) return false;\s*if \(!isSlashMenuShown\(\) && !isSlashMenuPending\(view\)\) return false;\s*e\.stopPropagation\(\);\s*dismissSlashMenu\(view, true\);\s*return true;/);
    assert.match(editorCode, /const isSlashMenuPending = \(view\) => !!slashProvider && !!slashDismissKey && shouldShowSlashMenu\(slashProvider\.getContent\(view\), slashDismissKey\.getState\(view\.state\)\);/);
    assert.match(editorCode, /\.use\(slashDismissPlugin \|\| \[\]\)\.use\(slashPair\)/);
  });
  await t.test("dismissSlashMenu: sembunyikan, hapus '/' sisipan '+' bila utuh, tandai dismissed", () => {
    const start = editorCode.indexOf("const dismissSlashMenu = (view, keepFocus) => {");
    assert.ok(start > 0);
    const src = editorCode.slice(start, editorCode.indexOf("\n    };", start));
    assert.match(src, /slashProvider\.hide\(\)/);
    assert.match(src, /removePlusSlash\(tr, view\.state\.doc, st, true\)/);
    assert.match(src, /if \(keepFocus\) view\.focus\(\);/);
    const rm = editorCode.slice(editorCode.indexOf("const removePlusSlash = ("), editorCode.indexOf("const dismissSlashMenu"));
    // utama: pulihkan persis dokumen sebelum "+" (list yang terpecah, paragraf trailing tambahan)
    assert.match(rm, /const d = docRestoreRange\(st\.orig, doc\);/);
    assert.match(rm, /tr\.replace\(d\.start, d\.endB, st\.orig\.slice\(d\.start, d\.endA\)\)/);
    assert.match(rm, /if \(!tr\.doc\.eq\(st\.orig\)\) tr\.replaceWith\(0, tr\.doc\.content\.size, st\.orig\.content\)/);
    // cadangan (dokumen sudah disunting lain): hapus paragraf "/"
    assert.match(rm, /plusSlashRemovalRange\(doc, pos\)/);
    assert.match(rm, /tr\.delete\(r\.from, r\.to\)/);
    // kursor ke akhir blok di atas (blok tempat "+" diklik)
    assert.match(rm, /MB\.TextSelection\.near\(tr\.doc\.resolve\(tr\.mapping\.map\(pos - 1, -1\)\), -1\)/);
    assert.match(src, /tr\.setMeta\(slashDismissKey, \{ plusPos: null, dismissed: true \}\)/);
    assert.match(src, /view\.dispatch\(tr\)/);
  });
  await t.test("klik di luar: pointerdown capture di document, dilepas saat destroy", () => {
    assert.match(editorCode, /const onSlashOutsidePointer = \(e\) => \{\s*if \(!isSlashMenuShown\(\) \|\| !isSlashOutsideTarget\(e\.target, slashMenu, \[addBtn\]\)\) return;/);
    assert.match(editorCode, /try \{ dismissSlashMenu\(slashView, false\); \}/);
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
    assert.match(src, /tr\.setMeta\(slashDismissKey, \{ plusPos: tr\.selection\.from - 1, dismissed: false, orig: base \}\)/);
    assert.match(src, /removePlusSlash\(tr, state\.doc, prev, false\)/);
    assert.match(src, /const base = tr\.doc;/);
    assert.match(src, /plusPos: tr\.selection\.from - 1, dismissed: false, orig: base \}/);
    assert.match(src, /const at = tr\.mapping\.map\(pos\);/);
    assert.ok(src.indexOf("insertText('/')") < src.indexOf("plusPos: tr.selection.from - 1"), "meta setelah '/' diketik");
  });
  await t.test("item menu tetap mousedown preventDefault (tidak dihitung klik luar karena di dalam menu)", () => {
    assert.match(editorCode, /el\.addEventListener\('mousedown', e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\);/);
  });
});

test("cache bust v452", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v467-istilah-sketsa-media";/m);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v467-istilah-sketsa-media";/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v467-istilah-sketsa-media"/);
});

test("autocomplete NoteModal: Esc yang dikonsumsi memanggil preventDefault (slash menu tidak ikut tertutup)", () => {
  const start = indexHtml.indexOf("// Keyboard nav for dropdowns in Milkdown ProseMirror editor");
  assert.ok(start > 0);
  const src = indexHtml.slice(start, indexHtml.indexOf("pmDom.addEventListener('keydown', onKeyDown, true);", start));
  const escs = src.match(/if \(e\.key === 'Escape'\) \{[^}]*\}/g) || [];
  assert.equal(escs.length, 4, escs.join(" | "));
  for (const b of escs) assert.match(b, /e\.preventDefault\(\);/, b);
});
