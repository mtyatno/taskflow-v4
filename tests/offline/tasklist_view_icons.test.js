"use strict";

// Toggle tampilan halaman Tasks (Normal / Compact / Kanban): glyph duotone inline + segmented control.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8");
const swJs = fs.readFileSync(path.resolve(__dirname, "../../static/sw.js"), "utf8");
const webappPy = fs.readFileSync(path.resolve(__dirname, "../../webapp.py"), "utf8");

// Potong dari penanda awal sampai penanda akhir (eksklusif) supaya assert hanya melihat area toolbar.
function between(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s !== -1, "penanda awal tidak ditemukan: " + startMarker);
  const e = src.indexOf(endMarker, s);
  assert.ok(e !== -1, "penanda akhir tidak ditemukan: " + endMarker);
  return src.slice(s, e);
}

test("VIEW_GLYPHS + ViewGlyph (inline, meniru FocusGlyph)", async (t) => {
  const mapSrc = between(indexHtml, "const VIEW_GLYPHS = {", "};");
  const fnSrc = between(indexHtml, "function ViewGlyph(", "\n}\n");

  await t.test("VIEW_GLYPHS punya kunci: normal, compact, kanban, wsTasks, wsFiles + glyph berkas workspace (f*)", () => {
    const keys = [...mapSrc.matchAll(/^\s{2}(\w+):\s*'/gm)].map(m => m[1]);
    assert.deepEqual(keys, ["normal", "compact", "kanban", "wsTasks", "wsFiles",
      "fFolder", "fPdf", "fSheet", "fImage", "fFile", "fSearch", "fUpload", "fDownload", "fEye", "fChat", "fPin", "fTrash", "fX",
      "mSettings", "mLink", "mXCircle", "mUsers", "mUser", "mMail", "pomoTomato", "pomoBreak",
      "nNote", "nTag", "nTagOff", "nStar", "nChevronDown", "nChevronUp", "nBacklink", "nPin", "nBrain", "headphones",
      "pPalette", "pChat", "pCalendar", "pRepeat", "pDot", "pTarget", "pFlame", "pHourglass", "pSprout", "pZap", "pCheckCircle", "pPencil",
      "sQuote", "sLightbulb", "sToggle", "sCode", "sListBullet", "sListOrdered", "sChecklist", "sTable", "sDivider", "sparkles", "send",
      "live"]);
  });

  await t.test("VIEW_GLYPHS bisa dievaluasi dan setiap glyph berisi markup SVG", () => {
    const glyphs = new Function(mapSrc + "}; return VIEW_GLYPHS;")();
    for (const k of ["normal", "compact", "kanban", "wsTasks", "wsFiles", "live"]) {
      assert.match(glyphs[k], /^<(rect|path)\b/, k + " harus markup SVG");
      assert.match(glyphs[k], /fill-opacity="\.22"/, k + " harus duotone (isian lembut)");
    }
  });

  await t.test("ViewGlyph: svg 24x24, stroke currentColor, strokeWidth 1.9, aria-hidden", () => {
    assert.match(fnSrc, /viewBox:\s*"0 0 24 24"/);
    assert.match(fnSrc, /fill:\s*"none"/);
    assert.match(fnSrc, /stroke:\s*"currentColor"/);
    assert.match(fnSrc, /strokeWidth:\s*1\.9\b/);
    assert.match(fnSrc, /strokeLinecap:\s*"round"/);
    assert.match(fnSrc, /strokeLinejoin:\s*"round"/);
    assert.match(fnSrc, /"aria-hidden":\s*"true"/);
    assert.match(fnSrc, /focusable:\s*"false"/);
    assert.match(fnSrc, /size\s*=\s*16/);
    assert.match(fnSrc, /dangerouslySetInnerHTML:\s*\{\s*__html:\s*VIEW_GLYPHS\[name\]\s*\|\|\s*""\s*\}/);
  });

  await t.test("ViewGlyph ditaruh setelah FocusGlyph dan glyph tidak ditambahkan ke ui-components.js", () => {
    assert.ok(indexHtml.indexOf("function ViewGlyph(") > indexHtml.indexOf("function FocusGlyph("));
    const ui = fs.readFileSync(path.resolve(__dirname, "../../static/ui-components.js"), "utf8");
    assert.ok(!/VIEW_GLYPHS/.test(ui), "ui-components.js bisa tersaji dari cache lama; glyph harus inline");
  });
});

test("Toggle tampilan di toolbar task list", async (t) => {
  // Dari grup Group by (opsi "Context") sampai blok filter berikutnya.
  const toolbar = between(indexHtml, 'value: "context"\n  }, "Context"))),', "showFilters !== false &&");

  await t.test("glyph Unicode lama (▦ ▤ ⊞) sudah hilang dari toolbar", () => {
    assert.ok(!toolbar.includes('["normal", "▦", "Normal"]'), "array glyph lama masih ada");
    assert.ok(!toolbar.includes("▦") && !toolbar.includes("▤"));
    assert.ok(!/\\u229E|⊞/.test(toolbar), "anak Kanban ⊞ masih ada");
  });

  await t.test("container: role=group, aria-label, kelas tl-view-seg, marginLeft auto", () => {
    assert.match(toolbar, /className:\s*"tl-view-seg"/);
    assert.match(toolbar, /role:\s*"group"/);
    assert.match(toolbar, /"aria-label":\s*"Tampilan task"/);
    assert.match(toolbar, /marginLeft:\s*"auto"/);
  });

  await t.test("tiga tombol: kelas tl-view-btn, ViewGlyph 16, aria-label, aria-pressed", () => {
    assert.match(toolbar, /\[\s*\[\s*"normal",\s*"Normal"\s*\],\s*\[\s*"compact",\s*"Compact"\s*\]\s*\]\.map\(/);
    assert.match(toolbar, /className:\s*"tl-view-btn"/);
    assert.match(toolbar, /"aria-pressed":\s*viewMode\s*===\s*mode/);
    assert.match(toolbar, /"aria-pressed":\s*viewMode\s*===\s*"kanban"/);
    assert.match(toolbar, /"aria-label":\s*label/);
    assert.match(toolbar, /"aria-label":\s*"Kanban"/);
    // Live Edit (tombol setelah segmen, dipisah span.tl-live-sep) tidak ikut dihitung.
    const seg = between(toolbar, 'className: "tl-view-seg"', 'className: "tl-live-sep"');
    assert.equal((seg.match(/type:\s*"button"/g) || []).length, 2, "dua createElement button (mapped + Kanban) bertipe button");
    assert.match(toolbar, /React\.createElement\(ViewGlyph,\s*\{\s*name:\s*mode,\s*size:\s*16\s*\}\)/);
    assert.match(toolbar, /React\.createElement\(ViewGlyph,\s*\{\s*name:\s*"kanban",\s*size:\s*16\s*\}\)/);
  });

  await t.test("Kanban nonaktif: aria-disabled, tetap bisa difokus (tanpa atribut disabled), title lama", () => {
    assert.match(toolbar, /"aria-disabled":\s*kanbanDisabled\s*\?\s*"true"\s*:\s*undefined/);
    assert.ok(!/\bdisabled:\s*kanbanDisabled/.test(toolbar), "jangan pakai atribut disabled (tooltip hilang)");
    assert.match(toolbar, /"Pilih Group by terlebih dahulu"/);
    assert.match(toolbar, /"Kanban view"/);
    assert.match(toolbar, /onClick:\s*\(\)\s*=>\s*!kanbanDisabled\s*&&\s*handleViewMode\("kanban"\)/);
    assert.match(toolbar, /onClick:\s*\(\)\s*=>\s*handleViewMode\(mode\)/);
  });

  await t.test("gaya visual inline per tombol dihapus (pindah ke CSS)", () => {
    const toggle = toolbar.slice(toolbar.indexOf('className: "tl-view-seg"'));
    assert.ok(toggle.length > 0 && toggle.includes("tl-view-btn"));
    assert.ok(!/border:\s*"1px solid var\(--border\)"/.test(toggle));
    assert.ok(!/fontWeight/.test(toggle));
    assert.ok(!/var\(--accent\)/.test(toggle));
    assert.ok(!/padding:/.test(toggle));
  });
});

test("Tab workspace Tasks / Files memakai glyph duotone", async (t) => {
  const tabs = between(indexHtml, 'className: "workspace-nav-tabs"', "WorkspacePinButton");

  await t.test("emoji lama hilang dari tab", () => {
    assert.ok(!tabs.includes("📋 Tasks") && !tabs.includes("📁 Files"));
    assert.ok(!/📋|📁/.test(tabs));
  });

  await t.test("tombol tab merender ViewGlyph wsTasks / wsFiles ukuran 15 + teks", () => {
    assert.match(tabs, /React\.createElement\(ViewGlyph,\s*\{\s*name:\s*"wsTasks",\s*size:\s*15\s*\}\),\s*"Tasks"/);
    assert.match(tabs, /React\.createElement\(ViewGlyph,\s*\{\s*name:\s*"wsFiles",\s*size:\s*15\s*\}\),\s*"Files"/);
  });

  await t.test("baris tab punya marginTop 16 (jeda dari border bawah header sticky)", () => {
    const style = tabs.slice(0, tabs.indexOf("WorkspacePinButton") > 0 ? tabs.length : 400);
    assert.match(style.slice(0, style.indexOf("createElement")), /marginTop:\s*16\b/);
  });

  await t.test("aria-pressed mengikuti tab aktif", () => {
    assert.match(tabs, /"aria-pressed":\s*workspaceTab\s*===\s*"tasks"/);
    assert.match(tabs, /"aria-pressed":\s*workspaceTab\s*===\s*"files"/);
  });
});

test("CSS segmented toggle", async (t) => {
  await t.test("app.css memuat .tl-view-seg dan .tl-view-btn (aktif, nonaktif, hover, fokus)", () => {
    assert.match(appCss, /\.tl-view-seg\s*\{/);
    assert.match(appCss, /\.tl-view-btn\s*\{/);
    assert.match(appCss, /\.tl-view-btn\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--accent\)/);
    assert.match(appCss, /\.tl-view-btn\[aria-disabled="true"\]\s*\{[^}]*opacity:\s*0\.45/);
    assert.match(appCss, /\.tl-view-btn:hover:not\(\[aria-pressed="true"\]\):not\(\[aria-disabled="true"\]\)/);
    assert.match(appCss, /\.tl-view-btn:focus-visible/);
    assert.match(appCss, /\[data-theme="dark"\] \.tl-view-btn:focus-visible/);
  });

  await t.test("tidak memakai border-left sebagai aksen", () => {
    const block = appCss.slice(appCss.indexOf(".tl-view-seg"));
    assert.ok(!/border-left/.test(block));
  });
});

test("cache bust v432 + app.css?v=373", async (t) => {
  await t.test("sw.js CACHE, dua fallback index.html", () => {
    assert.match(swJs, /^const CACHE = "taskflow-v476-catatan-input-atas";/m);
    assert.match(indexHtml, /window\.__SW_VERSION\s*=\s*"taskflow-v476-catatan-input-atas";/);
    assert.match(indexHtml, /window\.__SW_VERSION\s*\|\|\s*"taskflow-v476-catatan-input-atas"/);
  });

  await t.test("index.html memuat app.css?v=373", () => {
    assert.match(indexHtml, /<link rel="stylesheet" href="\/static\/app\.css\?v=373">/);
  });
});
