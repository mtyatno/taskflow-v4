"use strict";

// Checklist bertingkat PR B (tampilan): komponen ChecklistTree (detail + Fokus), pill Progress terkunci, form edit
// lengkap. Spec docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md §6–§7; rencana
// docs/superpowers/plans/2026-11-10-checklist-bertingkat-pr-b-ui.md R3–R7, R9.
// Dua lapis: (1) asersi sumber index.html (teks persis, struktur, pemanggilan TF.checklist); (2) perilaku: komponen
// asli dijalankan dengan React/hook palsu (tanpa DOM, pola petakan_tab_ui.test.js) dan `api` palsu, memakai modul
// TF.checklist asli.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const C = require("../../static/offline/checklist.js");
// Tes yang memakai ./setup.js (paket npm fake-indexeddb) dilewati bila paketnya tidak ada: berkas ini ikut dijalankan
// CI lewat tests/test_taskdetail_node.py yang kontraknya "tanpa node_modules" (workflow tidak menjalankan npm install).
const hasFakeIdb = (() => { try { require.resolve("fake-indexeddb/auto"); return true; } catch (_) { return false; } })();
const IDB = { skip: hasFakeIdb ? false : "paket npm fake-indexeddb tidak terpasang (CI tanpa npm install)" };
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end + 2);
}
const detailBlock = () => {
  const a = appCss.indexOf("/* ── Detail task: awal ── */"), b = appCss.indexOf("/* ── Detail task: akhir ── */");
  assert.ok(a > 0 && b > a);
  return appCss.slice(a, b);
};
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]|\\uD83[C-E]|\\u2(?:6[0-9A-F]{2}|7[0-9A-B][0-9A-F])|\\uFE0F/u;

// ── Harness perilaku ─────────────────────────────────────────────────────────────────────────────────────────────

function fakeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}
const tick = () => new Promise(r => setImmediate(r));

// Server palsu: memegang butir per task dan menjawab persis bentuk API PR A (pre-order dari TF.checklist.preorder,
// task_progress level atas). `fail` = { "<METHOD> <regex>": true } → permintaan cocok ditolak.
function fakeServer(rows) {
  const st = { rows: rows.map(r => Object.assign({ task_id: 7, is_done: false, parent_id: null }, r)), nextId: 100, calls: [], fail: {} };
  const tp = () => {
    const c = C.topLevelCounts(st.rows);
    return { done: c.done, total: c.total, progress: c.total ? C.percent(c.done, c.total) : 0 };
  };
  const shape = () => C.preorder(st.rows).map(r => ({ id: r.id, task_id: r.task_id, parent_id: r.parent_id, depth: r.depth,
    title: r.title, is_done: !!r.is_done, sort_order: r.sort_order }));
  const one = id => Object.assign({}, shape().find(r => r.id === id), { task_progress: tp() });
  const failed = (method, url) => Object.keys(st.fail).some(k => {
    const [m, re] = [k.slice(0, k.indexOf(" ")), k.slice(k.indexOf(" ") + 1)];
    return m === method && new RegExp(re).test(url) && st.fail[k];
  });
  const handle = (method, url, body) => {
    st.calls.push({ method, url, body });
    if (failed(method, url)) return Promise.reject(Object.assign(new Error("Server error"), { status: 500 }));
    let m;
    if (method === "GET" && (m = url.match(/^\/api\/tasks\/(\d+)\/subtasks$/))) return Promise.resolve(shape());
    if (method === "POST" && (m = url.match(/^\/api\/tasks\/(\d+)\/subtasks$/))) {
      const id = st.nextId++;
      const parent = body.parent_id == null ? null : body.parent_id;
      const sibs = C.preorder(st.rows).filter(r => r.parent_id === parent);
      sibs.forEach((r, i) => { st.rows.find(x => x.id === r.id).sort_order = i; });
      st.rows.push({ id, task_id: Number(m[1]), parent_id: parent, title: body.title.trim(), is_done: false, sort_order: sibs.length });
      return Promise.resolve(one(id));
    }
    if (method === "POST" && (m = url.match(/^\/api\/subtasks\/(\d+)\/toggle$/))) {
      const id = Number(m[1]);
      const row = st.rows.find(r => r.id === id);
      let changed;
      if (row.is_done) { row.is_done = false; changed = [id]; }
      else {
        changed = [id, ...C.descendantIds(st.rows, id)].filter(x => !st.rows.find(r => r.id === x).is_done);
        changed.forEach(x => { st.rows.find(r => r.id === x).is_done = true; });
      }
      return Promise.resolve(Object.assign(one(id), { changed_ids: changed }));
    }
    if (method === "PATCH" && (m = url.match(/^\/api\/subtasks\/(\d+)$/))) {
      const id = Number(m[1]);
      st.rows.find(r => r.id === id).title = String(body.title).trim();
      return Promise.resolve(one(id));
    }
    if (method === "POST" && (m = url.match(/^\/api\/subtasks\/(\d+)\/move$/))) {
      const next = C.applyMove(st.rows, Number(m[1]), body.parent_id, body.index == null ? null : body.index);
      if (!next) return Promise.reject(Object.assign(new Error("Induk checklist tidak ditemukan"), { status: 422 }));
      st.rows = next.map(r => Object.assign({}, r));
      return Promise.resolve({ items: shape(), task_progress: tp() });
    }
    if (method === "DELETE" && (m = url.match(/^\/api\/subtasks\/(\d+)$/))) {
      const id = Number(m[1]);
      const gone = [id, ...C.descendantIds(st.rows, id)];
      st.rows = st.rows.filter(r => !gone.includes(r.id));
      return Promise.resolve({ ok: true, deleted_ids: gone, task_progress: tp() });
    }
    return Promise.reject(new Error("rute tidak dikenal " + method + " " + url));
  };
  st.api = {
    get: url => handle("GET", url),
    post: (url, body) => handle("POST", url, body),
    patch: (url, body) => handle("PATCH", url, body),
    put: (url, body) => handle("PUT", url, body),
    del: url => handle("DELETE", url)
  };
  st.mutations = () => st.calls.filter(c => c.method !== "GET");
  return st;
}

// Jalankan komponen dari sumber index.html dengan hook palsu. Efek (biasa + layout) dijalankan sesudah render bila
// dependensinya berubah; setState menandai kotor → settle() me-render ulang sampai tenang.
function mountComp(names, props, env = {}) {
  const slots = [];
  let slot = 0;
  let effects = [];
  const prevDeps = [];
  const cleanups = [];
  let dirty = false;
  let out = null;
  const intervals = [];
  const timers = [];
  const useState = init => {
    const i = slot++;
    if (!(i in slots)) slots[i] = { v: typeof init === "function" ? init() : init };
    const s = slots[i];
    return [s.v, u => { const v = typeof u === "function" ? u(s.v) : u; if (v !== s.v) { s.v = v; dirty = true; } }];
  };
  const useRef = init => { const i = slot++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; };
  let effIdx = 0;
  const useEffect = (fn, deps) => { effects.push({ i: effIdx++, fn, deps }); };
  const useMemo = (fn, deps) => {
    const i = slot++;
    const s = slots[i];
    if (s && deps && s.deps && deps.length === s.deps.length && deps.every((d, k) => d === s.deps[k])) return s.v;
    const v = fn();
    slots[i] = { v, deps };
    return v;
  };
  const useCallback = (fn, deps) => useMemo(() => fn, deps);
  const React = {
    createElement: (type, p, ...children) => {
      // env.inline: komponen fungsi dirender langsung (urutan hook tetap: satu anak per induk, mis. FocusSubtasks →
      // ChecklistTree).
      if (typeof type === "function" && env.inline) return type(Object.assign({}, p));
      // env.refs(type, props) → elemen palsu untuk ref objek (mis. .td-tree-body saat seret).
      if (p && p.ref && typeof p.ref === "object" && env.refs) {
        const el = env.refs(type, p);
        if (el) p.ref.current = el;
      }
      return { type, props: p || {}, children: children.flat(Infinity) };
    },
    Fragment: "Fragment",
    useLayoutEffect: useEffect,
    useMemo,
    useCallback
  };
  const toasts = [];
  const adopted = [];
  const confirms = [];
  const storage = env.storage || fakeStorage();
  const win = Object.defineProperties({
    TF: {
      checklist: Object.assign({}, C, {
        adoptTaskProgress: (id, tp) => { adopted.push([id, tp]); return Promise.resolve(true); }
      }),
      taskdetail: { clampProgress: v => Math.round(Number(v) / 5) * 5, PROGRESS_PRESETS: [0, 25, 50, 75, 100] }
    },
    localStorage: storage,
    __showToast: (msg, kind) => toasts.push([msg, kind]),
    confirm: msg => { confirms.push(msg); return env.confirm ? env.confirm(msg) : true; },
    matchMedia: () => ({ matches: false })
  }, Object.getOwnPropertyDescriptors(env.window || {}));
  const doc = Object.assign({ activeElement: null, addEventListener() {}, removeEventListener() {}, querySelector: () => null },
    env.document || {});
  const g = {
    React, useState, useRef, useEffect, useMemo, useCallback, api: env.api, window: win, document: doc,
    genId: (() => { let n = 0; return () => "g" + ++n; })(),
    Icon: "Icon", MentionInput: "MentionInput", DetailPopover: "DetailPopover", ChecklistGlyph: "ChecklistGlyph",
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: h => { if (intervals[h - 1]) intervals[h - 1].cleared = true; },
    // Timer antre (dijalankan h.runTimers()); rAF tidak pernah berjalan sendiri.
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: h => { if (h) timers[h - 1] = null; },
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ overflowY: "visible" }),
    // Pola seret asli dari index.html (mouse ≥ 6 px; sentuh tahan 250 ms).
    ...new Function(`${fnSource("kanbanDragStart")}\n${fnSource("kanbanDragShouldStart")}\nreturn { kanbanDragStart, kanbanDragShouldStart };`)(),
    console: { error() {}, log() {} },
    ...(env.globals || {})
  };
  const keys = Object.keys(g);
  const src = names.map(n => fnSource(n)).join("\n");
  const Comps = new Function(...keys, `${src}\nreturn { ${names.join(", ")} };`)(...keys.map(k => g[k]));
  const Comp = Comps[names[0]];
  const render = () => {
    slot = 0; effIdx = 0; effects = [];
    dirty = false;
    out = Comp(props);
    for (const e of effects) {
      const prev = prevDeps[e.i];
      const changed = !e.deps || !prev || e.deps.length !== prev.length || e.deps.some((d, k) => d !== prev[k]);
      if (!changed) continue;
      prevDeps[e.i] = e.deps;
      if (cleanups[e.i]) cleanups[e.i]();
      cleanups[e.i] = e.fn() || null;
    }
  };
  const settle = async () => {
    for (let n = 0; n < 40; n++) {
      if (dirty) render();
      await tick();
    }
    if (dirty) render();
  };
  render();
  return {
    get out() { return out; }, settle, toasts, adopted, confirms, storage, intervals, win,
    runTimers: () => { const q = timers.splice(0); q.forEach(f => f && f()); },
    rerender: async p => { Object.assign(props, p || {}); render(); await settle(); },
    unmount: () => { cleanups.forEach(c => c && c()); }
  };
}

function findAll(node, pred, out = []) {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, out)); return out; }
  if (node.type !== undefined && pred(node)) out.push(node);
  findAll(node.children, pred, out);
  return out;
}
const hasClass = (n, c) => typeof n.props.className === "string" && n.props.className.split(/\s+/).includes(c);
const byLabel = (tree, label) => findAll(tree, n => n.props["aria-label"] === label);
const one = (tree, label) => {
  const found = byLabel(tree, label);
  assert.equal(found.length, 1, `satu elemen ber-aria-label ${JSON.stringify(label)} (ada ${found.length})`);
  return found[0];
};
const textOf = n => (n == null || n === false ? "" : typeof n !== "object" ? String(n) : (n.children || []).map(textOf).join(""));
const rowsOf = tree => findAll(tree, n => hasClass(n, "td-tree-row")).map(r => ({
  id: r.props["data-check-row"], depth: r.props.style["--td-depth"], done: hasClass(r, "is-done")
}));
const key = (e) => Object.assign({ preventDefault() { this.prevented = true; }, stopPropagation() {}, shiftKey: false, altKey: false,
  ctrlKey: false, metaKey: false, nativeEvent: { isComposing: false } }, e);

// Data contoh: A (anak A1, A2; A1 punya A1a), B.
const SAMPLE = [
  { id: 1, title: "A", sort_order: 0 },
  { id: 2, title: "A1", parent_id: 1, sort_order: 0 },
  { id: 3, title: "A1a", parent_id: 2, sort_order: 0 },
  { id: 4, title: "A2", parent_id: 1, sort_order: 1, is_done: true },
  { id: 5, title: "B", sort_order: 1 }
];
async function mountTree(extra = {}, env = {}) {
  const srv = env.server || fakeServer(env.rows || SAMPLE);
  const counts = [];
  const progress = [];
  let add = null;
  const props = Object.assign({
    taskId: 7, task: { id: 7, server_id: 7, progress: 0, checklist_total: 2 }, collaborators: [], variant: "detail",
    onCounts: c => counts.push(c), onProgress: tp => progress.push(tp),
    renderAdd: a => { add = a; return { type: "ADD", props: {}, children: [] }; }
  }, extra);
  const h = mountComp(["ChecklistTree"], props, Object.assign({ api: srv.api }, env));
  await h.settle();
  Object.defineProperty(h, "add", { get: () => add });
  return Object.assign(h, { srv, counts, progress, props });
}

