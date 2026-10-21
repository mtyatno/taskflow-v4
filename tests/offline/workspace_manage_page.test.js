"use strict";
// Kelola Workspace Fase 1 Task 5 — halaman detail WorkspaceManagePage (ws_manage_<id>):
// helper murni identityDiff + cek sumber (routing, teks persis, cabang owner/anggota, Danger Zone, CSS).
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

// ── identityDiff ──
test("identityDiff: nama di-trim, hanya field yang berubah", () => {
  assert.deepEqual(
    wm.identityDiff({ name: "A", description: "", color_idx: null, avatar: null },
      { name: " A ", description: "x", color_idx: null, avatar: null }),
    { description: "x" });
});
test("identityDiff: avatar \"🔥\" → null", () => {
  assert.deepEqual(
    wm.identityDiff({ name: "A", description: "", color_idx: 2, avatar: "🔥" },
      { name: "A", description: "", color_idx: 2, avatar: null }),
    { avatar: null });
});
test("identityDiff: tanpa perubahan → {}", () => {
  const o = { name: "Tim", description: "Halo", color_idx: 3, avatar: "TM" };
  assert.deepEqual(wm.identityDiff(o, Object.assign({}, o)), {});
  // deskripsi null di server setara "" di draft; avatar "" setara null
  assert.deepEqual(wm.identityDiff({ name: "A", description: null, color_idx: undefined, avatar: null },
    { name: "A", description: "  ", color_idx: null, avatar: "" }), {});
});
test("identityDiff: nama, warna, avatar berubah sekaligus; deskripsi di-trim", () => {
  assert.deepEqual(
    wm.identityDiff({ name: "A", description: "x", color_idx: null, avatar: null },
      { name: " B ", description: " y ", color_idx: 5, avatar: "AB" }),
    { name: "B", description: "y", color_idx: 5, avatar: "AB" });
  assert.deepEqual(wm.identityDiff({ name: "A", description: "", color_idx: 4, avatar: null },
    { name: "A", description: "", color_idx: null, avatar: null }), { color_idx: null });
});
test("identityDiff: input kosong/aneh tidak crash", () => {
  assert.deepEqual(wm.identityDiff(null, null), {});
  assert.deepEqual(wm.identityDiff(undefined, { name: "X" }), { name: "X" });
});

// ── Sumber ──
const page = sliceFn("WorkspaceManagePage");
const form = sliceFn("WorkspaceIdentityForm");
const view = sliceFn("WorkspaceIdentityView");
const members = sliceFn("WorkspaceMembersSection");
const all = page + form + view + members;
const app = sliceBetween("\nfunction App(", "\nReactDOM.render(");

test("komponen ada sekali masing-masing", () => {
  for (const n of ["WorkspaceManagePage", "WorkspaceIdentityForm", "WorkspaceIdentityView", "WorkspaceMembersSection"]) {
    assert.equal((html.match(new RegExp("^function " + n + "\\(", "gm")) || []).length, 1, n);
  }
});

