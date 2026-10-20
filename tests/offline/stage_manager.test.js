"use strict";
// Kanban tahap kustom (frontend) Task 7 — kelola tahap: helper top-level (di-slice dari index.html) dan
// pemeriksaan sumber (kolom "+ Tahap", menu kolom, modal "Kelola tahap", urutan posisi mode daftar).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8").replace(/\r\n/g, "\n");

function sliceFn(startMarker, endMarker) {
  const start = indexHtml.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} harus ada`);
  const end = indexHtml.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} harus ada setelah ${startMarker}`);
  return indexHtml.slice(start, end);
}

const HELPERS_SRC = () => sliceFn("// ═══ Kelola tahap", "\nfunction StageManagerModal(");
const PROJECT_COLOR_SRC = () => sliceFn("function projectColorValid(", "\n}") + "\n}";

function loadHelpers(env) {
  const e = env || {};
  const win = e.window || {};
  const nav = e.navigator || { onLine: true };
  const isOfflineErr = e.isOfflineErr || ((err) => !!err && err.message === "OFFLINE");
  const api = e.api || {};
  const CE = e.CustomEvent || function CE(type, init) { this.type = type; this.detail = init && init.detail; };
  return new Function("window", "navigator", "isOfflineErr", "api", "CustomEvent",
    `${PROJECT_COLOR_SRC()}\n${HELPERS_SRC()}; return { stageManagerUrl, stageMenuActions, stageActionDisabled, stageDeleteConfirmText, stageErrorText, stageAfterChange, stageRun, stagePatchChangesTasks, STAGE_OFFLINE_TEXT };`)(
    win, nav, isOfflineErr, api, CE);
}

test("stageManagerUrl: full + arsip, list_id bila ada", () => {
  const { stageManagerUrl } = loadHelpers();
  assert.equal(stageManagerUrl(null), "/api/contexts?format=full&include_archived=1");
  assert.equal(stageManagerUrl(""), "/api/contexts?format=full&include_archived=1");
  assert.equal(stageManagerUrl(undefined), "/api/contexts?format=full&include_archived=1");
  assert.equal(stageManagerUrl(7), "/api/contexts?format=full&include_archived=1&list_id=7");
  assert.equal(stageManagerUrl("a b"), "/api/contexts?format=full&include_archived=1&list_id=a%20b");
});

test("stageMenuActions: pending / bukan can_manage → kosong; selain itu enam aksi", () => {
  const { stageMenuActions } = loadHelpers();
  const all = ["rename", "color", "left", "right", "archive", "delete"];
  assert.deepEqual(stageMenuActions({ id: 1, can_manage: true }, true), all);
  assert.deepEqual(stageMenuActions({ id: 1, can_manage: true }, false), all);
  assert.deepEqual(stageMenuActions({ id: 1, can_manage: true, pending: true }, true), []);
  assert.deepEqual(stageMenuActions({ id: 1, can_manage: true, pending: 1 }, true), []);
  assert.deepEqual(stageMenuActions({ id: 1, can_manage: false }, true), []);
  assert.deepEqual(stageMenuActions({ id: 1 }, true), []);
  assert.deepEqual(stageMenuActions(null, true), []);
});

test("stageActionDisabled: nonaktif hanya saat offline", () => {
  const { stageActionDisabled } = loadHelpers();
  for (const a of ["rename", "color", "left", "right", "archive", "delete"]) {
    assert.equal(stageActionDisabled(a, true), false);
    assert.equal(stageActionDisabled(a, false), true);
  }
});

test("stageDeleteConfirmText: teks persis, 0 tetap tampil", () => {
  const { stageDeleteConfirmText } = loadHelpers();
  assert.equal(stageDeleteConfirmText({ task_count: 5 }), "5 task akan pindah ke Belum ada tahap");
  assert.equal(stageDeleteConfirmText({ task_count: 0 }), "0 task akan pindah ke Belum ada tahap");
  assert.equal(stageDeleteConfirmText({}), "0 task akan pindah ke Belum ada tahap");
  assert.equal(stageDeleteConfirmText(null), "0 task akan pindah ke Belum ada tahap");
});