// ── Task 3: tampil, centang, tambah, lipat, hitungan ─────────────────────────────────────────────────────────────

test("ChecklistGlyph: SVG inline grip/more/chevron tanpa emoji (pola FocusGlyph)", () => {
  const g = fnSource("ChecklistGlyph");
  for (const n of ["grip", "more", "chevronRight", "chevronDown"]) assert.match(g, new RegExp(`\\b${n}: '<`), n);
  for (const re of [/"aria-hidden": "true"/, /focusable: "false"/, /dangerouslySetInnerHTML/, /viewBox: "0 0 24 24"/]) assert.match(g, re);
  assert.doesNotMatch(g, EMOJI);
});

test("ChecklistTree: letak (antara pinOverlayToScrollBox dan TaskDetailBody), ChecklistRow dihapus", () => {
  const a = indexHtml.indexOf("\nfunction pinOverlayToScrollBox("), t = indexHtml.indexOf("\nfunction ChecklistTree("),
    g = indexHtml.indexOf("\nfunction ChecklistGlyph("), b = indexHtml.indexOf("\nfunction TaskDetailBody("),
    m = indexHtml.indexOf("\nfunction TaskDetailModal(");
  assert.ok(a > 0 && g > a && t > a && t < b && g < b, "urutan");
  assert.ok(indexHtml.slice(b + 1, m).indexOf("\nfunction ") < 0, "tidak ada fungsi di antara TaskDetailBody dan TaskDetailModal");
  assert.ok(indexHtml.indexOf("\nfunction ChecklistRow(") < 0, "ChecklistRow dihapus");
  assert.doesNotMatch(indexHtml, /React\.createElement\(ChecklistRow/);
});

test("ChecklistTree: struktur ul/li, --td-depth dibatasi 6, aria lipat/centang, helper TF.checklist", () => {
  const s = fnSource("ChecklistTree");
  const sig = s.slice(0, s.indexOf(") {"));
  for (const p of ["taskId", "task", "collaborators", "variant", "autoRefreshMs", "onCounts", "onProgress", "renderAdd"]) assert.ok(sig.includes(p), p);
  for (const re of [/createElement\("ul"/, /createElement\("li"/, /"--td-depth": Math\.min\(depth, 6\)/, /role: "checkbox"/, /"aria-checked": done/,
    /"aria-expanded": !folded/, /"Lipat sub butir «" \+ title \+ "»"|`Lipat sub butir «\$\{title\}»`/, /"Buka sub butir «" \+ title \+ "»"|`Buka sub butir «\$\{title\}»`/,
    /"Pindahkan «" \+ title \+ "»"|`Pindahkan «\$\{title\}»`/, /"Aksi butir «" \+ title \+ "»"|`Aksi butir «\$\{title\}»`/,
    /C\.visibleRows\(items, collapsed\)/, /C\.childCountsAll\(items\)/, /C\.topLevelCounts\(/, /C\.loadCollapsed\(/, /C\.saveCollapsed\(/,
    /C\.maxAddDepth\(/, /C\.addParentFor\(/, /C\.adoptTaskProgress\(/, /\/api\/tasks\/\$\{taskId\}\/subtasks/, /\/toggle`/,
    /React\.createElement\(Icon, \{\s*name: "check"/, /React\.createElement\(ChecklistGlyph/])
    assert.match(s, re);
  assert.doesNotMatch(s, /C\.childCounts\(/, "chip lipat dari childCountsAll (satu lintasan), bukan childCounts per baris");
  for (const t of ['"Gagal menambah butir"', '"Gagal mencentang butir"']) assert.ok(s.includes(t), t);
  assert.doesNotMatch(s, EMOJI);
  assert.doesNotMatch(s, /borderLeft|border-left/);
  // Warna tidak pernah inline (hanya properti CSS --td-depth).
  assert.doesNotMatch(s, /color: "|background: "|#[0-9a-fA-F]{3,6}\b/);
});

test("ChecklistTree: muat → ul/li bersarang pre-order, onCounts level atas sesudah muat pertama", async () => {
  const h = await mountTree();
  assert.deepEqual(h.srv.calls.map(c => c.method + " " + c.url), ["GET /api/tasks/7/subtasks"]);
  assert.deepEqual(rowsOf(h.out), [
    { id: 1, depth: 0, done: false }, { id: 2, depth: 1, done: false }, { id: 3, depth: 2, done: false },
    { id: 4, depth: 1, done: true }, { id: 5, depth: 0, done: false }]);
  // ul > li > (baris, ul anak)
  const top = findAll(h.out, n => n.type === "ul" && hasClass(n, "td-tree-list"))[0];
  const lis = top.children.filter(c => c && c.type === "li");
  assert.deepEqual(lis.map(l => l.key ?? l.props["data-check-id"]), [1, 5]);
  const nested = lis[0].children.find(c => c && c.type === "ul");
  assert.ok(nested, "anak A di ul bersarang di dalam li A");
  assert.deepEqual(nested.children.filter(c => c && c.type === "li").map(l => l.props["data-check-id"]), [2, 4]);
  assert.deepEqual(h.counts, [{ done: 0, total: 2, loaded: true }], "hanya level atas (A, B)");
  assert.equal(h.add.depth, 0);
});

test("ChecklistTree: indentasi visual berhenti di tingkat 6; 300 tingkat tanpa galat", async () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, title: "L" + i, parent_id: i ? i : null, sort_order: 0 }));
  const h = await mountTree({}, { rows });
  const r = rowsOf(h.out);
  assert.equal(r.length, 300);
  assert.deepEqual(r.slice(0, 8).map(x => x.depth), [0, 1, 2, 3, 4, 5, 6, 6]);
  assert.equal(r[299].depth, 6);
});

test("ChecklistTree: gagal muat → daftar kosong, onCounts 0/0 loaded", async () => {
  const srv = fakeServer(SAMPLE);
  srv.fail["GET /subtasks$"] = true;
  const h = await mountTree({}, { server: srv });
  assert.deepEqual(rowsOf(h.out), []);
  assert.deepEqual(h.counts, [{ done: 0, total: 0, loaded: true, failed: true }], "gagal muat = keadaan tersendiri (S3)");
  assert.deepEqual(h.toasts, [], "muat pertama yang gagal tidak memunculkan toast");
});

test("S3: gagal muat lalu berhasil → hitungan biasa tanpa failed; lockFor gagal muat + checklist_total > 0 → pending", async () => {
  const srv = fakeServer(SAMPLE);
  srv.fail["GET /subtasks$"] = true;
  const h = await mountTree({ autoRefreshMs: 15000 }, { server: srv });
  assert.deepEqual(h.counts, [{ done: 0, total: 0, loaded: true, failed: true }]);
  assert.deepEqual(C.lockFor({ checklist_total: 2 }, h.counts.at(-1)), { pending: true }, "pill tetap terkunci");
  assert.equal(C.lockFor({ checklist_total: 0 }, h.counts.at(-1)), null);
  srv.fail["GET /subtasks$"] = false;
  h.intervals[0].fn(); await h.settle();
  assert.deepEqual(h.counts.at(-1), { done: 0, total: 2, loaded: true });
  // daftar kosong yang berhasil dimuat sesudah gagal: hitungan 0/0 tanpa failed
  const srv2 = fakeServer([]);
  srv2.fail["GET /subtasks$"] = true;
  const h2 = await mountTree({ autoRefreshMs: 15000 }, { server: srv2 });
  srv2.fail["GET /subtasks$"] = false;
  h2.intervals[0].fn(); await h2.settle();
  assert.deepEqual(h2.counts, [{ done: 0, total: 0, loaded: true, failed: true }, { done: 0, total: 0, loaded: true }]);
});

test("ChecklistTree: task belum tersinkron (id = cid) → tetap memuat lewat /api/tasks/<cid>/subtasks (rute lokal, Fase 2)", async () => {
  const srv = fakeServer([]);
  const get = srv.api.get;
  srv.api.get = url => (url === "/api/tasks/c-abc/subtasks" ? (srv.calls.push({ method: "GET", url }), Promise.resolve([])) : get(url));
  const h = await mountTree({ taskId: "c-abc", task: { id: "c-abc", cid: "c-abc" } }, { server: srv });
  assert.deepEqual(h.srv.calls.map(c => c.method + " " + c.url), ["GET /api/tasks/c-abc/subtasks"]);
  assert.deepEqual(rowsOf(h.out), []);
  assert.deepEqual(h.counts, [{ done: 0, total: 0, loaded: true }]);
});

test("ChecklistTree: penjaga 'id bukan angka' dihapus (checklist offline Fase 2 R6) — hanya id kosong yang tidak memuat", () => {
  const s = fnSource("ChecklistTree");
  assert.doesNotMatch(s, /\\d\+\$\/\.test\(String\(taskId\)\)/);
  assert.doesNotMatch(s, /\bsynced\b/);
  assert.match(s, /const hasId = taskId != null && String\(taskId\) !== "";/);
  assert.doesNotMatch(s, /Task belum tersinkron \(id bukan angka\): daftar kosong/);
});

// Checklist offline Fase 2 (rencana PR B2 R6): ChecklistTree asli + rute lokal asli (taskroutes + checklistroutes +
// checklistrepo di fake-indexeddb) untuk task yang belum tersinkron — semua permintaan dilayani lokal dan masuk antrean.
test("ChecklistTree + rute lokal: task belum tersinkron (id = cid) — muat, tambah, centang, ubah teks, hapus tanpa jaringan", IDB, async () => {
  const { deleteDB } = require("./setup.js");
  const TFdb = require("../../static/offline/db.js");
  const CR = require("../../static/offline/checklistrepo.js");
  const T = require("../../static/offline/taskroutes.js");
  const { outboxAll } = require("../../static/offline/outbox.js");
  CR._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
  const db = await TFdb.openDB();
  await new Promise(res => {
    const t = db.transaction("tasks", "readwrite");
    t.objectStore("tasks").put({ cid: "c-abc", server_id: null, title: "T", progress: 0, checklist_total: 0, dirty: 1, rev: 1, deleted: false });
    t.oncomplete = () => res();
  });
  await CR.start();
  await CR.markHydrated();
  const router = T.buildTaskRouter();
  const calls = [];
  const via = method => (url, body) => {
    calls.push({ method, url, body, local: T.shouldRouteLocally(router, method, url) });
    return router.dispatch(method, url, body);
  };
  const srv = { calls, api: { get: via("GET"), post: via("POST"), patch: via("PATCH"), put: via("PUT"), del: via("DELETE") } };
  srv.mutations = () => calls.filter(c => c.method !== "GET");
  const h = await mountTree({ taskId: "c-abc", task: { id: "c-abc", cid: "c-abc", server_id: null, progress: 0, checklist_total: 0 } }, { server: srv });
  assert.deepEqual(h.counts, [{ done: 0, total: 0, loaded: true }]);
  h.add.setOpen(true); await h.settle();
  h.add.setText("Satu"); await h.settle();
  h.add.onKeyDown(key({ key: "Enter" })); await h.settle();
  const rows = rowsOf(h.out);
  assert.equal(rows.length, 1);
  const id = rows[0].id;
  assert.equal(typeof id, "string", "id butir = cid");
  one(h.out, "Satu").props.onClick(); await h.settle();
  assert.equal(rowsOf(h.out)[0].done, true);
  textBtn(h.out, id).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "Satu baru" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.equal(textOf(textBtn(h.out, id)), "Satu baru");
  const antre = (await outboxAll()).filter(o => o.entity_type === "subtasks").map(o => [o.op, o.cid, o.task_cid]);
  assert.deepEqual(antre, [["create", id, "c-abc"], ["set_done", id, "c-abc"], ["rename", id, "c-abc"]]);
  assert.deepEqual(h.counts.at(-1), { done: 1, total: 1, loaded: true });
  await pick(h, "Satu baru", "Hapus");
  assert.deepEqual(rowsOf(h.out), []);
  assert.deepEqual((await outboxAll()).filter(o => o.entity_type === "subtasks"), [], "butir belum terkirim dihapus → antreannya dibuang");
  assert.deepEqual(calls.map(c => c.method + " " + c.url.replace(id, "<cid>")), [
    "GET /api/tasks/c-abc/subtasks", "POST /api/tasks/c-abc/subtasks", "POST /api/subtasks/<cid>/toggle",
    "PATCH /api/subtasks/<cid>", "DELETE /api/subtasks/<cid>"]);
  assert.ok(calls.every(c => c.local), "semua dilayani rute lokal");
  assert.deepEqual(h.toasts, []);
  assert.ok(h.adopted.every(([sid]) => sid === "c-abc"), "adoptTaskProgress aman dipanggil dengan cid (respons lokal tanpa rev)");
  const tk = await new Promise(res => { const r = db.transaction("tasks").objectStore("tasks").get("c-abc"); r.onsuccess = () => res(r.result); });
  assert.deepEqual([tk.checklist_total, tk.dirty, tk.rev], [0, 1, 1], "progress lokal ditulis tanpa dirty/rev");
});

// Perbaikan uji coba Task 6 (E2E C-1 regresi): butir yang dibuat lewat tampilan lalu dikirim push (id server diadopsi)
// selagi ChecklistTree terbuka tetap ber-id cid di respons lokal — centang, ubah teks + Tab (pindah) tetap mengenai baris
// yang sama, kotak ubah teks tetap terbuka.
test("ChecklistTree + rute lokal: id butir tetap sesudah push mengadopsi id server (centang, ubah teks + Tab)", IDB, async () => {
  const { deleteDB } = require("./setup.js");
  const TFdb = require("../../static/offline/db.js");
  const CR = require("../../static/offline/checklistrepo.js");
  const T = require("../../static/offline/taskroutes.js");
  CR._reset();
  TFdb._reset();
  await deleteDB(TFdb.DB_NAME);
  const db = await TFdb.openDB();
  await new Promise(res => {
    const t = db.transaction("tasks", "readwrite");
    t.objectStore("tasks").put({ cid: "t7", server_id: 7, title: "T", progress: 0, checklist_total: 0, dirty: 0, rev: 1, deleted: false });
    t.oncomplete = () => res();
  });
  await CR.start();
  await CR.setRev("t7", 0);
  await CR.markHydrated();
  const router = T.buildTaskRouter();
  const calls = [];
  const via = method => (url, body) => {
    calls.push({ method, url, body, local: T.shouldRouteLocally(router, method, url) });
    return router.dispatch(method, url, body);
  };
  const srv = { calls, api: { get: via("GET"), post: via("POST"), patch: via("PATCH"), put: via("PUT"), del: via("DELETE") } };
  srv.mutations = () => calls.filter(c => c.method !== "GET");
  const h = await mountTree({ taskId: 7, task: { id: 7, server_id: 7, progress: 0, checklist_total: 0 } }, { server: srv });
  h.add.setOpen(true); await h.settle();
  for (const t of ["Satu", "Dua"]) { h.add.setText(t); await h.settle(); h.add.onKeyDown(key({ key: "Enter" })); await h.settle(); }
  const [a, b] = rowsOf(h.out).map(r => r.id);
  // push mengirim kedua create → id server diadopsi (tampilan tetap terbuka)
  await CR.adoptServerId(a, 501);
  await CR.adoptServerId(b, 502);
  one(h.out, "Satu").props.onClick(); await h.settle();
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.done]), [[a, true], [b, false]], "centang mengenai baris yang sama");
  assert.deepEqual(h.counts.at(-1), { done: 1, total: 2, loaded: true });
  textBtn(h.out, b).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "Dua baru" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Tab" })); await h.settle();
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[a, 0], [b, 1]], "Tab → sub butir Satu");
  assert.ok(editBox(h.out), "kotak ubah teks tetap terbuka");
  assert.ok(rowNode(h.out, b).children.some(c => c && c.type === "MentionInput"), "di baris yang sama");
  assert.deepEqual(h.toasts, []);
  assert.ok(calls.every(c => c.local));
});

// CATATAN-4 review Task 4–6: pohon dimuat lewat jaringan (id server) sebelum unduhan awal selesai, lalu rute lokal
// menjawab mutasi dengan id stabil (cid) butir buatan perangkat ini → id respons tidak dikenal daftar → daftar dimuat ulang
// (GET) sekali di antrean yang sama, supaya tampilan selaras dengan rute lokal.
test("ChecklistTree: respons centang ber-id yang tidak dikenal daftar → daftar dimuat ulang sekali; id selaras → tanpa muat ulang", async () => {
  // butir yang sama: id server 501/502 (muat pertama lewat jaringan) = cid "c1"/"c2" (rute lokal)
  const st = { local: false, done: { c1: false, c2: false }, title: { c1: "Satu", c2: "Dua" }, gone: new Set(), calls: [] };
  const idOf = c => (st.local ? c : { c1: 501, c2: 502 }[c]);
  const row = c => ({ id: idOf(c), task_id: 7, parent_id: null, depth: 0, title: st.title[c], is_done: st.done[c], sort_order: c === "c1" ? 0 : 1 });
  const list = () => ["c1", "c2"].filter(c => !st.gone.has(c)).map(row);
  const tp = { done: 0, total: 2, progress: 0 };
  const api = {
    get: url => { st.calls.push("GET " + url); const out = list(); st.local = true; return Promise.resolve(out); },
    post: (url, body) => {
      st.calls.push("POST " + url);
      if (/\/toggle$/.test(url)) { st.done.c1 = !st.done.c1; return Promise.resolve(Object.assign(row("c1"), { changed_ids: ["c1"], task_progress: tp })); }
      return Promise.resolve({ id: "c9", task_id: 7, parent_id: "c1", depth: 1, title: body.title, is_done: false, sort_order: 0, task_progress: tp });
    },
    patch: (url, body) => { st.calls.push("PATCH " + url); st.title.c2 = body.title; return Promise.resolve(Object.assign(row("c2"), { changed_ids: [], task_progress: tp })); },
    del: url => { st.calls.push("DELETE " + url); st.gone.add("c2"); return Promise.resolve({ ok: true, deleted_ids: ["c2"], task_progress: tp }); },
    put: () => Promise.reject(new Error("tidak dipakai")),
  };
  const srv = { calls: st.calls, api };
  const h = await mountTree({}, { server: srv });
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [501, 502], "muat pertama lewat jaringan: id server");
  one(h.out, "Satu").props.onClick(); await h.settle();
  assert.deepEqual(st.calls.slice(-2), ["POST /api/subtasks/501/toggle", "GET /api/tasks/7/subtasks"], "id respons c1 tidak dikenal → muat ulang");
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.done]), [["c1", true], ["c2", false]]);
  const n = st.calls.length;
  one(h.out, "Satu").props.onClick(); await h.settle();
  assert.equal(st.calls.length, n + 1, "id sudah selaras → tanpa muat ulang");
  assert.deepEqual(h.toasts, []);
  const g0 = st.calls.length;
  textBtn(h.out, "c2").props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "Dua baru" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.equal(st.calls.length, g0 + 1, "respons ubah teks ber-id dikenal (c2) → tanpa muat ulang");
});

test("ChecklistTree: respons hapus / tambah / pindah ber-id tak dikenal → muat ulang sekali", async () => {
  for (const kind of ["hapus", "tambah", "pindah"]) {
    const st = { calls: [], n: 0 };
    const rows0 = [{ id: 501, task_id: 7, parent_id: null, depth: 0, title: "Satu", is_done: false, sort_order: 0 },
      { id: 502, task_id: 7, parent_id: null, depth: 0, title: "Dua", is_done: false, sort_order: 1 }];
    const asCid = r => Object.assign({}, r, { id: r.id === 501 ? "c1" : "c2" });
    const tp = { done: 0, total: 2, progress: 0 };
    const api = {
      get: url => { st.calls.push("GET"); return Promise.resolve(st.n++ === 0 ? rows0 : rows0.map(asCid)); },
      post: (url, body) => {
        st.calls.push("POST " + url);
        if (/\/move$/.test(url)) return Promise.resolve({ items: [rows0[1], rows0[0]].map(asCid), task_progress: tp });
        return Promise.resolve({ id: "c9", task_id: 7, parent_id: "c1", depth: 1, title: body.title, is_done: false, sort_order: 0, task_progress: tp });
      },
      del: url => { st.calls.push("DELETE " + url); return Promise.resolve({ ok: true, deleted_ids: ["c2"], task_progress: tp }); },
      patch: () => Promise.reject(new Error("x")), put: () => Promise.reject(new Error("x")),
    };
    const h = await mountTree({}, { server: { calls: st.calls, api } });
    if (kind === "hapus") await pick(h, "Dua", "Hapus");
    if (kind === "tambah") await pick(h, "Satu", "Tambah sub butir").then(async () => {
      const box = findAll(h.out, nd => nd.type === "MentionInput" && nd.props["aria-label"] === "Sub butir baru")[0];
      box.props.onChange({ target: { value: "Anak" } }); await h.settle();
      findAll(h.out, nd => nd.type === "MentionInput" && nd.props["aria-label"] === "Sub butir baru")[0].props.onKeyDown(key({ key: "Enter" }));
      await h.settle();
    });
    if (kind === "pindah") {
      rowNode(h.out, 502).props.onKeyDown(key({ key: "ArrowUp", altKey: true, target: { getAttribute: () => "check" } }));
      await h.settle();
    }
    assert.ok(st.calls.some(c => c.startsWith(kind === "hapus" ? "DELETE" : "POST")), kind + ": mutasi terkirim " + st.calls.join(", "));
    assert.equal(st.calls.filter(c => c === "GET").length, 2, kind + ": " + st.calls.join(", "));
    assert.ok(rowsOf(h.out).every(r => typeof r.id === "string"), kind + ": id selaras dengan rute lokal");
  }
});

test("App: pendengar tf:checklist-rejected sekali → satu toast error berteks persis + sinkron ulang dan daftar task dimuat ulang (spec §4.4, F3)", () => {
  const app = fnSource("App");
  const n = app.split('"tf:checklist-rejected"').length - 1;
  assert.equal(n, 2, "addEventListener + removeEventListener di satu efek App");
  assert.equal(indexHtml.split('"tf:checklist-rejected"').length - 1, 2, "tidak didaftarkan di tempat lain");
  const i = app.indexOf('window.addEventListener("tf:checklist-rejected"');
  const eff = app.slice(app.lastIndexOf("useEffect(() => {", i), app.indexOf("}, []);", i) + 7);
  assert.match(eff, /window\.__showToast\?\.\(`\$\{n\} perubahan checklist dibatalkan karena checklist sudah berubah di perangkat lain\.`, "error"\)/);
  assert.match(eff, /if \(!\(n > 0\)\) return;/);
  assert.match(eff, /\(window\.__refreshTasks \|\| window\.__syncNow\)\?\.\(\)/);
  assert.match(eff, /\}, \[\]\);$/);
  // perilaku: jalankan efeknya dengan window palsu. E2E (temporary_files/e2e_checklist_offline.py S3): sinkron saja
  // tidak memuat ulang daftar task → progress yang dibatalkan tetap tampil sampai refresh 30 dtk berikutnya. Maka
  // __refreshTasks (fetchAll = sinkron + muat ulang daftar, pola tombol konflik task) dipakai bila ada; __syncNow cadangan.
  const run = (withRefresh) => {
    const seen = [];
    const handlers = {};
    const win = { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; },
      __showToast: (m, k) => seen.push(["toast", m, k]), __syncNow: () => seen.push(["sync"]) };
    if (withRefresh) win.__refreshTasks = () => seen.push(["refresh"]);
    const body = eff.slice(eff.indexOf("{") + 1, eff.lastIndexOf("}, []);"));
    const cleanup = new Function("window", body)(win);
    handlers["tf:checklist-rejected"]({ detail: { count: 3 } });
    handlers["tf:checklist-rejected"]({ detail: { count: 0 } });
    handlers["tf:checklist-rejected"]({});
    cleanup();
    assert.equal(handlers["tf:checklist-rejected"], undefined);
    return seen;
  };
  const toast = ["toast", "3 perubahan checklist dibatalkan karena checklist sudah berubah di perangkat lain.", "error"];
  assert.deepEqual(run(true), [toast, ["refresh"]], "daftar task dimuat ulang (fetchAll sudah termasuk sinkron), tanpa sinkron kedua");
  assert.deepEqual(run(false), [toast, ["sync"]], "tanpa __refreshTasks (belum login) → sinkron saja");
});

test("centang induk → menunggu respons, semua changed_ids dicoret; progress diadopsi lalu onProgress", async () => {
  const h = await mountTree();
  one(h.out, "A").props.onClick();
  assert.deepEqual(rowsOf(h.out).find(r => r.id === 1).done, false, "tidak optimistis");
  await h.settle();
  assert.deepEqual(h.srv.mutations().map(c => c.method + " " + c.url), ["POST /api/subtasks/1/toggle"]);
  assert.deepEqual(rowsOf(h.out).map(r => r.done), [true, true, true, true, false], "A dan semua turunannya");
  const tp = { done: 1, total: 2, progress: 50 };
  assert.deepEqual(h.adopted, [[7, tp]], "adoptTaskProgress(server_id, task_progress)");
  assert.deepEqual(h.progress, [tp]);
  assert.deepEqual(h.counts.at(-1), { done: 1, total: 2, loaded: true });
  // buka lagi induk → hanya induk
  one(h.out, "A").props.onClick();
  await h.settle();
  assert.deepEqual(rowsOf(h.out).map(r => r.done), [false, true, true, true, false]);
});

test("adoptTaskProgress memakai task.server_id bila ada (id lokal berbeda)", async () => {
  const h = await mountTree({ taskId: 7, task: { id: 7, cid: "c7", server_id: 7 } });
  one(h.out, "B").props.onClick();
  await h.settle();
  assert.equal(h.adopted[0][0], 7);
});

test("galat centang → toast persis, daftar dimuat ulang dari server", async () => {
  const srv = fakeServer(SAMPLE);
  const h = await mountTree({}, { server: srv });
  srv.fail["POST /toggle$"] = true;
  one(h.out, "B").props.onClick();
  await h.settle();
  assert.deepEqual(h.toasts, [["Gagal mencentang butir", "error"]]);
  assert.deepEqual(srv.calls.map(c => c.method + " " + c.url).slice(-2), ["POST /api/subtasks/5/toggle", "GET /api/tasks/7/subtasks"]);
  assert.deepEqual(h.progress, []);
});

test("antrean berurutan: centang kedua baru dikirim setelah yang pertama selesai", async () => {
  const srv = fakeServer(SAMPLE);
  let release;
  const gate = new Promise(r => { release = r; });
  const order = [];
  const post = srv.api.post;
  srv.api.post = (url, body) => { order.push("mulai " + url); return (url.includes("/1/") ? gate : Promise.resolve()).then(() => post(url, body)).then(r => { order.push("selesai " + url); return r; }); };
  const h = await mountTree({}, { server: srv });
  one(h.out, "A").props.onClick();
  one(h.out, "B").props.onClick();
  await h.settle();
  assert.deepEqual(order, ["mulai /api/subtasks/1/toggle"]);
  release();
  await h.settle();
  assert.deepEqual(order, ["mulai /api/subtasks/1/toggle", "selesai /api/subtasks/1/toggle", "mulai /api/subtasks/5/toggle", "selesai /api/subtasks/5/toggle"]);
});

test("kotak tambah bawah: Tab/Shift+Tab mengubah depth (dibatasi), Enter → parent_id addParentFor tanpa index", async () => {
  const h = await mountTree();
  h.add.setOpen(true);
  await h.settle();
  h.add.setText("Baru");
  await h.settle();
  const max = C.maxAddDepth(h.srv.rows); // butir terakhir pre-order = B (depth 0) → 1
  assert.equal(max, 1);
  let e = key({ key: "Tab" });
  h.add.onKeyDown(e); await h.settle();
  assert.equal(h.add.depth, 1); assert.ok(e.prevented);
  e = key({ key: "Tab" });
  h.add.onKeyDown(e); await h.settle();
  assert.equal(h.add.depth, 1, "tidak melebihi maxAddDepth");
  assert.ok(!e.prevented, "Tab yang tidak mengubah tingkat tidak ditangkap (fokus boleh pindah)");
  assert.deepEqual(h.add.style, { "--td-depth": 1 });
  h.add.onKeyDown(key({ key: "Enter" }));
  await h.settle();
  const post = h.srv.mutations().at(-1);
  assert.deepEqual(post, { method: "POST", url: "/api/tasks/7/subtasks", body: { title: "Baru", client_id: post.body.client_id, parent_id: 5 } });
  assert.ok(!("index" in post.body));
  assert.ok(post.body.client_id);
  assert.deepEqual(rowsOf(h.out).at(-1), { id: 100, depth: 1, done: false }, "anak terakhir B");
  assert.equal(h.add.text, "", "teks dikosongkan");
  assert.equal(h.add.open, true, "kotak tetap terbuka");
  assert.equal(h.add.depth, 1, "depth sama");
  assert.deepEqual(h.counts.at(-1), { done: 0, total: 2, loaded: true }, "sub butir tidak menambah hitungan");
  // Shift+Tab ke 0, tambah lagi → level atas, client_id baru
  h.add.onKeyDown(key({ key: "Tab", shiftKey: true })); await h.settle();
  assert.equal(h.add.depth, 0);
  e = key({ key: "Tab", shiftKey: true });
  h.add.onKeyDown(e); await h.settle();
  assert.equal(h.add.depth, 0); assert.ok(!e.prevented);
  h.add.setText("Atas"); await h.settle();
  h.add.onKeyDown(key({ key: "Enter" })); await h.settle();
  const post2 = h.srv.mutations().at(-1);
  assert.equal(post2.body.parent_id, null);
  assert.notEqual(post2.body.client_id, post.body.client_id);
  assert.deepEqual(h.counts.at(-1), { done: 0, total: 3, loaded: true });
  assert.ok(h.adopted.length >= 2);
});

test("kotak tambah bawah: Escape menutup + depth 0; blur kosong menutup; judul kosong tidak dikirim", async () => {
  const h = await mountTree();
  h.add.setOpen(true); await h.settle();
  h.add.setText("   "); await h.settle();
  h.add.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.deepEqual(h.srv.mutations(), [], "judul kosong setelah trim tidak dikirim");
  h.add.onKeyDown(key({ key: "Tab" })); await h.settle();
  assert.equal(h.add.depth, 1);
  h.add.onKeyDown(key({ key: "Escape" })); await h.settle();
  assert.equal(h.add.open, false); assert.equal(h.add.depth, 0); assert.equal(h.add.text, "");
  h.add.setOpen(true); await h.settle();
  h.add.onBlur(); await h.settle();
  assert.equal(h.add.open, false, "blur saat kosong menutup");
});

test("tambah ke induk terlipat → seluruh rantai leluhur dibuka", async () => {
  const storage = fakeStorage({ tf_check_collapsed: JSON.stringify([1, 2]) });
  const h = await mountTree({}, { storage });
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [1, 5], "A terlipat");
  // Butir terakhir pre-order = B; dengan depth 1 → induk B. Uji rantai lewat data: B anak A1a? gunakan depth tertinggi.
  h.add.setOpen(true); h.add.setText("X"); await h.settle();
  h.add.onKeyDown(key({ key: "Tab" })); await h.settle();
  h.add.onKeyDown(key({ key: "Enter" })); await h.settle();
  // induk = B (tidak terlipat): lipatan A tetap
  assert.deepEqual(JSON.parse(storage.m.get("tf_check_collapsed")), [1, 2]);
  // Sekarang butir terakhir = X (anak B). Hapus lipatan bukan tujuan tes ini; uji rantai dengan data bertingkat:
  const rows = [{ id: 1, title: "A", sort_order: 0 }, { id: 2, title: "A1", parent_id: 1, sort_order: 0 }, { id: 3, title: "A1a", parent_id: 2, sort_order: 0 }];
  const st2 = fakeStorage({ tf_check_collapsed: JSON.stringify([1, 2, 99]) });
  const h2 = await mountTree({}, { rows, storage: st2 });
  assert.deepEqual(rowsOf(h2.out).map(r => r.id), [1]);
  h2.add.setOpen(true); h2.add.setText("Cucu"); await h2.settle();
  for (let i = 0; i < 3; i++) { h2.add.onKeyDown(key({ key: "Tab" })); await h2.settle(); }
  assert.equal(h2.add.depth, 3);
  h2.add.onKeyDown(key({ key: "Enter" })); await h2.settle();
  assert.equal(h2.srv.mutations()[0].body.parent_id, 3);
  assert.deepEqual(rowsOf(h2.out).map(r => r.id), [1, 2, 3, 100], "A dan A1 dibuka, butir baru terlihat");
  assert.deepEqual(JSON.parse(st2.m.get("tf_check_collapsed")), [99]);
});

test("galat tambah → toast persis + muat ulang; teks tidak hilang", async () => {
  const srv = fakeServer(SAMPLE);
  const h = await mountTree({}, { server: srv });
  srv.fail["POST /api/tasks/7/subtasks$"] = true;
  h.add.setOpen(true); h.add.setText("Gagal"); await h.settle();
  h.add.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.deepEqual(h.toasts, [["Gagal menambah butir", "error"]]);
  assert.equal(srv.calls.at(-1).method + " " + srv.calls.at(-1).url, "GET /api/tasks/7/subtasks");
  assert.equal(h.add.text, "Gagal");
  assert.equal(h.add.busy, false);
});

test("lipat: tombol ▸/▾ aria-expanded + label, chip anak langsung, disimpan per perangkat (tf_check_collapsed)", async () => {
  const storage = fakeStorage();
  const h = await mountTree({}, { storage });
  const fold = one(h.out, "Lipat sub butir «A»");
  assert.equal(fold.props["aria-expanded"], true);
  assert.equal(byLabel(h.out, "Lipat sub butir «B»").length, 0, "B tanpa anak: tanpa tombol lipat");
  fold.props.onClick();
  await h.settle();
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [1, 5]);
  const open = one(h.out, "Buka sub butir «A»");
  assert.equal(open.props["aria-expanded"], false);
  const chip = findAll(h.out, n => hasClass(n, "td-tree-chip"));
  assert.equal(chip.length, 1);
  assert.equal(textOf(chip[0]), "1/2", "anak langsung A: A1 belum, A2 selesai");
  assert.deepEqual(JSON.parse(storage.m.get("tf_check_collapsed")), [1]);
  open.props.onClick();
  await h.settle();
  assert.equal(rowsOf(h.out).length, 5);
  assert.deepEqual(JSON.parse(storage.m.get("tf_check_collapsed")), []);
  // Dipulihkan saat dipasang ulang
  const st2 = fakeStorage({ tf_check_collapsed: "[2]" });
  const h2 = await mountTree({}, { storage: st2 });
  assert.deepEqual(rowsOf(h2.out).map(r => r.id), [1, 2, 4, 5]);
  // localStorage yang melempar → tidak galat
  const h3 = await mountTree({}, { window: { get localStorage() { throw new Error("blocked"); } } });
  assert.equal(rowsOf(h3.out).length, 5);
  one(h3.out, "Lipat sub butir «A»").props.onClick();
  await h3.settle();
  assert.equal(rowsOf(h3.out).length, 2);
});

test("autoRefreshMs: memuat ulang berkala; dilewati selama antrean belum kosong atau kotak berisi teks", async () => {
  const srv = fakeServer(SAMPLE);
  let release;
  const h = await mountTree({ autoRefreshMs: 15000, variant: "focus" }, { server: srv });
  assert.equal(h.intervals.length, 1); assert.equal(h.intervals[0].ms, 15000);
  const gets = () => srv.calls.filter(c => c.method === "GET").length;
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 2);
  h.add.setText("sedang mengetik"); await h.settle();
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 2, "kotak tambah berisi teks → ditunda");
  h.add.setText(""); await h.settle();
  const post = srv.api.post;
  srv.api.post = (url, body) => new Promise(r => { release = r; }).then(() => post(url, body));
  one(h.out, "A").props.onClick();
  await h.settle();
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 2, "antrean belum kosong → ditunda");
  release(); await h.settle();
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 3);
  // tanpa autoRefreshMs → tanpa interval
  const h2 = await mountTree();
  assert.equal(h2.intervals.length, 0);
});

test("S1: onProgress hanya bila task_progress berbeda dari nilai terakhir yang diketahui; adoptTaskProgress tetap dipanggil", async () => {
  const h = await mountTree(); // task 0% / checklist_total 2; muat: 0/2
  textBtn(h.out, 5).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "B2" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  one(h.out, "A1a").props.onClick(); await h.settle();
  rowNode(h.out, 5).props.onKeyDown(key({ key: "ArrowUp", altKey: true, target: { getAttribute: () => "check" } })); await h.settle();
  await pick(h, "A2", "Jadikan sub");
  assert.equal(h.adopted.length, 4, "adoptTaskProgress tetap dipanggil untuk setiap respons");
  assert.deepEqual(h.progress, [], "ubah teks / centang sub butir / pindah tanpa perubahan level atas → tanpa onProgress");
  one(h.out, "A").props.onClick(); await h.settle();
  assert.deepEqual(h.progress, [{ done: 1, total: 2, progress: 50 }], "centang level atas → satu onProgress");
  textBtn(h.out, 1).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "A2x" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.equal(h.progress.length, 1, "nilai terakhir kini 50%");
});

test("S1: nilai awal task basi (progress lokal ≠ server) → respons pertama tetap memicu onProgress, sekali", async () => {
  const rows = SAMPLE.map(r => (r.id === 1 ? Object.assign({}, r, { is_done: true }) : r));
  const h = await mountTree({ task: { id: 7, server_id: 7, progress: 0, checklist_total: 2 } }, { rows });
  textBtn(h.out, 5).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "B2" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.deepEqual(h.progress, [{ done: 1, total: 2, progress: 50 }], "angka checklist belum sampai ke task lokal");
  textBtn(h.out, 5).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "B3" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.equal(h.progress.length, 1);
});

test("S4: muat berkala yang mendarat saat komponen sibuk dibuang (seret / kotak ubah teks); muat berikutnya diterapkan", async () => {
  const srv = fakeServer(SAMPLE);
  const gates = [];
  const get = srv.api.get;
  srv.api.get = url => new Promise(r => gates.push(r)).then(() => get(url));
  const h = await mountDrag({ autoRefreshMs: 15000 }, { server: srv });
  gates.shift()(); await h.settle(); // muat pertama
  assert.equal(rowsOf(h.out).length, 5);
  h.intervals[0].fn(); await h.settle(); // muat berkala dimulai saat tidak sibuk
  srv.rows.push({ id: 50, task_id: 7, parent_id: null, title: "Baru", is_done: false, sort_order: 9 });
  h.down("B", { clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 20 });
  await h.settle();
  assert.ok(lineOf(h.out), "seret berjalan");
  gates.shift()(); await h.settle();
  assert.equal(rowsOf(h.out).length, 5, "hasil muat dibuang selama seret");
  h.fire("pointercancel", { pointerId: 1 }); await h.settle();
  // kotak ubah teks dibuka saat muat berjalan → dibuang juga
  h.intervals[0].fn(); await h.settle();
  textBtn(h.out, 5).props.onClick(); await h.settle();
  gates.shift()(); await h.settle();
  assert.equal(rowsOf(h.out).length, 5, "hasil muat dibuang selama kotak ubah teks terbuka");
  editBox(h.out).props.onKeyDown(key({ key: "Escape" })); await h.settle();
  h.intervals[0].fn(); await h.settle();
  gates.shift()(); await h.settle();
  assert.equal(rowsOf(h.out).length, 6, "tidak sibuk → diterapkan");
  assert.match(fnSource("ChecklistTree"), /!force && \(mut !== mutSeqRef\.current \|\| busyRef\.current\(\)\)/);
});

test("C1: lipat dari dua instans (modal + kartu Fokus) tidak saling menimpa: toggleFold membaca ulang penyimpanan", async () => {
  const storage = fakeStorage();
  const h1 = await mountTree({}, { storage });
  const h2 = await mountTree({}, { storage });
  one(h1.out, "Lipat sub butir «A»").props.onClick(); await h1.settle();
  one(h2.out, "Lipat sub butir «A1»").props.onClick(); await h2.settle();
  assert.deepEqual(JSON.parse(storage.m.get("tf_check_collapsed")), [1, 2], "lipatan instans pertama tidak hilang");
  one(h1.out, "Buka sub butir «A»").props.onClick(); await h1.settle();
  assert.deepEqual(JSON.parse(storage.m.get("tf_check_collapsed")), [2], "lipatan instans kedua tidak hilang");
  assert.match(fnSource("ChecklistTree"), /const toggleFold = \(id, fold\) => \{\s*const next = freshCollapsed\(\);/);
});

test("CSS blok detail: pohon checklist hanya token, --td-depth 20/16 px, target 32 px, tanpa border-left", () => {
  const block = detailBlock();
  for (const c of [".td-tree", ".td-tree-list", ".td-tree-row", ".td-tree-grip", ".td-tree-fold", ".td-tree-check", ".td-tree-text",
    ".td-tree-chip", ".td-tree-more"])
    assert.ok(block.includes(c + " {") || block.includes(c + ",") || block.includes(c + ":"), c);
  assert.match(block, /\.td-tree-row\s*\{[^}]*padding-inline-start:\s*calc\(var\(--td-depth, 0\) \* 20px\)/);
  assert.match(block, /@media \(max-width: 640px\)\s*\{[^}]*\.td-tree-row\s*\{\s*padding-inline-start:\s*calc\(var\(--td-depth, 0\) \* 16px\)/);
  assert.match(block, /\.td-tree-grip, \.td-tree-fold, \.td-tree-check, \.td-tree-more\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px/);
  assert.match(block, /\.td-tree-list\s*\{[^}]*list-style:\s*none/);
  assert.doesNotMatch(block, /border-left|rgba\(/);
  assert.doesNotMatch(block.replace(/var\(--danger, #dc2626\)/g, ""), /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(block, /\.td-check-del|\.td-check-row|\.td-check-title/, "CSS baris lama dihapus");
});

// ── Task 4: ubah teks, menu ⋯, keyboard, hapus ───────────────────────────────────────────────────────────────────

const menuOf = tree => findAll(tree, n => n.type === "DetailPopover" && n.props.open)[0] || null;
const menuItems = tree => {
  const m = menuOf(tree);
  return m ? findAll(m, n => n.props.role === "menuitem").map(n => ({ text: textOf(n).trim(), disabled: !!n.props.disabled, node: n })) : [];
};
async function openMenu(h, title) {
  one(h.out, `Aksi butir «${title}»`).props.onClick({ currentTarget: { title } });
  await h.settle();
  return menuItems(h.out);
}
async function pick(h, title, item) {
  const it = (await openMenu(h, title)).find(x => x.text === item);
  assert.ok(it, `item menu ${item}`);
  assert.equal(it.disabled, false, `${item} aktif`);
  it.node.props.onClick();
  await h.settle();
}
const editBox = tree => findAll(tree, n => n.type === "MentionInput" && n.props["aria-label"] === "Ubah teks butir")[0] || null;
const subBox = tree => findAll(tree, n => n.type === "MentionInput" && n.props["aria-label"] === "Sub butir baru")[0] || null;
const textBtn = (tree, id) => findAll(tree, n => n.type === "button" && hasClass(n, "td-tree-text") && n.props["data-check-part"] === "text")
  .find(n => findAll(tree, r => hasClass(r, "td-tree-row") && r.props["data-check-row"] === id)[0].children.includes(n));
const rowNode = (tree, id) => findAll(tree, r => hasClass(r, "td-tree-row") && r.props["data-check-row"] === id)[0];
const live = tree => findAll(tree, n => n.props["aria-live"] === "polite").map(textOf);

test("menu ⋯: DetailPopover role menu td-menu, item persis, aturan nonaktif §6.3", async () => {
  const h = await mountTree();
  const more = one(h.out, "Aksi butir «A»");
  assert.equal(more.props["aria-haspopup"], "menu");
  assert.equal(more.props["aria-expanded"], false);
  let items = await openMenu(h, "A");
  assert.deepEqual(items.map(i => i.text), ["Ubah teks", "Tambah sub butir", "Jadikan sub", "Naikkan level", "Hapus"]);
  const m = menuOf(h.out);
  assert.equal(m.props.role, "menu"); assert.equal(m.props.className, "td-menu"); assert.equal(m.props.label, "Aksi butir «A»");
  assert.equal(one(h.out, "Aksi butir «A»").props["aria-expanded"], true);
  assert.deepEqual(items.map(i => i.disabled), [false, false, true, true, false], "A: butir pertama + level atas");
  m.props.onClose(); await h.settle();
  assert.equal(menuOf(h.out), null);
  items = await openMenu(h, "A2");
  assert.deepEqual(items.map(i => i.disabled), [false, false, false, false, false], "A2: punya saudara sebelumnya, bukan level atas");
  items = await openMenu(h, "A1");
  assert.deepEqual(items.map(i => i.disabled), [false, false, true, false, false]);
  assert.ok(hasClass(items.find(i => i.text === "Hapus").node, "is-danger"));
});

test("Jadikan sub (= Tab): optimistis, POST move {parent_id, index} dari indentTarget, pengumuman aria-live", async () => {
  const h = await mountTree();
  let release;
  const post = h.srv.api.post;
  h.srv.api.post = (url, body) => (url.endsWith("/move") ? new Promise(r => { release = r; }).then(() => post(url, body)) : post(url, body));
  await pick(h, "B", "Jadikan sub");
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 1], [5, 1]], "langsung tampil sebelum respons");
  assert.deepEqual(live(h.out), ["«B» dipindah ke tingkat 2, posisi 3 dari 3."]);
  assert.deepEqual(h.counts.at(-1), { done: 0, total: 1, loaded: true }, "hitungan level atas ikut berubah");
  release(); await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1), { method: "POST", url: "/api/subtasks/5/move", body: { parent_id: 1, index: 2 } });
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 1], [5, 1]]);
  assert.equal(h.adopted.at(-1)[1].total, 1);
  assert.deepEqual(h.toasts, []);
});

test("Naikkan level (= Shift+Tab): tepat di bawah induk; saudara berikutnya tetap", async () => {
  const h = await mountTree();
  await pick(h, "A1", "Naikkan level");
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: null, index: 1 });
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [4, 1], [2, 0], [3, 1], [5, 0]]);
});

test("galat pindah → toast persis, tampilan kembali ke versi server, muat ulang", async () => {
  const srv = fakeServer(SAMPLE);
  const h = await mountTree({}, { server: srv });
  srv.fail["POST /move$"] = true;
  await pick(h, "B", "Jadikan sub");
  assert.deepEqual(h.toasts, [["Gagal memindah butir", "error"]]);
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 1], [5, 0]]);
  assert.equal(srv.calls.at(-1).method, "GET");
});

test("antrean: respons move mengganti daftar hanya bila antrean sudah kosong; galat membuang sisa antrean", async () => {
  const srv = fakeServer(SAMPLE);
  const gates = [];
  const post = srv.api.post;
  srv.api.post = (url, body) => new Promise(r => gates.push(r)).then(() => post(url, body));
  const h = await mountTree({}, { server: srv });
  await pick(h, "B", "Jadikan sub");      // B → anak terakhir A
  rowNode(h.out, 5).props.onKeyDown(key({ key: "ArrowUp", altKey: true, target: { getAttribute: () => "check" } }));
  await h.settle();
  const want = [[1, 0], [2, 1], [3, 2], [5, 1], [4, 1]];
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), want, "dua pindah optimistis");
  gates.shift()(); await h.settle();
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), want, "respons pertama tidak menimpa pindah kedua");
  gates.shift()(); await h.settle();
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), want);
  assert.deepEqual(srv.mutations().map(c => c.body), [{ parent_id: 1, index: 2 }, { parent_id: 1, index: 1 }]);
  // Galat pada yang pertama: yang kedua tidak dikirim.
  srv.fail["POST /move$"] = true;
  await pick(h, "A2", "Naikkan level");
  rowNode(h.out, 1).props.onKeyDown(key({ key: "ArrowDown", altKey: true, target: { getAttribute: () => "check" } }));
  await h.settle();
  while (gates.length) { gates.shift()(); await h.settle(); }
  assert.equal(srv.calls.filter(c => c.url.endsWith("/move")).length, 3, "dari dua pindah terakhir hanya yang pertama dikirim");
  assert.deepEqual(h.toasts, [["Gagal memindah butir", "error"]]);
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), want, "kembali ke daftar server");
});

test("Alt+↑/↓ di elemen mana pun dalam baris: tukar dengan saudara; ujung = tidak terjadi apa-apa", async () => {
  const h = await mountTree();
  const e = key({ key: "ArrowUp", altKey: true, target: { getAttribute: () => "more" } });
  rowNode(h.out, 5).props.onKeyDown(e); await h.settle();
  assert.ok(e.prevented);
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: null, index: 0 });
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [5, 1, 2, 3, 4]);
  const n = h.srv.mutations().length;
  rowNode(h.out, 5).props.onKeyDown(key({ key: "ArrowUp", altKey: true, target: { getAttribute: () => "check" } })); await h.settle();
  assert.equal(h.srv.mutations().length, n, "butir pertama: Alt+↑ tidak mengirim apa pun");
  rowNode(h.out, 2).props.onKeyDown(key({ key: "ArrowDown", altKey: true, target: { getAttribute: () => "grip" } })); await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: 1, index: 1 });
  // Tanpa Alt: diabaikan
  const plain = key({ key: "ArrowUp", target: { getAttribute: () => "check" } });
  rowNode(h.out, 4).props.onKeyDown(plain);
  assert.ok(!plain.prevented);
});

test("ubah teks: klik teks → MentionInput berisi teks lama; Enter simpan trim (optimistis); sama/kosong tanpa permintaan; Escape batal", async () => {
  const h = await mountTree();
  textBtn(h.out, 5).props.onClick(); await h.settle();
  let box = editBox(h.out);
  assert.ok(box, "kotak ubah teks");
  assert.equal(box.props.value, "B"); assert.equal(box.props.autoFocus, true); assert.equal(box.props["data-check-part"], "edit");
  assert.equal(textBtn(h.out, 5), undefined, "tombol teks diganti kotak");
  box.props.onChange({ target: { value: "  B baru  " } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.equal(editBox(h.out), null);
  assert.deepEqual(h.srv.mutations().at(-1), { method: "PATCH", url: "/api/subtasks/5", body: { title: "B baru" } });
  assert.equal(textOf(textBtn(h.out, 5)), "B baru");
  // sama → tanpa permintaan
  const n = h.srv.mutations().length;
  textBtn(h.out, 5).props.onClick(); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  // kosong → kembali ke teks lama
  textBtn(h.out, 5).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "   " } }); await h.settle();
  editBox(h.out).props.onBlur(); await h.settle();
  assert.equal(textOf(textBtn(h.out, 5)), "B baru");
  // Escape → batal (blur sesudahnya tidak menyimpan)
  textBtn(h.out, 5).props.onClick(); await h.settle();
  box = editBox(h.out);
  box.props.onChange({ target: { value: "dibatalkan" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Escape" }));
  box.props.onBlur(); await h.settle();
  assert.equal(h.srv.mutations().length, n, "tanpa permintaan");
  assert.equal(textOf(textBtn(h.out, 5)), "B baru");
  // ⋯ → Ubah teks
  await pick(h, "A1", "Ubah teks");
  assert.equal(editBox(h.out).props.value, "A1");
});

test("galat ubah teks → toast persis, teks kembali ke versi server", async () => {
  const srv = fakeServer(SAMPLE);
  const h = await mountTree({}, { server: srv });
  srv.fail["PATCH /api/subtasks/"] = true;
  textBtn(h.out, 5).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "X" } }); await h.settle();
  editBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.deepEqual(h.toasts, [["Gagal menyimpan teks butir", "error"]]);
  assert.equal(textOf(textBtn(h.out, 5)), "B");
});

test("Tab/Shift+Tab di kotak ubah teks: simpan teks dulu lalu pindah; kotak tetap terbuka di butir yang sama; selalu ditangkap", async () => {
  const h = await mountTree();
  textBtn(h.out, 4).props.onClick(); await h.settle();
  editBox(h.out).props.onChange({ target: { value: "A2 diubah" } }); await h.settle();
  let e = key({ key: "Tab" });
  editBox(h.out).props.onKeyDown(e); await h.settle();
  assert.ok(e.prevented);
  assert.deepEqual(h.srv.mutations().map(c => [c.method, c.url, c.body]), [
    ["PATCH", "/api/subtasks/4", { title: "A2 diubah" }],
    ["POST", "/api/subtasks/4/move", { parent_id: 2, index: 1 }]], "teks lalu pindah (A2 → anak terakhir A1)");
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 2], [5, 0]]);
  assert.ok(editBox(h.out), "kotak tetap terbuka");
  assert.equal(editBox(h.out).props.value, "A2 diubah");
  assert.ok(rowNode(h.out, 4).children.some(c => c && c.type === "MentionInput"), "di baris yang sama");
  // Shift+Tab dua kali: A1 → level atas (setelah A)
  editBox(h.out).props.onKeyDown(key({ key: "Tab", shiftKey: true })); await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: 1, index: 1 });
  editBox(h.out).props.onKeyDown(key({ key: "Tab", shiftKey: true })); await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: null, index: 1 });
  const n = h.srv.mutations().length;
  // level atas: Shift+Tab tidak mungkin → tetap ditangkap, tanpa permintaan
  e = key({ key: "Tab", shiftKey: true });
  editBox(h.out).props.onKeyDown(e); await h.settle();
  assert.ok(e.prevented); assert.equal(h.srv.mutations().length, n);
  assert.equal(h.srv.mutations().filter(c => c.method === "PATCH").length, 1, "teks yang tidak berubah lagi tidak dikirim ulang");
});

test("hapus: konfirmasi «judul» beserta N sub butir hanya bila punya turunan; deleted_ids dibuang", async () => {
  const h = await mountTree({}, { confirm: () => false });
  await pick(h, "A", "Hapus");
  assert.deepEqual(h.confirms, ["Hapus «A» beserta 3 sub butir?"]);
  assert.deepEqual(h.srv.mutations(), [], "batal → tanpa permintaan");
  await pick(h, "B", "Hapus");
  assert.equal(h.confirms.length, 1, "B tanpa turunan: tanpa konfirmasi");
  assert.deepEqual(h.srv.mutations().at(-1), { method: "DELETE", url: "/api/subtasks/5", body: undefined });
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [1, 2, 3, 4]);
  assert.deepEqual(h.counts.at(-1), { done: 0, total: 1, loaded: true });
  assert.equal(h.adopted.at(-1)[1].total, 1);
  const h2 = await mountTree();
  await pick(h2, "A", "Hapus");
  assert.deepEqual(h2.confirms, ["Hapus «A» beserta 3 sub butir?"]);
  assert.deepEqual(rowsOf(h2.out).map(r => r.id), [5], "A beserta turunannya");
  const srv = fakeServer(SAMPLE);
  const h3 = await mountTree({}, { server: srv });
  srv.fail["DELETE /api/subtasks/"] = true;
  await pick(h3, "B", "Hapus");
  assert.deepEqual(h3.toasts, [["Gagal menghapus butir", "error"]]);
  assert.equal(rowsOf(h3.out).length, 5);
});

test("Tambah sub butir: kotak di bawah turunan terakhir, Enter = anak terakhir dan tetap terbuka, Escape/blur kosong menutup, Tab tidak ditangkap", async () => {
  const storage = fakeStorage({ tf_check_collapsed: "[1]" });
  const h = await mountTree({}, { storage });
  await pick(h, "A", "Tambah sub butir");
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [1, 2, 3, 4, 5], "butir terlipat dibuka");
  let box = subBox(h.out);
  assert.ok(box);
  assert.equal(box.props.placeholder, "Sub butir baru"); assert.equal(box.props.autoFocus, true);
  // di dalam li A, setelah ul anak
  const liA = findAll(h.out, n => n.type === "li" && n.props["data-check-id"] === 1)[0];
  const kids = liA.children.filter(Boolean);
  assert.equal(kids.at(-2).type, "ul");
  assert.ok(findAll(kids.at(-1), n => n === box).length === 1, "kotak sesudah ul anak");
  assert.deepEqual(findAll(kids.at(-1), n => n.props && n.props.style && "--td-depth" in n.props.style)[0].props.style, { "--td-depth": 1 });
  const tab = key({ key: "Tab" });
  box.props.onKeyDown(tab);
  assert.ok(!tab.prevented, "Tab tidak ditangkap");
  box.props.onChange({ target: { value: "A3" } }); await h.settle();
  subBox(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  const post = h.srv.mutations().at(-1);
  assert.deepEqual([post.url, post.body.title, post.body.parent_id, "index" in post.body], ["/api/tasks/7/subtasks", "A3", 1, false]);
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 1], [100, 1], [5, 0]]);
  box = subBox(h.out);
  assert.ok(box, "tetap terbuka"); assert.equal(box.props.value, "");
  box.props.onBlur(); await h.settle();
  assert.equal(subBox(h.out), null, "blur saat kosong menutup");
  await pick(h, "B", "Tambah sub butir");
  subBox(h.out).props.onChange({ target: { value: "isi" } }); await h.settle();
  subBox(h.out).props.onBlur(); await h.settle();
  assert.ok(subBox(h.out), "blur berisi teks tidak menutup");
  subBox(h.out).props.onKeyDown(key({ key: "Escape" })); await h.settle();
  assert.equal(subBox(h.out), null);
});

test("autoRefreshMs ditunda selama menu terbuka atau kotak ubah teks terbuka", async () => {
  const h = await mountTree({ autoRefreshMs: 15000 });
  const gets = () => h.srv.calls.filter(c => c.method === "GET").length;
  await openMenu(h, "A");
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 1, "menu terbuka");
  menuOf(h.out).props.onClose(); await h.settle();
  textBtn(h.out, 5).props.onClick(); await h.settle();
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 1, "kotak ubah teks terbuka");
  editBox(h.out).props.onKeyDown(key({ key: "Escape" })); await h.settle();
  h.intervals[0].fn(); await h.settle();
  assert.equal(gets(), 2);
});

test("ChecklistTree (Task 4): teks persis menu/aria/konfirmasi/toast, satu aria-live, Tab hanya di kotak isian", () => {
  const s = fnSource("ChecklistTree");
  for (const t of ['"Ubah teks"', '"Tambah sub butir"', '"Jadikan sub"', '"Naikkan level"', '"Hapus"', '"Ubah teks butir"', '"Sub butir baru"',
    '"Gagal menyimpan teks butir"', '"Gagal memindah butir"', '"Gagal menghapus butir"'])
    assert.ok(s.includes(t), t);
  assert.match(s, /"Hapus «" \+ title \+ "» beserta " \+ n \+ " sub butir\?"/);
  assert.match(s, /"«" \+ \(it\.title \|\| ""\) \+ "» dipindah ke tingkat " \+ \(it\.depth \+ 1\) \+ ", posisi " \+ [^;]+ \+ " dari " \+ sibs\.length \+ "\."/);
  assert.equal((s.match(/"aria-live": "polite"/g) || []).length, 1, "satu pengumuman per komponen");
  for (const re of [/role: "menu"/, /className: "td-menu"/, /role: "menuitem"/, /C\.indentTarget\(/, /C\.outdentTarget\(/, /C\.siblingMoveTarget\(/,
    /C\.applyMove\(/, /C\.descendantIds\(/, /window\.confirm\(/, /api\.patch\(`\/api\/subtasks\/\$\{/, /\/move`, \{\s*parent_id: target\.parent_id,\s*index: target\.index\s*\}/,
    /api\.del\(`\/api\/subtasks\/\$\{/])
    assert.match(s, re);
  // Tab ditangkap hanya di handler kotak isian (kotak bawah, kotak ubah teks); bukan di baris.
  const row = s.slice(s.indexOf("const onRowKey = "), s.indexOf("\n  };", s.indexOf("const onRowKey = ")));
  assert.ok(row.length > 20, "onRowKey ada");
  assert.doesNotMatch(row, /"Tab"/);
});

// ── Task 5: seret ⠿ ──────────────────────────────────────────────────────────────────────────────────────────────

// Dokumen palsu dengan pendengar, dan .td-tree-body palsu: tiap baris tampil 36 px (offsetTop = urutan × 36).
async function mountDrag(extra = {}, env = {}) {
  const listeners = {};
  const doc = {
    activeElement: null, body: { tag: "body" }, documentElement: { tag: "html" }, scrollingElement: { scrollTop: 0 },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    querySelector: () => null
  };
  let h = null;
  const body = {
    scrollTop: 0, scrollHeight: 0, clientHeight: 0, parentElement: null,
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    querySelectorAll: () => rowsOf(h.out).map((r, i) => ({ getAttribute: () => String(r.id), offsetTop: i * 36, offsetHeight: 36 }))
  };
  h = await mountTree(extra, Object.assign({ document: doc, refs: (type, p) => (p.className === "td-tree-body" ? body : null) }, env));
  const fire = (t, ev) => (listeners[t] || []).slice().forEach(f => f(ev));
  const captured = [];
  const down = (title, ev) => one(h.out, `Pindahkan «${title}»`).props.onPointerDown(Object.assign({
    pointerType: "mouse", button: 0, pointerId: 1, currentTarget: { setPointerCapture: id => captured.push(id) }
  }, ev));
  return Object.assign(h, { fire, listeners, down, captured, doc });
}
const lineOf = tree => findAll(tree, n => hasClass(n, "td-tree-line"))[0] || null;
const liOf = (tree, id) => findAll(tree, n => n.type === "li" && n.props["data-check-id"] === id)[0];

test("seret mouse: mulai setelah 6 px, celah dari posisi vertikal, tingkat dari geseran horizontal, jatuh → move", async () => {
  const h = await mountDrag();
  h.down("B", { clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 12, clientY: 160 });
  await h.settle();
  assert.equal(lineOf(h.out), null, "< 6 px: belum mulai");
  // celah sebelum A2 (y 100), geser kanan 40 px = +2 tingkat → dibatasi dropRange {1..3} → 2 (anak A1)
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 50, clientY: 100 });
  await h.settle();
  assert.deepEqual(h.captured, [1], "setPointerCapture");
  assert.deepEqual(lineOf(h.out).props.style, { top: 108, "--td-depth": 2 }, "garis penanda di celah, berindentasi");
  assert.ok(hasClass(liOf(h.out, 5), "is-dragging"), "subtree yang diseret diredupkan");
  assert.ok(findAll(h.out, n => hasClass(n, "td-tree") && hasClass(n, "is-dragging")).length === 1);
  assert.equal((h.listeners.contextmenu || []).length, 1, "menu konteks ditekan selama seret");
  // geser kiri jauh → dibatasi min (tingkat baris di bawah celah = A2, 1)
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: -200, clientY: 100 });
  await h.settle();
  assert.equal(lineOf(h.out).props.style["--td-depth"], 1);
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 50, clientY: 100 });
  h.fire("pointerup", { pointerId: 1 });
  await h.settle();
  assert.equal(lineOf(h.out), null);
  assert.deepEqual(h.srv.mutations().at(-1), { method: "POST", url: "/api/subtasks/5/move", body: { parent_id: 2, index: 1 } });
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [5, 2], [4, 1]]);
  for (const t of ["pointermove", "pointerup", "pointercancel", "keydown", "contextmenu"]) assert.equal((h.listeners[t] || []).length, 0, t + " dilepas");
});

test("seret butir berturunan: turunan ikut; jatuh di posisi sama → tanpa permintaan", async () => {
  const h = await mountDrag();
  // A (dengan A1, A1a, A2) ke bawah B: baris tanpa subtree A = [B] (B tetap di posisinya, 144–180 px);
  // y 170 (> tengah B) → celah 1, tingkat 0
  h.down("A", { clientX: 10, clientY: 10 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 170 });
  h.fire("pointerup", { pointerId: 1 });
  await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: null, index: 1 });
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[5, 0], [1, 0], [2, 1], [3, 2], [4, 1]]);
  const n = h.srv.mutations().length;
  h.down("B", { clientX: 10, clientY: 10 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 2 });
  h.fire("pointerup", { pointerId: 1 });
  await h.settle();
  assert.equal(h.srv.mutations().length, n, "posisi sama → dropTarget null");
});

