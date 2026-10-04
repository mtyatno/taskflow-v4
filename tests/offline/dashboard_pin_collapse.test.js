"use strict";

// Dashboard — kartu "Disematkan" setinggi kartu "Prioritas Hari Ini" & sub-bagiannya bisa dilipat:
//   - Notes/Mindmap/Gambar = tombol buka/tutup (aria-expanded + aria-controls → .dash-pin-body
//     ber-`hidden`), default hanya Notes terbuka, tanpa persistensi (state React biasa).
//   - Desktop: tinggi baris ditentukan Prioritas (`align-items: stretch`); Disematkan absolut di
//     dalam .dash-pin-wrap sehingga selalu setinggi baris dan menggulir di dalam bila lebih tinggi.
//   - ≤900px: kartu kembali `position: static` (bertumpuk normal, tanpa gulir internal).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function dashboardSource() {
  const start = indexHtml.indexOf("function Dashboard({");
  assert.ok(start >= 0, "Dashboard component must exist");
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, "Dashboard component end must be found");
  return indexHtml.slice(start, end);
}

// Ambil isi blok @media (max-width: 900px) { ... } yang memuat aturan .dash-main
function dashMedia900Block() {
  const re = /@media \(max-width: 900px\) \{/g;
  let m;
  while ((m = re.exec(appCss))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < appCss.length; i++) {
      if (appCss[i] === "{") depth++;
      else if (appCss[i] === "}") { depth--; if (depth === 0) break; }
    }
    const block = appCss.slice(m.index, i + 1);
    if (block.includes(".dash-main")) return block;
  }
  return null;
}

test("Dashboard: state pinOpen default hanya Notes terbuka", () => {
  const src = dashboardSource();
  assert.match(src, /const \[pinOpen, setPinOpen\] = useState\(/);
  assert.match(src, /notes:\s*true,\s*mindmap:\s*false,\s*drawings:\s*false/);
});

test("Dashboard: header grup = tombol toggle ber-ARIA, isi grup di .dash-pin-body ber-hidden", () => {
  const src = dashboardSource();
  assert.match(src, /className: "dash-pin-toggle"/);
  assert.match(src, /"aria-expanded": open/);
  assert.match(src, /"aria-controls": bodyId/);
  assert.match(src, /className: "dash-pin-body"/);
  assert.match(src, /hidden: !open/);
  assert.match(src, /"dash-pin-body-" \+ key/);
  assert.match(src, /name: "chevronDown"/);
  for (const key of ["notes", "mindmap", "drawings"]) {
    assert.match(src, new RegExp(`renderPinnedGroup\\(\\{\\s*key: "${key}"`), `renderPinnedGroup key ${key}`);
  }
});

test("Dashboard: kartu Prioritas & Disematkan punya kelas hook, daftar Disematkan punya ref gulir", () => {
  const src = dashboardSource();
  assert.match(src, /className: "dash-card dash-prio-card"/);
  assert.match(src, /className: "dash-pin-wrap"/);
  assert.match(src, /className: "dash-card dash-pin-card"/);
  assert.match(src, /className: "dash-pin-groups",\s*ref: pinScrollRef/);
  // Reveal hanya menggulir kontainer daftar (bukan window), menghormati reduced motion.
  assert.match(src, /box\.scrollBy\(/);
  assert.doesNotMatch(src, /window\.scroll(By|To)\(/);
  assert.match(src, /prefers-reduced-motion: reduce/);
});

test("app.css: baris utama stretch, Disematkan absolut di dalam .dash-pin-wrap & menggulir", () => {
  assert.match(appCss, /\.dash-main\s*\{[^}]*align-items:\s*stretch/);
  assert.doesNotMatch(appCss, /\.dash-main\s*\{[^}]*align-items:\s*start/);
  assert.match(appCss, /\.dash-pin-wrap > \.dash-pin-card\s*\{[^}]*position:\s*absolute/);
  assert.match(appCss, /\.dash-pin-card > \.dash-pin-groups\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(appCss, /\.dash-pin-body\[hidden\]\s*\{\s*display:\s*none/);
  // Default (Notes "+N lainnya") butuh ~348px: 340px memunculkan scrollbar bila kartu Prioritas pendek.
  assert.match(appCss, /\.dash-pin-wrap\s*\{[^}]*min-height:\s*352px/);
  // Tanpa overscroll-behavior (halaman tetap bisa digulir di ujung daftar) & tanpa scrollbar-width
  // (di Chromium ≥121 mematikan gaya ::-webkit-scrollbar global → scrollbar putih di dark mode).
  const groupsRules = [...appCss.matchAll(/\.dash-pin-card > \.dash-pin-groups\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(groupsRules.length > 0, ".dash-pin-card > .dash-pin-groups rule must exist");
  for (const body of groupsRules) {
    assert.doesNotMatch(body, /overscroll-behavior/);
    assert.doesNotMatch(body, /scrollbar-width/);
  }
  // Kolom sempit (901–1030px): link "Lihat semua" turun ke baris sendiri, tidak menimpa tombol.
  assert.match(appCss, /\.dash-pin-head\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("app.css ≤900px: kartu Disematkan kembali static tanpa gulir internal", () => {
  const block = dashMedia900Block();
  assert.ok(block, "@media (max-width: 900px) block with .dash-main must exist");
  assert.match(block, /\.dash-pin-wrap > \.dash-pin-card\s*\{[^}]*position:\s*static/);
  assert.match(block, /\.dash-pin-wrap\s*\{[^}]*min-height:\s*0/);
  assert.match(block, /\.dash-pin-card > \.dash-pin-groups\s*\{[^}]*overflow:\s*visible/);
});
