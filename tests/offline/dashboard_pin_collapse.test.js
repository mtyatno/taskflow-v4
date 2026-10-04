"use strict";

// Dashboard — kartu "Disematkan" setinggi kartu "Prioritas Hari Ini" & sub-bagiannya berupa akordeon:
//   - Notes/Mindmap/Gambar = tombol buka/tutup (aria-expanded + aria-controls → .dash-pin-body
//     ber-`hidden`). Hanya SATU grup terbuka sekaligus: membuka satu otomatis menutup dua lainnya,
//     default Notes, klik header grup yang sedang terbuka menutupnya; tanpa persistensi (state React).
//   - Tiap grup menampilkan maks. 3 item; "+N lainnya →" membuka modal berisi SEMUA item grup itu
//     (tidak diperluas di tempat).
//   - Desktop: baris grid `align-items: stretch` → kedua kartu selalu sama tinggi (isi yang lebih
//     tinggi menang, lantai 352px). Disematkan ada di alur normal (bukan absolut): akordeon membatasi
//     isinya, jadi tidak ada gulir internal/scrollbar dan tidak ada yang terpotong (dulu di 901–1060px
//     dengan menu penuh, header grup membungkus & grup "Gambar" terpotong di bawah tepi kartu).
//   - ≤900px: kartu bertumpuk normal tanpa lantai tinggi.
//   - Modal "Lihat semua" (task) / "+N lainnya" (Disematkan) — satu-satunya jalan ke item ke-4 dst. —
//     ramah keyboard & pembaca layar: role="dialog" + aria-modal + aria-labelledby, ✕ berlabel &
//     autoFocus, Esc menutup (hanya bila sasarannya di dialog ini / <body>: Esc di modal lain di
//     atasnya, mis. pencarian Ctrl+K, cukup menutup modal itu), fokus kembali ke pemicunya kecuali ada
//     modal lain terbuka (mis. detail task), baris bisa difokus (Tab) & diaktifkan dengan Enter/Spasi,
//     dengan cincin fokus terlihat. Semua pemicunya ber-aria-haspopup="dialog".

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