test("seret ke butir terlipat: jadi anak terakhirnya dan butir itu dibuka", async () => {
  const storage = fakeStorage({ tf_check_collapsed: "[1]" });
  const h = await mountDrag({}, { storage });
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [1, 5]);
  h.down("B", { clientX: 10, clientY: 50 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 30, clientY: 50 });
  h.fire("pointerup", { pointerId: 1 });
  await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: 1, index: 2 });
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[1, 0], [2, 1], [3, 2], [4, 1], [5, 1]]);
  assert.deepEqual(JSON.parse(storage.m.get("tf_check_collapsed")), []);
});

test("seret: Escape membatalkan; pointerup yang hilang (tombol lepas) dan pointercancel membongkar tanpa pindah", async () => {
  const h = await mountDrag();
  h.down("B", { clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 20 });
  await h.settle();
  assert.ok(lineOf(h.out));
  let esc = key({ key: "Escape" });
  h.fire("keydown", esc);
  await h.settle();
  assert.ok(esc.prevented);
  assert.equal(lineOf(h.out), null);
  h.fire("pointerup", { pointerId: 1 });
  await h.settle();
  h.down("B", { clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 20 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 0, clientX: 10, clientY: 10 });
  await h.settle();
  assert.equal(lineOf(h.out), null, "tombol mouse sudah lepas → bongkar");
  assert.equal((h.listeners.pointerup || []).length, 0);
  h.down("B", { clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 20 });
  h.fire("pointercancel", { pointerId: 1 });
  await h.settle();
  assert.equal(lineOf(h.out), null);
  assert.deepEqual(h.srv.mutations(), [], "tanpa permintaan");
});

