// Plugin Timeline (Fase 1, PR 1b; spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8).
// Gantt Manual untuk project dan workspace: view `gantt` (slot taskList.views) dan seksi `schedule` (slot
// taskDetail.sections). Mesin murni ada di `parts` (holidays-id.js, calendar.js, schedule.js, layout.js, drag.js —
// compile.js menggabungkannya SEBELUM kode ini, jadi TLHolidays/TLCal/TLSched/TLLayout/TLDrag tersedia sebagai
// const di lingkup yang sama; tidak ada global window). `manifest` disuntik compile.js dari manifest.json.
//
// Susunan modul (Task 6 = kerangka; komponen diisi Task 7–10):
//   1. Konstanta + pesan UI persis (kalender, preferensi).
//   2. calendarStore(api)  — SATU-SATUNYA kode yang menyentuh api.records (R5). calTarget(listId) memilih id/scope.
//   3. Preferensi per perangkat lewat api.storage: prefKey / cleanPref / PREF_DEFAULTS (R19).
//   4. Komponen: konstanta tampilan, pembantu murni, hooks (useMedia/usePref/useCalendar), fungsi render
//      (toolbar/head/tabel/grafik/panah/legenda), TimelineViewBody (Task 7; interaksi Task 8 lewat `ix`; popover
//      kalender + Daftar HP Task 9), ScheduleSection (Task 10); pembungkus React.memo malas (R24).
//   5. `pure` + module.exports untuk tes Node; registrasi hanya bila host plugin (TF.plugins) ada.

// ── 1. Konstanta ────────────────────────────────────────────────────────────
const CAL_ENTITY = "calendar";
const CAL_MAX_BYTES = 16384;
const MSG_CAL_TOO_LARGE = "Kalender terlalu besar — hapus sebagian libur tambahan";
const MSG_CAL_LOST = "Perubahan kalender di perangkat ini kalah oleh perubahan yang lebih baru";
const LIST_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// ── 2. Kalender (R4, R5) ────────────────────────────────────────────────────
// Task dengan list_id memakai kalender workspace `cal@list:<id>` (scope "list:<id>", dibagi semua anggota);
// tanpa list_id kalender pribadi `cal@user` (scope "user").
function calTarget(listId) {
  const s = listId == null ? "" : String(listId).trim();
  if (!s || s === "0" || !LIST_ID_RE.test(s)) return { id: "cal@user", scope: "user" };
  return { id: "cal@list:" + s, scope: "list:" + s };
}

function calTooLarge() {
  const e = new Error(MSG_CAL_TOO_LARGE);
  e.code = "TOO_LARGE";
  return e;
}

// Adaptor tunggal api.records untuk entitas `calendar`. Tidak ada record → DEFAULT_CAL (pending false).
// Data dari anggota lain selalu lewat TLCal.normalize. save menolak > 16384 byte di klien sebelum put.
function calendarStore(api) {
  return {
    load(calId) {
      return Promise.resolve().then(() => api.records.get(CAL_ENTITY, calId)).then((r) => {
        if (!r) return { data: TLCal.normalize(TLCal.DEFAULT_CAL), pending: false };
        return { data: TLCal.normalize(r.data), pending: !!r.pending };
      });
    },
    save(calId, scope, data) {
      return Promise.resolve().then(() => {
        const clean = TLCal.normalize(data);
        if (TLCal.byteSize(clean) > CAL_MAX_BYTES) throw calTooLarge();
        return api.records.put(CAL_ENTITY, calId, clean, { scope }).then((r) => ({
          data: TLCal.normalize(r && r.data ? r.data : clean),
          pending: !!(r && r.pending),
        }), (e) => { throw e && e.code === "TOO_LARGE" ? calTooLarge() : e; });
      });
    },
    // fn({ids, source: "local"|"sync", lost: string[]}) hanya untuk entitas calendar; mengembalikan off().
    subscribe(fn) {
      return api.records.onChange((ev) => {
        if (!ev || ev.entity !== CAL_ENTITY) return;
        fn({ ids: Array.isArray(ev.ids) ? ev.ids.slice() : [], source: ev.source, lost: Array.isArray(ev.lost) ? ev.lost.slice() : [] });
      });
    },
  };
}

// ── 3. Preferensi per perangkat (R19) ───────────────────────────────────────
const PREF_DEFAULTS = Object.freeze({ zoom: "week", sort: "wbs", cols: false, mode: "gantt", section: false });
const PREF_CHOICES = Object.freeze({ zoom: ["day", "week", "month"], sort: ["wbs", "start"], mode: ["gantt", "list"] });

// "zoom:<page>", "sort:<page>", "cols:<page>", "mode:<page>"; seksi Jadwal global: "section:open".
function prefKey(kind, page) {
  return kind === "section" ? "section:open" : kind + ":" + page;
}

// Nilai dari api.storage → nilai sah, atau bawaan bila rusak/tidak ada.
function cleanPref(kind, value) {
  const choices = PREF_CHOICES[kind];
  if (choices) return choices.indexOf(value) >= 0 ? value : PREF_DEFAULTS[kind];
  return value === true;
}

// ── 4. Komponen ─────────────────────────────────────────────────────────────
// 4a. Konstanta tampilan + teks UI persis (Global Constraints).
const HEAD_H = 48; // dua baris header skala waktu (24 + 24)
const VIEW_W0 = 1000; // lebar grafik tampak sebelum diukur
const VIEW_H0 = 600; // tinggi area baris tampak sebelum diukur
const MIN_BOX_H = 360; // R11: tinggi wadah minimal
const BOX_GAP = 16; // R11: jarak bawah wadah ke tepi jendela
const BAR_H = 16;
const SUM_H = 8;
const MS_SIZE = 12; // milestone belah ketupat 12 px
const MQ_NARROW = "(max-width: 640px)";
const MQ_COARSE = "(pointer: coarse)";

const ZOOMS = [["day", "Hari"], ["week", "Minggu"], ["month", "Bulan"]];
const LBL = {
  today: "Hari ini", calendar: "Kalender kerja", sort: "Urutkan menurut Mulai", cols: "Kolom",
  gantt: "Gantt", list: "Daftar", zoom: "Skala waktu", mode: "Tampilan",
};
const MSG_EMPTY = "Belum ada task di halaman ini";
const MSG_VIOLATION = "Mulai sebelum dependensi selesai";
const MSG_SCHEDULE_HINT = "Klik untuk menjadwalkan";
// Interaksi (R13–R15, R21): teks persis.
const MSG_CHANGED = "Jadwal diubah";
const MSG_UNDO = "Urungkan";
const MSG_SAVE_FAIL = "Jadwal gagal disimpan";
const MSG_CYCLE = "Dependensi ini membuat lingkaran";
const MSG_MAX_DEPS = "Maksimal 20 dependensi per task";
const MSG_SUMMARY_DEP = "Ringkasan tidak bisa diberi dependensi di versi ini";
// Alasan penolakan TLSched.canLink → toast. self/dup/scope tidak bertoast: tidak ada yang perlu ditulis
// (diri sendiri, sudah ada) atau tidak bisa terjadi di view (kedua ujung adalah baris halaman ini).
const LINK_MSG = { cycle: MSG_CYCLE, max: MSG_MAX_DEPS, summary: MSG_SUMMARY_DEP };
const DOUBLE_TAP_MS = 400; // R21 sentuh: ketuk ganda
const DOUBLE_TAP_PX = 24;
const LEGEND = [
  ["task", "Task"], ["done", "Selesai"], ["late", "Lewat tenggat"], ["summary", "Ringkasan"],
  ["milestone", "Milestone"], ["flag", "Tenggat"], ["holiday", "Libur"], ["dep", "Dependensi"],
];
// Kolom tabel (spec §8.5 butir 5). Sempit (≤ 640 px) / Live Edit: hanya WBS + Nama (160 px) kecuali "Kolom" ON (R20).
const COLS_FULL = [
  { id: "wbs", label: "WBS", w: 56 }, { id: "name", label: "Nama", w: 220 }, { id: "start", label: "Mulai", w: 92 },
  { id: "dur", label: "Dur", w: 56 }, { id: "pomo", label: "🍅", w: 52 }, { id: "pct", label: "%", w: 56 },
];
const COLS_COMPACT = [{ id: "wbs", label: "WBS", w: 48 }, { id: "name", label: "Nama", w: 160 }];

