"use strict";

// PR 3 Task 5: dialog drawing saat share/unshare note dan keluar workspace.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");
const realShare = require("../../static/offline/drawingshare.js");
const drawdirective = require("../../static/offline/drawdirective.js");

function src(name) {
  const m = html.match(new RegExp("(?:async )?function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n\\}"));
  assert.ok(m, name + " harus ada sebagai fungsi top-level");
  return m[0];
}
const HELPERS = [
  "drawingInsertToken",
  "noteShareDrawingIndex", "noteDrawingPullbackCandidates", "prepareNoteShare", "executeNoteShare", "noteShareUnexpectedMoved",
  "noteShareDialogSpec", "notePullbackDialogSpec", "pullNoteDrawingsBack", "confirmNoteShareWithDrawings",
  "leaveImpactDialogSpec", "leaveWorkspaceWithDrawings",
];
const BUSY = "Memeriksa gambar…";
// Toast error/peringatan saja (toast busy "info" dicek terpisah).
const errToasts = arr => (m, t) => { if (t !== "info") arr.push([m, t]); };
const PRELUDE = (html.match(/^const NOTE_SHARE_LIST_TIMEOUT_MS = \d+;$/m) || [""])[0];
const H = new Function(PRELUDE + "\n" + HELPERS.map(src).join("\n") + "\nreturn {" + HELPERS.join(",") + "};")();

const UID = 7;
// Pribadi milik saya, milik workspace lain (9), dan sudah di W (5).
const MINE = { id: 11, server_id: 11, cid: "c-mine", title: "Mine", list_id: null, user_id: UID };
const OTHER = { id: 22, client_id: "c-other", title: "Other WS", list_id: 9, user_id: 8 }; // baris server tanpa server_id
const SAME = { id: 33, server_id: 33, cid: "c-same", title: "Already", list_id: 5, user_id: UID };
const CONTENT = "a ::draw[11] b ::draw[c-other]{size=\"m\"} c ::draw[33] d ::draw[ghost]";

function mkTF(over = {}) {
  const calls = [];
  const share = Object.assign({}, realShare, {
    copyDrawing: async (api, d, listId) => { calls.push(["copy", d, listId]); return { ok: true, drawing: { id: 99, server_id: 99, client_id: "c-copy", title: d.title } }; },
    shareDrawing: async (api, d, listId) => { calls.push(["shareDrawing", d, listId]); return { ok: true, drawing: d }; },
    applyMovedDrawings: async (moved) => { calls.push(["applyMoved", moved]); },
  }, over.share || {});
  const TF = {
    drawingshare: share,
    drawdirective,
    drawingrepo: {
      listDrawings: async () => { if (over.listFail) throw new Error("idb rusak"); return over.list || [MINE, OTHER, SAME]; },
      currentUid: () => UID,
    },
  };
  return { TF, calls };
}
function mkApi(calls, over = {}) {
  return {
    patch: async (url, body) => { calls.push(["patch", url, body]); if (over.patch) return over.patch(url, body); return { id: 1, list_id: body.list_id, moved_drawings: [{ id: 11, list_id: body.list_id }] }; },
    put: async (url, body) => { calls.push(["put", url, body]); return Object.assign({ id: 1 }, body); },
    get: async (url) => { calls.push(["get", url]); if (over.get) return over.get(url); return null; },
    del: async (url) => { calls.push(["del", url]); return {}; },
  };
}

