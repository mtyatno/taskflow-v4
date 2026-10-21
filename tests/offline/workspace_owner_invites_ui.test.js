"use strict";
// Kelola Workspace Fase 2a Task 6 — UI owner di seksi Anggota (WorkspaceMembersSection):
// undangan menunggu + Batalkan, Link undangan (opsi, Buat link, daftar aktif, Salin/Batalkan, Matikan semua).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function sliceFn(name) {
  const s = html.indexOf("\nfunction " + name + "(");
  assert.ok(s > 0, name + " harus ada");
  const e = html.indexOf("\nfunction ", s + 10);
  return html.slice(s, e > s ? e : undefined);
}
const members = sliceFn("WorkspaceMembersSection");

test("semua teks persis ada", () => {
  for (const t of [
    "`Undangan dikirim ke @${",
    '"Undangan menunggu"',
    '"Batalkan"',
    '"Link undangan"',
    '"Berlaku"', '"1 jam"', '"1 hari"', '"7 hari"',
    '"Bisa dipakai"', '"1 orang"', '"Maks 10 orang"', '"Tanpa batas"',
    '"Buat link"',
    '"Salin"',
    '"Link disalin"',
    '"Belum ada link aktif."',
    '"Matikan semua link"',
    '"Matikan semua link undangan workspace ini? Link yang sudah dibagikan tidak bisa dipakai lagi."',
    '"Semua link dimatikan"',
  ]) assert.ok(members.includes(t), "harus mengandung " + t);
});

test("perilaku lama dihapus: toast ditambahkan, Generate Invite Link, link sementara 48 jam", () => {
  assert.ok(!members.includes("ditambahkan ke workspace"));
  assert.ok(!members.includes("Generate Invite Link"));
  assert.ok(!members.includes("Link berlaku 48 jam"));
  assert.ok(!members.includes("generatedLink"), "link baru tidak lagi state sementara");
});

test("generate-link mengirim expires_in + max_uses lewat jaringan, lalu memuat ulang daftar", () => {
  assert.match(members, /\/api\/lists\/\$\{listId\}\/generate-link`/);
  assert.match(members, /expires_in: linkExpires/);
  assert.match(members, /max_uses: linkMaxUses/);
  for (const v of ['"1h"', '"1d"', '"7d"']) assert.ok(members.includes(v), v);
  const gen = members.slice(members.indexOf("const handleCreateLink"), members.indexOf("const handleCreateLink") + 900);
  assert.match(gen, /network: true/);
  assert.match(gen, /loadLinks\(\)/);
});

test("daftar link & undangan menunggu dimuat dari jaringan", () => {
  assert.match(members, /api\.get\(`\/api\/lists\/\$\{listId\}\/links`, \{\s*network: true\s*\}\)/);
  assert.match(members, /api\.get\(`\/api\/lists\/\$\{listId\}\/invitations`, \{\s*network: true\s*\}\)/);
});

test("batalkan link / undangan / matikan semua memakai DELETE jaringan dan memuat ulang", () => {
  assert.match(members, /\/api\/lists\/\$\{listId\}\/links\/\$\{encodeURIComponent\(code\)\}`, \{\s*method: "DELETE",\s*network: true/);
  assert.match(members, /\/api\/lists\/\$\{listId\}\/invitations\/\$\{invId\}`, \{\s*method: "DELETE",\s*network: true/);
  assert.match(members, /\/api\/lists\/\$\{listId\}\/links`, \{\s*method: "DELETE",\s*network: true/);
  const rev = members.slice(members.indexOf("const handleRevokeLink"), members.indexOf("const handleRevokeLink") + 700);
  assert.match(rev, /loadLinks\(\)/);
  const cancel = members.slice(members.indexOf("const handleCancelInvitation"), members.indexOf("const handleCancelInvitation") + 700);
  assert.match(cancel, /loadInvitations\(\)/);
});

test("undang: memuat ulang undangan menunggu, bukan anggota", () => {
  const inv = members.slice(members.indexOf("const handleInvite"), members.indexOf("const handleInvite") + 900);
  assert.match(inv, /loadInvitations\(\)/);
  assert.ok(!/loadMembers\(\)/.test(inv), "invitee belum anggota");
  assert.match(inv, /network: true/);
});

test("Matikan semua memakai dialog Alurik, tanpa confirm(", () => {
  assert.ok(!/\bconfirm\(/.test(members));
  const all = members.slice(members.indexOf("const handleRevokeAll"), members.indexOf("const handleRevokeAll") + 900);
  assert.match(all, /askDrawingScope\(/);
});

test("aksi owner nonaktif offline dengan title", () => {
  for (const t of ['"Buat link"', '"Matikan semua link"']) {
    const i = members.lastIndexOf(t);
    const before = members.slice(Math.max(0, i - 700), i);
    assert.match(before, /disabled: !online/, t);
    assert.match(before, /title: offlineTitle/, t);
  }
  assert.ok((members.match(/title: offlineTitle/g) || []).length >= 7);
});

test("helper teks link dijaga typeof + fallback; URL di input baca-saja min-width 0", () => {
  assert.ok(members.includes('typeof WSM.linkUsageText === "function"'));
  assert.ok(members.includes('typeof WSM.linkExpiryText === "function"'));
  assert.ok(members.includes('className: "ws-invite-link"'));
  assert.match(members, /readOnly: true/);
});

test("ikon dari ViewGlyph, tanpa hex", () => {
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(members));
  assert.match(members, /name: "mLink"/);
});
