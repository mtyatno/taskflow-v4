// Plugin #0 Heatmap Habit (spec docs/superpowers/specs/2026-10-29-plugin-fase0a-design.md §5).
// Grid habit tercentang / task selesai per hari (Asia/Jakarta) di slot dashboard.widgets. Data 100% dari
// api.data (IndexedDB); pilihan metrik di api.storage kunci "metric". `manifest` disuntik compile.js.
// Logika murni diekspor lewat module.exports di Node untuk tes (tests/offline/habit_heatmap_*.test.js).

const DAY_MS = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const LEVEL_PCT = [0, 25, 50, 75, 100];
const DAY_LABELS = [[0, "Sen"], [2, "Rab"], [4, "Jum"]];
const REFRESH_EVENTS = ["habit.changed", "task.completed", "sync.done", "app.dayChanged"];
const DEBOUNCE_MS = 300;
const METRICS = [["habit", "Habit"], ["task", "Task selesai"], ["both", "Keduanya"]];
const METRIC_NAMES = { habit: "habit", task: "task selesai", both: "habit dan task" };
// Geometri dasar (1.0): kotak 11 px, jarak 2, kolom label hari 26, baris label bulan 14, font label 9.
// 1.1: ukuran kotak mengikuti lebar kontainer, dibatasi CELL_MIN–CELL_MAX; label & tepi ikut skala.
const CELL_MIN = 11;
const CELL_MAX = 18;
const K_LEFT = 26 / 11;
const K_TOP = 14 / 11;
const FONT_MAX = 12;

// ── Logika murni ────────────────────────────────────────────────────────────
function parseDay(d) { return Date.parse(d + "T00:00:00Z"); }
function addDays(d, n) { return new Date(parseDay(d) + n * DAY_MS).toISOString().slice(0, 10); }

// `days` tanggal YYYY-MM-DD naik, berakhir di `today`.
function range(today, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}

// Timestamp ISO → tanggal Asia/Jakarta (UTC+7). Tanpa offset dianggap UTC (paritas kanbanboard.js).
function jktDate(v) {
  if (!v) return null;
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += "Z";
  const ms = Date.parse(s);
  if (isNaN(ms)) return null;
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// {[date]: {habit, task, count}} untuk setiap tanggal from..to (inklusif). Habit: log status "done" yang tidak
// terhapus; task: selesai (done/archived) menurut tanggal Jakarta completed_at. count mengikuti metric.
function bucketByDate(logs, tasks, from, to, metric) {
  const m = metric || "habit";
  const out = {};
  const n = Math.round((parseDay(to) - parseDay(from)) / DAY_MS) + 1;
  for (const d of range(to, Math.max(0, n))) out[d] = { habit: 0, task: 0, count: 0 };
  for (const l of logs || []) {
    if (!l || l.deleted || l.status !== "done") continue;
    if (out[l.date]) out[l.date].habit += 1;
  }
  for (const t of tasks || []) {
    if (!t || t.deleted || (t.gtd_status !== "done" && t.gtd_status !== "archived")) continue;
    const d = jktDate(t.completed_at);
    if (d && out[d]) out[d].task += 1;
  }
  for (const d of Object.keys(out)) {
    const b = out[d];
    b.count = m === "task" ? b.task : m === "both" ? b.habit + b.task : b.habit;
  }
  return out;
}

// Tingkat 0–4: nol tetap 0; sisanya kuantil (25/50/75) dari nilai bukan nol; semua sama → 4.
function levels(counts) {
  const nz = counts.filter((c) => c > 0).sort((a, b) => a - b);
  if (!nz.length) return counts.map(() => 0);
  if (nz[0] === nz[nz.length - 1]) return counts.map((c) => (c > 0 ? 4 : 0));
  const q = (p) => nz[Math.floor(p * (nz.length - 1))];
  const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75);
  return counts.map((c) => (c <= 0 ? 0 : c <= q1 ? 1 : c <= q2 ? 2 : c <= q3 ? 3 : 4));
}