function missingYearsNote(years) {
  return "Libur nasional " + years.join(", ") + " belum ada di Alurik versi ini.";
}

// Tata letak lewat objek yang bisa diganti tes (TLLayout beku; tes R24 memata-matai jumlah panggilan).
const engine = { layout: (args) => TLLayout.layout(args) };

const DEFAULT_CAL_DATA = TLCal.normalize(TLCal.DEFAULT_CAL);

// 4b. Pembantu murni.
function cx() {
  let out = "";
  for (let i = 0; i < arguments.length; i++) if (arguments[i]) out += (out ? " " : "") + arguments[i];
  return out;
}

function logWarn(api, msg, err) {
  try { api.log.warn(msg, err); } catch (e) { /* log tidak tersedia */ }
}

function safeToday(api) {
  try {
    const t = api.env.today();
    return typeof t === "string" && TLCal.isIso(t) ? t : null;
  } catch (e) {
    return null;
  }
}

function pomoText(t) {
  const done = Number(t.pomodoros_done) || 0;
  const est = Number(t.estimated_pomodoros) || 0;
  return done || est ? done + "/" + est : "—";
}

// Isi sel tabel satu baris: {wbs, name, start, dur, pomo, pct}.
function rowCells(row, groupName) {
  if (row.kind === "group") return { wbs: row.wbs, name: groupName || "", start: "", dur: "", pomo: "", pct: "" };
  const t = row.task;
  const title = t.title !== undefined && t.title !== null && String(t.title).trim() ? String(t.title).trim() : "Tanpa judul";
  return {
    wbs: row.wbs,
    name: title,
    start: row.span ? TLCal.fmtShort(row.span.s) : "—",
    dur: row.duration === null || row.duration === undefined ? "—" : row.duration + " hk",
    pomo: pomoText(t),
    pct: Math.round(row.progress) + "%",
  };
}

// Kotak bar baris (px, relatif awal rentang) atau null: baris outOfRange tidak pernah mendapat bar (Task 4).
function boxOf(row, lay) {
  if (!row.span || row.outOfRange || row.kind === "group") return null;
  const sched = row.kind === "summary" ? { duration: row.duration } : row.sched;
  return TLLayout.barBox(row.span, sched, lay.range, lay.px, row.kind);
}

// Geometri bar dalam koordinat grafik (sama dengan renderBar): x/top kiri-atas elemen, w/h ukuran.
function barGeom(row, box, rowH) {
  if (box.milestone) return { x: box.x - MS_SIZE / 2, top: row.index * rowH + (rowH - MS_SIZE) / 2, w: MS_SIZE, h: MS_SIZE, ms: true };
  const h = row.kind === "summary" ? SUM_H : BAR_H;
  return { x: box.x, top: row.index * rowH + (rowH - h) / 2, w: box.w, h, ms: false };
}

function translate(x, y) {
  return "translate(" + x + "px," + y + "px)";
}

function nowMs() {
  return typeof performance !== "undefined" && performance && typeof performance.now === "function" ? performance.now() : Date.now();
}

function toastSafe(api, msg, type, action) {
  try {
    if (action) api.ui.toast(msg, type, action);
    else api.ui.toast(msg, type);
  } catch (e) {
    logWarn(api, "toast gagal:", e);
  }
}

function quantLeft(left, w) {
  const q = Math.max(1, Math.round(w / 2));
  return Math.floor(Math.max(0, left) / q) * q;
}

function raf(fn) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
  fn();
  return 0;
}

function caf(id) {
  if (id && typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
}

function hasWindow() {
  return typeof window !== "undefined" && !!window;
}

function mq(q) {
  try {
    return hasWindow() && typeof window.matchMedia === "function" && !!window.matchMedia(q).matches;
  } catch (e) {
    return false;
  }
}

// 4c. Hooks.
function useMedia(q) {
  const [on, setOn] = React.useState(() => mq(q));
  React.useEffect(() => {
    if (!hasWindow() || typeof window.matchMedia !== "function") return undefined;
    let m = null;
    try { m = window.matchMedia(q); } catch (e) { return undefined; }
    const fn = () => setOn(!!m.matches);
    fn();
    if (typeof m.addEventListener === "function") {
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    }
    if (typeof m.addListener === "function") {
      m.addListener(fn);
      return () => m.removeListener(fn);
    }
    return undefined;
  }, [q]);
  return on;
}

function readPref(api, kind, page) {
  return Promise.resolve()
    .then(() => api.storage.get(prefKey(kind, page)))
    .then((v) => cleanPref(kind, v), (e) => {
      logWarn(api, "preferensi " + kind + " gagal dibaca:", e);
      return PREF_DEFAULTS[kind];
    });
}

function writePref(api, kind, page, value) {
  Promise.resolve()
    .then(() => api.storage.set(prefKey(kind, page), value))
    .catch((e) => logWarn(api, "preferensi " + kind + " gagal disimpan:", e));
}

// Preferensi per perangkat (R19): bawaan dulu, lalu nilai api.storage — kecuali pengguna sudah memilih lebih dulu.
function usePref(api, kind, page) {
  const [val, setVal] = React.useState(PREF_DEFAULTS[kind]);
  const picked = React.useRef(false);
  React.useEffect(() => {
    let alive = true;
    picked.current = false;
    readPref(api, kind, page).then((v) => {
      if (alive && !picked.current) setVal(v);
    });
    return () => { alive = false; };
  }, [api, kind, page]);
  const set = React.useCallback((v) => {
    picked.current = true;
    setVal(v);
    writePref(api, kind, page, v);
  }, [api, kind, page]);
  return [val, set];
}

// Kalender aktif halaman (R4/R5): muat lewat calendarStore, muat ulang saat sinkron/perubahan id ini;
// edit lokal yang kalah LWW → toast persis (spec §8.9).
function useCalendar(api, target) {
  const store = React.useMemo(() => calendarStore(api), [api]);
  const [st, setSt] = React.useState(() => ({ id: target.id, data: DEFAULT_CAL_DATA, pending: false }));
  React.useEffect(() => {
    let alive = true;
    const id = target.id;
    const load = () => store.load(id).then((r) => {
      if (alive) setSt({ id, data: r.data, pending: r.pending });
    }, (e) => logWarn(api, "kalender gagal dimuat:", e));
    load();
    let off = null;
    try {
      off = store.subscribe((ev) => {
        const lost = ev.lost.indexOf(id) >= 0;
        if (lost) {
          try { api.ui.toast(MSG_CAL_LOST, "error"); } catch (e) { logWarn(api, "toast gagal:", e); }
        }
        if (lost || ev.source === "sync" || ev.ids.indexOf(id) >= 0) load();
      });
    } catch (e) {
      logWarn(api, "pendengar kalender gagal:", e);
    }
    return () => {
      alive = false;
      if (typeof off === "function") off();
    };
  }, [store, target.id]);
  const mine = st.id === target.id;
  return { data: mine ? st.data : DEFAULT_CAL_DATA, pending: mine && st.pending, store };
}

// 4d. Render (fungsi biasa dipanggil langsung → pohon utuh untuk tes anggaran DOM; tanpa hooks di dalamnya).
function renderToolbar(v) {
  const seg = (items, cur, pick, label) => (
    <div className="plg-timeline-seg" role="radiogroup" aria-label={label}>
      {items.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={cur === id} className={cx("plg-timeline-seg-btn", cur === id && "is-active")} onClick={() => pick(id)}>{text}</button>
      ))}
    </div>
  );
  return (
    <div className="plg-timeline-toolbar">
      {seg(ZOOMS, v.zoom, v.pickZoom, LBL.zoom)}
      <button type="button" className="plg-timeline-btn" onClick={v.goToday}>{LBL.today}</button>
      <button type="button" className={cx("plg-timeline-btn", v.calOpen && "is-active")} aria-expanded={v.calOpen} onClick={v.toggleCal}>{LBL.calendar}</button>
      <button type="button" className={cx("plg-timeline-btn", v.sort === "start" && "is-active")} aria-pressed={v.sort === "start"} onClick={() => v.setSort(v.sort === "start" ? "wbs" : "start")}>{LBL.sort}</button>
      {v.compact ? <button type="button" className={cx("plg-timeline-btn", v.cols && "is-active")} aria-pressed={v.cols} onClick={() => v.setCols(!v.cols)}>{LBL.cols}</button> : null}
      {v.narrow ? seg([["gantt", LBL.gantt], ["list", LBL.list]], v.mode, v.setMode, LBL.mode) : null}
    </div>
  );
}