test("seret sentuh: tahan 250 ms memulai; bergeser lebih dulu = gulir (tanpa seret)", async () => {
  const h = await mountDrag();
  h.down("B", { pointerType: "touch", clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 150 });
  h.runTimers();
  await h.settle();
  assert.equal(lineOf(h.out), null, "geser ≥ 6 px sebelum 250 ms → gulir biasa");
  assert.equal((h.listeners.pointermove || []).length, 0);
  h.down("B", { pointerType: "touch", clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 11, clientY: 163 });
  h.runTimers(); // 250 ms berlalu tanpa bergeser
  await h.settle();
  assert.ok(lineOf(h.out), "seret mulai");
  h.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 11, clientY: 10 });
  h.fire("pointerup", { pointerId: 1 });
  await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body, { parent_id: null, index: 0 });
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [5, 1, 2, 3, 4]);
});

test("seret menunda autoRefreshMs; sumber memakai pola seret pin sidebar + TF.checklist", async () => {
  const h = await mountDrag({ autoRefreshMs: 15000 });
  h.down("B", { clientX: 10, clientY: 162 });
  h.fire("pointermove", { pointerId: 1, pointerType: "mouse", buttons: 1, clientX: 10, clientY: 20 });
  await h.settle();
  h.intervals[0].fn(); await h.settle();
  assert.equal(h.srv.calls.filter(c => c.method === "GET").length, 1, "ditunda selama seret");
  const s = fnSource("ChecklistTree");
  for (const re of [/kanbanDragStart\(e, Date\.now\(\)\)/, /kanbanDragShouldStart\(start, ev, Date\.now\(\)\)/, /setPointerCapture\(s\.pointerId\)/,
    /addEventListener\("touchmove", h, \{\s*passive: false\s*\}\)/, /ev\.cancelable\) ev\.preventDefault\(\)/, /addEventListener\("contextmenu", preventMenu\)/,
    /addEventListener\("pointercancel", onCancel\)/, /ev\.buttons === 0/, /ev\.key !== "Escape"/, /C\.dropRange\(s\.rows, gap\)/,
    /C\.dropTarget\(itemsRef\.current, rows, id, gap, depth\)/, /C\.autoScrollDelta\(s\.y, rect\)/, /requestAnimationFrame\(tick\)/,
    /matchMedia\("\(max-width: 640px\)"\)\.matches \? 16 : 20/, /Math\.round\(\(s\.x - start\.x\) \/ s\.indent\)/, /C\.descendantIds\(cur, id\)/,
    /offsetTop/, /className: "td-tree-line"/])
    assert.match(s, re);
  assert.equal((s.match(/onPointerDown:/g) || []).length, 1, "seret hanya dari pegangan ⠿");
  const block = detailBlock();
  assert.match(block, /\.td-tree-item\.is-dragging\s*\{[^}]*opacity:/);
  assert.match(block, /\.td-tree-line\s*\{[^}]*position:\s*absolute;[^}]*background:\s*var\(--accent\);[^}]*pointer-events:\s*none/);
  assert.match(block, /\.td-tree-grip\s*\{[^}]*touch-action:\s*manipulation;[^}]*user-select:\s*none;[^}]*-webkit-touch-callout:\s*none/);
});

