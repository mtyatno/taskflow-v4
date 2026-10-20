"use strict";
// Kelola Workspace Fase 1 Task 6 — halaman daftar (manage_lists): seksi "Di sidebar" (urutan pin: drag + ↑/↓)
// dan "Semua workspace" (kartu Pin/Di-pin, Buka, Kelola; cari bila ≥ 6), pratinjau kode memuat owner + jumlah.
// Helper murni filterWorkspaces/pinDropIndex + cek sumber SharedListsManager, App, CSS.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const wm = require("../../static/offline/wsmanage.js");

const ROOT = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(ROOT, "static/app.css"), "utf8");

function sliceFn(name) {
  const s = html.indexOf("\nfunction " + name + "(");
  assert.ok(s > 0, name + " harus ada");
  const e = html.indexOf("\nfunction ", s + 10);
  assert.ok(e > s, name + " slice");
  return html.slice(s, e);
}
function sliceBetween(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  assert.ok(s > 0, startMarker + " harus ada");
  const e = html.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, endMarker + " harus ada setelah " + startMarker);
  return html.slice(s, e);
}

// ── filterWorkspaces ──
const LISTS = [
  { id: 1, name: "Proyek Alfa", description: "Tim pemasaran" },
  { id: 2, name: "Solo Dua", description: null },
  { id: 3, name: "Tim Tiga" },
  { id: 4, name: "Keuangan", description: "Anggaran PROYEK 2027" },
];

test("filterWorkspaces: query kosong/spasi/null → semua (salinan, urutan tetap)", () => {
  for (const q of ["", "   ", null, undefined]) {
    const out = wm.filterWorkspaces(LISTS, q);
    assert.deepEqual(out.map(l => l.id), [1, 2, 3, 4]);
    assert.notEqual(out, LISTS);
  }
});

test("filterWorkspaces: cocok nama atau deskripsi, case-insensitive, query di-trim", () => {
  assert.deepEqual(wm.filterWorkspaces(LISTS, "  proyek ").map(l => l.id), [1, 4]);
  assert.deepEqual(wm.filterWorkspaces(LISTS, "TIM").map(l => l.id), [1, 3]);
  assert.deepEqual(wm.filterWorkspaces(LISTS, "dua").map(l => l.id), [2]);
  assert.deepEqual(wm.filterWorkspaces(LISTS, "zzz"), []);
});

test("filterWorkspaces: input tidak valid aman", () => {
  assert.deepEqual(wm.filterWorkspaces(null, "a"), []);
  assert.deepEqual(wm.filterWorkspaces(undefined, ""), []);
  assert.deepEqual(wm.filterWorkspaces([null, { id: 9 }, { id: 8, name: "abc" }], "ab").map(l => l.id), [8]);
});

// ── pinDropIndex ──
const BANDS = [{ top: 0, bottom: 40 }, { top: 48, bottom: 88 }, { top: 96, bottom: 136 }];

test("pinDropIndex: baris di bawah pointer; di atas semua → 0, di bawah semua → terakhir", () => {
  assert.equal(wm.pinDropIndex(BANDS, 10), 0);
  assert.equal(wm.pinDropIndex(BANDS, 60), 1);
  assert.equal(wm.pinDropIndex(BANDS, 136), 2);
  assert.equal(wm.pinDropIndex(BANDS, -50), 0);
  assert.equal(wm.pinDropIndex(BANDS, 500), 2);
});

test("pinDropIndex: celah antar baris → baris terdekat; daftar kosong → -1", () => {
  assert.equal(wm.pinDropIndex(BANDS, 42), 0);
  assert.equal(wm.pinDropIndex(BANDS, 46), 1);
  assert.equal(wm.pinDropIndex(BANDS, 93), 2);
  assert.equal(wm.pinDropIndex([], 10), -1);
  assert.equal(wm.pinDropIndex(null, 10), -1);
});

// ── SharedListsManager (sumber) ──
const mgr = sliceFn("SharedListsManager");

