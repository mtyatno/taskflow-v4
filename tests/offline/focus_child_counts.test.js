"use strict";

// Halaman Fokus: hitungan checklist/catatan/lampiran per task diambil lewat SATU endpoint batch
// (GET /api/tasks/child-counts, ≤ 200 id per request) untuk id server (numerik). Dulu 3 GET per task
// serentak memenuhi antrean koneksi browser → POST tambah checklist/catatan kena timeout 15 dtk.
// Id lokal (cid belum tersinkron) tetap 3 GET per task (dilayani router lokal dari IndexedDB).
// Plus: "Subtask" → "Checklist" di tempat yang memang checklist (tabel subtasks), bukan task anak.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

// Runtime hook minimal (satu komponen): urutan hook tetap per render, efek jalan saat deps berubah.
function loadHook(api) {
  const src = fnSource("useFocusTaskCounts") + "\n}";
  const slots = [];
  let i = 0;
  const useState = init => {
    const k = i++;
    if (!(k in slots)) slots[k] = { v: typeof init === "function" ? init() : init };
    const s = slots[k];
    return [s.v, u => { s.v = typeof u === "function" ? u(s.v) : u; }];
  };
  const useRef = init => {
    const k = i++;
    if (!(k in slots)) slots[k] = { current: init };
    return slots[k];
  };
  const useEffect = (fn, deps) => {
    const k = i++;
    const prev = slots[k];
    if (!prev || !deps || deps.length !== prev.deps.length || deps.some((d, j) => d !== prev.deps[j])) {
      slots[k] = { deps };
      fn();
    }
  };
  const useCallback = fn => {
    const k = i++;
    if (!(k in slots)) slots[k] = { fn };
    return slots[k].fn;
  };
  const useMemo = (fn, deps) => {
    const k = i++;
    const prev = slots[k];
    if (!prev || deps.some((d, j) => d !== prev.deps[j])) slots[k] = { deps, v: fn() };
    return slots[k].v;
  };
  const hook = new Function("useState", "useRef", "useEffect", "useCallback", "useMemo", "api",
    `${src}\nreturn useFocusTaskCounts;`)(useState, useRef, useEffect, useCallback, useMemo, api);
  return ids => { i = 0; return hook(ids); };
}

function fakeApi(handler) {
  const calls = [];
  return { calls, api: { get: (url, opts) => { calls.push({ url, opts }); return handler(url, opts); } } };
}
const flush = async () => { for (let k = 0; k < 5; k++) await new Promise(r => setImmediate(r)); };
const idsOf = url => url.slice(url.indexOf("?ids=") + 5).split(",");
const batchCalls = calls => calls.filter(c => c.url.startsWith("/api/tasks/child-counts?ids="));

test("useFocusTaskCounts: id numerik lewat child-counts, diurutkan, potongan ≤ 200 id, tanpa GET per task", async () => {
  const { calls, api } = fakeApi(() => Promise.resolve({ counts: {} }));
  const render = loadHook(api);
  const sorted = Array.from({ length: 450 }, (_, k) => k + 1);
  // urutan tampil acak (deterministik): URL tetap sama untuk himpunan task yang sama
  const shuffled = sorted.map((id, k) => ({ id, r: (k * 7919) % 450 })).sort((a, b) => a.r - b.r).map(x => x.id);
  assert.notDeepEqual(shuffled, sorted);
  render(shuffled);
  await flush();
  const batch = batchCalls(calls);
  assert.equal(batch.length, 3, "450 id → 3 request");
  assert.deepEqual(batch.map(c => idsOf(c.url).length), [200, 200, 50]);
  assert.deepEqual(batch.flatMap(c => idsOf(c.url)).map(Number), sorted, "semua id tepat sekali, urut numerik");
  // tanpa network: true — SW network-first + fallback cache tetap berlaku (badge saat offline)
  for (const c of batch) assert.equal(c.opts, undefined);
  assert.equal(calls.length, 3, "tidak ada GET /subtasks|/notes|/attachments per task untuk id numerik");
  assert.ok(!calls.some(c => /\/api\/tasks\/\d+\/(subtasks|notes|attachments)/.test(c.url)));
});