function renderHead(v) {
  const { lay, colDefs, tableW, dw, chartW } = v;
  const ticks = TLLayout.headerTicks(lay.zoom, dw.fromDn, dw.toDn);
  const tick = (c, top) => (
    <div key={(top ? "t" : "b") + c.key} className={cx("plg-timeline-tick", top && "is-top")} data-sub={c.sub === null ? undefined : c.sub} style={{ left: TLLayout.xOf(c.dn, lay.range, lay.px), width: c.days * lay.px }}>{c.label}</div>
  );
  return (
    <div className="plg-timeline-head" style={{ height: HEAD_H }}>
      <div className="plg-timeline-corner" role="row" aria-rowindex={1} style={{ width: tableW }}>
        {colDefs.map((c) => (
          <div key={c.id} role="columnheader" className={cx("plg-timeline-cell", "plg-timeline-col-" + c.id)} style={{ width: c.w }}>{c.label}</div>
        ))}
      </div>
      <div className="plg-timeline-scale" aria-hidden="true" style={{ width: chartW }}>
        {ticks.top.map((c) => tick(c, true))}
        {ticks.bottom.map((c) => tick(c, false))}
      </div>
    </div>
  );
}

function renderTableRows(v) {
  const { lay, rw, rowH, colDefs, groupNames, ix, isSel } = v;
  const out = [];
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const c = rowCells(r, groupNames.get(r.group));
    const sel = !!r.task && isSel(r.task);
    out.push(
      <div key={r.key} role="row" aria-rowindex={r.index + 2} aria-selected={r.task ? sel : undefined} data-key={r.key} tabIndex={r.task ? -1 : undefined}
        className={cx("plg-timeline-row", r.kind === "group" && "is-group", r.kind === "summary" && "is-summary", sel && "is-selected")}
        style={{ top: r.index * rowH, height: rowH }}
        onClick={r.task ? (e) => ix.open(r, e) : undefined} onKeyDown={r.task ? (e) => ix.key(r, e) : undefined}>
        {colDefs.map((col) => {
          if (col.id === "name") {
            return (
              <div key="name" role="gridcell" className="plg-timeline-cell plg-timeline-col-name" style={{ width: col.w, paddingLeft: 8 + r.depth * 14 }}>
                <span className="plg-timeline-name">{c.name}</span>
                {r.violation ? <span className="plg-timeline-warn" role="img" aria-label={MSG_VIOLATION} title={MSG_VIOLATION}>⚠</span> : null}
              </div>
            );
          }
          return <div key={col.id} role="gridcell" className={cx("plg-timeline-cell", "plg-timeline-col-" + col.id)} style={{ width: col.w }}>{c[col.id]}</div>;
        })}
      </div>
    );
  }
  return out;
}