// ── Task 6: kunci Progress (pill + form edit lengkap) ────────────────────────────────────────────────────────────

function renderPill(props) {
  const clampCalls = [];
  const opened = [];
  const h = mountComp(["ProgressPill"], Object.assign({
    value: 33, open: true, onToggle() {}, onClose() {}, onChange() { throw new Error("onChange saat terkunci"); },
    onCommit() {}, onOpenChecklist: () => opened.push(1)
  }, props), {
    window: { TF: { taskdetail: { clampProgress: v => { clampCalls.push(v); return Math.round(Number(v) / 5) * 5; }, PROGRESS_PRESETS: [0, 25, 50, 75, 100] } } }
  });
  return { out: h.out, clampCalls, opened };
}

test("ProgressPill terkunci: angka checklist apa adanya, aria-label, slider nonaktif, tanpa preset, keterangan, Buka Checklist", () => {
  const { out, clampCalls, opened } = renderPill({ locked: { done: 1, total: 3, percent: 33 } });
  assert.deepEqual(clampCalls, [], "tampilan terkunci tidak memakai clampProgress (33 tetap 33, bukan 35)");
  const pill = findAll(out, n => n.type === "button" && hasClass(n, "td-pill"))[0];
  assert.equal(pill.props["aria-label"], "Progress 33%, otomatis dari checklist");
  assert.ok(textOf(pill).includes("33%"));
  const range = findAll(out, n => n.type === "input" && n.props.type === "range")[0];
  assert.equal(range.props.disabled, true);
  assert.equal(range.props.value, 33);
  assert.equal(findAll(out, n => hasClass(n, "td-presets")).length, 0, "preset 0/25/50/75/100 tidak dirender");
  assert.ok(textOf(out).includes("Otomatis dari checklist (1/3)"));
  const btn = findAll(out, n => n.type === "button" && textOf(n) === "Buka Checklist")[0];
  assert.ok(btn);
  btn.props.onClick();
  assert.deepEqual(opened, [1]);
  // C4: judul dan label popover "Progress" (bukan "Ubah Progress") saat terkunci
  const pop = findAll(out, n => n.type === "DetailPopover")[0];
  assert.equal(pop.props.label, "Progress");
  assert.equal(textOf(findAll(pop, n => hasClass(n, "td-pop-title"))[0]).replace(/\d+%$/, ""), "Progress");
  // S2: elemen pertama yang bisa difokus di popover = "Buka Checklist" (slider nonaktif dilewati DetailPopover)
  const focusable = findAll(pop, n => (n.type === "input" || n.type === "button") && !n.props.disabled);
  assert.equal(textOf(focusable[0]), "Buka Checklist");
});

