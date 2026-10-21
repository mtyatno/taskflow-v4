"use strict";
// Kelola Workspace Fase 2a Task 4 — helper teks undangan/link (TF.wsmanage) + cek sumber App:
// state undangan, cache offline, badge di sidebar (menu terbuka + rail), klik notifikasi undangan.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const wm = require("../../static/offline/wsmanage.js");

const ROOT = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return html.slice(start, end);
}

const DT_OPTS = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
const D_OPTS = { day: "numeric", month: "short", year: "numeric" };

// ── helper ──────────────────────────────────────────────────────────────

test("linkUsageText: sisa dari batas, atau tanpa batas", () => {
  assert.equal(wm.linkUsageText({ max_uses: 10, uses: 7 }), "Sisa 3 dari 10");
  assert.equal(wm.linkUsageText({ max_uses: 1, uses: 0 }), "Sisa 1 dari 1");
  assert.equal(wm.linkUsageText({ max_uses: null, uses: 5 }), "Tanpa batas");
  assert.equal(wm.linkUsageText({ uses: 0 }), "Tanpa batas");
  assert.equal(wm.linkUsageText({ max_uses: 10, uses: 12 }), "Sisa 0 dari 10", "sisa tidak pernah negatif");
  assert.equal(wm.linkUsageText(null), "Tanpa batas");
});

test("linkExpiryText: 'berlaku sampai {tanggal jam}' format id-ID", () => {
  const iso = "2026-10-22T08:30:00Z";
  const expected = "berlaku sampai " + new Date(iso).toLocaleString("id-ID", DT_OPTS);
  assert.equal(wm.linkExpiryText(iso), expected);
  // format SQLite UTC ("YYYY-MM-DD HH:MM:SS") diperlakukan sebagai UTC
  assert.equal(wm.linkExpiryText("2026-10-22 08:30:00"), expected);
  assert.equal(wm.linkExpiryText(""), "");
  assert.equal(wm.linkExpiryText("bukan tanggal"), "");
});

test("invitationSubtitle: 'Diundang oleh {nama} · {tanggal}'", () => {
  const created = "2026-10-21 03:00:00";
  const tanggal = new Date("2026-10-21T03:00:00Z").toLocaleDateString("id-ID", D_OPTS);
  assert.equal(wm.invitationSubtitle({ inviter_name: "Budi", created_at: created }), `Diundang oleh Budi · ${tanggal}`);
  assert.equal(wm.invitationSubtitle({ inviter_name: "  Budi ", created_at: null }), "Diundang oleh Budi");
  assert.equal(wm.invitationSubtitle({ inviter_name: "", created_at: created }), `Diundang · ${tanggal}`);
  assert.equal(wm.invitationSubtitle(null), "Diundang");
});

// ── cek sumber App ──────────────────────────────────────────────────────

const app = sliceBetween("\nfunction App(", "\nReactDOM");

test("App: state invitations + loadInvitations online ({ network: true }) dengan cache 'invitations'", () => {
  assert.match(app, /const \[invitations, setInvitations\] = useState\(\[\]\)/);
  assert.match(app, /api\.get\("\/api\/invitations", \{ network: true \}\)/);
  assert.match(app, /OfflineDB\.cacheSet\("invitations"/);
  assert.match(app, /OfflineDB\.cacheGet\("invitations"\)/);
  const fa = app.slice(app.indexOf("const fetchAll = useCallback"), app.indexOf("window.__refreshTasks = fetchAll"));
  assert.match(fa, /loadInvitations\(\)/, "fetchAll memuat undangan");
});

test("App: handleInvitationResponse accept/decline online + toast + hapus dari state", () => {
  const i = app.indexOf("const handleInvitationResponse = useCallback(");
  assert.ok(i > 0);
  const fn = app.slice(i, i + 2500);
  assert.match(fn, /\/api\/invitations\/\$\{id\}\/\$\{accept \? "accept" : "decline"\}/);
  assert.match(fn, /network: true/);
  assert.match(fn, /`Bergabung ke \$\{/);
  assert.match(fn, /"Undangan ditolak"/);
  assert.match(fn, /detail/);
  assert.match(fn, /OfflineDB\.cacheSet\("invitations"/);
  assert.match(fn, /queueListPull\(\)/);
});

test("App: SharedListsManager menerima invitations + onInvitationResponse", () => {
  const i = app.indexOf("React.createElement(SharedListsManager, {");
  const props = app.slice(i, app.indexOf("});", i));
  assert.match(props, /invitations: invitations/);
  assert.match(props, /onInvitationResponse: handleInvitationResponse/);
});

test("Sidebar: badge undangan di menu Kelola Workspace dan tombol rail 'Semua workspace'", () => {
  const i = app.indexOf("React.createElement(Sidebar, {");
  const props = app.slice(i, app.indexOf("}), /*#__PURE__*/", i));
  assert.match(props, /invitationCount: invitations\.length/);
  const sb = sliceBetween("\nfunction Sidebar(", "\nfunction ");
  assert.match(sb, /invitationCount/);
  const link = sb.slice(sb.indexOf('id: "manage_lists"'), sb.indexOf('id: "manage_lists"') + 300);
  assert.match(link, /count: invitationCount > 0 \? invitationCount : undefined/);
  const ri = sb.indexOf('ref: railAllWsRef');
  const rail = sb.slice(ri, ri + 900);
  assert.match(rail, /invitationCount > 0 && \/\*#__PURE__\*\/React\.createElement\("span", \{\s*className: "sidebar-rail-badge"/);
});

test("Notifikasi kind 'workspace_invite' → buka manage_lists + gulir ke #ws-invitations", () => {
  assert.match(app, /n\.kind === "workspace_invite"/);
  const i = app.indexOf("const openInvitationsFromNotif = ");
  assert.ok(i > 0);
  const fn = app.slice(i, i + 900);
  assert.match(fn, /setPage\("manage_lists"\)/);
  assert.match(fn, /getElementById\("ws-invitations"\)/);
  assert.match(fn, /scrollIntoView/);
});

test("helper baru dipanggil dengan guard typeof (pola Fase 1)", () => {
  for (const name of ["linkUsageText", "linkExpiryText", "invitationSubtitle"]) {
    const calls = html.split(`.${name}(`).length - 1;
    const guards = html.split(`typeof WSM.${name} === "function"`).length - 1;
    assert.ok(guards >= calls, `${name}: setiap panggilan harus dijaga typeof (${calls} panggilan, ${guards} guard)`);
  }
});