// Bar / ringkasan / milestone satu baris (R11, R12, R23). Label nama di kanan bar (anak, aria-hidden).
// Task 8: bar task/milestone menerima pointerdown (ix.barDown: zona badan/tepi/titik dari TLDrag.hitZone) + pegangan tepi
// kanan (bukan milestone) dan titik dependensi di kanan ujung (desktop; CSS menyembunyikannya di layar sentuh).
// Ringkasan tidak bisa diseret dan tidak bisa jadi ujung dependensi (R10) → tanpa pointerdown.
function renderBar(r, box, y, v) {
  const { rowH, isSel } = v;
  const t = r.task;
  const sel = isSel(t);
  const title = rowCells(r).name;
  const aria = TLLayout.ariaBar(t, r.kind === "summary" ? { duration: r.duration } : r.sched, r.span, r.progress, r.kind);
  const g = barGeom(r, box, rowH);
  const common = {
    key: "b" + r.key, "data-key": r.key, role: "button", tabIndex: 0, "aria-label": aria,
    onClick: (e) => v.ix.open(r, e), onKeyDown: (e) => v.ix.key(r, e),
    onPointerDown: r.kind === "summary" || !v.ix.barDown ? undefined : (e) => v.ix.barDown(r, e),
  };
  const label = <span className="plg-timeline-label" aria-hidden="true">{title}</span>;
  const dot = <span className="plg-timeline-dot" aria-hidden="true" />;
  if (box.milestone) {
    return (
      <div {...common} className={cx("plg-timeline-milestone", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected")}
        style={{ transform: translate(g.x, g.top), width: g.w, height: g.h }}>{label}{dot}</div>
    );
  }
  if (r.kind === "summary") {
    return (
      <div {...common} className={cx("plg-timeline-summary", r.late > 0 && "is-late", sel && "is-selected")}
        style={{ transform: translate(g.x, g.top), width: g.w, height: g.h }}>{label}</div>
    );
  }
  const pct = r.done ? 100 : Math.round(r.progress);
  return (
    <div {...common} className={cx("plg-timeline-bar", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected")}
      style={{ transform: translate(g.x, g.top), width: g.w, height: g.h }}>
      <div className="plg-timeline-fill" style={{ width: pct + "%" }} />
      {label}
      <span className="plg-timeline-edge" aria-hidden="true" />
      {dot}
    </div>
  );
}

function renderChart(v) {
  const { lay, rw, dw, rowH, chartW, bodyH, todayDn, tableW, ix } = v;
  const R = lay.range;
  const px = lay.px;
  const c = lay.cal;
  const winX = TLLayout.xOf(dw.fromDn, R, px);
  const winW = (dw.toDn - dw.fromDn + 1) * px;
  const out = [];
  // libur (bukan akhir pekan; akhir pekan sudah diarsir gradien) dan hari kerja pengganti, hanya di kolom tampak
  for (const h of TLLayout.holidaySpans(c, dw.fromDn, dw.toDn)) {
    if (h.weekend) continue;
    out.push(<div key={"h" + h.dn} className="plg-timeline-holiday" data-dn={h.dn} title={h.name} style={{ left: TLLayout.xOf(h.dn, R, px), width: px }} />);
  }
  for (const d of c.work) {
    if (d < dw.fromDn || d > dw.toDn || c.mask.has(TLCal.isoWeekday(d))) continue;
    out.push(<div key={"w" + d} className="plg-timeline-workday" data-dn={d} style={{ left: TLLayout.xOf(d, R, px), width: px }} />);
  }
  if (todayDn !== null && todayDn >= R.from && todayDn <= R.to) {
    out.push(<div key="today" className="plg-timeline-today" style={{ left: TLLayout.xOf(todayDn, R, px) + px / 2 - 1 }} />);
  }
  for (let i = rw.first; i <= rw.last; i++) {
    const r = lay.rows[i];
    const y = r.index * rowH;
    if (r.kind === "group") {
      out.push(<div key={"g" + r.key} className="plg-timeline-band" style={{ top: y, height: rowH, left: winX, width: winW }} />);
      continue;
    }
    const box = boxOf(r, lay);
    if (!r.span && r.kind === "task") {
      // R21: tanpa jadwal → tanpa bar; petunjuk tipis saat hover (klik untuk menjadwalkan = Task 8, ix.slotDown)
      out.push(
        <div key={"s" + r.key} className="plg-timeline-slot" data-key={r.key} style={{ top: y, height: rowH, left: winX, width: winW }}
          onPointerDown={ix.slotDown ? (e) => ix.slotDown(r, e) : undefined}>
          <span className="plg-timeline-hint" style={{ left: tableW + 8, lineHeight: rowH + "px" }}>{MSG_SCHEDULE_HINT}</span>
        </div>
      );
    }
    if (box) out.push(renderBar(r, box, y, v));
    if (r.deadlineDn !== null && r.deadlineDn >= R.from && r.deadlineDn <= R.to) {
      const tip = "Tenggat " + TLCal.fmtShort(r.deadlineDn);
      out.push(<div key={"f" + r.key} className={cx("plg-timeline-flag", r.late > 0 && "is-late")} data-key={r.key} role="img" aria-label={tip} title={tip}
        style={{ left: TLLayout.xOf(r.deadlineDn + 1, R, px) - 1, top: y, height: rowH }} />);
    }
  }
  out.push(renderArrows(v, winX, winW));
  // Task 8: garis karet dependensi + tooltip seret; selalu ada, disembunyikan, diubah lewat ref (tanpa setState).
  out.push(
    <svg key="rubber" ref={ix.rubberRef} className="plg-timeline-rubber" aria-hidden="true" width={chartW} height={bodyH} style={{ display: "none" }}>
      <line ref={ix.lineRef} className="plg-timeline-rubber-line" />
    </svg>
  );
  out.push(<div key="tip" ref={ix.tipRef} className="plg-timeline-tip" aria-hidden="true" style={{ display: "none" }} />);
  return (
    <div className="plg-timeline-chart" ref={ix.chartRef} style={{ width: chartW, height: bodyH, backgroundImage: TLLayout.weekendGradient(c, R, px) }}>
      {out}
    </div>
  );
}

// Satu <svg> seukuran jendela tampak; panah digambar bila salah satu ujungnya di baris tampak (spec §8.6).
function renderArrows(v, winX, winW) {
  const { lay, rw, rowH } = v;
  const oy = rw.first * rowH;
  const rect = (idx) => {
    const r = lay.rows[idx];
    const box = r ? boxOf(r, lay) : null;
    if (!box) return null;
    const h = r.kind === "summary" ? SUM_H : box.milestone ? MS_SIZE : BAR_H;
    const x = box.milestone ? box.x - MS_SIZE / 2 : box.x;
    const w = box.milestone ? MS_SIZE : box.w;
    return { x: x - winX, y: idx * rowH + (rowH - h) / 2 - oy, w, h };
  };
  const inWin = (i) => i !== null && i >= rw.first && i <= rw.last;
  const paths = [];
  for (const e of lay.edges) {
    if (!e.drawn || !(inWin(e.fromRow) || inWin(e.toRow))) continue;
    const a = rect(e.fromRow);
    const b = rect(e.toRow);
    if (!a || !b) continue;
    paths.push(
      <path key={e.from + ">" + e.to} className={cx("plg-timeline-arrow", e.violation && "is-violation")} d={TLLayout.arrowPath(a, b)}
        markerEnd={e.violation ? "url(#plg-timeline-ah-v)" : "url(#plg-timeline-ah)"} />
    );
  }
  return (
    <svg key="arrows" className="plg-timeline-arrows" aria-hidden="true" width={winW} height={Math.max(0, (rw.last - rw.first + 1) * rowH)}
      style={{ left: winX, top: oy }}>
      <defs>
        <marker id="plg-timeline-ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path className="plg-timeline-head-path" d="M0 0L6 3L0 6z" />
        </marker>
        <marker id="plg-timeline-ah-v" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path className="plg-timeline-head-path is-violation" d="M0 0L6 3L0 6z" />
        </marker>
      </defs>
      {paths}
    </svg>
  );
}

function renderLegend(lay, ref) {
  return (
    <div className="plg-timeline-foot" ref={ref}>
      <div className="plg-timeline-legend">
        {LEGEND.map(([id, text]) => (
          <span key={id} className="plg-timeline-legend-item">
            <span className={cx("plg-timeline-swatch", "is-" + id)} aria-hidden="true" />{text}
          </span>
        ))}
      </div>
      {lay.missingYears.length ? <div className="plg-timeline-note">{missingYearsNote(lay.missingYears)}</div> : null}
    </div>
  );
}

// Task 9: popover kalender kerja (R18) dan tampilan Daftar HP (R20). Kerangka — belum merender apa pun.
function CalendarPopover(props) {
  return null;
}

function ListFallback(props) {
  return null;
}

// 4e'. Interaksi (Task 8; R13–R15, R21, R23). Satu pengendali per instance view (dibuat sekali, disimpan di ref) agar
// pendengar window selama seret selalu membaca nilai terkini lewat `X.cur` (layout, api, context) yang diisi tiap render.
// Aturan: TLDrag menentukan semuanya (zona, ambang, jepret, commit); komponen hanya menerjemahkan pointer → peristiwa,
// menulis transform/lebar bar + tooltip + garis karet lewat ref dalam rAF (tanpa setState selama gerak), dan menulis
// ext tepat SEKALI per lepas. Esc / pointercancel / blur / lepas di luar grafik = batal tanpa tulis.
//
// Nilai ext "efektif": setelah tulis, props bisa tertinggal sebentar (host memperbarui daftar setelah IndexedDB). Agar
// tombol Alt+panah yang ditahan atau seret berikutnya tidak menghitung dari props basi, nilai hasil tulis terakhir
// disimpan per task bersama JSON props saat itu; selama props masih sama dengan JSON itu, nilai hasil tulis yang dipakai.
function createInteractions() {
  const X = {
    cur: null,
    chartRef: { current: null },
    tipRef: { current: null },
    rubberRef: { current: null },
    lineRef: { current: null },
    g: null, // gestur seret aktif
    slot: null, // gestur klik-jadwalkan aktif
    tap: null, // ketukan sentuh terakhir pada area kosong (ketuk ganda)
    busy: new Set(), // String(task.id) dengan tulis yang sedang berjalan
    after: new Map(), // String(task.id) → {stale: JSON props saat tulis, eff: nilai ext setelah tulis}
    suppress: false, // klik native setelah seret/batal tidak membuka task
  };
  const win = () => (hasWindow() && typeof window.addEventListener === "function" ? window : null);
  const keyOf = (task) => String(task.id);
  const samePointer = (g, e) => g.pointerId === undefined || e.pointerId === undefined || e.pointerId === g.pointerId;
  const isPrimary = (e) => e.button === undefined || e.button === 0;
  const prevent = (e) => { if (e && typeof e.preventDefault === "function") e.preventDefault(); };

  // Titik pointer dalam koordinat grafik (x = 0 di awal rentang; ikut gulir karena rect grafik ikut bergeser).
  function chartPt(e) {
    const el = X.chartRef.current;
    if (!el || typeof el.getBoundingClientRect !== "function") return null;
    const x = Number(e.clientX);
    const y = Number(e.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = el.getBoundingClientRect();
    return { x: x - (Number(r.left) || 0), y: y - (Number(r.top) || 0) };
  }

  // Lepas "di dalam grafik" = di area grafik yang tampak (kanan tabel menempel, bawah header, di dalam wadah).
  function insideChart(e) {
    const el = X.cur && X.cur.scrollEl();
    if (!el || typeof el.getBoundingClientRect !== "function") return false;
    const r = el.getBoundingClientRect();
    const x = Number(e.clientX);
    const y = Number(e.clientY);
    return x >= r.left + X.cur.tableW && x <= r.right && y >= r.top + HEAD_H && y <= r.bottom;
  }

  function rowKeyAt(y) {
    const { lay, rowH } = X.cur;
    if (!(y >= 0)) return null;
    const r = lay.rows[Math.floor(y / rowH)];
    return r ? r.key : null;
  }

  function rawOf(task) {
    let props;
    try {
      props = X.cur.api.taskExt.read(task);
    } catch (e) {
      props = null;
    }
    if (!props || typeof props !== "object") props = {};
    const pj = JSON.stringify(props);
    const a = X.after.get(keyOf(task));
    if (a && a.stale === pj) return { eff: a.eff, pj };
    if (a) X.after.delete(keyOf(task));
    return { eff: props, pj };
  }
  const schedOf = (raw) => Object.assign(TLSched.readSched(raw), { raw });

  // Satu tulis (set, atau setMany untuk Urungkan). Penolakan diteruskan ke pemanggil.
  function issue(task, rr, patch, many) {
    const k = keyOf(task);
    const api = X.cur.api;
    X.busy.add(k);
    X.after.set(k, { stale: rr.pj, eff: Object.assign({}, rr.eff, patch) });
    let p;
    try {
      p = many ? api.taskExt.setMany([{ taskId: task.id, patch }]) : api.taskExt.set(task.id, patch);
    } catch (e) {
      p = Promise.reject(e);
    }
    return Promise.resolve(p).then(() => {
      X.busy.delete(k);
    }, (err) => {
      X.busy.delete(k);
      X.after.delete(k);
      throw err;
    });
  }

  function failed(api, err) {
    logWarn(api, "jadwal gagal disimpan:", err);
    toastSafe(api, MSG_SAVE_FAIL, "error");
  }

  // set → toast "Jadwal diubah" + Urungkan (setMany nilai lama persis). Resolve true/false (tidak pernah reject).
  function write(task, rr, patch, prev) {
    const api = X.cur.api;
    return issue(task, rr, patch, false).then(() => {
      toastSafe(api, MSG_CHANGED, "success", { label: MSG_UNDO, onClick: () => undo(task, prev) });
      return true;
    }, (err) => {
      failed(api, err);
      return false;
    });
  }

  // onClick Urungkan: runtime hanya menangkap lemparan sinkron, jadi penolakan setMany ditangani di sini.
  function undo(task, prev) {
    const api = X.cur.api;
    issue(task, rawOf(task), prev, true).catch((err) => failed(api, err));
  }

  function suppressClick() {
    X.suppress = true;
    setTimeout(() => { X.suppress = false; }, 0); // klik native menyusul pointerup dalam tugas yang sama
  }

  function openTask(row) {
    const ctx = X.cur && X.cur.context;
    if (row && row.task && ctx && typeof ctx.onTaskClick === "function") ctx.onTaskClick(row.task);
  }

  // ---- seret bar ----
  function barDown(row, e) {
    if (!e || X.g || !row || !row.task || row.kind === "summary" || !isPrimary(e)) return;
    const cur = X.cur;
    const lay = cur.lay;
    const box = boxOf(row, lay);
    const pt = chartPt(e);
    if (!box || !pt || X.busy.has(keyOf(row.task))) return;
    X.suppress = false;
    const touch = e.pointerType === "touch";
    const zone = TLDrag.hitZone({ x: pt.x, barLeft: box.x, barWidth: box.milestone ? 0 : box.w, touch, armed: false });
    if (!zone) return;
    const kind = zone === "edge" ? "resize" : zone === "dot" ? "link" : "move";
    const rr = rawOf(row.task);
    const sched = schedOf(rr.eff);
    const st = TLDrag.start({ kind, row, sched, pointer: pt, touch, t: nowMs(), px: lay.px });
    const s0 = TLCal.dn(sched.start);
    const geo = barGeom(row, box, cur.rowH);
    // x tanpa pangkas rentang (bar yang terpotong di awal rentang bergeser dari posisi sebenarnya)
    const xs = Number.isInteger(s0) ? TLLayout.xOf(s0, lay.range, lay.px) + (geo.ms ? lay.px / 2 - MS_SIZE / 2 : 0) : geo.x;
    const el = e.currentTarget && e.currentTarget.style ? e.currentTarget : null;
    X.g = { st, row, rr, box, geo, xs, el, painted: null, raf: 0, hold: 0, off: null, touch, pointerId: e.pointerId };
    listen(X.g);
    if (touch && !st.locked) X.g.hold = setTimeout(onHold, TLDrag.LONG_PRESS_MS);
  }

  function listen(g) {
    const w = win();
    if (!w) return;
    const move = (e) => onMove(e);
    const up = (e) => onUp(e);
    const cancel = () => { if (X.g) finish(TLDrag.reduce(X.g.st, { type: "cancel" })); };
    const key = (e) => {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      prevent(e);
      if (typeof e.stopPropagation === "function") e.stopPropagation(); // Esc tidak menutup modal/Live Edit host
      cancel();
    };
    // sentuh: setelah tekan lama, gerak jari menyeret bar (bukan menggulir); sebelum itu peramban bebas menggulir.
    const tmove = (e) => { if (X.g && (X.g.st.armed || X.g.st.phase === "drag") && e.cancelable) prevent(e); };
    const ctxm = (e) => prevent(e);
    w.addEventListener("pointermove", move);
    w.addEventListener("pointerup", up);
    w.addEventListener("pointercancel", cancel);
    w.addEventListener("keydown", key, true);
    w.addEventListener("blur", cancel);
    if (g.touch) {
      w.addEventListener("touchmove", tmove, { passive: false });
      w.addEventListener("contextmenu", ctxm);
    }
    g.off = () => {
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerup", up);
      w.removeEventListener("pointercancel", cancel);
      w.removeEventListener("keydown", key, true);
      w.removeEventListener("blur", cancel);
      if (g.touch) {
        w.removeEventListener("touchmove", tmove, false);
        w.removeEventListener("contextmenu", ctxm);
      }
    };
  }

  function onHold() {
    const g = X.g;
    if (!g) return;
    g.hold = 0;
    const zone = TLDrag.hitZone({ x: g.st.x0, barLeft: g.box.x, barWidth: g.box.milestone ? 0 : g.box.w, touch: true, armed: true });
    g.st = TLDrag.reduce(g.st, { type: "hold", t: Math.max(nowMs(), g.st.t0 + TLDrag.LONG_PRESS_MS), kind: zone === "edge" ? "resize" : undefined });
  }

  function onMove(e) {
    const g = X.g;
    if (!g || !samePointer(g, e)) return;
    const pt = chartPt(e);
    if (!pt) return;
    let st = TLDrag.reduce(g.st, { type: "move", x: pt.x, y: pt.y, t: nowMs() });
    if (st.kind === "link" && st.phase === "drag") st = TLDrag.reduce(st, { type: "over", rowKey: rowKeyAt(pt.y) });
    g.st = st;
    if (st.phase === "scroll" || st.phase === "cancelled") {
      finish(st);
      return;
    }
    if (st.phase !== "drag") return;
    if (e.cancelable !== false) prevent(e);
    if (!g.raf) g.raf = raf(() => { g.raf = 0; paint(g); });
  }

  function onUp(e) {
    const g = X.g;
    if (!g || !samePointer(g, e)) return;
    const pt = chartPt(e);
    let st = g.st;
    if (pt && st.kind === "link" && st.phase === "drag") st = TLDrag.reduce(st, { type: "over", rowKey: rowKeyAt(pt.y) });
    st = TLDrag.reduce(st, { type: "up", x: pt ? pt.x : undefined, inside: insideChart(e), t: nowMs() });
    finish(st);
  }

  function paint(g) {
    if (X.g !== g) return;
    const st = g.st;
    if (st.kind === "link") {
      const svg = X.rubberRef.current;
      const ln = X.lineRef.current;
      if (svg && svg.style) svg.style.display = "";
      if (ln && typeof ln.setAttribute === "function") {
        ln.setAttribute("x1", st.x0);
        ln.setAttribute("y1", st.y0);
        ln.setAttribute("x2", st.x);
        ln.setAttribute("y2", st.y);
      }
      return;
    }
    const lay = X.cur.lay;
    const pv = TLDrag.preview(st, lay.cal, lay.range, st.px);
    if (!pv) return;
    const geo = g.geo;
    const x = st.kind === "move" ? g.xs + pv.dx : geo.x;
    const w = geo.ms ? geo.w : Math.max(1, st.kind === "move" ? pv.width : pv.width - (geo.x - g.xs));
    if (g.el) {
      g.el.style.transform = translate(x, geo.top);
      g.painted = g.el.style.transform; // dibaca ulang: peramban menormalkan nilai ("translate(1px, 2px)")
      if (!geo.ms) g.el.style.width = w + "px";
      if (g.el.classList) g.el.classList.add("is-dragging");
    }
    const tip = X.tipRef.current;
    if (tip && tip.style) {
      tip.textContent = pv.tooltip;
      tip.style.display = "";
      tip.style.transform = translate(x, geo.top >= 26 ? geo.top - 24 : geo.top + geo.h + 6);
    }
  }

  // Kembalikan bar ke posisi props — hanya bila React belum menimpanya dengan nilai baru.
  function restore(g) {
    const el = g.el;
    if (!el || g.painted === null || el.style.transform !== g.painted) return;
    el.style.transform = translate(g.geo.x, g.geo.top);
    if (!g.geo.ms) el.style.width = g.geo.w + "px";
  }

  function hideOverlay() {
    const tip = X.tipRef.current;
    if (tip && tip.style) tip.style.display = "none";
    const svg = X.rubberRef.current;
    if (svg && svg.style) svg.style.display = "none";
  }

  function finish(st) {
    const g = X.g;
    if (!g) return;
    X.g = null;
    g.st = st;
    if (g.off) g.off();
    if (g.hold) clearTimeout(g.hold);
    caf(g.raf);
    hideOverlay();
    if (g.el && g.el.classList) g.el.classList.remove("is-dragging");
    if (!(st.phase === "released" && st.click)) suppressClick();
    const res = TLDrag.commit(st, X.cur.lay.cal); // satu-satunya sumber patch: tepat satu tulis per lepas
    if (!res || res.link) {
      restore(g);
      if (res) link(res.link);
      return;
    }
    write(g.row.task, g.rr, res.patch, res.prev).then((ok) => { if (!ok) restore(g); });
  }

  // Dependensi baru (R15): kunci baris → task lewat indeks halaman; ringkasan/di luar rentang ditolak; canLink untuk
  // diri sendiri/sudah ada/maks/siklus. Dependensi lama ditulis ulang apa adanya (termasuk item yang tidak dikenali
  // versi ini), item baru lewat sanitizePatch dengan ref api.taskExt.ref(pred).
  function link(l) {
    const { api, lay } = X.cur;
    const scope = lay.rows.filter((r) => r.task).map((r) => r.task);
    const idx = TLSched.buildIndex(scope);
    const pred = idx.get(String(l.pred));
    const succ = idx.get(String(l.succ));
    if (!pred || !succ) return;
    const succRow = lay.rows.find((r) => r.task === succ);
    if (!succRow) return;
    if (succRow.kind === "summary") {
      toastSafe(api, MSG_SUMMARY_DEP, "error");
      return;
    }
    if (succRow.outOfRange || X.busy.has(keyOf(succ))) return;
    const rr = rawOf(succ);
    const old = Array.isArray(rr.eff.deps) ? rr.eff.deps : [];
    const chk = TLSched.canLink({ pred, succ, scopeTasks: scope, edges: lay.edges, depCount: old.length });
    if (!chk.ok) {
      if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
      return;
    }
    let ref;
    try {
      ref = api.taskExt.ref(pred);
    } catch (e) {
      logWarn(api, "ref dependensi gagal:", e);
      return;
    }
    const san = TLSched.sanitizePatch({ deps: [{ t: ref, type: "FS", lag: 0 }] });
    if (!san.ok) return;
    const prev = { deps: rr.eff.deps === undefined ? null : rr.eff.deps };
    write(succ, rr, { deps: old.concat(san.patch.deps) }, prev);
  }

  // ---- klik-jadwalkan (R21): klik (mouse) / ketuk ganda (sentuh) di area kosong baris tanpa jadwal ----
  function slotDown(row, e) {
    if (!e || X.g || X.slot || !row || !row.task || !isPrimary(e)) return;
    const pt = chartPt(e);
    const w = win();
    if (!pt || !w) return;
    const s = { row, pt, x: Number(e.clientX), y: Number(e.clientY), touch: e.pointerType === "touch", pointerId: e.pointerId, off: null };
    const up = (ev) => slotUp(s, ev);
    const cancel = () => slotEnd(s);
    w.addEventListener("pointerup", up);
    w.addEventListener("pointercancel", cancel);
    s.off = () => {
      w.removeEventListener("pointerup", up);
      w.removeEventListener("pointercancel", cancel);
    };
    X.slot = s;
  }

  function slotEnd(s) {
    if (X.slot !== s) return;
    X.slot = null;
    if (s.off) s.off();
  }

  function slotUp(s, ev) {
    if (X.slot !== s || !samePointer(s, ev)) return;
    slotEnd(s);
    const slop = s.touch ? TLDrag.TOUCH_SLOP_PX : TLDrag.THRESHOLD_PX;
    if (Math.hypot(Number(ev.clientX) - s.x, Number(ev.clientY) - s.y) >= slop || !insideChart(ev)) {
      X.tap = null;
      return;
    }
    if (s.touch) {
      const t = nowMs();
      const last = X.tap;
      X.tap = { key: s.row.key, t, x: s.x, y: s.y };
      if (!last || last.key !== s.row.key || t - last.t > DOUBLE_TAP_MS || Math.hypot(s.x - last.x, s.y - last.y) > DOUBLE_TAP_PX) return;
      X.tap = null;
    }
    const { lay } = X.cur;
    const dn = TLLayout.dnAt(s.pt.x, lay.range, lay.px);
    if (dn < lay.range.from || dn > lay.range.to || X.busy.has(keyOf(s.row.task))) return;
    const rr = rawOf(s.row.task);
    const r = TLDrag.scheduleAt(lay.cal, dn, schedOf(rr.eff));
    if (r) write(s.row.task, rr, r.patch, r.prev);
  }

  // ---- keyboard (R23): Enter buka; Alt+←/→ geser 1 hk; Alt+Shift+←/→ durasi ±1; satu set per tekan ----
  function key(row, e) {
    if (!e) return;
    if (e.key === "Enter") {
      prevent(e);
      openTask(row);
      return;
    }
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    prevent(e); // Alt+← = "kembali" di peramban
    if (!row || !row.task || row.kind !== "task" || X.g) return;
    if (X.busy.has(keyOf(row.task))) return; // tombol ditahan: abaikan selama tulis sebelumnya belum selesai
    const rr = rawOf(row.task);
    const r = TLDrag.keyStep({ key: e.key, alt: true, shift: !!e.shiftKey }, schedOf(rr.eff), X.cur.lay.cal);
    if (r) write(row.task, rr, r.patch, r.prev);
  }

  function open(row) {
    if (X.suppress) {
      X.suppress = false;
      return;
    }
    openTask(row);
  }

  function dispose() {
    if (X.g) finish(TLDrag.reduce(X.g.st, { type: "cancel" }));
    if (X.slot) slotEnd(X.slot);
    X.tap = null;
  }

  X.ix = {
    open, key, barDown, slotDown,
    chartRef: X.chartRef, tipRef: X.tipRef, rubberRef: X.rubberRef, lineRef: X.lineRef,
  };
  X.dispose = dispose;
  return X;
}

// 4e. View Gantt (slot taskList.views, id "gantt").
// Interaksi (Task 8) = objek `ix` dari createInteractions (open/key/barDown/slotDown + ref grafik/tooltip/garis karet).
function TimelineViewBody(props) {
  const context = props.context || {};
  const api = props.api;
  const page = context.page || "";
  const narrow = useMedia(MQ_NARROW);
  const touch = useMedia(MQ_COARSE);
  const [zoom, setZoomPref] = usePref(api, "zoom", page);
  const [sort, setSort] = usePref(api, "sort", page);
  const [cols, setCols] = usePref(api, "cols", page);
  const [mode, setMode] = usePref(api, "mode", page);
  const [calOpen, setCalOpen] = React.useState(false);
  const pageKind = context.pageKind === "workspace" ? "workspace" : "project";
  const target = React.useMemo(() => calTarget(pageKind === "workspace" ? context.listId : null), [pageKind, context.listId]);
  const cal = useCalendar(api, target);
  const today = safeToday(api);
  const todayDn = today ? TLCal.dn(today) : null;
  const calKey = React.useMemo(() => JSON.stringify(cal.data), [cal.data]);

  // R24: tata letak hanya bila task scope / kalender / zoom / urut / hari berubah (bukan tiap context baru).
  const lay = React.useMemo(() => engine.layout({
    tasks: Array.isArray(context.scopeTasks) ? context.scopeTasks : [],
    pageKind, sort, cal: cal.data, today, zoom,
    readSchedOf: (t) => {
      try {
        return TLSched.readSched(api.taskExt.read(t));
      } catch (e) {
        return TLSched.readSched({});
      }
    },
  }), [context.scopeTasks, calKey, zoom, sort, today, pageKind, api]);
  const groupNames = React.useMemo(() => new Map(lay.groups.map((g) => [g.key, g.name])), [lay]);

  const compact = narrow || !!context.liveEdit;
  const colDefs = !compact || cols ? COLS_FULL : COLS_COMPACT;
  let tableW = 0;
  for (const c of colDefs) tableW += c.w;
  const rowH = touch ? TLLayout.ROW_H_TOUCH : TLLayout.ROW_H;
  const hasRows = lay.stats.tasks > 0;
  const listMode = narrow && mode === "list";

  // Jendela tampak (R11): top/left hanya diperbarui saat baris pertama / jangkar kolom (½ layar) berubah.
  const [vp, setVp] = React.useState({ top: 0, left: null, w: VIEW_W0, h: VIEW_H0, boxH: VIEW_H0 + HEAD_H });
  const scrollRef = React.useRef(null);
  const footRef = React.useRef(null);
  const rafRef = React.useRef(0);
  const prevLayRef = React.useRef(null);
  const anchorRef = React.useRef(null); // dn yang dipertahankan di tengah setelah zoom
  const userScrolledRef = React.useRef(false);
  const setLeftRef = React.useRef(null);
  const lastElRef = React.useRef(null); // elemen wadah terakhir yang dikenal (deteksi pasang ulang)
  const rowHRef = React.useRef(rowH);
  rowHRef.current = rowH;

  const sl = vp.left === null ? TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w) : vp.left;
  const rw = TLLayout.windowRows(lay.rows.length, vp.top, vp.h, rowH);
  const dw = TLLayout.windowDays(lay.range, lay.px, sl, vp.w);
  const chartW = TLLayout.widthOf(lay.range, lay.px);
  const rowsH = lay.rows.length * rowH;
  const bodyH = Math.max(rowsH, vp.h); // latar (akhir pekan, libur, hari ini) mengisi wadah walau baris sedikit

  const applyLeft = (el, x) => {
    el.scrollLeft = Math.max(0, Math.round(x));
    setLeftRef.current = el.scrollLeft;
    const left = el.scrollLeft;
    setVp((p) => (p.left === quantLeft(left, p.w) ? p : Object.assign({}, p, { left: quantLeft(left, p.w) })));
  };

  // Ukur tinggi wadah (R11: max(360, innerHeight − rect.top − 16), dikurangi tinggi legenda di bawahnya agar legenda
  // tetap terlihat) dan lebar grafik tampak. Selalu membaca elemen terkini (bukan yang ditangkap saat efek dipasang).
  const measure = () => {
    const el = scrollRef.current;
    if (!el || !hasWindow()) return;
    const rect = el.getBoundingClientRect();
    const footH = footRef.current ? footRef.current.offsetHeight || 0 : 0;
    const boxH = Math.max(MIN_BOX_H, Math.floor((window.innerHeight || 0) - rect.top - BOX_GAP - footH));
    const w = Math.max(0, el.clientWidth - tableW);
    setVp((p) => (p.boxH === boxH && p.w === w ? p : Object.assign({}, p, { boxH, h: Math.max(0, boxH - HEAD_H), w })));
  };

  // Wadah gulir baru (pertama kali, atau dipasang ulang setelah keadaan kosong / Daftar → Gantt): elemen baru mulai di
  // scrollTop/Left 0 tanpa event scroll, jadi jendela lama (top/left) dibuang dan logika "pertama dibuka" berlaku lagi
  // (hari ini di 1/3). Tanpa deps: berjalan tiap commit, murah (satu perbandingan).
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === lastElRef.current) return;
    lastElRef.current = el;
    if (!el) return;
    userScrolledRef.current = false;
    anchorRef.current = null;
    prevLayRef.current = lay;
    measure();
    el.scrollLeft = Math.max(0, Math.round(TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w)));
    setLeftRef.current = el.scrollLeft;
    const top = el.scrollTop || 0;
    const left = el.scrollLeft;
    setVp((p) => {
      const ql = quantLeft(left, p.w);
      return p.top === top && p.left === ql ? p : Object.assign({}, p, { top, left: ql });
    });
  });

  React.useLayoutEffect(() => {
    if (!scrollRef.current || !hasWindow()) return undefined;
    measure();
    let id = 0;
    const onResize = () => {
      if (id) return;
      id = raf(() => { id = 0; measure(); });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      caf(id);
    };
  }, [tableW, hasRows, listMode]);

  // Posisi gulir horizontal (R22): pertama kali / belum digulir pengguna → hari ini di 1/3; zoom atau rentang bergeser →
  // tanggal di tengah layar dipertahankan.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevLayRef.current;
    prevLayRef.current = lay;
    if (!el) return;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (anchor !== null) applyLeft(el, TLLayout.xOf(anchor, lay.range, lay.px) + lay.px / 2 - vp.w / 2);
    else if (!userScrolledRef.current) applyLeft(el, TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w));
    else if (prev && (prev.px !== lay.px || prev.range.from !== lay.range.from)) {
      const center = TLLayout.dnAt(el.scrollLeft + vp.w / 2, prev.range, prev.px);
      applyLeft(el, TLLayout.xOf(center, lay.range, lay.px) + lay.px / 2 - vp.w / 2);
    }
  }, [lay, vp.w, hasRows, listMode]);

  React.useEffect(() => () => caf(rafRef.current), []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (setLeftRef.current === null || Math.abs(el.scrollLeft - setLeftRef.current) > 1) userScrolledRef.current = true;
    if (rafRef.current) return;
    rafRef.current = raf(() => {
      rafRef.current = 0;
      const e2 = scrollRef.current;
      if (!e2) return;
      const top = e2.scrollTop;
      const left = e2.scrollLeft;
      const h = rowHRef.current;
      setVp((p) => {
        const ql = quantLeft(left, p.w);
        if (Math.floor(p.top / h) === Math.floor(top / h) && p.left === ql) return p;
        return Object.assign({}, p, { top, left: ql });
      });
    });
  };

  const pickZoom = (z) => {
    if (z === zoom) return;
    const el = scrollRef.current;
    if (el) anchorRef.current = TLLayout.dnAt(el.scrollLeft + vp.w / 2, lay.range, lay.px);
    setZoomPref(z);
  };
  const goToday = () => {
    const el = scrollRef.current;
    if (!el) return;
    userScrolledRef.current = false;
    applyLeft(el, TLLayout.initialScrollLeft(lay.range, lay.px, today, vp.w));
  };
  const isSel = (t) => {
    try {
      return typeof context.isSelected === "function" && !!context.isSelected(t);
    } catch (e) {
      return false;
    }
  };
  const ctlRef = React.useRef(null);
  if (!ctlRef.current) ctlRef.current = createInteractions();
  const ctl = ctlRef.current;
  ctl.cur = { api, context, lay, rowH, tableW, scrollEl: () => scrollRef.current };
  React.useEffect(() => () => ctl.dispose(), [ctl]);
  const ix = ctl.ix;

  const toolbar = renderToolbar({
    zoom, pickZoom, goToday, sort, setSort, compact, cols, setCols, narrow, mode, setMode,
    calOpen, toggleCal: () => setCalOpen(!calOpen),
  });
  const popover = calOpen ? CalendarPopover({ calId: target.id, scope: target.scope, pageKind, store: cal.store, onClose: () => setCalOpen(false) }) : null;

  if (!hasRows) {
    return (
      <div className="plg-timeline">
        {toolbar}
        {popover}
        <div className="plg-timeline-empty">{MSG_EMPTY}</div>
      </div>
    );
  }
  if (listMode) {
    return (
      <div className="plg-timeline">
        {toolbar}
        {popover}
        {ListFallback({ rows: lay.rows, cal: lay.cal, onTaskClick: context.onTaskClick })}
      </div>
    );
  }
  const v = { lay, rw, dw, rowH, colDefs, tableW, chartW, bodyH, todayDn, groupNames, ix, isSel };
  return (
    <div className={cx("plg-timeline", compact && "is-compact")}>
      {toolbar}
      {popover}
      <div className="plg-timeline-scroll" ref={scrollRef} onScroll={onScroll} role="grid" aria-label="Timeline" aria-rowcount={lay.rows.length + 1}
        style={{ height: vp.boxH }}>
        {renderHead(v)}
        <div className="plg-timeline-body" style={{ height: bodyH }}>
          <div className="plg-timeline-table" style={{ width: tableW, height: bodyH }}>
            {renderTableRows(v)}
          </div>
          {renderChart(v)}
        </div>
      </div>
      {renderLegend(lay, footRef)}
    </div>
  );
}

