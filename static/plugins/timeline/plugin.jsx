// Plugin Timeline (Fase 1, PR 1b; spec docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md §8).
// Gantt Manual untuk project dan workspace: view `gantt` (slot taskList.views) dan seksi `schedule` (slot
// taskDetail.sections). Mesin murni ada di `parts` (holidays-id.js, calendar.js, schedule.js, layout.js, drag.js —
// compile.js menggabungkannya SEBELUM kode ini, jadi TLHolidays/TLCal/TLSched/TLLayout/TLDrag tersedia sebagai
// const di lingkup yang sama; tidak ada global window). `manifest` disuntik compile.js dari manifest.json.
//
// Susunan modul (Task 6 = kerangka; komponen diisi Task 7–10):
//   1. Konstanta + pesan UI persis (kalender, preferensi).
//   2. calendarStore(api)  — SATU-SATUNYA kode yang menyentuh api.records (R5). calTarget (= TLSched.calTarget) memilih id/scope.
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

// ── 2. Kalender (R4, R5) ────────────────────────────────────────────────────
// Task dengan list_id memakai kalender workspace `cal@list:<id>` (scope "list:<id>", dibagi semua anggota);
// tanpa list_id kalender pribadi `cal@user` (scope "user"). Satu pembantu untuk semua: TLSched.calTarget.
const calTarget = TLSched.calTarget;

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
// Kalender kerja (R18) dan Daftar HP (R20): teks persis.
const MSG_CAL_NOTE = "Dipakai semua anggota workspace";
const MSG_PENDING = "Menunggu sinkron";
const MSG_CAL_SAVE_FAIL = "Kalender gagal disimpan";
const MSG_CAL_LOAD_FAIL = "Kalender gagal dimuat";
const MSG_DATE_NEED = "Pilih tanggal dulu";
const MSG_DATE_DUP = "Tanggal ini sudah ada";
const MSG_LIST_FULL = "Daftar sudah penuh (366 tanggal)";
const MSG_NO_NAME = "(tanpa nama)";
const MSG_UNSCHEDULED = "Belum dijadwalkan";
const MSG_LATE = "Lewat tenggat";
const CAL_MAX_NAME = 60; // sama dengan TLCal.normalize
const CAL_MAX_ENTRIES = 366;
const DAYS = [["Sen", "Senin"], ["Sel", "Selasa"], ["Rab", "Rabu"], ["Kam", "Kamis"], ["Jum", "Jumat"], ["Sab", "Sabtu"], ["Min", "Minggu"]];
const MSG_VIOLATION = "Mulai sebelum dependensi selesai";
const MSG_SCHEDULE_HINT = "Klik untuk menjadwalkan";
// Interaksi (R13–R15, R21): teks persis.
const MSG_CHANGED = "Jadwal diubah";
const MSG_UNDO = "Urungkan";
const MSG_SAVE_FAIL = "Jadwal gagal disimpan";
const MSG_CYCLE = "Dependensi ini membuat lingkaran";
const MSG_MAX_DEPS = "Maksimal 20 dependensi per task";
const MSG_SUMMARY_DEP = "Ringkasan tidak bisa diberi dependensi di versi ini";
const MSG_DUP_DEP = "Dependensi ini sudah ada";
// Seret/Alt+panah/klik-jadwalkan pada task yang ternyata induk (anaknya tersembunyi filter panel) → teks seksi yang sama.
const MSG_SUMMARY_SCHED = "Jadwal task ini mengikuti subtask-nya";
// Alasan penolakan TLSched.canLink → toast. self/scope tidak bertoast: diri sendiri tidak ada yang perlu ditulis,
// scope tidak bisa terjadi di view (kedua ujung adalah baris halaman ini).
const LINK_MSG = { cycle: MSG_CYCLE, max: MSG_MAX_DEPS, summary: MSG_SUMMARY_DEP, dup: MSG_DUP_DEP };
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

// Jendela baris diperbarui per kuantum ROW_STEP baris (Task 13, perf), bukan tiap baris: tiap pergeseran jendela
// melepas/menyisipkan anak di awal daftar saudara, dan aturan posisi host (mis. `:nth-child` universal di app.css)
// membuat Chromium menghitung ulang gaya semua saudara. Kuantum 8 → ~8× lebih sedikit rekalkulasi saat gulir vertikal;
// jendela diperlebar ROW_STEP baris ke bawah agar tetap menutup layar.
const ROW_STEP = 8;

