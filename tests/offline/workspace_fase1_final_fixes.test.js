"use strict";
// Kelola Workspace Fase 1 — perbaikan review akhir cabang:
// (1) guard typeof untuk helper baru (index.html baru + modul offline lama dari cache SW),
// (2) gaya disabled + petunjuk "Sidebar penuh", (3) urutan pin diterapkan ulang setelah PUT sukses,
// (4) kontrol nonaktif selama ordering + focusMoveRef hanya bila pemindahan diterima,
// (5) mergeIdentityDraft, (8) avatar Inisial/Emoji kosong, (9) judul manage_lists, (10) tombol Kelola di workspace.
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
  return html.slice(s, e > s ? e : undefined);
}
function sliceBetween(a, b) {
  const s = html.indexOf(a);
  assert.ok(s > 0, a + " harus ada");
  const e = html.indexOf(b, s + a.length);
  assert.ok(e > s, b + " harus ada setelah " + a);
  return html.slice(s, e);
}

// ── (1) guard typeof ──
const NEW_HELPERS = [
  ["WP", "avatarFor"], ["WPa", "avatarFor"], ["WP", "validateAvatar"], ["WP", "pinOrderAfterMove"],
  ["WSM", "filterWorkspaces"], ["WSM", "identityDiff"], ["WSM", "joinedDate"], ["WSM", "pinDropIndex"],
  ["WSM", "mergeIdentityDraft"], ["LS", "setLocalIdentity"], ["LS", "setLocalPinOrder"],
];

test("setiap pemanggilan helper baru Fase 1 dijaga typeof X.fn === \"function\"", () => {
  let total = 0;
  for (const [obj, fn] of NEW_HELPERS) {
    const re = new RegExp("\\b" + obj + "\\." + fn + "\\(", "g");
    let m;
    while ((m = re.exec(html))) {
      total++;
      const before = html.slice(Math.max(0, m.index - 260), m.index);
      assert.ok(before.includes(`typeof ${obj}.${fn} === "function"`),
        `${obj}.${fn}( di offset ${m.index} tanpa guard typeof: …${html.slice(m.index - 120, m.index + 40)}`);
    }
  }
  assert.ok(total >= 10, "pemanggilan helper baru ditemukan: " + total);
});

test("pencarian disembunyikan bila filterWorkspaces tidak tersedia", () => {
  const src = sliceFn("SharedListsManager");
  assert.match(src, /const canFilter = !!\(WSM && typeof WSM\.filterWorkspaces === "function"\)/);
  assert.match(src, /const showSearch = sharedLists\.length >= 6 && canFilter/);
});

// WorkspaceAvatar dievaluasi dengan workspacepins lama (cbcd8c7: tanpa avatarFor) → tidak melempar.
function loadWorkspaceAvatar(tf) {
  const src = sliceFn("WorkspaceAvatar");
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const window = { TF: tf };
  // eslint-disable-next-line no-new-func
  return new Function("React", "window", src + "\nreturn WorkspaceAvatar;")(React, window);
}
test("WorkspaceAvatar: modul lama tanpa avatarFor → fallback avatarInitial/avatarColorIndex, tidak crash", () => {
  const oldWP = {
    pinnedForRail: () => [], canPinMore: () => true, applyPinChange: l => l,
    avatarInitial: n => String(n || "?").trim().charAt(0).toUpperCase() || "?",
    avatarColorIndex: id => Number(id) % 8,
  };
  const WA = loadWorkspaceAvatar({ workspacepins: oldWP });
  const el = WA({ list: { id: 11, name: "tim alfa", avatar: "🔥" }, size: 20 });
  assert.equal(el.children[0], "T");
  assert.match(el.props.className, /ws-avatar ws-c3/);
  const el2 = loadWorkspaceAvatar(undefined)({ list: { id: 1, name: "beta" } });
  assert.equal(el2.children[0], "B");
  const el3 = loadWorkspaceAvatar({ workspacepins: {} })({ list: null });
  assert.equal(el3.children[0], "?");
});

test("wsIdentityDiffFallback: cadangan bila identityDiff tidak ada", () => {
  const src = sliceFn("wsIdentityDiffFallback");
  // eslint-disable-next-line no-new-func
  const f = new Function(src + "\nreturn wsIdentityDiffFallback;")();
  const o = { name: "A", description: "", color_idx: null, avatar: null };
  assert.deepEqual(f(o, { name: " A ", description: "", color_idx: null, avatar: null }), {});
  assert.deepEqual(f(o, { name: "B", description: "d", color_idx: 2, avatar: "🔥" }),
    { name: "B", description: "d", color_idx: 2, avatar: "🔥" });
  assert.deepEqual(f({ ...o, avatar: "AB", color_idx: 3 }, { ...o, avatar: null, color_idx: null }), { avatar: null, color_idx: null });
});

