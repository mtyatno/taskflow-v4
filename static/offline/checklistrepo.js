;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.checklistrepo = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Checklist offline (Fase 2): penyimpanan lokal + antrean aksi (spec docs/superpowers/specs/
  // 2026-11-11-checklist-offline-fase2-design.md §4.1–§4.4; rencana PR B2 R2). Logika pohon HANYA di TF.checklist.
  //
  // - Record store `subtasks`: {cid, server_id, task_cid, parent_cid, title, is_done, sort_order, created_at}
  //   (+ `client_id` dari tampilan untuk tambah yang idempoten per task). Pemetaan cid ↔ id server: _idmap "subtask".
  // - Bentuk API (`itemsForTask`): pre-order `{id, task_id, parent_id, depth, title, is_done, sort_order}` dengan
  //   id = server_id ?? cid, parent_id = id induk, task_id = id server task ?? cid task. Id STABIL: butir yang dibuat di
  //   perangkat ini (record `origin: "local"`) tetap ber-id cid walau push sudah mengadopsi id servernya — tampilan yang
  //   terbuka memegang id itu. Urutan pohon tetap dihitung dengan id server (tie-break sama dengan server); id masukan
  //   (path / parent_id body) boleh cid maupun id server.
  // - Aksi lokal (create/setDone/toggle/patch/move/remove): baca butir task + antrean task itu → fungsi murni
  //   TF.checklist → tulis butir yang berubah + entri `_outbox` (+ rev kosong di `_meta`) dalam SATU transaksi
  //   ["subtasks", "_outbox", "_meta"] →
  //   progress task lokal (TF.checklist.writeTaskProgress: tanpa dirty/rev/base_rev, cap checklist_adopted_at) →
  //   event tf:outbox-queued. Entri antrean: {entity_type: "subtasks", cid, task_cid, op, payload} dengan payload
  //   create {title, parent_cid, index} | rename {title} | set_done {is_done, cascade_cids?} | move {parent_cid, index} |
  //   delete {}. `cascade_cids` (hanya lokal; push mengabaikannya) = butir lain yang ikut tercentang berantai.
  //   Aksi tanpa perubahan (judul sama, centang sudah sesuai, posisi sama) tidak menulis apa pun.
  // - Hapus: butir tanpa server_id (create belum terkirim) → semua entrinya dibuang tanpa delete; butir tersinkron →
  //   delete untuk setiap butir tersinkron yang induknya bukan butir tersinkron yang ikut terhapus (biasanya hanya
  //   akarnya; server berantai). `move` butir tersinkron ke induk yang dibuang ikut dibuang; entri create/move butir
  //   lain yang menunjuk induk yang dibuang ditulis ulang ke akhir level atas (tanpa entri yatim); centang berantai dari
  //   set_done yang dibuang ke butir yang tidak ikut terhapus diganti entri set_done sendiri. Bila ada entri yang
  //   ditulis ulang, atau entri dibuang padahal entri lain task itu yang lebih baru masih antre (posisi index-nya
  //   dihitung dengan butir yang kini batal), rev tersimpan dikosongkan di transaksi yang sama → diambil ulang setelah
  //   antrean kosong.
  // - Rev tersimpan: _meta `checklist_revs` {task_cid: rev | null}; null = dikenal tetapi perlu diambil ulang
  //   (ADR-051 "dikosongkan"); kunci tidak ada = belum pernah diunduh (setRevs: banyak kunci dalam satu transaksi).
  //   Unduhan awal selesai: _meta `checklists_hydrated` = true.
  // - Kesiapan SINKRON untuk routing (taskroutes.shouldRouteLocally): isReady(), knowsTask(id), knowsItem(id) dibaca
  //   dari memori yang dimuat async saat start (otomatis di browser; idempoten — api.fetch menunggunya sebelum
  //   keputusan routing checklist; refresh() memaksa muat ulang) dan diperbarui setiap tulis modul ini. Perubahan
  //   memori selama pemuatan dicatat dan diputar ulang di atas hasil muat. Ganti sesi (window.__userEpoch naik di
  //   clearLocalUserData) → memori kosong dan tidak siap sampai markHydrated berikutnya. Id server task yang baru
  //   diketahui: setRev / replaceTaskChecklist / aksi mencatatnya; syncpush memanggil noteTaskServerId.
  // - Galat ditolak dengan Error {code}: TASK_NOT_FOUND | NOT_FOUND | EMPTY_TITLE | PARENT_NOT_FOUND | CYCLE |
  //   NO_CHANGE | INVALID (rute memetakannya ke 404/422 berteks server).

  const isNode = typeof module !== "undefined" && module.exports;
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const C = req("./checklist.js", root.TF && root.TF.checklist);

  const STORE = "subtasks";
  const ENTITY = "subtasks";
  const MAP_TYPE = "subtask";
  const REVS_KEY = "checklist_revs";
  const HYDRATED_KEY = "checklists_hydrated";
  const ORIGIN_LOCAL = "local"; // record butir yang dibuat di perangkat ini (id API = cid selamanya, lihat viewOf)

  const nowIso = () => new Date().toISOString();
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const revVal = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const mapKey = (sid) => MAP_TYPE + ":" + sid;
  function fail(code) { const e = new Error(code); e.code = code; return e; }

  function newCid() {
    try {
      const c = root.crypto;
      if (c && typeof c.randomUUID === "function") return c.randomUUID();
    } catch (_) {}
    try { if (TFids && typeof TFids.newCid === "function") return TFids.newCid(); } catch (_) {}
    return "c" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function emit(name, detail) {
    try {
      if (root && typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
        root.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
      }
    } catch (_) {}
  }

  // ── memori kesiapan ──────────────────────────────────────────────────────────

  const curEpoch = () => (root && typeof root.__userEpoch === "number" ? root.__userEpoch : 0);
  function freshMem(loaded) {
    return {
      loaded: loaded, epoch: curEpoch(), hydrated: false,
      revs: new Map(),      // task_cid → rev | null
      taskSid: new Map(),   // String(id server task) → task_cid
      itemCid: new Map(),   // cid butir → task_cid
      itemSid: new Map(),   // String(id server butir) → cid butir
      taskCount: new Map(), // task_cid → jumlah butir lokal
    };
  }
  let mem = freshMem(false);
  let journal = null; // perubahan memori selama pemuatan berjalan (diputar ulang di atas hasilnya)
  let loadToken = 0;
  let startP = null;

  function checkEpoch() {
    if (mem.epoch !== curEpoch()) {
      mem = freshMem(true);
      journal = null;
      loadToken++;
      startP = null;
    }
  }
  function memApply(fn) {
    checkEpoch();
    fn(mem);
    if (journal) journal.push(fn);
  }
  function addItem(m, r) {
    if (!r || r.cid == null) return;
    if (!m.itemCid.has(r.cid)) m.taskCount.set(r.task_cid, (m.taskCount.get(r.task_cid) || 0) + 1);
    m.itemCid.set(r.cid, r.task_cid);
    if (r.server_id != null) m.itemSid.set(String(r.server_id), r.cid);
  }
  function dropItem(m, r) {
    if (!r || !m.itemCid.has(r.cid)) return;
    const t = m.itemCid.get(r.cid);
    m.itemCid.delete(r.cid);
    const n = (m.taskCount.get(t) || 1) - 1;
    if (n > 0) m.taskCount.set(t, n); else m.taskCount.delete(t);
    if (r.server_id != null && m.itemSid.get(String(r.server_id)) === r.cid) m.itemSid.delete(String(r.server_id));
  }
  function noteTask(m, t) { if (t && t.server_id != null) m.taskSid.set(String(t.server_id), t.cid); }

  function loadMem() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const m = freshMem(true);
      let t;
      try { t = db.transaction(["_meta", "subtasks", "tasks"], "readonly"); } catch (err) { reject(err); return; }
      const meta = t.objectStore("_meta");
      const rv = meta.get(REVS_KEY);
      rv.onsuccess = () => { if (isObj(rv.result)) for (const k of Object.keys(rv.result)) m.revs.set(k, revVal(rv.result[k])); };
      const hy = meta.get(HYDRATED_KEY);
      hy.onsuccess = () => { m.hydrated = hy.result === true; };
      const sq = t.objectStore("subtasks").getAll();
      sq.onsuccess = () => { for (const r of sq.result || []) addItem(m, r); };
      const kc = t.objectStore("tasks").index("server_id").openKeyCursor();
      kc.onsuccess = () => {
        const c = kc.result;
        if (!c) return;
        m.taskSid.set(String(c.key), c.primaryKey);
        c.continue();
      };
      t.oncomplete = () => resolve(m);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("checklist load aborted"));
    }));
  }

  // Muat memori dari IndexedDB; perubahan memori selama pemuatan dicatat lalu diputar ulang di atas hasilnya.
  function load() {
    const token = ++loadToken;
    const epoch = curEpoch();
    journal = [];
    startP = loadMem().then((m) => {
      if (token !== loadToken || epoch !== curEpoch()) return;
      for (const fn of journal || []) fn(m);
      m.epoch = epoch;
      mem = m;
    }, () => {}).then(() => {
      if (token === loadToken) { journal = null; startP = null; }
    });
    return startP;
  }
  // Memori siap dipakai: sudah dimuat → langsung selesai (tanpa memuat ulang; api.fetch menunggu ini sebelum keputusan
  // routing checklist); sedang dimuat → menunggu yang sama; belum / gagal → muat. Gagal → tetap tidak siap.
  function start() {
    checkEpoch();
    if (mem.loaded) return Promise.resolve();
    return startP || load();
  }
  // Muat ulang paksa dari IndexedDB (tab lain mengubah checklist / menyelesaikan unduhan awal; dipanggil sesudah
  // setiap pullChecklists).
  function refresh() {
    checkEpoch();
    startP = null;
    return load();
  }
  function reset() {
    loadToken++;
    startP = null;
    journal = null;
    mem = freshMem(false);
  }

  function isReady() { checkEpoch(); return mem.loaded && mem.hydrated; }
  // Task dikenal lokal = punya rev tersimpan (termasuk null) atau butir lokal. `id` = cid task atau id server.
  function knowsTask(id) {
    checkEpoch();
    if (id == null || id === "") return false;
    const s = String(id);
    const cid = mem.taskSid.has(s) ? mem.taskSid.get(s) : s;
    return mem.revs.has(cid) || (mem.taskCount.get(cid) || 0) > 0;
  }
  function knowsItem(id) {
    checkEpoch();
    if (id == null || id === "") return false;
    const s = String(id);
    return mem.itemCid.has(s) || mem.itemSid.has(s);
  }

  // ── baca ─────────────────────────────────────────────────────────────────────

  function readTask(taskCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(taskCid);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    }));
  }

  // Task dari cid atau id server (angka / teks angka); task terhapus / tidak ada → null.
  function resolveTask(id) {
    if (id == null || id === "") return Promise.resolve(null);
    const s = String(id);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const os = db.transaction("tasks", "readonly").objectStore("tasks");
      const r = os.get(s);
      r.onsuccess = () => {
        if (r.result) { resolve(r.result.deleted ? null : r.result); return; }
        if (!/^\d+$/.test(s)) { resolve(null); return; }
        const q = os.index("server_id").get(Number(s));
        q.onsuccess = () => resolve(q.result && !q.result.deleted ? q.result : null);
        q.onerror = () => reject(q.error);
      };
      r.onerror = () => reject(r.error);
    }));
  }

  // Record butir dari cid atau id server; tidak ada → null.
  function findItem(id) {
    if (id == null || id === "") return Promise.resolve(null);
    const s = String(id);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const os = db.transaction("subtasks", "readonly").objectStore("subtasks");
      const r = os.get(s);
      r.onsuccess = () => {
        if (r.result) { resolve(r.result); return; }
        if (!/^\d+$/.test(s)) { resolve(null); return; }
        const q = os.index("server_id").get(Number(s));
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => reject(q.error);
      };
      r.onerror = () => reject(r.error);
    }));
  }

  function recordsForTask(taskCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("subtasks", "readonly").objectStore("subtasks").index("task_cid").getAll(taskCid);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  const taskIdOf = (task, taskCid) => (task && task.server_id != null ? task.server_id : taskCid);

  // Pandangan bentuk API atas record satu task: {recs, taskId, items (pre-order), apiOf (cid → id), cidOf (id → cid),
  // byCid}.
  function viewOf(all, taskId) {
    const recs = all.filter((r) => r && !r.deleted); // penanda `deleted` (bentuk lama store) = tidak ada
    const apiOf = new Map();
    for (const r of recs) apiOf.set(r.cid, r.server_id != null ? r.server_id : r.cid);
    const cidOf = new Map();
    for (const [c, a] of apiOf) cidOf.set(a, c);
    const raw = recs.map((r) => ({
      id: apiOf.get(r.cid),
      task_id: taskId,
      // induk yang record-nya tidak ada → cid mentah (tidak dikenal → level atas, seperti server)
      parent_id: r.parent_cid == null ? null : (apiOf.has(r.parent_cid) ? apiOf.get(r.parent_cid) : r.parent_cid),
      title: r.title,
      is_done: !!r.is_done,
      sort_order: r.sort_order == null ? null : r.sort_order,
    }));
    const byCid = new Map(recs.map((r) => [r.cid, r]));
    // Id pandangan (urutan) → id API keluar: butir buatan perangkat ini tetap cid (id stabil); lainnya apa adanya.
    const out = (id) => {
      if (id == null || !cidOf.has(id)) return id;
      const r = byCid.get(cidOf.get(id));
      return r && r.origin === ORIGIN_LOCAL ? r.cid : id;
    };
    return { recs, taskId, items: C.preorder(raw), apiOf, cidOf, byCid, out };
  }
  // Daftar pandangan → bentuk API keluar (id / parent_id lewat view.out).
  const outItems = (view, items) => items.map((it) => Object.assign({}, it, { id: view.out(it.id), parent_id: view.out(it.parent_id) }));

  function itemsForTask(taskCid) {
    return Promise.all([readTask(taskCid), recordsForTask(taskCid)])
      .then(([task, recs]) => { const v = viewOf(recs, taskIdOf(task, taskCid)); return outItems(v, v.items); });
  }

  function outboxSubtaskOps() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_outbox", "readonly").objectStore("_outbox").getAll();
      r.onsuccess = () => resolve((r.result || []).filter((o) => o && o.entity_type === ENTITY));
      r.onerror = () => reject(r.error);
    }));
  }
  // Task yang masih punya entri antrean checklist (E5: pull tidak mengambil ulang / mengadopsi progress-nya).
  function pendingTaskCids() {
    return outboxSubtaskOps().then((ops) => new Set(ops.map((o) => o.task_cid)));
  }

  // ── aksi lokal ───────────────────────────────────────────────────────────────

  // Id bentuk API di pandangan untuk nilai body (angka, teks angka, atau cid); tidak dikenal → nilai apa adanya
  // (fungsi murni lalu menolaknya sebagai PARENT_NOT_FOUND).
  function apiIdIn(view, x) {
    if (x == null) return null;
    if (typeof x === "string" && view.apiOf.has(x)) return view.apiOf.get(x); // cid butir (juga yang sudah ber-id server)
    for (const it of view.items) if (it.id === x) return it.id;
    const s = String(x);
    for (const it of view.items) if (String(it.id) === s) return it.id;
    return x;
  }
  const normIndex = (i) => (i == null ? null : Math.max(0, Math.trunc(Number(i)) || 0));
  function sameTree(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id || a[i].parent_id !== b[i].parent_id || a[i].sort_order !== b[i].sort_order) return false;
    }
    return true;
  }
  function recChanged(cur, next) {
    return cur.parent_cid !== next.parent_cid || cur.title !== next.title || !!cur.is_done !== next.is_done
      || cur.sort_order !== next.sort_order;
  }

  // Tulis rencana di transaksi yang sama: butir berubah/baru di-put, butir yang hilang dari `plan.items` dihapus,
  // entri `plan.drop` dibuang, `plan.rewrite` (entri utuh) ditulis ulang, `plan.ops` ditambahkan berurutan, dan bila
  // `plan.clearRev` rev tersimpan task dikosongkan (null) di _meta — atomik dengan perubahan antrean (galat apa pun
  // membatalkan semuanya lewat `abort(err)`).
  function commitPlan(st, ob, meta, view, plan, taskCid, abort) {
    const put = [];
    const removed = [];
    if (plan.items) {
      const cidFor = (apiId) => (view.cidOf.has(apiId) ? view.cidOf.get(apiId)
        : (plan.create && apiId === plan.create.cid ? plan.create.cid : null));
      const seen = new Set();
      for (const it of plan.items) {
        const cid = cidFor(it.id);
        if (cid == null) continue;
        seen.add(cid);
        const cur = view.byCid.get(cid);
        const base = cur || {
          cid: cid, server_id: null, task_cid: taskCid, parent_cid: null, title: "", is_done: false, sort_order: 0,
          created_at: plan.create.created_at, client_id: plan.create.client_id, origin: ORIGIN_LOCAL,
        };
        const next = Object.assign({}, base, {
          parent_cid: it.parent_id == null ? null : cidFor(it.parent_id),
          title: it.title,
          is_done: !!it.is_done,
          sort_order: it.sort_order == null ? null : it.sort_order,
        });
        if (!cur || recChanged(cur, next)) { st.put(next); put.push(next); }
      }
      for (const r of view.recs) if (!seen.has(r.cid)) { st.delete(r.cid); removed.push(r); }
    }
    for (const qid of plan.drop || []) ob.delete(qid);
    for (const o of plan.rewrite || []) ob.put(o);
    if (plan.clearRev) {
      const mr = meta.get(REVS_KEY);
      mr.onsuccess = () => {
        try {
          const o = Object.assign({}, isObj(mr.result) ? mr.result : {});
          o[taskCid] = null;
          meta.put(o, REVS_KEY);
        } catch (err) { abort(err); }
      };
    }
    const ts = Date.now();
    for (const o of plan.ops || []) {
      ob.add({ ts: ts, retries: 0, entity_type: ENTITY, op: o.op, cid: o.cid, task_cid: taskCid, payload: o.payload });
    }
    return { put, removed };
  }

  function progressOf(items, task) {
    const c = C.topLevelCounts(items);
    // Tanpa butir level atas: progress = nilai terakhir task (K11), sama dengan _recompute_progress.
    const progress = c.total ? C.percent(c.done, c.total)
      : (task && typeof task.progress === "number" ? task.progress : null);
    return { done: c.done, total: c.total, progress };
  }

  // Satu aksi lokal atomik. `decide(view, queued)` dipanggil SINKRON di dalam transaksi ["subtasks", "_outbox",
  // "_meta"] (queued = entri antrean subtasks task ini) dan mengembalikan {error} atau rencana
  // {items|null, create?, ops?, drop?, rewrite?, clearRev?, result}. → {items, task_progress, result}.
  function runAction(taskCid, decide) {
    return readTask(taskCid).then((task) => {
      if (!task || task.deleted) throw fail("TASK_NOT_FOUND");
      const taskId = taskIdOf(task, taskCid);
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        let failed = null;
        let out = null;
        let t;
        try { t = db.transaction(["subtasks", "_outbox", "_meta"], "readwrite"); } catch (err) { reject(err); return; }
        const st = t.objectStore("subtasks");
        const ob = t.objectStore("_outbox");
        const meta = t.objectStore("_meta");
        const abort = (err) => { failed = err; try { t.abort(); } catch (_) {} };
        const rq = st.index("task_cid").getAll(taskCid);
        rq.onsuccess = () => {
          const oq = ob.getAll();
          oq.onsuccess = () => {
            const queued = (oq.result || []).filter((o) => o && o.entity_type === ENTITY && o.task_cid === taskCid);
            const view = viewOf(rq.result || [], taskId);
            try {
              const plan = decide(view, queued);
              if (!plan || plan.error) { failed = fail(plan ? plan.error : "INVALID"); return; }
              out = { plan, view, wrote: commitPlan(st, ob, meta, view, plan, taskCid, abort) };
            } catch (err) {
              abort(err);
            }
          };
        };
        t.oncomplete = () => (failed ? reject(failed) : resolve(out));
        t.onerror = (ev) => reject(failed || (ev && ev.target && ev.target.error) || t.error);
        t.onabort = (ev) => reject(failed || (ev && ev.target && ev.target.error) || t.error || new Error("checklist aborted"));
      })).then(({ plan, view, wrote }) => {
        memApply((m) => {
          noteTask(m, task);
          for (const r of wrote.removed) dropItem(m, r);
          for (const r of wrote.put) addItem(m, r);
          if (plan.clearRev) m.revs.set(taskCid, null);
        });
        const items = plan.items || view.items;
        const tp = progressOf(items, task);
        const queuedChanged = (plan.ops && plan.ops.length) || (plan.drop && plan.drop.length) || (plan.rewrite && plan.rewrite.length);
        return C.writeTaskProgress(taskCid, tp)
          .then(() => {
            if (queuedChanged) {
              const first = plan.ops && plan.ops.length ? plan.ops[0].cid : null;
              emit("tf:outbox-queued", first != null ? { entity: ENTITY, cid: first } : { entity: ENTITY });
            }
            // `out` = penerjemah id pandangan sesudah aksi (butir baru belum ada di pandangan lama → id-nya cid apa adanya).
            return { items: outItems(view, items), task_progress: tp, result: plan.result || {}, out: view.out };
          });
      });
    });
  }

  // Aksi atas satu butir (id = cid / id server): task-nya dari record, butir dicek ulang di dalam transaksi.
  function runItem(id, decideFor) {
    return findItem(id).then((rec) => {
      if (!rec) throw fail("NOT_FOUND");
      return runAction(rec.task_cid, (view, queued) => {
        if (!view.apiOf.has(rec.cid)) return { error: "NOT_FOUND" };
        return decideFor(view, queued, rec.cid, view.apiOf.get(rec.cid));
      });
    });
  }
  const itemIn = (items, id) => items.find((x) => x.id === id) || null;

  // POST /api/tasks/:id/subtasks. body {title, parent_id, index, client_id}. → {item, items, task_progress}.
  function create(taskCid, body) {
    const b = body || {};
    const clientId = typeof b.client_id === "string" && b.client_id.trim() ? b.client_id.trim() : null;
    let newId = null;
    return runAction(taskCid, (view) => {
      if (clientId) {
        const prev = view.recs.find((r) => r.client_id === clientId);
        if (prev) { newId = view.apiOf.get(prev.cid); return { items: null, result: {} }; }
      }
      const cid = newCid();
      const parent = apiIdIn(view, b.parent_id);
      const r = C.applyCreate(view.items, { id: cid, task_id: view.taskId, title: b.title, parent_id: parent,
        index: normIndex(b.index) });
      if (r.error) return { error: r.error };
      newId = cid;
      return {
        items: r.items,
        create: { cid: cid, client_id: clientId, created_at: nowIso() },
        ops: [{ op: "create", cid: cid,
          payload: { title: r.item.title, parent_cid: parent == null ? null : view.cidOf.get(parent), index: normIndex(b.index) } }],
        result: {},
      };
    }).then((res) => ({ item: itemIn(res.items, res.out(newId)), items: res.items, task_progress: res.task_progress }));
  }

  // PATCH /api/subtasks/:id (`title` dan/atau `is_done`) dan toggle (`{toggle: true}`): ubah teks lalu centang SET,
  // urutan dan aturan update_subtask. → {item, items, changed_ids, task_progress}.
  function change(id, ch) {
    return runItem(id, (view, queued, cid, apiId) => {
      const hasTitle = ch.title !== undefined && ch.title !== null;
      const hasDone = !!ch.toggle || (ch.is_done !== undefined && ch.is_done !== null);
      if (!hasTitle && !hasDone) return { error: "NO_CHANGE" };
      let items = view.items;
      let dirty = false;
      const ops = [];
      if (hasTitle) {
        const r = C.applyRename(items, apiId, ch.title);
        if (r.error) return { error: r.error };
        if (r.changed) { items = r.items; dirty = true; ops.push({ op: "rename", cid: cid, payload: { title: r.item.title } }); }
      }
      let changed = [];
      if (hasDone) {
        const done = ch.toggle ? !itemIn(items, apiId).is_done : !!ch.is_done;
        const r = C.applySetDone(items, apiId, done);
        changed = r.changed_ids;
        if (changed.length) {
          items = r.items;
          dirty = true;
          const payload = { is_done: done };
          // Butir lain yang ikut berubah lewat centang berantai (hanya lokal; push cukup mengirim is_done). Dipakai
          // `remove` bila entri ini dibuang: efek berantainya ke butir yang tidak ikut terhapus diganti entri sendiri.
          const cascade = changed.filter((a) => a !== apiId).map((a) => view.cidOf.get(a));
          if (cascade.length) payload.cascade_cids = cascade;
          ops.push({ op: "set_done", cid: cid, payload: payload });
        }
      }
      return { items: dirty ? items : null, ops, result: { id: apiId, changed_ids: changed } };
    }).then((res) => ({
      item: itemIn(res.items, res.out(res.result.id)), items: res.items, changed_ids: (res.result.changed_ids || []).map(res.out),
      task_progress: res.task_progress,
    }));
  }
  const patch = (id, body) => change(id, body || {});
  const setDone = (id, done) => change(id, { is_done: !!done });
  const toggle = (id) => change(id, { toggle: true });

  // POST /api/subtasks/:id/move. → {items, task_progress}.
  function move(id, parentId, index) {
    return runItem(id, (view, queued, cid, apiId) => {
      const parent = apiIdIn(view, parentId);
      const err = C.moveError(view.items, apiId, parent);
      if (err) return { error: err };
      const idx = normIndex(index);
      const next = C.applyMove(view.items, apiId, parent, idx);
      if (!next) return { error: "INVALID" };
      if (sameTree(next, view.items)) return { items: null, result: {} };
      return {
        items: next,
        ops: [{ op: "move", cid: cid, payload: { parent_cid: parent == null ? null : view.cidOf.get(parent), index: idx } }],
        result: {},
      };
    }).then((res) => ({ items: res.items, task_progress: res.task_progress }));
  }

  // DELETE /api/subtasks/:id. → {items, deleted_ids, task_progress}.
  function remove(id) {
    return runItem(id, (view, queued, cid, apiId) => {
      const r = C.applyDelete(view.items, apiId);
      const parentOf = new Map(view.items.map((it) => [it.id, it.parent_id]));
      const unsynced = new Set();
      const synced = new Set();
      for (const a of r.deleted_ids) {
        const c = view.cidOf.get(a);
        (view.byCid.get(c).server_id == null ? unsynced : synced).add(c);
      }
      const intoDropped = (o) => (o.op === "create" || o.op === "move") && !!o.payload && o.payload.parent_cid != null
        && unsynced.has(o.payload.parent_cid);
      const drop = [];
      const rewrite = [];
      for (const o of queued) {
        if (unsynced.has(o.cid) || (synced.has(o.cid) && intoDropped(o))) { drop.push(o.qid); continue; }
        // Perbaikan review W1: entri create/move butir LAIN (tidak ikut terhapus) yang induknya butir belum terkirim
        // yang dibuang → ditulis ulang ke {parent_cid: null, index: null} (akhir level atas), supaya tidak ada entri
        // yang menunjuk induk yang tidak akan pernah ada di server. Aman: butir itu pernah menjadi anak LANGSUNG
        // butir yang dibuang dan kini tidak lagi di dalam subtree-nya. Memindah leluhur tidak mengeluarkan anak
        // dari subtree, jadi butir itu sendiri pasti punya `move` SESUDAH entri ini; `move` terakhirnya menunjuk
        // induknya sekarang (tidak ikut terhapus → tidak ditulis ulang) dan dihitung tanpa butir itu sendiri,
        // sehingga posisi akhirnya sama. Posisi sementara di AKHIR level atas tidak mengubah urutan relatif butir
        // lain (index ≤ n jatuh sebelumnya, index > n tetap sesudahnya, lalu butir itu pindah). Rev tetap
        // dikosongkan (lihat bawah) sebagai jaring pengaman.
        if (intoDropped(o)) {
          rewrite.push(Object.assign({}, o, { payload: Object.assign({}, o.payload, { parent_cid: null, index: null }) }));
        }
      }
      const ops = [];
      for (const a of r.deleted_ids) {
        const c = view.cidOf.get(a);
        if (!synced.has(c)) continue;
        const p = parentOf.get(a);
        const pc = p == null ? null : view.cidOf.get(p);
        if (pc == null || !synced.has(pc)) ops.push({ op: "delete", cid: c, payload: {} });
      }
      // Centang berantai dari entri set_done(true) yang dibuang tidak pernah terjadi di server: butir yang ikut
      // tercentang lalu keluar dari subtree yang dihapus akan terbuka lagi sesudah sinkron. Ganti efeknya: set_done
      // true untuk butir terdampak yang kini selesai (pre-order), lalu set_done false untuk turunannya yang kini
      // terbuka (true berantai di server; false tidak). Butir yang kini terbuka tidak disentuh.
      const dropSet = new Set(drop);
      const hit = new Set();
      for (const o of queued) {
        if (!dropSet.has(o.qid) || o.op !== "set_done" || !o.payload || !o.payload.is_done) continue;
        for (const c of o.payload.cascade_cids || []) if (view.byCid.has(c) && !unsynced.has(c) && !synced.has(c)) hit.add(c);
      }
      if (hit.size) {
        const after = r.items;
        const fixed = new Set();
        for (let i = 0; i < after.length; i++) {
          const c = view.cidOf.get(after[i].id);
          if (!hit.has(c) || !after[i].is_done) continue;
          ops.push({ op: "set_done", cid: c, payload: { is_done: true } });
          for (let j = i + 1; j < after.length && after[j].depth > after[i].depth; j++) fixed.add(j);
        }
        for (const j of Array.from(fixed).sort((x, y) => x - y)) {
          if (!after[j].is_done) ops.push({ op: "set_done", cid: view.cidOf.get(after[j].id), payload: { is_done: false } });
        }
      }
      let clearRev = rewrite.length > 0;
      if (drop.length) {
        const first = Math.min.apply(null, drop);
        clearRev = clearRev || queued.some((o) => !dropSet.has(o.qid) && o.qid > first);
      }
      return { items: r.items, ops, drop, rewrite, clearRev, result: { deleted_ids: r.deleted_ids } };
    }).then((res) => ({ items: res.items, deleted_ids: (res.result.deleted_ids || []).map(res.out), task_progress: res.task_progress }));
  }

  // ── rev tersimpan dan unduhan awal ───────────────────────────────────────────

  function getRevs() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("_meta", "readonly").objectStore("_meta").get(REVS_KEY);
      r.onsuccess = () => resolve(isObj(r.result) ? Object.assign({}, r.result) : {});
      r.onerror = () => reject(r.error);
    }));
  }
  // rev angka → simpan; selain itu null (= dikosongkan: diambil ulang, task tetap dikenal).
  function setRev(taskCid, rev) {
    const val = revVal(rev);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction("_meta", "readwrite");
      const os = t.objectStore("_meta");
      const r = os.get(REVS_KEY);
      r.onsuccess = () => {
        const o = Object.assign({}, isObj(r.result) ? r.result : {});
        o[taskCid] = val;
        os.put(o, REVS_KEY);
      };
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    })).then(() => {
      memApply((m) => { m.revs.set(taskCid, val); });
      // id server task (task yang diketahui pull sesudah memori dimuat) → routing ber-id server mengenalnya
      return readTask(taskCid).then((task) => { memApply((m) => noteTask(m, task)); }, () => {});
    });
  }
  const clearRev = (taskCid) => setRev(taskCid, null);

  // Banyak rev sekaligus (pullChecklists: aturan rev 0 tanpa unduh untuk semua task tanpa checklist) dalam SATU
  // transaksi _meta. `pairs` = [[task_cid, rev], …]; opts.onlyIfAbsent → kunci yang sudah ada (termasuk null = ambil
  // ulang) tidak ditimpa, dicek di transaksi yang sama. Id server task dicatat di memori seperti setRev.
  // → jumlah kunci yang ditulis.
  function setRevs(pairs, opts) {
    const onlyIfAbsent = !!(opts && opts.onlyIfAbsent);
    const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p[0] != null && p[0] !== "");
    if (!list.length) return Promise.resolve(0);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const written = [];
      const t = db.transaction("_meta", "readwrite");
      const os = t.objectStore("_meta");
      const r = os.get(REVS_KEY);
      r.onsuccess = () => {
        const o = Object.assign({}, isObj(r.result) ? r.result : {});
        for (const [cid, rev] of list) {
          if (onlyIfAbsent && Object.prototype.hasOwnProperty.call(o, cid)) continue;
          o[cid] = revVal(rev);
          written.push([cid, o[cid]]);
        }
        if (written.length) os.put(o, REVS_KEY);
      };
      t.oncomplete = () => resolve(written);
      t.onerror = () => reject(t.error);
    })).then((written) => {
      if (!written.length) return 0;
      memApply((m) => { for (const [cid, v] of written) m.revs.set(cid, v); });
      return readTasks(written.map((w) => w[0]))
        .then((tasks) => { memApply((m) => { for (const tk of tasks) noteTask(m, tk); }); }, () => {})
        .then(() => written.length);
    });
  }
  function readTasks(cids) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const out = [];
      const t = db.transaction("tasks", "readonly");
      const os = t.objectStore("tasks");
      for (const c of cids) { const r = os.get(c); r.onsuccess = () => { if (r.result) out.push(r.result); }; }
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    }));
  }

  // Id server task baru diketahui di luar modul ini (create task terkirim, syncpush): catat di memori supaya
  // GET/POST checklist ber-id server langsung dikenal tanpa menunggu pull / muat ulang. Sinkron, tanpa IndexedDB.
  function noteTaskServerId(taskCid, serverId) {
    if (taskCid == null || serverId == null || serverId === "") return;
    memApply((m) => { m.taskSid.set(String(serverId), taskCid); });
  }

  function markHydrated() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction("_meta", "readwrite");
      t.objectStore("_meta").put(true, HYDRATED_KEY);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    })).then(() => { memApply((m) => { m.hydrated = true; }); });
  }

  // ── ganti isi dari server (pull) ─────────────────────────────────────────────

  // Ganti checklist task dengan snapshot server (`items` bentuk GET …/subtasks) dalam SATU transaksi: butir yang id
  // servernya dikenal (_idmap "subtask", lalu record) mempertahankan cid; butir baru cid baru; butir lokal yang tidak
  // ada di snapshot (termasuk yang tanpa id server) dihapus; rev tersimpan = `rev`. Task yang masih punya entri
  // antrean subtasks TIDAK diganti (E5; dicek di transaksi yang sama) → false. Selesai → true.
  function replaceTaskChecklist(taskCid, serverItems, rev) {
    const list = (Array.isArray(serverItems) ? serverItems : []).filter((s) => s && s.id != null);
    const val = revVal(rev);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let res = { replaced: false, put: [], removed: [] };
      let t;
      try { t = db.transaction(["subtasks", "_idmap", "_meta", "_outbox"], "readwrite"); } catch (err) { reject(err); return; }
      const st = t.objectStore("subtasks");
      const im = t.objectStore("_idmap");
      const meta = t.objectStore("_meta");
      const ob = t.objectStore("_outbox");
      const oq = ob.getAll();
      oq.onsuccess = () => {
        if ((oq.result || []).some((o) => o && o.entity_type === ENTITY && o.task_cid === taskCid)) return;
        const lq = st.index("task_cid").getAll(taskCid);
        lq.onsuccess = () => {
          const locals = lq.result || [];
          const known = new Map(); // id server → cid
          let left = list.length;
          const proceed = () => {
            const bySid = new Map(locals.filter((r) => r.server_id != null).map((r) => [String(r.server_id), r]));
            const byCid = new Map(locals.map((r) => [r.cid, r]));
            const cidFor = new Map();
            for (const s of list) {
              const k = String(s.id);
              cidFor.set(k, known.get(k) || (bySid.get(k) ? bySid.get(k).cid : null) || newCid());
            }
            const keep = new Set();
            for (const s of list) {
              const cid = cidFor.get(String(s.id));
              const cur = byCid.get(cid) || bySid.get(String(s.id)) || null;
              const next = Object.assign({}, cur || {}, {
                cid: cid, server_id: s.id, task_cid: taskCid,
                parent_cid: s.parent_id == null ? null : (cidFor.get(String(s.parent_id)) || null),
                title: s.title != null ? s.title : "", is_done: !!s.is_done,
                sort_order: s.sort_order == null ? null : s.sort_order,
                created_at: cur && cur.created_at != null ? cur.created_at : (s.created_at != null ? s.created_at : null),
              });
              st.put(next);
              res.put.push(next);
              keep.add(cid);
              if (known.get(String(s.id)) !== cid) im.put({ key: mapKey(s.id), entity_type: MAP_TYPE, server_id: s.id, cid: cid });
            }
            for (const r of locals) {
              if (keep.has(r.cid)) continue;
              st.delete(r.cid);
              res.removed.push(r);
              if (r.server_id != null && !cidFor.has(String(r.server_id))) im.delete(mapKey(r.server_id));
            }
            const mr = meta.get(REVS_KEY);
            mr.onsuccess = () => {
              const o = Object.assign({}, isObj(mr.result) ? mr.result : {});
              o[taskCid] = val;
              meta.put(o, REVS_KEY);
            };
            res.replaced = true;
          };
          if (!left) { proceed(); return; }
          for (const s of list) {
            const g = im.get(mapKey(s.id));
            g.onsuccess = () => {
              if (g.result && g.result.cid != null) known.set(String(s.id), g.result.cid);
              if (--left === 0) proceed();
            };
          }
        };
      };
      t.oncomplete = () => resolve(res);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("checklist replace aborted"));
    })).then((res) => {
      if (!res.replaced) return false;
      memApply((m) => {
        for (const r of res.removed) dropItem(m, r);
        for (const r of res.put) addItem(m, r);
        m.revs.set(taskCid, val);
      });
      return readTask(taskCid).then((task) => { memApply((m) => noteTask(m, task)); return true; }, () => true);
    });
  }

  // Buang checklist task (task dihapus lokal / hilang dari server): butir, entri antrean subtasks task itu, rev
  // tersimpan, dan _idmap butirnya — satu transaksi.
  function purgeTask(taskCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let removed = [];
      const t = db.transaction(["subtasks", "_outbox", "_meta", "_idmap"], "readwrite");
      const st = t.objectStore("subtasks");
      const ob = t.objectStore("_outbox");
      const meta = t.objectStore("_meta");
      const im = t.objectStore("_idmap");
      const lq = st.index("task_cid").getAll(taskCid);
      lq.onsuccess = () => {
        removed = lq.result || [];
        for (const r of removed) {
          st.delete(r.cid);
          if (r.server_id != null) im.delete(mapKey(r.server_id));
        }
      };
      const oq = ob.getAll();
      oq.onsuccess = () => {
        for (const o of oq.result || []) if (o && o.entity_type === ENTITY && o.task_cid === taskCid) ob.delete(o.qid);
      };
      const mr = meta.get(REVS_KEY);
      mr.onsuccess = () => {
        if (!isObj(mr.result) || !(taskCid in mr.result)) return;
        const o = Object.assign({}, mr.result);
        delete o[taskCid];
        meta.put(o, REVS_KEY);
      };
      t.oncomplete = () => resolve(removed);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("checklist purge aborted"));
    })).then((removed) => {
      memApply((m) => {
        for (const r of removed) dropItem(m, r);
        m.revs.delete(taskCid);
      });
    });
  }

  // ── id server dari push ──────────────────────────────────────────────────────

  // Butir `cid` mendapat id server (create terkirim): record + _idmap "subtask" dalam satu transaksi. Record tidak
  // ada → false: butir itu dihapus lokal SAAT create-nya sedang terkirim (`remove` membuang entri create yang belum
  // selesai), jadi server kini punya butir "hantu" yang tidak dikenal perangkat ini — push (handler subtasks) WAJIB
  // mengirim DELETE /api/subtasks/{serverId} untuknya.
  function adoptServerId(cid, serverId) {
    if (cid == null || serverId == null) return Promise.resolve(false);
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let saved = null;
      const t = db.transaction(["subtasks", "_idmap"], "readwrite");
      const st = t.objectStore("subtasks");
      const r = st.get(cid);
      r.onsuccess = () => {
        if (!r.result) return;
        saved = Object.assign({}, r.result, { server_id: serverId });
        st.put(saved);
        t.objectStore("_idmap").put({ key: mapKey(serverId), entity_type: MAP_TYPE, server_id: serverId, cid: cid });
      };
      t.oncomplete = () => resolve(saved);
      t.onerror = () => reject(t.error);
    })).then((saved) => {
      if (!saved) return false;
      memApply((m) => addItem(m, saved));
      return true;
    });
  }

  const api = {
    STORE, ENTITY, MAP_TYPE, REVS_KEY, HYDRATED_KEY,
    start, refresh, reset, isReady, knowsTask, knowsItem,
    resolveTask, findItem, recordsForTask, itemsForTask, pendingTaskCids,
    create, setDone, toggle, patch, move, remove,
    getRevs, setRev, setRevs, clearRev, markHydrated, replaceTaskChecklist, purgeTask, adoptServerId, noteTaskServerId,
  };
  // Browser: memori kesiapan dimuat saat modul dimuat (Node/tes memanggil start() sendiri).
  if (!isNode) { try { start(); } catch (_) {} }
  return isNode ? Object.assign({ _reset: reset }, api) : api;
});