function quantTop(top, rowH) {
  const q = Math.max(1, rowH * ROW_STEP);
  return Math.floor(Math.max(0, top) / q) * q;
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
// edit lokal yang kalah LWW → toast persis (spec §8.9). `quiet` (seksi Jadwal): tanpa toast — view yang memberi tahu,
// agar view + panel Live Edit yang tampil bersamaan tidak menampilkan toast ganda.
function useCalendar(api, target, quiet) {
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
        if (lost && !quiet) {
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
  // Daftar (HP): zoom, "Hari ini", urut, dan kolom hanya berarti untuk Gantt → disembunyikan.
  const gantt = !v.listMode;
  return (
    <div className="plg-timeline-toolbar">
      {gantt ? seg(ZOOMS, v.zoom, v.pickZoom, LBL.zoom) : null}
      {gantt ? <button type="button" className="plg-timeline-btn" onClick={v.goToday}>{LBL.today}</button> : null}
      <button type="button" ref={v.calBtnRef} className={cx("plg-timeline-btn", "plg-timeline-calbtn", v.calOpen && "is-active")} aria-expanded={v.calOpen} aria-haspopup="dialog" onClick={v.toggleCal}>{LBL.calendar}</button>
      {gantt ? <button type="button" className={cx("plg-timeline-btn", v.sort === "start" && "is-active")} aria-pressed={v.sort === "start"} onClick={() => v.setSort(v.sort === "start" ? "wbs" : "start")}>{LBL.sort}</button> : null}
      {gantt && v.compact ? <button type="button" className={cx("plg-timeline-btn", v.cols && "is-active")} aria-pressed={v.cols} onClick={() => v.setCols(!v.cols)}>{LBL.cols}</button> : null}
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
// Path memakai koordinat grafik absolut di dalam <g transform> (Task 13): saat jendela bergeser hanya transform <g> dan
// posisi svg berubah, `d` panah yang tetap tampak tidak ditulis ulang (tiap `d` baru = rekalkulasi gaya per path).
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
    return { x, y: idx * rowH + (rowH - h) / 2, w, h };
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
      <g transform={"translate(" + -winX + " " + -oy + ")"}>{paths}</g>
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

// 4f. Kalender kerja (Task 9; R18, keputusan pemilik U1) dan Daftar HP (R20, U3).
// Nama libur/hari kerja pengganti: dipangkas, ≤ 60 unit (sama dengan TLCal.normalize, yang membuang entri lebih panjang);
// pasangan surrogat tidak dipotong di tengah.
function clipName(s) {
  let n = s === undefined || s === null ? "" : String(s).trim();
  if (n.length > CAL_MAX_NAME) {
    n = n.slice(0, CAL_MAX_NAME);
    const c = n.charCodeAt(n.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) n = n.slice(0, -1);
  }
  return n;
}

function dateLabel(d) {
  return TLCal.fmtShort(TLCal.dn(d)) + " " + String(d).slice(0, 4);
}

const FORM0 = Object.freeze({ d: "", n: "", err: "" });

// Popover kalender: tujuh sakelar hari, dua sakelar libur, dua daftar (libur tambahan, hari kerja pengganti).
// Tiap perubahan langsung disimpan lewat store.save (R5), berurutan (satu antrean), dan ditampilkan lebih dulu
// (optimis); bila gagal, keadaan dimuat ulang dari simpanan dan pesan galat tampil inline. Komponen berhook:
// dirender sebagai elemen, bukan dipanggil sebagai fungsi.
function CalendarPopover(props) {
  const { calId, scope, pageKind, store, onClose } = props;
  const [st, setSt] = React.useState({ data: null, pending: false });
  const [err, setErr] = React.useState("");
  const [form, setForm] = React.useState({ off: FORM0, work: FORM0 });
  const rootRef = React.useRef(null);
  const dataRef = React.useRef(null); // kalender terkini (termasuk perubahan yang belum selesai disimpan)
  const inflight = React.useRef(0);
  const chain = React.useRef(Promise.resolve());
  const alive = React.useRef(true);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  const show = (r) => {
    dataRef.current = r.data;
    setSt({ data: r.data, pending: r.pending });
  };

  React.useEffect(() => {
    alive.current = true;
    const load = () => store.load(calId).then((r) => {
      if (alive.current && inflight.current === 0) show(r);
    }, () => {
      if (alive.current) setErr(MSG_CAL_LOAD_FAIL);
    });
    load();
    let off = null;
    try {
      // Hanya perubahan dari perangkat lain (sinkron) / kalah LWW; peristiwa lokal berasal dari simpanan kita sendiri.
      off = store.subscribe((ev) => {
        if (inflight.current > 0) return;
        if (ev.lost.indexOf(calId) >= 0 || (ev.source === "sync" && ev.ids.indexOf(calId) >= 0)) load();
      });
    } catch (e) {
      off = null;
    }
    return () => {
      alive.current = false;
      if (typeof off === "function") off();
    };
  }, [store, calId]);

  const close = (restoreFocus) => {
    const f = closeRef.current;
    if (typeof f === "function") f({ restoreFocus });
  };

  // Fokus ke dialog saat dibuka; Esc menutup (fase tangkap + stopPropagation agar modal/Live Edit host di belakang tidak
  // ikut tertutup); tekan di luar menutup tanpa mencuri fokus. Tombol "Kalender kerja" menangani kliknya sendiri.
  React.useEffect(() => {
    const el = rootRef.current;
    if (el && typeof el.focus === "function") el.focus();
    if (!hasWindow()) return undefined;
    const onKey = (e) => {
      if (!e || e.key !== "Escape") return;
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      close(true);
    };
    const onDown = (e) => {
      const root = rootRef.current;
      const t = e && e.target;
      if (!root || !t) return;
      if (typeof root.contains === "function" && root.contains(t)) return;
      if (typeof t.closest === "function" && t.closest(".plg-timeline-calbtn")) return;
      close(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, []);

  // Terapkan perubahan murni `mut(kalender) → kalender` dan simpan. false = tidak ada yang berubah / terlalu besar.
  const change = (mut) => {
    const cur = dataRef.current;
    if (!cur) return false;
    const next = TLCal.normalize(mut(cur));
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    if (TLCal.byteSize(next) > CAL_MAX_BYTES) {
      setErr(MSG_CAL_TOO_LARGE);
      return false;
    }
    dataRef.current = next;
    setSt((s) => Object.assign({}, s, { data: next }));
    setErr("");
    inflight.current++;
    chain.current = chain.current
      .then(() => store.save(calId, scope, next))
      .then((r) => {
        inflight.current--;
        if (!alive.current) return;
        if (inflight.current === 0) show(r);
        else setSt((s) => Object.assign({}, s, { pending: r.pending }));
      }, (e) => {
        inflight.current--;
        if (alive.current) setErr(e && e.code === "TOO_LARGE" ? MSG_CAL_TOO_LARGE : MSG_CAL_SAVE_FAIL);
        return store.load(calId).then((r) => {
          if (alive.current && inflight.current === 0) show(r);
        }, () => {});
      })
      .catch(() => {});
    return true;
  };

  const toggleDay = (n) => change((c) => {
    const set = new Set(c.weekdays);
    if (set.has(n)) {
      if (set.size <= 1) return c; // sedikitnya satu hari kerja (normalize akan memulihkan bawaan Sen–Jum, bukan yang dimaksud)
      set.delete(n);
    } else set.add(n);
    return Object.assign({}, c, { weekdays: Array.from(set).sort((a, b) => a - b) });
  });
  const addEntry = (kind, e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const cur = dataRef.current;
    if (!cur) return;
    const f = form[kind];
    const fail = (m) => setForm((s) => Object.assign({}, s, { [kind]: Object.assign({}, s[kind], { err: m }) }));
    if (!TLCal.isIso(f.d)) return fail(MSG_DATE_NEED);
    if (cur.off.some((x) => x.d === f.d) || cur.work.some((x) => x.d === f.d)) return fail(MSG_DATE_DUP);
    if (cur[kind].length >= CAL_MAX_ENTRIES) return fail(MSG_LIST_FULL);
    const entry = { d: f.d, n: clipName(f.n) };
    if (change((c) => Object.assign({}, c, { [kind]: c[kind].concat([entry]) }))) setForm((s) => Object.assign({}, s, { [kind]: FORM0 }));
  };
  const removeEntry = (kind, d) => change((c) => Object.assign({}, c, { [kind]: c[kind].filter((x) => x.d !== d) }));
  const edit = (kind, field, value) => setForm((s) => Object.assign({}, s, { [kind]: Object.assign({}, s[kind], { [field]: value, err: "" }) }));

  const cal = st.data;
  const loading = cal === null;
  const list = (kind, title, addLabel, delLabel) => (
    <section className="plg-timeline-pop-sec" aria-label={title}>
      <h4 className="plg-timeline-pop-sub">{title}</h4>
      {cal && cal[kind].length ? (
        <ul className="plg-timeline-pop-list">
          {cal[kind].map((e) => (
            <li key={e.d} className="plg-timeline-pop-item">
              <span className="plg-timeline-pop-date">{dateLabel(e.d)}</span>
              <span className={cx("plg-timeline-pop-name", !e.n && "is-empty")}>{e.n || MSG_NO_NAME}</span>
              <button type="button" className="plg-timeline-pop-del" aria-label={"Hapus " + dateLabel(e.d)} title={delLabel} onClick={() => removeEntry(kind, e.d)}>×</button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="plg-timeline-pop-form" aria-label={addLabel} onSubmit={(e) => addEntry(kind, e)}>
        <input type="date" className="plg-timeline-pop-input" aria-label={"Tanggal " + title.toLowerCase()} value={form[kind].d} disabled={loading}
          onChange={(e) => edit(kind, "d", e.target.value)} />
        <input type="text" className="plg-timeline-pop-input" aria-label={"Nama " + title.toLowerCase()} placeholder="Nama" maxLength={CAL_MAX_NAME} value={form[kind].n} disabled={loading}
          onChange={(e) => edit(kind, "n", e.target.value)} />
        <button type="submit" className="plg-timeline-btn" disabled={loading}>Tambah</button>
      </form>
      {form[kind].err ? <div className="plg-timeline-pop-err" role="alert">{form[kind].err}</div> : null}
    </section>
  );

  return (
    <div className="plg-timeline-pop" role="dialog" aria-label={LBL.calendar} aria-busy={loading} tabIndex={-1} ref={rootRef}>
      <div className="plg-timeline-pop-head">
        <h3 className="plg-timeline-pop-title">{LBL.calendar}</h3>
        {st.pending ? <span className="plg-timeline-pop-pending" role="status">{MSG_PENDING}</span> : null}
        <button type="button" className="plg-timeline-pop-close" aria-label="Tutup" onClick={() => close(true)}>×</button>
      </div>
      {pageKind === "workspace" ? <p className="plg-timeline-pop-note">{MSG_CAL_NOTE}</p> : null}
      <div className="plg-timeline-pop-days" role="group" aria-label="Hari kerja">
        {DAYS.map(([short, long], i) => {
          const on = !!cal && cal.weekdays.indexOf(i + 1) >= 0;
          return (
            <button key={short} type="button" className={cx("plg-timeline-pop-day", on && "is-on")} aria-pressed={on} aria-label={long}
              disabled={loading || (on && cal.weekdays.length <= 1)} onClick={() => toggleDay(i + 1)}>{short}</button>
          );
        })}
      </div>
      <label className="plg-timeline-pop-check">
        <input type="checkbox" checked={!!cal && cal.national} disabled={loading} onChange={(e) => change((c) => Object.assign({}, c, { national: !!e.target.checked }))} />
        <span>Ikuti libur nasional</span>
      </label>
      <label className="plg-timeline-pop-check">
        <input type="checkbox" checked={!!cal && cal.cutiBersama} disabled={loading} onChange={(e) => change((c) => Object.assign({}, c, { cutiBersama: !!e.target.checked }))} />
        <span>Ikuti cuti bersama</span>
      </label>
      {list("off", "Libur tambahan", "Tambah libur tambahan", "Hapus libur tambahan")}
      {list("work", "Hari kerja pengganti", "Tambah hari kerja pengganti", "Hapus hari kerja pengganti")}
      {err ? <div className="plg-timeline-pop-err" role="alert">{err}</div> : null}
    </div>
  );
}

// Tampilan Daftar (HP, U3): task terjadwal urut Mulai dikelompokkan per minggu ISO, lalu "Belum dijadwalkan".
// Baris = tombol → onTaskClick(task). `cal` disediakan untuk kelengkapan antarmuka (tanggal sudah dihitung layout).
function weekText(mon, showYear) {
  const sun = mon + 6;
  const wk = TLCal.isoWeek(mon);
  const dm = (n) => {
    const p = TLCal.fmtShort(n).split(" ");
    return { d: p[1], m: p[2], y: TLCal.iso(n).slice(0, 4) };
  };
  const a = dm(mon);
  const b = dm(sun);
  let range;
  if (a.y !== b.y && showYear) range = a.d + " " + a.m + " " + a.y + "–" + b.d + " " + b.m + " " + b.y;
  else if (a.m !== b.m || a.y !== b.y) range = a.d + " " + a.m + "–" + b.d + " " + b.m + (showYear ? " " + b.y : "");
  else range = a.d + "–" + b.d + " " + a.m + (showYear ? " " + a.y : "");
  return "Mg " + wk.week + " · " + range;
}

function listMeta(r) {
  const s = TLCal.fmtShort(r.span.s);
  const f = TLCal.fmtShort(r.span.f);
  const hk = r.duration === null || r.duration === undefined ? "" : r.duration + " hk";
  if (r.kind === "task" && r.duration === 0) return { text: s + " · Milestone", aria: s + ", milestone" };
  const text = (r.span.s === r.span.f ? s : s + " → " + f) + (hk ? " · " + hk : "");
  const aria = (r.span.s === r.span.f ? s : s + " sampai " + f) + (hk ? ", " + r.duration + " hari kerja" : "");
  return { text, aria };
}

function ListFallback(props) {
  const rows = Array.isArray(props.rows) ? props.rows : [];
  const open = (r) => {
    if (typeof props.onTaskClick === "function") props.onTaskClick(r.task);
  };
  const sched = [];
  const unsched = [];
  for (const r of rows) {
    if (!r || r.kind === "group" || !r.task) continue;
    (r.span ? sched : unsched).push(r);
  }
  sched.sort((a, b) => a.span.s - b.span.s || a.index - b.index);
  const weeks = [];
  const byMon = new Map();
  for (const r of sched) {
    const mon = r.span.s - (TLCal.isoWeekday(r.span.s) - 1);
    let g = byMon.get(mon);
    if (!g) {
      g = { mon, rows: [] };
      byMon.set(mon, g);
      weeks.push(g);
    }
    g.rows.push(r);
  }
  const years = new Set();
  for (const g of weeks) {
    years.add(TLCal.iso(g.mon).slice(0, 4));
    years.add(TLCal.iso(g.mon + 6).slice(0, 4));
  }
  const showYear = years.size > 1;
  const item = (r) => {
    const title = rowCells(r, "").name;
    const meta = r.span ? listMeta(r) : null;
    const late = r.span && r.late > 0;
    const aria = title + (meta ? ", " + meta.aria : ", belum dijadwalkan") + (late ? ", lewat tenggat" : "");
    return (
      <li key={r.key} className="plg-timeline-li-item">
        <button type="button" className={cx("plg-timeline-li", r.kind === "summary" && "is-summary", r.done && "is-done")} aria-label={aria} onClick={() => open(r)}>
          <span className="plg-timeline-li-title">{title}</span>
          {meta ? <span className="plg-timeline-li-meta">{meta.text}</span> : null}
          {late ? <span className="plg-timeline-li-late" role="img" aria-label={MSG_LATE}>🏁</span> : null}
        </button>
      </li>
    );
  };
  const sec = (key, head, items) => (
    <section key={key} className="plg-timeline-li-sec" aria-label={head}>
      <h4 className="plg-timeline-li-head">{head}</h4>
      <ul className="plg-timeline-li-list">{items.map(item)}</ul>
    </section>
  );
  if (!weeks.length && !unsched.length) return <div className="plg-timeline-empty">{MSG_EMPTY}</div>;
  return (
    <div className="plg-timeline-list">
      {weeks.map((g) => sec("w" + g.mon, weekText(g.mon, showYear), g.rows))}
      {unsched.length ? sec("u", MSG_UNSCHEDULED, unsched) : null}
    </div>
  );
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
const BLOCKED = Object.freeze({ blocked: true }); // penolakan pemeriksaan sebelum tulis (bukan galat simpan)

function createInteractions() {
  const X = {
    cur: null,
    chartEl: null, // elemen grafik terpasang (callback ref; pendengar touchmove tetap)
    tipRef: { current: null },
    rubberRef: { current: null },
    lineRef: { current: null },
    g: null, // gestur seret aktif
    slot: null, // gestur klik-jadwalkan aktif
    tap: null, // ketukan sentuh terakhir pada area kosong (ketuk ganda)
    busy: new Set(), // String(task.id) dengan tulis yang sedang berjalan
    inflight: new Map(), // String(task.id) → promise tulis berjalan (selalu resolve) untuk antrean Urungkan
    after: new Map(), // String(task.id) → {stale: JSON props saat tulis, eff: nilai ext setelah tulis}
    suppress: false, // klik native setelah seret/batal tidak membuka task
  };
  const win = () => (hasWindow() && typeof window.addEventListener === "function" ? window : null);
  const keyOf = (task) => String(task.id);
  const samePointer = (g, e) => g.pointerId === undefined || e.pointerId === undefined || e.pointerId === g.pointerId;
  const isPrimary = (e) => e.button === undefined || e.button === 0;
  const prevent = (e) => { if (e && typeof e.preventDefault === "function") e.preventDefault(); };

  // Sentuh: peramban memutuskan gulir vs. tidak pada touchmove pertama yang bisa dibatalkan; pendengar yang baru dipasang
  // saat pointerdown sudah terlambat. Jadi SATU pendengar non-pasif tetap di elemen grafik selama elemen itu terpasang,
  // yang hanya memanggil preventDefault saat gestur sentuh sudah dipersenjatai (tekan lama) atau sedang menyeret.
  const onTouchMove = (e) => {
    const g = X.g;
    if (g && g.touch && (g.st.armed || g.st.phase === "drag") && e.cancelable !== false) prevent(e);
  };
  function setChart(el) {
    const old = X.chartEl;
    if (old === (el || null)) return;
    if (old && typeof old.removeEventListener === "function") old.removeEventListener("touchmove", onTouchMove, false);
    X.chartEl = el || null;
    if (el && typeof el.addEventListener === "function") el.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  // Titik pointer dalam koordinat grafik (x = 0 di awal rentang; ikut gulir karena rect grafik ikut bergeser).
  function chartPt(e) {
    const el = X.chartEl;
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
  // ext efektif tanpa efek samping (rawOf membuang catatan `after` yang basi; pemeriksaan task lain tidak boleh).
  function peekRaw(task) {
    let props;
    try {
      props = X.cur.api.taskExt.read(task);
    } catch (e) {
      props = null;
    }
    if (!props || typeof props !== "object") props = {};
    const a = X.after.get(keyOf(task));
    return a && a.stale === JSON.stringify(props) ? a.eff : props;
  }

  // Daftar task LENGKAP untuk validasi sebelum tulis: context.scopeTasks host sudah difilter panel (prioritas,
  // penanggung jawab, cari), jadi dependensi ke task tersembunyi dan anak yang tersembunyi tidak terlihat di layout.
  function fullList() {
    const api = X.cur.api;
    return Promise.resolve()
      .then(() => api.data.tasks.list({ includeDone: true }))
      .then((l) => (Array.isArray(l) ? l : []));
  }

  // Induk di daftar lengkap = ringkasan (R10): jadwalnya mengikuti subtask, tidak boleh digeser/diubah/dijadwalkan di 1b.
  // Resolve true = boleh tulis; false = ditolak (toast sudah tampil); reject = daftar gagal dimuat (tanpa tulis).
  function summaryGate(task) {
    const api = X.cur.api;
    return fullList().then((list) => {
      if (!isSummaryIn(list, task)) return true;
      toastSafe(api, MSG_SUMMARY_SCHED, "error");
      return false;
    });
  }

  // Satu tulis (set, atau setMany untuk Urungkan). Penolakan diteruskan ke pemanggil. `gate` (opsional) = promise
  // pemeriksaan sebelum tulis: false → reject BLOCKED tanpa memanggil api. busy/after diisi SEKETIKA (tombol yang
  // ditahan dan seret berikutnya tidak menulis dari props basi selama pemeriksaan berjalan).
  function issue(task, rr, patch, many, gate) {
    const k = keyOf(task);
    const api = X.cur.api;
    X.busy.add(k);
    X.after.set(k, { stale: rr.pj, eff: Object.assign({}, rr.eff, patch) });
    const send = () => {
      try {
        return many ? api.taskExt.setMany([{ taskId: task.id, patch }]) : api.taskExt.set(task.id, patch);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const p = gate ? Promise.resolve(gate).then((ok) => {
      if (!ok) throw BLOCKED;
      return send();
    }) : send();
    const done = Promise.resolve(p).then(() => {
      X.busy.delete(k);
    }, (err) => {
      X.busy.delete(k);
      X.after.delete(k);
      throw err;
    });
    const settled = done.then(() => undefined, () => undefined);
    X.inflight.set(k, settled);
    settled.then(() => { if (X.inflight.get(k) === settled) X.inflight.delete(k); });
    return done;
  }

  function failed(api, err) {
    logWarn(api, "jadwal gagal disimpan:", err);
    toastSafe(api, MSG_SAVE_FAIL, "error");
  }

  // set → toast "Jadwal diubah" + Urungkan (setMany nilai lama persis). Resolve true/false (tidak pernah reject).
  // Sebelum tulis: induk tersembunyi (ringkasan di daftar lengkap) ditolak, kecuali `checked` (link sudah memeriksa).
  function write(task, rr, patch, prev, checked) {
    const api = X.cur.api;
    return issue(task, rr, patch, false, checked ? null : summaryGate(task)).then(() => {
      toastSafe(api, MSG_CHANGED, "success", { label: MSG_UNDO, onClick: () => undo(task, prev) });
      return true;
    }, (err) => {
      if (err !== BLOCKED) failed(api, err);
      return false;
    });
  }

  // onClick Urungkan: runtime hanya menangkap lemparan sinkron, jadi penolakan setMany ditangani di sini.
  // Tulis lain pada task yang sama masih berjalan → Urungkan antre sampai selesai (tulis tidak pernah tumpang tindih).
  function undo(task, prev) {
    const api = X.cur.api;
    const wait = X.busy.has(keyOf(task)) ? X.inflight.get(keyOf(task)) : null;
    if (wait) {
      wait.then(() => undo(task, prev));
      return;
    }
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
    // sentuh: touchmove dicegah oleh pendengar tetap di elemen grafik (setChart); di sini hanya menu konteks tekan lama.
    const ctxm = (e) => prevent(e);
    w.addEventListener("pointermove", move);
    w.addEventListener("pointerup", up);
    w.addEventListener("pointercancel", cancel);
    w.addEventListener("keydown", key, true);
    w.addEventListener("blur", cancel);
    if (g.touch) w.addEventListener("contextmenu", ctxm);
    g.off = () => {
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerup", up);
      w.removeEventListener("pointercancel", cancel);
      w.removeEventListener("keydown", key, true);
      w.removeEventListener("blur", cancel);
      if (g.touch) w.removeEventListener("contextmenu", ctxm);
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

  // Dependensi baru (R15): kunci baris → task lewat indeks halaman; ringkasan tampak/di luar rentang ditolak seketika.
  // Lalu checkLink (sama dengan seksi Jadwal) terhadap daftar task LENGKAP — layout dibangun dari scopeTasks yang sudah
  // difilter panel host, jadi edge ke task tersembunyi (siklus) dan anak tersembunyi (ringkasan) hanya terlihat di sana.
  // Selama pemeriksaan penerus ditandai sibuk (satu penautan per penerus). Dependensi lama ditulis ulang apa adanya.
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
    const k = keyOf(succ);
    if (succRow.outOfRange || X.busy.has(k)) return;
    X.busy.add(k);
    const run = fullList().then((list) => {
      X.busy.delete(k);
      const rr = rawOf(succ);
      const chk = checkLink(api, list, pred, succ, (t, isSucc) => (isSucc ? rr.eff : peekRaw(t)));
      if (!chk.ok) {
        if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
        return undefined;
      }
      const prev = { deps: rr.eff.deps === undefined ? null : rr.eff.deps };
      return write(succ, rr, { deps: chk.deps }, prev, true);
    }, (err) => {
      X.busy.delete(k);
      failed(api, err);
    });
    // Urungkan pada penerus yang sama menunggu pemeriksaan + tulis ini (antrean yang sama dengan issue)
    const settled = run.then(() => undefined, () => undefined);
    X.inflight.set(k, settled);
    settled.then(() => { if (X.inflight.get(k) === settled) X.inflight.delete(k); });
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

  // ---- keyboard (R23): Enter buka; Alt+←/→ geser 1 hk (milestone 1 hari kalender); Alt+Shift+←/→ durasi ±1; satu set per tekan ----
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
    if (!r) return;
    const from = e.currentTarget || null;
    write(row.task, rr, r.patch, r.prev).then(() => raf(() => refocus(row.key, from)));
  }

  // Render ulang setelah tulis bisa memasang ulang bar/baris (virtualisasi): fokus kembali ke elemen dengan data-key dan
  // role yang sama, hanya bila fokus hilang (elemen lama terlepas atau fokus jatuh ke body).
  function refocus(key, from) {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return;
    const active = doc.activeElement;
    const lost = !active || active === doc.body || (from && from.isConnected === false && active === from);
    if (!lost) return;
    const root = X.cur && X.cur.scrollEl();
    if (!root || typeof root.querySelectorAll !== "function") return;
    const role = from && typeof from.getAttribute === "function" ? from.getAttribute("role") : null;
    const list = root.querySelectorAll("[data-key]");
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.getAttribute("data-key") !== String(key) || (role && n.getAttribute("role") !== role)) continue;
      try {
        n.focus({ preventScroll: true });
      } catch (err) {
        /* elemen tidak bisa difokus */
      }
      return;
    }
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
    setChart(null);
  }

  X.ix = {
    open, key, barDown, slotDown,
    chartRef: setChart, tipRef: X.tipRef, rubberRef: X.rubberRef, lineRef: X.lineRef,
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
  const calBtnRef = React.useRef(null);
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
  const rw = TLLayout.windowRows(lay.rows.length, vp.top, vp.h + ROW_STEP * rowH, rowH);
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
    const top = quantTop(el.scrollTop || 0, rowH);
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
      const h = rowHRef.current;
      const top = quantTop(e2.scrollTop, h);
      const left = e2.scrollLeft;
      setVp((p) => {
        const ql = quantLeft(left, p.w);
        if (p.top === top && p.left === ql) return p;
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
    zoom, pickZoom, goToday, sort, setSort, compact, cols, setCols, narrow, mode, setMode, listMode,
    calOpen, toggleCal: () => setCalOpen(!calOpen), calBtnRef,
  });
  // Popover berhook → elemen (bukan panggilan fungsi). key = id kalender: pindah halaman memasang ulang. Esc / tombol tutup
  // mengembalikan fokus ke tombol "Kalender kerja"; klik di luar tidak (fokus sudah pindah ke target klik).
  const closeCal = (how) => {
    setCalOpen(false);
    const b = calBtnRef.current;
    if (how && how.restoreFocus && b && typeof b.focus === "function") b.focus();
  };
  const popover = calOpen
    ? <CalendarPopover key={target.id} calId={target.id} scope={target.scope} pageKind={pageKind} store={cal.store} onClose={closeCal} />
    : null;
  const top = <div className="plg-timeline-top">{toolbar}{popover}</div>;

  if (!hasRows) {
    return (
      <div className="plg-timeline">
        {top}
        <div className="plg-timeline-empty">{MSG_EMPTY}</div>
      </div>
    );
  }
  if (listMode) {
    return (
      <div className="plg-timeline">
        {top}
        {ListFallback({ rows: lay.rows, cal: lay.cal, onTaskClick: context.onTaskClick })}
      </div>
    );
  }
  const v = { lay, rw, dw, rowH, colDefs, tableW, chartW, bodyH, todayDn, groupNames, ix, isSel };
  return (
    <div className={cx("plg-timeline", compact && "is-compact")}>
      {top}
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

// 4g. Seksi "Jadwal" di detail task (Task 10; spec §8.8, Q5; R7, R8, R10, R15, R16, R17). Slot taskDetail.sections,
// context {task, variant: "modal"|"panel", collaborators, onOpenTask, showToast}; modal dan panel Live Edit sama.
// Plugin hanya menulis ext miliknya (start/duration/deps) — kolom host (progres, tenggat) dibaca saja (README §8.7).
const SEC_TITLE = "Jadwal";
const SEC_START = "Mulai";
const SEC_DUR = "Durasi";
const SEC_HK = "hari kerja";
const SEC_ADD_DEP = "Tambah dependensi";
const SEC_MORE = "Selengkapnya";
const SEC_LESS = "Sembunyikan";
const SEC_FINISH = "Selesai";
const SEC_MILESTONE = "Milestone";
const SEC_PCT = "% selesai";
const SEC_PCT_HINT = "Ubah lewat progres di atas";
const SEC_SHIFT = "Geser ke setelah dependensi";
const SEC_SUMMARY = "Jadwal task ini mengikuti subtask-nya";
const SEC_SUMMARY_NONE = "Belum ada subtask yang dijadwalkan";
const SEC_OUTSIDE = "(task di luar halaman ini)";
const SEC_DELETED = "(task sudah dihapus)";
const SEC_DEPS = "Dependensi";
const SEC_BAD_BTN = "Hapus dependensi rusak";
const SEC_SEARCH = "Cari task";
const SEC_LOADING = "Memuat…";
const SEC_NO_MATCH = "Tidak ada task yang cocok";
const SEC_IS_DEP = "sudah ada";
const SEC_CLOSE = "Tutup";
const SEC_YEAR_MIN = 1970; // tahun parsial saat mengetik di input tanggal (0002-…, 0020-…) tidak disimpan
const SEC_YEAR_MAX = 2199;
const PICK_MAX = 50; // R17: ≤ 50 hasil pemilih
const SEC_REFRESH_MS = 2000; // muat ulang daftar task saat seksi difokus/disentuh, paling sering tiap 2 s
// Waktu yang bisa diganti tes (pola `engine`): Mulai yang sah disimpan setelah jeda ini bila tidak ada blur/Enter
// (pilihan dari kalender bawaan tidak selalu diikuti blur).
const SEC_TIMING = { startDebounceMs: 700 };

function secBadText(n) {
  return n + " dependensi rusak atau tidak dikenali versi ini";
}

function secLateText(finishDn, late) {
  return "Selesai " + TLCal.fmtShort(finishDn) + ", " + late + " " + SEC_HK + " setelah tenggat";
}

const liveTask = (t) => !!t && typeof t === "object" && !t.recurrence_type && t.gtd_status !== "archived" && !t.deleted;

// Scope dependensi seksi (R15): workspace sama (`list_id`), atau pribadi dengan project sama (lipatan host
// projectNameFold; keduanya tanpa project juga sama) — kunci yang sama dengan TLSched.canLink.
const secScopeKey = TLSched.scopeKeyOf;

function taskTitle(t) {
  return t && t.title !== undefined && t.title !== null && String(t.title).trim() ? String(t.title).trim() : "Tanpa judul";
}

// Kunci kanonik (urut) agar urutan kunci ext dari host tidak dianggap perubahan.
function stableKey(o) {
  const src = o && typeof o === "object" ? o : {};
  const out = {};
  for (const k of Object.keys(src).sort()) out[k] = src[k];
  return JSON.stringify(out);
}

function readExtSafe(api, task) {
  try {
    const r = api.taskExt.read(task);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  } catch (e) {
    logWarn(api, "ext jadwal gagal dibaca:", e);
    return {};
  }
}

// Patch → ext mentah baru (null = kunci dihapus), tanpa mengubah masukan.
function applyRaw(raw, patch) {
  const out = Object.assign({}, raw);
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete out[k];
    else out[k] = patch[k];
  }
  return out;
}

// Kembalikan kunci patch ke nilai `before` (kunci yang dulu tidak ada → dihapus).
function revertRaw(raw, patch, before) {
  const out = Object.assign({}, raw);
  for (const k of Object.keys(patch)) {
    if (Object.prototype.hasOwnProperty.call(before, k)) out[k] = before[k];
    else delete out[k];
  }
  return out;
}

// Dependensi tampil dari deps mentah: [{i: indeks mentah, key, lag}] (sah, unik, ≤ 20); bad = sisanya (rusak, tipe
// yang belum dikenal versi ini seperti SS, ganda, atau deps bukan array). Item mentah tidak pernah ditulis ulang
// lewat sanitasi (kebijakan Task 8): ubah/hapus menyentuh satu indeks, sisanya apa adanya.
function depRowsOf(raw) {
  const list = Array.isArray(raw.deps) ? raw.deps : [];
  const rows = [];
  const seen = new Set();
  list.forEach((item, i) => {
    const d = TLSched.readSched({ deps: [item] }).deps[0];
    if (!d || seen.has(d.key) || rows.length >= TLSched.MAX_DEPS) return;
    seen.add(d.key);
    rows.push({ i, key: d.key, lag: d.lag });
  });
  const bad = raw.deps === undefined || raw.deps === null ? 0 : Array.isArray(raw.deps) ? list.length - rows.length : 1;
  return { rows, bad };
}

// Anak hidup per induk (kunci String(id) induk kanonik), parent_id server atau parent_cid offline (R9/R10).
function childrenOf(list, idx) {
  const kids = new Map();
  for (const t of list) {
    if (!liveTask(t)) continue;
    const p = t.parent_id !== undefined && t.parent_id !== null ? t.parent_id : t.parent_cid;
    if (p === undefined || p === null || p === "") continue;
    const par = idx.get(String(p));
    if (!par || par === t || par.id === undefined || par.id === null) continue;
    const k = String(par.id);
    let a = kids.get(k);
    if (!a) kids.set(k, (a = []));
    a.push(t);
  }
  return kids;
}

// Induk dengan anak hidup di `list` (daftar task lengkap) = ringkasan (R10) — logika yang sama dengan seksi Jadwal.
function isSummaryIn(list, task) {
  const all = Array.isArray(list) ? list : [];
  const idx = TLSched.buildIndex(all);
  const self = (task && idx.get(String(task.id))) || task;
  if (!self || self.id === undefined || self.id === null) return false;
  const kids = childrenOf(all, idx).get(String(self.id));
  return !!(kids && kids.length);
}

// SATU pemeriksaan dependensi baru pred → succ (R15) untuk Gantt (link) dan seksi Jadwal (pemilih), terhadap daftar
// task LENGKAP `list` (api.data.tasks.list({includeDone: true}); bukan scopeTasks yang difilter panel host):
// scope = task hidup dengan scopeKeyOf sama dengan penerus; edge dari ext semua task scope; ringkasan = punya anak
// hidup di scope; canLink (diri sendiri, scope, ringkasan, ganda, maks, siklus); dependensi tersimpan jenis apa pun ke
// pendahulu yang sama (cid/server_id lewat indeks) = ganda. readRaw(t, isSucc) → ext mentah task (penerus: nilai
// lokal/efektif pemanggil). → {ok: true, deps: deps lama apa adanya + item baru} | {ok: false, reason}.
function checkLink(api, list, pred, succ, readRaw) {
  const all = Array.isArray(list) ? list : [];
  const idx = TLSched.buildIndex(all);
  const self = (succ && idx.get(String(succ.id))) || succ;
  const p = (pred && idx.get(String(pred.id))) || pred;
  if (!self || !p) return { ok: false, reason: "scope" };
  const sk = secScopeKey(self);
  const scope = all.filter((t) => liveTask(t) && secScopeKey(t) === sk);
  if (scope.indexOf(self) < 0) scope.push(self);
  const rawOf = (t) => {
    const r = readRaw(t, t === self);
    return r && typeof r === "object" && !Array.isArray(r) ? r : {};
  };
  const raw = rawOf(self);
  const old = Array.isArray(raw.deps) ? raw.deps : [];
  const sidx = TLSched.buildIndex(scope);
  const edges = TLSched.resolveDeps(scope.map((t) => ({ task: t, sched: TLSched.readSched(t === self ? raw : rawOf(t)) })), sidx);
  const chk = TLSched.canLink({ pred: p, succ: self, scopeTasks: scope, edges, depCount: old.length });
  if (!chk.ok) return chk;
  if (old.some((d) => {
    const k = d && typeof d === "object" ? TLSched.refKey(d.t) : null;
    return k !== null && (k === String(p.id) || idx.get(k) === p);
  })) return { ok: false, reason: "dup" };
  let ref;
  try {
    ref = api.taskExt.ref(p);
  } catch (e) {
    logWarn(api, "ref dependensi gagal:", e);
    return { ok: false, reason: "ref" };
  }
  const san = TLSched.sanitizePatch({ deps: [{ t: ref, type: "FS", lag: 0 }] });
  if (!san.ok) return { ok: false, reason: "ref" };
  return { ok: true, deps: old.concat(san.patch.deps) };
}

// Rentang task: daun = spanOf(ext); induk = min–maks anak terjadwal, rekursif (R10). Lingkaran induk diputus.
function spanTree(c, t, kids, readOf, seen) {
  const k = String(t.id);
  const ch = kids.get(k);
  if (!ch || !ch.length) return TLSched.spanOf(c, readOf(t));
  if (seen.has(k)) return null;
  seen.add(k);
  let s = Infinity;
  let f = -Infinity;
  for (const x of ch) {
    const sp = spanTree(c, x, kids, readOf, seen);
    if (!sp) continue;
    if (sp.s < s) s = sp.s;
    if (sp.f > f) f = sp.f;
  }
  return s === Infinity ? null : { s, f };
}

function calSafe(fn) {
  try {
    const v = fn();
    return Number.isInteger(v) ? v : null;
  } catch (e) {
    return null; // TL_CAL_LOOP: kalender tanpa hari kerja terjangkau → tidak terhitung
  }
}

// Salinan task yang lebih baru (updated_at) — task di modal adalah salinan saat dibuka (R17), daftar api.data.tasks
// membawa progres/tenggat terkini. Seri → props.
function fresherTask(propsTask, listed) {
  if (!listed) return propsTask;
  const a = Date.parse(propsTask.updated_at || "");
  const b = Date.parse(listed.updated_at || "");
  return Number.isFinite(b) && (!Number.isFinite(a) || b > a) ? listed : propsTask;
}

function pctOf(t) {
  if (t.gtd_status === "done" || t.completed_at) return 100;
  const p = Number(t.progress);
  return Number.isFinite(p) ? Math.round(Math.min(100, Math.max(0, p))) : 0;
}

function commitDate(v) {
  if (typeof v !== "string" || !TLCal.isIso(v)) return false;
  const y = Number(v.slice(0, 4));
  return y >= SEC_YEAR_MIN && y <= SEC_YEAR_MAX;
}

// Angka dari input teks: kosong/bukan angka → null; selain itu dibulatkan dan dijepit.
function clampText(v, lo, hi) {
  const s = String(v === undefined || v === null ? "" : v).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// Penjaga tanpa hooks: task berulang / tanpa id → null (Q5, R17); selain itu badan berhook sebagai elemen.
function ScheduleSection(props) {
  const context = props && props.context;
  const task = context && context.task;
  if (!task || typeof task !== "object" || task.recurrence_type) return null;
  if (task.id === undefined || task.id === null || task.id === "") return null;
  return React.createElement(ScheduleBody, props);
}

function ScheduleBody(props) {
  const { context, api } = props;
  const task = context.task;
  const tid = task.id;
  const propRaw = readExtSafe(api, task);
  const propKey = stableKey(propRaw);

  // Daftar task (judul dependensi, ringkasan, rentang pendahulu, progres terkini, ext terbaru). Dimuat saat task/ext
  // berganti, saat sinkron selesai, dan (dibatasi) saat seksi difokus/disentuh; pemilih memuat sendiri saat dibuka.
  // Berurutan: hanya jawaban permintaan terbaru yang dipakai.
  const [all, setAll] = React.useState(null);
  const loadRef = React.useRef({ at: 0, alive: true, seq: 0 });
  const loadAll = () => {
    const L = loadRef.current;
    L.at = nowMs();
    const seq = ++L.seq;
    return Promise.resolve()
      .then(() => api.data.tasks.list({ includeDone: true }))
      .then((list) => {
        const arr = Array.isArray(list) ? list : [];
        if (L.alive && seq === L.seq) setAll(arr);
        return arr;
      }, (e) => {
        logWarn(api, "daftar task gagal dimuat:", e);
        if (L.alive && seq === L.seq) setAll((p) => p || []); // tetap bisa dipakai tanpa daftar
        return null;
      });
  };
  const view = React.useMemo(() => {
    const list = all || [];
    const idx = TLSched.buildIndex(list);
    return { list, idx, kids: childrenOf(list, idx) };
  }, [all]);
  const listedSelf = view.idx.get(String(tid)) || null;
  // Salinan terbaru (updated_at): modal membawa salinan saat dibuka; daftar membawa ext/progres/tenggat terkini.
  const info = fresherTask(task, listedSelf);
  const srcRaw = info === task ? propRaw : readExtSafe(api, info);
  const srcKey = info === task ? propKey : stableKey(srcRaw);
  const writeId = listedSelf && listedSelf.id !== undefined && listedSelf.id !== null ? listedSelf.id : tid;

  // R17 state lokal optimistis: di-seed ulang saat task.id berganti, atau saat ext sumber terbaru (props atau daftar)
  // berubah selama tidak ada tulis berjalan dan tidak ada draf input. Sumber yang sudah menyusul (sama dengan lokal)
  // hanya memperbarui kunci.
  const inflight = React.useRef(0);
  const [loc, setLoc] = React.useState(() => ({ id: tid, key: srcKey, raw: srcRaw, d: {} }));
  let cur = loc;
  if (loc.id !== tid) cur = { id: tid, key: srcKey, raw: srcRaw, d: {} };
  else if (loc.key !== srcKey && inflight.current === 0 && !Object.keys(loc.d).length) {
    cur = stableKey(loc.raw) === srcKey ? Object.assign({}, loc, { key: srcKey }) : { id: tid, key: srcKey, raw: srcRaw, d: {} };
  }
  if (cur !== loc) setLoc(cur);
  const [, setTick] = React.useState(0);
  const raw = cur.raw;
  const sched = TLSched.readSched(raw);
  const deps = depRowsOf(raw);
  // Durasi bukan-nol terakhir di mount ini (per task) untuk "hapus centang Milestone".
  const lastDur = React.useRef({ id: tid, n: null });
  if (lastDur.current.id !== tid) lastDur.current = { id: tid, n: null };
  if (sched.start !== null && sched.duration > 0) lastDur.current.n = sched.duration;

  const [open, setOpenPref] = usePref(api, "section", "");
  const [forceOpen, setForceOpen] = React.useState(false);
  const expanded = open || forceOpen;
  const [picker, setPicker] = React.useState(null); // null | {q, list: null | task[]}

  const target = calTarget(task.list_id);
  const cal = useCalendar(api, target, true);
  const c = React.useMemo(() => TLCal.compile(cal.data), [cal.data]);

  React.useEffect(() => {
    loadRef.current.alive = true;
    loadAll();
    return undefined;
  }, [api, tid, propKey]);
  React.useEffect(() => {
    let off = null;
    try {
      off = api.events.on("sync.done", () => { loadAll(); });
    } catch (e) {
      logWarn(api, "pendengar sync.done gagal:", e);
    }
    return () => {
      loadRef.current.alive = false;
      if (typeof off === "function") off();
    };
  }, [api]);
  const refreshSoon = () => {
    if (nowMs() - loadRef.current.at > SEC_REFRESH_MS) loadAll();
  };

  const selfLive = listedSelf || task;
  const readOther = (t) => TLSched.readSched(t === selfLive ? raw : readExtSafe(api, t));

  // ---- tulis ----
  const setDraft = (name, value) => setLoc((p) => (p.id === tid ? Object.assign({}, p, { d: Object.assign({}, p.d, { [name]: value }) }) : p));
  const clearDraft = (name) => setLoc((p) => {
    if (p.id !== tid || !(name in p.d)) return p;
    const d = Object.assign({}, p.d);
    delete d[name];
    return Object.assign({}, p, { d });
  });
  const write = (patch, draftName) => {
    const before = raw;
    setLoc((p) => {
      if (p.id !== tid) return p;
      const d = Object.assign({}, p.d);
      if (draftName) delete d[draftName];
      return Object.assign({}, p, { raw: applyRaw(p.raw, patch), d });
    });
    inflight.current += 1;
    let p;
    try {
      // panggil sinkron: urutan tulis = urutan aksi pengguna. Id dari daftar: salinan modal ber-cid basi → id terkini.
      p = Promise.resolve(api.taskExt.set(writeId, patch));
    } catch (e) {
      p = Promise.reject(e);
    }
    p
      .then(null, (e) => {
        logWarn(api, "jadwal gagal disimpan:", e);
        toastSafe(api, MSG_SAVE_FAIL, "error");
        setLoc((p) => (p.id === tid ? Object.assign({}, p, { raw: revertRaw(p.raw, patch, before) }) : p));
      })
      .then(() => {
        inflight.current = Math.max(0, inflight.current - 1);
        setTick((n) => n + 1); // render ulang: props yang menyusul selama tulis kini boleh men-seed
      });
  };
  const writeSched = (p, draftName) => {
    const san = TLSched.sanitizePatch(p);
    if (!san.ok) {
      if (draftName) clearDraft(draftName);
      return;
    }
    write(san.patch, draftName);
  };

  // Jepret ke hari kerja seperti seret/klik-jadwalkan (R13, R21): durasi ≥ 1 → nextWork; milestone boleh di hari libur (R6).
  const snapStart = (v, dur) => {
    if (dur === 0) return v;
    const n = calSafe(() => TLCal.nextWork(c, TLCal.dn(v)));
    return n === null ? v : TLCal.iso(n);
  };
  const commitStart = (v) => {
    if (v === null) {
      if (sched.start === null) clearDraft("start");
      else writeSched({ start: null, duration: null }, "start");
      return;
    }
    const x = snapStart(v, sched.start === null ? 1 : sched.duration);
    if (x === sched.start) clearDraft("start");
    else if (sched.start === null) writeSched({ start: x, duration: 1 }, "start");
    else writeSched({ start: x }, "start");
  };
  // Mulai: change hanya menyimpan draf; simpan saat blur / Enter, atau setelah jeda (pilihan kalender bawaan tanpa
  // blur) — satu tulis per edit. Jeda tertunda saat seksi dilepas/task berganti tetap disimpan (penutupan modal cepat).
  const startTimer = React.useRef(null); // {id, run}
  const cancelStartTimer = () => {
    const t = startTimer.current;
    startTimer.current = null;
    if (t) clearTimeout(t.id);
  };
  React.useEffect(() => () => {
    const t = startTimer.current;
    startTimer.current = null;
    if (t) {
      clearTimeout(t.id);
      t.run();
    }
  }, [tid]);
  const onStartChange = (e) => {
    const v = e && e.target ? String(e.target.value || "") : "";
    cancelStartTimer();
    setDraft("start", v);
    if (!commitDate(v)) return;
    const run = () => commitStart(v);
    const id = setTimeout(() => {
      if (startTimer.current && startTimer.current.id === id) {
        startTimer.current = null;
        run();
      }
    }, SEC_TIMING.startDebounceMs);
    startTimer.current = { id, run };
  };
  const onStartBlur = (e) => {
    cancelStartTimer();
    const t = e && e.target ? e.target : {};
    const v = String(t.value || "");
    if (commitDate(v)) commitStart(v);
    else if (v === "" && !(t.validity && t.validity.badInput)) commitStart(null);
    else clearDraft("start"); // tanggal setengah diketik / tak sah → kembali ke nilai tersimpan
  };
  const onStartKey = (e) => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelStartTimer();
    const v = e.target ? String(e.target.value || "") : "";
    if (commitDate(v)) commitStart(v);
  };

  const commitDur = (v) => {
    const n = clampText(v, 1, TLSched.DUR_MAX);
    if (n === null || n === sched.duration || sched.start === null) clearDraft("dur");
    else writeSched({ duration: n }, "dur");
  };
  const onEnter = (fn) => (e) => {
    if (!e || e.key !== "Enter") return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    fn(e.target ? e.target.value : "");
  };

  const setMilestone = (on) => {
    if (sched.start === null) return;
    if (on) {
      if (sched.duration !== 0) writeSched({ duration: 0 });
      return;
    }
    if (sched.duration !== 0) return;
    const n = lastDur.current.id === tid && lastDur.current.n ? lastDur.current.n : 1;
    const patch = { duration: n };
    const x = snapStart(sched.start, n); // milestone di hari libur → bar mulai di hari kerja berikutnya
    if (x !== sched.start) patch.start = x;
    writeSched(patch);
  };

  const rawDeps = Array.isArray(raw.deps) ? raw.deps : [];
  const commitLag = (row, v) => {
    const name = "lag:" + row.i;
    const n = clampText(v, TLSched.LAG_MIN, TLSched.LAG_MAX);
    if (n === null || n === row.lag) {
      clearDraft(name);
      return;
    }
    write({ deps: rawDeps.map((it, j) => (j === row.i ? Object.assign({}, it, { lag: n }) : it)) }, name);
  };
  const removeDep = (row) => {
    const next = rawDeps.filter((_, j) => j !== row.i);
    write({ deps: next.length ? next : null }, "lag:" + row.i);
  };
  const cleanBad = () => {
    const keep = deps.rows.map((r) => rawDeps[r.i]);
    write({ deps: keep.length ? keep : null });
  };

  // ---- pemilih dependensi (R15, R17) ----
  const openPicker = () => {
    setForceOpen(true);
    setPicker({ q: "", list: null });
    loadAll().then((list) => {
      if (loadRef.current.alive) setPicker((p) => (p ? Object.assign({}, p, { list: list || [] }) : p));
    });
  };
  const closePicker = () => setPicker(null);
  const pickIndex = React.useMemo(() => {
    const list = picker && picker.list ? picker.list : [];
    const idx = TLSched.buildIndex(list);
    return { list, idx, kids: childrenOf(list, idx) };
  }, [picker && picker.list]);

  // Pemeriksaan bersama dengan Gantt (checkLink) atas daftar lengkap pemilih; ext penerus = nilai lokal optimistis.
  const addDep = (pred) => {
    const chk = checkLink(api, pickIndex.list, pred, task, (t, isSucc) => (isSucc ? raw : readExtSafe(api, t)));
    if (!chk.ok) {
      if (LINK_MSG[chk.reason]) toastSafe(api, LINK_MSG[chk.reason], "error");
      return;
    }
    write({ deps: chk.deps });
    setPicker(null);
  };

  // ---- turunan tampilan ----
  const selfKids = view.kids.get(String(selfLive.id)) || [];
  const summary = selfKids.length > 0;
  const span = TLSched.spanOf(c, sched);
  const preds = [];
  const depView = deps.rows.map((r) => {
    const p = all ? view.idx.get(r.key) : null;
    if (p) {
      const sp = spanTree(c, p, view.kids, readOther, new Set());
      if (sp) preds.push({ span: sp, lag: r.lag });
    }
    return {
      row: r,
      name: p ? taskTitle(p) : all ? SEC_DELETED : SEC_LOADING,
      outside: !!p && secScopeKey(p) !== secScopeKey(selfLive),
    };
  });
  const earliest = span && preds.length ? TLSched.shiftAfterDeps(c, null, preds) : null;
  const eff = span ? calSafe(() => TLCal.nextWork(c, span.s)) : null;
  const violated = earliest !== null && eff !== null && eff < TLCal.dn(earliest);
  const late = span ? TLSched.deadlineLate(c, span.f, info.deadline) : null;

  const head = (withToggle) => (
    <div className="plg-timeline-sec-head">
      <span className="plg-timeline-sec-title">{SEC_TITLE}</span>
      {withToggle ? (
        <button type="button" className={cx("plg-timeline-sec-more", expanded && "is-open")} aria-expanded={expanded}
          onClick={() => {
            if (expanded) {
              setForceOpen(false);
              setOpenPref(false);
            } else setOpenPref(true);
          }}>
          {expanded ? SEC_LESS : SEC_MORE}
        </button>
      ) : null}
    </div>
  );

  // Daftar belum dimuat: hanya kepala seksi (ringkasan tidak berkedip menjadi input lalu berganti).
  if (all === null) {
    return (
      <section className="plg-timeline-section" aria-label={SEC_TITLE} aria-busy="true">
        {head(false)}
      </section>
    );
  }

  // Ringkasan (R10): rentang dari subtask, tanpa input.
  if (summary) {
    const sp = spanTree(c, selfLive, view.kids, readOther, new Set());
    const wd = sp ? calSafe(() => TLCal.workdays(c, sp.s, sp.f)) : null;
    return (
      <section className="plg-timeline-section" aria-label={SEC_TITLE} onFocus={refreshSoon} onPointerEnter={refreshSoon}>
        {head(false)}
        <p className="plg-timeline-sec-note">{SEC_SUMMARY}</p>
        <div className="plg-timeline-sec-range">
          {sp ? TLCal.fmtShort(sp.s) + " → " + TLCal.fmtShort(sp.f) + (wd === null ? "" : " · " + wd + " " + SEC_HK) : SEC_SUMMARY_NONE}
        </div>
      </section>
    );
  }

  const d = cur.d;
  const startVal = "start" in d ? d.start : sched.start || "";
  const durVal = "dur" in d ? d.dur : sched.start === null ? "" : String(sched.duration);
  const milestone = sched.start !== null && sched.duration === 0;

  const fields = (
    <div className="plg-timeline-sec-row">
      <label className="plg-timeline-field">
        <span className="plg-timeline-field-label">{SEC_START}</span>
        <input type="date" className="plg-timeline-input" aria-label={SEC_START} value={startVal}
          onChange={onStartChange} onBlur={onStartBlur} onKeyDown={onStartKey} />
      </label>
      <label className="plg-timeline-field">
        <span className="plg-timeline-field-label">{SEC_DUR}</span>
        <span className="plg-timeline-sec-num">
          <input type="number" className="plg-timeline-input plg-timeline-num" aria-label={SEC_DUR + " (" + SEC_HK + ")"}
            min={1} max={TLSched.DUR_MAX} step={1} inputMode="numeric" value={durVal} disabled={sched.start === null || milestone}
            onChange={(e) => setDraft("dur", e && e.target ? String(e.target.value) : "")}
            onBlur={(e) => commitDur(e && e.target ? e.target.value : "")} onKeyDown={onEnter(commitDur)} />
          <span className="plg-timeline-sec-unit">{SEC_HK}</span>
        </span>
      </label>
    </div>
  );

  let more = null;
  if (expanded) {
    const warns = [];
    if (late > 0) {
      warns.push(
        <div key="late" className="plg-timeline-sec-warn" role="status">
          <span className="plg-timeline-sec-warn-icon" aria-hidden="true">⚠</span>
          <span className="plg-timeline-sec-warn-text">{secLateText(span.f, late)}</span>
        </div>
      );
    }
    if (violated) {
      warns.push(
        <div key="viol" className="plg-timeline-sec-warn" role="status">
          <span className="plg-timeline-sec-warn-icon" aria-hidden="true">⚠</span>
          <span className="plg-timeline-sec-warn-text">{MSG_VIOLATION}</span>
          <button type="button" className="plg-timeline-btn plg-timeline-sec-shift" onClick={() => writeSched({ start: earliest })}>
            {SEC_SHIFT}
          </button>
        </div>
      );
    }
    more = (
      <div className="plg-timeline-sec-body">
        <div className="plg-timeline-sec-row">
          <div className="plg-timeline-field">
            <span className="plg-timeline-field-label">{SEC_FINISH}</span>
            <span className="plg-timeline-sec-val" data-field="finish">{span ? TLCal.fmtLong(span.f) : "—"}</span>
          </div>
          <div className="plg-timeline-field">
            <span className="plg-timeline-field-label">{SEC_PCT}</span>
            <span className="plg-timeline-sec-val" data-field="pct">{pctOf(info) + "%"}</span>
            <span className="plg-timeline-sec-hint">{SEC_PCT_HINT}</span>
          </div>
        </div>
        <label className={cx("plg-timeline-sec-check", sched.start === null && "is-disabled")}>
          <input type="checkbox" aria-label={SEC_MILESTONE} checked={milestone} disabled={sched.start === null}
            onChange={(e) => setMilestone(!!(e && e.target && e.target.checked))} />
          <span>{SEC_MILESTONE}</span>
        </label>
        {warns}
        {depView.length || deps.bad ? (
          <div className="plg-timeline-sec-deps">
            <span className="plg-timeline-field-label">{SEC_DEPS}</span>
            {depView.length ? (
              <ul className="plg-timeline-deps">
                {depView.map((v) => {
                  const r = v.row;
                  const dn = "lag:" + r.i;
                  return (
                    <li key={r.i + ":" + r.key} className="plg-timeline-dep" data-key={r.key}>
                      <span className="plg-timeline-dep-main">
                        <span className="plg-timeline-dep-name" title={v.name}>{v.name}</span>
                        {v.outside ? <span className="plg-timeline-dep-note">{SEC_OUTSIDE}</span> : null}
                      </span>
                      <span className="plg-timeline-dep-type">FS</span>
                      <span className="plg-timeline-sec-num">
                        <input type="number" className="plg-timeline-input plg-timeline-num" aria-label={"Jeda setelah " + v.name + " (" + SEC_HK + ")"}
                          min={TLSched.LAG_MIN} max={TLSched.LAG_MAX} step={1} value={dn in d ? d[dn] : String(r.lag)}
                          onChange={(e) => setDraft(dn, e && e.target ? String(e.target.value) : "")}
                          onBlur={(e) => commitLag(r, e && e.target ? e.target.value : "")} onKeyDown={onEnter((val) => commitLag(r, val))} />
                        <span className="plg-timeline-sec-unit">{SEC_HK}</span>
                      </span>
                      <button type="button" className="plg-timeline-dep-del" aria-label={"Hapus dependensi " + v.name} title="Hapus dependensi"
                        onClick={() => removeDep(r)}>×</button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {deps.bad ? (
              <div className="plg-timeline-sec-bad">
                <span>{secBadText(deps.bad)}</span>
                <button type="button" className="plg-timeline-btn" onClick={cleanBad}>{SEC_BAD_BTN}</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  let pickerEl = null;
  if (picker) {
    const { list, idx, kids } = pickIndex;
    const self = idx.get(String(tid)) || null;
    const sk = secScopeKey(self || task);
    const q = picker.q.trim().toLowerCase();
    const depSet = new Set();
    for (const r of rawDeps) {
      const k = r && typeof r === "object" ? TLSched.refKey(r.t) : null;
      const found = k === null ? null : idx.get(k);
      if (found) depSet.add(found);
    }
    let cands = [];
    if (picker.list) {
      for (const t of list) {
        if (!liveTask(t) || t.id === undefined || t.id === null || idx.get(String(t.id)) !== t) continue;
        if (t === self || String(t.id) === String(tid) || secScopeKey(t) !== sk) continue;
        if ((kids.get(String(t.id)) || []).length) continue; // ringkasan tidak bisa jadi pendahulu di 1b (R10)
        if (q && taskTitle(t).toLowerCase().indexOf(q) < 0) continue;
        cands.push(t);
      }
      // urutan tetap: belum selesai dulu, lalu judul (id), lalu id; ≤ 50 (R17)
      const doneOf = (t) => (t.gtd_status === "done" || t.completed_at ? 1 : 0);
      cands.sort((x, y) => doneOf(x) - doneOf(y) || taskTitle(x).localeCompare(taskTitle(y), "id") || (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0));
      cands = cands.slice(0, PICK_MAX);
    }
    pickerEl = (
      <div className="plg-timeline-picker" onKeyDown={(e) => {
        if (e && e.key === "Escape") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
          closePicker();
        }
      }}>
        <div className="plg-timeline-picker-bar">
          <input type="search" className="plg-timeline-input plg-timeline-picker-q" aria-label={SEC_SEARCH} placeholder={SEC_SEARCH + "…"}
            value={picker.q} autoFocus
            onChange={(e) => {
              const v = e && e.target ? String(e.target.value) : "";
              setPicker((p) => (p ? Object.assign({}, p, { q: v }) : p));
            }} />
          <button type="button" className="plg-timeline-btn" onClick={closePicker}>{SEC_CLOSE}</button>
        </div>
        {!picker.list ? <div className="plg-timeline-sec-muted">{SEC_LOADING}</div>
          : !cands.length ? <div className="plg-timeline-sec-muted">{SEC_NO_MATCH}</div>
          : (
            <ul className="plg-timeline-picks">
              {cands.map((t) => (
                <li key={String(t.id)}>
                  <button type="button" className="plg-timeline-pick" data-key={String(t.id)} onClick={() => addDep(t)}>
                    <span className="plg-timeline-pick-title">{taskTitle(t)}</span>
                    {depSet.has(t) ? <span className="plg-timeline-pick-note">{SEC_IS_DEP}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    );
  }

  return (
    <section className="plg-timeline-section" aria-label={SEC_TITLE} onFocus={refreshSoon} onPointerEnter={refreshSoon}>
      {head(true)}
      {fields}
      {more}
      {picker ? null : (
        <div className="plg-timeline-sec-actions">
          <button type="button" className="plg-timeline-sec-link" onClick={openPicker}>{SEC_ADD_DEP}</button>
        </div>
      )}
      {pickerEl}
    </section>
  );
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
  CAL_ENTITY, CAL_MAX_BYTES, MSG_CAL_TOO_LARGE, MSG_CAL_LOST, SEC_TIMING,
  MSG_EMPTY, MSG_VIOLATION, MSG_SCHEDULE_HINT, LEGEND, ZOOMS, COLS_FULL, COLS_COMPACT,
  engine, rowCells, pomoText, missingYearsNote, barGeom, createInteractions, checkLink, isSummaryIn,
  MSG_CHANGED, MSG_UNDO, MSG_SAVE_FAIL, MSG_CYCLE, MSG_MAX_DEPS, MSG_SUMMARY_DEP, MSG_DUP_DEP, MSG_SUMMARY_SCHED,
  TimelineViewBody, ScheduleSection, ScheduleBody, CalendarPopover, ListFallback,
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
