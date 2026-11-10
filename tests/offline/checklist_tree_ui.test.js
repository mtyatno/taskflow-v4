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
    createElement: (type, p, ...children) => ({ type, props: p || {}, children: children.flat(Infinity) }),
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
    setTimeout: (fn) => { fn(); return 0; }, clearTimeout: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    kanbanDragStart: (e, now) => ({ pointerType: e.pointerType || "mouse", x: e.clientX, y: e.clientY, t: now }),
    kanbanDragShouldStart: () => false,
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
    taskId: 7, task: { id: 7, server_id: 7 }, collaborators: [], variant: "detail",
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
  assert.deepEqual(h.counts, [{ done: 0, total: 0, loaded: true }]);
  assert.deepEqual(h.toasts, [], "muat pertama yang gagal tidak memunculkan toast");
});

test("ChecklistTree: task belum tersinkron (id = cid) → tanpa permintaan, daftar kosong, 0/0", async () => {
  const h = await mountTree({ taskId: "c-abc", task: { id: "c-abc", cid: "c-abc" } });
  assert.deepEqual(h.srv.calls, []);
  assert.deepEqual(rowsOf(h.out), []);
  assert.deepEqual(h.counts, [{ done: 0, total: 0, loaded: true }]);
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

// ── Detail (R5) ──────────────────────────────────────────────────────────────────────────────────────────────────

test("TaskDetailBody: tab Checklist = ChecklistTree variant detail; state checklist lama dihapus", () => {
  const s = fnSource("TaskDetailBody");
  for (const re of [/React\.createElement\(ChecklistTree, \{/, /variant: "detail"/, /onCounts: setCheckCounts/,
    /onProgress: \(\) => onRefreshRef\.current\?\.\(\)/, /key: String\(task\.id\)/,
    /const \[checkCounts, setCheckCounts\] = useState\(\{\s*done: 0,\s*total: 0,\s*loaded: false\s*\}\)/])
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
