"use strict";

// UI pemilihan task halaman Fokus: satu definisi cakupan "hari ini" (focusfilter.inTodayScope,
// tanggal lokal) dipakai Sidebar, Dashboard, dan App.getFilteredTasks.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");

function fnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

test("Sidebar, Dashboard, App: cakupan hari ini dari focusfilter.inTodayScope", () => {
  for (const name of ["Sidebar", "Dashboard", "App"]) {
    const src = fnSource(name);
    assert.ok(src.includes("focusfilter.inTodayScope("), `${name} harus memakai focusfilter.inTodayScope(`);
    assert.ok(
      !src.includes('t.quadrant === "Q1" || t.is_overdue'),
      `${name} tidak boleh lagi memuat definisi cakupan lama (Q1 || is_overdue)`
    );
  }
});

test("Sidebar: todayCount memakai tanggal lokal dan task fokus aktif", () => {
  const src = fnSource("Sidebar");
  assert.match(
    src,
    /const todayCount = \(tasks \|\| \[\]\)\.filter\(t => window\.TF\.focusfilter\.inTodayScope\(t, \{ todayISO(?:: [^,}]+)?, focusTaskId \}\)\)\.length;/
  );
  assert.match(src, /const todayISO = window\.TF\.tasklogic\.todayLocalISO\(\);/);
  // done tidak dihitung di badge sidebar (includeDone hanya untuk Dashboard)
  assert.ok(!src.includes("includeDone"));
});

test("Dashboard: todayStr lokal, allToday includeDone, pengurutan memakai timeBucket", () => {
  const src = fnSource("Dashboard");
  assert.ok(!src.includes('toISOString().split("T")[0]'), "todayStr tidak boleh memakai tanggal UTC");
  assert.match(src, /const todayStr = window\.TF\.tasklogic\.todayLocalISO\(\);/);
  assert.match(
    src,
    /const allToday = tasks\.filter\(t => window\.TF\.focusfilter\.inTodayScope\(t, \{ todayISO: todayStr, includeDone: true \}\)\);/
  );
  assert.ok(src.includes("includeDone: true"));
  // pendingToday: terlambat dulu menurut bucket lokal, bukan is_overdue server (basi)
  const pend = src.slice(src.indexOf("const pendingToday"), src.indexOf("const visibleDone"));
  assert.ok(pend.includes('window.TF.focusfilter.timeBucket(a, todayStr) === "late"'));
  assert.ok(pend.includes('window.TF.focusfilter.timeBucket(b, todayStr) === "late"'));
  assert.ok(!pend.includes("is_overdue"));
  assert.ok(pend.includes("SORT_PRI(a, b)"));
  // kelas baris kartu tidak diubah
  assert.ok(src.includes("is-overdue"));
});

test("App.getFilteredTasks: kasus today memakai tanggal lokal tanpa done/archived", () => {
  const src = fnSource("App");
  const start = src.indexOf('case "today":');
  assert.ok(start >= 0);
  const block = src.slice(start, src.indexOf('case "all":', start));
  assert.ok(block.includes("window.TF.tasklogic.todayLocalISO()"));
  assert.match(block, /window\.TF\.focusfilter\.inTodayScope\(t, \{ todayISO \}\)/);
  assert.ok(!block.includes("includeDone"));
});

// ── Task 4: seksi Target, kelompok Workspace › Project, ⭐ di baris task ─────────────────────

const ff = require("../../static/offline/focusfilter.js");
const pomologic = require("../../static/offline/pomologic.js");

// Rakit komponen dari sumber index.html dengan React palsu: createElement hanya mencatat
// {type, props, children}, sehingga pohon yang dikembalikan komponen bisa diperiksa tanpa DOM.
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
};
function loadComponents(names, globals) {
  const src = names.map(n => fnSource(n) + "\n}").join("\n");
  const keys = Object.keys(globals);
  return new Function(...keys, `${src}\nreturn { ${names.join(", ")} };`)(...keys.map(k => globals[k]));
}
function findAll(node, pred, out = []) {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach(n => findAll(n, pred, out)); return out; }
  if (node.type !== undefined && pred(node)) out.push(node);
  findAll(node.children, pred, out);
  return out;
}
const hasClass = (node, cls) => typeof node.props.className === "string" && node.props.className.split(/\s+/).includes(cls);
// Stub EmptyState (Tema PR C) membawa teksnya di props title/hint, bukan di children.
const textOf = node => (node.type === "EmptyState" ? [node.props.title, node.props.hint].filter(Boolean).join(" ") : "") +
  (node.children || []).map(c => (typeof c === "object" && c ? textOf(c) : String(c))).join("");

const NOOP = () => {};
const TODAY = "2026-10-22";
function itemGlobals() {
  const stub = () => null;
  return {
    React: fakeReact,
    window: { TF: { pomologic, focusfilter: ff, tasklogic: { todayLocalISO: () => TODAY } } },
    GTD_LABELS: { next: "Next", inbox: "Inbox", waiting: "Waiting", someday: "Someday" },
    GTD_ICON: {}, QUAD_ICON: {}, QUAD_LABELS: {},
    PriBadge: stub, Icon: stub, FocusGlyph: stub, ViewGlyph: stub,
    FocusNotes: stub, FocusAttachments: stub, FocusSubtasks: stub,
    FOCUS_TABS: [{ key: "subtasks", label: "Checklist", glyph: "subtasks" }],
    formatDate: d => String(d)
  };
}
function renderItem(props) {
  const { FocusTaskItem } = loadComponents(["FocusTaskItem"], itemGlobals());
  return FocusTaskItem({ open: false, onToggle: NOOP, tab: "subtasks", onTab: NOOP, onCount: NOOP, onOpenDetail: NOOP, onDone: NOOP, onStartFocus: NOOP, onEstimate: NOOP, ...props });
}
const baseTask = { id: 7, title: "Revisi landing", gtd_status: "next", priority: "P2", quadrant: "Q1", project: "Alurik" };

test("FOCUS_GLYPHS: star, sliders, search dalam gaya garis glyph lain", () => {
  const start = indexHtml.indexOf("const FOCUS_GLYPHS = {");
  assert.ok(start >= 0);
  const block = indexHtml.slice(start, indexHtml.indexOf("\n};", start));
  for (const key of ["star", "sliders", "search"]) {
    assert.match(block, new RegExp(`\\n  ${key}: '<`), `FOCUS_GLYPHS.${key} harus ada`);
  }
  // star = duotone gaya Alurik (garis + isian lembut .22); isian penuh saat aktif datang dari CSS (.ftask-star.is-on)
  const star = block.match(/\n  star: '([^']*)'/)[1];
  assert.ok(star.includes('fill="currentColor" fill-opacity=".22"'), "path star duotone");
});

test("FocusTaskItem: sumber memuat tombol ⭐, hideProject, dan bucket lokal untuk deadline", () => {
  const src = fnSource("FocusTaskItem");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("onToggleStar"));
  assert.ok(sig.includes("hideProject"));
  assert.ok(src.includes("ftask-star"));
  assert.ok(src.includes('"aria-pressed": !!task.is_focused'));
  assert.ok(src.includes('"aria-label": "Target hari ini"'), "aria-label tombol toggle konstan");
  assert.ok(src.includes("Tandai sebagai target hari ini"));
  assert.ok(src.includes("Lepas dari target hari ini"));
  assert.ok(!/"aria-label": starTitle/.test(src), "teks aksi hanya di title, bukan aria-label");
  assert.ok(src.includes("stopPropagation"));
  assert.ok(src.includes("focusfilter.timeBucket("));
  assert.ok(src.includes("todayLocalISO()"));
  assert.ok(!src.includes("task.is_overdue"), "merah/judul deadline tidak boleh memakai is_overdue server (basi)");
  // ⭐ sebelum tombol Fokus/Aktif
  assert.ok(src.indexOf("ftask-star") < src.indexOf("ftask-focus-btn"));
});

test("FocusTaskItem: ⭐ aktif/nonaktif, aria, stopPropagation, tanpa onToggleStar tidak ada tombol", () => {
  const stars = [];
  const on = renderItem({ task: { ...baseTask, is_focused: true }, onToggleStar: t => stars.push(t.id) });
  const [btn] = findAll(on, n => n.type === "button" && hasClass(n, "ftask-star"));
  assert.ok(btn, "tombol ⭐ dirender");
  assert.equal(btn.props.type, "button");
  assert.ok(hasClass(btn, "is-on"));
  assert.equal(btn.props["aria-pressed"], true);
  assert.equal(btn.props["aria-label"], "Target hari ini");
  assert.equal(btn.props.title, "Lepas dari target hari ini");
  let stopped = 0;
  btn.props.onClick({ stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1, "klik ⭐ tidak ikut membuka baris");
  assert.deepEqual(stars, [7]);

  const off = renderItem({ task: { ...baseTask, is_focused: false }, onToggleStar: NOOP });
  const [btn2] = findAll(off, n => n.type === "button" && hasClass(n, "ftask-star"));
  assert.ok(!hasClass(btn2, "is-on"));
  assert.equal(btn2.props["aria-pressed"], false);
  assert.equal(btn2.props["aria-label"], "Target hari ini", "aria-label tidak berubah antar keadaan");
  assert.equal(btn2.props.title, "Tandai sebagai target hari ini");

  // tombol ⭐ mendahului tombol Fokus di dalam baris
  const [row] = findAll(off, n => hasClass(n, "ftask-row"));
  const order = row.children.filter(c => c && c.type === "button").map(c => c.props.className.split(" ")[0]);
  assert.deepEqual(order, ["ftask-main", "ftask-star", "ftask-focus-btn"]);

  const none = renderItem({ task: baseTask });
  assert.equal(findAll(none, n => n.type === "button" && hasClass(n, "ftask-star")).length, 0);
});

test("FocusTaskItem: hideProject menyembunyikan info project, default menampilkan", () => {
  const projectSpans = tree => findAll(tree, n => n.type === "span" && n.props.title === "Project");
  assert.equal(projectSpans(renderItem({ task: baseTask })).length, 1);
  assert.equal(projectSpans(renderItem({ task: baseTask, hideProject: false })).length, 1);
  assert.equal(projectSpans(renderItem({ task: baseTask, hideProject: true })).length, 0);
});

test("FocusTaskItem: deadline merah mengikuti tanggal lokal, bukan is_overdue server (Review Focus 2)", () => {
  const dl = tree => findAll(tree, n => n.type === "span" && (n.props.title === "Terlambat" || n.props.title === "Deadline"))[0];
  // data IndexedDB lama: deadline hari ini tetapi is_overdue masih true → bukan terlambat
  const today = dl(renderItem({ task: { ...baseTask, deadline: TODAY, is_overdue: true } }));
  assert.equal(today.props.title, "Deadline");
  assert.ok(!hasClass(today, "is-overdue"));
  // deadline kemarin dengan is_overdue false → terlambat
  const late = dl(renderItem({ task: { ...baseTask, deadline: "2026-10-21", is_overdue: false } }));
  assert.equal(late.props.title, "Terlambat");
  assert.ok(hasClass(late, "is-overdue"));
  // deadline besok → biasa; task selesai tidak pernah terlambat
  assert.ok(!hasClass(dl(renderItem({ task: { ...baseTask, deadline: "2026-10-23" } })), "is-overdue"));
  assert.ok(!hasClass(dl(renderItem({ task: { ...baseTask, deadline: "2026-10-01", gtd_status: "done" } })), "is-overdue"));
});

test("FocusTargetSection: kepala bintang 'Target hari ini', daftar .focus-target, item lewat renderItem", () => {
  const src = fnSource("FocusTargetSection");
  assert.ok(src.includes('"Target hari ini"'));
  assert.ok(src.includes("focus-target"));
  assert.ok(src.includes('glyph: "star"'));
  const { FocusTargetSection } = loadComponents(["FocusTargetSection"], { React: fakeReact, FocusSectionHead: "FocusSectionHead" });
  const calls = [];
  const tasks = [{ id: 1 }, { id: 2 }];
  const tree = FocusTargetSection({ tasks, renderItem: (t, o) => { calls.push([t.id, o]); return { type: "item", props: { id: t.id }, children: [] }; } });
  assert.equal(tree.type, "section");
  const [head] = findAll(tree, n => n.type === "FocusSectionHead");
  assert.deepEqual([head.props.glyph, head.props.title, head.props.count], ["star", "Target hari ini", 2]);
  const [list] = findAll(tree, n => n.type === "div" && hasClass(n, "focus-target"));
  assert.ok(hasClass(list, "ftask-list"));
  assert.equal(findAll(list, n => n.type === "item").length, 2);
  assert.deepEqual(calls.map(c => c[0]), [1, 2]);
  assert.ok(calls.every(c => !c[1].inGroup), "info project tetap tampil di Target");
});

test("FocusTaskGroups: sumber memuat tombol judul ber-aria, chevron, dan kelas terlipat", () => {
  const src = fnSource("FocusTaskGroups");
  for (const needle of ["aria-expanded", "aria-controls", "focus-group-head", "is-collapsed", "focus-group-ws", "focus-group-count", 'name: "chevron"']) {
    assert.ok(src.includes(needle), `FocusTaskGroups harus memuat ${needle}`);
  }
});

test("FocusTaskGroups: judul kelompok, terlipat tanpa daftar, id aria-controls unik", () => {
  const { FocusTaskGroups } = loadComponents(["FocusTaskGroups"], { React: fakeReact, FocusGlyph: "FocusGlyph" });
  const groups = ff.groupTasks([
    { id: 1, title: "a", project: "Alurik", list_id: null },
    { id: 2, title: "b", project: "Alurik", list_id: null },
    { id: 3, title: "c", project: "", list_id: 5 },
    { id: 4, title: "d", project: "Kampanye", list_id: 5 }
  ], [{ id: 5, name: "Tim Marketing" }]);
  assert.equal(groups.length, 3);
  const calls = [];
  const toggled = [];
  const tree = FocusTaskGroups({
    groups,
    collapsed: new Set([groups[1].key]),
    onToggleGroup: k => toggled.push(k),
    renderItem: (t, o) => { calls.push([t.id, o.inGroup]); return { type: "item", props: {}, children: [] }; }
  });
  const sections = findAll(tree, n => n.type === "section" && hasClass(n, "focus-group"));
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map(s => hasClass(s, "is-collapsed")), [false, true, false]);

  const heads = findAll(tree, n => n.type === "button" && hasClass(n, "focus-group-head"));
  assert.equal(heads.length, 3);
  assert.deepEqual(heads.map(h => h.props["aria-expanded"]), [true, false, true]);
  assert.ok(heads.every(h => h.props.type === "button"));
  const ids = heads.map(h => h.props["aria-controls"]);
  assert.equal(ids[1], undefined, "kelompok terlipat: daftarnya tidak dirender, jadi tanpa aria-controls");
  const openIds = [ids[0], ids[2]];
  assert.equal(new Set(openIds).size, 2, "aria-controls unik per kelompok terbuka");
  assert.ok(openIds.every(id => /^[A-Za-z][\w-]*$/.test(id)), "id aman (slug)");

  // teks judul: "‹ws› ·", nama project, jumlah
  const ws = findAll(heads[0], n => hasClass(n, "focus-group-ws"));
  assert.equal(textOf(ws[0]), "Pribadi ·");
  const count0 = findAll(heads[0], n => hasClass(n, "focus-group-count"))[0];
  assert.equal(textOf(findAll(count0, n => hasClass(n, "focus-group-count-n"))[0]), "2");
  assert.equal(textOf(findAll(count0, n => hasClass(n, "focus-group-count-unit"))[0]), " task");
  assert.ok(findAll(heads[0], n => n.type === "FocusGlyph" && n.props.name === "chevron").length === 1);
  assert.equal(textOf(findAll(heads[1], n => hasClass(n, "focus-group-ws"))[0]), "Tim Marketing ·");
  assert.equal(textOf(findAll(heads[1], n => hasClass(n, "focus-group-name"))[0]), "Kampanye");
  assert.equal(textOf(findAll(heads[2], n => hasClass(n, "focus-group-name"))[0]), "Tanpa project");

  // daftar hanya untuk kelompok terbuka; id daftar = aria-controls judulnya
  const lists = findAll(tree, n => n.type === "div" && hasClass(n, "ftask-list"));
  assert.equal(lists.length, 2);
  assert.deepEqual(lists.map(l => l.props.id), openIds);
  assert.deepEqual(calls.map(c => c[0]).sort(), [1, 2, 3], "task kelompok terlipat (id 4) tidak dirender");
  assert.ok(calls.every(c => c[1] === true), "renderItem dipanggil dengan inGroup: true");

  heads[0].props.onClick();
  assert.deepEqual(toggled, [groups[0].key]);
});

