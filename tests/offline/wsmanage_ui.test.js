"use strict";
// Kelola Workspace Fase 0 Task 4 — cek sumber SharedListsManager + WorkspaceDeleteDialog
// (dialog hapus dengan ringkasan dampak, owner di daftar anggota, istilah workspace, mode gelap, aksesibilitas).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(ROOT, "static/app.css"), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return html.slice(start, end);
}

// SharedListsManager + WorkspaceMembersSection (Fase 1: panel anggota diekstrak, dipakai juga halaman
// WorkspaceManagePage) + WorkspaceDeleteDialog s/d Sidebar.
const block = sliceBetween("\nfunction SharedListsManager(", "\nfunction Sidebar(");
const dialog = sliceBetween("\nfunction WorkspaceDeleteDialog(", "\nfunction Sidebar(");

test("WorkspaceDeleteDialog berada di blok yang sama dengan SharedListsManager", () => {
  assert.ok(block.includes(dialog), "WorkspaceDeleteDialog harus didefinisikan sesudah SharedListsManager, sebelum Sidebar");
  assert.equal((html.match(/^function WorkspaceDeleteDialog\(/gm) || []).length, 1);
});

test("tidak ada confirm(), istilah shared list lama, atau hex terang tetap", () => {
  for (const bad of ["confirm(", "shared list", "Shared list", "\"List dihapus", "#fee2e2", "#fef3c7", "#f8f8f8", "Belum ada anggota.\"", "ditambahkan ke list"]) {
    assert.ok(!block.includes(bad), `tidak boleh mengandung ${bad}`);
  }
});

test("teks persis dialog hapus, keluarkan, daftar anggota dan toast", () => {
  const texts = [
    "`Hapus workspace \"${",
    "\"Ketik nama workspace untuk konfirmasi\"",
    "\"Batal\"",
    "\"Hapus permanen\"",
    "\"Hapus workspace butuh koneksi internet\"",
    "\"Gagal memuat ringkasan — coba lagi\"",
    "\"Coba lagi\"",
    "dari workspace ini?`",
    "`Task belum selesai yang ditugaskan ke ${",
    "akan dilepas penanggung jawabnya.`",
    "\"Keluarkan\"",
    "\"Owner\"",
    "\"Belum ada anggota lain.\"",
    "\"Anggota:\"",
    "\"Workspace dibuat ✅\"",
    "\"Workspace dihapus\"",
    "ditambahkan ke workspace ✅`",
    "\"Anggota dikeluarkan\"",
    "\"Belum ada workspace. Buat yang pertama di atas!\"",
  ];
  for (const t of texts) assert.ok(block.includes(t), `harus mengandung ${t}`);
  assert.match(block, /`Keluarkan \$\{[^`]+\} dari workspace ini\?`/);
});

test("aksesibilitas: aria-expanded, aria-controls, aria-label keluarkan, dialog modal", () => {
  assert.ok(block.includes("\"aria-expanded\""));
  assert.ok(block.includes("\"aria-controls\""));
  assert.ok(block.includes("\"ws-panel-\""));
  assert.ok(block.includes("`Keluarkan ${"));
  assert.ok(block.includes("\"aria-label\""));
  assert.ok(dialog.includes("role: \"dialog\""));
  assert.ok(dialog.includes("\"aria-modal\": \"true\""));
  assert.ok(dialog.includes("\"aria-labelledby\""));
  assert.ok(dialog.includes("\"Escape\""));
  assert.ok(dialog.includes("document.activeElement"));
});

test("memakai helper wsmanage, delete-impact lewat jaringan, dan kelas tema", () => {
  // helper dijaga: window.TF.wsmanage tidak ada → baris anggota [] (tanpa crash), dihitung sekali per render
  // (Fase 1: satu workspace per WorkspaceMembersSection → detail tunggal, bukan peta details[l.id])
  assert.ok(block.includes("const WSM = window.TF && window.TF.wsmanage;"));
  assert.ok(block.includes("WSM ? WSM.memberRows(detail) : []"));
  assert.ok(block.includes("React.createElement(WorkspaceMembersSection"));
  assert.equal((block.match(/memberRows\(/g) || []).length, 1);
  assert.ok(!block.includes("window.TF.wsmanage.memberRows"));
  assert.ok(dialog.includes("const WS = window.TF && window.TF.wsmanage;"));
  assert.ok(dialog.includes("WS.nameMatches"));
  assert.ok(dialog.includes("WS ? WS.impactLines(data) : []"));
  // galat hapus dipetakan (bukan err.message mentah)
  assert.ok(dialog.includes("\"Hapus workspace butuh koneksi internet\" : \"Gagal menghapus workspace \\u2014 coba lagi\""));
  assert.ok(!/setError\(\(err && err\.message\)/.test(dialog));
  assert.ok(dialog.includes("/delete-impact"));
  assert.match(dialog, /\/delete-impact`, \{ network: true \}/);
  assert.ok(dialog.includes("navigator.onLine === false"));
  assert.ok(dialog.includes("btn-danger-soft"));
  assert.ok(block.includes("btn-warn-soft"));
  assert.ok(block.includes("ws-invite-link"));
  // detail anggota TIDAK network:true → SW network-first + fallback cache melayani anggota terakhir saat offline
  assert.match(block, /api\.get\(`\/api\/lists\/\$\{listId\}`\)/);
  assert.doesNotMatch(block, /api\.get\(`\/api\/lists\/\$\{listId\}`, \{ network: true \}\)/);
  // gagal memuat anggota tanpa data → pesan + Coba lagi (bukan "Memuat…" selamanya)
  assert.ok(block.includes("\"Gagal memuat anggota.\""));
  assert.match(block, /!detail && memberError\)[\s\S]{0,800}"Coba lagi"/);
  assert.match(block, /catch \(e\) \{\n\s*console\.warn\([^)]*\);\n\s*setMemberError\(true\)/);
  // detail selalu diambil ulang (guard cache lama dihapus)
  assert.ok(!/if \(members\[listId\]\) return;/.test(block));
  assert.ok(!/if \(detail\) return;/.test(block));
  // keluar memakai dialog Alurik sebagai confirmFn
  assert.match(block, /confirmFn: [^\n]*askDrawingScope/);
  assert.match(block, /confirmFn:[\s\S]{0,200}note: "Task belum selesai yang ditugaskan kepadamu di workspace ini akan dilepas penanggung jawabnya\."/);
});

test("app.css punya .btn-danger-soft, .btn-warn-soft, .ws-invite-link + varian gelap", () => {
  for (const sel of [".btn-danger-soft", ".btn-warn-soft", ".ws-invite-link"]) assert.ok(css.includes(sel), sel);
  assert.ok(css.includes("[data-theme=\"dark\"] .btn-danger-soft"));
  assert.ok(css.includes("[data-theme=\"dark\"] .btn-warn-soft"));
  assert.match(css, /\.ws-invite-link\s*\{[^}]*var\(--bg-subtle\)/);
});

test("DrawingScopeDialog: aksi danger memakai btn-danger-soft, tanpa hex inline", () => {
  const dlg = sliceBetween("function DrawingScopeDialog(", "function useDrawingScopeDialog(");
  assert.ok(dlg.includes('a.danger ? "btn btn-sm btn-danger-soft"'));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(dlg));
});
