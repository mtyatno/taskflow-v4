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
    version: "1.1.0",
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

// Temuan review akhir #2: tidak menghitung ulang grid tiap render (Pomodoro memicu render tiap detik).
test("HeatmapCard memoize grid/bucket (deps [src, metric, today, wide]) dan SVG dibungkus React.memo", () => {
  assert.match(jsx, /React\.useMemo\(\(\) => \{[\s\S]*?buildGrid\([\s\S]*?bucketByDate\([\s\S]*?\}, \[src, metric, today, wide\]\)/);
  assert.match(jsx, /React\.memo\(HeatmapSvg\)/);
  assert.equal(typeof H.HeatmapSvg, "function", "HeatmapSvg murni tetap diekspor untuk tes");
});

// Temuan review akhir #5: storage.get("metric") yang terlambat tidak menimpa pilihan yang sudah diklik.
test("metric tersimpan yang terlambat tidak menimpa klik pengguna", () => {
  assert.match(jsx, /const pickedRef = React\.useRef\(false\)/);
  assert.match(jsx, /if \(alive && !pickedRef\.current && METRICS\.some/);
  assert.match(jsx, /pickedRef\.current = true;/);
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
  test(`HeatmapSvg (tanpa geo = fallback 11 px): satu <svg>, ${cols} kolom, jarak 2, <title> per kotak, hari ini ditandai`, () => {
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

test("cellSize(containerWidth, cols): 11–26 px untuk lebar 600/1100/1600 (53 kolom), monoton, HP 26 kolom tetap 11", () => {
  const sizes = [600, 1100, 1600].map((w) => H.cellSize(w, 53));
  for (const c of sizes) assert.ok(c >= 11 && c <= 26 && Number.isInteger(c), "px utuh dalam 11–26: " + c);
  assert.ok(sizes[0] <= sizes[1] && sizes[1] <= sizes[2], "monoton: " + sizes);
  assert.equal(sizes[0], 11, "600 px terlalu sempit untuk 53 kolom → minimum 11");
  assert.ok(sizes[1] > 11 && sizes[1] < 26, "1100 px di antara batas: " + sizes[1]);
  assert.ok(sizes[2] > 18 && sizes[2] <= 26, "1600 px → kotak membesar (> 18): " + sizes[2]);
  assert.equal(H.cellSize(2500, 53), 26, "sangat lebar → maksimum 26");
  assert.equal(H.cellSize(343, 26), 11, "HP 375 px (kartu ±343 px) tetap 11 → scroll internal");
  assert.equal(H.cellSize(0, 53), 11, "belum terukur → 11");
  assert.equal(H.cellSize(undefined, 53), 11);
});

test("geometry: gap ≈14% kotak dibatasi 2–4 px (px utuh); grid ≥ 90% kontainer dan tidak melebihinya; batas 26 → sisa di kanan, gap tidak melebar", () => {
  const g11 = H.geometry(0, 53);
  assert.deepEqual([g11.cell, g11.gap, g11.step, g11.left, g11.top], [11, 2, 13, 26, 14], "fallback = tata letak 1.0");
  assert.equal(g11.font, 9);
  for (const w of [900, 1100, 1300, 1498, 1600, 2500]) {
    const g = H.geometry(w, 53);
    assert.ok(Number.isInteger(g.cell) && Number.isInteger(g.gap) && Number.isInteger(g.left) && Number.isInteger(g.top), "px utuh @" + w);
    assert.ok(g.gap >= 2 && g.gap <= 4, "gap 2–4 @" + w + ": " + g.gap);
    assert.equal(g.gap, Math.min(4, Math.max(2, Math.round(g.cell * 0.14))), "gap ≈14% kotak @" + w);
    assert.ok(g.width <= w, "tidak melebihi kontainer @" + w + ": " + g.width);
    if (g.cell < 26) assert.ok(g.width >= 0.9 * w, "≥ 90% @" + w + ": " + g.width);
  }
  const g = H.geometry(1100, 53);
  assert.ok(g.font > 9 && g.left > 26 && g.top > 14, "label ikut skala");
  const w = H.geometry(1498, 53);
  assert.ok(w.cell >= 22 && w.cell <= 26 && w.gap <= 4, "1660 px viewport (konten 1498): kotak ±24, gap ≤ 4: " + w.cell + "/" + w.gap);
  const big = H.geometry(2500, 53);
  assert.deepEqual([big.cell, big.gap], [26, 4], "batas 26: gap tetap 4, sisa ruang di kanan");
  assert.ok(big.width < 2500);
  const m = H.geometry(343, 26);
  assert.equal(m.cell, 11);
  assert.ok(m.width > 343, "HP: grid lebih lebar → scroll internal");
});

test("legenda: kotak 12 px tetap", () => {
  assert.match(css, /\.plg-heatmap-legend-cell\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/);
});

test("HeatmapSvg memakai geo: ukuran kotak, langkah kolom, lebar svg, font label", () => {
  const today = "2026-10-31";
  const grid = H.buildGrid(today, 53);
  const geo = H.geometry(1100, 53);
  const tree = withFakeReact(() => H.HeatmapSvg({ grid, buckets: {}, today, geo, label: "Heatmap habit, 0 hari aktif" }));
  const svg = all(tree, (n) => n.type === "svg")[0];
  assert.equal(svg.props.width, geo.width);
  assert.equal(svg.props.height, geo.height);
  assert.equal(svg.props["aria-label"], "Heatmap habit, 0 hari aktif");
  assert.equal(svg.props.style.fontSize, geo.font);
  const rects = all(tree, (n) => n.type === "rect");
  for (const r of rects) assert.equal(r.props.width, geo.cell);
  const xs = [...new Set(rects.map((r) => r.props.x))].sort((a, b) => a - b);
  assert.ok(Math.abs(xs[1] - xs[0] - geo.step) < 1e-6);
});

test("svgLabel: aria-label ringkas 'Heatmap {metrik}, {a} hari aktif'", () => {
  assert.equal(H.svgLabel("habit", 87), "Heatmap habit, 87 hari aktif");
  assert.equal(H.svgLabel("task", 3), "Heatmap task selesai, 3 hari aktif");
  assert.equal(H.svgLabel("both", 0), "Heatmap habit dan task, 0 hari aktif");
  assert.match(jsx, /label=\{svgLabel\(metric, /);
});

test("Legend: 'Sedikit', 5 kotak warna sama dengan sel (tingkat 0–4), 'Banyak'", () => {
  const tree = withFakeReact(() => H.Legend());
  assert.match(tree.props.className, /plg-heatmap-legend/);
  const kids = tree.children.filter((c) => c && typeof c === "object");
  assert.equal(text(kids[0]), "Sedikit");
  assert.equal(text(kids[kids.length - 1]), "Banyak");
  const boxes = all(tree, (n) => /plg-heatmap-legend-cell/.test(n.props.className || ""));
  assert.equal(boxes.length, 5);
  boxes.forEach((b, i) => assert.equal(b.props.style.background, H.levelFill(i)));
  assert.match(jsx, /<div className="plg-heatmap-foot">[\s\S]*?plg-heatmap-summary[\s\S]*?<Legend \/>/);
  assert.match(css, /\.plg-heatmap-foot\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap[^}]*justify-content:\s*space-between/);
});

test("lebar kontainer diukur ResizeObserver; geometri di-memo terpisah (deps [boxW, cols]); ringkasan pakai longestStreak", () => {
  assert.match(jsx, /new ResizeObserver\(/);
  assert.match(jsx, /React\.useMemo\(\(\) => geometry\(boxW, cols\), \[boxW, cols\]\)/);
  assert.match(jsx, /summaryText\(streak\(counts, today\), longestStreak\(counts\), active, grid\.days\)/);
  assert.doesNotMatch(css, /\.plg-heatmap-label\s*\{[^}]*font-size/, "font label dari svg (ikut skala), bukan CSS tetap");
});

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