test("FocusTaskGroups: aria-controls hanya saat terbuka dan selalu menunjuk id yang dirender (review akhir 3)", () => {
  const { FocusTaskGroups } = loadComponents(["FocusTaskGroups"], { React: fakeReact, FocusGlyph: "FocusGlyph" });
  const groups = ff.groupTasks([
    { id: 1, title: "a", project: "Alurik", list_id: null },
    { id: 2, title: "b", project: "Rumah", list_id: null },
    { id: 3, title: "c", project: "Kampanye", list_id: 5 }
  ], [{ id: 5, name: "Tim Marketing" }]);
  const render = collapsed => FocusTaskGroups({ groups, collapsed: new Set(collapsed), onToggleGroup: NOOP, renderItem: () => ({ type: "item", props: {}, children: [] }) });
  const heads = tree => findAll(tree, n => n.type === "button" && hasClass(n, "focus-group-head"));
  const listIds = tree => findAll(tree, n => n.props.id).map(n => n.props.id);

  // semua terbuka: tiap judul menunjuk daftar yang ada
  let tree = render([]);
  assert.ok(heads(tree).every(h => h.props["aria-expanded"] === true && typeof h.props["aria-controls"] === "string"));
  assert.ok(heads(tree).every(h => listIds(tree).includes(h.props["aria-controls"])), "setiap aria-controls punya elemen ber-id");

  // sebagian terlipat: judul terlipat tanpa aria-controls, yang terbuka tetap menunjuk id yang dirender
  tree = render([groups[0].key, groups[2].key]);
  const hs = heads(tree);
  assert.deepEqual(hs.map(h => h.props["aria-expanded"]), [false, true, false]);
  assert.deepEqual(hs.map(h => h.props["aria-controls"] === undefined), [true, false, true]);
  assert.ok(hs.every(h => h.props["aria-controls"] === undefined || listIds(tree).includes(h.props["aria-controls"])));

  // semua terlipat: tak ada daftar, tak ada aria-controls
  tree = render(groups.map(g => g.key));
  assert.equal(listIds(tree).length, 0);
  assert.ok(heads(tree).every(h => h.props["aria-controls"] === undefined));
});

