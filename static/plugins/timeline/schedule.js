// Plugin Timeline — TLSched: baca/validasi ext jadwal task, dependensi FS/SS/FF/SF, mode, batasan, unit jadwal,
// siklus, pelanggaran, tenggat (spec 1b §8.2/§8.7, rencana 1b R2, R3, R7, R8, R15, R16; spec 1c §4–§5, rencana 1c-1 R3–R5).
// Murni: tanpa Date lokal, tanpa global, tanpa akses api.
// Semua nilai yang diteruskan ke TLCal dijamin integer / bilangan hari sah (TLCal tidak menjaga NaN).
// Fungsi yang memanggil TLCal.finish/addWork/nextWork/fsEarliest menangkap Error("TL_CAL_LOOP") dan menurun
// (hasil "tidak terhitung": tanpa selesai → tanpa pelanggaran/keterlambatan), tidak melempar.
const TLSched = (function (CAL) {
  const MAX_DEPS = 20;
  const DUR_MAX = 999;
  const LAG_MIN = -99;
  const LAG_MAX = 999;
  const MAX_LATE_SPAN = 3660; // hari kalender maks yang dihitung deadlineLate
  const TYPES = Object.freeze(["FS", "SS", "FF", "SF"]);
  const CONSTRAINT_TYPES = Object.freeze(["SNET", "MFO"]);
  const MODES = ["auto", "manual"];
  const YEAR_MIN = 1970;
  const YEAR_MAX = 2199;

  const isInt = (n) => typeof n === "number" && Number.isInteger(n);
  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);

  // Jalankan fn; TL_CAL_LOOP → undefined (turun), kesalahan lain dilempar ulang.
  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return undefined;
      throw e;
    }
  }

  // ---- referensi $task (R8) ----
  function refKey(ref) {
    if (!isObj(ref)) return null;
    const t = ref.$task;
    if (isInt(t)) return String(t);
    if (typeof t === "string" && t.length > 0) return t;
    return null;
  }

  // ---- baca ext (R7) ----
  function readDep(raw) {
    if (!isObj(raw)) return null;
    const key = refKey(raw.t);
    if (key === null) return null;
    // type tidak ada = FS (bentuk 1b); tipe di luar TYPES → tidak sah (dihitung invalidDeps oleh pemanggil)
    const type = raw.type === undefined ? "FS" : raw.type;
    if (TYPES.indexOf(type) < 0) return null;
    const lag = raw.lag === undefined ? 0 : raw.lag;
    if (!isInt(lag) || lag < LAG_MIN || lag > LAG_MAX) return null;
    return { key, ref: { $task: raw.t.$task }, type, lag };
  }

  // Tanggal batasan: ISO sah dengan tahun 1970–2199 (R3).
  function isConstraintDate(s) {
    if (typeof s !== "string" || !CAL.isIso(s)) return false;
    const y = +s.slice(0, 4);
    return y >= YEAR_MIN && y <= YEAR_MAX;
  }

  // {type: SNET|MFO, date} bersih, atau null (rusak → ASAP).
  function readConstraint(v) {
    if (!isObj(v) || CONSTRAINT_TYPES.indexOf(v.type) < 0 || !isConstraintDate(v.date)) return null;
    return { type: v.type, date: v.date };
  }

  // Masukan = hasil api.taskExt.read (kunci tanpa prefiks: start, duration, deps, mode, constraint).
  function readSched(extObj) {
    const src = isObj(extObj) ? extObj : {};
    const start = typeof src.start === "string" && CAL.isIso(src.start) ? src.start : null;
    let duration = null;
    if (start !== null) duration = isInt(src.duration) && src.duration >= 0 && src.duration <= DUR_MAX ? src.duration : 1;
    const deps = [];
    let invalidDeps = 0;
    if (src.deps !== undefined && src.deps !== null) {
      if (!Array.isArray(src.deps)) invalidDeps = 1;
      else {
        const seen = new Set();
        for (const raw of src.deps) {
          const d = readDep(raw);
          if (!d || seen.has(d.key)) {
            invalidDeps++;
            continue;
          }
          if (deps.length >= MAX_DEPS) break;
          seen.add(d.key);
          deps.push(d);
        }
      }
    }
    const mode = MODES.indexOf(src.mode) >= 0 ? src.mode : null;
    const constraint = readConstraint(src.constraint);
    return { start, duration, deps, invalidDeps, mode, constraint };
  }

  // ---- tulis ext: validasi + jepit (R7) ----
  function clampInt(n, lo, hi) {
    return Math.min(hi, Math.max(lo, Math.round(n)));
  }

  function sanitizeDeps(list) {
    if (!Array.isArray(list)) return { ok: false, reason: "deps" };
    if (list.length > MAX_DEPS) return { ok: false, reason: "max" };
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      if (!isObj(raw)) return { ok: false, reason: "dep" };
      const t = raw.t !== undefined ? raw.t : raw.ref; // bentuk ext atau bentuk hasil readSched
      const key = refKey(t);
      if (key === null || seen.has(key)) return { ok: false, reason: "dep" };
      const type = raw.type === undefined ? "FS" : raw.type;
      if (TYPES.indexOf(type) < 0) return { ok: false, reason: "dep" };
      let lag = raw.lag === undefined ? 0 : raw.lag;
      if (typeof lag !== "number" || !Number.isFinite(lag)) return { ok: false, reason: "dep" };
      lag = clampInt(lag, LAG_MIN, LAG_MAX);
      seen.add(key);
      out.push({ t: { $task: t.$task }, type, lag });
    }
    return { ok: true, deps: out };
  }

  function sanitizePatch(p) {
    if (!isObj(p)) return { ok: false, reason: "patch" };
    const keys = Object.keys(p);
    if (!keys.length) return { ok: false, reason: "empty" };
    const patch = {};
    for (const k of keys) {
      const v = p[k];
      if (k === "start") {
        if (v !== null && !(typeof v === "string" && CAL.isIso(v))) return { ok: false, reason: "start" };
        patch.start = v;
      } else if (k === "duration") {
        if (v === null) patch.duration = null;
        else if (typeof v === "number" && Number.isFinite(v)) patch.duration = clampInt(v, 0, DUR_MAX);
        else return { ok: false, reason: "duration" };
      } else if (k === "deps") {
        if (v === null) {
          patch.deps = null; // hapus kunci (Urungkan menulis null untuk kunci yang dulu tidak ada)
          continue;
        }
        const r = sanitizeDeps(v);
        if (!r.ok) return r;
        patch.deps = r.deps;
      } else if (k === "mode") {
        // null = hapus kunci (ikut unit); pemanggil menulis null bila pilihan sama dengan unit (TLPlan.modePatch)
        if (v !== null && MODES.indexOf(v) < 0) return { ok: false, reason: "mode" };
        patch.mode = v;
      } else if (k === "constraint") {
        if (v === null) patch.constraint = null;
        else {
          const cst = readConstraint(v);
          if (!cst) return { ok: false, reason: "constraint" };
          patch.constraint = cst;
        }
      } else return { ok: false, reason: "key" }; // termasuk "actual" (1c-2)
    }
    return { ok: true, patch };
  }

  // ---- indeks task (R8) ----
  // String(id) menang; cid dan server_id hanya mengisi kunci yang belum dipakai id task mana pun.
  function buildIndex(tasks) {
    const idx = new Map();
    const list = Array.isArray(tasks) ? tasks.filter((t) => t && typeof t === "object") : [];
    for (const t of list) if (t.id !== undefined && t.id !== null && !idx.has(String(t.id))) idx.set(String(t.id), t);
    for (const t of list) {
      for (const alt of [t.cid, t.server_id]) {
        if (alt === undefined || alt === null || alt === "") continue;
        if (!idx.has(String(alt))) idx.set(String(alt), t);
      }
    }
    return idx;
  }

  // Kalender yang dipakai (R4) — SATU pembantu id kalender untuk view, seksi, dan scope dependensi.
  // list_id sah → kalender workspace `cal@list:<id>` (scope "list:<id>", dibagi semua anggota); kosong/0/id tak sah
  // (bukan [A-Za-z0-9_-]{1,40}, mis. data rusak) → kalender pribadi `cal@user` (scope "user").
  const LIST_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  function calTarget(listId) {
    const s = listId === undefined || listId === null ? "" : String(listId).trim();
    if (!s || s === "0" || !LIST_ID_RE.test(s)) return { id: "cal@user", scope: "user" };
    return { id: "cal@list:" + s, scope: "list:" + s };
  }

  function calKeyOf(task) {
    return calTarget(task && typeof task === "object" ? task.list_id : null);
  }

  // Lipatan nama project = host `projectNameFold` (index.html): hanya A–Z ASCII ke huruf kecil, tanpa trim — sama dengan
  // SQLite NOCASE. "Proyek " ≠ "Proyek", "É" ≠ "é", "A" = "a".
  function projectFold(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[A-Z]/g, (c) => c.toLowerCase());
  }

  // Kunci scope dependensi (R15): workspace sama (`l:<id>`), atau pribadi dengan nama project sama menurut projectFold
  // (`p:<lipatan>`; keduanya tanpa project juga sama).
  function scopeKeyOf(t) {
    const cal = calKeyOf(t);
    if (cal.scope !== "user") return "l:" + cal.scope.slice(5);
    return "p:" + projectFold(t && typeof t === "object" ? t.project : null);
  }

  // ---- unit jadwal (R5) ----
  // FNV-1a 32 bit atas unit kode UTF-16 → 8 hex huruf kecil.
  function fnv1a32(str) {
    const s = String(str === undefined || str === null ? "" : str);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  // x = task ({list_id, project}) atau halaman ({pageKind, listId, projectName}). SATU-SATUNYA pembuat id record
  // `project`: workspace → "prj@list:<lid>:<h|->" (scope "list:<lid>"); pribadi → "prj@user:<h|->" (scope "user").
  // <h> = fnv1a32(projectFold(nama)); nama kosong → "-". lid divalidasi calTarget → id selalu cocok pola README.
  function unitOf(x) {
    const o = isObj(x) ? x : {};
    const page = o.pageKind !== undefined || o.listId !== undefined || o.projectName !== undefined;
    const lid = page ? o.listId : o.list_id;
    const raw = page ? o.projectName : o.project;
    const name = raw === undefined || raw === null ? "" : String(raw);
    const fold = projectFold(name);
    const tail = fold ? fnv1a32(fold) : "-";
    const cal = calTarget(lid);
    if (cal.scope === "user") {
      const recId = "prj@user:" + tail;
      return { key: recId, recId, scope: "user", name, fold };
    }
    const recId = "prj@" + cal.scope + ":" + tail;
    return { key: recId, recId, scope: cal.scope, name, fold };
  }

  // Mode efektif: ext.mode (raw ext atau hasil readSched) menang; selain itu unit (Map<recId, {auto}>) → auto/manual.
  function modeOf(raw, units, task) {
    const m = isObj(raw) ? raw.mode : undefined;
    if (MODES.indexOf(m) >= 0) return m;
    const u = units instanceof Map ? units.get(unitOf(task).recId) : null;
    return u && u.auto === true ? "auto" : "manual";
  }

  // ---- rentang hari ----
  function spanOf(c, sched) {
    if (!sched || typeof sched !== "object" || typeof sched.start !== "string") return null;
    const s = CAL.dn(sched.start);
    if (!Number.isInteger(s)) return null;
    const dur = sched.duration === null || sched.duration === undefined ? 1 : sched.duration;
    if (!isInt(dur) || dur < 0 || dur > DUR_MAX) return null;
    const f = safe(() => CAL.finish(c, s, dur));
    if (!Number.isInteger(f)) return null;
    return { s, f };
  }

  // ---- dependensi ----
  const rowKey = (row) => {
    if (row && row.key !== undefined && row.key !== null) return String(row.key);
    if (row && row.task && row.task.id !== undefined && row.task.id !== null) return String(row.task.id);
    return null;
  };

  // rows: [{key | task, sched}] (sched = hasil readSched). from = pendahulu, to = penerus (kunci = String(id)).
  // Ref yang tidak ada di indeks → ok false dengan from = kunci mentah ref.
  function resolveDeps(rows, index) {
    const out = [];
    const seen = new Set(); // satu edge per (pendahulu kanonik, penerus): cid dan id angka task yang sama tidak ganda
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      const to = rowKey(row);
      if (to === null || !row.sched || !Array.isArray(row.sched.deps)) continue;
      for (const d of row.sched.deps) {
        const pred = index && typeof index.get === "function" ? index.get(d.key) : undefined;
        const found = !!(pred && pred.id !== undefined && pred.id !== null);
        const from = found ? String(pred.id) : d.key;
        const pair = from + "\u0000" + to;
        if (seen.has(pair)) continue;
        seen.add(pair);
        out.push({ from, to, type: TYPES.indexOf(d.type) >= 0 ? d.type : "FS", lag: d.lag, ok: found });
      }
    }
    return out;
  }

  // Apakah menambah edge from→to membuat lingkaran? (DFS dari `to` mencari `from`.)
  function wouldCycle(edges, from, to) {
    if (from === to) return true;
    const adj = new Map();
    for (const e of Array.isArray(edges) ? edges : []) {
      if (!e || e.ok === false) continue;
      let a = adj.get(e.from);
      if (!a) adj.set(e.from, (a = []));
      a.push(e.to);
    }
    const seen = new Set([to]);
    const stack = [to];
    while (stack.length) {
      const n = stack.pop();
      const next = adj.get(n);
      if (!next) continue;
      for (const m of next) {
        if (m === from) return true;
        if (!seen.has(m)) {
          seen.add(m);
          stack.push(m);
        }
      }
    }
    return false;
  }

  const idOf = (t) => (t && typeof t === "object" && t.id !== undefined && t.id !== null ? String(t.id) : null);

  // Kunci task yang punya anak di scopeTasks (parent_id server atau parent_cid offline).
  function summaryKeys(scopeTasks) {
    const idx = buildIndex(scopeTasks);
    const out = new Set();
    for (const t of scopeTasks) {
      if (!t || typeof t !== "object") continue;
      const p = t.parent_id !== undefined && t.parent_id !== null ? t.parent_id : t.parent_cid;
      if (p === undefined || p === null || p === "") continue;
      const parent = idx.get(String(p));
      if (parent && idOf(parent) !== null) out.add(idOf(parent));
    }
    return out;
  }

  // R15. edges = hasil resolveDeps; scopeTasks opsional (tanpa itu: tanpa pemeriksaan ringkasan/keanggotaan halaman);
  // depCount opsional = jumlah dependensi penerus yang sudah tersimpan (termasuk yang tak terpecahkan).
  function canLink(args) {
    const a = args || {};
    let pk = idOf(a.pred);
    let sk = idOf(a.succ);
    if (pk === null || sk === null) return { ok: false, reason: "scope" };
    // Kanonikkan lewat indeks halaman: salinan basi (id masih cid) → String(id) terkini, agar dup/siklus/self cocok dengan edge.
    const idx = Array.isArray(a.scopeTasks) ? buildIndex(a.scopeTasks) : null;
    let inScope = true;
    if (idx) {
      const fp = idx.get(pk);
      const fs = idx.get(sk);
      inScope = !!(fp && fs);
      if (fp) pk = idOf(fp);
      if (fs) sk = idOf(fs);
    }
    if (pk === sk) return { ok: false, reason: "self" };
    // scope: workspace sama, atau pribadi dengan project sama (projectFold; keduanya tanpa project juga sama)
    if (scopeKeyOf(a.pred) !== scopeKeyOf(a.succ)) return { ok: false, reason: "scope" };
    if (idx) {
      if (!inScope) return { ok: false, reason: "scope" };
      const sums = summaryKeys(a.scopeTasks);
      if (sums.has(pk) || sums.has(sk)) return { ok: false, reason: "summary" };
    }
    const edges = Array.isArray(a.edges) ? a.edges : [];
    if (edges.some((e) => e && e.from === pk && e.to === sk)) return { ok: false, reason: "dup" };
    const count = Math.max(edges.filter((e) => e && e.to === sk).length, isInt(a.depCount) ? a.depCount : 0);
    if (count >= MAX_DEPS) return { ok: false, reason: "max" };
    if (wouldCycle(edges, pk, sk)) return { ok: false, reason: "cycle" };
    return { ok: true };
  }

  // ---- pelanggaran dan tenggat (R16) ----
  const lagOf = (l) => (isInt(l) && l >= LAG_MIN && l <= LAG_MAX ? l : 0);
  const spanAt = (spans, key) => {
    const sp = spans instanceof Map ? spans.get(key) : spans && typeof spans === "object" ? spans[key] : null;
    return sp && Number.isInteger(sp.s) && Number.isInteger(sp.f) ? sp : null;
  };

  // ---- rumus dependensi bersama (R4, spec 1c §5.3/§5.4) — satu sumber untuk mesin, penanda Manual, dan
  // "Geser ke setelah dependensi". Semua kalender lewat safe(): TL_CAL_LOOP / masukan tak sah → undefined.
  const isDn = (n) => Number.isInteger(n);
  const isDur = (d) => isInt(d) && d >= 0 && d <= DUR_MAX;
  const typeOf = (t) => (t === undefined || t === null ? "FS" : TYPES.indexOf(t) >= 0 ? t : null);

  // Selesai dari mulai: d = 0 → s; selain itu add(nw(s), d − 1).
  function fin(c, s, d) {
    if (!isDn(s) || !isDur(d)) return undefined;
    return safe(() => (d === 0 ? s : CAL.addWork(c, CAL.nextWork(c, s), d - 1)));
  }

  // Mulai dari selesai: d = 0 → f; selain itu add(pw(f), −(d − 1)).
  function sff(c, f, d) {
    if (!isDn(f) || !isDur(d)) return undefined;
    return safe(() => (d === 0 ? f : CAL.addWork(c, CAL.prevWork(c, f), -(d - 1))));
  }

  // ES terkecil penerus berdurasi d dari pendahulu (pES, pEF) lewat dependensi `type` dengan lag (§5.3).
  // Hasil belum dijepret nw untuk d ≥ 1 kecuali yang rumusnya sudah hari kerja (pemanggil: ES = nw(ES) bila d ≥ 1).
  function depReq(c, type, pES, pEF, lag, d) {
    const t = typeOf(type);
    if (t === null || !isDur(d)) return undefined;
    const L = lagOf(lag);
    if (t === "FS") return isDn(pEF) ? safe(() => CAL.addWork(c, CAL.nextWork(c, pEF + 1), L)) : undefined;
    if (t === "SS") return isDn(pES) ? safe(() => CAL.addWork(c, CAL.nextWork(c, pES), L)) : undefined;
    let e;
    if (t === "FF") {
      if (!isDn(pEF)) return undefined;
      e = safe(() => CAL.addWork(c, pEF, L));
    } else {
      if (!isDn(pES)) return undefined;
      e = safe(() => CAL.addWork(c, CAL.prevWork(c, pES - 1), L));
    }
    if (!isDn(e)) return undefined;
    if (d >= 1) e = safe(() => CAL.nextWork(c, e));
    return isDn(e) ? sff(c, e, d) : undefined;
  }

  // Batas LF pendahulu berdurasi dP dari penerus (sLS, sLF) lewat dependensi `type` dengan lag (§5.4).
  function depLimit(c, type, sLS, sLF, lag, dP) {
    const t = typeOf(type);
    if (t === null || !isDur(dP)) return undefined;
    const L = lagOf(lag);
    if (t === "FS" || t === "SS") {
      if (!isDn(sLS)) return undefined;
      const y = safe(() => CAL.addWork(c, sLS, -L));
      if (!isDn(y)) return undefined;
      if (t === "FS") return safe(() => CAL.prevWork(c, y - 1));
      const ls = safe(() => CAL.prevWork(c, y));
      return isDn(ls) ? fin(c, ls, dP) : undefined;
    }
    if (!isDn(sLF)) return undefined;
    const y = safe(() => CAL.addWork(c, sLF, -L));
    if (!isDn(y)) return undefined;
    if (t === "FF") return dP === 0 ? y : safe(() => CAL.prevWork(c, y)); // milestone pendahulu: tanpa pw
    const ls = safe(() => CAL.nextWork(c, y + 1));
    return isDn(ls) ? fin(c, ls, dP) : undefined;
  }

  // Durasi penerus dari rentang: sp.d bila ada; selain itu hari kerja [nw(s), f] (s = f di hari non-kerja → 0).
  function spanDur(c, sp) {
    if (isDur(sp.d)) return sp.d;
    const s0 = safe(() => CAL.nextWork(c, sp.s));
    if (!isDn(s0)) return undefined;
    if (s0 > sp.f) return 0;
    return Math.min(DUR_MAX, CAL.workdays(c, s0, sp.f));
  }

  // "Terlalu awal" — SATU aturan untuk violations (Manual) dan conflict jangkar di mesin (TLCpm): hari kerja pertama
  // ≥ mulai < req, untuk semua durasi termasuk milestone (mulai di akhir pekan/libur tidak dihitung terlalu awal).
  // Masukan tak sah / kalender buntu → false.
  function isEarly(c, startDn, req) {
    if (!isDn(startDn) || !isDn(req)) return false;
    const eff = safe(() => CAL.nextWork(c, startDn));
    return isDn(eff) && eff < req;
  }

  // Set kunci penerus yang mulai sebelum depReq (per tipe, edge tanpa type = FS); .detail = [{succ, pred, earliest, type}].
  // Dilanggar bila isEarly (nw(mulai) < depReq) — juga untuk milestone (perilaku 1b "milestone Sabtu setelah selesai Jumat
  // aman" dipertahankan; lihat laporan Task 1). Dependensi tidak memindahkan task (Manual).
  // Tanpa jadwal / tak terpecahkan / tipe tak dikenal / kalender buntu → diabaikan.
  function violations(c, spans, edges) {
    const out = new Set();
    const detail = [];
    for (const e of Array.isArray(edges) ? edges : []) {
      if (!e || e.ok === false) continue;
      const type = typeOf(e.type);
      if (type === null) continue;
      const p = spanAt(spans, e.from);
      const s = spanAt(spans, e.to);
      if (!p || !s) continue;
      const d = spanDur(c, s);
      if (d === undefined) continue;
      const earliest = depReq(c, type, p.s, p.f, e.lag, d);
      if (!isDn(earliest)) continue;
      if (isEarly(c, s.s, earliest)) {
        out.add(e.to);
        detail.push({ succ: e.to, pred: e.from, earliest, type });
      }
    }
    out.detail = detail;
    return out;
  }

  // "Geser ke setelah dependensi": maks depReq atas pendahulu terjadwal, sebagai iso; tak ada → null.
  // preds: [{span: {s, f} | null, lag, type?}] (atau {f, lag} untuk FS). succ: {d} | {duration} | rentang {s, f} | null
  // (durasi penerus untuk FF/SF; tidak ada → 1).
  function shiftAfterDeps(c, succ, preds) {
    let d = 1;
    if (isObj(succ)) {
      if (isDur(succ.d)) d = succ.d;
      else if (isDur(succ.duration)) d = succ.duration;
      else if (isDn(succ.s) && isDn(succ.f)) {
        const sd = spanDur(c, succ);
        if (sd !== undefined) d = sd;
      }
    }
    let best = null;
    for (const p of Array.isArray(preds) ? preds : []) {
      if (!p || typeof p !== "object") continue;
      const type = typeOf(p.type);
      if (type === null) continue;
      const f = p.span && isDn(p.span.f) ? p.span.f : p.f;
      const s = p.span && isDn(p.span.s) ? p.span.s : p.s;
      const e = depReq(c, type, s, f, p.lag, d);
      if (!isDn(e)) continue;
      if (best === null || e > best) best = e;
    }
    return best === null ? null : CAL.iso(best);
  }

  // Hari kerja selesai setelah tenggat; 0 bila tepat/sebelum; null bila tenggat tak sah atau selesai tak ada.
  // Tenggat dibaca 10 karakter pertama (R3). Selesai di hari non-kerja setelah tenggat tetap ≥ 1.
  function deadlineLate(c, finishDn, deadline) {
    if (!Number.isInteger(finishDn) || deadline === null || deadline === undefined) return null;
    const dl = CAL.dn(String(deadline).slice(0, 10));
    if (!Number.isInteger(dl)) return null;
    if (finishDn <= dl) return 0;
    // rentang hitung dibatasi (tenggat sampah di masa lalu jauh tidak boleh memakan ratusan ribu iterasi)
    return Math.max(1, CAL.workdays(c, dl + 1, Math.min(finishDn, dl + MAX_LATE_SPAN)));
  }

  return Object.freeze({
    TYPES,
    CONSTRAINT_TYPES,
    MAX_DEPS,
    DUR_MAX,
    LAG_MIN,
    LAG_MAX,
    readSched,
    sanitizePatch,
    refKey,
    buildIndex,
    calTarget,
    calKeyOf,
    projectFold,
    scopeKeyOf,
    spanOf,
    resolveDeps,
    wouldCycle,
    canLink,
    violations,
    isEarly,
    shiftAfterDeps,
    deadlineLate,
    fin,
    sff,
    depReq,
    depLimit,
    fnv1a32,
    unitOf,
    modeOf,
  });
})(typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"));
if (typeof module !== "undefined" && module.exports) module.exports = TLSched;
