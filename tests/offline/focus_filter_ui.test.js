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
const textOf = node => (node.children || []).map(c => (typeof c === "object" && c ? textOf(c) : String(c))).join("");

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
    FOCUS_TABS: [{ key: "subtasks", label: "Subtask", glyph: "subtasks" }],
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
  // star = garis; isian saat aktif datang dari CSS (.ftask-star.is-on), bukan dari path
  const star = block.match(/\n  star: '([^']*)'/)[1];
  assert.ok(!star.includes('fill="currentColor"'), "path star tidak mengisi sendiri");
});

test("FocusTaskItem: sumber memuat tombol ⭐, hideProject, dan bucket lokal untuk deadline", () => {
  const src = fnSource("FocusTaskItem");
  const sig = src.slice(0, src.indexOf(") {"));
  assert.ok(sig.includes("onToggleStar"));
  assert.ok(sig.includes("hideProject"));
  assert.ok(src.includes("ftask-star"));
  assert.ok(src.includes('"aria-pressed": !!task.is_focused'));
  assert.ok(src.includes("Tandai sebagai target hari ini"));
  assert.ok(src.includes("Lepas dari target hari ini"));
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
  assert.equal(btn.props["aria-label"], "Lepas dari target hari ini");
  let stopped = 0;
  btn.props.onClick({ stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1, "klik ⭐ tidak ikut membuka baris");
  assert.deepEqual(stars, [7]);

  const off = renderItem({ task: { ...baseTask, is_focused: false }, onToggleStar: NOOP });
  const [btn2] = findAll(off, n => n.type === "button" && hasClass(n, "ftask-star"));
  assert.ok(!hasClass(btn2, "is-on"));
  assert.equal(btn2.props["aria-pressed"], false);
  assert.equal(btn2.props["aria-label"], "Tandai sebagai target hari ini");

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
  assert.equal(new Set(ids).size, 3, "aria-controls unik per kelompok");
  assert.ok(ids.every(id => /^[A-Za-z][\w-]*$/.test(id)), "id aman (slug)");

  // teks judul: "‹ws› ·", nama project, jumlah
  const ws = findAll(heads[0], n => hasClass(n, "focus-group-ws"));
  assert.equal(textOf(ws[0]), "Pribadi ·");
  assert.equal(findAll(heads[0], n => hasClass(n, "focus-group-count"))[0].children[0], 2);
  assert.ok(findAll(heads[0], n => n.type === "FocusGlyph" && n.props.name === "chevron").length === 1);
  assert.equal(textOf(findAll(heads[1], n => hasClass(n, "focus-group-ws"))[0]), "Tim Marketing ·");
  assert.equal(textOf(findAll(heads[1], n => hasClass(n, "focus-group-name"))[0]), "Kampanye");
  assert.equal(textOf(findAll(heads[2], n => hasClass(n, "focus-group-name"))[0]), "Tanpa project");

  // daftar hanya untuk kelompok terbuka; id daftar = aria-controls judulnya
  const lists = findAll(tree, n => n.type === "div" && hasClass(n, "ftask-list"));
  assert.equal(lists.length, 2);
  assert.deepEqual(lists.map(l => l.props.id), [ids[0], ids[2]]);
  assert.deepEqual(calls.map(c => c[0]).sort(), [1, 2, 3], "task kelompok terlipat (id 4) tidak dirender");
  assert.ok(calls.every(c => c[1] === true), "renderItem dipanggil dengan inGroup: true");

  heads[0].props.onClick();
  assert.deepEqual(toggled, [groups[0].key]);
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
  assert.ok(src.includes("const zenHiddenCount = scope.filter(t => t.id !== focusTask?.id).length + recurringToday.length;"));
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
  assert.match(target, /rgba\(168, ?197, ?0, ?0\.10?\)/);
  assert.match(target, /border-radius: 14px/);
  assert.match(target, /padding: 8px/);
  assert.ok(appCss.includes('[data-theme="dark"] .focus-target'), "varian gelap Target");
  assert.match(rule(".focus-group-head"), /min-height: 36px/);
  const name = rule(".focus-group-name");
  assert.match(name, /text-overflow: ellipsis/);
  assert.match(name, /white-space: nowrap/);
  assert.match(rule(".focus-group-ws"), /var\(--text-secondary\)/);
  assert.ok(appCss.includes(".focus-group-count"));
  assert.match(appCss, /\.focus-group\.is-collapsed \.focus-group-chevron \{[^}]*rotate\(-90deg\)/);
  const star = rule(".ftask-star");
  assert.match(star, /width: 36px/);
  assert.match(star, /height: 36px/);
  assert.match(appCss, /\.ftask-star\.is-on \{[^}]*#6B8000/);
  assert.match(appCss, /\[data-theme="dark"\] \.ftask-star\.is-on \{[^}]*#A8C500/);
  assert.match(appCss, /\.ftask-star\.is-on svg path \{[^}]*fill: currentColor/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\) \{\s*\.focus-group-chevron \{ transition: none; \}\s*\}/);
});