test("teks persis halaman detail", () => {
  const texts = [
    "\"\u2190 Semua workspace\"", "\"Umum\"", "\"Anggota\"", "\"Danger Zone\"",
    "\"Nama\"", "\"Deskripsi\"", "\"Warna\"", "\"Avatar\"",
    "\"Otomatis\"", "\"Inisial\"", "\"Emoji\"", "\"Simpan\"", "\"Batal\"",
    "\"Workspace disimpan\"", "\"Belum ada deskripsi.\"",
    "\"Hapus workspace\"", "\"Task kembali menjadi task pribadi pembuatnya; berkas, chat, project, dan tahap dihapus permanen.\"",
    "\"Keluar dari workspace\"", "\"Kamu tidak lagi melihat task dan berkas workspace ini.\"",
    "\"Workspace tidak ditemukan\"", "\"Butuh koneksi internet\"", "\"Gagal menyimpan workspace\"",
  ];
  for (const t of texts) assert.ok(all.includes(t), "harus mengandung " + t);
  assert.ok(members.includes("\"bergabung \""), "bergabung {tanggal}");
  assert.ok(members.includes("toLocaleDateString(\"id-ID\", { day: \"numeric\", month: \"short\", year: \"numeric\" })"));
  assert.ok(members.includes("joined_at"));
  assert.match(form, /`\$\{[^`]+\}\/300`/, "penghitung n/300");
});

test("Simpan: validasi klien → PATCH network:true → onUpdated + toast; galat detail role=alert", () => {
  assert.ok(form.includes("method: \"PATCH\""));
  assert.match(form, /api\.fetch\(`\/api\/lists\/\$\{[^`]+\}`, \{ method: "PATCH", body: [^}]*network: true \}\)/);
  assert.ok(form.includes("identityDiff("));
  assert.ok(form.includes("validateAvatar("));
  assert.ok(form.includes("onUpdated("));
  assert.ok(form.includes("showToast(\"Workspace disimpan\")"));
  assert.ok(form.includes("typeof detail === \"string\""));
  assert.ok(form.includes("role: \"alert\""));
  // Simpan aktif hanya bila ada perubahan dan valid
  assert.match(form, /disabled: !canSave/);
  assert.match(form, /canSave = [^;]*Object\.keys\(diff\)\.length > 0/);
});