test("useFocusTaskCounts: sub_total/sub_done/notes/atts dipetakan ke subTotal/subDone/notes/atts", async () => {
  const { api } = fakeApi(() => Promise.resolve({
    counts: {
      "12": { sub_total: 3, sub_done: 1, notes: 2, atts: 0 },
      "15": { sub_total: 0, sub_done: 0, notes: 0, atts: 4 }
    }
  }));
  const render = loadHook(api);
  render([12, 15, 99]);
  await flush();
  const [counts] = render([12, 15, 99]);
  assert.deepEqual(counts[12], { subTotal: 3, subDone: 1, notes: 2, atts: 0 });
  assert.deepEqual(counts[15], { subTotal: 0, subDone: 0, notes: 0, atts: 4 });
  assert.equal(counts[99], undefined, "id yang tidak dikembalikan server tetap tanpa hitungan");
});

test("useFocusTaskCounts: angka dari panel yang terbuka (report) menang atas hasil batch", async () => {
  let resolve;
  const { api } = fakeApi(() => new Promise(r => { resolve = r; }));
  const render = loadHook(api);
  const [, report] = render([12]);
  report(12, { subTotal: 5, subDone: 4 });
  resolve({ counts: { "12": { sub_total: 3, sub_done: 1, notes: 2, atts: 1 } } });
  await flush();
  const [counts] = render([12]);
  assert.deepEqual(counts[12], { subTotal: 5, subDone: 4, notes: 2, atts: 1 });
});

test("useFocusTaskCounts: gagal (offline) → tanpa hitungan, error ditelan, id dicoba lagi saat daftar berubah", async () => {
  let fail = true;
  const { calls, api } = fakeApi(() => fail
    ? Promise.reject(new Error("Failed to fetch"))
    : Promise.resolve({ counts: { "12": { sub_total: 1, sub_done: 1, notes: 0, atts: 0 } } }));
  const render = loadHook(api);
  render([12]);
  await flush();
  assert.equal(render([12])[0][12], undefined);
  fail = false;
  render([12, 13]);
  await flush();
  const batch = batchCalls(calls);
  assert.equal(batch.length, 2);
  assert.deepEqual(idsOf(batch[1].url), ["12", "13"], "id gagal (12) ikut dicoba lagi bersama id baru");
  assert.deepEqual(render([12, 13])[0][12], { subTotal: 1, subDone: 1, notes: 0, atts: 0 });
});

test("useFocusTaskCounts: id yang sudah diambil tidak diminta ulang saat daftar berubah", async () => {
  const { calls, api } = fakeApi(() => Promise.resolve({ counts: {} }));
  const render = loadHook(api);
  render([1, 2]);
  await flush();
  render([1, 2, 3]);
  await flush();
  const batch = batchCalls(calls);
  assert.equal(batch.length, 2);
  assert.deepEqual(idsOf(batch[1].url), ["3"]);
});