// Sumber satu komponen top-level: dari `function Name(` sampai `}` penutup di kolom 0.
function fnSource(signature) {
  const start = indexHtml.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${signature} end must be found`);
  return indexHtml.slice(start, end);
}

function dashboardSource() {
  return fnSource("function Dashboard({");
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

// Efek hook level atas Dashboard (indentasi 2 spasi): [{ body, deps }]
function topLevelEffects(src) {
  return [...src.matchAll(/\n  useEffect\(\(\) => \{((?:(?!useEffect\()[\s\S])*?)\n  \}, \[([^\]]*)\]\);/g)]
    .map(m => ({ body: m[1], deps: m[2].split(",").map(d => d.trim()) }));
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
  // Hanya itu — tanpa reveal-scroll: isi kartu tidak pernah meluap, jadi tidak ada yang perlu digulir.
  assert.match(src, /const togglePin = key => setPinOpenKey\(k => k === key \? null : key\);/);
  assert.doesNotMatch(src, /pinRevealRef/);
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
  assert.match(more, /type: "button",\s*className: "dash-more",\s*"aria-haspopup": "dialog"/);
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

test("Dashboard: kartu Prioritas & Disematkan punya kelas hook; daftar Disematkan tanpa ref/gulir", () => {
  const src = dashboardSource();
  assert.match(src, /className: "dash-card dash-prio-card"/);
  assert.match(src, /className: "dash-pin-wrap"/);
  assert.match(src, /className: "dash-card dash-pin-card"/);
  assert.match(src, /className: "dash-pin-groups"\s*\}, renderPinnedGroup\(\{/);
  assert.doesNotMatch(src, /pinScrollRef|scrollBy\(/);
  assert.doesNotMatch(src, /window\.scroll(By|To)\(/);
});

test("app.css: baris utama stretch, Disematkan di alur normal (flex) tanpa gulir internal/scrollbar", () => {
  assert.match(appCss, /\.dash-main\s*\{[^}]*align-items:\s*stretch/);
  assert.doesNotMatch(appCss, /\.dash-main\s*\{[^}]*align-items:\s*start/);
  assert.match(appCss, /\.dash-pin-body\[hidden\]\s*\{\s*display:\s*none/);
  // Wrapper flex; lantai 352px agar tinggi baris tidak melompat saat berganti grup walau Prioritas pendek
  // (bilah ikon / layar lebar; di ~901–1060px dengan menu lengkap masih bisa berubah — lihat app.css).
  const wrapRules = [...appCss.matchAll(/\.dash-pin-wrap\s*\{([^}]*)\}/g)].map(m => m[1]);
  assert.ok(
    wrapRules.some(b => /display:\s*flex/.test(b) && /min-height:\s*352px/.test(b)),
    ".dash-pin-wrap harus display: flex dengan min-height: 352px"
  );
  // Kartu mengisi wrapper di alur normal — tidak ada aturan yang membuat .dash-pin-card absolut.
  assert.match(appCss, /\.dash-pin-wrap > \.dash-pin-card\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/);
  const cardRules = [...appCss.matchAll(/([^{}]*\.dash-pin-card\b[^{}]*)\{([^}]*)\}/g)];
  assert.ok(cardRules.length > 0, "aturan .dash-pin-card harus ada");
  for (const [, sel, body] of cardRules) {
    assert.doesNotMatch(body, /position:\s*absolute/, `${sel.trim()} tidak boleh absolut`);
    assert.doesNotMatch(body, /\binset:/, `${sel.trim()} tidak boleh memakai inset`);
  }
  // Tanpa gulir internal & tanpa trik scrollbar pada daftar grup.
  const groupRules = [...appCss.matchAll(/([^{}]*\.dash-pin-groups\b[^{}]*)\{([^}]*)\}/g)];
  assert.ok(groupRules.length > 0, "aturan .dash-pin-groups harus ada");
  for (const [, sel, body] of groupRules) {
    assert.doesNotMatch(body, /overflow(-y)?:\s*(auto|scroll)/, `${sel.trim()} tidak boleh menggulir`);
    assert.doesNotMatch(body, /scrollbar-width/, `${sel.trim()} tanpa scrollbar-width`);
  }
  assert.doesNotMatch(appCss, /\.dash-pin-groups::-webkit-scrollbar/);
  // Kolom sempit (901–1060px): link "Lihat semua" turun ke baris sendiri, tidak menimpa tombol.
  assert.match(appCss, /\.dash-pin-head\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("app.css ≤900px: Disematkan bertumpuk normal tanpa lantai tinggi (tanpa override absolut/gulir lama)", () => {
  const block = dashMedia900Block();
  assert.ok(block, "@media (max-width: 900px) block with .dash-main must exist");
  assert.match(block, /\.dash-pin-wrap\s*\{[^}]*min-height:\s*0/);
  // Hanya aturan Disematkan (.dash-pin*) yang dicek: tanpa override position (dulu `position: static`
  // pembatal kartu absolut). Aturan lain di blok ini bebas memakai position.
  const pinRules = [...block.matchAll(/([^{}]*\.dash-pin[^{}]*)\{([^}]*)\}/g)];
  assert.ok(pinRules.length > 0, "blok ≤900px harus punya aturan .dash-pin*");
  for (const [, sel, body] of pinRules) {
    assert.doesNotMatch(body, /(^|[;\s])position\s*:/, `${sel.trim()} tidak boleh mengatur position`);
  }
  assert.doesNotMatch(block, /\.dash-pin-groups/);
});

test("Dashboard: modal \"Lihat semua\" / Disematkan ramah keyboard & pembaca layar (kedua varian)", () => {
  const src = dashboardSource();
  const at = src.indexOf("dashModal && /*#__PURE__*/React.createElement(\"div\", {");
  assert.ok(at >= 0, "render modal dashboard harus ada");
  const modal = src.slice(at);
  // Dialog modal berlabel judulnya.
  assert.match(modal, /className: "modal-content scale-in",\s*role: "dialog",\s*"aria-modal": "true",\s*"aria-labelledby": "dash-modal-title",/);
  assert.match(modal, /\{\s*id: "dash-modal-title",\s*style: \{\s*fontWeight: 700,\s*fontSize: 16\s*\}\s*\}, dashModal\.title\)/);
  assert.equal(src.split('id: "dash-modal-title"').length - 1, 1, "id judul modal harus unik");
  // ✕: tombol bertipe, berlabel, langsung menerima fokus saat modal terbuka.
  assert.match(modal, /type: "button",\s*className: "btn btn-secondary btn-sm",\s*"aria-label": "Tutup",\s*autoFocus: true,\s*onClick: \(\) => setDashModal\(null\)\s*\}, "✕"\)/);
  // Baris kedua varian (pins & task): bisa difokus, diaktifkan keyboard (aksi = onClick-nya sendiri).
  assert.equal(src.split('className: "dash-modal-row"').length - 1, 2, "dua varian baris modal");
  const rows = [...modal.matchAll(/className: "dash-modal-row",\s*role: "button",\s*tabIndex: 0,\s*onKeyDown: dashModalRowKey,\s*onClick: \(\) => \{/g)];
  assert.equal(rows.length, 2, "baris pins & task harus role=button + tabIndex 0 + onKeyDown");
  // Enter/Spasi → klik baris itu sendiri (aksi identik dengan onClick); preventDefault agar Spasi tidak
  // menggulir & Enter tidak ikut "menekan" elemen yang baru menerima fokus.
  assert.match(src, /\n  const dashModalRowKey = e => \{\s*if \(e\.key !== "Enter" && e\.key !== " "\) return;\s*e\.preventDefault\(\);\s*e\.currentTarget\.click\(\);\s*\};/);
  // Esc menutup — listener hanya selama modal terbuka, dilepas lagi (hook level atas, tanpa syarat).
  assert.match(src, /\n  const dashModalOpenerRef = useRef\(null\);/);
  const esc = topLevelEffects(src).filter(e => e.deps.length === 1 && e.deps[0] === "dashModal");
  assert.equal(esc.length, 1, "satu efek level atas bergantung pada [dashModal]");
  const body = esc[0].body;
  assert.match(body, /^\s*if \(!dashModal\) return;/);
  // ...tapi hanya bila sasaran keydown ada di dalam dialog ini (ref di elemen dialog, hook level atas)
  // atau <body>: Esc di modal lain yang terbuka di atasnya (mis. pencarian Ctrl+K) hanya menutup modal itu.
  assert.match(src, /\n  const dashModalRef = useRef\(null\);/);
  assert.match(modal, /ref: dashModalRef,\s*className: "modal-content scale-in",\s*role: "dialog",/);
  assert.match(body, /const onKey = e => \{\s*if \(e\.key !== "Escape"\) return;\s*(?:\/\/[^\n]*\s*)*const t = e\.target;\s*if \(t === document\.body \|\| \(dashModalRef\.current && dashModalRef\.current\.contains\(t\)\)\) setDashModal\(null\);\s*\};/);
  assert.doesNotMatch(body, /if \(e\.key === "Escape"\) setDashModal\(null\);/);
  assert.match(body, /window\.addEventListener\("keydown", onKey\);/);
  assert.match(body, /window\.removeEventListener\("keydown", onKey\);/);
  // Fokus kembali ke pemicu (dicatat saat modal dibuka) bila elemen itu masih ada di halaman, fokus
  // lepas ke <body>, dan TIDAK ada modal lain (.modal-overlay) — memilih task membuka detail task
  // (tanpa mengambil fokus); fokus di pemicu di belakangnya membuat Spasi membuka daftar lagi.
  assert.match(body, /const opener = dashModalOpenerRef\.current;/);
  assert.match(body, /if \(opener && opener\.isConnected && \(!active \|\| active === document\.body\) && !document\.querySelector\("\.modal-overlay"\)\) opener\.focus\(\);/);
  assert.match(src, /const openModal = \(title, cellTasks\) => \{\s*dashModalOpenerRef\.current = document\.activeElement;\s*setDashModal\(\{\s*title,\s*tasks: cellTasks\s*\}\);\s*\};/);
  assert.match(src, /untitled\s*\}\) => \{\s*dashModalOpenerRef\.current = document\.activeElement;\s*setDashModal\(\{\s*title,\s*pins: \{/);
  // Cincin fokus baris modal terlihat (meniru .dash-pin-toggle), juga di dark mode. Offset negatif:
  // baris memenuhi lebar daftar modal yang ber-overflow, cincin di luar baris akan terpotong.
  assert.match(appCss, /\.dash-modal-row:focus-visible\s*\{\s*outline:\s*2px solid #7E9400;\s*outline-offset:\s*-2px;?\s*\}/);
  assert.match(appCss, /\[data-theme="dark"\] \.dash-modal-row:focus-visible\s*\{\s*outline-color:\s*var\(--accent\);?\s*\}/);
});

test("Dashboard: pemicu modal task (\"+N lagi →\" & \"Lihat semua →\") ber-aria-haspopup=\"dialog\" seperti \"+N lainnya\"", () => {
  const src = dashboardSource();
  // Tombol "+N lagi →" kartu Eisenhower/GTD (renderListCard) & Proyek Aktif.
  const moreOpen = src.match(/onClick: \(\) => openModal\(/g) || [];
  assert.equal(moreOpen.length, 2, "dua tombol \"+N lagi\" membuka modal task");
  const morePopup = src.match(/className: "dash-more",\s*"aria-haspopup": "dialog",\s*onClick: \(\) => openModal\(/g) || [];
  assert.equal(morePopup.length, moreOpen.length, "setiap \"+N lagi\" yang membuka modal ber-aria-haspopup=\"dialog\"");
  // Link "Lihat semua →" di header kartu yang sama (DashCardHead link/onLink) → prop linkPopup.
  const linkOpen = src.match(/onLink: \(\) => openModal\(/g) || [];
  assert.equal(linkOpen.length, 2, "dua link \"Lihat semua\" membuka modal task");
  const linkPopup = src.match(/linkPopup: "dialog",\s*onLink: \(\) => openModal\(/g) || [];
  assert.equal(linkPopup.length, linkOpen.length, "setiap \"Lihat semua\" yang membuka modal memberi linkPopup");
  // Hanya di sana: link yang berpindah halaman (onNav) tetap tanpa aria-haspopup.
  assert.equal((src.match(/\blinkPopup\b/g) || []).length, 2, "linkPopup hanya di kartu yang link-nya membuka modal");
  // DashCardHead meneruskan linkPopup ke DashLink → "aria-haspopup" (tanpa prop: undefined → tanpa atribut).
  const head = fnSource("function DashCardHead({");
  assert.match(head, /\bonLink,\s*linkPopup\s*\}\)/);
  assert.match(head, /link && \/\*#__PURE__\*\/React\.createElement\(DashLink, \{\s*onClick: onLink,\s*popup: linkPopup\s*\}, link\)/);
  const link = fnSource("function DashLink({");
  assert.match(link, /\{\s*onClick,\s*popup,\s*children\s*\}\)/);
  assert.match(link, /className: "dash-link",\s*"aria-haspopup": popup,\s*onClick: onClick/);
});