test("pemilih warna radiogroup + aria-checked; avatar pratinjau langsung", () => {
  assert.ok(form.includes("role: \"radiogroup\""));
  assert.ok(form.includes("role: \"radio\""));
  assert.ok(form.includes("\"aria-checked\""));
  assert.ok(form.includes("ws-color-swatch"));
  assert.match(form, /\[0, 1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(form, /WorkspaceAvatar, \{\s*list: preview/);
  assert.match(form, /maxLength: 2/);
});

test("cabang isOwner: anggota hanya teks (tanpa input/textarea)", () => {
  assert.match(page, /isOwner \? \/\*#__PURE__\*\/React\.createElement\(WorkspaceIdentityForm/);
  assert.match(page, /: \/\*#__PURE__\*\/React\.createElement\(WorkspaceIdentityView/);
  assert.doesNotMatch(view, /"input"|"textarea"|"select"/);
  assert.ok(form.includes("\"textarea\""));
  assert.ok(form.includes("\"input\""));
});

test("header: avatar 56 + nama + Owner/Member; tidak ditemukan → tombol kembali", () => {
  assert.match(page, /WorkspaceAvatar, \{\s*list: list,\s*size: 56/);
  assert.ok(page.includes("isOwner ? \"Owner\" : \"Member\""));
  assert.match(page, /if \(!list\)[\s\S]{0,900}"Workspace tidak ditemukan"[\s\S]{0,600}onClick: onBack/);
});

test("Danger Zone: WorkspaceDeleteDialog (owner) / leaveWorkspaceWithDrawings (anggota) → onBack", () => {
  assert.ok(page.includes("ws-danger-zone"));
  assert.match(page, /React\.createElement\(WorkspaceDeleteDialog, \{[\s\S]{0,300}onDeleted: \(\) => \{[\s\S]{0,200}onBack\(\)/);
  assert.match(page, /leaveWorkspaceWithDrawings\(\{[\s\S]{0,700}\}\);\s*if \(left\) \{[\s\S]{0,120}onBack\(\)/);
  assert.match(page, /confirmFn: [^\n]*askDrawingScope/);
  // offline → tombol nonaktif
  assert.match(page, /disabled: !online/);
  assert.ok(page.includes("navigator.onLine"));
  assert.ok(page.includes("addEventListener(\"offline\""));
});

test("anggota: owner pertama, galat + Coba lagi, dialog Keluarkan, undangan owner", () => {
  assert.ok(members.includes("WSM ? WSM.memberRows(detail) : []"));
  assert.ok(members.includes("\"Gagal memuat anggota.\""));
  assert.ok(members.includes("\"Coba lagi\""));
  assert.ok(members.includes("\"Belum ada anggota lain.\""));
  assert.match(members, /`Keluarkan \$\{[^`]+\} dari workspace ini\?`/);
  // Fase 2a Task 6: "Generate Invite Link" → bagian "Link undangan" + "Buat link"
  assert.ok(members.includes('"Link undangan"'));
  assert.ok(members.includes('"Buat link"'));
  assert.ok(members.includes("Undang via Username"));
  // Fase 1 Task 6: panel anggota di kartu SharedListsManager dihapus — satu-satunya pemakai adalah halaman detail
  const mgr = sliceFn("SharedListsManager");
  assert.ok(!mgr.includes("WorkspaceMembersSection"));
  assert.ok(page.includes("React.createElement(WorkspaceMembersSection"));
  assert.equal((html.match(/React\.createElement\(WorkspaceMembersSection/g) || []).length, 1);
  assert.equal((html.match(/\/generate-link`/g) || []).length, 1);
});

test("aman: tanpa innerHTML/hex/confirm() di komponen baru", () => {
  assert.doesNotMatch(all, /dangerouslySetInnerHTML|innerHTML/);
  assert.doesNotMatch(page + form + view, /#[0-9a-fA-F]{3,6}\b/);
  assert.ok(!all.includes("confirm("));
});

test("App: routing ws_manage_, judul, handleWorkspaceUpdated", () => {
  assert.ok(app.includes("page.startsWith(\"ws_manage_\")"));
  assert.match(app, /React\.createElement\(WorkspaceManagePage, \{[\s\S]{0,400}onBack: \(\) => setPage\("manage_lists"\)/);
  assert.match(app, /onUpdated: handleWorkspaceUpdated/);
  const h = sliceBetween("const handleWorkspaceUpdated = useCallback(", "}, [queueListPull]);");
  assert.ok(h.includes("OfflineDB.cacheSet(\"lists\", next)"));
  assert.ok(h.includes("setLocalIdentity("));
  assert.ok(h.includes("queueListPull()"));
  assert.ok(h.includes("setSharedLists("));
  const title = sliceBetween("const getPageTitle = () => {", "const getPageIcon = () => {");
  assert.ok(title.includes("page.startsWith(\"ws_manage_\")"));
});

test("Sidebar: Kelola Workspace aktif saat di ws_manage_*", () => {
  const sb = sliceFn("Sidebar");
  assert.ok(sb.includes("const navPage = page && page.startsWith(\"ws_manage_\") ? \"manage_lists\" : page;"));
  assert.ok(sb.includes("navPage === l.id ? \"active\""));
  assert.ok(sb.includes("navPage === \"manage_lists\" ? \"active\""));
});

test("app.css: .ws-danger-zone (+ gelap) dan .ws-color-swatch", () => {
  assert.match(css, /\.ws-danger-zone\s*\{/);
  assert.ok(css.includes("[data-theme=\"dark\"] .ws-danger-zone"));
  assert.match(css, /\.ws-color-swatch\s*\{/);
  assert.match(css, /\.ws-color-swatch\[aria-checked="true"\]/);
});

test("memberRows membawa joined_at anggota; joinedDate mengurai format SQLite/ISO", () => {
  const rows = wm.memberRows({ owner: { id: 1, username: "a" }, members: [{ id: 2, username: "b", joined_at: "2026-10-01 08:00:00" }] });
  assert.equal(rows[1].joined_at, "2026-10-01 08:00:00");
  assert.equal(rows[0].joined_at, undefined);
  assert.equal(wm.joinedDate("2026-10-01 08:00:00").toISOString(), "2026-10-01T08:00:00.000Z");
  assert.equal(wm.joinedDate("2026-10-01T08:00:00+07:00").toISOString(), "2026-10-01T01:00:00.000Z");
  assert.equal(wm.joinedDate(""), null);
  assert.equal(wm.joinedDate("bukan tanggal"), null);
  assert.equal(wm.joinedDate(null), null);
});