test("note share shows move/copy lists and cancels without writes", async () => {
  const { TF, calls } = mkTF();
  const api = mkApi(calls);
  const asked = [];
  const toasts = [];
  const saves = [];
  const ok = await H.confirmNoteShareWithDrawings({
    note: { id: 1, content: CONTENT }, content: CONTENT, targetListId: 5, listName: "Tim A",
    api, TF, showToast: (m, t) => toasts.push([m, t]),
    ask: async spec => { asked.push(spec); return "cancel"; },
    saveContent: async t => saves.push(t),
  });
  assert.equal(ok, false);
  assert.equal(asked.length, 1);
  const spec = asked[0];
  assert.deepEqual(spec.sections.map(s => s.label), ["Ikut dibagikan ke Tim A:", "Akan disalin ke Tim A:"]);
  assert.deepEqual(spec.sections[0].items, ["Mine"]);
  assert.deepEqual(spec.sections[1].items, ["Other WS"]);
  assert.equal(spec.note, "1 gambar tidak bisa diperiksa");
  assert.deepEqual(spec.actions.map(a => a.label), ["Batal", "Bagikan"]);
  // Batal: tidak ada salin/simpan/PATCH
  assert.deepEqual(calls, []);
  assert.deepEqual(saves, []);
  assert.deepEqual(toasts, [[BUSY, "info"]]); // status sibuk selama prepareNoteShare

  // Tanpa move/copy → tanpa dialog, tetapi share ke W tetap flush + gerbang dorong sebelum PATCH
  const plain = mkTF();
  const api2 = mkApi(plain.calls, { patch: async (u, body) => ({ id: 1, list_id: body.list_id, moved_drawings: [] }) });
  const asked2 = [];
  const ok2 = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "x ::draw[33] ::draw[ghost]", targetListId: 5, listName: "Tim A",
    api: api2, TF: plain.TF, showToast: () => {}, ask: async s => { asked2.push(s); return "share"; },
    saveContent: async () => plain.calls.push(["flush"]), pushNow: async () => { plain.calls.push(["push"]); return true; },
  });
  assert.equal(ok2, true);
  assert.equal(asked2.length, 0);
  assert.deepEqual(plain.calls.map(c => c[0]), ["flush", "push", "patch", "applyMoved"]);

  // listDrawings gagal → dialog tidak dilewati diam-diam: toast + share dibatalkan
  const broken = mkTF({ listFail: true });
  const toasts3 = [];
  const ok3 = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: CONTENT, targetListId: 5, listName: "Tim A",
    api: mkApi(broken.calls), TF: broken.TF, showToast: errToasts(toasts3), ask: async () => "share", saveContent: async () => {},
  });
  assert.equal(ok3, false);
  assert.deepEqual(toasts3, [["Tidak bisa memeriksa gambar; coba lagi.", "error"]]);
  assert.deepEqual(broken.calls, []);
});

test("note share copies other-workspace drawings, rewrites tokens, then shares and applies moved_drawings", async () => {
  const { TF, calls } = mkTF();
  const api = mkApi(calls);
  const saves = [];
  const shared = [];
  let pushed = 0;
  const ok = await H.confirmNoteShareWithDrawings({
    note: { id: 1, content: CONTENT }, content: CONTENT, targetListId: 5, listName: "Tim A",
    api, TF, showToast: (m, t) => { if (t !== "info") assert.fail("tidak boleh toast: " + m); },
    ask: async () => "share",
    saveContent: async t => { calls.push(["save"]); saves.push(t(CONTENT)); },
    pushNow: async id => { calls.push(["push", id]); pushed++; return true; },
    onShared: updated => shared.push(updated),
  });
  assert.equal(ok, true);
  assert.deepEqual(calls.map(c => c[0]), ["copy", "save", "push", "patch", "applyMoved"]);
  // salin baris server tanpa server_id → diteruskan apa adanya; drawingshare.serverIdOf memakai id; ke W
  assert.equal(calls[0][1], OTHER);
  assert.equal(realShare.serverIdOf(calls[0][1]), 22);
  assert.equal(calls[0][2], 5);
  // token diganti dengan client_id salinan, atribut tetap
  assert.equal(saves[0], "a ::draw[11] b ::draw[c-copy]{size=\"m\"} c ::draw[33] d ::draw[ghost]");
  assert.deepEqual(calls[2], ["push", 1]);
  assert.deepEqual(calls[3].slice(1), ["/api/scratchpad/1/share", { list_id: 5 }]);
  assert.deepEqual(calls[4][1], [{ id: 11, list_id: 5 }]);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].list_id, 5);
  assert.equal(pushed, 1);

  // Salin gagal → toast pesan, tidak simpan, tidak PATCH
  const f = mkTF({ share: { copyDrawing: async () => ({ ok: false, code: "OFFLINE", message: "Data gambar belum tersedia offline." }) } });
  const toasts = [];
  const ok2 = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: CONTENT, targetListId: 5, listName: "Tim A",
    api: mkApi(f.calls), TF: f.TF, showToast: errToasts(toasts), ask: async () => "share", saveContent: async () => f.calls.push(["save"]),
  });
  assert.equal(ok2, false);
  assert.deepEqual(toasts, [["Data gambar belum tersedia offline.", "error"]]);
  assert.deepEqual(f.calls.map(c => c[0]), []);

  // PATCH gagal → error tidak ditelan
  const g = mkTF();
  const toasts3 = [];
  const ok3 = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "x", targetListId: 5, listName: "Tim A",
    api: mkApi(g.calls, { patch: async () => { throw new Error("Server error"); } }), TF: g.TF,
    showToast: errToasts(toasts3), ask: async () => "share", saveContent: async () => {}, pushNow: async () => true,
  });
  assert.equal(ok3, false);
  assert.deepEqual(toasts3, [["Server error", "error"]]);

  // Salinan ke-2 gagal → jumlah salinan yang sudah dibuat disebut di toast; tidak simpan/PATCH
  const OTHER2 = { id: 23, server_id: 23, cid: "c-o2", title: "Other 2", list_id: 9, user_id: 8 };
  let n = 0;
  const h = mkTF({ list: [OTHER, OTHER2], share: { copyDrawing: async (a, d) => { h.calls.push(["copy"]); return ++n === 1 ? { ok: true, drawing: { id: 98, server_id: 98, client_id: "k1" } } : { ok: false, code: "ERROR", message: "x" }; } } });
  const toasts4 = [];
  const ok4 = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "::draw[c-other] ::draw[c-o2]", targetListId: 5, listName: "Tim A",
    api: mkApi(h.calls), TF: h.TF, showToast: errToasts(toasts4), ask: async () => "share", saveContent: async () => h.calls.push(["save"]),
  });
  assert.equal(ok4, false);
  assert.deepEqual(toasts4, [["Gagal menyalin gambar (1 salinan sudah dibuat).", "error"]]);
  assert.deepEqual(h.calls.map(c => c[0]), ["copy", "copy"]);
});