test("S2: DetailPopover memfokuskan input/button pertama yang tidak nonaktif", () => {
  const p = fnSource("DetailPopover");
  assert.match(p, /el\.querySelector\("input:not\(\[disabled\]\), button:not\(\[disabled\]\)"\)/);
  assert.doesNotMatch(p, /querySelector\("input, button"\)/);
});

test("ProgressPill: hitungan belum dimuat (pending) → nilai task apa adanya, tanpa (d/t); tidak terkunci → seperti sebelumnya", () => {
  const p = renderPill({ value: 67, locked: { pending: true } });
  assert.deepEqual(p.clampCalls, []);
  const pill = findAll(p.out, n => n.type === "button" && hasClass(n, "td-pill"))[0];
  assert.equal(pill.props["aria-label"], "Progress 67%, otomatis dari checklist");
  const note = findAll(p.out, n => hasClass(n, "td-progress-note"))[0];
  assert.equal(textOf(note), "Otomatis dari checklist");
  const u = renderPill({ value: 33, locked: null, onChange() {} });
  assert.ok(u.clampCalls.length > 0, "manual: dibulatkan seperti sebelumnya");
  const upill = findAll(u.out, n => n.type === "button" && hasClass(n, "td-pill"))[0];
  assert.equal(upill.props["aria-label"], "Progress 35%");
  const upop = findAll(u.out, n => n.type === "DetailPopover")[0];
  assert.equal(upop.props.label, "Ubah Progress");
  assert.equal(textOf(findAll(upop, n => hasClass(n, "td-pop-title"))[0]), "Ubah Progress35%");
  assert.equal(findAll(u.out, n => hasClass(n, "td-presets")).length, 1);
  assert.equal(findAll(u.out, n => n.type === "input" && n.props.type === "range")[0].props.disabled, false);
  assert.equal(findAll(u.out, n => textOf(n) === "Buka Checklist").length, 0);
});