test("TodayFocusView: Target/pool dari scope, kelompok, lipat tersimpan, pesan baru", () => {
  const src = fnSource("TodayFocusView");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("sharedLists = []"));
  assert.ok(sig.includes("onToggleFocus"));
  assert.ok(src.includes("focusfilter.inTodayScope("));
  assert.ok(!src.includes("includeDone"), "halaman Fokus tidak menampilkan task selesai");
  assert.ok(src.includes("splitTarget("));
  assert.ok(src.includes("groupTasks("));
  assert.ok(src.includes("readCollapsed(zenStorage())"));
  assert.ok(src.includes("writeCollapsed(zenStorage()"));
  assert.ok(src.includes("sharedLists"));
  assert.ok(src.includes("onToggleFocus"));
  // definisi lama tidak tersisa
  assert.ok(!src.includes('t.quadrant === "Q1" || t.is_overdue'));
  assert.ok(!src.includes("sortedTasks"));
  // teks pesan
  assert.ok(src.includes("Tidak ada task urgent!"));
  assert.ok(src.includes("Semua Q1, terlambat, dan deadline hari ini sudah selesai."));
  assert.ok(!src.includes("Semua Q1 dan overdue task sudah selesai."));
  assert.ok(src.includes("Semua task hari ini sudah ada di Target."));
  // ringkasan, hitungan subtask, dan Zen memakai scope
  assert.match(src, /headerSummary\(\{\s*count: scope\.length/);
  assert.match(src, /scope\.reduce\(\(sum, t\) => sum \+ window\.TF\.pomologic\.clampEstimate\(t\.estimated_pomodoros\), 0\)/);
  assert.ok(src.includes("useFocusTaskCounts(scope.map(t => t.id))"));
  // Zen: setiap task dihitung sekali (task berulang yang juga ada di cakupan tidak dobel), task aktif tidak dihitung
  // (fix Task 5) yang disembunyikan = yang memang tampil tanpa Zen: Target ∪ pool ∪ "Berulang hari ini"
  assert.ok(src.includes("const zenHiddenIds = new Set([...target, ...pool, ...recurringToday].map(t => String(t.id)));"));
  assert.ok(src.includes("zenHiddenIds.delete(String(focusTask.id))"));
  assert.ok(src.includes("const zenHiddenCount = zenHiddenIds.size;"));
  assert.ok(!src.includes("+ recurringToday.length"), "tidak lagi menjumlahkan task berulang dua kali");
  // pool = pool splitTarget tanpa task "Berulang hari ini"
  assert.ok(src.includes("pool: scopePool"));
  assert.ok(src.includes("const pool = scopePool.filter(t => !recurringIds.has(String(t.id)));"));
  // renderItem(task, { inGroup }) membungkus FocusTaskItem
  assert.match(src, /const renderItem = \(task, \{\s*inGroup\s*\} = \{\}\) =>/);
  assert.ok(src.includes("onToggleStar: t => onToggleFocus?.(t.id)"));
  assert.ok(src.includes("hideProject: !!inGroup"));
  // Target sebelum "Task hari ini", setelah "Berulang hari ini"
  const rec = src.indexOf('title: "Berulang hari ini"');
  const tgt = src.indexOf("FocusTargetSection");
  const pool = src.indexOf('title: "Task hari ini"');
  const grp = src.indexOf("FocusTaskGroups");
  assert.ok(rec >= 0 && tgt > rec && pool > tgt && grp > pool);
  // Zen: kelompok dan Target ikut kelas zen; task aktif tetap terbuka
  assert.ok(src.includes("open: openId === task.id || zenOn && focusTask?.id === task.id"));
  assert.ok(src.includes("zenHidden: zenOn && task.id !== focusTask?.id"));
});

test("FocusSectionHead dan komponen baru didaftarkan di DEPENDENCIES TodayFocusView", () => {
  const start = indexHtml.indexOf("// ═══ DEPENDENCIES: TodayFocusView ═══");
  const block = indexHtml.slice(start, indexHtml.indexOf("function TodayFocusView(", start));
  for (const name of ["FocusTargetSection", "FocusTaskGroups"]) assert.ok(block.includes(`- ${name}`), name);
});

test("App meneruskan sharedLists dan onToggleFocus ke TodayFocusView", () => {
  const start = indexHtml.indexOf("React.createElement(TodayFocusView, {");
  assert.ok(start >= 0);
  const block = indexHtml.slice(start, indexHtml.indexOf("\n      });", start));
  assert.ok(block.includes("sharedLists: sharedLists"));
  assert.ok(block.includes("onToggleFocus: handleToggleFocus"));
});

test("app.css: Target, kelompok, ⭐, dan chevron tanpa transisi saat reduced-motion", () => {
  const rule = sel => {
    const m = appCss.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`));
    assert.ok(m, `CSS rule ${sel} must exist`);
    return m[2];
  };
  const target = rule(".focus-target");
  assert.match(target, /rgba\(var\(--accent-rgb\), ?0\.10?\)/);
  assert.match(target, /border-radius: 14px/);
  assert.match(target, /padding: 8px/);
  assert.ok(appCss.includes('[data-theme="dark"] .focus-target'), "varian gelap Target");
  assert.match(rule(".focus-group-head"), /min-height: 42px/);
  const name = rule(".focus-group-name");
  assert.match(name, /text-overflow: ellipsis/);
  assert.match(name, /white-space: nowrap/);
  assert.match(rule(".focus-group-ws"), /var\(--text-secondary\)/);
  assert.ok(appCss.includes(".focus-group-count"));
  assert.match(appCss, /\.focus-group\.is-collapsed \.focus-group-chevron \{[^}]*rotate\(-90deg\)/);
  const star = rule(".ftask-star");
  assert.match(star, /width: 36px/);
  assert.match(star, /height: 36px/);
  assert.match(appCss, /\.ftask-star\.is-on \{[^}]*var\(--accent-text-strong\)/);
  assert.match(appCss, /\[data-theme="dark"\] \.ftask-star\.is-on \{[^}]*#D9EE6A/);
  assert.equal((appCss.match(/\[data-theme="dark"\] \.ftask-star\.is-on \{/g) || []).length, 1, "satu aturan ⭐ gelap");
  assert.match(appCss, /\.ftask-star\.is-on svg path \{[^}]*fill: var\(--accent\)/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.focus-group-chevron \{ transition: none; \}\s*\}/);
});

// ── Perbaikan putaran 1: "Berulang hari ini" tidak ikut pool; Zen menghitung tiap task sekali ──

const focuspage = require("../../static/offline/focuspage.js");

// Render TodayFocusView dengan hook palsu (state = nilai awal, efek tidak jalan) dan komponen anak berupa
// stub bernama, lalu periksa elemen yang dikembalikan.
function renderFocusView({ tasks, focusTask = null, zen = false, sharedLists = [], onToggleFocus }) {
  const stubs = {};
  for (const n of ["PomodoroMiniBar", "PomodoroTimer", "FocusTaskItem", "FocusSectionHead", "FocusTargetSection", "FocusTaskGroups", "FocusFilterBar", "FocusFilterSheet", "FocusGlyph", "PriBadge", "Icon", "ViewGlyph", "EmptyState", "Decor"]) stubs[n] = n;
  const storage = { getItem: k => (k === "tf_focus_zen" && zen ? "1" : null), setItem: () => {} };
  const { TodayFocusView } = loadComponents(["computeOccurrences", "TodayFocusView"], {
    React: { createElement: fakeReact.createElement, Fragment: "Fragment", useEffect: NOOP },
    useState: init => [typeof init === "function" ? init() : init, NOOP],
    useEffect: NOOP,
    useRef: () => ({ current: null }),
    useMemo: fn => fn(),
    window: { localStorage: storage, TF: { focusfilter: ff, focuspage, pomologic, tasklogic: { todayLocalISO: () => TODAY } } },
    document: { querySelectorAll: () => [] },
    api: { get: () => Promise.resolve({}) },
    POMO_DURATIONS: { work: 1500 },
    useFocusTaskCounts: () => [{}, NOOP],
    ...stubs
  });
  const timer = { mode: "work", isRunning: zen, timeLeft: 1500, pomodorosToday: 0, pause: NOOP };
  const tree = TodayFocusView({ tasks, onTaskClick: NOOP, onDone: NOOP, loading: false, timer, focusTask, setFocusTask: NOOP, sharedLists, onToggleFocus });
  return {
    tree,
    groups: findAll(tree, n => n.type === "FocusTaskGroups")[0],
    targetSection: findAll(tree, n => n.type === "FocusTargetSection")[0],
    heads: findAll(tree, n => n.type === "FocusSectionHead").map(n => n.props),
    recurringRows: findAll(tree, n => n.type === "div" && hasClass(n, "ftask--recurring")),
    zenNote: findAll(tree, n => hasClass(n, "focus-zen-note"))[0],
    empty: findAll(tree, n => hasClass(n, "focus-empty"))[0],
    note: findAll(tree, n => hasClass(n, "focus-note"))[0],
    summary: findAll(tree, n => hasClass(n, "focus-page-summary"))[0]
  };
}
const dueToday = { gtd_status: "next", priority: "P3", quadrant: "Q3", deadline: TODAY, project: "Rumah", created_at: "2026-10-01T08:00:00" };
const recur = { recurrence_type: "daily", recurrence_end_date: "2026-11-30" };

test("TodayFocusView: task berulang yang tampil di 'Berulang hari ini' tidak masuk pool/kelompok, non-berulang tetap", () => {
  const tasks = [
    { ...dueToday, ...recur, id: 1, title: "Minum obat harian" },
    { ...dueToday, id: 2, title: "Bayar listrik" },
    { ...dueToday, id: 3, title: "Q1 urgent", quadrant: "Q1", priority: "P1" }
  ];
  const v = renderFocusView({ tasks });
  // tepat satu baris berulang, dan task itu ada di cakupan (deadline hari ini)
  assert.deepEqual(v.recurringRows.length, 1);
  assert.ok(tasks.filter(t => ff.inTodayScope(t, { todayISO: TODAY })).some(t => t.id === 1), "task berulang ber-deadline hari ini ada di cakupan");
  // kelompok hanya memuat task non-berulang
  const grouped = v.groups.props.groups.flatMap(g => g.tasks.map(t => t.id)).sort();
  assert.deepEqual(grouped, [2, 3]);
  // jumlah di kepala "Task hari ini" = isi pool; ringkasan header tetap jumlah cakupan (spec §6.1)
  const poolHead = v.heads.find(h => h.title === "Task hari ini");
  assert.equal(poolHead.count, 2);
  assert.ok(textOf(v.summary).startsWith("3 tugas"), textOf(v.summary));
  assert.equal(v.targetSection, undefined, "tanpa ⭐/aktif tidak ada seksi Target");
});

test("TodayFocusView: task berulang yang ⭐ tetap di Target, tidak di pool, dan tidak dobel di Zen", () => {
  const tasks = [
    { ...dueToday, ...recur, id: 1, title: "Berulang bintang", is_focused: true },
    { ...dueToday, ...recur, id: 2, title: "Berulang biasa" },
    { ...dueToday, id: 3, title: "Biasa" },
    { ...dueToday, id: 4, title: "Aktif", quadrant: "Q1", priority: "P1" }
  ];
  const v = renderFocusView({ tasks, focusTask: tasks[3], zen: true });
  // Target: aktif lalu ⭐ (task ⭐ berulang tidak terpengaruh); pool: hanya "Biasa"
  assert.deepEqual(v.targetSection.props.tasks.map(t => t.id), [4, 1]);
  assert.deepEqual(v.groups.props.groups.flatMap(g => g.tasks.map(t => t.id)), [3]);
  assert.equal(v.heads.find(h => h.title === "Task hari ini").count, 1);
  assert.equal(v.recurringRows.length, 2, "kedua task berulang tetap tampil di 'Berulang hari ini'");
  // Zen: task lain = {1, 2, 3} dihitung sekali (task berulang 1 dan 2 ada di cakupan DAN di daftar berulang)
  assert.equal(textOf(v.zenNote), "Mode Zen · 3 task lain disembunyikan sampai istirahat");
  // task aktif berulang tidak dihitung sebagai "task lain"
  const active = { ...dueToday, ...recur, id: 9, title: "Aktif berulang" };
  const v2 = renderFocusView({ tasks: [active, tasks[2]], focusTask: active, zen: true });
  assert.equal(textOf(v2.zenNote), "Mode Zen · 1 task lain disembunyikan sampai istirahat");
});

test("TodayFocusView: bila hanya task berulang yang tersisa, pesan kosong; ⭐ di Target + pool kosong → catatan Target", () => {
  const onlyRecurring = renderFocusView({ tasks: [{ ...dueToday, ...recur, id: 1, title: "Minum obat harian" }] });
  assert.equal(onlyRecurring.groups, undefined, "tidak ada kelompok");
  assert.ok(onlyRecurring.empty, "kotak pesan kosong tampil");
  assert.ok(textOf(onlyRecurring.empty).includes("Tidak ada task urgent!"));
  assert.equal(onlyRecurring.recurringRows.length, 1);

  const starred = { ...dueToday, id: 2, title: "Bintang", is_focused: true };
  const v = renderFocusView({ tasks: [starred, { ...dueToday, ...recur, id: 1, title: "Minum obat harian" }] });
  assert.equal(v.groups, undefined);
  assert.equal(textOf(v.note), "Semua task hari ini sudah ada di Target.");
  assert.deepEqual(v.targetSection.props.tasks.map(t => t.id), [2]);
});

test("TodayFocusView: renderItem memberi hideProject di kelompok dan ⭐ memanggil onToggleFocus", () => {
  const toggled = [];
  const tasks = [{ ...dueToday, id: 5, title: "Biasa" }];
  const v = renderFocusView({ tasks, onToggleFocus: id => toggled.push(id) });
  const inGroup = v.groups.props.renderItem(tasks[0], { inGroup: true });
  const inTarget = v.groups.props.renderItem(tasks[0], { inGroup: false });
  assert.equal(inGroup.type, "FocusTaskItem");
  assert.equal(inGroup.props.hideProject, true);
  assert.equal(inTarget.props.hideProject, false);
  inGroup.props.onToggleStar(tasks[0]);
  assert.deepEqual(toggled, [5]);
});

// ── Task 5: bar filter, lembar filter, penyimpanan per perangkat, catatan ───────────────────

// `const NAME = ...;` tingkat modul dari index.html (untuk dirakit bersama komponen).
function constSource(name) {
  const start = indexHtml.indexOf(`\nconst ${name} = `);
  assert.ok(start >= 0, `const ${name} must exist`);
  return indexHtml.slice(start, indexHtml.indexOf(";\n", start) + 1);
}
function loadWith(names, globals, extra = []) {
  const src = extra.join("\n") + "\n" + names.map(n => fnSource(n) + "\n}").join("\n");
  const keys = Object.keys(globals);
  return new Function(...keys, `${src}\nreturn { ${names.join(", ")} };`)(...keys.map(k => globals[k]));
}

// Hook mini: state/ref/memo bertahan antar render, efek dijalankan (dengan cleanup) saat flush().
function createHooks() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((d, j) => !Object.is(d, b[j]));
  return {
    useState(init) {
      const k = cursor++;
      if (!slots[k]) slots[k] = { value: typeof init === "function" ? init() : init };
      const slot = slots[k];
      return [slot.value, next => { slot.value = typeof next === "function" ? next(slot.value) : next; }];
    },
    useRef(init) {
      const k = cursor++;
      if (!slots[k]) slots[k] = { current: init === undefined ? null : init };
      return slots[k];
    },
    useMemo(fn, deps) {
      const k = cursor++;
      if (slots[k] && !changed(slots[k].deps, deps)) return slots[k].value;
      slots[k] = { value: fn(), deps };
      return slots[k].value;
    },
    useEffect(fn, deps) {
      const k = cursor++;
      const slot = slots[k] || (slots[k] = { ran: false });
      if (!slot.ran || changed(slot.deps, deps)) pending.push({ slot, fn, deps });
    },
    begin() { cursor = 0; pending = []; },
    flush() {
      const list = pending;
      pending = [];
      for (const { slot, fn, deps } of list) {
        if (typeof slot.cleanup === "function") slot.cleanup();
        slot.cleanup = fn();
        slot.deps = deps;
        slot.ran = true;
      }
    },
    unmount() {
      for (const s of slots) if (s && typeof s.cleanup === "function") { s.cleanup(); s.cleanup = undefined; }
    }
  };
}

const STATUS_LABELS_SRC = () => constSource("FOCUS_STATUS_LABELS");
const T5_LISTS = [{ id: 5, name: "Tim Marketing" }];
// Cakupan 6 task (Q1 / terlambat / hari ini), tanpa ⭐: pool = semuanya. Default (Next) → 11, 12, 16.
const T5_TASKS = [
  { id: 11, title: "Revisi landing page", gtd_status: "next", priority: "P1", quadrant: "Q1", deadline: TODAY, project: "Alurik", list_id: null },
  { id: 12, title: "Balas email klien", gtd_status: "next", priority: "P2", quadrant: "Q3", deadline: "2026-10-20", project: "Alurik", list_id: null },
  { id: 13, title: "Telepon dokter gigi", gtd_status: "inbox", priority: "P3", quadrant: "Q1", project: "", list_id: null },
  { id: 14, title: "Konfirmasi vendor", gtd_status: "waiting", priority: "P2", quadrant: "Q3", deadline: "2026-10-10", project: "Kampanye Q4", list_id: 5 },
  { id: 15, title: "Servis AC kamar", gtd_status: "someday", priority: "P4", quadrant: "Q1", project: "Rumah", list_id: null },
  { id: 16, title: "Brief desain banner", gtd_status: "next", priority: "P4", quadrant: "Q2", deadline: TODAY, project: "Kampanye Q4", list_id: 5 }
];

// TodayFocusView dengan hook mini (state nyata + efek), anak berupa stub bernama, storage di memori.
function mountFocusView({ tasks, focusTask = null, zen = false, running = false, stored = {}, exceptions = {}, sharedLists = T5_LISTS, throwingStorage = false } = {}) {
  const store = { ...stored };
  if (zen) store.tf_focus_zen = "1";
  const storage = throwingStorage
    ? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const hooks = createHooks();
  const stubs = {};
  for (const n of ["PomodoroMiniBar", "PomodoroTimer", "FocusTaskItem", "FocusSectionHead", "FocusTargetSection", "FocusTaskGroups", "FocusFilterBar", "FocusFilterSheet", "FocusGlyph", "PriBadge", "Icon", "ViewGlyph", "EmptyState", "Decor"]) stubs[n] = n;
  const timers = [];
  const doc = { querySelectorAll: () => [], body: { name: "body" }, activeElement: null };
  const { TodayFocusView } = loadWith(["computeOccurrences", "TodayFocusView"], {
    React: { createElement: fakeReact.createElement, Fragment: "Fragment", useEffect: hooks.useEffect },
    useState: hooks.useState, useEffect: hooks.useEffect, useRef: hooks.useRef, useMemo: hooks.useMemo,
    window: { localStorage: storage, addEventListener: NOOP, removeEventListener: NOOP, TF: { focusfilter: ff, focuspage, pomologic, tasklogic: { todayLocalISO: () => TODAY } } },
    document: doc,
    setTimeout: fn => timers.push(fn),
    requestAnimationFrame: () => 0, cancelAnimationFrame: NOOP,
    api: { get: () => Promise.resolve(exceptions) },
    POMO_DURATIONS: { work: 1500 },
    useFocusTaskCounts: () => [{}, NOOP],
    ...stubs
  }, [STATUS_LABELS_SRC()]);
  const props = { tasks, onTaskClick: NOOP, onDone: NOOP, loading: false, focusTask, setFocusTask: NOOP, sharedLists, onToggleFocus: NOOP };
  const v = {
    store, timers, doc,
    render({ isRunning = running, ...over } = {}) {
      Object.assign(props, over, { timer: { mode: "work", isRunning, timeLeft: 1500, pomodorosToday: 0, pause: NOOP } });
      running = isRunning;
      hooks.begin();
      v.tree = TodayFocusView(props);
      hooks.flush();
      return v;
    },
    one: pred => findAll(v.tree, pred)[0],
    get bar() { return v.one(n => n.type === "FocusFilterBar"); },
    get sheet() { return v.one(n => n.type === "FocusFilterSheet"); },
    get groups() { return v.one(n => n.type === "FocusTaskGroups"); },
    get shownIds() { return v.groups ? v.groups.props.groups.flatMap(g => g.tasks.map(t => t.id)).sort((a, b) => a - b) : []; },
    get head() { return findAll(v.tree, n => n.type === "FocusSectionHead").map(n => n.props).find(h => h.title === "Task hari ini"); },
    get hiddenNote() { return v.one(n => hasClass(n, "focus-filter-hidden-note")); },
    get filterEmpty() { return v.one(n => hasClass(n, "focus-filter-empty")); },
    get savedFilter() { return store.tf_focus_filter === undefined ? undefined : JSON.parse(store.tf_focus_filter); }
  };
  return v.render();
}

test("FocusFilterBar: sumber memuat teks bar persis, aria, enterKeyHint, isFilterDefault", () => {
  const src = fnSource("FocusFilterBar");
  for (const needle of ['"Semua"', '"Hari ini"', '"Terlambat"', '"aria-label": "Waktu"', 'role: "group"', '"Cari judul task…"', '"aria-label": "Cari task"', 'enterKeyHint: "search"', 'type: "search"', '"Hapus pencarian"', '"Filter lainnya"', " aktif", "Hapus filter ", '"Reset"', '"aria-pressed"', '"aria-haspopup": "dialog"', '"aria-expanded"', "isFilterDefault(", "focus-filter-card", "focus-filter-grid", "focus-filter-btnwrap", "focus-filter-badge", "is-pill", "is-reset", "is-on", 'name: "search"', 'name: "sliders"']) {
    assert.ok(src.includes(needle), `FocusFilterBar harus memuat ${needle}`);
  }
});

test("FocusFilterSheet: sumber memuat dialog, subjudul, catatan status, label kuadran, Esc, kunci scroll HP", () => {
  const src = fnSource("FocusFilterSheet");
  for (const needle of ['role: "dialog"', '"aria-modal"', '"aria-labelledby"', '"Filter lainnya"', '"Status"', '"Prioritas"', '"Kuadran"', '"Workspace › Project"', '"Default: Next saja. Kosongkan semua untuk menampilkan semua status."', '"Q1 Lakukan"', '"Q2 Rencanakan"', '"Q3 Delegasikan"', '"Q4 Singkirkan"', '"Semua"', '"Reset"', '"Tampilkan "', '"Escape"', '"Tab"', 'matchMedia("(max-width: 768px)")', "document.body.style.overflow", "returnFocusRef", "focus-filter-backdrop", "focus-filter-sheet-actions"]) {
    assert.ok(src.includes(needle), `FocusFilterSheet harus memuat ${needle}`);
  }
  assert.match(constSource("FOCUS_STATUS_LABELS"), /next: "Next",\s*inbox: "Inbox",\s*waiting: "Waiting",\s*someday: "Someday"/);
});

test("TodayFocusView: sumber memuat penyimpanan filter, hitungan, pesan, useMemo, dan Zen menutup lembar", () => {
  const src = fnSource("TodayFocusView");
  for (const needle of ["readFilter(zenStorage())", "writeFilter(zenStorage()", "normalizeFilter(", "matches(", "timeCounts(", "statusCounts(", "hiddenByStatus(", "projectOptions(", "nonDefaultCount(", "berstatus lain disembunyikan", '"Reset filter"', '"Tidak ada task yang cocok dengan filter ini."', "focus-filter-empty", "focus-filter-hidden-note", "FocusFilterBar", "FocusFilterSheet", '"Semua status"', '"Status: "']) {
    assert.ok(src.includes(needle), `TodayFocusView harus memuat ${needle}`);
  }
  assert.match(src, /useMemo\(\(\) => \{[\s\S]*?\}, \[tasks, filter, query, todayStr, focusTask\?\.id, sharedLists\]\)/);
  assert.match(src, /const filterBarShown = !loading && pool\.length > 0;/);
  assert.match(src, /useEffect\(\(\) => \{\s*if \(zenOn \|\| !filterBarShown\) setSheetOpen\(false\);\s*\}, \[zenOn, filterBarShown\]\)/);
  assert.ok(src.includes("open: sheetOpen && !zenOn"));
  assert.ok(src.includes("count: shown.length"), "kepala Task hari ini = jumlah task tampil");
  // tulis storage di luar updater state (Ruling 4)
  assert.match(src, /const normalized = window\.TF\.focusfilter\.normalizeFilter\(next\);\s*setFilterState\(normalized\);\s*window\.TF\.focusfilter\.writeFilter\(zenStorage\(\), normalized\);/);
  // kata pencarian tidak disimpan
  assert.ok(!/setItem\([^)]*query/.test(src));
  const start = indexHtml.indexOf("// ═══ DEPENDENCIES: TodayFocusView ═══");
  const deps = indexHtml.slice(start, indexHtml.indexOf("function TodayFocusView(", start));
  for (const name of ["FocusFilterBar", "FocusFilterSheet"]) assert.ok(deps.includes(`- ${name}`), name);
});

test("app.css: bar filter, chip, badge, lembar HP/desktop, tema gelap, reduced-motion", () => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = sel => {
    const m = appCss.match(new RegExp(`(^|\\n)${esc(sel)} \\{([^}]*)\\}`));
    assert.ok(m, `CSS rule ${sel} must exist`);
    return m[2];
  };
  assert.match(rule(".focus-filter"), /position: relative/);
  const tab = rule(".focus-filter-time button");
  assert.match(tab, /min-height: 36px/);
  assert.match(rule('.focus-filter-time button[aria-pressed="true"]'), /background: var\(--text-primary\);[^}]*color: var\(--bg-card\)/);
  const chips = rule(".focus-filter-chips");
  assert.match(chips, /overflow-x: auto/);
  assert.match(chips, /scrollbar-width: none/);
  assert.match(rule(".focus-filter-chips::-webkit-scrollbar"), /display: none/);
  assert.match(rule(".focus-filter-chips > *"), /flex-shrink: 0/);
  assert.match(rule(".focus-filter-chip"), /min-height: 36px/);
  assert.match(rule(".focus-filter-chip.is-pill"), /background: var\(--text-primary\);[^}]*color: var\(--bg-card\)/);
  assert.match(rule(".focus-filter-chip.is-reset"), /border-style: dashed/);
  const badge = rule(".focus-filter-badge");
  assert.match(badge, /background: var\(--accent\)/);
  assert.match(badge, /color: var\(--accent-on, #1F2116\);/);
  // desktop: panel di bawah tombol Filter, rata kanan, 340 px, latar transparan penangkap klik luar
  const sheet = rule(".focus-filter-sheet");
  assert.match(sheet, /position: absolute/);
  assert.match(sheet, /top: calc\(100% \+ 6px\)/);
  assert.match(sheet, /right: 0/);
  assert.match(sheet, /width: 340px/);
  const backdrop = rule(".focus-filter-backdrop");
  assert.match(backdrop, /position: fixed/);
  assert.match(backdrop, /inset: 0/);
  assert.match(backdrop, /background: transparent/);
  // HP: lembar bawah fixed, radius 20, maks 86vh, latar redup
  const blocks = [...appCss.matchAll(/\n@media \(max-width: 768px\) \{\n((?:  .*\n)+)\}/g)].map(m => m[1]);
  const mobile = blocks.find(b => b.includes(".focus-filter-sheet {"));
  assert.ok(mobile, "blok @media (max-width: 768px) untuk lembar");
  const mSheet = mobile.match(/\.focus-filter-sheet \{([^}]*)\}/)[1];
  assert.match(mSheet, /position: fixed/);
  assert.match(mSheet, /bottom: 0/);
  assert.match(mSheet, /max-height: 86vh/);
  assert.match(mSheet, /border-radius: 20px 20px 0 0/);
  assert.match(mobile.match(/\.focus-filter-backdrop \{([^}]*)\}/)[1], /background: rgba\(15, ?18, ?8, ?0?\.38\)/);
  // tema gelap
  for (const sel of ['[data-theme="dark"] .focus-filter-chip.is-on', '[data-theme="dark"] .focus-filter-btn.is-on', '[data-theme="dark"] .focus-filter-sheet']) {
    assert.ok(appCss.includes(sel), sel);
  }
  // reduced-motion: lembar tanpa animasi
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.focus-filter-sheet, \.focus-filter-backdrop \{ animation: none; \}\s*\}/);
});

test("app.css: :hover blok Fokus (filter, ⭐, kelompok) hanya di @media (hover: hover); .is-on gelap punya border-color aksen (review akhir 1)", () => {
  // Pindai per baris: lacak @media tingkat atas yang sedang terbuka, kumpulkan setiap aturan :hover blok Fokus.
  let media = null;
  const hovers = [];
  for (const line of appCss.split("\n")) {
    const open = line.match(/^@media ([^{]+)\{\s*$/);
    if (open) { media = open[1].trim(); continue; }
    if (media && line.startsWith("}")) { media = null; continue; }
    if (/:hover/.test(line) && /\.(focus-filter|focus-group-head|ftask-star)/.test(line)) hovers.push({ line: line.trim(), media });
  }
  // semua aturan :hover blok ini yang dikenal (terang + gelap) memang terpindai, bukan lolos kosong
  for (const needle of [
    ".ftask-star:hover", ".focus-filter-time button:hover", ".focus-filter-clear:hover", ".focus-filter-btn:hover",
    '[data-theme="dark"] .focus-filter-btn:hover', ".focus-filter-chip:hover", '[data-theme="dark"] .focus-filter-chip:hover',
    ".focus-filter-sheet-actions .focus-filter-sheet-go:hover"
  ]) assert.ok(hovers.some(h => h.line.startsWith(needle)), `aturan ${needle} harus ada`);
  for (const h of hovers) assert.equal(h.media, "(hover: hover)", `:hover harus di dalam @media (hover: hover): ${h.line}`);
  // tampilan hover desktop (terang) tidak berubah
  assert.match(appCss, /@media \(hover: hover\) \{\n  \.focus-filter-chip:hover \{ border-color: #d6d6cc; \}/);
  assert.match(appCss, /@media \(hover: hover\) \{\n  \.ftask-star:hover \{ background: var\(--bg-primary\); \}\n\}/);

  // .is-on gelap: border aksen eksplisit, dan tetap menang walau hover berlaku (spesifisitas sama, hover lebih dulu di berkas)
  for (const cls of ["chip", "btn"]) {
    const on = appCss.match(new RegExp(`\\n\\[data-theme="dark"\\] \\.focus-filter-${cls}\\.is-on[^{]*\\{([^}]*)\\}`));
    assert.ok(on, `aturan .is-on gelap untuk ${cls}`);
    assert.match(on[1], /border-color: var\(--accent\)/, `.is-on gelap ${cls} harus ber-border-color aksen`);
    const hoverAt = appCss.indexOf(`[data-theme="dark"] .focus-filter-${cls}:hover`);
    const onAt = appCss.indexOf(`[data-theme="dark"] .focus-filter-${cls}.is-on`);
    assert.ok(hoverAt >= 0 && onAt > hoverAt, `hover gelap ${cls} harus mendahului .is-on gelap`);
  }
});

function barProps(over = {}) {
  return {
    filter: ff.normalizeFilter(null), query: "", counts: { all: 3, today: 2, late: 1 }, badge: 0, pills: [], sheetOpen: false,
    onTime: NOOP, onQuery: NOOP, onToggleQuick: NOOP, onRemovePill: NOOP, onReset: NOOP, onOpenSheet: NOOP, filterBtnRef: { current: null },
    ...over
  };
}
function renderBar(over) {
  const hooks = createHooks();
  const timers = [];
  const { FocusFilterBar } = loadWith(["FocusFilterBar"], {
    React: fakeReact, useRef: hooks.useRef, useEffect: hooks.useEffect, FocusGlyph: "FocusGlyph",
    window: { TF: { focusfilter: ff } }, document: { activeElement: null, body: {} }, setTimeout: fn => timers.push(fn)
  });
  hooks.begin();
  const tree = FocusFilterBar(barProps(over));
  return { tree, timers };
}

test("FocusFilterBar: tab waktu, cari, tombol Filter, pil, chip cepat, dan Reset", () => {
  const calls = [];
  const rec = name => (...a) => calls.push([name, ...a]);
  const btnRef = { current: null };
  const { tree } = renderBar({
    filter: ff.normalizeFilter({ time: "today", status: [], pri: ["P1", "P4"], quad: ["Q3"] }),
    query: "balas", counts: { all: 6, today: 2, late: 3 }, badge: 2, sheetOpen: true, filterBtnRef: btnRef,
    pills: [{ key: "status", kind: "status", label: "Semua status" }, { key: "pri:P4", kind: "pri", value: "P4", label: "P4" }],
    onTime: rec("time"), onQuery: rec("query"), onToggleQuick: rec("quick"), onRemovePill: rec("pill"), onReset: rec("reset"), onOpenSheet: rec("open")
  });
  assert.ok(hasClass(tree, "focus-filter"));
  // 1. tab waktu
  const [group] = findAll(tree, n => hasClass(n, "focus-filter-time"));
  assert.deepEqual([group.props.role, group.props["aria-label"]], ["group", "Waktu"]);
  const tabs = findAll(group, n => n.type === "button");
  assert.deepEqual(tabs.map(t => textOf(t)), ["Semua 6", "Hari ini 2", "Terlambat 3"]);
  assert.deepEqual(tabs.map(t => t.props["aria-pressed"]), [false, true, false]);
  assert.ok(tabs.every(t => t.props.type === "button"));
  assert.ok(tabs.every(t => findAll(t, n => n.type === "span" && hasClass(n, "n")).length === 1));
  tabs[2].props.onClick();
  // 2. cari + Filter (redesign: kotak cari dan tombol Filter jadi sel grid sendiri)
  const [row] = findAll(tree, n => hasClass(n, "focus-filter-grid"));
  const [label] = findAll(row, n => n.type === "label" && hasClass(n, "focus-filter-search"));
  const [input] = findAll(label, n => n.type === "input");
  assert.deepEqual([input.props.type, input.props.placeholder, input.props["aria-label"], input.props.enterKeyHint, input.props.value], ["search", "Cari judul task…", "Cari task", "search", "balas"]);
  input.props.onChange({ target: { value: "balas e" } });
  const [clear] = findAll(label, n => n.type === "button");
  assert.equal(clear.props["aria-label"], "Hapus pencarian");
  clear.props.onClick();
  const [fbtn] = findAll(row, n => n.type === "button" && hasClass(n, "focus-filter-btn"));
  assert.equal(fbtn.props.ref, btnRef);
  assert.deepEqual([fbtn.props["aria-haspopup"], fbtn.props["aria-expanded"], fbtn.props["aria-label"]], ["dialog", true, "Filter lainnya, 2 aktif"]);
  assert.equal(textOf(findAll(fbtn, n => hasClass(n, "focus-filter-badge"))[0]), "2");
  fbtn.props.onClick();
  // 3. chip: pil → cepat → Reset
  const [chips] = findAll(tree, n => hasClass(n, "focus-filter-chips"));
  const items = chips.children.filter(c => c && c.type === "button");
  const kinds = items.map(c => hasClass(c, "is-pill") ? "pill" : hasClass(c, "is-reset") ? "reset" : "quick");
  assert.deepEqual(kinds, ["pill", "pill", "quick", "quick", "quick", "quick", "quick", "reset"]);
  assert.deepEqual(items.filter(c => hasClass(c, "is-pill")).map(c => c.props["aria-label"]), ["Hapus filter Semua status", "Hapus filter P4"]);
  assert.ok(textOf(items[0]).startsWith("Semua status"));
  const quick = items.filter(c => !hasClass(c, "is-pill") && !hasClass(c, "is-reset"));
  assert.deepEqual(quick.map(c => textOf(c)), ["P1", "P2", "P3", "Q1", "Q3"]);
  assert.deepEqual(quick.map(c => c.props["aria-pressed"]), [true, false, false, false, true]);
  assert.deepEqual(quick.map(c => hasClass(c, "is-on")), [true, false, false, false, true]);
  assert.ok(items.every(c => c.props.type === "button"));
  items[1].props.onClick();
  quick[3].props.onClick();
  items[7].props.onClick();
  assert.equal(textOf(items[7]), "Reset");
  assert.deepEqual(calls, [
    ["time", "late"], ["query", "balas e"], ["query", ""], ["open"],
    ["pill", { key: "pri:P4", kind: "pri", value: "P4", label: "P4" }], ["quick", "quad", "Q1"], ["reset"]
  ]);
});

test("FocusFilterBar: default tanpa badge, tanpa hapus-cari, tanpa Reset; Reset muncul untuk query/time/chip", () => {
  const { tree } = renderBar();
  const [fbtn] = findAll(tree, n => n.type === "button" && hasClass(n, "focus-filter-btn"));
  assert.equal(fbtn.props["aria-label"], "Filter lainnya");
  assert.equal(fbtn.props["aria-expanded"], false);
  assert.ok(!hasClass(fbtn, "is-on"));
  assert.equal(findAll(tree, n => hasClass(n, "focus-filter-badge")).length, 0);
  assert.equal(findAll(tree, n => n.props["aria-label"] === "Hapus pencarian").length, 0);
  assert.equal(findAll(tree, n => hasClass(n, "is-reset")).length, 0);
  assert.equal(findAll(tree, n => hasClass(n, "is-pill")).length, 0);
  const reset = over => findAll(renderBar(over).tree, n => hasClass(n, "is-reset")).length;
  assert.equal(reset({ query: "   " }), 0, "query spasi saja dianggap kosong");
  assert.equal(reset({ query: "x" }), 1);
  assert.equal(reset({ filter: ff.normalizeFilter({ time: "late" }) }), 1);
  assert.equal(reset({ filter: ff.normalizeFilter({ pri: ["P2"] }) }), 1);
  // lembar (children) dirender di luar kartu (container query), langsung di bawah pembungkus
  // position: relative → panel desktop berjangkar di tepi kanan bar, tepat di bawah tombol Filter
  const { tree: withSheet } = renderBar({ children: { type: "SHEET", props: {}, children: [] } });
  const [card] = findAll(withSheet, n => hasClass(n, "focus-filter-card"));
  assert.equal(findAll(card, n => n.type === "SHEET").length, 0, "lembar tidak di dalam kartu ber-container");
  assert.equal(withSheet.children.filter(c => c && c.type === "SHEET").length, 1);
});

test("FocusFilterBar: pil/Reset yang diklik hilang → fokus pindah ke chip pertama, bukan ke body", () => {
  const { tree, timers } = renderBar({ pills: [{ key: "proj", kind: "proj", label: "Pribadi · Alurik" }] });
  const [chips] = findAll(tree, n => hasClass(n, "focus-filter-chips"));
  findAll(chips, n => hasClass(n, "is-pill"))[0].props.onClick();
  assert.equal(timers.length, 1, "fokus dipindah setelah render ulang");
});

test("FocusFilterBar: fokus pasca-hilang tanpa menggulir halaman (preventScroll, review akhir 2)", () => {
  const { tree, timers } = renderBar({ pills: [{ key: "proj", kind: "proj", label: "Pribadi · Alurik" }] });
  const [chips] = findAll(tree, n => hasClass(n, "focus-filter-chips"));
  const calls = [];
  const first = { focus: (...a) => calls.push(a) };
  chips.props.ref.current = { isConnected: true, querySelector: sel => (sel === "button" ? first : null) };
  findAll(chips, n => hasClass(n, "is-pill"))[0].props.onClick();
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(calls.length, 1, "chip pertama difokus");
  assert.deepEqual(calls[0], [{ preventScroll: true }]);
});

function sheetProps(over = {}) {
  return {
    open: true, filter: ff.normalizeFilter(null), statusCounts: { next: 3, inbox: 1, waiting: 1, someday: 0 },
    projectOptions: [{ key: "p:alurik", label: "Pribadi · Alurik", count: 2 }, { key: "5:kampanye q4", label: "Tim Marketing · Kampanye Q4", count: 2 }],
    shownCount: 3, onChange: NOOP, onResetHidden: NOOP, onClose: NOOP, returnFocusRef: { current: null },
    ...over
  };
}
// Lembar dengan DOM palsu: elemen dapat difokus, listener keydown di window, body.style.overflow.
function mountSheet({ mobile = true, overflow = "auto" } = {}) {
  const doc = { activeElement: null, body: { style: { overflow } } };
  const listeners = [];
  const win = {
    matchMedia: q => ({ matches: mobile && q === "(max-width: 768px)" }),
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn, capture) => {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    }
  };
  const el = name => ({ name, isConnected: true, focus() { doc.activeElement = this; }, closest: () => null });
  const chips = [el("chip-next"), el("chip-inbox"), el("tampilkan")];
  const sheetEl = { querySelector: () => chips[0], querySelectorAll: () => chips, contains: x => x === sheetEl || chips.includes(x) };
  // Hook didelegasikan ke `s.hooks`, sehingga remount() memberi instance baru (seperti React saat elemen muncul lagi).
  const { FocusFilterSheet } = loadWith(["FocusFilterSheet"], {
    React: { ...fakeReact, Fragment: "Fragment" },
    useRef: (...a) => s.hooks.useRef(...a), useEffect: (...a) => s.hooks.useEffect(...a),
    window: { ...win, TF: { focusfilter: ff } }, document: doc
  }, [STATUS_LABELS_SRC()]);
  const s = {
    doc, listeners, chips, sheetEl, hooks: createHooks(),
    remount() { s.hooks.unmount(); s.hooks = createHooks(); },
    render(props) {
      s.hooks.begin();
      s.tree = FocusFilterSheet(props);
      const dialog = s.tree && findAll(s.tree, n => n.props.role === "dialog")[0];
      if (dialog) dialog.props.ref.current = sheetEl;
      s.hooks.flush();
      return s;
    },
    key(key, extra = {}) {
      const ev = { key, shiftKey: false, prevented: 0, stopped: 0, preventDefault() { ev.prevented++; }, stopPropagation() { ev.stopped++; }, ...extra };
      listeners.filter(l => l.type === "keydown").forEach(l => l.fn(ev));
      return ev;
    }
  };
  return s;
}

test("FocusFilterSheet: tertutup = tidak merender apa pun; terbuka = latar + dialog berlabel", () => {
  const closed = mountSheet().render(sheetProps({ open: false }));
  assert.equal(closed.tree, null);
  assert.equal(closed.listeners.length, 0);
  const closes = [];
  const s = mountSheet().render(sheetProps({ onClose: () => closes.push(1) }));
  const [backdrop] = findAll(s.tree, n => hasClass(n, "focus-filter-backdrop"));
  const [dialog] = findAll(s.tree, n => hasClass(n, "focus-filter-sheet"));
  assert.ok(backdrop && dialog);
  assert.deepEqual([dialog.props.role, dialog.props["aria-modal"]], ["dialog", "true"]);
  const [title] = findAll(dialog, n => n.props.id === dialog.props["aria-labelledby"]);
  assert.equal(textOf(title), "Filter lainnya");
  backdrop.props.onClick();
  assert.equal(closes.length, 1, "klik latar (di luar panel) menutup");
});

test("FocusFilterSheet: empat grup chip, angka status, catatan, label kuadran, opsi project, aksi", () => {
  const changes = [];
  let resets = 0, closes = 0;
  const filter = ff.normalizeFilter({ status: ["next", "waiting"], pri: ["P2"], quad: ["Q4"], proj: null });
  const s = mountSheet().render(sheetProps({ filter, onChange: f => changes.push(f), onResetHidden: () => resets++, onClose: () => closes++ }));
  const groups = findAll(s.tree, n => hasClass(n, "focus-filter-sheet-group"));
  assert.equal(groups.length, 4);
  const heads = groups.map(g => findAll(g, n => n.type === "h4")[0]);
  assert.deepEqual(heads.map(h => textOf(h)), ["Status", "Prioritas", "Kuadran", "Workspace › Project"]);
  groups.forEach((g, i) => {
    assert.equal(g.props.role, "group");
    assert.equal(g.props["aria-labelledby"], heads[i].props.id);
  });
  const chipsOf = g => findAll(g, n => n.type === "button" && hasClass(n, "focus-filter-chip"));
  const [st, pri, quad, proj] = groups.map(chipsOf);
  assert.deepEqual(st.map(c => textOf(c)), ["Next 3", "Inbox 1", "Waiting 1", "Someday 0"]);
  assert.deepEqual(st.map(c => c.props["aria-pressed"]), [true, false, true, false]);
  assert.equal(textOf(findAll(groups[0], n => hasClass(n, "focus-filter-sheet-note"))[0]), "Default: Next saja. Kosongkan semua untuk menampilkan semua status.");
  assert.deepEqual(pri.map(c => textOf(c)), ["P1", "P2", "P3", "P4"]);
  assert.deepEqual(pri.map(c => c.props["aria-pressed"]), [false, true, false, false]);
  assert.deepEqual(quad.map(c => textOf(c)), ["Q1 Lakukan", "Q2 Rencanakan", "Q3 Delegasikan", "Q4 Singkirkan"]);
  assert.deepEqual(quad.map(c => c.props["aria-pressed"]), [false, false, false, true]);
  assert.deepEqual(proj.map(c => textOf(c)), ["Semua", "Pribadi · Alurik 2", "Tim Marketing · Kampanye Q4 2"]);
  assert.deepEqual(proj.map(c => c.props["aria-pressed"]), [true, false, false]);
  assert.ok([...st, ...pri, ...quad, ...proj].every(c => c.props.type === "button" && hasClass(c, "is-on") === c.props["aria-pressed"]));
  // multi: status / prioritas / kuadran; tunggal: project
  st[0].props.onClick();
  st[1].props.onClick();
  pri[3].props.onClick();
  quad[3].props.onClick();
  proj[2].props.onClick();
  proj[0].props.onClick();
  assert.deepEqual(changes.map(c => ff.normalizeFilter(c)), [
    { ...filter, status: ["waiting"] },
    { ...filter, status: ["next", "inbox", "waiting"] },
    { ...filter, pri: ["P2", "P4"] },
    { ...filter, quad: [] },
    { ...filter, proj: { key: "5:kampanye q4", label: "Tim Marketing · Kampanye Q4" } },
    { ...filter, proj: null }
  ]);
  // aksi menempel di bawah
  const [actions] = findAll(s.tree, n => hasClass(n, "focus-filter-sheet-actions"));
  const btns = findAll(actions, n => n.type === "button");
  assert.deepEqual(btns.map(b => textOf(b)), ["Reset", "Tampilkan 3 task"]);
  btns[0].props.onClick();
  btns[1].props.onClick();
  assert.deepEqual([resets, closes], [1, 1]);
  // project terpilih ditandai; opsi basi (count 0) tetap tampil
  const s2 = mountSheet().render(sheetProps({
    filter: ff.normalizeFilter({ proj: { key: "p:lama", label: "Pribadi · Lama" } }),
    projectOptions: [{ key: "p:alurik", label: "Pribadi · Alurik", count: 2 }, { key: "p:lama", label: "Pribadi · Lama", count: 0 }]
  }));
  const proj2 = chipsOf(findAll(s2.tree, n => hasClass(n, "focus-filter-sheet-group"))[3]);
  assert.deepEqual(proj2.map(c => [textOf(c), c.props["aria-pressed"]]), [["Semua", false], ["Pribadi · Alurik 2", false], ["Pribadi · Lama 0", true]]);
});

test("FocusFilterSheet: buka → fokus chip pertama, kunci scroll HP; Esc menutup; Tab berputar; tutup → pulih + fokus kembali", () => {
  const closes = [];
  const back = { isConnected: true, focused: 0, focus() { back.focused++; }, closest: () => null };
  const props = sheetProps({ onClose: () => closes.push(1), returnFocusRef: { current: back } });
  const s = mountSheet({ mobile: true, overflow: "scroll" }).render(props);
  assert.equal(s.doc.activeElement, s.chips[0], "fokus ke chip pertama");
  assert.equal(s.doc.body.style.overflow, "hidden", "scroll body terkunci di HP");
  assert.deepEqual(s.listeners.map(l => [l.type, l.capture]), [["keydown", true]]);
  // Tab di elemen terakhir → pertama; Shift+Tab di pertama → terakhir; di tengah → bawaan browser
  s.chips[2].focus();
  let ev = s.key("Tab");
  assert.equal(ev.prevented, 1);
  assert.equal(s.doc.activeElement, s.chips[0]);
  ev = s.key("Tab", { shiftKey: true });
  assert.equal(ev.prevented, 1);
  assert.equal(s.doc.activeElement, s.chips[2]);
  s.chips[1].focus();
  ev = s.key("Tab");
  assert.equal(ev.prevented, 0);
  // fokus di luar lembar → ditarik kembali ke dalam
  s.doc.activeElement = { name: "luar" };
  ev = s.key("Tab");
  assert.equal(ev.prevented, 1);
  assert.equal(s.doc.activeElement, s.chips[0]);
  // tombol lain tidak ditangani; Esc menutup dan tidak diteruskan ke listener Escape lain
  assert.equal(s.key("a").prevented, 0);
  ev = s.key("Escape");
  assert.deepEqual([closes.length, ev.prevented, ev.stopped], [1, 1, 1]);
  // induk menutup (open=false): listener dilepas, overflow dipulihkan, fokus ke tombol Filter
  s.render({ ...props, open: false });
  assert.equal(s.listeners.length, 0);
  assert.equal(s.doc.body.style.overflow, "scroll");
  assert.equal(back.focused, 1);
  assert.equal(s.tree, null);
});

test("FocusFilterSheet: desktop tanpa kunci scroll; unmount saat terbuka tetap memulihkan; fokus tidak ke tombol tersembunyi", () => {
  const back = { isConnected: true, focused: 0, focus() { back.focused++; }, closest: () => null };
  const d = mountSheet({ mobile: false, overflow: "" }).render(sheetProps({ returnFocusRef: { current: back } }));
  assert.equal(d.doc.body.style.overflow, "", "desktop: body tidak dikunci");
  d.hooks.unmount();
  assert.equal(d.listeners.length, 0);
  assert.equal(back.focused, 1);

  const m = mountSheet({ mobile: true, overflow: "" }).render(sheetProps({ returnFocusRef: { current: back } }));
  assert.equal(m.doc.body.style.overflow, "hidden");
  m.hooks.unmount();
  assert.equal(m.doc.body.style.overflow, "", "unmount memulihkan overflow");

  // tombol Filter di dalam bar yang aria-hidden (Zen) atau sudah lepas dari DOM → fokus tidak dikembalikan
  const hidden = { isConnected: true, focused: 0, focus() { hidden.focused++; }, closest: sel => (sel.includes("aria-hidden") ? {} : null) };
  const h = mountSheet({ mobile: false }).render(sheetProps({ returnFocusRef: { current: hidden } }));
  h.render(sheetProps({ open: false, returnFocusRef: { current: hidden } }));
  assert.equal(hidden.focused, 0);
  const gone = { isConnected: false, focused: 0, focus() { gone.focused++; }, closest: () => null };
  const g = mountSheet({ mobile: false }).render(sheetProps({ returnFocusRef: { current: gone } }));
  g.hooks.unmount();
  assert.equal(gone.focused, 0);
});

test("TodayFocusView: filter default (Next) dari storage kosong, hitungan bar, catatan status tersembunyi", () => {
  const v = mountFocusView({ tasks: T5_TASKS });
  assert.deepEqual(v.shownIds, [11, 12, 16]);
  assert.equal(v.head.count, 3, "kepala Task hari ini = task yang tampil");
  const bar = v.bar.props;
  assert.deepEqual(bar.filter, ff.normalizeFilter(null));
  assert.equal(bar.query, "");
  assert.deepEqual(bar.counts, { all: 3, today: 2, late: 1 });
  assert.equal(bar.badge, 0);
  assert.deepEqual(bar.pills, []);
  assert.equal(bar.sheetOpen, false);
  assert.ok(bar.filterBtnRef && "current" in bar.filterBtnRef);
  const sheet = v.sheet.props;
  assert.equal(sheet.open, false);
  assert.equal(sheet.returnFocusRef, bar.filterBtnRef);
  assert.deepEqual(sheet.statusCounts, { next: 3, inbox: 1, waiting: 1, someday: 1 });
  assert.deepEqual(sheet.projectOptions.map(o => [o.label, o.count]), [["Pribadi · Alurik", 2], ["Pribadi · Rumah", 1], ["Pribadi · Tanpa project", 1], ["Tim Marketing · Kampanye Q4", 2]]);
  assert.equal(sheet.shownCount, 3);
  assert.equal(textOf(v.hiddenNote), "3 task berstatus lain disembunyikan · Tampilkan");
  assert.equal(v.hiddenNote.type, "p");
  assert.equal(v.filterEmpty, undefined);
  assert.equal(v.savedFilter, undefined, "render saja tidak menulis storage");
  // "Tampilkan" → status [] (semua status), disimpan per perangkat
  findAll(v.hiddenNote, n => n.type === "button")[0].props.onClick();
  v.render();
  assert.deepEqual(v.shownIds, [11, 12, 13, 14, 15, 16]);
  assert.deepEqual(v.savedFilter.status, []);
  assert.equal(v.hiddenNote, undefined);
  assert.deepEqual(v.bar.props.pills.map(p => p.label), ["Semua status"]);
  assert.equal(v.bar.props.badge, 1);
  // ✕ pil status → kembali ke Next
  v.bar.props.onRemovePill(v.bar.props.pills[0]);
  v.render();
  assert.deepEqual(v.savedFilter.status, ["next"]);
  assert.deepEqual(v.shownIds, [11, 12, 16]);
});

test("TodayFocusView: tab, chip cepat, cari, Reset; chip cepat dan lembar berbagi state", () => {
  const v = mountFocusView({ tasks: T5_TASKS });
  v.bar.props.onTime("late");
  v.render();
  assert.deepEqual(v.shownIds, [12]);
  assert.equal(v.savedFilter.time, "late");
  assert.deepEqual(v.bar.props.counts, { all: 3, today: 2, late: 1 }, "angka tab mengabaikan tab aktif");
  v.bar.props.onTime("all");
  v.render();
  v.bar.props.onToggleQuick("pri", "P1");
  v.render();
  assert.deepEqual(v.shownIds, [11]);
  assert.deepEqual(v.sheet.props.filter.pri, ["P1"], "lembar melihat state yang sama");
  v.bar.props.onToggleQuick("pri", "P2");
  v.render();
  assert.deepEqual(v.shownIds, [11, 12]);
  assert.deepEqual(v.savedFilter.pri, ["P1", "P2"]);
  v.bar.props.onToggleQuick("pri", "P1");
  v.render();
  assert.deepEqual(v.bar.props.filter.pri, ["P2"]);
  assert.equal(v.bar.props.badge, 0, "chip cepat tidak masuk badge");
  // cari: tidak disimpan, spasi dirapatkan, tanpa beda huruf besar/kecil
  v.bar.props.onQuery("  BALAS   email ");
  v.render();
  assert.equal(v.bar.props.query, "  BALAS   email ");
  assert.deepEqual(v.shownIds, [12]);
  assert.ok(!String(v.store.tf_focus_filter).includes("BALAS"));
  assert.equal(v.head.count, 1);
  // Reset (chip bar) → default + kosongkan cari
  v.bar.props.onReset();
  v.render();
  assert.deepEqual(v.bar.props.filter, ff.normalizeFilter(null));
  assert.equal(v.bar.props.query, "");
  assert.deepEqual(v.savedFilter, ff.normalizeFilter(null));
  assert.deepEqual(v.shownIds, [11, 12, 16]);
});

test("TodayFocusView: lembar — buka/tutup, perubahan langsung tersimpan, Reset lembar menjaga waktu dan cari", () => {
  const v = mountFocusView({ tasks: T5_TASKS });
  v.bar.props.onOpenSheet();
  v.render();
  assert.equal(v.bar.props.sheetOpen, true);
  assert.equal(v.sheet.props.open, true);
  // lembar = anak bar (berjangkar di baris cari)
  assert.equal(findAll(v.bar, n => n.type === "FocusFilterSheet").length, 1);
  const f = v.sheet.props.filter;
  v.sheet.props.onChange({ ...f, status: [], proj: { key: "5:kampanye q4", label: "Tim Marketing · Kampanye Q4" }, quad: ["Q2", "Q2", "Qx"] });
  v.render();
  assert.deepEqual(v.savedFilter, { time: "all", status: [], pri: [], quad: ["Q2"], proj: { key: "5:kampanye q4", label: "Tim Marketing · Kampanye Q4" } }, "dinormalisasi sebelum disimpan");
  assert.deepEqual(v.shownIds, [16]);
  assert.equal(v.sheet.props.shownCount, 1);
  assert.deepEqual(v.bar.props.pills.map(p => [p.label, p.kind]), [["Semua status", "status"], ["Tim Marketing · Kampanye Q4", "proj"], ["Q2", "quad"]]);
  assert.equal(v.bar.props.badge, 3);
  // ✕ pil Q2 / project
  v.bar.props.onRemovePill(v.bar.props.pills[2]);
  v.render();
  assert.deepEqual(v.savedFilter.quad, []);
  v.bar.props.onRemovePill(v.bar.props.pills[1]);
  v.render();
  assert.equal(v.savedFilter.proj, null);
  // Reset lembar: status/pri/quad/proj default, waktu + cari tetap
  v.bar.props.onTime("today");
  v.bar.props.onQuery("brief");
  v.render();
  v.sheet.props.onChange({ ...v.sheet.props.filter, pri: ["P4"], quad: ["Q4"] });
  v.render();
  v.sheet.props.onResetHidden();
  v.render();
  assert.deepEqual(v.savedFilter, { time: "today", status: ["next"], pri: [], quad: [], proj: null });
  assert.equal(v.bar.props.query, "brief");
  assert.deepEqual(v.shownIds, [16]);
  v.sheet.props.onClose();
  v.render();
  assert.equal(v.sheet.props.open, false);
  assert.equal(v.bar.props.sheetOpen, false);
});

test("TodayFocusView: filter tersimpan dibaca saat mount; pil + badge; project basi → pesan + Reset filter", () => {
  const stored = { tf_focus_filter: JSON.stringify({ status: ["waiting", "next"], pri: ["P4", "P1"], quad: ["Q4", "Q2"], proj: { key: "p:lama", label: "Pribadi · Lama" } }) };
  const v = mountFocusView({ tasks: T5_TASKS, stored });
  assert.deepEqual(v.bar.props.pills.map(p => p.label), ["Status: Next, Waiting", "Pribadi · Lama", "P4", "Q2", "Q4"]);
  assert.equal(v.bar.props.badge, 5);
  assert.equal(v.groups, undefined, "tidak ada task yang cocok → tanpa kelompok");
  assert.equal(v.head.count, 0);
  assert.ok(v.bar, "bar tetap tampil (pool tidak kosong)");
  const opt = v.sheet.props.projectOptions.at(-1);
  assert.deepEqual(opt, { key: "p:lama", label: "Pribadi · Lama", count: 0 });
  assert.ok(v.filterEmpty && v.filterEmpty.type === "div");
  assert.ok(textOf(v.filterEmpty).startsWith("Tidak ada task yang cocok dengan filter ini."));
  const [btn] = findAll(v.filterEmpty, n => n.type === "button");
  assert.equal(textOf(btn), "Reset filter");
  assert.equal(btn.props.type, "button");
  v.bar.props.onQuery("x");
  v.render();
  findAll(v.filterEmpty, n => n.type === "button")[0].props.onClick();
  v.render();
  assert.deepEqual(v.savedFilter, ff.normalizeFilter(null));
  assert.equal(v.bar.props.query, "");
  assert.deepEqual(v.shownIds, [11, 12, 16]);
  assert.equal(v.filterEmpty, undefined);
});

test("TodayFocusView: storage rusak atau diblokir → default tanpa error", () => {
  const bad = mountFocusView({ tasks: T5_TASKS, stored: { tf_focus_filter: "{rusak", tf_focus_collapsed: "[1,{}]" } });
  assert.deepEqual(bad.bar.props.filter, ff.normalizeFilter(null));
  assert.deepEqual(bad.shownIds, [11, 12, 16]);
  const blocked = mountFocusView({ tasks: T5_TASKS, throwingStorage: true });
  assert.deepEqual(blocked.bar.props.filter, ff.normalizeFilter(null));
  blocked.bar.props.onToggleQuick("quad", "Q3");
  blocked.render();
  assert.deepEqual(blocked.shownIds, [12], "filter tetap berjalan di memori");
});

test("TodayFocusView: bar tidak dirender bila cakupan kosong atau pool kosong (semua di Target)", () => {
  const empty = mountFocusView({ tasks: [{ id: 1, title: "Nanti", gtd_status: "next", priority: "P3", quadrant: "Q2" }] });
  assert.equal(empty.bar, undefined);
  assert.equal(empty.hiddenNote, undefined);
  assert.ok(textOf(empty.one(n => hasClass(n, "focus-empty"))).includes("Tidak ada task urgent!"));
  const onlyTarget = mountFocusView({ tasks: [{ ...T5_TASKS[0], is_focused: true }] });
  assert.equal(onlyTarget.bar, undefined);
  assert.equal(onlyTarget.sheet, undefined);
  assert.equal(textOf(onlyTarget.one(n => hasClass(n, "focus-note"))), "Semua task hari ini sudah ada di Target.");
  // Target tidak tersaring: task ⭐ berstatus Waiting tetap di Target walau filter default Next
  const mixed = mountFocusView({ tasks: [...T5_TASKS, { id: 20, title: "Bintang waiting", gtd_status: "waiting", priority: "P3", quadrant: "Q2", is_focused: true }] });
  assert.deepEqual(mixed.one(n => n.type === "FocusTargetSection").props.tasks.map(t => t.id), [20]);
  assert.deepEqual(mixed.shownIds, [11, 12, 16]);
});

test("TodayFocusView: Zen menyembunyikan bar/kelompok/catatan/pesan dan menutup lembar; saat istirahat is-zen-shown", () => {
  const focus = { ...T5_TASKS[0], id: 30, title: "Aktif", quadrant: "Q2", deadline: null };
  const tasks = [...T5_TASKS, focus];
  const v = mountFocusView({ tasks, focusTask: focus, zen: true, running: false });
  // Zen menyala tetapi timer belum jalan → semua terlihat (kelas reveal yang sudah ada); buka lembar
  assert.equal(v.bar.props.zenClass, " is-zen-shown");
  assert.equal(v.bar.props.zenHidden, false);
  v.bar.props.onOpenSheet();
  v.render();
  assert.equal(v.sheet.props.open, true);
  // Work berjalan → zenOn: lembar langsung tertutup, bar/kelompok/catatan disembunyikan
  v.render({ isRunning: true });
  assert.equal(v.sheet.props.open, false, "lembar ditutup pada render yang sama");
  assert.equal(v.bar.props.sheetOpen, false);
  assert.equal(v.bar.props.zenClass, " is-zen-hidden");
  assert.equal(v.bar.props.zenHidden, true);
  assert.equal(v.groups.props.zenClass, " is-zen-hidden");
  assert.equal(v.groups.props.zenHidden, true);
  assert.ok(hasClass(v.hiddenNote, "is-zen-hidden"));
  assert.equal(v.hiddenNote.props["aria-hidden"], true);
  // jeda → zenReveal: kelas is-zen-shown, lembar tetap tertutup (state ikut ditutup oleh efek)
  v.render({ isRunning: false });
  assert.equal(v.sheet.props.open, false);
  assert.equal(v.bar.props.zenClass, " is-zen-shown");
  assert.equal(v.bar.props.zenHidden, false);
  assert.ok(hasClass(v.hiddenNote, "is-zen-shown"));
  assert.equal(v.hiddenNote.props["aria-hidden"], undefined);
  // pesan "tidak ada yang cocok" ikut disembunyikan saat Zen
  v.bar.props.onQuery("tidak ada judul ini");
  v.render({ isRunning: true });
  assert.ok(hasClass(v.filterEmpty, "is-zen-hidden"));
  assert.equal(v.filterEmpty.props["aria-hidden"], true);
});

test("TodayFocusView: task berulang yang kejadiannya hari ini sudah done/skipped tetap tidak masuk pool (Ruling 1)", async () => {
  const recurring = { ...dueToday, ...recur, id: 1, title: "Minum obat harian" };
  const skipped = { ...dueToday, ...recur, id: 2, title: "Siram tanaman" };
  const plain = { ...dueToday, id: 3, title: "Bayar listrik" };
  const v = mountFocusView({
    tasks: [recurring, skipped, plain],
    exceptions: { 1: [{ occurrence_date: TODAY, status: "done" }], 2: [{ occurrence_date: TODAY, status: "skipped" }] }
  });
  // sebelum pengecualian dimuat: kedua task berulang tampil di "Berulang hari ini", bukan di pool
  assert.equal(findAll(v.tree, n => n.type === "div" && hasClass(n, "ftask--recurring")).length, 2);
  assert.deepEqual(v.shownIds, [3]);
  await new Promise(resolve => setImmediate(resolve));
  v.render();
  // pengecualian done/skipped: baris berulang hilang, tetapi task tidak "muncul" di Task hari ini —
  // juga setelah daftar dihitung ulang (sinkronisasi memberi array tasks baru, filter berubah)
  assert.equal(findAll(v.tree, n => n.type === "div" && hasClass(n, "ftask--recurring")).length, 0);
  assert.deepEqual(v.shownIds, [3]);
  v.render({ tasks: [recurring, skipped, plain] });
  assert.deepEqual(v.shownIds, [3]);
  assert.equal(v.head.count, 1);
  v.bar.props.onToggleQuick("pri", "P3");
  v.render();
  assert.deepEqual(v.shownIds, [3]);
  assert.equal(v.sheet.props.statusCounts.next, 1, "hitungan lembar juga tanpa task berulang");
  // Target tidak terpengaruh: task berulang ber-⭐ tetap di Target
  const starredTasks = [{ ...recurring, is_focused: true }, plain];
  const starred = mountFocusView({ tasks: starredTasks, exceptions: { 1: [{ occurrence_date: TODAY, status: "done" }] } });
  await new Promise(resolve => setImmediate(resolve));
  starred.render({ tasks: [...starredTasks] });
  assert.deepEqual(starred.one(n => n.type === "FocusTargetSection").props.tasks.map(t => t.id), [1]);
  assert.deepEqual(starred.shownIds, [3]);
});

test("TodayFocusView: 'Reset filter' / 'Tampilkan' hilang setelah diklik → fokus ke tombol Filter, bukan body", () => {
  const btn = { isConnected: true, focused: 0, focus() { btn.focused++; } };
  // catatan "Tampilkan" (status lain)
  const v = mountFocusView({ tasks: T5_TASKS });
  v.bar.props.filterBtnRef.current = btn;
  findAll(v.hiddenNote, n => n.type === "button")[0].props.onClick();
  v.render();
  assert.equal(v.timers.length, 1);
  v.doc.activeElement = v.doc.body;
  v.timers.shift()();
  assert.equal(btn.focused, 1);
  // pesan kosong "Reset filter"; fokus yang sudah pindah ke tempat lain tidak direbut
  v.bar.props.onQuery("tidak ada judul ini");
  v.render();
  findAll(v.filterEmpty, n => n.type === "button")[0].props.onClick();
  v.render();
  v.doc.activeElement = { name: "lain" };
  v.timers.shift()();
  assert.equal(btn.focused, 1);
  // tombol Filter sudah lepas dari DOM → tidak difokus
  v.bar.props.onQuery("tidak ada judul ini");
  v.render();
  findAll(v.filterEmpty, n => n.type === "button")[0].props.onClick();
  btn.isConnected = false;
  v.doc.activeElement = v.doc.body;
  v.timers.shift()();
  assert.equal(btn.focused, 1);
});

test("TodayFocusView: fokus ke tombol Filter pasca-hilang tanpa menggulir halaman (preventScroll, review akhir 2)", () => {
  const calls = [];
  const btn = { isConnected: true, focus: (...a) => calls.push(a) };
  const v = mountFocusView({ tasks: T5_TASKS });
  v.bar.props.filterBtnRef.current = btn;
  findAll(v.hiddenNote, n => n.type === "button")[0].props.onClick();
  v.render();
  v.doc.activeElement = v.doc.body;
  v.timers.shift()();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [{ preventScroll: true }]);
});

test("helper fokus-pasca-hilang di sumber: tidak ada .focus() tanpa preventScroll (review akhir 2)", () => {
  for (const [fn, name] of [["FocusFilterBar", "keepChipFocus"], ["TodayFocusView", "keepFilterFocus"]]) {
    const src = fnSource(fn);
    const start = src.indexOf(`const ${name} = () => setTimeout(`);
    assert.ok(start >= 0, name);
    const body = src.slice(start, src.indexOf("}, 0);", start));
    assert.ok(body.includes(".focus("), `${name} memanggil focus`);
    assert.ok(!body.includes(".focus()"), `${name}: .focus() polos akan menggulir halaman`);
    assert.match(body, /\.focus\(\{\s*preventScroll: true\s*\}\)/);
  }
});

// ── Fix putaran 1 Task 5 ─────────────────────────────────────────────────────────────────────

test("TodayFocusView: catatan Zen = Target ∪ pool ∪ berulang tampil − aktif; berulang yang done tidak dihitung, task tersaring tetap (fix 1)", async () => {
  const active = { ...dueToday, id: 40, title: "Aktif", quadrant: "Q1", priority: "P1" };
  const rec = { ...dueToday, ...recur, id: 41, title: "Minum obat harian" }; // dalam cakupan: deadline seri hari ini
  const next = { ...dueToday, id: 42, title: "Bayar listrik" };
  const waiting = { ...dueToday, id: 43, title: "Tunggu balasan", gtd_status: "waiting" }; // tersaring status default
  const v = mountFocusView({
    tasks: [active, rec, next, waiting], focusTask: active, zen: true, running: true,
    exceptions: { 41: [{ occurrence_date: TODAY, status: "done" }] }
  });
  const zenNote = () => textOf(v.one(n => hasClass(n, "focus-zen-note")));
  // sebelum pengecualian dimuat: baris berulang + 2 task pool (satu tersaring) = 3
  assert.equal(zenNote(), "Mode Zen · 3 task lain disembunyikan sampai istirahat");
  await new Promise(resolve => setImmediate(resolve));
  v.render();
  // kejadian hari ini done → task berulang tidak tampil di mana pun → tidak dihitung
  assert.equal(findAll(v.tree, n => n.type === "div" && hasClass(n, "ftask--recurring")).length, 0);
  assert.deepEqual(v.shownIds, [42]);
  assert.equal(zenNote(), "Mode Zen · 2 task lain disembunyikan sampai istirahat", "Waiting yang tersaring tetap dihitung");
  // filter/cari tidak mengubah hitungan
  v.bar.props.onQuery("tidak ada judul ini");
  v.render();
  assert.equal(zenNote(), "Mode Zen · 2 task lain disembunyikan sampai istirahat");
});

test("TodayFocusView: lembar terbuka lalu bar hilang (pool/cakupan kosong, memuat) → state ditutup; bar kembali → lembar tidak terbuka sendiri (fix 2)", () => {
  const v = mountFocusView({ tasks: T5_TASKS });
  // "React" untuk satu anak: elemen FocusFilterSheet dirender dengan komponen asli; hilang dari pohon = unmount.
  const s = mountSheet({ mobile: true, overflow: "auto" });
  let mounted = false;
  const host = () => {
    const el = v.sheet;
    if (el) {
      s.render(el.props);
      mounted = true;
    } else if (mounted) {
      s.remount();
      s.tree = null;
      mounted = false;
    }
  };
  const starred = { ...T5_TASKS[0], is_focused: true };
  for (const [label, emptyRender] of [
    ["pool kosong (semua di Target)", () => v.render({ tasks: [starred] })],
    ["cakupan kosong", () => v.render({ tasks: [] })],
    ["memuat", () => v.render({ loading: true })]
  ]) {
    v.render({ tasks: T5_TASKS, loading: false });
    host();
    v.bar.props.onOpenSheet();
    v.render();
    host();
    assert.equal(v.sheet.props.open, true, label);
    assert.equal(s.doc.body.style.overflow, "hidden", label);
    // sinkronisasi mengosongkan pool → bar dan lembar tidak dirender; unmount memulihkan scroll body
    emptyRender();
    host();
    assert.equal(v.bar, undefined, label);
    assert.equal(v.sheet, undefined, label);
    assert.equal(s.doc.body.style.overflow, "auto", label);
    assert.equal(s.listeners.length, 0, label);
    // task masuk pool lagi → bar kembali, lembar tetap tertutup: fokus tidak direbut, scroll tidak dikunci
    const elsewhere = { name: "di tempat lain" };
    s.doc.activeElement = elsewhere;
    v.render({ tasks: [starred, ...T5_TASKS.slice(1)], loading: false });
    host();
    assert.ok(v.bar, label);
    assert.equal(v.bar.props.sheetOpen, false, label);
    assert.equal(v.sheet.props.open, false, label);
    assert.equal(s.tree, null, label);
    assert.equal(s.doc.body.style.overflow, "auto", label);
    assert.equal(s.doc.activeElement, elsewhere, label);
  }
});

// ── Redesign bar filter + kartu kelompok (desain pemilik 2026-10-22) ──

test("FocusFilterBar redesign: kartu → grid (tab, cari, chip, tombol Filter), lembar di luar kartu", () => {
  const { tree } = renderBar({
    counts: { all: 31, today: 4, late: 23 }, badge: 1,
    pills: [{ key: "status", kind: "status", label: "Semua status" }],
    children: { type: "SHEET", props: {}, children: [] }
  });
  assert.ok(hasClass(tree, "focus-filter"), "akar tetap .focus-filter (kelas Zen menempel di sini)");
  const kids = tree.children.filter(Boolean);
  assert.ok(hasClass(kids[0], "focus-filter-card"), "anak pertama = kartu");
  assert.equal(kids[1].type, "SHEET", "lembar = saudara kartu, bukan di dalamnya");
  const [grid] = kids[0].children.filter(Boolean);
  assert.ok(hasClass(grid, "focus-filter-grid"));
  const cells = grid.children.filter(Boolean);
  assert.deepEqual(cells.map(c => ["focus-filter-time", "focus-filter-search", "focus-filter-chips", "focus-filter-btnwrap"].find(k => hasClass(c, k))),
    ["focus-filter-time", "focus-filter-search", "focus-filter-chips", "focus-filter-btnwrap"]);
  const [btn] = findAll(cells[3], n => n.type === "button" && hasClass(n, "focus-filter-btn"));
  assert.ok(btn, "tombol Filter di sel btnwrap");
  assert.equal(textOf(findAll(btn, n => hasClass(n, "focus-filter-badge"))[0]), "1");
});

test("FocusFilterBar redesign: angka tab jadi badge; angka Terlambat bertanda is-late", () => {
  const { tree } = renderBar({ counts: { all: 31, today: 4, late: 23 } });
  const tabs = findAll(findAll(tree, n => hasClass(n, "focus-filter-time"))[0], n => n.type === "button");
  const ns = tabs.map(t => findAll(t, n => n.type === "span" && hasClass(n, "n"))[0]);
  assert.deepEqual(ns.map(n => textOf(n)), ["31", "4", "23"]);
  assert.deepEqual(ns.map(n => hasClass(n, "is-late")), [false, false, true]);
});

test("app.css redesign: kartu bar filter ber-container query, grid 3 tata letak, pembatas, badge", () => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = (sel, src = appCss) => {
    const m = src.match(new RegExp(`(^|\\n)\\s*${esc(sel)} \\{([^}]*)\\}`));
    assert.ok(m, `CSS rule ${sel} must exist`);
    return m[2];
  };
  const card = rule(".focus-filter-card");
  assert.match(card, /container: focusfilter \/ inline-size/);
  assert.match(card, /background: var\(--bg-card\)/);
  assert.match(card, /border: 1px solid var\(--border\)/);
  assert.match(card, /border-radius: 16px/);
  // HP (dasar): tab | cari + Filter | chip
  const grid = rule(".focus-filter-grid");
  assert.match(grid, /display: grid/);
  assert.match(grid, /grid-template-areas: "time time" "search btn" "chips chips"/);
  for (const [sel, area] of [[".focus-filter-time", "time"], [".focus-filter-search", "search"], [".focus-filter-chips", "chips"], [".focus-filter-btnwrap", "btn"]]) {
    assert.match(rule(sel), new RegExp(`grid-area: ${area}`), sel);
  }
  const block = q => {
    const i = appCss.indexOf(`@container focusfilter (min-width: ${q})`);
    assert.ok(i >= 0, `@container focusfilter (min-width: ${q})`);
    return appCss.slice(i, appCss.indexOf("\n}\n", i));
  };
  // sedang: tab + cari | chip + pembatas + Filter
  const mid = block("600px");
  assert.match(rule(".focus-filter-grid", mid), /grid-template-areas: "time search search" "chips chips btn"/);
  assert.match(rule(".focus-filter-btnwrap", mid), /box-shadow: inset 1px 0 0 var\(--border\)/, "pembatas = bayangan inset (border-left dilarang task_date_prompt.test)");
  assert.match(rule(".focus-filter-badge", mid), /position: absolute/);
  // lebar: satu baris
  const wide = block("1000px");
  assert.match(rule(".focus-filter-grid:not(.is-dense)", wide), /grid-template-areas: "time search chips btn"/);
  // angka tab: badge bulat; Terlambat merah muda
  assert.match(rule(".focus-filter-time .n"), /border-radius: 999px/);
  assert.match(rule(".focus-filter-time .n.is-late"), /#b91c1c/);
  assert.ok(appCss.includes('[data-theme="dark"] .focus-filter-time .n.is-late'), "varian gelap angka Terlambat");
  // lembar desktop berjangkar ke pembungkus .focus-filter (bukan kartu ber-container)
  assert.match(rule(".focus-filter"), /position: relative/);
});

test("app.css redesign: kelompok = kartu, baris di dalamnya bergaris pemisah, satu baris di desktop", () => {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = (sel, src = appCss) => {
    const m = src.match(new RegExp(`(^|\\n)\\s*${esc(sel)} \\{([^}]*)\\}`));
    assert.ok(m, `CSS rule ${sel} must exist`);
    return m[2];
  };
  const group = rule(".focus-group");
  assert.match(group, /background: var\(--bg-card\)/);
  assert.match(group, /border: 1px solid var\(--border\)/);
  assert.match(group, /border-radius: 14px/);
  assert.match(group, /overflow: hidden/);
  assert.match(rule(".focus-group .ftask"), /border: 0/);
  assert.match(rule(".focus-group .ftask + .ftask"), /box-shadow: inset 0 1px 0 var\(--border\)/);
  assert.match(rule(".focus-group-count"), /border-radius: 999px/);
  const desk = appCss.slice(appCss.indexOf("@media (min-width: 1024px) {\n  .focus-group .ftask-main"));
  assert.ok(desk.startsWith("@media (min-width: 1024px)"), "blok desktop baris satu baris");
  assert.match(rule(".focus-group .ftask-main", desk), /flex-direction: row/);
  assert.match(rule(".focus-group .ftask-meta", desk), /justify-content: flex-end/);
  const narrow = appCss.slice(appCss.indexOf("@media (max-width: 640px) {\n  .focus-group-count-unit"));
  assert.ok(narrow.startsWith("@media (max-width: 640px)"), "HP: jumlah tanpa kata task");
  assert.match(rule(".focus-group-count-unit", narrow), /display: none/);
});

test("ikon ⭐ bergaya Alurik (duotone: garis + isian lembut)", () => {
  const start = indexHtml.indexOf("const FOCUS_GLYPHS = {");
  const glyphs = indexHtml.slice(start, indexHtml.indexOf("};", start));
  const star = glyphs.match(/\n  star: '([^']*)'/);
  assert.ok(star, "FOCUS_GLYPHS.star");
  assert.match(star[1], /fill="currentColor" fill-opacity="\.22"/);
});

test("FocusFilterBar redesign: ≥ 2 pil atau pil panjang → grid is-dense (tetap dua baris di kartu lebar)", () => {
  const dense = pills => hasClass(findAll(renderBar({ pills }).tree, n => hasClass(n, "focus-filter-grid"))[0], "is-dense");
  assert.equal(dense([]), false);
  assert.equal(dense([{ key: "status", kind: "status", label: "Semua status" }]), false);
  assert.equal(dense([{ key: "status", kind: "status", label: "Semua status" }, { key: "pri:P4", kind: "pri", value: "P4", label: "P4" }]), true);
  assert.equal(dense([{ key: "proj", kind: "proj", label: "Tim Marketing · Kampanye Ramadan 2026" }]), true);
});