test("share rewrites tokens against the CURRENT content at save time (late edits kept)", async () => {
  const { TF, calls } = mkTF();
  let editor = CONTENT;
  const ok = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: editor, targetListId: 5, listName: "Tim A",
    api: mkApi(calls), TF, showToast: () => {},
    ask: async () => { editor = editor + "\nketikan baru"; return "share"; }, // diketik saat dialog terbuka
    saveContent: async t => { editor = t(editor); },
    pushNow: async () => true,
  });
  assert.equal(ok, true);
  assert.equal(editor, "a ::draw[11] b ::draw[c-copy]{size=\"m\"} c ::draw[33] d ::draw[ghost]\nketikan baru");
});

test("share aborts before PATCH when the outbox push fails; move-only flushes first; unresolved_drawings toasts", async () => {
  // push gagal/timeout → tidak ada PATCH, toast persis, note tetap tidak dibagikan
  const a = mkTF();
  const toastsA = [];
  const okA = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "::draw[11]", targetListId: 5, listName: "Tim A",
    api: mkApi(a.calls), TF: a.TF, showToast: errToasts(toastsA), ask: async () => "share",
    saveContent: async () => a.calls.push(["flush"]), pushNow: async () => { a.calls.push(["push"]); return false; },
  });
  assert.equal(okA, false);
  assert.deepEqual(toastsA, [["Catatan belum tersinkron; coba bagikan lagi sebentar lagi.", "error"]]);
  assert.deepEqual(a.calls.map(c => c[0]), ["flush", "push"]);

  // move-only: flush (walau isi tidak berubah) → push → patch → applyMoved
  const b = mkTF();
  const flushed = [];
  const okB = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "::draw[11]", targetListId: 5, listName: "Tim A",
    api: mkApi(b.calls), TF: b.TF, showToast: () => {}, ask: async () => "share",
    saveContent: async t => { b.calls.push(["flush"]); flushed.push(t("::draw[11] x")); }, pushNow: async () => { b.calls.push(["push"]); return true; },
  });
  assert.equal(okB, true);
  assert.deepEqual(b.calls.map(c => c[0]), ["flush", "push", "patch", "applyMoved"]);
  assert.deepEqual(flushed, ["::draw[11] x"]);

  // unresolved_drawings → toast jumlah
  const c = mkTF();
  const toastsC = [];
  const okC = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "x", targetListId: 5, listName: "Tim A",
    api: mkApi(c.calls, { patch: async (u, body) => ({ id: 1, list_id: 5, moved_drawings: [], unresolved_drawings: ["a", "b"] }) }), TF: c.TF,
    showToast: errToasts(toastsC), ask: async () => "share", saveContent: async () => {}, pushNow: async () => true,
  });
  assert.equal(okC, true);
  assert.deepEqual(toastsC, [["2 gambar tidak ikut dibagikan.", "error"]]);
});