test("TaskDetailBody: kunci dari TF.checklist.lockFor(task, checkCounts); Live Edit tidak menyimpan progress saat terkunci", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /const progressLock = window\.TF\.checklist\.lockFor\(task, checkCounts\);/);
  assert.match(s, /locked: progressLock,/);
  assert.match(s, /onProgressChange: p => \{\s*if \(!progressLock\) sf\("progress", p\);\s*\}/);
  assert.match(s, /onProgressCommit: \(\) => \{\s*if \(!progressLock\) auto\.commit\("progress"\);\s*\}/);
  assert.match(s, /onOpenChecklist: \(\) => \{\s*setOpenPop\(null\);\s*pickTab\("checklist"\);/);
  const c = fnSource("DetailChips");
  assert.match(c, /locked: locked,\s*onOpenChecklist: onOpenChecklist/);
  const pp = fnSource("ProgressPill");
  for (const t of ['"Otomatis dari checklist (" + locked.done + "/" + locked.total + ")"', '"Otomatis dari checklist"', '"Buka Checklist"',
    '", otomatis dari checklist"'])
    assert.ok(pp.includes(t), t);
  assert.doesNotMatch(pp, EMOJI);
});

test("S1 detail: scheduleRefresh = debounce 500 ms (onSaved dan onProgress); setelah unmount langsung", () => {
  const s = fnSource("TaskDetailBody");
  const a = s.indexOf("const scheduleRefresh = () =>");
  assert.ok(a > 0, "scheduleRefresh ada");
  const code = s.slice(a, s.indexOf("\n  };", a) + 5);
  const timers = [];
  const refreshed = [];
  const make = new Function("liveMountedRef", "refreshTimerRef", "onRefreshRef", "setTimeout", "clearTimeout", code + "\nreturn scheduleRefresh;");
  const mounted = { current: true };
  const timer = { current: null };
  const sched = make(mounted, timer, { current: () => refreshed.push(1) },
    (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, h => { if (h) timers[h - 1].cleared = true; });
  sched(); sched(); sched();
  assert.deepEqual(timers.map(t => [t.ms, !!t.cleared]), [[500, true], [500, true], [500, false]]);
  timers.filter(t => !t.cleared).forEach(t => t.fn());
  assert.deepEqual(refreshed, [1], "tiga aksi beruntun → satu refresh");
  assert.equal(timer.current, null);
  mounted.current = false;
  sched();
  assert.deepEqual(refreshed, [1, 1], "sesudah unmount: langsung");
  assert.match(s, /const onSaved = patch => \{[\s\S]{0,700}scheduleRefresh\(\);\s*\};/);
  assert.doesNotMatch(s.slice(s.indexOf("const onSaved = patch =>"), s.indexOf("const auto = useTaskAutosave")), /setTimeout/,
    "onSaved memakai scheduleRefresh");
});

test("Live Edit: commit progress tanpa perubahan (pill terkunci ditutup) tidak mengirim PUT; angka baru dari luar diadopsi tanpa disimpan", async () => {
  const le = require("../../static/offline/liveedit.js");
  const calls = [];
  const s = le.createAutosaver({ task: { id: 7, cid: "c7", title: "T", priority: "P3", gtd_status: "next", progress: 0 },
    put: patch => { calls.push(patch); return Promise.resolve(undefined); }, onChange() {}, setTimer: () => 0, clearTimer() {} });
  s.commit("progress"); await tick();
  assert.deepEqual(calls, []);
  // adoptTaskProgress → daftar dimuat ulang → task baru (progress 33) masuk lewat external/mergeExternal
  s.external({ id: 7, cid: "c7", title: "T", priority: "P3", gtd_status: "next", progress: 33, checklist_total: 3 });
  assert.equal(s.getState().form.progress, 33);
  s.commit("progress"); await tick();
  await s.flush();
  assert.deepEqual(calls, [], "angka dari checklist tidak disimpan ulang oleh Live Edit");
  s.change("priority", "P1"); await tick();
  assert.deepEqual(calls, [{ priority: "P1" }], "simpan field lain tidak membawa progress");
  assert.match(fnSource("useTaskAutosave"), /external: saver\.external/, "detail meneruskan angka checklist ke form (modal)");
});

test("TaskFormModal: checklist_total > 0 → slider nonaktif + 'Otomatis dari checklist', progress tidak dikirim saat simpan", () => {
  const f = fnSource("TaskFormModal");
  assert.match(f, /const progressLocked = isEdit && Number\(task\?\.checklist_total\) > 0;/);
  assert.match(f, /disabled: progressLocked,/);
  assert.match(f, /progressLocked && \/\*#__PURE__\*\/React\.createElement\("div", \{[\s\S]{0,200}\}, "Otomatis dari checklist"\)/);
  const put = f.slice(f.indexOf("if (isEdit) {", f.indexOf("// ── Task mode")), f.indexOf("onSave();", f.indexOf("// ── Task mode")));
  assert.match(put, /const body = \{\s*\.\.\.form,\s*\.\.\.recurrencePayload\s*\};\s*if \(progressLocked\) delete body\.progress;\s*await api\.put\(`\/api\/tasks\/\$\{task\.id\}`, body\);/);
});

test("CSS kunci Progress di blok detail: token saja", () => {
  const block = detailBlock();
  assert.match(block, /\.td-progress-lock\s*\{/);
  assert.match(block, /\.td-progress-note\s*\{[^}]*color: var\(--text-secondary\)/);
});

// ── Task 7: halaman Fokus ────────────────────────────────────────────────────────────────────────────────────────

async function mountFocus(env = {}) {
  const srv = env.server || fakeServer(env.rows || SAMPLE);
  const reported = [];
  const refreshed = [];
  const h = mountComp(["FocusSubtasks", "ChecklistTree"], { taskId: 7, task: { id: 7, server_id: 7 }, onCount: (id, c) => reported.push([id, c]) },
    Object.assign({ api: srv.api, inline: true, window: { __refreshTasks: () => refreshed.push(1) } }, env));
  await h.settle();
  return Object.assign(h, { srv, reported, refreshed });
}
const focusInput = tree => findAll(tree, n => n.type === "input" && n.props["aria-label"] === "Item checklist baru")[0];
const focusAddBtn = tree => findAll(tree, n => n.type === "button" && hasClass(n, "btn-primary"))[0];

test("FocusSubtasks: cangkang lama + ChecklistTree variant focus (15 dtk), badge level atas", async () => {
  const s = fnSource("FocusSubtasks");
  for (const re of [/React\.createElement\(ChecklistTree, \{/, /variant: "focus"/, /autoRefreshMs: 15000/, /onCounts: setCounts/,
    /onProgress: scheduleRefresh/, /setTimeout\(\(\) => \{\s*refreshTimerRef\.current = null;\s*window\.__refreshTasks\?\.\(\);\s*\}, 500\)/, /key: String\(taskId\)/, /renderAdd: add =>/, /className: "ftask-add td-tree-add"/,
    /style: add\.style/, /onKeyDown: add\.onKeyDown/, /onClick: add\.submit/])
    assert.match(s, re);
  for (const re of [/setInterval/, /api\.(get|post)/, /ftask-sublist/, /setSubtasks/]) assert.doesNotMatch(s, re);
  assert.match(fnSource("FocusTaskItem"), /React\.createElement\(FocusSubtasks, \{\s*taskId: task\.id,\s*task: task,\s*onCount: onCount\s*\}\)/);
  const h = await mountFocus();
  assert.deepEqual(h.reported, [[7, { subDone: 0, subTotal: 2 }]], "hanya butir level atas");
  assert.deepEqual(rowsOf(h.out).map(r => r.id), [1, 2, 3, 4, 5]);
  const bar = findAll(h.out, n => n.props.role === "progressbar")[0];
  assert.equal(bar.props["aria-label"], "0 dari 2 item checklist selesai");
  assert.ok(textOf(bar).includes("0/2 selesai"));
  assert.ok(findAll(h.out, n => hasClass(n, "td-tree") && hasClass(n, "is-focus")).length === 1);
  assert.equal(h.intervals.length, 1); assert.equal(h.intervals[0].ms, 15000);
  // centang level atas → badge + daftar Fokus disegarkan
  one(h.out, "B").props.onClick(); await h.settle();
  assert.deepEqual(h.reported.at(-1), [7, { subDone: 1, subTotal: 2 }]);
  assert.deepEqual(h.refreshed, [], "ditunda 500 ms (S1)");
  h.runTimers(); await h.settle();
  assert.deepEqual(h.refreshed, [1], "onProgress → window.__refreshTasks");
  // centang sub butir → badge tetap
  const n = h.reported.length;
  one(h.out, "A1a").props.onClick(); await h.settle();
  assert.equal(h.reported.length, n);
});

test("FocusSubtasks: kotak tambah (Tab/Shift+Tab menjorok, Enter / Tambah), Escape mengosongkan; kosong → 'Belum ada checklist.'", async () => {
  const h = await mountFocus({ rows: [] });
  assert.ok(textOf(h.out).includes("Belum ada checklist."));
  assert.equal(findAll(h.out, n => n.props.role === "progressbar").length, 0);
  let inp = focusInput(h.out);
  assert.equal(inp.props.placeholder, "Tambah item checklist, tekan Enter");
  assert.equal(textOf(focusAddBtn(h.out)), "Tambah");
  assert.equal(focusAddBtn(h.out).props.disabled, true);
  inp.props.onChange({ target: { value: "Satu" } }); await h.settle();
  focusInput(h.out).props.onKeyDown(key({ key: "Enter" })); await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body.parent_id, null);
  assert.equal(focusInput(h.out).props.value, "");
  assert.ok(!textOf(h.out).includes("Belum ada checklist."));
  assert.deepEqual(h.reported.at(-1), [7, { subDone: 0, subTotal: 1 }]);
  // Tab → sub butir dari butir terakhir; kotak menjorok
  focusInput(h.out).props.onChange({ target: { value: "Sub" } }); await h.settle();
  const tab = key({ key: "Tab" });
  focusInput(h.out).props.onKeyDown(tab); await h.settle();
  assert.ok(tab.prevented);
  const wrap = findAll(h.out, n => hasClass(n, "ftask-add"))[0];
  assert.deepEqual(wrap.props.style, { "--td-depth": 1 });
  focusAddBtn(h.out).props.onClick(); await h.settle();
  assert.deepEqual(h.srv.mutations().at(-1).body.parent_id, 100);
  assert.deepEqual(rowsOf(h.out).map(r => [r.id, r.depth]), [[100, 0], [101, 1]]);
  assert.deepEqual(h.reported.at(-1), [7, { subDone: 0, subTotal: 1 }], "sub butir tidak menambah badge");
  focusInput(h.out).props.onChange({ target: { value: "dibuang" } }); await h.settle();
  focusInput(h.out).props.onKeyDown(key({ key: "Escape" })); await h.settle();
  assert.equal(focusInput(h.out).props.value, "");
  assert.deepEqual(findAll(h.out, n => hasClass(n, "ftask-add"))[0].props.style, { "--td-depth": 0 });
});

test("S1 Fokus: tiga aksi yang mengubah progress beruntun cepat → satu __refreshTasks; unmount mengirim yang tertunda", async () => {
  const h = await mountFocus();
  one(h.out, "B").props.onClick(); await h.settle();
  one(h.out, "A").props.onClick(); await h.settle();
  one(h.out, "B").props.onClick(); await h.settle();
  assert.deepEqual(h.refreshed, []);
  h.runTimers(); await h.settle();
  assert.deepEqual(h.refreshed, [1], "satu refresh");
  one(h.out, "A").props.onClick(); await h.settle();
  h.unmount();
  assert.deepEqual(h.refreshed, [1, 1], "refresh tertunda dikirim saat panel ditutup");
  h.runTimers();
  assert.deepEqual(h.refreshed, [1, 1], "tanpa refresh ganda");
});

test("CSS Fokus: daftar bergulir sendiri (pengganti .ftask-sublist), kotak tambah menjorok; token saja", () => {
  const block = detailBlock();
  assert.match(block, /\.td-tree\.is-focus \.td-tree-body\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/);
  assert.match(block, /\.td-tree-add\s*\{\s*padding-inline-start:\s*calc\(var\(--td-depth, 0\) \* 20px\)/);
});

// ── Review akhir PR B ────────────────────────────────────────────────────────────────────────────────────────────

test("S1 menu ⋯: item nonaktif tampak nonaktif (redup, cursor not-allowed, tanpa latar hover) — blok detail, token", () => {
  const block = detailBlock();
  assert.match(block, /\.td-pop-item:disabled\s*\{[^}]*opacity:\s*0?\.45;[^}]*cursor:\s*not-allowed;/);
  assert.match(block, /\.td-pop-item:disabled:hover\s*\{\s*background:\s*none;/);
});

test("S3 Fokus offline: muat gagal → onCount tidak dipanggil (badge child-counts tetap) dan tanpa 'Belum ada checklist.'", async () => {
  const srv = fakeServer(SAMPLE);
  srv.fail["GET /subtasks$"] = true;
  const h = await mountFocus({ server: srv });
  assert.deepEqual(h.reported, [], "badge dari child-counts / cache SW tidak ditimpa 0/0");
  assert.ok(!textOf(h.out).includes("Belum ada checklist."));
  assert.ok(focusInput(h.out), "kotak tambah tetap ada");
  srv.fail["GET /subtasks$"] = false;
  h.intervals[0].fn(); await h.settle();
  assert.deepEqual(h.reported, [[7, { subDone: 0, subTotal: 2 }]], "berhasil dimuat kemudian → badge diperbarui");
  // daftar memang kosong (berhasil dimuat setelah gagal) → pesan kosong + badge 0/0
  const srv2 = fakeServer([]);
  srv2.fail["GET /subtasks$"] = true;
  const h2 = await mountFocus({ server: srv2 });
  assert.ok(!textOf(h2.out).includes("Belum ada checklist."));
  srv2.fail["GET /subtasks$"] = false;
  h2.intervals[0].fn(); await h2.settle();
  assert.ok(textOf(h2.out).includes("Belum ada checklist."));
  assert.deepEqual(h2.reported, [[7, { subDone: 0, subTotal: 0 }]]);
  const f = fnSource("FocusSubtasks");
  assert.match(f, /if \(counts\.loaded && !counts\.failed\) onCount\?\.\(taskId, \{/);
  assert.match(f, /total === 0 && counts\.loaded && !counts\.failed && React\.createElement\("div", \{\s*className: "ftask-empty"/);
});

test("C1 detail: hitungan checklist milik task.id — ganti task tanpa remount tidak menampilkan hitungan/kunci task lama", () => {
  const s = fnSource("TaskDetailBody");
  const a = s.indexOf("const [checkCountsOf, setCheckCountsOf] = useState(");
  assert.ok(a > 0, "hitungan per task");
  const b = s.indexOf("\n  });", s.indexOf("const setCheckCounts = c =>", a)) + 6;
  const code = s.slice(a, b);
  const slots = [];
  const run = task => {
    let i = 0;
    const useState = init => {
      const k = i++;
      if (!(k in slots)) slots[k] = init;
      return [slots[k], v => { slots[k] = v; }];
    };
    return new Function("useState", "task", code + "\nreturn { checkCounts, setCheckCounts };")(useState, task);
  };
  const A = { id: 41, checklist_total: 3 }, B = { id: 42, checklist_total: 0 };
  assert.deepEqual(run(A).checkCounts, { done: 0, total: 0, loaded: false });
  run(A).setCheckCounts({ done: 1, total: 3, loaded: true });
  assert.deepEqual(run(A).checkCounts, { done: 1, total: 3, loaded: true });
  const onB = run(B).checkCounts;
  assert.deepEqual(onB, { done: 0, total: 0, loaded: false }, "task lain: belum dimuat (label, bar, tab awal menunggu)");
  assert.equal(C.lockFor(B, onB), null, "kunci pill task lama tidak terbawa");
  run(B).setCheckCounts({ done: 0, total: 0, loaded: true });
  assert.deepEqual(run(B).checkCounts, { done: 0, total: 0, loaded: true });
  assert.deepEqual(run(A).checkCounts, { done: 0, total: 0, loaded: false }, "kembali ke A: menunggu muat ulang A");
  // ChecklistTree dipasang ulang per task (items, antrean, task_progress terakhir, kotak/menu ikut baru).
  assert.match(s, /React\.createElement\(ChecklistTree, \{\s*key: String\(task\.id\),\s*taskId: task\.id,/);
  assert.match(fnSource("FocusSubtasks"), /React\.createElement\(ChecklistTree, \{\s*key: String\(taskId\),\s*taskId: taskId,/);
});

// ── Detail (R5) ──────────────────────────────────────────────────────────────────────────────────────────────────

test("TaskDetailBody: tab Checklist = ChecklistTree variant detail; state checklist lama dihapus", () => {
  const s = fnSource("TaskDetailBody");
  for (const re of [/React\.createElement\(ChecklistTree, \{/, /variant: "detail"/, /onCounts: setCheckCounts/,
    /onProgress: tp => \{[\s\S]{0,300}auto\.external\(Object\.assign\(\{\}, task, auto\.getState\(\)\.saved, \{\s*progress: tp\.progress,[\s\S]{0,120}scheduleRefresh\(\);\s*\}/,
    /key: String\(task\.id\)/,
    /const \[checkCountsOf, setCheckCountsOf\] = useState\(\{\s*id: null,\s*counts: null\s*\}\)/])
    assert.match(s, re);
  for (const re of [/\[subtasks, setSubtasks\]/, /setSubtasks\(/, /subtasks\.(?:filter|length|map)/, /\/api\/tasks\/\$\{task\.id\}\/subtasks/,
    /loadingSubs/, /\bnewSub\b/, /setNewSub/, /addingSub/, /subClientId/, /handleToggle\b/, /handleAddSub/, /handleDeleteSub/,
    /const \[adding, setAdding\]/, /\/api\/subtasks\//, /totalSubs/, /doneCount/])
    assert.doesNotMatch(s, re);
  // Tab Subtask (task anak) tetap utuh.
  for (const re of [/const \[childTasks, setChildTasks\]/, /handleAddChildTask/, /handleToggleChild/, /"\+ Buat subtask baru(?:…|\\u2026)"/])
    assert.match(s, re);
});

test("TaskDetailBody: label tab dan initialTab dari hitungan level atas; bar d/t dari counts; tab awal menunggu loaded", () => {
  const s = fnSource("TaskDetailBody");
  assert.match(s, /id: "checklist",\s*label: "Checklist",\s*count: checkCounts\.total/);
  assert.match(s, /checklist: checkCounts\.total/);
  assert.match(s, /!checkCounts\.loaded \|\| notesCount === null/);
  assert.match(s, /\}, \[childLoaded, checkCounts\.loaded, notesCount, attCount\]\);/);
  const panel = s.slice(s.indexOf('tabPanel("checklist",'), s.indexOf('tabPanel("notes",'));
  for (const re of [/checkCounts\.total > 0 &&/, /className: "td-check-bar"/, /window\.TF\.checklist\.percent\(checkCounts\.done, checkCounts\.total\)/,
    /checkCounts\.done, "\/", checkCounts\.total/, /"Memuat…"|"Memuat\\u2026"/, /"\+ Tambah butir checklist baru"/, /"Belum ada checklist"/,
    /placeholder: "Butir checklist baru"/, /"aria-label": "Butir checklist baru"/, /React\.createElement\(MentionInput/, /onKeyDown: add\.onKeyDown/,
    /onBlur: add\.onBlur/, /style: add\.style/, /renderAdd: add =>/])
    assert.match(panel, re);
});
