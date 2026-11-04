// Plugin Timeline — TLCpm: mesin jadwal otomatis (Critical Path Method) — graf dependensi FS/SS/FF/SF dengan lag,
// Tarjan SCC (iteratif) + Kahn terurut, forward/backward pass, slack, jalur kritis, drift, jangkar
// (spec 1c §5.1–§5.5, rencana 1c-1 R8–R10). Murni: tanpa Date lokal, tanpa global, tanpa akses api, TIDAK PERNAH menulis
// (K27) — hanya menghitung. Semua rumus dependensi lewat TLSched.depReq/depLimit/fin/sff (satu sumber, R4) dan aturan
// "terlalu awal" jangkar lewat TLSched.isEarly (sama dengan violations). Kalender buntu (TL_CAL_LOOP) → simpul
// "tak terhitung" (uncomputable), run tidak melempar.
const TLCpm = (function (CAL, SCHED, HOL) {
  const SPAN_MAX = 3660; // rentang hari kalender maks untuk hitung slack (pola MAX_LATE_SPAN)
  const MS_DAY = 864e5;
  const JKT_OFFSET = 7 * 3600e3; // Asia/Jakarta, tanpa DST
  const DUR_MAX = SCHED.DUR_MAX;

  const isInt = (n) => typeof n === "number" && Number.isInteger(n);
  const isDn = (n) => Number.isInteger(n);
  const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
  // Pembanding kunci = unit kode UTF-16 (bukan localeCompare: urutan lokal berbeda antar perangkat, mis. "aa" di Denmark).
  // Dipakai untuk semua urutan keluaran (order, ignored, cycles, summaries, succ) → deterministik lintas perangkat.
  const cmpKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const cmp = cmpKey;

  function safe(fn) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof Error && e.message === "TL_CAL_LOOP") return undefined;
      throw e;
    }
  }

  // completed_at → bilangan hari Jakarta (Asia/Jakarta, UTC+7 tanpa DST). Hanya bentuk ISO bertanggal-jam; tanpa zona = UTC
  // (termasuk "YYYY-MM-DD HH:MM:SS[.ffffff]" SQLite/server); tanggal saja → hari itu; selain itu → null. Epoch dirakit dari
  // bilangan hari TLCal.dn (= Date.UTC) + grup regex (tanpa Date.parse → bebas mesin JS). Pecahan detik dipotong ke milidetik: hasil dibulatkan ke
  // hari, jadi presisi mikrodetik hanya berpengaruh di batas 23:59:59.999xxx Jakarta (dipotong = masih hari itu, benar).
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ISO_TS = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/;
  function jkt(v) {
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (ISO_DATE.test(s)) {
      const n = CAL.dn(s);
      return isDn(n) ? n : null;
    }
    const m = ISO_TS.exec(s);
    if (!m) return null;
    const day = CAL.dn(m[1]);
    const h = +m[2];
    const mi = +m[3];
    const sec = m[4] === undefined ? 0 : +m[4];
    if (!isDn(day) || h > 23 || mi > 59 || sec > 59) return null;
    const ms = m[5] === undefined ? 0 : +(m[5] + "00").slice(0, 3);
    let off = 0; // menit, positif = di depan UTC
    if (m[7]) {
      const oh = +m[8];
      const om = +m[9];
      if (oh > 23 || om > 59) return null;
      off = (m[7] === "-" ? -1 : 1) * (oh * 60 + om);
    }
    const t = day * MS_DAY + ((h * 60 + mi - off) * 60 + sec) * 1000 + ms;
    return Math.floor((t + JKT_OFFSET) / MS_DAY);
  }

  // Tenggat task → bilangan hari (10 karakter pertama, R3); tak ada/tak sah → NaN. Satu sumber untuk run() dan explain().
  const deadlineDn = (t) => (t.deadline === null || t.deadline === undefined ? NaN : CAL.dn(String(t.deadline).slice(0, 10)));
  const isDone = (t) => t.gtd_status === "done" || !!t.completed_at;
  const isStarted = (t) => Number(t.progress) > 0 || Number(t.pomodoros_done) > 0;
  const parentOf = (t) => (t.parent_id !== undefined && t.parent_id !== null ? t.parent_id : t.parent_cid);

  // Antrean prioritas min atas bilangan peringkat (Kahn terurut kunci).
  function heapPush(h, v) {
    h.push(v);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p] <= v) break;
      h[i] = h[p];
      i = p;
    }
    h[i] = v;
  }
  function heapPop(h) {
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= h.length) break;
        const r = l + 1;
        const m = r < h.length && h[r] < h[l] ? r : l;
        if (h[m] >= last) break;
        h[i] = h[m];
        i = m;
      }
      h[i] = last;
    }
    return top;
  }

  // Tarjan iteratif (tanpa rekursi). keys terurut, adj: Map<key, key[] terurut>. → komponen (urutan selesai Tarjan).
  function tarjan(keys, adj) {
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const comps = [];
    let counter = 0;
    for (const v of keys) {
      if (index.has(v)) continue;
      index.set(v, counter);
      low.set(v, counter);
      counter++;
      stack.push(v);
      onStack.add(v);
      const work = [{ u: v, i: 0 }];
      while (work.length) {
        const top = work[work.length - 1];
        const nb = adj.get(top.u) || [];
        if (top.i < nb.length) {
          const w = nb[top.i++];
          if (!index.has(w)) {
            index.set(w, counter);
            low.set(w, counter);
            counter++;
            stack.push(w);
            onStack.add(w);
            work.push({ u: w, i: 0 });
          } else if (onStack.has(w) && index.get(w) < low.get(top.u)) low.set(top.u, index.get(w));
        } else {
          work.pop();
          const u = top.u;
          if (work.length) {
            const p = work[work.length - 1].u;
            if (low.get(u) < low.get(p)) low.set(p, low.get(u));
          }
          if (low.get(u) === index.get(u)) {
            const comp = [];
            let w;
            do {
              w = stack.pop();
              onStack.delete(w);
              comp.push(w);
            } while (w !== u);
            comps.push(comp);
          }
        }
      }
    }
    return comps;
  }

  // run({tasks, cal, units, readExt}) → Result (lihat laporan Task 2 / spec §5.5). tasks = daftar lengkap scope;
  // cal = TLCal.compile(...); units = Map<recId, {auto}>; readExt(task) → ext mentah tanpa prefiks.
  function run(input) {
    const a = isObj(input) ? input : {};
    const c = a.cal;
    const units = a.units instanceof Map ? a.units : new Map();
    const readExt = typeof a.readExt === "function" ? a.readExt : (t) => (t && isObj(t.ext) ? t.ext : {});

    // 1. task hidup: buang berulang / archived / deleted / tanpa id; duplikat kunci → yang pertama. Urut kunci.
    const items = [];
    const byKey = new Map();
    for (const t of Array.isArray(a.tasks) ? a.tasks : []) {
      if (!isObj(t) || t.id === undefined || t.id === null) continue;
      if (t.recurrence_type || t.gtd_status === "archived" || t.archived || t.deleted) continue;
      const key = String(t.id);
      if (byKey.has(key)) continue;
      let raw;
      try {
        raw = readExt(t);
      } catch (e) {
        raw = {};
      }
      if (!isObj(raw)) raw = {};
      const sched = SCHED.readSched(raw);
      const s = sched.start === null ? null : CAL.dn(sched.start);
      const durOk = isInt(raw.duration) && raw.duration >= 0 && raw.duration <= DUR_MAX;
      const it = {
        key,
        task: t,
        sched,
        s,
        d: durOk ? raw.duration : 1,
        durGuess: !durOk,
        mode: SCHED.modeOf(sched, units, t),
        scope: SCHED.scopeKeyOf(t),
        g: SCHED.unitOf(t).recId,
      };
      byKey.set(key, it);
      items.push(it);
    }
    items.sort((x, y) => cmp(x.key, y.key));
    const index = SCHED.buildIndex(items.map((it) => it.task));

    // 2. ringkasan: punya anak hidup (parent_id / parent_cid terpecahkan ke task lain)
    const summaries = new Map();
    for (const it of items) {
      const p = parentOf(it.task);
      if (p === undefined || p === null || p === "") continue;
      const parent = index.get(String(p));
      if (!parent) continue;
      const pk = String(parent.id);
      if (pk === it.key) continue;
      if (!summaries.has(pk)) summaries.set(pk, []);
      summaries.get(pk).push(it.key);
    }
    for (const list of summaries.values()) list.sort(cmp);

    // 3. sisi kandidat dari deps penerus (urutan deps tersimpan); alasan diabaikan: unresolved → scope → summary.
    const ignored = [];
    const cand = []; // {from, to, type, lag}
    const seenPair = new Set();
    for (const it of items) {
      for (const dep of it.sched.deps) {
        const pt = index.get(dep.key);
        const from = pt ? String(pt.id) : dep.key;
        const pair = from + "\u0000" + it.key;
        if (seenPair.has(pair)) continue;
        seenPair.add(pair);
        if (!pt) ignored.push({ from, to: it.key, reason: "unresolved" });
        else if (byKey.get(from).scope !== it.scope) ignored.push({ from, to: it.key, reason: "scope" });
        else if (summaries.has(from) || summaries.has(it.key)) ignored.push({ from, to: it.key, reason: "summary" });
        else cand.push({ from, to: it.key, type: dep.type, lag: dep.lag });
      }
    }

    // 4. simpul: non-ringkasan dengan Mulai; lalu (BFS) tanpa Mulai, otomatis, belum selesai, dengan pendahulu simpul.
    const isNode = new Set();
    for (const it of items) if (it.s !== null && !summaries.has(it.key)) isNode.add(it.key);
    const candFrom = new Map();
    for (const e of cand) {
      if (!candFrom.has(e.from)) candFrom.set(e.from, []);
      candFrom.get(e.from).push(e.to);
    }
    const queue = [...isNode];
    while (queue.length) {
      const k = queue.pop();
      for (const to of candFrom.get(k) || []) {
        if (isNode.has(to)) continue;
        const it = byKey.get(to);
        if (it.s !== null || it.mode !== "auto" || isDone(it.task)) continue;
        isNode.add(to);
        queue.push(to);
      }
    }
    const nodeKeys = items.filter((it) => isNode.has(it.key)).map((it) => it.key); // terurut

    // 5. graf: sisi dengan kedua ujung simpul; selain itu notNode.
    const edges = [];
    for (const e of cand) {
      if (isNode.has(e.from) && isNode.has(e.to)) edges.push(e);
      else ignored.push({ from: e.from, to: e.to, reason: "notNode" });
    }
    const adj = new Map(nodeKeys.map((k) => [k, []]));
    for (const e of edges) adj.get(e.from).push(e.to);
    for (const l of adj.values()) l.sort(cmp);

    // 6. Tarjan: komponen > 1 atau sisi diri = lingkaran; sisi di dalamnya diabaikan ("cycle").
    const comps = tarjan(nodeKeys, adj);
    const compOf = new Map();
    comps.forEach((comp, i) => comp.forEach((k) => compOf.set(k, i)));
    const selfLoop = new Set(edges.filter((e) => e.from === e.to).map((e) => e.from));
    const inCycle = new Set();
    const cycles = [];
    for (const comp of comps) {
      if (comp.length > 1 || selfLoop.has(comp[0])) {
        const sorted = comp.slice().sort(cmp);
        sorted.forEach((k) => inCycle.add(k));
        cycles.push(sorted);
      }
    }
    cycles.sort((x, y) => cmp(x[0], y[0]));

    const succ = new Map(nodeKeys.map((k) => [k, []]));
    const succE = new Map(nodeKeys.map((k) => [k, []]));
    const pred = new Map(nodeKeys.map((k) => [k, []]));
    for (const e of edges) {
      if (compOf.get(e.from) === compOf.get(e.to)) {
        ignored.push({ from: e.from, to: e.to, reason: "cycle" });
        continue;
      }
      pred.get(e.to).push({ key: e.from, type: e.type, lag: e.lag });
      succE.get(e.from).push({ key: e.to, type: e.type, lag: e.lag });
    }
    for (const [k, l] of succE) {
      l.sort((x, y) => cmp(x.key, y.key));
      succ.set(k, l.map((x) => x.key));
    }
    ignored.sort((x, y) => cmp(x.to, y.to) || cmp(x.from, y.from));

    // 7. Kahn terurut kunci (antrean min atas peringkat).
    const rank = new Map(nodeKeys.map((k, i) => [k, i]));
    const indeg = new Map(nodeKeys.map((k) => [k, pred.get(k).length]));
    const heap = [];
    for (const k of nodeKeys) if (indeg.get(k) === 0) heapPush(heap, rank.get(k));
    const order = [];
    while (heap.length) {
      const k = nodeKeys[heapPop(heap)];
      order.push(k);
      for (const s of succ.get(k)) {
        const n = indeg.get(s) - 1;
        indeg.set(s, n);
        if (n === 0) heapPush(heap, rank.get(s));
      }
    }

    // 8. forward pass
    const nodes = new Map();
    const uncomputable = new Set();
    const drift = new Set();
    for (const k of order) {
      const it = byKey.get(k);
      const t = it.task;
      const d = it.d;
      const cst = it.sched.constraint;
      let fixed = null;
      if (isDone(t)) fixed = "done";
      else if (inCycle.has(k)) fixed = "cycle";
      else if (it.mode === "manual") fixed = "manual";
      else if (isStarted(t) && it.s !== null) fixed = "started";
      else if (cst && cst.type === "MFO") fixed = "mfo";

      const n = { key: k, task: t, es: null, ef: null, ls: null, lf: null, slack: null, critical: false, mode: it.mode };
      if (fixed) n.fixed = fixed;
      if (it.durGuess) n.durGuess = true;
      n.d = d;
      n.g = it.g;
      n.late = null;
      nodes.set(k, n);

      const preds = pred.get(k);
      let es;
      let ef;
      if (fixed) {
        n.driver = { kind: "fixed" };
        if (fixed === "mfo") {
          const md = CAL.dn(cst.date);
          ef = d >= 1 ? safe(() => CAL.prevWork(c, md)) : md;
          es = isDn(ef) ? SCHED.sff(c, ef, d) : undefined;
        } else if (it.s !== null) {
          es = it.s;
          if (fixed === "done") {
            ef = jkt(t.completed_at);
            if (ef === null) ef = SCHED.fin(c, es, d);
            if (isDn(ef) && ef < es) ef = es;
          } else ef = SCHED.fin(c, es, d);
        }
        if (isDn(es) && isDn(ef)) {
          for (const p of preds) {
            const pn = nodes.get(p.key);
            if (pn.es === null) continue;
            const r = SCHED.depReq(c, p.type, pn.es, pn.ef, p.lag, d);
            if (isDn(r) && SCHED.isEarly(c, es, r)) {
              n.conflict = true;
              break;
            }
          }
        }
      } else {
        let best = null;
        let driver = null;
        let bad = false;
        for (const p of preds) {
          const pn = nodes.get(p.key);
          const r = pn.es === null ? undefined : SCHED.depReq(c, p.type, pn.es, pn.ef, p.lag, d);
          if (!isDn(r)) {
            bad = true; // pendahulu tak terhitung → penerus tak terhitung (tidak menebak ES lebih awal)
            break;
          }
          if (best === null || r > best) {
            best = r;
            driver = { kind: "pred", from: p.key, type: p.type, lag: p.lag };
          }
        }
        if (!bad) {
          if (cst && cst.type === "SNET") {
            const sd = CAL.dn(cst.date);
            if (best === null || sd > best) {
              best = sd;
              driver = { kind: "snet" };
            }
          }
          if (!preds.length && it.s !== null && (best === null || it.s > best)) {
            best = it.s;
            driver = { kind: "root" };
          }
        }
        n.driver = driver || { kind: "root" };
        if (!bad && best !== null) {
          es = d >= 1 ? safe(() => CAL.nextWork(c, best)) : best;
          ef = isDn(es) ? SCHED.fin(c, es, d) : undefined;
        }
      }
      if (isDn(es) && isDn(ef)) {
        n.es = es;
        n.ef = ef;
        n.late = SCHED.deadlineLate(c, ef, t.deadline);
        if (!fixed && CAL.iso(es) !== it.sched.start) drift.add(k);
      } else {
        delete n.conflict;
        uncomputable.add(k);
      }
    }

    // 9. akhir kelompok project: P_g = maks EF simpul kelompok
    const groupEnd = new Map();
    for (const n of nodes.values()) {
      if (n.ef === null) continue;
      const cur = groupEnd.get(n.g);
      if (cur === undefined || n.ef > cur) groupEnd.set(n.g, n.ef);
    }

    // 10. backward pass (topologis terbalik), slack, kritis
    for (let i = order.length - 1; i >= 0; i--) {
      const k = order[i];
      const n = nodes.get(k);
      if (n.es === null) continue;
      const d = n.d;
      let lf = groupEnd.get(n.g);
      const dl = deadlineDn(n.task);
      if (isDn(dl)) {
        const cap = d >= 1 ? safe(() => CAL.prevWork(c, dl)) : dl;
        if (isDn(cap) && cap < lf) lf = cap;
      }
      if (n.fixed === "mfo" && n.ef < lf) lf = n.ef;
      for (const e of succE.get(k)) {
        const sn = nodes.get(e.key);
        if (sn.ls === null) continue;
        const lim = SCHED.depLimit(c, e.type, sn.ls, sn.lf, e.lag, d);
        if (isDn(lim) && lim < lf) lf = lim;
      }
      const ls = SCHED.sff(c, lf, d);
      if (!isDn(ls)) continue;
      n.lf = lf;
      n.ls = ls;
      if (n.fixed === "done") continue; // slack null, tidak kritis
      let slack;
      if (lf >= n.ef) slack = CAL.workdays(c, n.ef + 1, Math.min(lf, n.ef + SPAN_MAX));
      else slack = -CAL.workdays(c, lf + 1, Math.min(n.ef, lf + SPAN_MAX));
      slack = slack === 0 ? 0 : slack; // tanpa −0
      n.slack = slack;
      n.critical = slack <= 0;
    }

    return {
      nodes,
      order,
      succ,
      pred,
      cycles,
      ignored,
      groupEnd,
      drift,
      summaries,
      uncomputable,
    };
  }

  // ---- explain: "Kenapa dijadwalkan di sini?" (spec 1c §5.6) ----
  // Dipanggil untuk SATU task sesuai permintaan (popover), tidak di jalur render. TIDAK menghitung jadwal sendiri: tanggal
  // (start/finish/late) dibaca dari hasil run(); rumus dependensi hanya dipakai ulang (TLSched.depReq) untuk memisahkan
  // "hari lag" dari "hari yang dilewati", jadi tidak mungkin berbeda dari mesin.

  // Hari non-kerja → {dn, why, name?}. Akhir pekan didahulukan atas libur bernama (Sabtu/Minggu yang kebetulan libur nasional
  // tetap "Sabtu"/"Minggu"); hari kerja biasa yang dikecualikan kalender (mis. Jumat dinonaktifkan, atau libur tambahan
  // buatan pengguna) = "tambahan" tanpa nama (nama libur tambahan tidak disimpan di kalender terkompilasi).
  function nonWorkInfo(c, n) {
    const wd = CAL.isoWeekday(n);
    if (!c.mask.has(wd)) return wd === 6 ? { dn: n, why: "Sabtu" } : wd === 7 ? { dn: n, why: "Minggu" } : { dn: n, why: "tambahan" };
    const h = HOL && typeof HOL.lookup === "function" ? HOL.lookup(CAL.iso(n)) : null;
    if (h && ((h.kind === "libur" && c.national) || (h.kind === "cuti" && c.cutiBersama))) return { dn: n, why: h.kind, name: h.nama };
    return { dn: n, why: "tambahan" };
  }

  // Hari non-kerja di [from, to] inklusif, berurut (rentang dibatasi SPAN_MAX).
  function nonWorkIn(c, from, to) {
    const out = [];
    if (!isDn(from) || !isDn(to)) return out;
    for (let d = from, hi = Math.min(to, from + SPAN_MAX); d <= hi; d++) if (!CAL.isWork(c, d)) out.push(nonWorkInfo(c, d));
    return out;
  }

  // Hari kerja di [from, to) (setengah terbuka), berurut.
  function workIn(c, from, to) {
    const out = [];
    for (let d = from, hi = Math.min(to - 1, from + SPAN_MAX); d <= hi; d++) if (CAL.isWork(c, d)) out.push(d);
    return out;
  }

  // PENTING: `cal` HARUS kalender terkompilasi yang sama dengan yang diberikan ke run(); kalender lain membuat atribusi
  // hari yang dilewati (skipped/lagDays/durSkipped) bisa berbeda dari mesin. Tanpa `readExt`, `base` untuk root/snet = null
  // (Task 4+ wajib meneruskannya).
  // explain(result, key, cal, readExt?) → {kind, base, lagDays, start, skipped, finish, durSkipped, late, deadline, pred?, type?, lag?, cycleWith?}
  //   kind: pred | root | snet | mfo | manual | done | started | cycle | unscheduled
  //   base = titik acuan: FS/FF → selesai pendahulu, SS/SF → mulai pendahulu; snet → tanggal batasan; root → tanggal mulai
  //   tersimpan (dua yang terakhir butuh readExt, tanpanya null); lainnya null.
  //   lagDays = hari kerja yang dipakai lag (selisih syarat lag 0 dan syarat ber-lag: [min, max) hari kerja); lag 0 → [].
  //   skipped = hari non-kerja strictly di antara base dan start (hanya bila start > base; root/snet: dari base inklusif);
  //   durSkipped = hari non-kerja di dalam [start, finish] (milestone d = 0 → []); keduanya tidak pernah tumpang tindih.
  //   late = hari kerja lewat tenggat (0 bila tepat/tanpa tenggat); deadline = hari tenggat atau null.
  //   cycle → cycleWith = anggota lingkaran lain (terurut cmpKey; anggota yang selesai → kind done, tanpa cycleWith); unscheduled → semua tanggal null.
  function explain(result, key, cal, readExt) {
    const k = String(key);
    const out = (kind, extra) =>
      Object.assign({ kind, base: null, lagDays: [], start: null, skipped: [], finish: null, durSkipped: [], late: 0, deadline: null }, extra);
    const nodes = isObj(result) && result.nodes instanceof Map ? result.nodes : null;
    const n = nodes ? nodes.get(k) : undefined;
    const ring = isObj(result) && Array.isArray(result.cycles) ? result.cycles.find((cy) => cy.indexOf(k) >= 0) : undefined;
    // Prioritas jangkar mesin: done > cycle → anggota lingkaran yang selesai dijelaskan sebagai "done" (tanggal dari completed_at).
    const cycleWith = ring && !(n && n.fixed === "done") ? ring.filter((x) => x !== k).sort(cmpKey) : null;
    if (!n || n.es === null || n.ef === null || !isObj(cal)) return cycleWith ? out("cycle", { cycleWith }) : out("unscheduled");

    const c = cal;
    const dl = deadlineDn(n.task);
    const e = out(cycleWith ? "cycle" : n.fixed || n.driver.kind, {
      start: n.es,
      finish: n.ef,
      late: n.late || 0,
      deadline: isDn(dl) ? dl : null,
      durSkipped: n.d >= 1 ? nonWorkIn(c, n.es, n.ef) : [],
    });
    if (cycleWith) e.cycleWith = cycleWith;
    if (e.kind === "pred") {
      const dr = n.driver;
      const pn = nodes.get(dr.from);
      e.pred = dr.from;
      e.type = dr.type;
      e.lag = dr.lag;
      e.base = dr.type === "SS" || dr.type === "SF" ? pn.es : pn.ef;
      // hari lag: syarat ber-lag vs syarat lag 0 (rumus yang sama dengan mesin → tidak bisa berbeda)
      const r = SCHED.depReq(c, dr.type, pn.es, pn.ef, dr.lag, n.d);
      const r0 = SCHED.depReq(c, dr.type, pn.es, pn.ef, 0, n.d);
      if (isDn(r) && isDn(r0) && r !== r0) e.lagDays = workIn(c, Math.min(r, r0), Math.max(r, r0));
      if (e.start > e.base) e.skipped = nonWorkIn(c, e.base + 1, e.start - 1);
    } else if ((e.kind === "snet" || e.kind === "root") && typeof readExt === "function") {
      // acuan tersimpan: tanggal batasan SNET, atau tanggal Mulai akar (bisa jatuh di akhir pekan → digeser)
      let sched = null;
      try {
        sched = SCHED.readSched(readExt(n.task));
      } catch (err) {
        sched = null;
      }
      const ref = sched ? (e.kind === "snet" ? (sched.constraint ? sched.constraint.date : null) : sched.start) : null;
      const b = ref === null ? NaN : CAL.dn(ref);
      if (isDn(b)) {
        e.base = b;
        if (e.start > b) e.skipped = nonWorkIn(c, b, e.start - 1);
      }
    }
    return e;
  }

  return Object.freeze({ run, jkt, cmpKey, explain });
})(
  typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"),
  typeof TLSched !== "undefined" ? TLSched : require("./schedule.js"),
  typeof TLHolidays !== "undefined" ? TLHolidays : require("./holidays-id.js"),
);
if (typeof module !== "undefined" && module.exports) module.exports = TLCpm;
