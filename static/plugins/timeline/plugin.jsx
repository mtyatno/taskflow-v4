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
function renderBar(r, box, y, v) {
  const { rowH, isSel } = v;
  const t = r.task;
  const sel = isSel(t);
  const title = rowCells(r).name;
  const aria = TLLayout.ariaBar(t, r.kind === "summary" ? { duration: r.duration } : r.sched, r.span, r.progress, r.kind);
  const common = {
    key: "b" + r.key, "data-key": r.key, role: "button", tabIndex: 0, "aria-label": aria,
    onClick: (e) => v.ix.open(r, e), onKeyDown: (e) => v.ix.key(r, e),
  };
  const label = <span className="plg-timeline-label" aria-hidden="true">{title}</span>;
  if (box.milestone) {
    const top = y + (rowH - MS_SIZE) / 2;
    return (
      <div {...common} className={cx("plg-timeline-milestone", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected")}
        style={{ transform: "translate(" + (box.x - MS_SIZE / 2) + "px," + top + "px)", width: MS_SIZE, height: MS_SIZE }}>{label}</div>
    );
  }
  if (r.kind === "summary") {
    const top = y + (rowH - SUM_H) / 2;
    return (
      <div {...common} className={cx("plg-timeline-summary", r.late > 0 && "is-late", sel && "is-selected")}
        style={{ transform: "translate(" + box.x + "px," + top + "px)", width: box.w, height: SUM_H }}>{label}</div>
    );
  }
  const top = y + (rowH - BAR_H) / 2;
  const pct = r.done ? 100 : Math.round(r.progress);
  return (
    <div {...common} className={cx("plg-timeline-bar", r.done && "is-done", r.late > 0 && "is-late", sel && "is-selected")}
      style={{ transform: "translate(" + box.x + "px," + top + "px)", width: box.w, height: BAR_H }}>
      <div className="plg-timeline-fill" style={{ width: pct + "%" }} />
      {label}
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
          <span className="plg-timeline-hint" style={{ left: tableW + 8 }}>{MSG_SCHEDULE_HINT}</span>
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
  return (
    <div className="plg-timeline-chart" style={{ width: chartW, height: bodyH, backgroundImage: TLLayout.weekendGradient(c, R, px) }}>
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

// 4e. View Gantt (slot taskList.views, id "gantt").
// Interaksi Task 8 dipasang lewat objek `ix` (open/key sudah ada; Task 8 menambah barDown/edgeDown/dotDown/slotDown +
// kunci Alt+panah di `key`), tanpa mengubah fungsi render.
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
  // tetap terlihat) dan lebar grafik tampak.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasWindow()) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const footH = footRef.current ? footRef.current.offsetHeight || 0 : 0;
      const boxH = Math.max(MIN_BOX_H, Math.floor((window.innerHeight || 0) - rect.top - BOX_GAP - footH));
      const w = Math.max(0, el.clientWidth - tableW);
      setVp((p) => (p.boxH === boxH && p.w === w ? p : Object.assign({}, p, { boxH, h: Math.max(0, boxH - HEAD_H), w })));
    };
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
  const ix = {
    open(row) {
      if (row && row.task && typeof context.onTaskClick === "function") context.onTaskClick(row.task);
    },
    key(row, e) {
      if (e && e.key === "Enter") {
        if (typeof e.preventDefault === "function") e.preventDefault();
        ix.open(row);
      }
    },
  };

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
  engine, rowCells, pomoText, missingYearsNote,
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
