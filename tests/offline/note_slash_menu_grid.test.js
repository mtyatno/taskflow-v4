"use strict";

// Slash menu editor note (Milkdown): tata letak grid 2 kolom dengan label grup + item Wikilink.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "static/app.css"), "utf8");
const swJs = fs.readFileSync(path.join(root, "static/sw.js"), "utf8");
const webappPy = fs.readFileSync(path.join(root, "webapp.py"), "utf8");

// Blok data grup slash menu (const SLASH_MENU_GROUPS = [ ... ];)
function groupsSource() {
  const start = indexHtml.indexOf("const SLASH_MENU_GROUPS = [");
  assert.ok(start > 0, "SLASH_MENU_GROUPS harus ada di MilkdownEditor");
  const end = indexHtml.indexOf("];", start);
  return indexHtml.slice(start, end + 2);
}
function evalGroups() {
  const src = groupsSource().replace("const SLASH_MENU_GROUPS = ", "return ");
  return new Function(src)();
}

// [ikon teks (heading) | glyph VIEW_GLYPHS, label, tipe, payload]
const EXPECTED = [
  ["Teks", [
    ["H1", "Heading 1", "heading", 1],
    ["H2", "Heading 2", "heading", 2],
    ["H3", "Heading 3", "heading", 3],
    ["sQuote", "Blockquote", "blockquote"],
    ["sLightbulb", "Callout", "callout"],
    ["sToggle", "Toggle", "toggle"],
    ["sCode", "Code", "code_block"],
  ]],
  ["Daftar", [
    ["sListBullet", "Bullet", "bullet_list_simple"],
    ["sListOrdered", "Numbered", "ordered_list"],
    ["sChecklist", "Checklist", "task_list"],
  ]],
  ["Sisipkan", [
    ["sTable", "Tabel", "table"],
    ["sDivider", "Divider", "hr"],
    ["pPalette", "Gambar", "draw"],
    ["nPin", "Task", "task"],
  ]],
  ["Tautan", [
    ["mLink", "Wikilink", "wikilink"],
  ]],
];
const GLYPH_KEYS = EXPECTED.flatMap(g => g[1].map(r => r[0])).filter(k => !/^H\d$/.test(k));

function viewGlyphs() {
  const start = indexHtml.indexOf("const VIEW_GLYPHS = {");
  const end = indexHtml.indexOf("function ViewGlyph(");
  assert.ok(start > 0 && end > start);
  return new Function(indexHtml.slice(start, end).replace("const VIEW_GLYPHS = ", "return "))();
}

