// Plugin #0 Heatmap Habit — logika murni (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §5;
// rencana Task 8). Diuji dari plugin.js hasil compile.js (yang di-commit), diekspor lewat module.exports di Node.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const H = require(path.join(__dirname, "../../static/plugins/habit-heatmap/plugin.js"));

test("range(today, days): naik, berakhir hari ini, lintas bulan/tahun", () => {
  assert.deepEqual(H.range("2026-03-02", 3), ["2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(H.range("2025-01-01", 2), ["2024-12-31", "2025-01-01"]);
  const r = H.range("2026-10-31", 365);
  assert.equal(r.length, 365);
  assert.equal(r[0], "2025-11-01");
  assert.equal(r[364], "2026-10-31");
});

test("jktDate: zona Asia/Jakarta, batas tengah malam; tanpa offset = UTC (paritas kanbanboard)", () => {
  assert.equal(H.jktDate("2026-10-30T16:59:59Z"), "2026-10-30");
  assert.equal(H.jktDate("2026-10-30T17:00:00Z"), "2026-10-31");
  assert.equal(H.jktDate("2026-10-30T17:00:00"), "2026-10-31");
  assert.equal(H.jktDate("2026-10-31T00:30:00+07:00"), "2026-10-31");
  assert.equal(H.jktDate("2026-10-31T23:59:00+07:00"), "2026-10-31");
  assert.equal(H.jktDate(null), null);
  assert.equal(H.jktDate("bukan tanggal"), null);
});

const LOGS = [
  { habit_cid: "h1", date: "2026-10-29", status: "done" },
  { habit_cid: "h2", date: "2026-10-29", status: "done" },
  { habit_cid: "h1", date: "2026-10-30", status: "skipped" },
  { habit_cid: "h1", date: "2026-10-31", status: "done", deleted: true },
  { habit_cid: "h1", date: "2026-10-20", status: "done" }, // di luar rentang
];
const TASKS = [
  { id: 1, gtd_status: "done", completed_at: "2026-10-29T17:30:00Z" }, // = 30 Okt WIB
  { id: 2, gtd_status: "done", completed_at: "2026-10-29T03:00:00Z" }, // = 29 Okt WIB
  { id: 3, gtd_status: "next", completed_at: "2026-10-29T03:00:00Z" }, // belum selesai → abaikan
  { id: 4, gtd_status: "done", completed_at: null },
  { id: 5, gtd_status: "archived", completed_at: "2026-10-31T01:00:00+07:00" },
  { id: 6, gtd_status: "done", completed_at: "2026-10-31T02:00:00Z", deleted: true },
];

test("bucketByDate: hanya status done, log/task deleted dibuang, rentang inklusif, metric habit/task/both", () => {
  const b = H.bucketByDate(LOGS, TASKS, "2026-10-28", "2026-10-31", "habit");
  assert.deepEqual(Object.keys(b), ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.deepEqual(b["2026-10-29"], { habit: 2, task: 1, count: 2 });
  assert.deepEqual(b["2026-10-30"], { habit: 0, task: 1, count: 0 }, "skipped tidak dihitung");
  assert.deepEqual(b["2026-10-31"], { habit: 0, task: 1, count: 0 }, "log deleted dibuang; task archived dihitung");
  assert.equal(b["2026-10-20"], undefined);
  const t = H.bucketByDate(LOGS, TASKS, "2026-10-28", "2026-10-31", "task");
  assert.equal(t["2026-10-29"].count, 1);
  assert.equal(t["2026-10-30"].count, 1);
  const both = H.bucketByDate(LOGS, TASKS, "2026-10-28", "2026-10-31", "both");
  assert.equal(both["2026-10-29"].count, 3);
  assert.equal(both["2026-10-31"].count, 1);
  assert.equal(both["2026-10-28"].count, 0);
  assert.equal(H.bucketByDate(LOGS, TASKS, "2026-10-28", "2026-10-31")["2026-10-29"].count, 2, "default habit");
});

test("levels: nol tetap 0; semua nol; satu nilai → 4; kuantil 5 tingkat", () => {
  assert.deepEqual(H.levels([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(H.levels([]), []);
  assert.deepEqual(H.levels([0, 3, 0]), [0, 4, 0]);
  assert.deepEqual(H.levels([2, 2, 0]), [4, 4, 0]);
  assert.deepEqual(H.levels([1, 2, 3, 4, 0]), [1, 2, 3, 4, 0]);
  const lv = H.levels([1, 1, 1, 1, 5, 6, 7, 20]);
  assert.ok(lv.every((x) => x >= 1 && x <= 4));
  assert.equal(lv[7], 4);
  assert.equal(lv[0], 1);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i] >= lv[i - 1], "monoton");
});

test("streak: hari ini tanpa aktivitas tidak memutus streak (aturan hero); bolong memutus", () => {
  const c = { "2026-10-28": 1, "2026-10-29": 2, "2026-10-30": 1, "2026-10-31": 0 };
  assert.equal(H.streak(c, "2026-10-31"), 3);
  assert.equal(H.streak(Object.assign({}, c, { "2026-10-31": 1 }), "2026-10-31"), 4);
  assert.equal(H.streak({ "2026-10-29": 1, "2026-10-30": 0, "2026-10-31": 1 }, "2026-10-31"), 1);
  assert.equal(H.streak({ "2026-10-29": 1 }, "2026-10-31"), 0, "kemarin kosong → 0");
  assert.equal(H.streak({}, "2026-10-31"), 0);
  // lintas bulan
  assert.equal(H.streak({ "2026-09-30": 1, "2026-10-01": 1 }, "2026-10-01"), 2);
});

test("buildGrid: 53 kolom / 26 kolom; hari ini di kolom terakhir pada baris hari (Sen=0); rentang 365 / ≤182", () => {
  // 2026-10-31 = Sabtu → baris 5
  const g = H.buildGrid("2026-10-31", 53);
  assert.equal(g.cols, 53);
  assert.equal(g.days, 365);
  const last = g.cells[g.cells.length - 1];
  assert.deepEqual([last.date, last.col, last.row], ["2026-10-31", 52, 5]);
  assert.equal(g.cells.length, 365);
  assert.equal(g.cells[0].date, "2025-11-01");
  assert.ok(g.cells.every((c) => c.col >= 0 && c.col < 53 && c.row >= 0 && c.row < 7));
  assert.equal(new Set(g.cells.map((c) => c.col)).size, 53);
  const m = H.buildGrid("2026-10-31", 26);
  assert.equal(m.cols, 26);
  assert.equal(new Set(m.cells.map((c) => c.col)).size, 26);
  assert.equal(m.days, 25 * 7 + 6);
  assert.equal(m.cells.length, m.days);
  assert.equal(m.cells[m.cells.length - 1].col, 25);
  // Senin di kolom terakhir baris 0, Minggu baris 6
  assert.equal(H.buildGrid("2026-11-02", 26).cells.slice(-1)[0].row, 0);
  assert.equal(H.buildGrid("2026-11-01", 26).cells.slice(-1)[0].row, 6);
  assert.equal(H.buildGrid("2026-11-01", 26).days, 182);
});

test("cellTitle, summaryText, monthLabels: teks persis", () => {
  assert.equal(H.cellTitle("2026-10-13", 3, 2), "Sel 13 Okt · 3 habit · 2 task");
  assert.equal(H.cellTitle("2026-11-01", 0, 0), "Min 1 Nov · 0 habit · 0 task");
  assert.equal(H.summaryText(12, 87, 365), "Streak 12 hari · 87 hari aktif dari 365");
  const g = H.buildGrid("2026-10-31", 53);
  const ml = H.monthLabels(g.cells);
  assert.ok(ml.length >= 12 && ml.length <= 13);
  assert.ok(ml.every((m, i) => i === 0 || m.col > ml[i - 1].col));
  assert.ok(ml.some((m) => m.label === "Okt"));
  assert.ok(ml.every((m) => ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"].includes(m.label)));
});