// Hari berturut-turut dengan count > 0 sampai hari ini; hari ini yang belum ada aktivitas tidak memutus
// streak (aturan hero / habitlogic.deriveToday).
function streak(counts, today) {
  let cur = (counts[today] || 0) > 0 ? today : addDays(today, -1);
  let n = 0;
  while ((counts[cur] || 0) > 0) { n += 1; cur = addDays(cur, -1); }
  return n;
}

// Run terpanjang hari berturut-turut dengan count > 0 (`counts` = {[YYYY-MM-DD]: n}); tanggal yang hilang
// dari objek memutus run.
function longestStreak(counts) {
  let best = 0, run = 0, prev = null;
  for (const d of Object.keys(counts || {}).sort()) {
    if ((counts[d] || 0) > 0) {
      run = prev && run > 0 && addDays(prev, 1) === d ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prev = d;
  }
  return best;
}

// Grid `cols` minggu × 7 baris (Sen=0 … Min=6); hari ini di kolom terakhir. Rentang 365 hari (≥ 53 kolom)
// atau ≤ 182 hari (26 kolom HP), dipangkas ke kotak yang muat.
function buildGrid(today, cols) {
  const row = (new Date(parseDay(today)).getUTCDay() + 6) % 7;
  const gridDays = (cols - 1) * 7 + row + 1;
  const days = Math.min(cols >= 53 ? 365 : 182, gridDays);
  const start = parseDay(addDays(today, -(gridDays - 1)));
  const cells = range(today, days).map((date) => {
    const i = Math.round((parseDay(date) - start) / DAY_MS);
    return { date, col: Math.floor(i / 7), row: i % 7 };
  });
  return { cols, days, from: cells[0].date, to: today, cells };
}

// Label bulan di atas kolom pertama tempat bulan itu muncul.
function monthLabels(cells) {
  const out = [];
  let last = null;
  for (const c of cells) {
    const mon = Number(c.date.slice(5, 7)) - 1;
    if (mon !== last && !out.some((o) => o.col === c.col)) {
      // label bulan pertama yang terpotong (< 3 kolom) dibuang agar tidak bertumpuk dengan berikutnya
      if (out.length === 1 && c.col - out[0].col < 3) out.pop();
      out.push({ col: c.col, label: MONTHS[mon] });
    }
    last = mon;
  }
  return out;
}

function cellTitle(date, habit, task) {
  const dow = new Date(parseDay(date)).getUTCDay();
  return DAYS[dow] + " " + Number(date.slice(8, 10)) + " " + MONTHS[Number(date.slice(5, 7)) - 1] +
    " · " + habit + " habit · " + task + " task";
}

function summaryText(n, longest, active, days) {
  return "Streak " + n + " hari · Terpanjang " + longest + " hari · " + active + " hari aktif dari " + days;
}

function svgLabel(metric, active) {
  return "Heatmap " + (METRIC_NAMES[metric] || METRIC_NAMES.habit) + ", " + active + " hari aktif";
}

const floor2 = (v) => Math.floor(v * 100) / 100;

// Tata letak grid untuk lebar kontainer `containerWidth` (px) dan `cols` kolom. Kotak CELL_MIN–CELL_MAX, jarak
// ≈ kotak/6 (2–3 px). Kontainer lebih sempit dari grid minimum → kotak 11 (scroll internal seperti 1.0). Kontainer
// lebih lebar dari grid maksimum → kotak tetap 18, sisa lebar dibagi ke jarak supaya grid tetap mengisi kartu.
// Belum terukur (0) → geometri 1.0.
function geometry(containerWidth, cols) {
  const w = Number(containerWidth) > 0 ? Number(containerWidth) : 0;
  let cell = w / (K_LEFT + (cols * 7) / 6);
  let gap = cell / 6;
  if (gap < 2) { cell = (w - 2 * cols) / (K_LEFT + cols); gap = 2; }
  if (!(cell > CELL_MIN)) { cell = CELL_MIN; gap = 2; }
  else if (cell >= CELL_MAX) { cell = CELL_MAX; gap = Math.max(3, (w - K_LEFT * CELL_MAX) / cols - CELL_MAX); }
  cell = floor2(cell);
  gap = floor2(gap);
  const step = cell + gap;
  const left = floor2(K_LEFT * cell);
  const top = floor2(K_TOP * cell);
  return {
    cell, gap, step, left, top,
    width: floor2(left + cols * step), height: floor2(top + 7 * step),
    font: floor2(Math.min(FONT_MAX, (9 * cell) / 11)), rx: floor2((2 * cell) / 11),
  };
}

function cellSize(containerWidth, cols) {
  return geometry(containerWidth, cols).cell;
}

function levelFill(level) {
  return "color-mix(in srgb, var(--accent) " + LEVEL_PCT[level] + "%, var(--bg-card))";
}

// ── UI ──────────────────────────────────────────────────────────────────────
function HeatmapSvg({ grid, buckets, today, label, geo }) {
  const g = geo || geometry(0, grid.cols);
  const lv = levels(grid.cells.map((c) => (buckets[c.date] ? buckets[c.date].count : 0)));
  const k = g.cell / 11;
  return (
    <svg className="plg-heatmap-svg" width={g.width} height={g.height} viewBox={"0 0 " + g.width + " " + g.height}
      style={{ fontSize: g.font }} role="img" aria-label={label || "Heatmap"}>
      {monthLabels(grid.cells).map((m) => (
        <text key={"m" + m.col} x={g.left + m.col * g.step} y={10 * k} className="plg-heatmap-label">{m.label}</text>
      ))}
      {DAY_LABELS.map(([r, l]) => (
        <text key={"d" + r} x={0} y={g.top + r * g.step + 9 * k} className="plg-heatmap-label">{l}</text>
      ))}
      {grid.cells.map((c, i) => {
        const b = buckets[c.date] || { habit: 0, task: 0 };
        return (
          <rect key={c.date} x={g.left + c.col * g.step} y={g.top + c.row * g.step} width={g.cell} height={g.cell} rx={g.rx}
            fill={levelFill(lv[i])} style={{ fill: levelFill(lv[i]) }}
            className={"plg-heatmap-cell" + (c.date === today ? " plg-heatmap-today" : "")}>
            <title>{cellTitle(c.date, b.habit, b.task)}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <div className="plg-heatmap-legend">
      <span>Sedikit</span>
      {LEVEL_PCT.map((p, i) => (
        <span key={p} className="plg-heatmap-legend-cell" style={{ background: levelFill(i) }} aria-hidden="true" />
      ))}
      <span>Banyak</span>
    </div>
  );
}

function useWide() {
  const mq = typeof matchMedia === "function" ? matchMedia("(min-width: 768px)") : null;
  const [wide, setWide] = React.useState(mq ? mq.matches : true);
  React.useEffect(() => {
    if (!mq) return undefined;
    const onChange = (e) => setWide(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);
  return wide;
}

// React.memo dibuat malas (React tidak ada saat plugin.js di-require di tes Node).
let MemoSvg = null;
function memoSvg() {
  if (!MemoSvg) MemoSvg = React.memo ? React.memo(HeatmapSvg) : HeatmapSvg;
  return MemoSvg;
}

function HeatmapCard({ api }) {
  const wide = useWide();
  const [metric, setMetric] = React.useState("habit");
  const pickedRef = React.useRef(false);
  const [src, setSrc] = React.useState(null);
  const [today, setToday] = React.useState(() => api.env.today());
  const scrollRef = React.useRef(null);
  const [boxW, setBoxW] = React.useState(0);
  const cols = wide ? 53 : 26;

  // Lebar area grid → ukuran kotak. ResizeObserver hanya berbunyi saat ukuran berubah (bukan tiap detik Pomodoro).
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      setBoxW((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    let alive = true;
    let timer = null;
    api.storage.get("metric").then((v) => {
      if (alive && !pickedRef.current && METRICS.some((m) => m[0] === v)) setMetric(v);
    }).catch((e) => api.log.warn("gagal membaca metric:", e));
    const load = () => {
      const t = api.env.today();
      Promise.all([api.data.habits.logs({ from: addDays(t, -371), to: t }), api.data.tasks.list({ includeDone: true })])
        .then(([logs, tasks]) => { if (alive) { setToday(t); setSrc({ logs, tasks }); } })
        .catch((e) => api.log.warn("gagal membaca data:", e));
    };
    load();
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, DEBOUNCE_MS); };
    const offs = REFRESH_EVENTS.map((n) => api.events.on(n, refresh));
    return () => { alive = false; clearTimeout(timer); offs.forEach((off) => off()); };
  }, []);

  // HP: grid lebih lebar dari layar → mulai dari ujung kanan (hari ini).
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [wide, src, boxW]);

  const pick = (m) => {
    pickedRef.current = true;
    setMetric(m);
    api.storage.set("metric", m).catch((e) => api.log.warn("gagal menyimpan metric:", e));
  };
  const onSegKey = (e) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = METRICS.findIndex((m) => m[0] === metric);
    const next = METRICS[(i + step + METRICS.length) % METRICS.length][0];
    pick(next);
    const btn = e.currentTarget.querySelector("[data-metric='" + next + "']");
    if (btn) btn.focus();
  };

  // Dashboard dirender ulang tiap detik saat Pomodoro berjalan: hitung grid hanya bila datanya berubah.
  const { grid, buckets, summary, active } = React.useMemo(() => {
    const grid = buildGrid(today, wide ? 53 : 26);
    const buckets = src ? bucketByDate(src.logs, src.tasks, grid.from, today, metric) : {};
    const counts = {};
    let active = 0;
    for (const d of Object.keys(buckets)) {
      counts[d] = buckets[d].count;
      if (buckets[d].count > 0) active += 1;
    }
    return { grid, buckets, active, summary: summaryText(streak(counts, today), longestStreak(counts), active, grid.days) };
  }, [src, metric, today, wide]);
  const geo = React.useMemo(() => geometry(boxW, cols), [boxW, cols]);
  const Svg = memoSvg();

  return (
    <div className="dash-card plg-heatmap" style={{ gridColumn: "1 / -1" }}>
      <div className="dash-card-head plg-heatmap-head">
        <div className="dash-card-title">Heatmap</div>
        <div className="plg-heatmap-seg" role="radiogroup" aria-label="Metrik heatmap" onKeyDown={onSegKey}>
          {METRICS.map(([id, text]) => (
            <button key={id} type="button" role="radio" data-metric={id} aria-checked={metric === id ? "true" : "false"}
              tabIndex={metric === id ? 0 : -1} onClick={() => pick(id)}>{text}</button>
          ))}
        </div>
      </div>
      <div className="plg-heatmap-scroll" ref={scrollRef}>
        <Svg grid={grid} buckets={buckets} today={today} geo={geo} label={svgLabel(metric, active)} />
      </div>
      <div className="plg-heatmap-foot">
        <div className="plg-heatmap-summary">{summary}</div>
        <Legend />
      </div>
    </div>
  );
}

const pure = {
  range, jktDate, bucketByDate, levels, streak, longestStreak, buildGrid, monthLabels, cellTitle, summaryText, svgLabel,
  levelFill, geometry, cellSize, HeatmapSvg, Legend, LEVEL_PCT, DAY_LABELS, REFRESH_EVENTS, DEBOUNCE_MS,
};
if (typeof module !== "undefined" && module.exports) module.exports = pure;

const host = typeof window !== "undefined" ? window : null;
if (host && host.TF && host.TF.plugins) {
  host.TF.plugins.register(manifest, function factory(api) {
    return { slots: { "dashboard.widgets": [{ id: "heatmap", order: 10, component: HeatmapCard }] } };
  });
}
