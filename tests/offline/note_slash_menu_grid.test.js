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

const EXPECTED = [
  ["Teks", [
    ["H1", "Heading 1", "heading", 1],
    ["H2", "Heading 2", "heading", 2],
    ["H3", "Heading 3", "heading", 3],
    ['"', "Blockquote", "blockquote"],
    ["💡", "Callout", "callout"],
    ["▶", "Toggle", "toggle"],
    ["💻", "Code", "code_block"],
  ]],
  ["Daftar", [
    ["•", "Bullet", "bullet_list_simple"],
    ["1.", "Numbered", "ordered_list"],
    ["☑", "Checklist", "task_list"],
  ]],
  ["Sisipkan", [
    ["⊞", "Tabel", "table"],
    ["—", "Divider", "hr"],
    ["🎨", "Gambar", "draw"],
    ["📌", "Task", "task"],
  ]],
  ["Tautan", [
    ["🔗", "Wikilink", "wikilink"],
  ]],
];

test("slash menu: grup dan item sesuai urutan", async (t) => {
  const groups = evalGroups();
  await t.test("4 label grup berurutan", () => {
    assert.deepEqual(groups.map(g => g.label), EXPECTED.map(g => g[0]));
  });
  await t.test("15 item dengan ikon/label/tipe/payload persis", () => {
    const flat = groups.flatMap(g => g.items.map(it => [it.icon, it.label, it.type, it.payload]));
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

test("slash menu: konstruksi DOM aman (tanpa innerHTML)", async (t) => {
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
  await t.test("tanpa innerHTML", () => {
    assert.equal(/innerHTML/.test(src), false);
    assert.match(src, /textContent/);
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
  // "/" pemicu dihapus oleh jalur generik (bukan pengecualian draw/task)
  assert.match(indexHtml, /if \(type !== 'draw' && type !== 'task'\) \{\s*const sel0 = view\.state\.selection;\s*if \(sel0\.empty && isSlashTriggerBefore\(sel0\.\$from\)\)/);
});

test("slash menu: posisi dijepit ke dalam viewport (HP)", () => {
  assert.match(indexHtml, /new MB\.SlashProvider\(\{ content: slashMenu, root: document\.body, middleware: \[slashClampToViewport\] \}\)/);
  const m = indexHtml.match(/const slashClampToViewport = \{[\s\S]*?\n    \};/);
  assert.ok(m, "middleware slashClampToViewport harus ada");
  const mk = (scrollY = 0) => new Function("window", "document", m[0] + "\nreturn slashClampToViewport;")(
    { innerWidth: 375, innerHeight: 740, scrollX: 0, scrollY }, { documentElement: { clientWidth: 375 } });
  const clamp = mk();
  const fl = { rects: { floating: { width: 340, height: 426 } } };
  // horizontal
  assert.deepEqual(clamp.fn({ x: 98, y: 10, ...fl }), { x: 375 - 340 - 8, y: 10 });
  assert.deepEqual(clamp.fn({ x: 2, y: 10, ...fl }), { x: 8, y: 10 });
  assert.deepEqual(clamp.fn({ x: 20, y: 10, ...fl }), { x: 20, y: 10 });
  // vertikal: bawah menu tidak melewati viewport
  assert.deepEqual(clamp.fn({ x: 20, y: 340, ...fl }), { x: 20, y: 740 - 426 - 8 });
  assert.deepEqual(clamp.fn({ x: 20, y: -30, ...fl }), { x: 20, y: 8 });
  // koordinat dokumen: ikut scroll halaman
  assert.deepEqual(mk(100).fn({ x: 20, y: 500, ...fl }), { x: 20, y: 100 + 740 - 426 - 8 });
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
    assert.match(css, /\.milkdown-slash-label \{[^}]*text-overflow: ellipsis/);
  });
  await t.test("dark hover tanpa box-shadow", () => {
    assert.match(css, /\[data-theme="dark"\] \.milkdown-slash-item\[aria-selected="true"\] \{[^}]*box-shadow: none/);
  });
});

test("cache bust v446 + app.css?v=352", () => {
  assert.match(swJs, /^const CACHE = "taskflow-v446-slash-menu-grid";/m);
  assert.match(webappPy, /sw_cache = "taskflow-v446-slash-menu-grid"/);
  assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v446-slash-menu-grid";/);
  assert.match(indexHtml, /app\.css\?v=352/);
  assert.equal(/app\.css\?v=351/.test(indexHtml), false);
});
