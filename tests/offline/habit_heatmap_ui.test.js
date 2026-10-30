// Plugin #0 Heatmap Habit — UI (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §5; rencana Task 8):
// sumber plugin.jsx/style.css (token warna saja, teks persis) + pohon elemen HeatmapSvg dengan React palsu.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/habit-heatmap");
const jsx = fs.readFileSync(path.join(dir, "plugin.jsx"), "utf8");
const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const H = require(path.join(dir, "plugin.js"));

test("manifest persis rencana", () => {
  assert.deepEqual(manifest, {
    id: "habit-heatmap",
    name: "Heatmap Habit",
    description: "Grid habit tercentang dan task selesai setahun terakhir di Dashboard.",
    version: "1.0.0",
    minApi: 1,
    slots: ["dashboard.widgets"],
    permissions: ["storage"],
    defaultEnabled: false,
  });
});

test("tanpa warna hex tetap; warna dari color-mix(var(--accent), var(--bg-card)) X = 0/25/50/75/100", () => {
  for (const [name, src] of [["plugin.jsx", jsx], ["style.css", css]]) {
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, name + " tanpa hex");
    assert.doesNotMatch(src, /rgba?\(|hsla?\(/, name + " tanpa rgb/hsl tetap");
  }
  assert.deepEqual(H.LEVEL_PCT, [0, 25, 50, 75, 100]);
  for (let i = 0; i < 5; i++) {
    assert.equal(H.levelFill(i), `color-mix(in srgb, var(--accent) ${[0, 25, 50, 75, 100][i]}%, var(--bg-card))`);
  }
  assert.match(css, /\.plg-heatmap-today\s*\{[^}]*var\(--accent\)/);
});

test("teks UI persis: judul, segmen, label hari", () => {
  assert.match(jsx, /<div className="dash-card-title">Heatmap<\/div>/);
  for (const s of ['"Habit"', '"Task selesai"', '"Keduanya"']) assert.ok(jsx.includes(s), s);
  assert.deepEqual(H.DAY_LABELS, [[0, "Sen"], [2, "Rab"], [4, "Jum"]]);
  assert.match(jsx, /className="dash-card plg-heatmap"/);
  assert.match(jsx, /api\.storage\.get\("metric"\)/);
  assert.match(jsx, /api\.storage\.set\("metric", /);
  assert.match(jsx, /role="radiogroup"/);
});

test("pembaruan: habit.changed, task.completed, sync.done, app.dayChanged dengan debounce 300 ms", () => {
  assert.deepEqual(H.REFRESH_EVENTS, ["habit.changed", "task.completed", "sync.done", "app.dayChanged"]);
  assert.equal(H.DEBOUNCE_MS, 300);
  assert.match(jsx, /REFRESH_EVENTS\.map\(\(n\) => api\.events\.on\(n, /);
  assert.match(jsx, /\(min-width: 768px\)/);
});

test("tanpa jaringan / penyimpanan browser / modul host (Lampiran A #10)", () => {
  assert.doesNotMatch(jsx, /fetch\(|localStorage|tokenStore|API_BASE|window\.TF\.(?!plugins\.register)/);
});

// React palsu: createElement → {type, props, children}
function withFakeReact(fn) {
  const prev = global.React;
  global.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }) };
  try { return fn(); } finally { global.React = prev; }
}
function all(node, pred, out = []) {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) all(c, pred, out);
  return out;
}
const text = (n) => (n && typeof n === "object" ? (n.children || []).map(text).join("") : n == null || n === false ? "" : String(n));

for (const cols of [53, 26]) {
  test(`HeatmapSvg: satu <svg>, ${cols} kolom, kotak 11 px jarak 2, <title> per kotak, hari ini ditandai`, () => {
    const today = "2026-10-31";
    const grid = H.buildGrid(today, cols);
    const buckets = H.bucketByDate([{ habit_cid: "h", date: today, status: "done" }], [], grid.cells[0].date, today, "habit");
    const tree = withFakeReact(() => H.HeatmapSvg({ grid, buckets, today }));
    assert.equal(all(tree, (n) => n.type === "svg").length, 1);
    const rects = all(tree, (n) => n.type === "rect");
    assert.equal(rects.length, grid.days);
    assert.equal(new Set(rects.map((r) => r.props.x)).size, cols);
    for (const r of rects) {
      assert.equal(r.props.width, 11);
      assert.equal(r.props.height, 11);
      assert.equal(r.props.rx, 2);
      assert.match(r.props.fill, /^color-mix\(in srgb, var\(--accent\) (0|25|50|75|100)%, var\(--bg-card\)\)$/);
    }
    const xs = [...new Set(rects.map((r) => r.props.x))].sort((a, b) => a - b);
    assert.equal(xs[1] - xs[0], 13, "11 px + jarak 2");
    const todayRect = rects.filter((r) => /plg-heatmap-today/.test(r.props.className || ""));
    assert.equal(todayRect.length, 1);
    assert.equal(text(todayRect[0]), "Sab 31 Okt · 1 habit · 0 task");
    assert.match(todayRect[0].props.fill, /100%/);
    const labels = all(tree, (n) => n.type === "text").map(text);
    for (const d of ["Sen", "Rab", "Jum"]) assert.ok(labels.includes(d), d);
    assert.ok(labels.includes("Okt"));
    const svg = all(tree, (n) => n.type === "svg")[0];
    assert.equal(svg.props.role, "img");
  });
}

// Ujung ke ujung dengan runtime nyata: index.json repo → load (inject = jalankan plugin.js di vm) → register →
// kontribusi dashboard.widgets; plugin OFF (default) tidak memuat apa pun.
test("runtime: index.json + plugin.js mendaftar ke slot dashboard.widgets hanya setelah ON", async () => {
  const vm = require("node:vm");
  const { deleteDB } = require("./setup.js");
  const { DB_NAME, _reset: resetDB } = require("../../static/offline/db.js");
  const RT = require("../../static/plugin-runtime.js");
  const P = RT.plugins;
  P._reset();
  resetDB();
  await deleteDB(DB_NAME);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, "../index.json"), "utf8"));
  await P.init({ fetchIndex: () => Promise.resolve(idx) });
  const entry = idx.plugins.find((p) => p.id === "habit-heatmap");
  assert.ok(entry && entry.slots.includes("dashboard.widgets"), "index.json menyertakan slots");
  assert.equal(P.isEnabled("habit-heatmap"), false, "defaultEnabled false");
  const urls = [];
  const inject = (url, kind) => {
    urls.push(url);
    if (kind === "script") {
      const js = fs.readFileSync(path.join(dir, "plugin.js"), "utf8");
      vm.runInNewContext(js, { window: { TF: { plugins: P } }, React: global.React });
    }
    return Promise.resolve();
  };
  assert.equal(await P.load("habit-heatmap", { inject }), false, "OFF → tidak dimuat");
  assert.deepEqual(urls, []);
  await P.setEnabled("habit-heatmap", true);
  assert.equal(await P.load("habit-heatmap", { inject, timeoutMs: 1000 }), true);
  assert.deepEqual(urls.sort(), [
    `/static/plugins/habit-heatmap/plugin.js?v=${entry.hash}`,
    `/static/plugins/habit-heatmap/style.css?v=${entry.hash}`,
  ]);
  const contrib = P.contributions("dashboard.widgets");
  assert.deepEqual(contrib.map((c) => [c.pluginId, c.id]), [["habit-heatmap", "heatmap"]]);
  assert.equal(P.list().find((p) => p.id === "habit-heatmap").loaded, true);
  P._reset();
});
