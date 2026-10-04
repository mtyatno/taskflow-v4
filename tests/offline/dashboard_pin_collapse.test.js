"use strict";

// Dashboard — kartu "Disematkan" setinggi kartu "Prioritas Hari Ini" & sub-bagiannya berupa akordeon:
//   - Notes/Mindmap/Gambar = tombol buka/tutup (aria-expanded + aria-controls → .dash-pin-body
//     ber-`hidden`). Hanya SATU grup terbuka sekaligus: membuka satu otomatis menutup dua lainnya,
//     default Notes, klik header grup yang sedang terbuka menutupnya; tanpa persistensi (state React).
//   - Tiap grup menampilkan maks. 3 item; "+N lainnya →" membuka modal berisi SEMUA item grup itu
//     (tidak lagi diperluas di tempat — daftar jadi lebih tinggi dari kartu & butuh scrollbar).
//   - Desktop: tinggi baris ditentukan Prioritas (`align-items: stretch`); Disematkan absolut di
//     dalam .dash-pin-wrap sehingga selalu setinggi baris. Daftar tetap bisa digulir di dalam bila
//     meluap (kasus tepi, mis. kolom sempit), tapi scrollbar-nya disembunyikan.
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

// Isi helper renderPinnedGroup (sub-bagian kartu Disematkan)
function pinnedGroupSource() {
  const src = dashboardSource();
  const start = src.indexOf("const renderPinnedGroup = (");
  assert.ok(start >= 0, "renderPinnedGroup must exist");
  const end = src.indexOf("const pinnedTotal =", start);
  assert.ok(end > start, "renderPinnedGroup end must be found");
  return src.slice(start, end);
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

test("Dashboard: akordeon Disematkan — satu grup terbuka (default Notes), membuka satu menutup yang lain", () => {
  const src = dashboardSource();
  assert.match(src, /const \[pinOpenKey, setPinOpenKey\] = useState\("notes"\);/);
  assert.doesNotMatch(src, /notes:\s*true,\s*mindmap:\s*false/);
  assert.doesNotMatch(src, /\bsetPinOpen\b|\bpinOpen\[/);
  assert.match(src, /const open = pinOpenKey === key;/);
  // Klik header: buka grup itu (dua lainnya otomatis tertutup) atau tutup bila memang sedang terbuka.
  assert.match(src, /setPinOpenKey\(k => k === key \? null : key\)/);
  assert.match(src, /if \(pinOpenKey !== key\) pinRevealRef\.current = key;/);
  // Reveal-scroll dijalankan ulang setiap grup yang terbuka berganti.
  assert.match(src, /\}, \[pinOpenKey\]\);/);
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

test("Dashboard: tiap grup maks. 3 item; \"+N lainnya →\" membuka modal Disematkan (tidak diperluas di tempat)", () => {
  const src = dashboardSource();
  assert.doesNotMatch(src, /expandedNotes|expandedMaps|expandedDrawings|setExpanded/);
  assert.doesNotMatch(src, /lainnya ▼|Sembunyikan ▲/);
  const g = pinnedGroupSource();
  assert.doesNotMatch(g, /(?<!aria-)\bexpanded\b/); // param/prop `expanded` hilang ("aria-expanded" header tetap)
  assert.match(g, /const visible = \(items \|\| \[\]\)\.slice\(0, 3\);/);
  assert.match(g, /const hasMore = count > 3;/);
  const at = g.indexOf("hasMore && ");
  assert.ok(at >= 0, "tombol \"+N lainnya\" harus dirender saat hasMore");
  const more = g.slice(at);
  assert.match(more, /type: "button",\s*className: "dash-more"/);
  assert.match(more, /openPinModal\(\{\s*title: `\$\{label\} disematkan`,\s*items,\s*color,\s*onItem,\s*nav,\s*untitled\s*\}\)/);
  assert.match(more, /`\+\$\{count - 3\} lainnya →`/);
  assert.doesNotMatch(more, /aria-expanded/);
});

test("Dashboard: modal \"Lihat semua\" punya varian Disematkan (pins) di samping varian task", () => {
  const src = dashboardSource();
  assert.match(src, /const openPinModal = \(\{/);
  assert.match(src, /setDashModal\(\{\s*title,\s*pins: \{\s*items,\s*color,\s*onItem,\s*nav,\s*untitled\s*\}\s*\}\)/);
  // Subjudul: "N item disematkan" untuk pins; varian task tetap "N task".
  assert.match(src, /dashModal\.pins \? `\$\{dashModal\.pins\.items\.length\} item disematkan` : `\$\{dashModal\.tasks\.length\} task`/);
  // Baris pins: ikon pin + judul satu baris (ellipsis) + tanggal; klik → tutup modal lalu buka item
  // persis seperti baris di kartu.
  const i = src.indexOf("dashModal.pins.items.map(it =>");
  assert.ok(i >= 0, "modal harus memetakan dashModal.pins.items");
  const j = src.indexOf("dashModal.tasks.map(t =>", i);
  assert.ok(j > i, "varian task (dashModal.tasks.map) harus tetap ada setelah varian pins");
  const rows = src.slice(i, j);
  assert.match(rows, /key: it\.id,\s*className: "dash-modal-row"/);
  assert.match(rows, /setDashModal\(null\);\s*onItem \? onItem\(it\) : onNav\(nav\);/);
  assert.match(rows, /name: "pin",\s*size: 14,\s*style: \{\s*color: dashModal\.pins\.color,\s*flexShrink: 0\s*\}/);
  assert.match(rows, /flex: 1,\s*minWidth: 0/);
  assert.match(rows, /fontSize: 14,\s*fontWeight: 500,\s*overflow: "hidden",\s*textOverflow: "ellipsis",\s*whiteSpace: "nowrap"\s*\}\s*\}, dashModal\.pins\.untitled\(it\)\)/);
  assert.match(rows, /className: "dash-date"\s*\}, dashFmtDate\(it\.updated_at \|\| it\.created_at\)\)/);
  // Varian task tidak berubah.
  const tasks = src.slice(j);
  assert.match(tasks, /setDashModal\(null\);\s*onTaskClick\(t\);/);
  assert.match(tasks, /React\.createElement\(PriBadge, \{\s*p: t\.priority/);
  assert.match(tasks, /React\.createElement\(StatusBadge, \{\s*s: t\.gtd_status/);
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

test("app.css: baris utama stretch, Disematkan absolut di dalam .dash-pin-wrap, gulir internal tanpa scrollbar terlihat", () => {
  assert.match(appCss, /\.dash-main\s*\{[^}]*align-items:\s*stretch/);
  assert.doesNotMatch(appCss, /\.dash-main\s*\{[^}]*align-items:\s*start/);
  assert.match(appCss, /\.dash-pin-wrap > \.dash-pin-card\s*\{[^}]*position:\s*absolute/);
  assert.match(appCss, /\.dash-pin-card > \.dash-pin-groups\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(appCss, /\.dash-pin-body\[hidden\]\s*\{\s*display:\s*none/);
  // Default (Notes "+N lainnya") butuh ~348px: 340px memunculkan scrollbar bila kartu Prioritas pendek.
  assert.match(appCss, /\.dash-pin-wrap\s*\{[^}]*min-height:\s*352px/);
  // Scrollbar disembunyikan (pola .sidebar-scroll): `scrollbar-width: none` + ::-webkit-scrollbar
  // { display: none }; gulir tetap jalan lewat roda/sentuh/keyboard. Jangan `thin` (di Chromium ≥121
  // mematikan gaya ::-webkit-scrollbar global → scrollbar putih di dark mode). Tanpa
  // overscroll-behavior (halaman tetap bisa digulir di ujung daftar).
  const groupsRules = [...appCss.matchAll(/\.dash-pin-card > \.dash-pin-groups\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(groupsRules.length > 0, ".dash-pin-card > .dash-pin-groups rule must exist");
  for (const body of groupsRules) {
    assert.doesNotMatch(body, /overscroll-behavior/);
    assert.doesNotMatch(body, /scrollbar-width:\s*thin/);
  }
  assert.ok(
    groupsRules.some(b => /overflow-y:\s*auto/.test(b) && /scrollbar-width:\s*none/.test(b)),
    "aturan gulir .dash-pin-card > .dash-pin-groups harus memakai scrollbar-width: none"
  );
  assert.match(appCss, /\.dash-pin-card > \.dash-pin-groups::-webkit-scrollbar\s*\{\s*display:\s*none;?\s*\}/);
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
