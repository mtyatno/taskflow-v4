"use strict";
// Temuan mindmap #2: tombol "+ Tambah link" di kanvas harus memakai LinkPickerModal induk
// (lapisan offline: api.get/api.post lokal-first), bukan picker iframe dengan fetch mentah.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const MO = require("../../static/offline/mindmapoutline.js");

const iframeHtml = fs.readFileSync(path.join(__dirname, "../../static/vendor/mind-elixir/index.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

function slice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start !== -1, startMarker + " harus ada");
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end !== -1, endMarker + " harus ada setelah " + startMarker);
  return src.slice(start, end);
}

test("iframe tidak lagi punya picker sendiri (fetch mentah / tf_token / createAndLink)", () => {
  assert.doesNotMatch(iframeHtml, /createAndLink/);
  assert.doesNotMatch(iframeHtml, /function showLinkPicker/);
  assert.doesNotMatch(iframeHtml, /\/api\/search/);
  assert.doesNotMatch(iframeHtml, /tf_token/);
  assert.doesNotMatch(iframeHtml, /\bfetch\(/);
  assert.doesNotMatch(iframeHtml, /lp-picker-|lp-create-|\.lp-tab\b|lp-result-/);
});

test("tombol '+ Tambah link' mengirim requestLinkPicker ke induk dengan node terpilih", () => {
  const src = slice(iframeHtml, "function renderPanel(", "function removeLinkAtIndex(");
  assert.match(src, /\+ Tambah link/);
  assert.match(src, /requestLinkPicker/);
  const fn = slice(iframeHtml, "function requestLinkPicker(", "\n    }\n");
  assert.match(fn, /\{\s*type:\s*'requestLinkPicker',\s*nodeId:\s*currentNodeId,\s*links:/);
  assert.match(fn, /window\.parent\.postMessage\(msg,\s*window\.location\.origin\)/);
  assert.match(fn, /linkedMode/); // peta tertaut: tanpa fitur link
  // Panel Links dan aksi lainnya tetap ada
  assert.match(src, /'lp-card'/);
  assert.match(src, /removeLinkAtIndex\(idx\)/);
  assert.match(src, /openTask/);
});

test("iframe tetap menangani addLink dari induk (refresh panel + change)", () => {
  const src = slice(iframeHtml, "e.data.type === 'addLink'", "\n      }\n");
  assert.match(src, /e\.data\.nodeId !== currentNodeId/);
  assert.match(src, /renderPanel\(/);
  assert.match(src, /postChange\(\)/);
});

test("induk: requestLinkPicker kanvas memakai link node dari pesan untuk existingLinks", () => {
  const start = indexHtml.indexOf('e.data.type === "requestLinkPicker"');
  assert.ok(start !== -1);
  const src = indexHtml.slice(start, indexHtml.indexOf("\n      }\n", start));
  assert.match(src, /!isLinked/);
  assert.match(src, /setPickerNodeId\(e\.data\.nodeId\)/);
  assert.match(src, /setCurrentNodeLinks\(/);
  assert.match(src, /setShowLinkPicker\(true\)/);
});

test("induk: LinkPickerModal mencari lewat searchLinkTargets (fallback lokal)", () => {
  const src = slice(indexHtml, "function LinkPickerModal(", "const existingSet");
  assert.match(src, /searchLinkTargets/);
  assert.match(src, /api\.get/);
});

test("iframe dimuat dengan ?v= yang dinaikkan", () => {
  const m = indexHtml.match(/mind-elixir\/index\.html\?v=(\d+)/);
  assert.ok(m);
  assert.ok(Number(m[1]) > 142, "versi iframe harus dinaikkan dari 142");
});

// ── fungsi murni ──
const DATA = {
  tasks: [
    { id: 1, title: "Beli Kopi", description: "", priority: "P2", gtd_status: "next", deadline: null, quadrant: "Q2", extra: 1 },
    { id: 2, title: "Rapat", description: "bahas KOPI baru", priority: "P1", gtd_status: "inbox", deadline: "2026-10-20", quadrant: "Q1" },
    { id: 3, title: "Selesai kopi", priority: "P3", gtd_status: "done" },
    { id: 4, title: "Lain", priority: "P4", gtd_status: "next" },
  ],
  notes: [
    { id: 10, title: "Catatan kopi", content: "x".repeat(100), updated_at: "2026-10-18" },
    { id: 11, title: "Resep", content: "pakai Kopi arabika", updated_at: "2026-10-17" },
    { id: 12, title: "Kosong", content: null },
  ],
  mindmaps: [
    { id: 20, title: "Peta KOPI", updated_at: "2026-10-01", data_json: "{}" },
    { id: 21, title: "Peta lain", updated_at: "2026-10-01" },
  ],
};

test("localLinkSearch: filter includes tanpa huruf besar/kecil, bentuk sama dengan /api/search", () => {
  const r = MO.localLinkSearch("kOpI", DATA);
  assert.deepEqual(Object.keys(r).sort(), ["drawings", "mindmaps", "notes", "tags", "tasks"]);
  assert.deepEqual(r.tags, []);
  assert.deepEqual(r.drawings, []);
  assert.deepEqual(r.tasks.map(t => t.id), [1, 2]);
  assert.deepEqual(Object.keys(r.tasks[0]).sort(), ["deadline", "gtd_status", "id", "priority", "quadrant", "title"]);
  assert.deepEqual(r.notes.map(n => n.id), [10, 11]);
  assert.equal(r.notes[0].content, "x".repeat(80) + "…");
  assert.equal(r.notes[1].content, "pakai Kopi arabika");
  assert.deepEqual(r.mindmaps, [{ id: 20, title: "Peta KOPI", updated_at: "2026-10-01" }]);
});

test("localLinkSearch: query kosong → hasil kosong; batas 8 per jenis; input tidak valid aman", () => {
  const empty = MO.localLinkSearch("  ", DATA);
  assert.equal(empty.tasks.length + empty.notes.length + empty.mindmaps.length, 0);
  const many = { tasks: Array.from({ length: 12 }, (_, i) => ({ id: i, title: "a" + i, gtd_status: "next" })) };
  assert.equal(MO.localLinkSearch("a", many).tasks.length, 8);
  const r = MO.localLinkSearch("a", { tasks: null, notes: undefined, mindmaps: "x" });
  assert.deepEqual(r.tasks, []);
});

test("searchLinkTargets: online sukses → hasil /api/search apa adanya", async () => {
  const server = { tags: [], tasks: [{ id: 99, title: "srv" }], notes: [], mindmaps: [], drawings: [] };
  const calls = [];
  const get = url => { calls.push(url); return Promise.resolve(server); };
  const r = await MO.searchLinkTargets("srv x", get);
  assert.equal(r, server);
  assert.deepEqual(calls, ["/api/search?q=srv%20x"]);
});

test("searchLinkTargets: /api/search gagal → fallback lokal via router (tasks/scratchpad/mindmaps)", async () => {
  const calls = [];
  const get = url => {
    calls.push(url);
    if (url.startsWith("/api/search")) return Promise.reject(new TypeError("Failed to fetch"));
    if (url === "/api/tasks") return Promise.resolve(DATA.tasks);
    if (url === "/api/scratchpad") return Promise.resolve(DATA.notes);
    if (url === "/api/mindmaps") return Promise.resolve(DATA.mindmaps);
    return Promise.reject(new Error("404"));
  };
  const r = await MO.searchLinkTargets("kopi", get);
  assert.deepEqual(calls.slice(1).sort(), ["/api/mindmaps", "/api/scratchpad", "/api/tasks"]);
  assert.deepEqual(r.tasks.map(t => t.id), [1, 2]);
  assert.deepEqual(r.notes.map(n => n.id), [10, 11]);
  assert.deepEqual(r.mindmaps.map(m => m.id), [20]);
});

test("searchLinkTargets: sumber lokal yang gagal diabaikan, sisanya tetap", async () => {
  const get = url => {
    if (url === "/api/tasks") return Promise.resolve(DATA.tasks);
    return Promise.reject(new Error("x"));
  };
  const r = await MO.searchLinkTargets("kopi", get);
  assert.deepEqual(r.tasks.map(t => t.id), [1, 2]);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.mindmaps, []);
});
