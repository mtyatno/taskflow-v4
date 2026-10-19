"use strict";

// PR 3 Task 4: note — sisip/buat/salin drawing sesuai scope note, banner editor, badge embed, placeholder.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
const share = require("../../static/offline/drawingshare.js");

const PLACEHOLDER = "Gambar tidak tersedia untukmu: sudah dihapus atau tidak dibagikan ke workspace ini.";
const LISTS = [{ id: 5, name: "Tim A" }, { id: 9, name: "Tim B" }];

function src(name) {
  const m = html.match(new RegExp("(?:async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  assert.ok(m, name + " harus ada sebagai fungsi top-level");
  return m[0];
}
function helper(name, deps = []) {
  return new Function(deps.map(src).join("\n") + "\nreturn (" + src(name) + ");")();
}
const insertModal = () => (html.match(/function DrawingInsertModal\(\{[\s\S]*?\n\}\n/) || [""])[0];
const quickDraw = () => (html.match(/function QuickDrawModal\(\{[\s\S]*?\nfunction DrawingInsertModal/) || [""])[0];
const editorClick = () => (html.match(/const handleContainerClick = React\.useCallback\([\s\S]*?\}, \[onWikilinkClick/) || [""])[0];
const tick = () => new Promise(r => setImmediate(r));

test("DrawingInsertModal groups gallery by scope and uses scopeNotice/noticeText", () => {
  const group = helper("groupDrawingsByScope", ["drawingScopeListName"]);
  const groups = group([
    { id: 1, title: "a", list_id: null },
    { id: 2, title: "b", list_id: 9 },
    { id: 3, title: "c", list_id: 5 },
    { id: 4, title: "d", list_id: 77 },
    { id: 5, title: "e", list_id: 5 },
  ], LISTS);
  assert.deepEqual(groups.map(g => g.label), ["Pribadi", "Tim A", "Tim B", "Workspace"]);
  assert.deepEqual(groups[1].items.map(d => d.id), [3, 5]);
  assert.equal(groups[0].listId, null);
  assert.deepEqual(group([{ id: 2, list_id: 5 }], LISTS).map(g => g.label), ["Tim A"]);

  const b = insertModal();
  assert.match(b, /noteListId = null/);
  assert.match(b, /sharedLists = \[\]/);
  assert.match(b, /groupDrawingsByScope\(filtered, sharedLists\)/);
  assert.match(b, /TF\.drawingshare\.scopeNotice\(/);
  assert.match(b, /TF\.drawingshare\.noticeText\(/);
  assert.match(b, /"Sisipkan"/);
  assert.match(b, /"Batal"/);
  // same / ws_in_personal → langsung disisipkan; own_to_ws / other_ws_copy → konfirmasi
  assert.match(b, /notice\.kind === "same" \|\| notice\.kind === "ws_in_personal"/);
});

test("insert own personal drawing into W note calls shareDrawing; other workspace drawing is copied", async () => {
  const apply = helper("applyDrawingInsertChoice", ["drawingInsertToken", "drawingShareLaterText"]);
  const calls = [];
  const api = { tag: "api" };
  const mkShare = (shareRes, copyRes) => ({
    shareDrawing: async (a, d, l) => { calls.push(["share", a, d, l]); return shareRes; },
    copyDrawing: async (a, d, l) => { calls.push(["copy", a, d, l]); return copyRes; },
  });

  // own_to_ws sukses → sisip id asli; baris server tanpa server_id diteruskan apa adanya (serverIdOf → id)
  let r = await apply(mkShare({ ok: true, drawing: {} }), api, { id: 12, client_id: "c12", title: "Mine", list_id: null }, { kind: "own_to_ws", listId: 5 }, "Tim A");
  assert.deepEqual(r, { ok: true, id: 12, title: "Mine", toast: null });
  assert.equal(calls[0][0], "share");
  assert.equal(calls[0][1], api);
  assert.equal(calls[0][2].id, 12);
  assert.equal(share.serverIdOf(calls[0][2]), 12);
  assert.equal(calls[0][3], 5);

  // own_to_ws gagal (offline) → tetap disisipkan + toast persis
  calls.length = 0;
  r = await apply(mkShare({ ok: false, code: "OFFLINE", message: "x" }), api, { id: "cid1", cid: "cid1", server_id: null, title: "Mine" }, { kind: "own_to_ws", listId: 5 }, "Tim A");
  assert.equal(r.ok, true);
  assert.equal(r.id, "cid1");
  assert.equal(r.toast, "Gambar belum dibagikan ke Tim A; bagikan dari halaman Draw saat online.");

  // other_ws_copy → salin ke W note, sisip token salinan (client_id dulu)
  calls.length = 0;
  r = await apply(mkShare(null, { ok: true, drawing: { id: 99, cid: "newc", client_id: "newc", title: "Copy" } }), api, { id: 40, title: "Theirs", list_id: 9 }, { kind: "other_ws_copy", listId: 5 }, "Tim A");
  assert.deepEqual(r, { ok: true, id: "newc", title: "Copy", toast: null });
  assert.deepEqual([calls[0][0], calls[0][3]], ["copy", 5]);

  // salin gagal → tidak disisipkan, pesan diteruskan
  r = await apply(mkShare(null, { ok: false, code: "OFFLINE", message: "Data gambar belum tersedia offline." }), api, { id: 40, list_id: 9 }, { kind: "other_ws_copy", listId: 5 }, "Tim A");
  assert.deepEqual(r, { ok: false, message: "Data gambar belum tersedia offline." });

  // scopeNotice asli: drawing pribadi milik sendiri → own_to_ws; milik W lain → other_ws_copy
  assert.equal(share.scopeNotice({ list_id: null, user_id: 1 }, 5, 1).kind, "own_to_ws");
  assert.equal(share.scopeNotice({ list_id: 9, user_id: 1 }, 5, 1).kind, "other_ws_copy");

  const b = insertModal();
  assert.match(b, /applyDrawingInsertChoice\(window\.TF\.drawingshare, api, /);
});

test("new drawing from W note posts list_id", () => {
  const b = insertModal();
  assert.match(b, /api\.post\("\/api\/drawings", \{ title: t, data_json: "\{\}", list_id: noteListId != null \? noteListId : null \}\)/);
  // semua mount meneruskan scope note
  const mounts = html.match(/React\.createElement\(DrawingInsertModal, \{[\s\S]*?showToast: showToast/g) || [];
  assert.equal(mounts.length, 3);
  for (const m of mounts) {
    assert.match(m, /noteListId: /);
    assert.match(m, /sharedLists: /);
  }
  // jalur /draw (slash) membuka modal yang sama (onInsertDrawing) → ikut list_id
  assert.match(html, /case 'draw':\s*\{[\s\S]*?onInsertDrawingRef\.current\?\.\(\)/);
  // wrapper editor dan tampilan baca membawa data-note-list-id
  assert.match(html, /ref: containerRef,\s*"data-note-list-id": noteListId != null \? String\(noteListId\) : "",/);
  assert.match(html, /"data-note-list-id": note\.list_id != null \? String\(note\.list_id\) : ""/);
  assert.match(html, /createElement\(MilkdownEditor, \{\s*value: content,[\s\S]{0,300}noteListId: noteListId,/);
});

function fakeEl(did) {
  const attrs = { "data-drawing-preview": did };
  return {
    innerHTML: "<span>🎨 Memuat gambar...</span>",
    getAttribute: k => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    querySelector: () => null,
    closest: () => null,
    attrs,
  };
}
function loadHydrate(env) {
  const hy = (html.match(/window\.hydrateDrawingPreviews = function\(root, force\) \{[\s\S]*?\n\};/) || [""])[0];
  assert.ok(hy, "hydrateDrawingPreviews harus ada");
  const deps = ["drawingPreviewLookup", "drawingLookupGone", "applyDrawingScopeUi", "noteListIdFromEl", "drawingEmbedScopeUi", "drawingScopeListName"].map(src).join("\n");
  const constSrc = (html.match(/const DRAWING_UNAVAILABLE_TEXT = "[^"]*";/) || [""])[0];
  assert.ok(constSrc, "DRAWING_UNAVAILABLE_TEXT harus ada");
  const f = new Function("window", "document", "api", "navigator", "escapeHtml", constSrc + "\n" + deps + "\n" + hy + "\nreturn window.hydrateDrawingPreviews;");
  return f(env.window, env.document, env.api, env.navigator, s => String(s));
}

test("hydrateDrawingPreviews renders exact placeholder text when drawing unavailable", async () => {
  const run = async ({ local = null, remote, online = true }) => {
    const el = fakeEl("42");
    const window = { TF: { drawingrepo: { getDrawing: async () => local, getRaw: async () => null, currentUid: () => 1 } } };
    const document = { querySelectorAll: () => [el] };
    const api = { get: async () => { if (remote instanceof Error) throw remote; return remote; } };
    const hydrate = loadHydrate({ window, document, api, navigator: { onLine: online } });
    hydrate(null, true);
    for (let i = 0; i < 10; i++) await tick();
    return el;
  };
  const notFound = Object.assign(new Error("Drawing not found"), { __local: true });
  const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });
  const netErr = new TypeError("Failed to fetch");

  for (const remote of [notFound, forbidden, null]) {
    const el = await run({ remote });
    assert.ok(el.innerHTML.includes(PLACEHOLDER), "placeholder persis untuk " + (remote && remote.message));
    assert.equal(el.attrs["data-hydrated"], "unavailable");
  }
  // offline tanpa record lokal → placeholder yang sama
  let el = await run({ remote: netErr, online: false });
  assert.ok(el.innerHTML.includes(PLACEHOLDER));
  // error server sementara (online) → JANGAN klaim tidak tersedia
  el = await run({ remote: Object.assign(new Error("boom"), { status: 500 }), online: true });
  assert.ok(!el.innerHTML.includes(PLACEHOLDER));
  // ditemukan → svg
  el = await run({ remote: { id: 42, svg_preview: "<svg></svg>", list_id: null } });
  assert.equal(el.innerHTML, "<svg></svg>");
  assert.equal(el.attrs["data-hydrated"], "true");
  // ditemukan lokal tanpa svg → tidak dianggap hilang
  el = await run({ local: { id: 42, svg_preview: "" }, remote: notFound });
  assert.ok(!el.innerHTML.includes(PLACEHOLDER));
  assert.ok(html.includes('const DRAWING_UNAVAILABLE_TEXT = "' + PLACEHOLDER + '";'));
});

test("embed shows 👥 badge and copy action when scopes differ; action swaps node id", async () => {
  const ui = helper("drawingEmbedScopeUi", ["drawingScopeListName"]);
  // drawing W9 di note pribadi → badge + Jadikan salinan pribadi
  assert.deepEqual(ui({ list_id: 9, user_id: 2 }, null, LISTS, 1), { badge: "👥 Tim B", action: "Jadikan salinan pribadi", targetListId: null });
  // drawing W9 di note W5 → badge W9 + Salin ke W5
  assert.deepEqual(ui({ list_id: 9, user_id: 1 }, 5, LISTS, 1), { badge: "👥 Tim B", action: "Salin ke Tim A", targetListId: 5 });
  // sama scope → tidak ada apa-apa (id string vs angka)
  assert.equal(ui({ list_id: 5 }, "5", LISTS, 1), null);
  // pribadi milik sendiri di note W → tidak ada tambahan
  assert.equal(ui({ list_id: null, user_id: 1 }, 5, LISTS, 1), null);
  // pribadi milik orang lain di note W → tanpa badge, aksi Salin ke W
  assert.deepEqual(ui({ list_id: null, user_id: 2 }, 5, LISTS, 1), { badge: null, action: "Salin ke Tim A", targetListId: 5 });
  // pribadi di note pribadi → null
  assert.equal(ui({ list_id: null, user_id: 2 }, null, LISTS, 1), null);
  // nama tak dikenal
  assert.equal(ui({ list_id: 77 }, null, LISTS, 1).badge, "👥 Workspace");

  // aksi salin: copyDrawing lalu setNodeMarkup mengganti id node, atribut lain tetap
  const copyInto = helper("copyDrawingIntoEditor", ["drawingInsertToken"]);
  const dispatched = [];
  const nodes = [
    { pos: 3, node: { type: { name: "paragraph" }, attrs: {} } },
    { pos: 7, node: { type: { name: "drawing" }, attrs: { id: "40", title: "T", size: "M", width: "75%", height: "300px" } } },
  ];
  const view = {
    state: {
      doc: { descendants: fn => { for (const n of nodes) if (fn(n.node, n.pos) === false) break; } },
      get tr() { return { setNodeMarkup: (pos, type, attrs) => ({ pos, type, attrs }) }; },
    },
    dispatch: tr => dispatched.push(tr),
  };
  const editor = { action: fn => fn({ get: () => view }) };
  const copied = [];
  const g = global;
  const saved = { window: g.window, TF: g.TF, api: g.api };
  try {
    g.window = g;
    g.window.MilkdownBundle = { editorViewCtx: "view" };
    g.api = {};
    g.TF = {
      drawingrepo: { getDrawing: async id => ({ id: 40, cid: "old", server_id: 40, list_id: 9, title: "T" }) },
      drawingshare: { copyDrawing: async (a, d, l) => { copied.push([d, l]); return { ok: true, drawing: { id: "newc", cid: "newc", title: "T" } }; } },
    };
    const res = await copyInto(editor, "40", 5);
    assert.equal(res.ok, true);
    assert.equal(copied[0][1], 5);
    assert.equal(copied[0][0].server_id, 40);
    assert.deepEqual(dispatched, [{ pos: 7, type: null, attrs: { id: "newc", title: "T", size: "M", width: "75%", height: "300px" } }]);
    // gagal → tidak ada dispatch, pesan diteruskan
    dispatched.length = 0;
    g.TF.drawingshare.copyDrawing = async () => ({ ok: false, code: "OFFLINE", message: "Data gambar belum tersedia offline." });
    const bad = await copyInto(editor, "40", 5);
    assert.deepEqual(bad, { ok: false, message: "Data gambar belum tersedia offline." });
    assert.equal(dispatched.length, 0);
  } finally {
    g.window = saved.window; g.TF = saved.TF; g.api = saved.api;
    delete g.MilkdownBundle;
  }

  const c = editorClick();
  assert.match(c, /e\.target\.closest\('\[data-action="copy-scope"\]'\)/);
  assert.match(c, /copyDrawingIntoEditor\(instanceRef\.current, did, /);
  assert.match(c, /window\.__showToast/);
  // badge + tombol ditaruh di header kartu, tombol hanya di editor
  const a = src("applyDrawingScopeUi");
  assert.match(a, /\.note-draw-header/);
  assert.match(a, /editor-draw-card/);
  assert.match(a, /data-action', 'copy-scope'/);
});

test("QuickDrawModal shows workspace banner text", () => {
  const banner = helper("drawingEditBanner", ["drawingScopeListName"]);
  assert.equal(banner({ list_id: 9 }, 5, LISTS), "Kamu mengedit drawing milik workspace Tim B. Perubahan terlihat oleh semua anggota.");
  assert.equal(banner({ list_id: 9 }, null, LISTS), "Kamu mengedit drawing milik workspace Tim B. Perubahan terlihat oleh semua anggota.");
  assert.equal(banner({ list_id: 9 }, "9", LISTS), null);
  assert.equal(banner({ list_id: null }, 5, LISTS), null);
  assert.equal(banner(null, 5, LISTS), null);

  const q = quickDraw();
  assert.match(q, /noteListId/);
  assert.match(q, /drawingEditBanner\(/);
  // event editDrawingModal membawa noteListId dari kartu editor dan App meneruskannya
  assert.match(editorClick(), /detail: \{ id: did, title: dtitle, noteListId: noteListIdFromEl\(drawCard\) \}/);
  assert.match(html, /setActiveQuickDraw\(\{ id: detail\.id, title: detail\.title \|\| '', noteListId: detail\.noteListId \}\)/);
  assert.match(html, /drawingId: activeQuickDraw\.id,[\s\S]{0,120}noteListId: activeQuickDraw\.noteListId,\s*sharedLists: sharedLists/);
});