test("noteSharePushNow: true only when push completed and no outbox op remains for the note", async () => {
  const mk = (pushRes, ops, fresh, raw) => {
    const win = { __pushNow: async () => { if (pushRes instanceof Error) throw pushRes; return pushRes; }, TF: {
      outbox: { outboxAll: async () => ops },
      noterepo: { getNoteRaw: async cid => (raw !== undefined ? raw : { cid, dirty: 0 }) },
    } };
    const apiStub = { get: async () => fresh };
    return new Function("window", "api", src("noteSharePushNow") + "\nreturn noteSharePushNow;")(win, apiStub);
  };
  assert.equal(await mk({ pushed: 1, failed: 0, remaining: 0 }, [], { id: 1, cid: "n1" })(1), true);
  assert.equal(await mk({ pushed: 0, failed: 0, remaining: 1 }, [{ entity_type: "note", cid: "n1" }], { id: 1, cid: "n1" })(1), false);
  assert.equal(await mk({ pushed: 0, failed: 0, remaining: 1 }, [{ entity_type: "drawing", cid: "n1" }, { entity_type: "note", cid: "zz" }], { id: 1, cid: "n1" })(1), true);
  assert.equal(await mk({ busy: true }, [], { id: 1, cid: "n1" })(1), false);
  assert.equal(await mk(null, [], { id: 1, cid: "n1" })(1), false);
  assert.equal(await mk(new Error("Failed to fetch"), [], { id: 1, cid: "n1" })(1), false);
  // syncpush membuang op saat gagal permanen / REV_MISMATCH / 403 → outbox kosong tapi tetap gagal
  assert.equal(await mk({ pushed: 0, failed: 1, remaining: 0 }, [], { id: 1, cid: "n1" })(1), false);
  assert.equal(await mk({ pushed: 1, failed: 0, remaining: 0, conflictCopies: 1 }, [], { id: 1, cid: "n1" })(1), false);
  // record lokal: sync_error / dirty / conflict / tak terbaca → gagal
  assert.equal(await mk({ pushed: 1, failed: 0 }, [], { id: 1, cid: "n1" }, { cid: "n1", sync_error: "x" })(1), false);
  assert.equal(await mk({ pushed: 1, failed: 0 }, [], { id: 1, cid: "n1" }, { cid: "n1", dirty: 1 })(1), false);
  assert.equal(await mk({ pushed: 1, failed: 0 }, [], { id: 1, cid: "n1" }, { cid: "n1", conflict: true })(1), false);
  assert.equal(await mk({ pushed: 1, failed: 0 }, [], { id: 1, cid: "n1" }, null)(1), false);
  assert.equal(await mk({ pushed: 1, failed: 0 }, [], null)(1), false);
});

test("push gate failure ({failed:1}, sync_error, unreadable record) → no PATCH, toast", async () => {
  const gate = new Function("window", "api", src("noteSharePushNow") + "\nreturn noteSharePushNow;");
  const cases = [
    [{ pushed: 0, failed: 1, remaining: 0 }, { id: 1, cid: "n1" }, { cid: "n1" }],
    [{ pushed: 1, failed: 0 }, { id: 1, cid: "n1" }, { cid: "n1", sync_error: "rev mismatch" }],
    [{ pushed: 1, failed: 0 }, null, null],
  ];
  for (const [pushRes, fresh, raw] of cases) {
    const { TF, calls } = mkTF();
    const api = mkApi(calls, { get: async () => fresh });
    const win = { __pushNow: async () => pushRes, TF: { outbox: { outboxAll: async () => [] }, noterepo: { getNoteRaw: async () => raw } } };
    const toasts = [];
    const ok = await H.confirmNoteShareWithDrawings({
      note: { id: 1 }, content: "::draw[11]", targetListId: 5, listName: "Tim A",
      api, TF, showToast: errToasts(toasts), ask: async () => "share", saveContent: async () => {},
      pushNow: gate(win, api),
    });
    assert.equal(ok, false);
    assert.ok(!calls.some(c => c[0] === "patch"));
    assert.deepEqual(toasts, [["Catatan belum tersinkron; coba bagikan lagi sebentar lagi.", "error"]]);
  }
});

