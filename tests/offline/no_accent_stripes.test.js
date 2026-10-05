// Aturan desain: tidak ada garis/strip warna (border tebal kiri/atas/kanan
// berwarna status/kategori) di kartu, item daftar, chip, atau banner.
// Warna disampaikan lewat chip ikon, badge, atau pill.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const indexHtml = fs.readFileSync(path.join(root, "static", "index.html"), "utf8");
const appCss = fs.readFileSync(path.join(root, "static", "app.css"), "utf8");

test("no coloured accent stripes", async (t) => {
  await t.test("inline styles: no thick coloured left/top/right border", () => {
    const re = /border(Left|Top|Right)\s*:\s*["'`]\s*([2-9]|\d{2,})px\s+solid\s+(?!transparent)[^"'`]+["'`]/g;
    const hits = indexHtml.match(re) || [];
    assert.deepStrictEqual(hits, []);
  });

  await t.test("CSS: no thick coloured left/top/right border outside blockquotes", () => {
    const hits = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = ruleRe.exec(appCss))) {
      const selector = m[1].trim();
      if (/blockquote|note-callout/.test(selector)) continue;
      if (/border-(left|top|right)\s*:\s*([2-9]|\d{2,})px\s+solid\s+(?!transparent)/.test(m[2])) hits.push(selector);
    }
    assert.deepStrictEqual(hits, []);
  });

  await t.test("Dashboard banners use .app-banner with an icon chip", () => {
    const fn = name => indexHtml.slice(indexHtml.indexOf(`function ${name}(`), indexHtml.indexOf(`function ${name}(`) + 3000);
    for (const name of ["ReviewNudge", "BackupReminder"]) {
      const src = fn(name);
      assert.match(src, /className: "app-banner"/, name);
      assert.match(src, /className: "app-banner-icon"/, name);
    }
    assert.match(appCss, /\.app-banner \{[^}]*margin: 16px 0;/);
  });
});