function ScheduleSection(props) {
  return null;
}

// React.memo dibuat malas (React tidak ada saat plugin.js di-require di tes Node). Slot menuntut komponen berupa
// fungsi, jadi pembungkus tipis merender versi memo; context host stabil sehingga memo menahan render ulang Pomodoro.
let MemoView = null;
function memoView() {
  if (!MemoView) MemoView = React.memo ? React.memo(TimelineViewBody) : TimelineViewBody;
  return MemoView;
}

function TimelineView(props) {
  return React.createElement(memoView(), props);
}

// ── 5. Ekspor Node + registrasi ─────────────────────────────────────────────
const pure = {
  calendarStore, calTarget, prefKey, cleanPref, PREF_DEFAULTS, PREF_CHOICES,
  CAL_ENTITY, CAL_MAX_BYTES, MSG_CAL_TOO_LARGE, MSG_CAL_LOST,
  MSG_EMPTY, MSG_VIOLATION, MSG_SCHEDULE_HINT, LEGEND, ZOOMS, COLS_FULL, COLS_COMPACT,
  engine, rowCells, pomoText, missingYearsNote, barGeom, createInteractions,
  MSG_CHANGED, MSG_UNDO, MSG_SAVE_FAIL, MSG_CYCLE, MSG_MAX_DEPS, MSG_SUMMARY_DEP,
  TimelineViewBody, ScheduleSection, CalendarPopover, ListFallback,
};
if (typeof module !== "undefined" && module.exports) module.exports = Object.assign({}, { TLHolidays, TLCal, TLSched, TLLayout, TLDrag }, pure);

const host = typeof window !== "undefined" ? window : null;
if (host && host.TF && host.TF.plugins) {
  host.TF.plugins.register(manifest, function factory(api) {
    return {
      slots: {
        "taskList.views": [{ id: "gantt", component: TimelineView }],
        "taskDetail.sections": [{ id: "schedule", order: 10, component: ScheduleSection }],
      },
    };
  });
}
