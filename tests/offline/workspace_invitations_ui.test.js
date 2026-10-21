"use strict";
// Kelola Workspace Fase 2a Task 5 — UI penerima: seksi "Undangan untukmu" + pratinjau ?join= (cek sumber).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function between(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  assert.ok(s > 0, `${startMarker} harus ada`);
  const e = html.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `${endMarker} harus ada`);
  return html.slice(s, e);
}
const manager = between("function SharedListsManager({", "function WorkspaceManagePage");
const joinModal = between("function JoinListModal({", "// ── SharedListsManager");

test("SharedListsManager: seksi Undangan untukmu (id ws-invitations) hanya bila ada undangan", () => {
  assert.match(manager, /invitations,\s*onInvitationResponse/);
  assert.ok(manager.includes("Undangan untukmu"));
  assert.ok(manager.includes('"ws-invitations"'));
  assert.match(manager, /invitations\.length\s*>\s*0|invList\.length\s*>\s*0/, "tidak dirender bila kosong");
});

test("tombol Terima/Tolak: nonaktif offline + title, dan sibuk per kartu", () => {
  assert.ok(manager.includes('"Terima"') && manager.includes('"Tolak"'));
  assert.match(manager, /onInvitationResponse\(inv\.id, accept\)/);
  assert.match(manager, /answerInvitation\(inv, true\)[\s\S]*answerInvitation\(inv, false\)/);
  assert.match(manager, /invBusy/);
  assert.match(manager, /disabled: !online \|\| invBusy/);
  assert.ok(manager.includes('typeof WSM.invitationSubtitle === "function"'));
});

test("JoinListModal: Owner + anggota bila owner_name ada", () => {
  assert.ok(joinModal.includes("Owner: "));
  assert.ok(joinModal.includes("anggota"));
  assert.match(joinModal, /owner_name != null/);
});