// ── (2) gaya disabled + petunjuk penuh ──
test("CSS: .btn:disabled di halaman daftar & kelola tampak nonaktif", () => {
  assert.match(css, /\.ws-list-page \.btn:disabled, \.ws-manage-page \.btn:disabled \{ opacity: \.5; cursor: not-allowed; \}/);
  assert.match(sliceFn("SharedListsManager"), /className: "ws-list-page"/);
  assert.match(sliceFn("WorkspaceManagePage"), /className: "ws-manage-page"/);
});
test("Di sidebar: petunjuk 'Sidebar penuh (5/5)' saat 5 pin", () => {
  const src = sliceFn("SharedListsManager");
  assert.match(src, /pinned\.length >= 5 && \/\*#__PURE__\*\/React\.createElement\("div", \{\s*className: "ws-pin-full-hint"/);
  assert.match(src, /"Sidebar penuh \(5\/5\)\. Lepas salah satu untuk menambah\."/);
  assert.match(css, /\.ws-pin-full-hint \{/);
});

// ── (3) urutan pin diterapkan ulang setelah PUT sukses ──
test("handleWorkspacePinOrder: applyPositions(posOf) lagi setelah PUT sukses", () => {
  const src = sliceBetween("const handleWorkspacePinOrder = useCallback", "const handleWorkspaceUpdated");
  const put = src.indexOf('"/api/lists/pins/order"');
  const ok = src.indexOf("listsMutationSeq.current++; // GET yang terkirim", put);
  const reapply = src.indexOf("applyPositions(posOf);", ok);
  const katch = src.indexOf("} catch (err) {", put);
  assert.ok(put > 0 && ok > put && reapply > ok && reapply < katch, "applyPositions(posOf) di jalur sukses PUT");
  // applyPositions juga menulis cache "lists"
  assert.match(src, /const applyPositions = pos => setSharedLists\(ls => \{[\s\S]*?OfflineDB\.cacheSet\("lists", next\)/);
});

// ── (4) ordering ──
test("selama ordering: ↑/↓, Lepas pin, dan Pin kartu nonaktif; runPin menolak", () => {
  const src = sliceFn("SharedListsManager");
  assert.match(src, /disabled: !online \|\| ordering \|\| pinBusy != null \|\| i === 0,/);
  assert.match(src, /disabled: !online \|\| ordering \|\| pinBusy != null \|\| i === pinned\.length - 1,/);
  assert.match(src, /disabled: !online \|\| pinBusy != null \|\| ordering,\s*title: offlineTitle,\s*onClick: \(\) => runPin\(l\.id, \(\) => onPin\(l\.id, false\)\)/);
  assert.match(src, /disabled: !online \|\| pinBusy != null \|\| ordering \|\| pinFull,/);
  assert.match(src, /if \(!online \|\| pinBusy != null \|\| ordering\) return;\s*setPinBusy\(id\)/);
});
test("focusMoveRef hanya diisi di movePin setelah pemindahan diterima; dipakai setelah ordering selesai", () => {
  const src = sliceFn("SharedListsManager");
  const mp = sliceBetween("const movePin = (from, to, focus) => {", "latest.current = { movePin };");
  const lastEarly = mp.lastIndexOf("return false;");
  const setRef = mp.indexOf("focusMoveRef.current = focus || null;");
  const setOrd = mp.indexOf("setOrdering(true);");
  assert.ok(lastEarly > 0 && setRef > lastEarly && setOrd > setRef, "ref diisi setelah semua return awal");
  assert.equal((src.match(/focusMoveRef\.current = \{/g) || []).length, 0, "tombol tidak lagi mengisi ref sebelum movePin");
  assert.match(src, /movePin\(i, i - 1, \{\s*id: l\.id,\s*dir: "up"\s*\}\)/);
  assert.match(src, /movePin\(i, i \+ 1, \{\s*id: l\.id,\s*dir: "down"\s*\}\)/);
  assert.match(src, /if \(!f \|\| ordering\) return;[\s\S]*?\}, \[pinnedKey, ordering\]\);/);
});

// ── (5) mergeIdentityDraft ──
const D = (o = {}) => Object.assign({ name: "A", description: "d", color_idx: null, avatarMode: "auto", initials: "", emoji: "" }, o);
test("mergeIdentityDraft: draft belum disentuh → ikut nilai baru seluruhnya", () => {
  const prev = D(), next = D({ name: "B", color_idx: 2, avatarMode: "emoji", emoji: "🔥" });
  assert.deepEqual(wm.mergeIdentityDraft(prev, next, D()), next);
});
test("mergeIdentityDraft: field yang diedit dipertahankan, field lain ikut perangkat lain", () => {
  const prev = D(), next = D({ name: "Dari HP", description: "baru", color_idx: 4 });
  const draft = D({ description: "editan saya" });
  assert.deepEqual(wm.mergeIdentityDraft(prev, next, draft), D({ name: "Dari HP", description: "editan saya", color_idx: 4 }));
});
test("mergeIdentityDraft: avatar diperlakukan satu kesatuan (mode/inisial/emoji)", () => {
  const prev = D({ avatarMode: "emoji", emoji: "🔥" });
  const next = D({ avatarMode: "initials", initials: "AB" });
  // pengguna mengubah emoji saja → avatar dianggap disentuh, seluruh grup dipertahankan
  const draft = D({ avatarMode: "emoji", emoji: "🌱" });
  assert.deepEqual(wm.mergeIdentityDraft(prev, next, draft), draft);
  // avatar tidak disentuh, nama diubah → avatar ikut nilai baru
  const draft2 = D({ name: "X", avatarMode: "emoji", emoji: "🔥" });
  assert.deepEqual(wm.mergeIdentityDraft(prev, next, draft2), D({ name: "X", avatarMode: "initials", initials: "AB" }));
});
test("mergeIdentityDraft: tidak mengubah argumen; input null aman", () => {
  const prev = D(), next = D({ name: "B" }), draft = D();
  const snap = JSON.stringify([prev, next, draft]);
  wm.mergeIdentityDraft(prev, next, draft);
  assert.equal(JSON.stringify([prev, next, draft]), snap);
  assert.deepEqual(wm.mergeIdentityDraft(null, null, null), {});
});
test("WorkspaceIdentityForm memakai mergeIdentityDraft (dengan cadangan perilaku lama)", () => {
  const src = sliceFn("WorkspaceIdentityForm");
  assert.match(src, /setDraft\(d => WSM\.mergeIdentityDraft\(prevDraft, nextDraft, d\)\)/);
  assert.match(src, /else if \(JSON\.stringify\(prevDraft\) === JSON\.stringify\(draftRef\.current\)\) setDraft\(nextDraft\)/);
});

// ── (8) avatar kosong ──
test("Inisial/Emoji kosong → pesan dan Simpan nonaktif (clientError)", () => {
  assert.match(html, /const WS_AVATAR_EMPTY_TEXT = "Isi inisial atau emoji, atau pilih Otomatis\.";/);
  const src = sliceFn("WorkspaceIdentityForm");
  assert.match(src, /const avatarEmpty = draft\.avatarMode !== "auto" && !String\(avatarInput \|\| ""\)\.trim\(\);/);
  assert.match(src, /avatarEmpty \? WS_AVATAR_EMPTY_TEXT : !av\.ok \? av\.error : ""/);
  assert.match(src, /const canSave = online && !saving && !clientError && /);
});

// ── (9) judul halaman ──
test("getPageTitle: manage_lists → Kelola Workspace", () => {
  const src = sliceBetween("const getPageTitle = () => {", "const getPageIcon");
  assert.match(src, /manage_lists: "Kelola Workspace"/);
});

// ── (10) tombol Kelola di baris workspace-nav-tabs ──
test("workspace-nav-tabs: tombol Kelola di samping Pin → ws_manage_<id>, aktif offline", () => {
  const row = sliceBetween('className: "workspace-nav-tabs"', '"Kelola project"');
  const pin = row.indexOf("WorkspacePinButton");
  const kel = row.indexOf('"data-testid": "workspace-manage-btn"');
  assert.ok(pin > 0 && kel > pin, "Kelola sesudah tombol Pin");
  const btn = row.slice(kel - 120, row.indexOf('"Kelola")', kel) + 9);
  assert.match(btn, /"aria-label": `Kelola workspace \$\{currentList\.name\}`/);
  assert.match(btn, /onClick: \(\) => setPage\("ws_manage_" \+ listId\)/);
  assert.doesNotMatch(btn, /disabled/);
});