test("useFocusTaskCounts: id lokal (cid) tetap 3 GET per task tanpa opsi network; id numerik string ikut batch", async () => {
  const { calls, api } = fakeApi(url => {
    if (url.startsWith("/api/tasks/child-counts")) return Promise.resolve({ counts: { "7": { sub_total: 2, sub_done: 0, notes: 1, atts: 0 } } });
    if (url.endsWith("/subtasks")) return Promise.resolve([{ is_done: true }, { is_done: false }, { is_done: true }]);
    if (url.endsWith("/notes")) return Promise.resolve([{}]);
    if (url.endsWith("/attachments")) return Promise.reject(new Error("x"));
    throw new Error("unexpected " + url);
  });
  const render = loadHook(api);
  render(["c_abc", "7"]);
  await flush();
  const local = calls.filter(c => c.url.startsWith("/api/tasks/c_abc/"));
  assert.deepEqual(local.map(c => c.url).sort(), [
    "/api/tasks/c_abc/attachments", "/api/tasks/c_abc/notes", "/api/tasks/c_abc/subtasks"
  ]);
  for (const c of local) assert.equal(c.opts, undefined, "jalur lokal tanpa network: true");
  const batch = batchCalls(calls);
  assert.equal(batch.length, 1);
  assert.deepEqual(idsOf(batch[0].url), ["7"]);
  assert.equal(batch[0].opts, undefined);
  const [counts] = render(["c_abc", "7"]);
  assert.deepEqual(counts.c_abc, { subTotal: 3, subDone: 2, notes: 1 }, "atts gagal → tidak diisi (seperti dulu)");
  assert.deepEqual(counts["7"], { subTotal: 2, subDone: 0, notes: 1, atts: 0 });
});

test("useFocusTaskCounts (sumber): tanpa network: true, id diurutkan, ukuran potongan 200, peta sub_total/sub_done", () => {
  const src = fnSource("useFocusTaskCounts");
  assert.ok(src.includes("/api/tasks/child-counts?ids="));
  assert.ok(!/network:\s*true/.test(src), "tanpa network: true (X-TF-Sync membuat SW network-only → badge hilang saat offline)");
  assert.ok(src.includes("200"));
  assert.ok(src.includes("serverIds.sort((a, b) => Number(a) - Number(b))"), "urut numerik sebelum dipotong");
  assert.ok(src.indexOf("serverIds.sort(") < src.indexOf("serverIds.slice("), "urutkan dulu, baru potong");
  assert.ok(src.includes("sub_total") && src.includes("sub_done"));
  assert.ok(src.includes("/^\\d+$/"), "pemisahan id numerik vs cid lokal");
});

test("useFocusTaskCounts: id numerik campuran angka/string diurutkan numerik (bukan leksikal)", async () => {
  const { calls, api } = fakeApi(() => Promise.resolve({ counts: {} }));
  const render = loadHook(api);
  render([30, "4", 200, "12", "c_x"]);
  await flush();
  const batch = batchCalls(calls);
  assert.equal(batch.length, 1);
  assert.deepEqual(idsOf(batch[0].url), ["4", "12", "30", "200"]);
});

test("api.fetch: taskroutes.js lama (dengan/tanpa shouldRouteLocally) tidak merutekan child-counts ke lokal", () => {
  const start = indexHtml.indexOf("const _local = ");
  assert.ok(start > 0, "ekspresi _local di api.fetch");
  const stmt = indexHtml.slice(start, indexHtml.indexOf(";\n", start) + 1);
  const decide = new Function("_R", "_router", "_method", "url", `${stmt}\nreturn _local;`);
  const oldR = { isNoteTagsCall: () => false };
  const router = { hasRoute: () => true };
  assert.equal(decide(oldR, router, "GET", "/api/tasks/child-counts?ids=1,2"), false);
  assert.equal(decide(oldR, router, "GET", "/api/tasks/child-counts"), false);
  assert.equal(decide(oldR, router, "GET", "/api/tasks/5"), true, "rute task lain tetap lokal");
  assert.equal(decide(oldR, router, "GET", "/api/scratchpad/trash"), false, "pengecualian lama tetap");
  // taskroutes.js baru: keputusan dari shouldRouteLocally
  const newR = { shouldRouteLocally: (r, m, u) => u === "lokal" };
  assert.equal(decide(newR, router, "GET", "lokal"), true);
  assert.equal(decide(newR, router, "GET", "/api/tasks/child-counts?ids=1"), false);
  // taskroutes.js v461 (shouldRouteLocally tanpa isTaskChildCountsCall → hasRoute GET /api/tasks/:id true)
  const v461R = { shouldRouteLocally: () => true };
  assert.equal(decide(v461R, router, "GET", "/api/tasks/child-counts?ids=1,2"), false);
  assert.equal(decide(v461R, router, "GET", "/api/tasks/5"), true);
});

