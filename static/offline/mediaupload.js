;(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.mediaupload = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Manajer unggah audio/video bertahap (resumable) untuk note. Tanpa DOM.
  // Satu loop per cid: init → PATCH potongan (Upload-Offset) → complete.
  // Gangguan jaringan/5xx → fase 'waiting' dengan jeda 1,2,4,8,16,30 dtk; kick() mencoba langsung.
  const isNode = (typeof module !== "undefined" && module.exports);
  const dirNode = isNode ? require("./mediadirective.js") : null;
  // mediadirective.js dimuat sebelum modul ini, tetapi tetap dicari saat dipakai (seperti drawingshare).
  function dir() { return dirNode || (root.TF && root.TF.mediadirective); }

  const MiB = 1024 * 1024;
  const STORAGE_KEY = "tf_media_uploads";
  const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
  const MSG_TOO_BIG = "File terlalu besar (maks 2 GB)";
  const MSG_FORMAT = "Format tidak didukung";
  const MSG_MISMATCH = "File berbeda — pilih file yang sama dengan yang diunggah";
  const MSG_GENERIC = "Unggahan gagal. Coba lagi.";
  const MSG_NOT_FOUND = "Unggahan tidak ditemukan di server";
  const MSG_NO_ENTRY = "Data unggahan tidak ditemukan";
  const MSG_UNREADABLE = "File tidak bisa dibaca — pilih ulang file";
  // Exception tak dikenal (bukan sinyal/jaringan) berturut-turut sebelum menyerah.
  const MAX_UNKNOWN_ERRORS = 3;

  // Sinyal kontrol di dalam loop.
  function Fail(msg, drop, retryable) { return { kind: "fail", msg, drop: drop !== false, retryable: !!retryable }; }
  const RETRY = { kind: "retry" };
  const DONE = { kind: "done" };
  const CANCELED = { kind: "canceled" };
  const ABORTED = { kind: "aborted" }; // abortAll (logout): berhenti diam-diam, tanpa DELETE/toast

  function createManager(deps) {
    const chunkSize = deps.chunkSize || 5 * MiB;
    const maxBytes = deps.maxBytes || 2048 * MiB;
    const setT = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearT = deps.clearTimeout || ((t) => clearTimeout(t));
    const online = () => (typeof deps.isOnline === "function" ? deps.isOnline() !== false : true);

    const ctxs = new Map();      // cid → ctx (loop yang sedang/pernah berjalan)
    const subs = new Set();

    // ── storage ──
    function readStore() {
      try {
        const raw = deps.storage && deps.storage.getItem(STORAGE_KEY);
        const o = raw ? JSON.parse(raw) : {};
        return o && typeof o === "object" ? o : {};
      } catch (e) { return {}; }
    }
    function writeStore(o) {
      try {
        if (!deps.storage) return;
        if (Object.keys(o).length) deps.storage.setItem(STORAGE_KEY, JSON.stringify(o));
        else deps.storage.removeItem(STORAGE_KEY);
      } catch (e) { /* storage boleh gagal */ }
    }
    function saveEntry(e) { const o = readStore(); o[e.cid] = e; writeStore(o); }
    function dropEntry(cid) { const o = readStore(); if (cid in o) { delete o[cid]; writeStore(o); } }

    // ── state ──
    function snapshot(ctx) {
      const s = { cid: ctx.cid, attId: ctx.attId, phase: ctx.phase, sent: ctx.sent, size: ctx.size, error: ctx.error };
      if (ctx.retryable) s.retryable = true; // "file berbeda"/"tidak bisa dibaca": UI boleh menawarkan pilih file lagi
      return s;
    }
    function emit(ctx) {
      const s = snapshot(ctx);
      subs.forEach((fn) => { try { fn(ctx.cid, s); } catch (e) { /* pelanggan tidak boleh mematahkan loop */ } });
    }
    function setPhase(ctx, phase, error) {
      if (ctx.aborted) return;
      ctx.phase = phase;
      ctx.error = error || null;
      emit(ctx);
    }
    const isLive = (ctx) => ctx.phase === "uploading" || ctx.phase === "waiting" || ctx.phase === "completing";

    // ── HTTP ──
    async function call(ctx, method, path, extra) {
      const headers = Object.assign({ Authorization: "Bearer " + (deps.getToken ? deps.getToken() : "") }, (extra && extra.headers) || {});
      const init = { method, headers };
      if (extra && extra.body !== undefined) init.body = extra.body;
      let res;
      try { res = await deps.fetch(deps.apiUrl(path), init); } catch (e) { if (ctx.aborted) throw ABORTED; if (ctx.canceled) throw CANCELED; throw RETRY; }
      if (ctx.aborted) throw ABORTED;
      if (ctx.canceled && !(extra && extra.passCancel)) throw CANCELED;
      let data = {};
      try { data = (await res.json()) || {}; } catch (e) { data = {}; }
      return { status: res.status, data };
    }
    function detailOf(r) {
      const d = r.data && r.data.detail;
      return typeof d === "string" && d ? d : MSG_GENERIC;
    }
    // Kegagalan umum: 5xx (kecuali 507) → coba ulang; 4xx/507 → gagal dengan detail.
    function classify(r) {
      if (r.status === 507) return Fail(detailOf(r));
      if (r.status >= 500) return RETRY;
      return Fail(detailOf(r));
    }

    // Tunggu (jeda atau offline). ms == null → hanya bangun lewat kick().
    function wait(ctx, ms) {
      setPhase(ctx, "waiting");
      return new Promise((resolve) => {
        let timer = null;
        ctx.wake = () => {
          ctx.wake = null;
          if (timer != null) clearT(timer);
          resolve();
        };
        if (ms != null) timer = setT(ctx.wake, ms);
      });
    }

    // ── langkah-langkah ──
    async function stepInit(ctx) {
      const f = ctx.file;
      const r = await call(ctx, "POST", "/api/scratchpad/" + encodeURIComponent(ctx.noteId) + "/media", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: ctx.cid, filename: f.name, size: f.size, mime: f.type || "application/octet-stream" }),
        passCancel: true,
      });
      if (ctx.canceled) {
        // Dibatalkan saat init berjalan: baris di server jangan yatim.
        if ((r.status === 200 || r.status === 201) && r.data.id != null) {
          ctx.attId = r.data.id;
          if (!ctx.deleted) { ctx.deleted = true; await sendDelete(ctx); }
        }
        throw CANCELED;
      }
      if (r.status !== 200 && r.status !== 201) throw classify(r);
      ctx.attId = r.data.id;
      saveEntry({ cid: ctx.cid, noteId: ctx.noteId, attId: ctx.attId, name: f.name, size: f.size, lastModified: f.lastModified });
      applyStatus(ctx, r.data);
    }
    // Menyalin received_bytes dari payload; status selain 'uploading' berarti sudah selesai diunggah.
    function applyStatus(ctx, d) {
      if (typeof d.received_bytes === "number") ctx.sent = Math.max(0, Math.min(d.received_bytes, ctx.size));
      if (d.status === "failed") throw Fail(typeof d.error === "string" && d.error ? d.error : MSG_GENERIC);
      if (d.status && d.status !== "uploading") throw DONE; // processing / ready
    }
    async function stepStatus(ctx) {
      const r = await call(ctx, "GET", "/api/media/" + ctx.attId + "/upload");
      if (r.status === 404) throw Fail(detailOf(r) === MSG_GENERIC ? MSG_NOT_FOUND : detailOf(r));
      if (r.status !== 200) throw classify(r);
      ctx.needStatus = false;
      applyStatus(ctx, r.data);
    }
    async function stepPatch(ctx) {
      const a = ctx.sent;
      const b = Math.min(a + chunkSize, ctx.size);
      setPhase(ctx, "uploading");
      const r = await call(ctx, "PATCH", "/api/media/" + ctx.attId + "/upload", {
        headers: { "Upload-Offset": String(a), "Content-Type": "application/offset+octet-stream" },
        body: await readSlice(ctx, a, b),
      });
      if (r.status === 200) {
        ctx.sent = typeof r.data.received_bytes === "number" ? Math.min(r.data.received_bytes, ctx.size) : b;
        ctx.attempt = 0;
        emit(ctx);
        return;
      }
      if (r.status === 409) {
        if (typeof r.data.received_bytes === "number") {
          const rb = Math.min(r.data.received_bytes, ctx.size);
          // Offset sama = permintaan lain sedang memegang kunci → beri jeda agar tidak berputar cepat.
          if (rb === a) throw RETRY;
          ctx.sent = rb;
          emit(ctx);
          return;
        }
        ctx.needStatus = true;
        return;
      }
      if (r.status === 404) throw Fail(detailOf(r) === MSG_GENERIC ? MSG_NOT_FOUND : detailOf(r));
      throw classify(r);
    }
    // Potongan dibaca dulu (bukan Blob lazy ke fetch): file yang berubah/hilang di disk melempar NotReadableError
    // di sini, bukan sebagai error fetch yang tak bisa dibedakan dari gangguan jaringan.
    async function readSlice(ctx, a, b) {
      let part;
      try {
        part = ctx.file.slice(a, b);
        if (part && typeof part.arrayBuffer === "function") {
          const buf = await part.arrayBuffer();
          part = typeof Blob === "function" ? new Blob([buf]) : buf;
        }
      } catch (e) {
        throw Fail(MSG_UNREADABLE, false, true);
      }
      if (ctx.aborted) throw ABORTED;
      if (ctx.canceled) throw CANCELED;
      return part;
    }
    async function stepComplete(ctx) {
      setPhase(ctx, "completing");
      const r = await call(ctx, "POST", "/api/media/" + ctx.attId + "/complete");
      if (r.status === 200) throw DONE;
      // 409 + received_bytes = server sibuk (kunci dipegang permintaan complete sebelumnya) → jeda lalu ulang.
      if (r.status === 409 && typeof r.data.received_bytes === "number") throw RETRY;
      if (r.status === 409) { ctx.needStatus = true; ctx.sent = Math.min(ctx.sent, ctx.size); ctx.confirm = true; return; }
      if (r.status === 404) throw Fail(detailOf(r) === MSG_GENERIC ? MSG_NOT_FOUND : detailOf(r));
      throw classify(r);
    }

    async function drive(ctx) {
      for (;;) {
        if (ctx.aborted) return finish(ctx, ABORTED);
        if (ctx.canceled) return finish(ctx, CANCELED);
        if (!online()) { await wait(ctx, null); continue; }
        try {
          if (ctx.attId == null) await stepInit(ctx);
          else if (ctx.needStatus) {
            setPhase(ctx, "uploading");
            await stepStatus(ctx);
            // 409 pada complete tetapi status masih 'uploading' dan sudah lengkap → tidak ada kemajuan lagi.
            if (ctx.confirm && ctx.sent >= ctx.size) { ctx.confirm = false; throw Fail("Gagal menyelesaikan unggahan"); }
          } else if (ctx.sent < ctx.size) await stepPatch(ctx);
          else await stepComplete(ctx);
        } catch (sig) {
          if (ctx.aborted) return finish(ctx, ABORTED);
          if (!sig || !sig.kind) {
            // Exception tak dikenal: coba ulang dengan jeda, tetapi tidak tanpa batas.
            ctx.unknownErrors = (ctx.unknownErrors || 0) + 1;
            sig = ctx.unknownErrors >= MAX_UNKNOWN_ERRORS ? Fail(MSG_GENERIC, false, true) : RETRY;
          }
          if (sig === RETRY) {
            if (ctx.canceled) return finish(ctx, CANCELED);
            const ms = BACKOFF_MS[Math.min(ctx.attempt, BACKOFF_MS.length - 1)];
            ctx.attempt++;
            await wait(ctx, ms);
            continue;
          }
          return finish(ctx, sig);
        }
        // Langkah berhasil → jeda ulang mulai lagi dari 1 dtk.
        ctx.attempt = 0;
        ctx.unknownErrors = 0;
        if (ctx.aborted) return finish(ctx, ABORTED);
        // Init berhasil di tengah pembatalan → hapus lampiran yatim di server.
        if (ctx.canceled) return finish(ctx, CANCELED);
      }
    }

    function finish(ctx, sig) {
      ctx.wake = null;
      if (sig.kind === "aborted" || ctx.aborted) {
        // Logout: tanpa DELETE, tanpa emit (tidak ada toast), storage dibersihkan pemanggil.
        ctx.phase = "aborted";
        return snapshot(ctx);
      }
      if (sig.kind === "done") {
        ctx.sent = ctx.size;
        dropEntry(ctx.cid);
        setPhase(ctx, "done");
      } else if (sig.kind === "fail") {
        if (sig.drop) dropEntry(ctx.cid);
        if (sig.retryable) ctx.retryable = true;
        setPhase(ctx, "failed", sig.msg);
      } else {
        // canceled: cancel() sudah menangani DELETE, storage, dan state.
        if (ctx.attId != null && !ctx.deleted) { ctx.deleted = true; sendDelete(ctx); }
        dropEntry(ctx.cid);
        setPhase(ctx, "canceled");
      }
      return snapshot(ctx);
    }
    function sendDelete(ctx) {
      const headers = { Authorization: "Bearer " + (deps.getToken ? deps.getToken() : "") };
      try {
        const p = deps.fetch(deps.apiUrl("/api/scratchpad/attachments/" + ctx.attId), { method: "DELETE", headers });
        return Promise.resolve(p).catch(() => {});
      } catch (e) { return Promise.resolve(); }
    }

    function newCtx(cid, file, noteId, attId) {
      return { cid, file, noteId, attId: attId == null ? null : attId, sent: 0, size: file.size, phase: "uploading", error: null,
        attempt: 0, unknownErrors: 0, wake: null, canceled: false, aborted: false, needStatus: attId != null, deleted: false, confirm: false, promise: null };
    }
    function failNow(ctx, msg, retryable) {
      if (retryable) ctx.retryable = true;
      ctx.promise = Promise.resolve(null);
      setPhase(ctx, "failed", msg);
      return Promise.resolve(snapshot(ctx));
    }

    // ── API publik ──
    function start(opts) {
      const { file, noteId, cid } = opts;
      const live = ctxs.get(cid);
      if (live && isLive(live) && live.promise) return live.promise;
      const ctx = newCtx(cid, file, noteId, null);
      ctxs.set(cid, ctx);
      const d = dir();
      if (d && !d.isMediaFileName(file.name)) return failNow(ctx, MSG_FORMAT);
      if (file.size > maxBytes) return failNow(ctx, MSG_TOO_BIG);
      emit(ctx);
      ctx.promise = drive(ctx);
      return ctx.promise;
    }

    function resume(cid, file) {
      const live = ctxs.get(cid);
      if (live && isLive(live) && live.promise) return live.promise;
      const e = readStore()[cid];
      if (!e) {
        const c = newCtx(cid, file, null, null);
        ctxs.set(cid, c);
        return failNow(c, MSG_NO_ENTRY);
      }
      const ctx = newCtx(cid, file, e.noteId, e.attId);
      ctx.size = e.size;
      ctxs.set(cid, ctx);
      if (file.name !== e.name || file.size !== e.size || file.lastModified !== e.lastModified) return failNow(ctx, MSG_MISMATCH, true);
      emit(ctx);
      ctx.promise = drive(ctx);
      return ctx.promise;
    }

    async function cancel(cid) {
      const ctx = ctxs.get(cid);
      if (!ctx) {
        // Entri lama tanpa loop (mis. setelah reload): hapus lampiran di server + storage.
        const e = readStore()[cid];
        if (!e) return;
        dropEntry(cid);
        await sendDelete({ attId: e.attId });
        return;
      }
      if (ctx.phase === "done" || ctx.phase === "canceled") return;
      const wasLive = isLive(ctx);
      ctx.canceled = true;
      if (ctx.wake) ctx.wake();
      const e = readStore()[cid];
      const attId = ctx.attId != null ? ctx.attId : (e && e.attId);
      dropEntry(cid);
      if (attId != null && !ctx.deleted) { ctx.deleted = true; await sendDelete({ attId }); }
      if (!wasLive) { setPhase(ctx, "canceled"); }
      else if (ctx.phase !== "canceled") { ctx.phase = "canceled"; ctx.error = null; emit(ctx); }
    }

    function get(cid) {
      const c = ctxs.get(cid);
      return c ? snapshot(c) : null;
    }
    function pending() {
      return Object.keys(readStore()).map((k) => readStore()[k]);
    }
    function subscribe(fn) {
      subs.add(fn);
      return function () { subs.delete(fn); };
    }
    function kick() {
      Array.from(ctxs.values()).forEach((c) => { if (c.wake) c.wake(); });
    }
    // Logout: hentikan semua loop dan timer jeda tanpa DELETE dan tanpa event (tidak ada toast gagal).
    // Respons yang masih dalam perjalanan diabaikan. Storage tidak disentuh (dibersihkan clearLocalUserData).
    function abortAll() {
      Array.from(ctxs.values()).forEach((c) => {
        c.aborted = true;
        if (c.wake) c.wake();
      });
      ctxs.clear();
    }
    function hasActive() {
      for (const c of ctxs.values()) if (isLive(c)) return true;
      return false;
    }

    return { start, resume, cancel, get, pending, subscribe, kick, hasActive, abortAll };
  }

  return { createManager, STORAGE_KEY };
});