test("slash menu: ikon glyph gaya Alurik", async (t) => {
  const groups = evalGroups();
  const items = groups.flatMap(g => g.items);
  await t.test("12 glyph ada di VIEW_GLYPHS (duotone, viewBox 24)", () => {
    const G = viewGlyphs();
    assert.equal(GLYPH_KEYS.length, 12);
    for (const k of GLYPH_KEYS) {
      assert.ok(typeof G[k] === "string" && G[k].length > 0, "VIEW_GLYPHS." + k);
    }
    for (const k of ["sQuote", "sLightbulb", "sToggle", "sCode", "sListBullet", "sListOrdered", "sChecklist", "sTable", "sDivider"]) {
      assert.match(G[k], /fill="currentColor" fill-opacity="\.22"/, k + " punya isian lembut");
      assert.equal(/<script|on\w+=/i.test(G[k]), false, k + " markup statis aman");
    }
  });
  await t.test("heading tetap ikon teks, item lain memakai glyph (tanpa emoji/simbol)", () => {
    for (const it of items) {
      if (it.type === "heading") {
        assert.match(it.icon, /^H[123]$/);
        assert.equal(it.glyph, undefined);
      } else {
        assert.equal(it.icon, undefined, "item " + it.label + " tanpa ikon teks");
        assert.ok(GLYPH_KEYS.includes(it.glyph), "glyph " + it.label);
      }
    }
    assert.equal(/\p{Extended_Pictographic}/u.test(groupsSource()), false, "tanpa emoji di SLASH_MENU_GROUPS");
    assert.equal(/[•☑⊞—▶]/.test(groupsSource().replace(/title: '[^']*'/g, "")), false, "tanpa simbol ikon lama");
  });
  await t.test("makeSlashItem membuat <svg> dari VIEW_GLYPHS (atribut sama dengan ViewGlyph)", () => {
    const start = indexHtml.indexOf("const makeSlashItem = (");
    const src = indexHtml.slice(start, indexHtml.indexOf("// ── Tooltip DOM", start));
    assert.match(src, /document\.createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
    for (const a of ["'viewBox', '0 0 24 24'", "'fill', 'none'", "'stroke', 'currentColor'", "'stroke-linecap', 'round'",
                     "'stroke-linejoin', 'round'", "'aria-hidden', 'true'", "'focusable', 'false'", "'width', '16'", "'height', '16'"]) {
      assert.ok(src.includes("setAttribute(" + a + ")"), "atribut " + a);
    }
    assert.match(src, /glyph: it\.glyph/);
  });
});

test("slash menu: grup dan item sesuai urutan", async (t) => {
  const groups = evalGroups();
  await t.test("4 label grup berurutan", () => {
    assert.deepEqual(groups.map(g => g.label), EXPECTED.map(g => g[0]));
  });
  await t.test("15 item dengan ikon/label/tipe/payload persis", () => {
    const flat = groups.flatMap(g => g.items.map(it => [it.glyph || it.icon, it.label, it.type, it.payload]));
    const exp = EXPECTED.flatMap(g => g[1].map(([i, l, ty, p]) => [i, l, ty, p]));
    assert.equal(flat.length, 15);
    assert.deepEqual(flat, exp);
  });
  await t.test("setiap item punya title deskriptif", () => {
    for (const g of groups) for (const it of g.items) {
      assert.ok(typeof it.title === "string" && it.title.length > it.label.length - 1, `title untuk ${it.label}`);
    }
    const byType = Object.fromEntries(groups.flatMap(g => g.items).map(it => [it.type, it]));
    assert.equal(byType.draw.title, "Gambar / Sketsa (/draw)");
    assert.equal(byType.task.title, "Tugas / Task (/task, /tasks)");
    assert.equal(byType.callout.title, "Callout / Info (/callout)");
    assert.equal(byType.toggle.title, "Toggle / Lipatan (/toggle)");
    assert.equal(byType.code_block.title, "Code Block (/code)");
    assert.equal(byType.wikilink.title, "Wikilink — tautan ke note lain [[judul]]");
  });
  await t.test("Wikilink lebar penuh dengan hint [[ ]]", () => {
    const wl = groups[3].items[0];
    assert.equal(wl.wide, true);
    assert.equal(wl.hint, "[[ ]]");
    const others = groups.slice(0, 3).flatMap(g => g.items);
    assert.ok(others.every(it => !it.wide && !it.hint), "item lain tidak lebar / tanpa hint");
  });
});

test("slash menu: listbox punya nama aksesibel", () => {
  assert.match(indexHtml, /slashMenu\.setAttribute\('role', 'listbox'\);\s*slashMenu\.setAttribute\('aria-label', 'Sisipkan blok'\);/);
});

test("slash menu: konstruksi DOM aman (label via textContent)", async (t) => {
  const start = indexHtml.indexOf("const makeSlashItem = (");
  const end = indexHtml.indexOf("// ── Tooltip DOM", start);
  const src = indexHtml.slice(start, end);
  await t.test("makeSlashItem menerima opsi { wide, hint, title }", () => {
    assert.match(src, /const makeSlashItem = \(icon, label, type, payload, opts\) =>/);
    assert.match(src, /is-wide/);
    assert.match(src, /milkdown-slash-hint/);
    assert.match(src, /milkdown-slash-label/);
    assert.match(src, /setAttribute\('title'/);
  });
  await t.test("innerHTML hanya untuk markup glyph statis VIEW_GLYPHS", () => {
    const uses = src.match(/[\w.]+\.innerHTML\s*=\s*[^;]+;/g) || [];
    assert.equal(uses.length, 1, uses.join(" | "));
    assert.match(uses[0], /^svg\.innerHTML = VIEW_GLYPHS\[o\.glyph\];$/);
    assert.match(src, /labelEl\.textContent = label;/);
  });
  await t.test("label grup + grid dibuat per grup", () => {
    assert.match(src, /milkdown-slash-group-label/);
    assert.match(src, /milkdown-slash-grid/);
    assert.match(src, /SLASH_MENU_GROUPS\.forEach/);
  });
  await t.test("handler mousedown/click item tetap", () => {
    assert.match(src, /el\.addEventListener\('mousedown', e => \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\);/);
    assert.match(src, /el\.addEventListener\('click', e => \{\s*e\.stopPropagation\(\);\s*e\.preventDefault\(\);\s*doSlashAction\(type, payload\);\s*\}\);/);
  });
  await t.test("tidak ada lagi appendChild item satu per satu", () => {
    assert.equal(/slashMenu\.appendChild\(makeSlashItem\(/.test(indexHtml), false);
  });
});

test("slash menu: aksi wikilink menyisipkan [[ dari state segar", () => {
  const m = indexHtml.match(/case 'wikilink':\s*\{([\s\S]*?)\}\s*break;/);
  assert.ok(m, "case 'wikilink' harus ada di doSlashAction");
  assert.match(m[1], /tr = tr\.insertText\('\[\[', from, to\);/);
  // tidak mewarisi mark inline code (wikilink di dalam `kode` tidak jadi kode)
  assert.match(m[1], /tr\.setStoredMarks\(/);
  assert.match(m[1], /spec\.code/);
  assert.ok(m[1].indexOf("setStoredMarks") < m[1].indexOf("insertText('[['"), "stored marks diatur sebelum insertText");
  // "/" pemicu dihapus oleh jalur generik (bukan pengecualian draw/task)
  assert.match(indexHtml, /if \(type !== 'draw' && type !== 'task'\) \{\s*const sel0 = view\.state\.selection;\s*if \(sel0\.empty && isSlashTriggerBefore\(sel0\.\$from\)\)/);
});

test("slash menu: posisi dijepit ke dalam viewport (HP)", async (t) => {
  assert.match(indexHtml, /new MB\.SlashProvider\(\{ content: slashMenu, root: document\.body, middleware: \[slashClampToViewport\] \}\)/);
  const m = indexHtml.match(/const slashClampToViewport = \{[\s\S]*?\n    \};/);
  assert.ok(m, "middleware slashClampToViewport harus ada");
  const mk = (win) => new Function("window", "document", m[0] + "\nreturn slashClampToViewport;")(
    Object.assign({ innerWidth: 375, innerHeight: 740, scrollX: 0, scrollY: 0 }, win),
    { documentElement: { clientWidth: 375 } });
  const el = (maxHeight = "") => ({ style: { maxHeight } });
  const st = (x, y, h, floating = el()) => ({ x, y, rects: { floating: { width: 340, height: h } }, elements: { floating } });

  await t.test("tanpa visualViewport: horizontal + vertikal", () => {
    const c = mk();
    assert.deepEqual(c.fn(st(98, 10, 426)), { x: 375 - 340 - 8, y: 10 });
    assert.deepEqual(c.fn(st(2, 10, 426)), { x: 8, y: 10 });
    assert.deepEqual(c.fn(st(20, 10, 426)), { x: 20, y: 10 });
    assert.deepEqual(c.fn(st(20, 340, 426)), { x: 20, y: 740 - 426 - 8 });
    assert.deepEqual(c.fn(st(20, -30, 426)), { x: 20, y: 8 });
    // koordinat dokumen: ikut scroll halaman
    assert.deepEqual(mk({ scrollY: 100 }).fn(st(20, 500, 426)), { x: 20, y: 100 + 740 - 426 - 8 });
    // tanpa elements (aman)
    assert.deepEqual(c.fn({ x: 20, y: 10, rects: { floating: { width: 340, height: 426 } } }), { x: 20, y: 10 });
  });

  await t.test("keyboard HP terbuka (visualViewport 330px): max-height dibatasi, lalu posisi pas", () => {
    const vv = { width: 375, height: 330, pageLeft: 0, pageTop: 0, offsetTop: 0, offsetLeft: 0 };
    const c = mk({ visualViewport: vv });
    const f = el();
    // panggilan pertama: tinggi dibatasi → minta floating-ui mengukur ulang
    assert.deepEqual(c.fn(st(20, 340, 426, f)), { reset: { rects: true } });
    assert.equal(f.style.maxHeight, (330 - 16) + "px");
    // setelah diukur ulang (tinggi = 314): menu utuh di area terlihat
    assert.deepEqual(c.fn(st(20, 340, 314, f)), { x: 20, y: 330 - 314 - 8 });
    assert.equal(f.style.maxHeight, "314px", "tidak berubah lagi → tidak reset berulang");
  });

  await t.test("visualViewport ter-scroll/zoom: kedua sumbu memakai pageLeft/pageTop/width", () => {
    const vv = { width: 300, height: 600, pageLeft: 50, pageTop: 200, offsetTop: 0, offsetLeft: 0 };
    const c = mk({ visualViewport: vv, scrollX: 0, scrollY: 0 });
    // x: [50 + 8, 50 + 300 - 280 - 8]; y: [200 + 8, 200 + 600 - 400 - 8]
    const s2 = (x, y) => ({ x, y, rects: { floating: { width: 280, height: 400 } }, elements: { floating: el() } });
    assert.deepEqual(c.fn(s2(0, 0)), { x: 58, y: 208 });
    assert.deepEqual(c.fn(s2(500, 900)), { x: 62, y: 392 });
  });

  await t.test("ruang cukup lagi: max-height inline dikosongkan (kembali ke CSS)", () => {
    const vv = { width: 375, height: 740, pageLeft: 0, pageTop: 0, offsetTop: 0, offsetLeft: 0 };
    const c = mk({ visualViewport: vv });
    const f = el("314px");
    assert.deepEqual(c.fn(st(20, 10, 314, f)), { reset: { rects: true } });
    assert.equal(f.style.maxHeight, "");
    assert.deepEqual(c.fn(st(20, 10, 426, f)), { x: 20, y: 10 });
  });
});

test("CSS slash menu grid", async (t) => {
  const menu = /\.milkdown-slash-menu \{([^}]*)\}/.exec(css);
  await t.test("menu: lebar & max-height baru", () => {
    assert.ok(menu);
    assert.match(menu[1], /max-height: min\(440px, 70vh\)/);
    assert.match(menu[1], /width: min\(340px, calc\(100vw - 24px\)\)/);
    assert.equal(/max-height: 320px/.test(css), false);
  });
  await t.test("grid 2 kolom + item lebar", () => {
    assert.match(css, /\.milkdown-slash-grid \{ display: grid; grid-template-columns: 1fr 1fr; gap: 2px; \}/);
    assert.match(css, /\.milkdown-slash-item\.is-wide \{ grid-column: 1 \/ -1; \}/);
    assert.match(css, /\.milkdown-slash-group-label \{[^}]*text-transform: uppercase/);
    assert.match(css, /\.milkdown-slash-hint \{[^}]*margin-left: auto/);
    const icon = /\.milkdown-slash-icon \{([^}]*)\}/.exec(css);
    assert.match(icon[1], /display: inline-flex/);
    assert.match(icon[1], /align-items: center/);
    assert.match(icon[1], /justify-content: center/);
    assert.match(icon[1], /color: var\(--text-light\)/);
    assert.match(css, /\.milkdown-slash-item:hover \.milkdown-slash-icon,\s*\.milkdown-slash-item\[aria-selected="true"\] \.milkdown-slash-icon \{ color: var\(--text-primary\); \}/);
    assert.match(css, /\.milkdown-slash-label \{[^}]*text-overflow: ellipsis/);
  });
  await t.test("dark hover tanpa box-shadow", () => {
    assert.match(css, /\[data-theme="dark"\] \.milkdown-slash-item\[aria-selected="true"\] \{[^}]*box-shadow: none/);
  });
});

test("cache bust v448 + app.css?v=354", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v448-android-notif-fix";/m);
  assert.match(webappPy, /sw_cache = "taskflow-v448-android-notif-fix"/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v448-android-notif-fix";/);
  assert.match(indexHtml, /app\.css\?v=354/);
  assert.equal(/app\.css\?v=352/.test(indexHtml), false);
});
