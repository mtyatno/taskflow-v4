"use strict";

// Sidebar collapsed (desktop) = icon rail ramping (logo + tombol buka menu + 8 menu utama),
// bukan hilang total. Mobile (≤768px) tetap drawer off-canvas dengan menu lengkap.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8");

function sidebarSource() {
  const start = indexHtml.indexOf("function Sidebar({");
  assert.ok(start >= 0, "Sidebar component must exist");
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, "Sidebar component end must be found");
  return indexHtml.slice(start, end);
}

// Ambil isi blok @media (max-width: 768px) { ... } pertama yang memuat aturan .sidebar.open
function mobileSidebarMediaBlock() {
  const re = /@media \(max-width: 768px\) \{/g;
  let m;
  while ((m = re.exec(appCss))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < appCss.length; i++) {
      if (appCss[i] === "{") depth++;
      else if (appCss[i] === "}") { depth--; if (depth === 0) break; }
    }
    const block = appCss.slice(m.index, i + 1);
    if (block.includes(".sidebar.open")) return block;
  }
  return null;
}

// CSS di luar semua @media
function topLevelCss() {
  let out = "";
  let depth = 0;
  let inMedia = false;
  let mediaDepth = 0;
  for (let i = 0; i < appCss.length; i++) {
    if (!inMedia && appCss.startsWith("@media", i)) { inMedia = true; mediaDepth = depth; }
    const c = appCss[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (inMedia && depth === mediaDepth) { inMedia = false; continue; } }
    if (!inMedia) out += c;
  }
  return out;
}

test("Sidebar merender .sidebar-rail dan membungkus konten penuh di .sidebar-full", () => {
  const src = sidebarSource();
  assert.match(src, /className: "sidebar-rail"/);
  assert.match(src, /className: "sidebar-full"/);
  assert.match(src, /"Tampilkan semua menu"/);
  assert.match(src, /name: "chevron-right"/);
  assert.match(src, /title: "Perkecil menu"/);
  assert.match(src, /name: "chevron-left"/);
  assert.doesNotMatch(src, /"Sembunyikan menu"/);
});

test("rail memakai link sebelum section pertama = 8 menu utama, urut", () => {
  const src = sidebarSource();
  assert.match(src, /links\.slice\(0, firstSectionIdx/);
  assert.match(src, /const firstSectionIdx = links\.findIndex\(l => l\.section\)/);
  const linksStart = src.indexOf("const links = [");
  const gtdAt = src.indexOf('section: "GTD"', linksStart);
  assert.ok(linksStart >= 0 && gtdAt > linksStart);
  const ids = [...src.slice(linksStart, gtdAt).matchAll(/\bid: "([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ["dashboard", "calendar", "today", "habit", "notes", "draw", "mindmap", "chat"]);
  assert.match(src, /l\.count > 9 \? "9\+" : l\.count/);
});

test("App memberi main-content kelas rail saat collapsed", () => {
  assert.match(indexHtml, /className: `main-content \$\{sidebarCollapsed \? "sidebar-rail-visible" : "sidebar-visible"\}`/);
});

test("app.css: --sidebar-rail-w dan .sidebar.collapsed tidak lagi digeser keluar layar di desktop", () => {
  assert.match(appCss, /--sidebar-rail-w:\s*64px/);
  const top = topLevelCss();
  const collapsedRules = [...top.matchAll(/\.sidebar\.collapsed\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(collapsedRules.length > 0, ".sidebar.collapsed rule must exist");
  for (const body of collapsedRules) assert.doesNotMatch(body, /translateX\(-100%\)/);
  assert.ok(collapsedRules.some(b => /width:\s*var\(--sidebar-rail-w\)/.test(b)));
  assert.match(top, /\.sidebar\.collapsed \.sidebar-full\s*\{\s*display:\s*none/);
  assert.match(top, /\.sidebar\.collapsed \.sidebar-rail\s*\{\s*display:\s*flex/);
  assert.match(top, /\.main-content\.sidebar-rail-visible\s*\{\s*margin-left:\s*var\(--sidebar-rail-w\)/);
});

test("mobile ≤768px: rail disembunyikan, menu penuh selalu tampil, tanpa margin", () => {
  const block = mobileSidebarMediaBlock();
  assert.ok(block, "mobile media block with .sidebar.open must exist");
  assert.match(block, /\.sidebar\.collapsed \.sidebar-rail\s*\{\s*display:\s*none/);
  assert.match(block, /\.sidebar\.collapsed \.sidebar-full\s*\{\s*display:\s*flex/);
  assert.match(block, /\.sidebar\.collapsed\s*\{\s*width:\s*var\(--sidebar-w\)/);
  assert.match(block, /\.main-content\.sidebar-rail-visible[^{]*\{\s*margin-left:\s*0/);
});