test("kartu tanpa Hapus/Keluar/panel lama", () => {
  for (const bad of ["btn-danger-soft", "btn-warn-soft", "handleDelete", "handleLeave", "WorkspaceDeleteDialog",
    "WorkspaceMembersSection", "ws-panel-", "toggleExpand", "expandedList", "\"Anggota:\"", "#2563eb"]) {
    assert.ok(!mgr.includes(bad), "tidak boleh mengandung " + bad);
  }
  assert.doesNotMatch(mgr, /#[0-9a-fA-F]{3,6}\b/);
  assert.doesNotMatch(mgr, /dangerouslySetInnerHTML|innerHTML/);
});

test("teks persis seksi, tombol, kosong, cari, pratinjau kode", () => {
  for (const t of [
    "\"Di sidebar\"",
    "\"Semua workspace\"",
    "\"Belum ada workspace di sidebar. Pin dari daftar di bawah.\"",
    "\"Pin\"",
    "\"Di-pin\"",
    "\"Lepas pin\"",
    "\"Buka\"",
    "\"Kelola\"",
    "\"Maksimal 5 workspace di sidebar\"",
    "`Naikkan ${",
    "`Turunkan ${",
    "\"Cari workspace…\"",
    "\"Tidak ada workspace yang cocok.\"",
    "\"Butuh koneksi internet\"",
    "\"Belum ada workspace. Buat yang pertama di atas!\"",
    "\"Gabung ke Workspace Orang Lain\"",
    "\"Buat Workspace Baru\"",
  ]) assert.ok(mgr.includes(t), "harus mengandung " + t);
  assert.match(mgr, /`Owner: \$\{joinPreview\.owner_name\} (?:·|\\u00B7) \$\{joinPreview\.member_count\} anggota`/);
  assert.match(mgr, /" \\xB7 ", l\.member_count, " anggota"/);
});

test("cari hanya dirender bila sharedLists.length >= 6, memakai filterWorkspaces", () => {
  assert.ok(mgr.includes("const showSearch = sharedLists.length >= 6;"));
  assert.match(mgr, /showSearch && \/\*#__PURE__\*\/React\.createElement\("input"/);
  assert.ok(mgr.includes("WSM.filterWorkspaces(sharedLists, query)"));
  assert.ok(mgr.includes("type: \"search\""));
  assert.ok(mgr.includes("\"aria-label\": \"Cari workspace\""));
});

test("seksi Di sidebar: pinnedForRail, ↑/↓ nonaktif di ujung, pinOrderAfterMove → onPinOrder", () => {
  assert.ok(mgr.includes("WP.pinnedForRail(sharedLists)"));
  assert.ok(mgr.includes("WP.canPinMore(sharedLists)"));
  assert.ok(mgr.includes("WP.pinOrderAfterMove("));
  assert.match(mgr, /onPinOrder\(next\)/);
  assert.match(mgr, /disabled: !online \|\| i === 0/);
  assert.match(mgr, /disabled: !online \|\| i === pinned\.length - 1/);
  assert.match(mgr, /name: "chevron-up"/);
  assert.match(mgr, /name: "chevron-down"/);
  assert.ok(mgr.includes("className: \"ws-pin-row"));
  assert.ok(mgr.includes("\"data-pin-row\""));
});

test("drag Pointer Events: mouse ≥ 6 px, sentuh tekan-tahan 250 ms, touchmove non-pasif, Esc batal", () => {
  assert.ok(mgr.includes("onPointerDown"));
  assert.ok(mgr.includes("kanbanDragStart(e, Date.now())"));
  assert.ok(mgr.includes("kanbanDragShouldStart("));
  assert.match(mgr, /setTimeout\([\s\S]{0,300}, 250\)/);
  assert.match(mgr, /addEventListener\("touchmove", [^,]+, \{\s*passive: false\s*\}\)/);
  assert.ok(mgr.includes("\"pointerup\""));
  assert.ok(mgr.includes("\"pointercancel\""));
  assert.ok(mgr.includes("\"Escape\""));
  assert.ok(mgr.includes("WSM.pinDropIndex("));
  // tombol tidak pernah memulai drag; offline tidak bisa drag
  assert.match(mgr, /closest\("button,input,a"\)/);
  assert.match(mgr, /if \(!online\b[^\n]*return;/);
});

test("Pin/Di-pin/Lepas pin lewat onPin; penuh → nonaktif + tooltip; offline → nonaktif + title", () => {
  assert.match(mgr, /onPin\(l\.id, !l\.pinned\)/);
  assert.match(mgr, /onPin\(l\.id, false\)/);
  assert.match(mgr, /!l\.pinned && !canPin/);
  assert.match(mgr, /"aria-pressed": l\.pinned \? "true" : "false"/);
  assert.ok(mgr.includes("const offlineTitle = online ? undefined : \"Butuh koneksi internet\";"));
  assert.ok(mgr.includes("window.addEventListener(\"online\""));
  assert.ok(mgr.includes("window.addEventListener(\"offline\""));
  assert.ok(mgr.includes("window.removeEventListener(\"offline\""));
});

test("Buka → onOpen(l.id), Kelola → onManage(l.id); kartu memakai WorkspaceAvatar 40 + deskripsi elipsis", () => {
  assert.match(mgr, /onClick: \(\) => onOpen\(l\.id\)/);
  assert.match(mgr, /onClick: \(\) => onManage\(l\.id\)/);
  assert.match(mgr, /React\.createElement\(WorkspaceAvatar, \{\s*list: l,\s*size: 40/);
  assert.match(mgr, /l\.description && \/\*#__PURE__\*\/React\.createElement\("div", \{\s*className: "ws-card-desc"/);
  assert.ok(mgr.includes("className: \"ws-card-name\""));
  assert.ok(mgr.includes("className: \"ws-card-actions\""));
});

// ── App ──
const app = html.slice(html.indexOf("\nfunction App("));

test("App meneruskan onPin/onPinOrder/onOpen/onManage ke SharedListsManager", () => {
  const call = sliceBetween("React.createElement(SharedListsManager, {", "});");
  assert.match(call, /onPin: handleWorkspacePin/);
  assert.match(call, /onPinOrder: handleWorkspacePinOrder/);
  assert.match(call, /onOpen: id => setPage\("slist_" \+ id\)/);
  assert.match(call, /onManage: id => setPage\("ws_manage_" \+ id\)/);
});

test("App handleWorkspacePinOrder: optimistis, PUT pins/order network, rollback + toast, 409 → pull", () => {
  assert.ok(app.includes("const handleWorkspacePinOrder = useCallback(async ids => {"));
  const h = sliceBetween("const handleWorkspacePinOrder = useCallback(async ids => {", "}, [showToast, queueListPull]);");
  assert.ok(h.includes("if (!navigator.onLine) return;"));
  assert.ok(h.includes("OfflineDB.cacheSet(\"lists\", next)"));
  assert.ok(h.includes("LS.setLocalPinOrder(order)"));
  assert.ok(h.includes("LS.setLocalPinOrder(prevOrder)"));
  assert.match(h, /api\.fetch\("\/api\/lists\/pins\/order", \{\s*method: "PUT",\s*body: JSON\.stringify\(\{ list_ids: order \}\),\s*network: true\s*\}\)/);
  assert.ok(h.includes("\"PIN_ORDER_MISMATCH\""));
  assert.ok(h.includes("showToast(\"Urutan pin sudah berubah di perangkat lain\", \"error\")"));
  assert.ok(h.includes("showToast(\"Gagal menyimpan urutan\", \"error\")"));
  assert.ok(h.includes("queueListPull()"));
  // rollback memakai posisi sebelum perubahan (ref, bukan state basi di closure)
  assert.ok(h.includes("sharedListsRef.current"));
  assert.ok(app.includes("const sharedListsRef = useRef(sharedLists);"));
});

// ── CSS ──
test("app.css: .ws-pin-row + status drag, kartu responsif tanpa hex baru", () => {
  for (const sel of [".ws-pin-row", ".ws-pin-row.is-dragging", ".ws-pin-row.is-drop-target", ".ws-card-actions", ".ws-card-desc", ".ws-card-name"]) {
    assert.ok(css.includes(sel), sel);
  }
  const block = css.slice(css.indexOf("/* Kelola Workspace Fase 1 Task 6"), css.indexOf("/* /Kelola Workspace Fase 1 Task 6"));
  assert.ok(block.length > 0, "blok CSS Task 6 bertanda");
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b/);
  assert.match(block, /\.ws-card-desc\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(block, /\.ws-card-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(block, /\.ws-pin-row\s*\{[^}]*touch-action:\s*manipulation/);
});