test("unshare proceeds when drawings cannot be checked (no pull-back offer); busy toast only with ::draw", async () => {
  const { TF, calls } = mkTF({ listFail: true });
  const asked = [], toasts = [];
  const ok = await H.confirmNoteShareWithDrawings({
    note: { id: 1, list_id: 5 }, content: "::DRAW[41]", targetListId: null, oldListId: 5, oldListName: "Tim A",
    api: mkApi(calls), TF, showToast: (m, t) => toasts.push([m, t]), ask: async s => { asked.push(s); return "yes"; }, saveContent: async () => {},
  });
  assert.equal(ok, true);
  assert.deepEqual(asked, []);
  assert.deepEqual(calls.map(c => c[0]), ["patch", "applyMoved"]);
  assert.deepEqual(toasts, [[BUSY, "info"]]); // isi punya ::DRAW (case-insensitive)

  // tanpa ::draw → tidak ada toast sibuk
  const plain = mkTF();
  const toasts2 = [];
  assert.equal(await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "teks biasa", targetListId: 5, listName: "Tim A",
    api: mkApi(plain.calls, { patch: async () => ({ id: 1, list_id: 5, moved_drawings: [] }) }), TF: plain.TF,
    showToast: (m, t) => toasts2.push([m, t]), ask: async () => "share", saveContent: async () => {}, pushNow: async () => true,
  }), true);
  assert.deepEqual(toasts2, []);
});

test("note unshare offers pulling own drawings back; 409 is reported, not swallowed", async () => {
  const MINE_W = { id: 41, server_id: 41, cid: "c41", title: "Diagram", list_id: 5, user_id: UID };
  const MINE_W2 = { id: 42, server_id: 42, cid: "c42", title: "Flow", list_id: 5, user_id: UID };
  const THEIRS_W = { id: 43, server_id: 43, cid: "c43", title: "Theirs", list_id: 5, user_id: 8 };
  const MINE_OTHER = { id: 44, server_id: 44, cid: "c44", title: "Elsewhere", list_id: 9, user_id: UID };
  const NOT_REF = { id: 45, server_id: 45, cid: "c45", title: "NotRef", list_id: 5, user_id: UID };
  const content = "::draw[41] ::draw[C42] ::draw[43] ::draw[44] ::draw[41]";
  const { TF, calls } = mkTF({
    list: [MINE_W, MINE_W2, THEIRS_W, MINE_OTHER, NOT_REF],
    share: {
      shareDrawing: async (api, d, listId) => {
        calls.push(["shareDrawing", d.server_id, listId]);
        if (d.server_id === 41) return { ok: false, code: "DRAWING_IN_USE", notes: [{ id: 3, title: "N" }], hidden_count: 0 };
        return { ok: false, code: "ERROR", message: "Gagal total" };
      },
    },
  });
  const api = mkApi(calls);
  const asked = [];
  const toasts = [];
  const ok = await H.confirmNoteShareWithDrawings({
    note: { id: 1, list_id: 5 }, content, targetListId: null, listName: null, oldListId: 5, oldListName: "Tim A",
    api, TF, showToast: errToasts(toasts),
    ask: async spec => { asked.push(spec); return "yes"; }, saveContent: async () => {},
  });
  assert.equal(ok, true);
  assert.deepEqual(calls[0].slice(0, 3), ["patch", "/api/scratchpad/1/share", { list_id: null }]);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].title, "Tarik kembali ke pribadi?");
  assert.deepEqual(asked[0].sections[0].items, ["Diagram", "Flow"]);
  assert.deepEqual(asked[0].actions.map(a => a.label), ["Tidak", "Ya"]);
  assert.deepEqual(calls.filter(c => c[0] === "shareDrawing"), [["shareDrawing", 41, null], ["shareDrawing", 42, null]]);
  assert.deepEqual(toasts, [
    ["\"Diagram\" masih dipakai note lain di Tim A.", "error"],
    ["Gagal total", "error"],
  ]);

  // "Tidak" → tidak ada shareDrawing
  const t2 = mkTF({ list: [MINE_W] });
  const ok2 = await H.confirmNoteShareWithDrawings({
    note: { id: 1, list_id: 5 }, content: "::draw[41]", targetListId: null, oldListId: 5, oldListName: "Tim A",
    api: mkApi(t2.calls), TF: t2.TF, showToast: () => {}, ask: async () => "no", saveContent: async () => {},
  });
  assert.equal(ok2, true);
  assert.deepEqual(t2.calls.map(c => c[0]), ["patch", "applyMoved"]);

  // Unshare gagal → toast, tidak menawarkan tarik kembali
  const t3 = mkTF({ list: [MINE_W] });
  const toasts3 = [];
  const asked3 = [];
  const ok3 = await H.confirmNoteShareWithDrawings({
    note: { id: 1, list_id: 5 }, content: "::draw[41]", targetListId: null, oldListId: 5, oldListName: "Tim A",
    api: mkApi(t3.calls, { patch: async () => { throw new Error("Failed to fetch"); } }), TF: t3.TF,
    showToast: errToasts(toasts3), ask: async s => { asked3.push(s); return "yes"; }, saveContent: async () => {},
  });
  assert.equal(ok3, false);
  assert.deepEqual(asked3, []);
  assert.deepEqual(toasts3, [["Failed to fetch", "error"]]);
});

