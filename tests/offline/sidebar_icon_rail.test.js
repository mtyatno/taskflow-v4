"use strict";

// Sidebar collapsed (desktop) = icon rail ramping (logo + tombol buka menu + 8 menu utama),
// bukan hilang total. Mobile (≤768px) tetap drawer off-canvas dengan menu lengkap.
// Menu utama SELALU mulai sebagai bilah ikon: saat login pertama, tiap muat halaman (state awal)
// dan setelah tiap perpindahan halaman / memilih menu; › (atau ☰ topbar) hanya membukanya sementara.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8");

// Sumber satu komponen top-level: dari `function Name(` sampai `}` penutup di kolom 0.
function fnSource(signature) {
  const start = indexHtml.indexOf(signature);
  assert.ok(start >= 0, `${signature} must exist`);
  const end = indexHtml.indexOf("\n}\n", start);
  assert.ok(end > start, `${signature} end must be found`);
  return indexHtml.slice(start, end);
}

function sidebarSource() {
  return fnSource("function Sidebar({");
}

// App saja — NotesPage punya state `sidebarCollapsed` sendiri (panel daftar note) yang tetap false.
function appSource() {
  return fnSource("function App(");
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

test("App: menu utama default bilah ikon (state awal true); panel daftar NotesPage tetap terbuka", () => {
  const src = appSource();
  assert.match(src, /const \[sidebarCollapsed, setSidebarCollapsed\] = useState\(true\);/);
  assert.doesNotMatch(src, /const \[sidebarCollapsed, setSidebarCollapsed\] = useState\(false\)/);
  // State NotesPage bukan menu utama — tidak boleh ikut berubah.
  assert.match(fnSource("function NotesPage({"), /const \[sidebarCollapsed, setSidebarCollapsed\] = useState\(false\);/);
});

test("App: menu dilipat lagi ke bilah ikon setiap pindah halaman & saat login/logout", () => {
  const src = appSource();
  assert.doesNotMatch(src, /prevSidebarCollapsedRef/);
  // Badan efek persis dua setter (tanpa logika lain), jalan lagi tiap page atau user?.id berubah.
  assert.match(src, /React\.useEffect\(\(\) => \{\s*setSidebarCollapsed\(true\);\s*setSidebarOpen\(false\);\s*\}, \[page, user\?\.id\]\);/);
});

test("App: memilih menu apa pun (termasuk halaman yang sama / Review Mingguan) melipat menu lagi", () => {
  const src = appSource();
  const at = src.indexOf("React.createElement(Sidebar, {");
  assert.ok(at >= 0, "App must render Sidebar");
  const props = src.slice(at, src.indexOf("\n  })", at));
  assert.match(props, /onClose: \(\) => \{\s*setSidebarOpen\(false\);\s*setSidebarCollapsed\(true\);\s*\}/);
  // Tombol ‹/› Sidebar dan ☰ "Toggle menu" topbar desktop tetap toggle biasa.
  assert.match(props, /onToggleCollapse: \(\) => setSidebarCollapsed\(!sidebarCollapsed\)/);
  assert.match(src, /onClick: \(\) => setSidebarCollapsed\(!sidebarCollapsed\),\s*title: "Toggle menu"/);
});

test("Tour Dashboard memperkenalkan bilah ikon & tombol › sebelum langkah menu lengkap", () => {
  const sb = sidebarSource();
  assert.match(sb, /className: "sidebar-rail",\s*"data-tour": "sidebar-rail"/);
  assert.match(sb, /className: "sidebar-rail-btn sidebar-rail-expand",[^}]*"data-tour": "sidebar-expand"/);
  const tourAt = indexHtml.indexOf("const TOUR_STEPS = {");
  assert.ok(tourAt >= 0, "TOUR_STEPS must exist");
  const dashAt = indexHtml.indexOf("dashboard: [", tourAt);
  assert.ok(dashAt > tourAt, "TOUR_STEPS.dashboard must exist");
  const dash = indexHtml.slice(dashAt, indexHtml.indexOf("\n  ],", dashAt));
  const els = [...dash.matchAll(/element: '\[data-tour="([a-z-]+)"\]'/g)].map(m => m[1]);
  // Langkah rail tampil saat menu terlipat (default); langkah menu lengkap tetap ada untuk saat menu
  // kebetulan terbuka (isTourVisible melewati elemen yang tersembunyi).
  assert.deepEqual(els, [
    "sidebar-rail", "sidebar-expand",
    "sidebar-general", "sidebar-collapse", "task-gtd", "sidebar-shared", "sidebar-settings",
    "scratchpad", "eisenhower", "gtd-grid",
  ]);
  assert.match(dash, /'\[data-tour="sidebar-rail"\]', popover: \{ title: '[^']*Menu Utama', description: 'Menu utama tampil sebagai bilah ikon ramping: /);
  assert.match(dash, /'\[data-tour="sidebar-expand"\]', popover: \{ title: '› Menu Lengkap', description: 'Klik › \(atau tombol ☰ di topbar\) untuk membuka menu lengkap: [^']*menu otomatis kembali menjadi bilah ikon\.' \}/);
  // Label sidebar kini "WORKSPACES" (dulu "SHARED LISTS").
  const expand = dash.split("\n").find(l => l.includes(`'[data-tour="sidebar-expand"]'`));
  assert.match(expand, /membuka menu lengkap: GTD, Project, Workspace, dan Pengaturan\./);
  assert.doesNotMatch(expand, /Shared List/);
});

test("Tour Dashboard: langkah sidebar-shared memakai \"Workspace\" (menunya kini \"Kelola Workspace\")", () => {
  assert.match(sidebarSource(), /label: "Kelola Workspace",\s*tourId: "sidebar-shared"/);
  const tourAt = indexHtml.indexOf("const TOUR_STEPS = {");
  assert.ok(tourAt >= 0, "TOUR_STEPS must exist");
  const dashAt = indexHtml.indexOf("dashboard: [", tourAt);
  assert.ok(dashAt > tourAt, "TOUR_STEPS.dashboard must exist");
  const dash = indexHtml.slice(dashAt, indexHtml.indexOf("\n  ],", dashAt));
  const shared = dash.split("\n").find(l => l.includes(`'[data-tour="sidebar-shared"]'`));
  assert.ok(shared, "langkah sidebar-shared harus ada");
  assert.match(shared, /popover: \{ title: '👥 Workspace', description: 'Kelola workspace bersama — buat Workspace baru, undang anggota, atau bergabung ke workspace milik orang lain\. Cocok untuk kolaborasi tim atau keluarga\.' \}/);
  assert.doesNotMatch(dash, /'👥 Shared List'/);
  assert.doesNotMatch(dash, /Shared List/);
});

test("Tour halaman task list: langkah GTD punya cadangan di tombol › bilah ikon", () => {
  const tourAt = indexHtml.indexOf("const TOUR_STEPS = {");
  assert.ok(tourAt >= 0, "TOUR_STEPS must exist");
  const inboxAt = indexHtml.indexOf("\n  inbox: [", tourAt);
  assert.ok(inboxAt > tourAt, "TOUR_STEPS.inbox must exist");
  const inbox = indexHtml.slice(inboxAt, indexHtml.indexOf("\n  ],", inboxAt));
  const els = [...inbox.matchAll(/element: '\[data-tour="([a-z-]+)"\]'/g)].map(m => m[1]);
  // [data-tour="task-gtd"] hanya ada di menu lengkap, yang kini terlipat setiap pindah halaman →
  // cadangan tepat setelahnya di tombol ›. Hanya salah satu yang terlihat (isTourVisible melewati
  // yang tersembunyi), jadi langkah "🔄 GTD Workflow" selalu tampil satu kali.
  assert.deepEqual(els, ["task-add", "task-list", "task-filter", "task-gtd", "sidebar-expand"]);
  assert.match(inbox, /'\[data-tour="task-gtd"\]', popover: \{ title: '🔄 GTD Workflow', /);
  assert.match(inbox, /\{ element: '\[data-tour="sidebar-expand"\]', popover: \{ title: '🔄 GTD Workflow', description: 'Klik › untuk membuka menu lengkap\. Bagian GTD berisi Inbox → Next Actions → Waiting For → Someday; pindahkan task antar status ini sampai Done sesuai metodologi GTD\.' \} \},/);
  // next/waiting/someday/all/overdue/done memakai langkah yang sama.
  assert.match(indexHtml, /\['next','waiting','someday','all','overdue','done'\]\.forEach\(p => \{ TOUR_STEPS\[p\] = TOUR_STEPS\.inbox; \}\);/);
});
