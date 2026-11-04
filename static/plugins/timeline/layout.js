// Plugin Timeline — TLLayout: tata letak Gantt murni — kelompok, WBS, ringkasan, skala & rentang, header, jendela virtual,
// arsir akhir pekan, panah dependensi, label aksesibilitas (spec §8.5/§8.6, rencana R2, R9, R10, R11, R16, R21–R24).
// Murni: tanpa Date lokal, tanpa global, tanpa akses api. "Hari ini" dan kalender dimasukkan sebagai argumen.
// Kalender dikompilasi SEKALI per layout() (TLCal.compile menormalkan + men-stringify sebelum cache); semua panggilan
// TLCal yang bisa melempar TL_CAL_LOOP lewat TLSched (spanOf/violations/deadlineLate menurun: task tanpa bar, bukan crash).
const TLLayout = (function (CAL, SCHED, HOL) {
  const PX = Object.freeze({ day: 28, week: 12, month: 4 });
  const ROW_H = 32;
  const ROW_H_TOUCH = 36;
  const DEFAULT_ZOOM = "week";
  const PAD_BEFORE = 14; // hari sebelum mulai paling awal
  const PAD_AFTER = 30; // hari setelah selesai/tenggat paling akhir
  const TODAY_PAD = 60; // hari ± hari ini yang selalu masuk rentang
  const RANGE_SPAN = 1830; // tanggal yang ikut menentukan rentang dijepit ke hari ini ± 1830 hari (±5 tahun; deviasi R22)
  const MAX_WD_SPAN = 3660; // hari kalender maks yang dihitung untuk durasi hari kerja ringkasan (pola MAX_LATE_SPAN)
  const ARROW_OUT = 6; // px keluar dari sisi pendahulu (R19: ujung → kanan, awal → kiri)
  const ARROW_IN = 6; // px lari horizontal terakhir menuju sisi penerus
  const NO_PROJECT = "(Tanpa project)";

  const BULAN_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const HARI_SHORT = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

  const isInt = (n) => typeof n === "number" && Number.isInteger(n);
  const isFin = (n) => typeof n === "number" && Number.isFinite(n);

  // ---------------------------------------------------------------- geometri skala
  // Posisi x (px) awal hari `dn`; hari `range.from` = x 0.
  function xOf(dn, range, px) {
    return (dn - range.from) * px;
  }

  // Hari yang memuat posisi x (kebalikan xOf); tidak dijepit.
  function dnAt(x, range, px) {
    return range.from + Math.floor(x / px);
  }

  // Lebar total area grafik (px) untuk rentang inklusif.
  function widthOf(range, px) {
    return (range.to - range.from + 1) * px;
  }

  // Kotak bar {x, w, milestone}, dipangkas ke rentang; seluruhnya di luar rentang → null. Milestone (durasi 0 pada task biasa)
  // = titik pusat hari (lebar 0). `kind === "summary"` menang atas durasi 0: ringkasan selalu bar selebar rentangnya.
  function barBox(span, sched, range, px, kind) {
    if (!span) return null;
    const s = Math.max(span.s, range.from);
    const f = Math.min(span.f, range.to);
    if (f < s) return null;
    const x = xOf(s, range, px);
    if (kind !== "summary" && sched && sched.duration === 0) return { x: x + px / 2, w: 0, milestone: true };
    return { x, w: (f - s + 1) * px, milestone: false };
  }

  // ---------------------------------------------------------------- jendela virtual (R11)
  // Baris yang dirender = tampak ± buffer, dijepit ke [0, n − 1]. rows: array atau jumlah baris.
  function windowRows(rows, scrollTop, viewH, rowH, buffer) {
    const n = Array.isArray(rows) ? rows.length : isFin(rows) ? Math.max(0, Math.floor(rows)) : 0;
    const buf = buffer === undefined ? 10 : buffer;
    if (n === 0) return { first: 0, last: -1 };
    const h = rowH > 0 ? rowH : ROW_H;
    const top = isFin(scrollTop) ? Math.max(0, scrollTop) : 0;
    const vh = isFin(viewH) ? Math.max(0, viewH) : 0;
    const visFirst = Math.floor(top / h);
    const visLast = Math.ceil((top + vh) / h) - 1;
    const first = Math.min(n - 1, Math.max(0, visFirst - buf));
    const last = Math.min(n - 1, Math.max(first, visLast + buf));
    return { first, last };
  }

  // Kolom hari yang dirender: [scrollLeft − 1 layar, scrollLeft + 2 layar] (R11), dijepit ke rentang.
  function windowDays(range, px, scrollLeft, viewW) {
    const sl = isFin(scrollLeft) ? scrollLeft : 0;
    const vw = isFin(viewW) && viewW > 0 ? viewW : 0;
    const left = sl - vw;
    const right = sl + 2 * vw;
    return {
      fromDn: Math.max(range.from, Math.min(range.to, dnAt(left, range, px))),
      toDn: Math.max(range.from, Math.min(range.to, dnAt(right, range, px))),
    };
  }

  // scrollLeft awal: hari ini di 1/3 lebar grafik, dijepit ke [0, lebar − viewW].
  function initialScrollLeft(range, px, today, viewW) {
    const t = typeof today === "string" ? CAL.dn(today) : today;
    const maxScroll = Math.max(0, widthOf(range, px) - viewW);
    if (!isFin(t)) return 0;
    const want = xOf(t, range, px) - viewW / 3;
    return Math.round(Math.min(maxScroll, Math.max(0, want)));
  }

  // ---------------------------------------------------------------- header (R22)
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (n) => {
    const s = CAL.iso(n);
    return { y: +s.slice(0, 4), m: +s.slice(5, 7), d: +s.slice(8, 10) };
  };
  const monthStart = (y, m) => CAL.dn(String(y).padStart(4, "0") + "-" + pad2(m) + "-01");
  const nextMonth = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);

  // Sel dijepit ke [fromDn, toDn]: dn = awal terlihat, days = lebar terlihat; key memakai awal sel sebenarnya.
  function clip(key, start, endExcl, fromDn, toDn, label, sub) {
    const dn = Math.max(start, fromDn);
    const last = Math.min(endExcl - 1, toDn);
    return { key, dn, days: last - dn + 1, label, sub: sub === undefined ? null : sub };
  }

  function monthCells(fromDn, toDn, labelOf) {
    const out = [];
    let { y, m } = ymd(fromDn);
    for (let guard = 0; guard < 5000; guard++) {
      const s = monthStart(y, m);
      if (s > toDn) break;
      const [ny, nm] = nextMonth(y, m);
      const e = monthStart(ny, nm);
      const l = labelOf(y, m);
      out.push(clip("m" + y + "-" + pad2(m), s, e, fromDn, toDn, l.label, l.sub));
      y = ny;
      m = nm;
    }
    return out;
  }

  // zoom "day"   : atas = bulan "Nov 2026", bawah = tanggal {label "5", sub "Kam"}
  // zoom "week"  : atas = bulan "Nov 2026", bawah = minggu ISO "Mg 45" (awal Senin)
  // zoom "month" : atas = kuartal {label "K4", sub "2026"}, bawah = bulan "Nov"
  // Setiap sel {key, dn, days, label, sub}. Rentang masukan inklusif; kosong bila fromDn > toDn atau tak sah.
  function headerTicks(zoom, fromDn, toDn) {
    const top = [];
    const bottom = [];
    if (!isInt(fromDn) || !isInt(toDn) || fromDn > toDn) return { top, bottom };
    if (zoom === "month") {
      let { y, m } = ymd(fromDn);
      let q = Math.floor((m - 1) / 3);
      for (let guard = 0; guard < 2000; guard++) {
        const s = monthStart(y, q * 3 + 1);
        if (s > toDn) break;
        const ny = q === 3 ? y + 1 : y;
        const nq = q === 3 ? 0 : q + 1;
        top.push(clip("q" + y + "-" + (q + 1), s, monthStart(ny, nq * 3 + 1), fromDn, toDn, "K" + (q + 1), String(y)));
        y = ny;
        q = nq;
      }
      bottom.push(...monthCells(fromDn, toDn, (yy, mm) => ({ label: BULAN_SHORT[mm - 1], sub: null })));
      return { top, bottom };
    }
    top.push(...monthCells(fromDn, toDn, (yy, mm) => ({ label: BULAN_SHORT[mm - 1] + " " + yy, sub: null })));
    if (zoom === "day") {
      for (let d = fromDn; d <= toDn; d++) bottom.push({ key: "d" + d, dn: d, days: 1, label: String(ymd(d).d), sub: HARI_SHORT[CAL.isoWeekday(d) - 1] });
    } else {
      for (let s = fromDn - (CAL.isoWeekday(fromDn) - 1); s <= toDn; s += 7) {
        bottom.push(clip("w" + s, s, s + 7, fromDn, toDn, "Mg " + CAL.isoWeek(s).week, null));
      }
    }
    return { top, bottom };
  }

  // ---------------------------------------------------------------- arsir (R11)
  // repeating-linear-gradient periode 7 × px dari mask hari kerja + weekday hari pertama rentang; hanya token tema.
  function weekendGradient(c, range, px) {
    const p = px > 0 ? px : PX[DEFAULT_ZOOM];
    const w0 = CAL.isoWeekday(range.from);
    const colors = [];
    for (let i = 0; i < 7; i++) colors.push(c.mask.has(((w0 - 1 + i) % 7) + 1) ? "transparent" : "var(--bg-subtle)");
    const stops = [];
    let start = 0;
    for (let i = 1; i <= 7; i++) {
      if (i === 7 || colors[i] !== colors[start]) {
        stops.push(colors[start] + " " + start * p + "px", colors[start] + " " + i * p + "px");
        start = i;
      }
    }
    return "repeating-linear-gradient(to right, " + stops.join(", ") + ")";
  }

  // Nama libur kustom dari kunci kalender terkompilasi (JSON ternormalisasi), di-cache per kunci terakhir.
  let namesKey = null;
  let namesMap = null;
  function customNames(c) {
    if (namesKey === c.key && namesMap) return namesMap;
    const map = new Map();
    try {
      const cal = JSON.parse(c.key);
      for (const e of cal && Array.isArray(cal.off) ? cal.off : []) map.set(CAL.dn(e.d), e.n || "Libur");
    } catch (e) {
      /* kunci tak terbaca: tanpa nama kustom */
    }
    namesKey = c.key;
    namesMap = map;
    return map;
  }

  // Hari libur (off, bukan diganti hari kerja pengganti) di [fromDn, toDn]: [{dn, name, weekend}];
  // weekend = hari itu memang bukan hari kerja menurut pola minggu (tetap dilaporkan).
  function holidaySpans(c, fromDn, toDn, holidays) {
    const out = [];
    if (!c || !isInt(fromDn) || !isInt(toDn) || fromDn > toDn) return out;
    const names = customNames(c);
    const H = holidays || HOL;
    for (let d = fromDn; d <= toDn; d++) {
      if (!c.off.has(d) || c.work.has(d)) continue;
      let name = names.get(d);
      if (name === undefined && H && typeof H.lookup === "function") {
        const hit = H.lookup(CAL.iso(d));
        if (hit && ((hit.kind === "libur" && c.national) || (hit.kind === "cuti" && c.cutiBersama))) name = hit.nama;
      }
      out.push({ dn: d, name: name || "Libur", weekend: !c.mask.has(CAL.isoWeekday(d)) });
    }
    return out;
  }

  // ---------------------------------------------------------------- panah (R11, R16)
  const fmt = (n) => String(Math.round(n * 100) / 100);

  // Sisi panah per tipe dependensi (R19): [keluar dari AWAL pendahulu?, masuk ke UJUNG penerus?].
  // FS ujung→awal (1b), SS awal→awal, FF ujung→ujung, SF awal→ujung. Tipe tak dikenal = FS.
  const ARROW_SIDES = Object.freeze({ FS: [false, false], SS: [true, false], FF: [false, true], SF: [true, true] });

  // Rect = {x, y, w, h}. Hanya H/V. Keluar 6 px dari sisi pendahulu (ujung → ke kanan, awal → ke kiri); lari masuk
  // terakhir ≥ 6 px menuju sisi penerus (awal: dari kiri, bergerak ke kanan; ujung: dari kanan, bergerak ke kiri).
  // Arah keluar ≠ arah masuk (SS, FF): satu garis tegak di x terjauh yang memenuhi keduanya (M H V H) — selalu bisa.
  // Arah sama (FS, SF): M H V H bila penerus cukup jauh ke arah itu (FS: ≥ 12 px di kanan ujung pendahulu); selain itu
  // memutar lewat celah antarbaris (M H V H V H). Baris sama: lewat tepat di bawah bar. FS = path 1b persis.
  function arrowPath(fromRect, toRect, type) {
    const sides = ARROW_SIDES[type] || ARROW_SIDES.FS;
    const dOut = sides[0] ? -1 : 1; // arah lari keluar
    const dIn = sides[1] ? -1 : 1; // arah lari masuk terakhir
    const x1 = sides[0] ? fromRect.x : fromRect.x + fromRect.w;
    const y1 = fromRect.y + fromRect.h / 2;
    const x2 = sides[1] ? toRect.x + toRect.w : toRect.x;
    const y2 = toRect.y + toRect.h / 2;
    const xo = x1 + dOut * ARROW_OUT;
    const xi = x2 - dIn * ARROW_IN;
    if (dOut !== dIn && y1 !== y2) {
      const xv = dOut > 0 ? Math.max(xo, xi) : Math.min(xo, xi);
      return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xv) + "V" + fmt(y2) + "H" + fmt(x2);
    }
    if (dOut === dIn && (xi - xo) * dOut >= 0) return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xo) + "V" + fmt(y2) + "H" + fmt(x2);
    let yt;
    if (y2 > y1) yt = (fromRect.y + fromRect.h + toRect.y) / 2;
    else if (y2 < y1) yt = (toRect.y + toRect.h + fromRect.y) / 2;
    else yt = fromRect.y + fromRect.h + 2; // baris sama: lewat tepat di bawah bar
    return "M" + fmt(x1) + " " + fmt(y1) + "H" + fmt(xo) + "V" + fmt(yt) + "H" + fmt(xi) + "V" + fmt(y2) + "H" + fmt(x2);
  }

  // ---------------------------------------------------------------- aksesibilitas (R23)
  // progress: 0–100 atau null/undefined (dihilangkan). sched.duration = durasi hari kerja (untuk ringkasan: row.duration).
  function ariaBar(task, sched, span, progress, kind) {
    const raw = task && task.title !== undefined && task.title !== null ? String(task.title).trim() : "";
    const title = raw || "Tanpa judul";
    if (!span) return title + ", belum dijadwalkan";
    if (kind !== "summary" && sched && sched.duration === 0) return title + ", milestone " + CAL.fmtShort(span.s);
    let out = title + ", " + CAL.fmtShort(span.s) + " sampai " + CAL.fmtShort(span.f);
    if (sched && isInt(sched.duration)) out += ", " + sched.duration + " hari kerja";
    if (isFin(progress)) out += ", " + Math.round(Math.min(100, Math.max(0, progress))) + "%";
    return out;
  }

  // ---------------------------------------------------------------- baris (R9, R10, R16, R21)
  function defaultRead(task) {
    const out = {};
    const ext = task && task.ext;
    if (ext && typeof ext === "object") for (const k of Object.keys(ext)) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = ext[k];
    return SCHED.readSched(out);
  }

  const keyOfTask = (t) => (t.id !== undefined && t.id !== null && t.id !== "" ? String(t.id) : t.cid !== undefined && t.cid !== null && t.cid !== "" ? String(t.cid) : null);

  function cmpId(a, b) {
    const na = typeof a === "number";
    const nb = typeof b === "number";
    if (na && nb) return a - b;
    if (na !== nb) return na ? -1 : 1;
    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  // Urut bawaan saudara: created_at lalu id (stabil).
  function cmpDefault(a, b) {
    const ca = String(a.task.created_at || "");
    const cb = String(b.task.created_at || "");
    if (ca !== cb) return ca < cb ? -1 : 1;
    return cmpId(a.task.id !== undefined ? a.task.id : a.task.cid, b.task.id !== undefined ? b.task.id : b.task.cid);
  }

  const cmpStart = (a, b) => {
    const as = a.span ? a.span.s : null;
    const bs = b.span ? b.span.s : null;
    if (as !== bs) {
      if (as === null) return 1;
      if (bs === null) return -1;
      return as - bs;
    }
    return a.ord - b.ord;
  };

  function toDn(v) {
    if (typeof v === "string") return CAL.dn(v.slice(0, 10));
    return isInt(v) ? v : NaN;
  }

  const trimName = (t) => (typeof t.project === "string" ? t.project.trim() : ""); // hanya untuk nama tampilan
  // Kunci nama = SCHED.projectFold (lipatan host projectNameFold, tanpa trim); nama kosong/hanya spasi = tanpa project.
  const nameKey = (t) => (trimName(t) ? SCHED.projectFold(t.project) : "");

  // Kelompok workspace: project_id, fallback nama project (lipatan host); nama yang cocok dengan kelompok ber-id ikut kelompok itu.
  function groupKeyer(items) {
    const nameToId = new Map(); // lipatan nama → project_id
    for (const it of items) {
      const nm = nameKey(it.task);
      if (it.task.project_id != null && nm && !nameToId.has(nm)) nameToId.set(nm, it.task.project_id);
    }
    return (t) => {
      const nm = nameKey(t);
      if (t.project_id != null) return "p:" + t.project_id;
      if (nm) return nameToId.has(nm) ? "p:" + nameToId.get(nm) : "n:" + nm;
      return "none";
    };
  }

  // Kalender terkompilasi dikenali lewat bentuknya (bukan instanceof Set).
  function isCompiled(c) {
    return !!c && typeof c.key === "string" && !!c.mask && typeof c.mask.has === "function" && !!c.off && typeof c.off.has === "function" && !!c.work && typeof c.work.has === "function";
  }

  function layout(args) {
    const a = args || {};
    const c = isCompiled(a.cal) ? a.cal : CAL.compile(a.cal || CAL.DEFAULT_CAL); // sekali per layout
    const todayDn = toDn(a.today);
    const zoom = PX[a.zoom] ? a.zoom : DEFAULT_ZOOM;
    const px = PX[zoom];
    const workspace = a.pageKind === "workspace";
    const sortStart = a.sort === "start";
    const w0 = isInt(todayDn) ? todayDn - RANGE_SPAN : -Infinity; // jendela rentang
    const w1 = isInt(todayDn) ? todayDn + RANGE_SPAN : Infinity;
    const clampW = (d) => Math.min(w1, Math.max(w0, d));
    const readOf = typeof a.readSchedOf === "function" ? a.readSchedOf : defaultRead;

    // 1. dibuang: berulang, archived, deleted; duplikat kunci → yang pertama.
    const items = [];
    const byKey = new Set();
    for (const t of Array.isArray(a.tasks) ? a.tasks : []) {
      if (!t || typeof t !== "object") continue;
      if (t.recurrence_type || t.gtd_status === "archived" || t.deleted) continue;
      const key = keyOfTask(t);
      if (key === null || byKey.has(key)) continue;
      byKey.add(key);
      items.push({ key, task: t, sched: readOf(t), children: [], parent: null, group: null, depth: 0, wbs: "", ord: 0, span: null });
    }
    items.sort(cmpDefault);
    const tasksOnly = items.map((it) => it.task);
    const index = SCHED.buildIndex(tasksOnly);
    const itemOf = new Map(items.map((it) => [it.task, it]));

    // 2. hierarki (R9): induk di scope → anak mengikuti; selain itu akar. Lingkaran induk diputus deterministik.
    for (const it of items) {
      const p = it.task.parent_id !== undefined && it.task.parent_id !== null ? it.task.parent_id : it.task.parent_cid;
      if (p === undefined || p === null || p === "") continue;
      const found = index.get(String(p));
      const pi = found ? itemOf.get(found) : null;
      if (pi && pi !== it) it.parent = pi;
    }
    const color = new Map();
    for (const it of items) {
      if (color.get(it)) continue;
      const path = [];
      let cur = it;
      while (cur && !color.get(cur)) {
        color.set(cur, 1);
        path.push(cur);
        if (cur.parent && color.get(cur.parent) === 1) {
          cur.parent = null; // lingkaran: putus di sini
          break;
        }
        cur = cur.parent;
      }
      for (const n of path) color.set(n, 2);
    }
    for (const it of items) if (it.parent) it.parent.children.push(it); // items sudah urut bawaan → anak urut bawaan

    // 3. kelompok + WBS + kedalaman (urut bawaan), pra-urut iteratif.
    const keyer = workspace ? groupKeyer(items) : () => "all";
    const groupMap = new Map(); // key → {key, name, n, roots, ...}
    for (const it of items) {
      if (it.parent) continue;
      const gk = keyer(it.task);
      let g = groupMap.get(gk);
      if (!g) {
        g = { key: gk, name: null, n: 0, roots: [], taskCount: 0, rowCount: 0 };
        groupMap.set(gk, g);
      }
      g.roots.push(it);
    }
    let groups = [...groupMap.values()];
    if (workspace) {
      for (const g of groups) {
        if (g.key === "none") g.name = NO_PROJECT;
        else {
          const first = g.roots.find((r) => trimName(r.task)) || g.roots[0];
          const nm = trimName(first.task);
          g.name = nm || (g.key.indexOf("p:") === 0 ? "Project " + g.key.slice(2) : NO_PROJECT);
        }
      }
      groups.sort((x, y) => {
        if (x.key === "none" || y.key === "none") return x.key === "none" ? (y.key === "none" ? 0 : 1) : -1;
        return x.name.localeCompare(y.name, "id") || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
      });
    }
    groups.forEach((g, i) => (g.n = i + 1));

    let ord = 0;
    const all = []; // pra-urut bawaan: induk sebelum anak
    for (const g of groups) {
      const stack = [];
      for (let i = g.roots.length - 1; i >= 0; i--) {
        const r = g.roots[i];
        r.wbs = workspace ? g.n + "." + (i + 1) : String(i + 1);
        r.depth = 0;
        r.group = g.key;
        stack.push(r);
      }
      while (stack.length) {
        const it = stack.pop();
        it.ord = ord++;
        all.push(it);
        g.taskCount++;
        for (let i = it.children.length - 1; i >= 0; i--) {
          const ch = it.children[i];
          ch.wbs = it.wbs + "." + (i + 1);
          ch.depth = it.depth + 1;
          ch.group = it.group;
          stack.push(ch);
        }
      }
    }

    // 4. rentang hari: daun lewat spanOf; ringkasan = min–maks anak terjadwal (rekursif, dari belakang pra-urut).
    for (let i = all.length - 1; i >= 0; i--) {
      const it = all[i];
      if (it.children.length) {
        let s = Infinity;
        let f = -Infinity;
        for (const ch of it.children) {
          if (!ch.span) continue;
          if (ch.span.s < s) s = ch.span.s;
          if (ch.span.f > f) f = ch.span.f;
        }
        it.span = s === Infinity ? null : { s, f };
      } else it.span = SCHED.spanOf(c, it.sched);
    }

    // 5. urut tampilan "Mulai": saudara diurut mulai naik (tanpa jadwal terakhir); WBS tidak berubah.
    if (sortStart) {
      for (const g of groups) g.roots.sort(cmpStart);
      for (const it of all) if (it.children.length > 1) it.children.sort(cmpStart);
    }

    // 6. baris tampilan
    const rows = [];
    const rowOf = new Map();
    for (const g of groups) {
      if (workspace) {
        rows.push({ key: "g:" + g.key, task: null, group: g.key, depth: 0, wbs: String(g.n), kind: "group", span: null, sched: null, late: 0, violation: false, duration: null, progress: null, done: false, deadlineDn: null, childCount: 0, parentKey: null, outOfRange: false, index: rows.length });
      }
      const stack = [];
      for (let i = g.roots.length - 1; i >= 0; i--) stack.push(g.roots[i]);
      while (stack.length) {
        const it = stack.pop();
        const t = it.task;
        const summary = it.children.length > 0;
        const done = t.gtd_status === "done" || !!t.completed_at;
        const pr = Number(t.progress);
        const deadlineDn = t.deadline === undefined || t.deadline === null ? NaN : CAL.dn(String(t.deadline).slice(0, 10));
        const lateN = it.span ? SCHED.deadlineLate(c, it.span.f, t.deadline) : null;
        const row = {
          key: it.key,
          task: t,
          group: g.key,
          depth: it.depth,
          wbs: it.wbs,
          kind: summary ? "summary" : "task",
          span: it.span,
          sched: it.sched,
          late: lateN > 0 ? lateN : 0,
          violation: false,
          duration: summary ? (it.span ? CAL.workdays(c, it.span.s, Math.min(it.span.f, it.span.s + MAX_WD_SPAN)) : null) : it.sched.duration,
          progress: done ? 100 : Number.isFinite(pr) ? Math.min(100, Math.max(0, pr)) : 0,
          done,
          deadlineDn: Number.isInteger(deadlineDn) ? deadlineDn : null,
          childCount: it.children.length,
          parentKey: it.parent ? it.parent.key : null,
          outOfRange: !!it.span && (it.span.f < w0 || it.span.s > w1),
          index: rows.length,
        };
        rows.push(row);
        rowOf.set(it.key, row);
        g.rowCount++;
        for (let i = it.children.length - 1; i >= 0; i--) stack.push(it.children[i]);
      }
    }

    // 7. dependensi (R8, R16): kunci kanonik String(id); spans memuat rentang ringkasan.
    // Task DONE (bukan ringkasan): mulai/selesai pelanggaran = actual.start ?? Mulai dan TLSched.doneFinish (aturan yang SAMA
    // dengan jangkar "done" mesin, termasuk tanggal aktual 1c-2 —
    // selesai lebih awal tidak menandai ⚠ pada tanggal yang baru ditulis mesin); durasi d dibawa agar penerus done tetap
    // memakai durasi tersimpannya. Rentang bar (row.span) tidak berubah.
    const spans = new Map();
    for (const it of all) {
      if (!it.span) continue;
      const t = it.task;
      if (it.children.length === 0 && (t.gtd_status === "done" || !!t.completed_at)) {
        const d = it.sched.duration === null || it.sched.duration === undefined ? 1 : it.sched.duration;
        // mulai = actual.start ?? rentang (sama dengan es jangkar mesin); aktual dari it.sched (bacaan ext yang sama).
        const a0 = SCHED.actualOf(t, it.sched).start;
        const s = a0 !== null ? a0 : it.span.s;
        const f = SCHED.doneFinish(c, t, it.sched, s, d);
        spans.set(it.key, isInt(f) ? { s, f, d } : it.span);
      } else spans.set(it.key, it.span);
    }
    const edges = SCHED.resolveDeps(items.map((it) => ({ key: it.key, sched: it.sched })), index);
    const viol = SCHED.violations(c, spans, edges);
    const violPair = new Set(viol.detail.map((d) => d.pred + "\u0000" + d.succ));
    for (const e of edges) {
      const fr = rowOf.get(e.from);
      const tr = rowOf.get(e.to);
      e.fromRow = fr ? fr.index : null;
      e.toRow = tr ? tr.index : null;
      e.violation = violPair.has(e.from + "\u0000" + e.to);
      e.drawn = e.ok && !!(fr && tr && fr.span && tr.span && !fr.outOfRange && !tr.outOfRange);
    }
    for (const k of viol) {
      const r = rowOf.get(k);
      if (r) r.violation = true;
    }

    // 8. rentang tampak (R22): [min(mulai) − 14, maks(selesai, tenggat) + 30] ∪ [hari ini ± 60]
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      if (r.span) {
        const cs = clampW(r.span.s);
        const cf = clampW(r.span.f);
        if (cs < lo) lo = cs;
        if (cf > hi) hi = cf;
      }
      if (r.deadlineDn !== null) {
        const cd = clampW(r.deadlineDn);
        if (cd > hi) hi = cd;
      }
    }
    let from = lo === Infinity ? Infinity : lo - PAD_BEFORE;
    let to = hi === -Infinity ? -Infinity : hi + PAD_AFTER;
    if (isInt(todayDn)) {
      from = Math.min(from, todayDn - TODAY_PAD);
      to = Math.max(to, todayDn + TODAY_PAD);
    }
    if (from === Infinity || to === -Infinity) {
      from = 0;
      to = 2 * TODAY_PAD;
    } else if (to < from) to = from;
    const range = { from, to };

    // 9. statistik
    let summaries = 0;
    let scheduled = 0;
    let unscheduled = 0;
    let nViol = 0;
    let nLate = 0;
    let nOut = 0;
    for (const r of rows) {
      if (r.kind === "group") continue;
      if (r.outOfRange) nOut++;
      if (r.kind === "summary") summaries++;
      if (r.span) scheduled++;
      else unscheduled++;
      if (r.violation) nViol++;
      if (r.late > 0) nLate++;
    }

    return {
      cal: c,
      groups: groups.map((g) => ({ key: g.key, name: g.name, n: g.n, taskCount: g.taskCount, rowCount: g.rowCount })),
      rows,
      edges,
      range,
      px,
      zoom,
      missingYears: CAL.missingYears(c, range.from, range.to),
      stats: { rows: rows.length, tasks: items.length, summaries, scheduled, unscheduled, violations: nViol, late: nLate, outOfRange: nOut, groups: groups.length, edges: edges.length },
    };
  }

  // Nomor WBS per kunci task (1c-1 R20): sama dengan tata letak (urut bawaan; urut tampilan tidak mengubah WBS),
  // tanpa baris kelompok. Kalender bawaan: WBS tidak bergantung pada kalender.
  function wbsMap(tasks, pageKind, readSchedOf) {
    const res = layout({ tasks, pageKind, readSchedOf, sort: "wbs" });
    const out = new Map();
    for (const r of res.rows) if (r.kind !== "group") out.set(r.key, r.wbs);
    return out;
  }

  return Object.freeze({
    PX,
    ROW_H,
    ROW_H_TOUCH,
    layout,
    windowRows,
    windowDays,
    xOf,
    dnAt,
    widthOf,
    barBox,
    headerTicks,
    weekendGradient,
    holidaySpans,
    arrowPath,
    wbsMap,
    ariaBar,
    initialScrollLeft,
  });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLLayout;