test("stageErrorText: kode terstruktur, 404, offline, pesan", () => {
  const { stageErrorText } = loadHelpers();
  const withCode = (code, message, status) => Object.assign(new Error("Request failed"), { status: status || 409, body: { detail: { code, message } } });
  assert.equal(stageErrorText(withCode("CONTEXT_NAME_TAKEN", "x")), "Nama tahap sudah dipakai");
  assert.equal(stageErrorText(withCode("CONTEXT_ORDER_STALE", "x")), "Urutan tahap sudah berubah, muat ulang");
  assert.equal(stageErrorText(Object.assign(new Error("Not found"), { status: 404 })), "Tahap sudah tidak ada");
  assert.equal(stageErrorText(new Error("OFFLINE")), "Butuh koneksi internet");
  assert.equal(stageErrorText(withCode("OTHER", "Pesan server", 400)), "Pesan server");
  assert.equal(stageErrorText(new Error("boom")), "boom");
  assert.equal(stageErrorText(Object.assign(new Error("teks"), { body: { detail: "string" } })), "teks");
});

test("stageAfterChange: segarkan cache lalu tf:contexts-changed; tasksChanged → sync + refresh task", async () => {
  const calls = [];
  const events = [];
  const win = {
    TF: { contextcache: { refresh: (raw) => { calls.push(["refresh", raw]); return Promise.resolve(); } } },
    __syncRawFetch: () => "raw",
    __syncNow: () => { calls.push(["syncNow"]); return Promise.resolve(); },
    __refreshTasks: () => { calls.push(["refreshTasks"]); return Promise.resolve(); },
    dispatchEvent: (ev) => { events.push(ev); calls.push(["event", ev.type]); },
  };
  const { stageAfterChange } = loadHelpers({ window: win });
  await stageAfterChange(false);
  assert.deepEqual(calls.map((c) => c[0]), ["refresh", "event"]);
  assert.equal(calls[0][1], win.__syncRawFetch);
  assert.equal(events[0].type, "tf:contexts-changed");
  assert.equal(events[0].detail.source, "manage");
  calls.length = 0;
  await stageAfterChange(true);
  assert.deepEqual(calls.map((c) => c[0]), ["refresh", "event", "syncNow", "refreshTasks"]);
});

test("stageAfterChange: refresh gagal / modul tidak ada tetap memancarkan event; refreshTasks melempar tidak menggagalkan", async () => {
  const events = [];
  const win = {
    TF: { contextcache: { refresh: () => Promise.reject(new Error("net")) } },
    __syncRawFetch: () => {},
    __syncNow: () => Promise.reject(new Error("x")),
    __refreshTasks: () => { throw new Error("y"); },
    dispatchEvent: (ev) => events.push(ev.type),
  };
  await loadHelpers({ window: win }).stageAfterChange(true);
  assert.deepEqual(events, ["tf:contexts-changed"]);
  const events2 = [];
  await loadHelpers({ window: { dispatchEvent: (ev) => events2.push(ev.type) } }).stageAfterChange(false);
  assert.deepEqual(events2, ["tf:contexts-changed"]);
});

test("stageRun: offline → ditolak tanpa memanggil fn; sukses → stageAfterChange; stale → refresh", async () => {
  const events = [];
  const win = {
    TF: { contextcache: { refresh: () => Promise.resolve() } },
    __syncRawFetch: () => {},
    dispatchEvent: (ev) => events.push(ev.type),
  };
  let called = 0;
  const off = loadHelpers({ window: win, navigator: { onLine: false } });
  const r0 = await off.stageRun(() => { called++; });
  assert.equal(r0.ok, false);
  assert.equal(r0.message, "Butuh koneksi internet");
  assert.equal(called, 0);
  assert.deepEqual(events, []);

  const on = loadHelpers({ window: win });
  const r1 = await on.stageRun(() => { called++; return Promise.resolve({}); });
  assert.equal(r1.ok, true);
  assert.equal(called, 1);
  assert.deepEqual(events, ["tf:contexts-changed"]);

  events.length = 0;
  const stale = Object.assign(new Error("x"), { status: 409, body: { detail: { code: "CONTEXT_ORDER_STALE", message: "m" } } });
  const r2 = await on.stageRun(() => Promise.reject(stale));
  assert.equal(r2.ok, false);
  assert.equal(r2.message, "Urutan tahap sudah berubah, muat ulang");
  assert.deepEqual(events, ["tf:contexts-changed"], "409 stale → muat ulang daftar tahap");

  events.length = 0;
  const r3 = await on.stageRun(() => Promise.reject(Object.assign(new Error("Not found"), { status: 404 })));
  assert.equal(r3.message, "Tahap sudah tidak ada");
  assert.deepEqual(events, []);
});