// ── "Subtask" → "Checklist" untuk checklist (tabel subtasks) ─────────────────────────────

test("FOCUS_TABS: tab checklist berlabel Checklist (key & glyph tetap)", () => {
  assert.ok(indexHtml.includes('{ key: "subtasks", label: "Checklist", glyph: "subtasks" }'));
  assert.ok(!indexHtml.includes('{ key: "subtasks", label: "Subtask", glyph: "subtasks" }'));
});

test("FocusSubtasks: teks checklist (aria progres, kosong, placeholder, aria input)", () => {
  const src = fnSource("FocusSubtasks");
  assert.ok(src.includes('"aria-label": `${doneCount} dari ${total} item checklist selesai`'));
  assert.ok(src.includes('"Belum ada checklist."'));
  assert.ok(src.includes('placeholder: "Tambah item checklist, tekan Enter"'));
  assert.ok(src.includes('"aria-label": "Item checklist baru"'));
  assert.ok(!/subtask/i.test(src.replace(/subtasks|Subtasks|setSubtasks|fetchSubs|newSub|setNewSub/g, "")),
    "tidak ada lagi teks 'subtask' di FocusSubtasks");
  const head = indexHtml.slice(indexHtml.lastIndexOf("\n// ──", indexHtml.indexOf("\nfunction FocusSubtasks(")), indexHtml.indexOf("\nfunction FocusSubtasks("));
  assert.ok(head.includes("Checklist") && !head.includes("Inline Subtask Checklist"), "komentar judul blok");
});

test("Detail task: tab Checklist memakai 'butir checklist'; tab Subtask (task anak) tetap 'subtask'", () => {
  // Redesain detail (Task 6): bagian ✅ Checklist / 📌 Subtask kini panel tab di TaskDetailBody.
  const body = fnSource("TaskDetailBody");
  const start = body.indexOf('tabPanel("checklist",');
  assert.ok(start > 0, "panel tab Checklist");
  const end = body.indexOf('tabPanel("notes",', start);
  assert.ok(end > start, "akhir panel Checklist");
  const section = body.slice(start, end);
  for (const fn of ["handleToggle(s.id)", "handleDeleteSub(s.id)", "handleAddSub()", "React.createElement(ChecklistRow"])
    assert.ok(section.includes(fn), fn);
  assert.ok(section.includes('"+ Tambah butir checklist baru"'));
  assert.ok(section.includes('placeholder: "Butir checklist baru"'));
  assert.ok(section.includes('"Belum ada checklist"'));
  assert.ok(!/subtask/i.test(section.replace(/Subs\b|setNewSub|newSub|addingSub|loadingSubs|subtasks\.map|handleDeleteSub|handleAddSub/g, "")),
    "tidak ada teks 'subtask' di panel Checklist");
  const row = fnSource("ChecklistRow");
  assert.ok(row.includes('"aria-label": "Hapus butir"'));
  assert.ok(!/subtask/i.test(row), "tidak ada teks 'subtask' di ChecklistRow");
  // Task anak (parent_id) tetap "subtask".
  const sub = body.slice(body.indexOf('tabPanel("subtask",'), start);
  assert.ok(sub.includes('placeholder: "+ Buat subtask baru…"') && sub.includes('"Belum ada subtask"'), "panel task anak di detail");
  assert.ok(indexHtml.includes('placeholder: "Judul subtask...",\n    onKeyDown: e => {\n      if (e.key === "Enter") {\n        e.preventDefault();\n        if (pendingSubTitle.trim())'),
    "form task: subtask tertunda (task anak) tetap");
  assert.ok(indexHtml.includes("Task & semua subtask selesai"));
});