test("leave workspace fetches leave-impact and offers copy-then-leave", async () => {
  const items = [
    { note_id: 101, note_title: "Catatan A", drawing_id: 41, drawing_client_id: "c41", drawing_title: "Diagram" },
    { note_id: 102, note_title: "Catatan B", drawing_id: 41, drawing_client_id: "c41", drawing_title: "Diagram" },
    { note_id: 101, note_title: "Catatan A", drawing_id: 42, drawing_client_id: null, drawing_title: "Flow" },
  ];
  const notes = {
    101: { id: 101, title: "Catatan A", content: "x ::draw[c41] y ::draw[42]{size=\"s\"}" },
    102: { id: 102, title: "Catatan B", content: "::draw[41]" },
  };
  const run = async (choice, over = {}) => {
    const { TF, calls } = mkTF({
      share: {
        copyDrawing: async (api, d, listId) => {
          calls.push(["copy", d.server_id, listId]);
          if (over.copyFail) return { ok: false, code: "ERROR", message: "Salin gagal" };
          if (over.secondFail && d.server_id === 42) return { ok: false, code: "ERROR", message: "Salin gagal" };
          return { ok: true, drawing: d.server_id === 41 ? { id: 501, server_id: 501, client_id: "n41" } : { id: 502, server_id: 502, client_id: null } };
        },
      },
    });
    const api = mkApi(calls, {
      get: async url => {
        if (url === "/api/lists/5/leave-impact") { if (over.impactFail) throw new Error("Failed to fetch"); return { items: over.empty ? [] : items }; }
        const m = url.match(/^\/api\/scratchpad\/(\d+)$/);
        return m ? Object.assign({}, notes[m[1]]) : null;
      },
    });
    const asked = [], toasts = [], confirms = [];
    const ok = await H.leaveWorkspaceWithDrawings({
      listId: 5, listName: "Tim A", api, TF, ask: async s => { asked.push(s); return choice; },
      showToast: (m, t) => toasts.push([m, t]), confirmFn: msg => { confirms.push(msg); return over.confirm !== false; },
    });
    return { ok, calls, asked, toasts, confirms };
  };

  // Salin ke pribadi lalu keluar
  let r = await run("copy");
  assert.equal(r.ok, true);
  assert.equal(r.asked.length, 1);
  const spec = r.asked[0];
  assert.deepEqual(spec.sections.map(s => s.items), [["Catatan A", "Catatan B"], ["Diagram", "Flow"]]);
  assert.deepEqual(spec.actions.map(a => a.label), ["Batal", "Keluar saja", "Salin ke pribadi lalu keluar"]);
  assert.deepEqual(r.calls[0], ["get", "/api/lists/5/leave-impact"]);
  assert.deepEqual(r.calls.filter(c => c[0] === "copy"), [["copy", 41, null], ["copy", 42, null]]);
  const puts = r.calls.filter(c => c[0] === "put");
  assert.deepEqual(puts.map(p => p[1]), ["/api/scratchpad/101", "/api/scratchpad/102"]);
  assert.equal(puts[0][2].content, "x ::draw[n41] y ::draw[502]{size=\"s\"}");
  assert.equal(puts[1][2].content, "::draw[n41]");
  const kinds = r.calls.map(c => c[0]);
  assert.equal(kinds[kinds.length - 1], "del");
  assert.ok(kinds.lastIndexOf("put") < kinds.indexOf("del"));
  assert.deepEqual(r.calls[r.calls.length - 1], ["del", "/api/lists/5/leave"]);
  assert.deepEqual(r.confirms, []);

  // Keluar saja → tanpa salin/PUT
  r = await run("leave");
  assert.equal(r.ok, true);
  assert.deepEqual(r.calls.map(c => c[0]), ["get", "del"]);

  // Batal → tidak keluar
  r = await run(null);
  assert.equal(r.ok, false);
  assert.deepEqual(r.calls.map(c => c[0]), ["get"]);

  // Salin gagal → toast, tidak keluar
  r = await run("copy", { copyFail: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.toasts, [["Salin gagal", "error"]]);
  assert.ok(!r.calls.some(c => c[0] === "del" || c[0] === "put"));

  // Salinan ke-2 gagal → toast menyebut jumlah salinan yang sudah dibuat, tidak keluar
  r = await run("copy", { secondFail: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.toasts, [["Gagal menyalin gambar (1 salinan sudah dibuat).", "error"]]);
  assert.ok(!r.calls.some(c => c[0] === "del" || c[0] === "put"));

  // leave-impact gagal → confirm biasa
  r = await run("copy", { impactFail: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.confirms, ["Keluar dari list \"Tim A\"?"]);
  assert.deepEqual(r.asked, []);
  assert.deepEqual(r.calls.map(c => c[0]), ["get", "del"]);
  r = await run("copy", { impactFail: true, confirm: false });
  assert.equal(r.ok, false);
  assert.deepEqual(r.calls.map(c => c[0]), ["get"]);

  // items kosong → confirm biasa
  r = await run("copy", { empty: true });
  assert.equal(r.ok, true);
  assert.equal(r.confirms.length, 1);
  assert.deepEqual(r.asked, []);
});

test("NoteModal, NotePanel and SharedListsManager use the shared helpers and dialog", () => {
  const modal = (html.match(/const handleModalShare = async listId => \{[\s\S]*?\n  \};/) || [""])[0];
  const panelSrc = html.slice(html.indexOf("\nfunction NotePanel("));
  const panel = (panelSrc.match(/const handleShare = async listId => \{\n    setShareOpen\(false\);[\s\S]*?\n  \};/) || [""])[0];
  const leave = (html.match(/const handleLeave = async \(listId, listName\) => \{[\s\S]*?\n  \};/) || [""])[0];
  for (const [name, b] of [["NoteModal", modal], ["NotePanel", panel]]) {
    assert.match(b, /confirmNoteShareWithDrawings\(\{/, name);
    assert.doesNotMatch(b, /\/\* silent/, name);
  }
  assert.match(leave, /leaveWorkspaceWithDrawings\(\{/);
  assert.equal((html.match(/^function DrawingScopeDialog\(/gm) || []).length, 1);
  assert.equal((html.match(/^function useDrawingScopeDialog\(/gm) || []).length, 1);
  assert.equal((html.match(/^async function confirmNoteShareWithDrawings\(/gm) || []).length, 1);
  assert.ok((html.match(/useDrawingScopeDialog\(\)/g) || []).length >= 3);
});

test("share to W with no local plan still flushes and gates on push; push failure aborts before PATCH", async () => {
  // plan kosong (tanpa ::draw sama sekali)
  const a = mkTF();
  const flushed = [];
  const okA = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "teks biasa", targetListId: 5, listName: "Tim A",
    api: mkApi(a.calls, { patch: async () => ({ id: 1, list_id: 5, moved_drawings: [] }) }), TF: a.TF, showToast: () => {}, ask: async () => "share",
    saveContent: async t => { a.calls.push(["flush"]); flushed.push(t("isi terkini")); }, pushNow: async id => { a.calls.push(["push", id]); return true; },
  });
  assert.equal(okA, true);
  assert.deepEqual(a.calls.map(c => c[0]), ["flush", "push", "patch", "applyMoved"]);
  assert.deepEqual(flushed, ["isi terkini"]); // transform identitas
  // TF.drawingshare tidak ada (plan null) → tetap flush + push
  const b = mkTF();
  delete b.TF.drawingshare;
  const okB = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "::draw[11]", targetListId: 5, listName: "Tim A",
    api: mkApi(b.calls), TF: b.TF, showToast: () => {}, ask: async () => "share",
    saveContent: async () => b.calls.push(["flush"]), pushNow: async () => { b.calls.push(["push"]); return true; },
  });
  assert.equal(okB, true);
  assert.deepEqual(b.calls.map(c => c[0]), ["flush", "push", "patch"]);
  // gerbang gagal → tidak ada PATCH, toast yang sama
  const c = mkTF();
  const toasts = [];
  const okC = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "teks biasa", targetListId: 5, listName: "Tim A",
    api: mkApi(c.calls), TF: c.TF, showToast: errToasts(toasts), ask: async () => "share",
    saveContent: async () => c.calls.push(["flush"]), pushNow: async () => { c.calls.push(["push"]); return false; },
  });
  assert.equal(okC, false);
  assert.deepEqual(c.calls.map(c2 => c2[0]), ["flush", "push"]);
  assert.deepEqual(toasts, [["Catatan belum tersinkron; coba bagikan lagi sebentar lagi.", "error"]]);
  // unshare tetap PATCH langsung (tanpa flush/push)
  const d = mkTF();
  const okD = await H.confirmNoteShareWithDrawings({
    note: { id: 1, list_id: 5 }, content: "teks", targetListId: null, oldListId: 5, oldListName: "Tim A",
    api: mkApi(d.calls), TF: d.TF, showToast: () => {}, ask: async () => "no",
    saveContent: async () => d.calls.push(["flush"]), pushNow: async () => { d.calls.push(["push"]); return true; },
  });
  assert.equal(okD, true);
  assert.deepEqual(d.calls.map(c2 => c2[0]), ["patch", "applyMoved"]);
});

test("moved_drawings beyond plan.move are toasted with their count", async () => {
  // plan kosong, server memindahkan 2 gambar dari isinya sendiri
  const a = mkTF();
  const toasts = [];
  const okA = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "teks", targetListId: 5, listName: "Tim A",
    api: mkApi(a.calls, { patch: async () => ({ id: 1, list_id: 5, moved_drawings: [{ id: 61, list_id: 5 }, { id: 62, client_id: "k62", list_id: 5 }] }) }),
    TF: a.TF, showToast: (m, t) => toasts.push([m, t]), ask: async () => "share", saveContent: async () => {}, pushNow: async () => true,
  });
  assert.equal(okA, true);
  assert.deepEqual(toasts, [["2 gambar ikut dibagikan ke Tim A.", "info"]]);

  // plan.move = [MINE (11)] dan server memindahkan 11 (via client_id) + 1 tambahan → n = 1
  const b = mkTF({ list: [Object.assign({}, MINE, { client_id: "cl-mine" })] });
  const toastsB = [];
  const okB = await H.confirmNoteShareWithDrawings({
    note: { id: 1 }, content: "::draw[11]", targetListId: 5, listName: "Tim A",
    api: mkApi(b.calls, { patch: async () => ({ id: 1, list_id: 5, moved_drawings: [{ id: 999, client_id: "CL-MINE", list_id: 5 }, { id: 70, list_id: 5 }] }) }),
    TF: b.TF, showToast: (m, t) => toastsB.push([m, t]), ask: async () => "share", saveContent: async () => {}, pushNow: async () => true,
  });
  assert.equal(okB, true);
  assert.deepEqual(toastsB.filter(t => t[1] !== "info" || /ikut dibagikan/.test(t[0])), [["1 gambar ikut dibagikan ke Tim A.", "info"]]);

  // baris server di plan.move tanpa server_id (id saja) dicocokkan lewat serverIdOf
  assert.equal(H.noteShareUnexpectedMoved(realShare, [{ id: 22 }], [{ id: 22, client_id: null, list_id: null }]), 0);
  assert.equal(H.noteShareUnexpectedMoved(realShare, undefined, []), 0);
});

test("prepareNoteShare: stalled listDrawings times out into the {error:true} path", async () => {
  const TF = {
    drawingshare: realShare, drawdirective,
    drawingrepo: { listDrawings: () => new Promise(() => {}), currentUid: () => UID },
  };
  const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a);
  try {
    const t0 = Date.now();
    const r = await H.prepareNoteShare(TF, "::draw[11]", 5, null, 30);
    assert.deepEqual(r, { error: true });
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(warns.length, 1);
  } finally { console.warn = ow; }
  // default 6 detik
  assert.match(html, /^const NOTE_SHARE_LIST_TIMEOUT_MS = 6000;$/m);
});