test("sumber: StageManagerModal — dialog 'Kelola tahap', {network:true}, ↑/↓, Escape, offline", () => {
  const modal = sliceFn("function StageManagerModal(", "\nfunction ");
  assert.match(modal, /role: "dialog"/);
  assert.match(modal, /"aria-label": "Kelola tahap"/);
  assert.match(modal, /api\.get\(stageManagerUrl\(listId\), \{ network: true \}\)/);
  assert.match(modal, /e\.key !== "Escape"/);
  assert.match(modal, /STAGE_OFFLINE_TEXT/);
  assert.match(modal, /reorderIds\(/);
  assert.match(modal, /\/api\/contexts\/order/);
  assert.match(modal, /"↑"/);
  assert.match(modal, /"↓"/);
  assert.match(modal, /" \(diarsip\)"|Diarsipkan/);
  assert.match(modal, /stageDeleteConfirmText\(/);
  assert.match(modal, /stageMenuActions\(/);
  assert.match(modal, /projectColorValid\(/);
  assert.doesNotMatch(modal, /function projectColorValid/);
  assert.doesNotMatch(indexHtml.slice(indexHtml.indexOf("// ═══ Kelola tahap")), /function projectColorValid/);
});

test("sumber: tombol 'Kelola tahap' di header workspace, tanpa mengubah blok yang dipatok", () => {
  const ws = sliceFn('if (page.startsWith("slist_")) {\n      const listId = parseInt(page.slice(6));\n      const currentList', "TaskListView");
  assert.match(ws, /setProjectManager\(\{ listId: listId/);
  assert.match(ws, /"Kelola project"/);
  assert.match(ws, /"Kelola tahap"/);
  assert.match(ws, /setStageManager\(\{ listId: listId/);
  assert.match(indexHtml, /React\.createElement\(StageManagerModal, \{/);
  const uses = indexHtml.split("React.createElement(TaskListView, {").slice(1).map((s) => s.slice(0, 900));
  assert.equal(uses.length, 2);
  for (const u of uses) assert.match(u, /sharedLists: sharedLists/);
});

test("sumber: '+ Tahap' hanya Group by Context dan tanpa data-kanban-col (bukan target drop)", () => {
  const view = sliceFn("function KanbanView(", "\nfunction ");
  assert.match(view, /"\+ Tahap"/);
  assert.match(view, /groupBy === "context"/);
  assert.doesNotMatch(view, /data-kanban-col"/);
  assert.match(view, /api\.post\("\/api\/contexts"|onCreateStage/);
  const tlv = sliceFn("function TaskListView(", "\nfunction ");
  // POST + reaksi nama yang sudah ada ada di helper stageCreate (dites perilakunya di bawah)
  assert.match(tlv, /stageCreate\(name, kanbanScope \|\| null, stageToast\)/);
  assert.match(HELPERS_SRC(), /api\.post\("\/api\/contexts", \{ name: [^}]*list_id: [^}]*\|\| null \}\)/);
  assert.match(HELPERS_SRC(), /tf:contexts-changed/);
  assert.match(tlv, /"Kelola tahap"/);
  assert.match(tlv, /onManageStages/);
});

test("sumber: menu '⋯' kolom tahap, Butuh koneksi internet, reorderIds → PUT order", () => {
  const col = sliceFn("function KanbanColumn(", "\nfunction ");
  assert.match(col, /stageMenuActions\(/);
  assert.match(col, /stageActionDisabled\(/);
  assert.match(col, /"⋯"/);
  assert.match(col, /type: "color"/);
  assert.match(col, /projectColorValid\(/);
  assert.match(col, /Butuh koneksi internet|STAGE_OFFLINE_TEXT/);
  const tlv = sliceFn("function TaskListView(", "\nfunction ");
  assert.match(tlv, /TF\.kanbanboard\.reorderIds\(/);
  assert.match(tlv, /api\.put\("\/api\/contexts\/order", \{ list_id: /);
  assert.match(tlv, /"\/api\/contexts\/" \+ encodeURIComponent\(item\.id\)/);
  assert.match(tlv, /api\.patch\(stageUrl\(item\)/);
  assert.match(tlv, /api\.del\(stageUrl\(item\)/);
});

test("sumber: Group by Context mode daftar memakai urutan posisi, bukan normalKeys.sort() untuk context", () => {
  const tlv = sliceFn("function TaskListView(", "\nfunction ");
  const tail = tlv.slice(tlv.indexOf("const allKeys = Object.keys(map);"));
  const sortLine = tail.slice(0, tail.indexOf("return [...normalKeys"));
  assert.match(sortLine, /groupBy === "context"/);
  assert.match(sortLine, /contextItems/);
  // fallback alfabetis hanya untuk grup lain (tag) / nama yang tidak punya item
  assert.match(sortLine, /else normalKeys\.sort\(\)/);
  assert.doesNotMatch(sortLine, /^\s*normalKeys\.sort\(\)/);
});

test("contextKeyOrder (urutan posisi mode daftar): nama item dulu (pribadi per posisi, lalu workspace), sisanya alfabet", () => {
  const src = sliceFn("function contextKeyOrder(", "\n}") + "\n}";
  const ctxcache = require("../../static/offline/contextcache.js");
  const projcache = require("../../static/offline/projectcache.js");
  const fn = new Function("window", `${src}; return contextKeyOrder;`)({ TF: { contextcache: ctxcache, projectcache: projcache } });
  const items = [
    { id: 1, name: "Doing", list_id: null, position: 2, archived: false },
    { id: 2, name: "Todo", list_id: null, position: 1, archived: false },
    { id: 3, name: "WS", list_id: 9, position: 0, archived: false },
    { id: 4, name: "Lama", list_id: null, position: 3, archived: true },
  ];
  const keys = ["Zeta", "doing", "Alpha", "Todo", "WS"];
  assert.deepEqual(fn(keys, items), ["Todo", "doing", "WS", "Alpha", "Zeta"]);
  assert.deepEqual(fn(["b", "A"], []), ["A", "b"]);
});

test("stagePatchChangesTasks: hanya bila body memuat name", () => {
  const { stagePatchChangesTasks } = loadHelpers();
  assert.equal(stagePatchChangesTasks({ name: "x" }), true);
  assert.equal(stagePatchChangesTasks({ name: "x", color: "#aaaaaa" }), true);
  assert.equal(stagePatchChangesTasks({ color: "#aaaaaa" }), false);
  assert.equal(stagePatchChangesTasks({ archived: true }), false);
  assert.equal(stagePatchChangesTasks(null), false);
});

test("sumber: modal dan papan memakai stagePatchChangesTasks; input nama maxLength 50; contexts dimuat ulang", () => {
  const modal = sliceFn("function StageManagerModal(", "\nfunction ");
  const tlv = sliceFn("function TaskListView(", "\nfunction ");
  assert.match(modal, /"Tahap disimpan", stagePatchChangesTasks\(body\)/);
  assert.match(tlv, /"Tahap disimpan", stagePatchChangesTasks\(body\)/);
  assert.equal((modal.match(/maxLength: 50/g) || []).length, 1);
  assert.match(sliceFn("function KanbanView(", "\nfunction "), /maxLength: 50/);
  assert.match(sliceFn("function KanbanColumn(", "\nfunction "), /maxLength: 50/);
  const reload = sliceFn("const reloadContextItems = ", "\n    };");
  assert.match(reload, /api\.get\("\/api\/contexts"\)/);
  assert.match(reload, /setContexts\(/);
  assert.match(tlv, /contextKeyOrder\(normalKeys, contextItems, page\)/);
});

test("stageErrorText: 422 / detail array → batas 50 karakter", () => {
  const { stageErrorText } = loadHelpers();
  assert.equal(stageErrorText(Object.assign(new Error("x"), { status: 422, body: { detail: [{ msg: "too long" }] } })), "Nama tahap maksimal 50 karakter");
  assert.equal(stageErrorText(Object.assign(new Error("x"), { status: 422 })), "Nama tahap maksimal 50 karakter");
  assert.equal(stageErrorText(Object.assign(new Error("x"), { body: { detail: [{ msg: "m" }] } })), "Nama tahap maksimal 50 karakter");
});

test("contextKeyOrder: scope halaman — slist_W pakai posisi W; selain itu pribadi dulu, workspace urut numerik", () => {
  const src = sliceFn("function contextKeyOrder(", "\n}") + "\n}";
  const ctxcache = require("../../static/offline/contextcache.js");
  const projcache = require("../../static/offline/projectcache.js");
  const fn = new Function("window", `${src}; return contextKeyOrder;`)({ TF: { contextcache: ctxcache, projectcache: projcache } });
  const items = [
    { id: 1, name: "Todo", list_id: null, position: 5 },
    { id: 2, name: "Review", list_id: null, position: 6 },
    { id: 3, name: "Todo", list_id: 10, position: 0 },
    { id: 4, name: "Deploy", list_id: 10, position: 1 },
    { id: 5, name: "Review", list_id: 10, position: 2 },
    { id: 6, name: "Qa", list_id: 9, position: 0 },
  ];
  const keys = ["Qa", "Deploy", "Review", "Todo", "Zed"];
  // bukan halaman workspace: nama ganda mengikuti posisi pribadi (Todo 5, Review 6), lalu ws 9 (Qa), lalu ws 10 (Deploy)
  assert.deepEqual(fn(keys, items, "next"), ["Todo", "Review", "Qa", "Deploy", "Zed"]);
  assert.deepEqual(fn(keys, items), ["Todo", "Review", "Qa", "Deploy", "Zed"]);
  // slist_10: hanya posisi workspace 10; Qa tidak punya tahap di W → alfabet di belakang
  assert.deepEqual(fn(keys, items, "slist_10"), ["Todo", "Deploy", "Review", "Qa", "Zed"]);
});

// ── final review: "+ Tahap" dengan nama yang sudah ada (aktif / pending / diarsip) ─────────────
function loadCreate(env) {
  const e = env || {};
  const nav = e.navigator || { onLine: true };
  const CE = function CE(type, init) { this.type = type; this.detail = init && init.detail; };
  return new Function("window", "navigator", "isOfflineErr", "api", "CustomEvent",
    `${PROJECT_COLOR_SRC()}\n${HELPERS_SRC()}; return { stageCreate };`)(
    e.window, nav, (err) => !!err && err.message === "OFFLINE", e.api, CE);
}
function createEnv(postResult, opts) {
  const o = opts || {};
  const calls = [];
  const win = {
    TF: { contextcache: { refresh: () => { calls.push(["refresh"]); return Promise.resolve(); } } },
    __syncRawFetch: () => {},
    dispatchEvent: (ev) => { calls.push(["event", ev.type, ev.detail && ev.detail.source]); },
  };
  const api = {
    post: (url, body) => { calls.push(["post", url, body]); return postResult instanceof Error ? Promise.reject(postResult) : Promise.resolve(postResult); },
    patch: (url, body) => { calls.push(["patch", url, body]); return o.patchError ? Promise.reject(o.patchError) : Promise.resolve({}); },
  };
  const toast = (msg, type) => { calls.push(["toast", msg, type]); };
  const H = loadCreate({ window: win, api, navigator: { onLine: o.online !== false } });
  return { calls, toast, stageCreate: H.stageCreate };
}

test("stageCreate: nama baru → POST lokal + tf:contexts-changed, true; kosong → tanpa request", async () => {
  let env = createEnv({ id: "cid-1", name: "Desain", pending: true, archived: false, created: true });
  assert.equal(await env.stageCreate("  Desain ", null, env.toast), true);
  assert.deepEqual(env.calls, [["post", "/api/contexts", { name: "Desain", list_id: null }], ["event", "tf:contexts-changed", "manage"]]);
  env = createEnv({ id: "cid-2", name: "QA", archived: false, created: true });
  assert.equal(await env.stageCreate("QA", "7", env.toast), true);
  assert.deepEqual(env.calls[0], ["post", "/api/contexts", { name: "QA", list_id: "7" }]);
  // respons server langsung (tanpa router lokal, tanpa flag created) → dianggap dibuat
  env = createEnv({ id: 9, name: "QA", archived: false });
  assert.equal(await env.stageCreate("QA", null, env.toast), true);
  assert.deepEqual(env.calls.map((c) => c[0]), ["post", "event"]);
  env = createEnv({});
  assert.equal(await env.stageCreate("   ", null, env.toast), false);
  assert.deepEqual(env.calls, []);
});

test("stageCreate: nama aktif / pending yang sudah ada → toast \"Tahap sudah ada\", tanpa PATCH", async () => {
  for (const res of [{ id: 5, name: "Aktif", archived: false, created: false }, { id: "cid", name: "P", pending: true, archived: false, created: false }]) {
    const env = createEnv(res);
    assert.equal(await env.stageCreate(res.name, null, env.toast), false);
    assert.deepEqual(env.calls.slice(1), [["toast", "Tahap sudah ada", "info"]]);
  }
});

test("stageCreate: nama diarsip + offline → toast arsip, tanpa PATCH", async () => {
  const env = createEnv({ id: 4, name: "Lama", archived: true, created: false }, { online: false });
  assert.equal(await env.stageCreate("lama", null, env.toast), false);
  assert.deepEqual(env.calls.slice(1), [["toast", "Tahap ada di arsip — aktifkan lewat Kelola tahap (butuh koneksi)", "error"]]);
});

test("stageCreate: nama diarsip + online → PATCH archived:false (jaringan) lalu refresh tahap + toast", async () => {
  let env = createEnv({ id: 4, name: "Lama", archived: true, created: false });
  assert.equal(await env.stageCreate("lama", "7", env.toast), true);
  assert.deepEqual(env.calls, [
    ["post", "/api/contexts", { name: "lama", list_id: "7" }],
    ["patch", "/api/contexts/4", { archived: false }],
    ["refresh"],
    ["event", "tf:contexts-changed", "manage"],
    ["toast", "Tahap diaktifkan", undefined],
  ]);
  // respons server langsung (tanpa flag created) yang diarsip juga diaktifkan
  env = createEnv({ id: 4, name: "Lama", archived: true });
  assert.equal(await env.stageCreate("Lama", null, env.toast), true);
  assert.deepEqual(env.calls.map((c) => c[0]), ["post", "patch", "refresh", "event", "toast"]);
  // PATCH gagal → pesan galat, false
  env = createEnv({ id: 4, name: "Lama", archived: true, created: false }, { patchError: Object.assign(new Error("Not found"), { status: 404 }) });
  assert.equal(await env.stageCreate("Lama", null, env.toast), false);
  assert.deepEqual(env.calls.slice(-1), [["toast", "Tahap sudah tidak ada", "error"]]);
});

test("stageCreate: POST gagal → toast stageErrorText, false", async () => {
  const env = createEnv(new Error("Nama tahap tidak boleh kosong"));
  assert.equal(await env.stageCreate("x", null, env.toast), false);
  assert.deepEqual(env.calls.slice(1), [["toast", "Nama tahap tidak boleh kosong", "error"]]);
});
