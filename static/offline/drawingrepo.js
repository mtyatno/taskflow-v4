;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFblob = req("./blobstore.js", root.TF && root.TF.blobstore);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  const BlobStore = TFblob.makeBlobStore();
  let _fetcher = null;

  // User saat ini (diisi index.html seperti mindmaprepo). null = belum diketahui.
  let _currentUser = null;
  function setCurrentUser(u) { _currentUser = u || null; }
  function currentUid() { return (_currentUser && _currentUser.user_id != null) ? _currentUser.user_id : null; }
  // Guard pemilik lokal: tolak hanya bila baris punya user_id non-null, uid saat ini diketahui, dan beda.
  // Baris tanpa user_id (legacy lokal) dianggap milik sendiri.
  function isOthers(rec) {
    const me = currentUid();
    return !!rec && rec.user_id != null && me != null && String(rec.user_id) !== String(me);
  }
  function ownerOnlyError() {
    const e = new Error("Hanya pemilik drawing");
    e.status = 403;
    e.body = { detail: "Hanya pemilik drawing" };
    return e;
  }
  // Field scope workspace/kolaborator dari baris server (null bila tidak ada).
  function scopeFromServer(s) {
    const nn = (v) => (v != null ? v : null);
    return {
      list_id: nn(s.list_id), user_id: nn(s.user_id), last_edited_by: nn(s.last_edited_by),
      last_editor_username: nn(s.last_editor_username), last_editor_display_name: nn(s.last_editor_display_name),
    };
  }
  function scopeOf(r) {
    const nn = (v) => (v != null ? v : null);
    return {
      list_id: nn(r.list_id), user_id: nn(r.user_id), last_edited_by: nn(r.last_edited_by),
      last_editor_username: nn(r.last_editor_username), last_editor_display_name: nn(r.last_editor_display_name),
    };
  }

  function tsEpoch(ts) {
    if (ts == null) return 0;
    const s = String(ts);
    const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
    const v = Date.parse(hasTz ? s : s + "Z");
    return isNaN(v) ? 0 : v;
  }

  // Timestamp server bisa bermikrodetik; Date.parse memotong ke milidetik → tambahkan digit sisanya.
  function tsPrecise(ts) {
    if (ts == null) return 0;
    const str = String(ts);
    const m = str.match(/T\d\d:\d\d:\d\d\.(\d+)/);
    const sub = (m && m[1].length > 3) ? Number("0." + m[1].slice(3)) : 0;
    return tsEpoch(str) + sub;
  }
  // true bila revisi server a LEBIH BARU dari b (b kosong = belum pernah sinkron → a dianggap lebih baru).
  function tsNewer(a, b) {
    if (a == null || a === "") return false;
    if (b == null || b === "") return true;
    return tsPrecise(a) > tsPrecise(b);
  }

  function getAllRaw() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  function matchesClientId(d, id) {
    return !!(d && d.note_cid === undefined && d.client_id != null && String(d.client_id) === String(id));
  }

  function getRaw(idOrCid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      try {
        const os = db.transaction("drawings", "readonly").objectStore("drawings");
        // id direktif note dari mesin lain = client_id server (cid lokal bisa berbeda, mis. dibuat pull)
        const scanClientId = () => {
          const all = os.getAll();
          all.onsuccess = () => resolve((all.result || []).find((d) => matchesClientId(d, idOrCid)) || null);
          all.onerror = () => resolve(null);
        };
        const r = os.get(idOrCid);
        r.onsuccess = () => {
          if (r.result) return resolve(r.result);
          if (os.indexNames.contains("server_id")) {
            try {
              const idx = os.index("server_id");
              const numericId = Number(idOrCid);
              const reqIdx = !isNaN(numericId) ? idx.get(numericId) : idx.get(idOrCid);
              reqIdx.onsuccess = () => (reqIdx.result ? resolve(reqIdx.result) : scanClientId());
              reqIdx.onerror = () => resolve(null);
              return;
            } catch (_) {}
          }
          // Fallback scan if index doesn't exist
          const allReq = os.getAll();
          allReq.onsuccess = () => {
            const num = Number(idOrCid);
            const found = (allReq.result || []).find(d => d && (d.server_id == idOrCid || (!isNaN(num) && d.server_id == num)))
              || (allReq.result || []).find(d => matchesClientId(d, idOrCid));
            resolve(found || null);
          };
          allReq.onerror = () => resolve(null);
        };
        r.onerror = () => reject(r.error);
      } catch (err) {
        resolve(null);
      }
    }));
  }

  function getRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    }));
  }
  function readBytes(ref) {
    return ref ? Promise.resolve(BlobStore.getBytes(ref)).catch(() => undefined) : Promise.resolve(undefined);
  }
  // Baca record TERKINI + isi blob-nya secara konsisten. Blob tidak ada (baru diganti edit bersamaan
  // yang menghapus blob lama) → baca ulang record sekali lagi. Resolve { rec, bytes }.
  function readDrawingState(cid) {
    return getRec(cid).then((rec) => {
      if (!rec) return { rec: null, bytes: undefined };
      return readBytes(rec.blob_ref).then((bytes) => {
        if (bytes !== undefined || !rec.blob_ref) return { rec, bytes };
        return getRec(cid).then((rec2) => {
          if (!rec2) return { rec: null, bytes: undefined };
          if (rec2.blob_ref === rec.blob_ref) return { rec: rec2, bytes: undefined };
          return readBytes(rec2.blob_ref).then((b2) => ({ rec: rec2, bytes: b2 }));
        });
      });
    });
  }

  function putRec(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("drawings", "readwrite");
      tx.objectStore("drawings").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  // ── Mutasi atomik & revisi lokal ────────────────────────────────────────────
  // `rev` = penghitung versi record lokal (undefined → 0): naik setiap isi record berubah
  // (edit user, gabung/adopsi data server). Push/pull/getDrawing memakai `rev` sebagai CAS:
  // tulis setelah jeda async hanya bila rev masih sama dengan saat dibaca.

  // Satu transaksi readwrite: get(cid) → next = fn(current) (sinkron; undefined/null = batal) → put(next).
  // Resolve record yang ditulis, atau null bila batal. Semua penulisan record setelah jeda async
  // (repo, push, pull) WAJIB lewat sini agar tidak pernah menulis objek basi.
  function mutateDrawing(cid, fn) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let out = null;
      let failed = null;
      const tx = db.transaction("drawings", "readwrite");
      const os = tx.objectStore("drawings");
      const r = os.get(cid);
      r.onsuccess = () => {
        let next;
        try { next = fn(r.result || null); } catch (err) { failed = err; try { tx.abort(); } catch (_) {} return; }
        if (next == null) return;
        os.put(next);
        out = next;
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(failed || tx.error);
      tx.onabort = () => reject(failed || tx.error || new Error("drawing mutation aborted"));
    }));
  }

  // Sisipkan record dari server bila belum ada — cek cid DAN server_id di transaksi yang sama
  // (idempoten terhadap getDrawing bersamaan / record yang sudah dibuat pull dengan cid lain).
  function insertDrawingIfAbsent(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let out = null;
      const tx = db.transaction("drawings", "readwrite");
      const os = tx.objectStore("drawings");
      const r = os.get(rec.cid);
      r.onsuccess = () => {
        if (r.result) { out = { rec: r.result, inserted: false }; return; }
        const all = os.getAll();
        all.onsuccess = () => {
          const sid = rec.server_id != null ? String(rec.server_id) : null;
          const found = sid == null ? null : (all.result || []).find((d) =>
            d && d.note_cid === undefined && d.server_id != null && String(d.server_id) === sid);
          if (found) { out = { rec: found, inserted: false }; return; }
          os.put(rec);
          out = { rec, inserted: true };
        };
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Antrean op drawing (satu transaksi _outbox): bila sudah ada op create → biarkan (push create
  // mengirim state terkini dari record+blob); bila ada op update → perbarui payload metadatanya;
  // bila belum ada keduanya → tambah op update. Payload hanya metadata — data dibaca push dari blob.
  function queueDrawingUpdate(cid, meta, tags) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      let added = false;
      const tx = db.transaction("_outbox", "readwrite");
      const os = tx.objectStore("_outbox");
      const r = os.getAll();
      r.onsuccess = () => {
        const ops = (r.result || []).filter((o) => o.entity_type === "drawing" && o.cid === cid);
        if (ops.some((o) => o.op === "create")) return;
        const payload = Object.assign({}, meta || {});
        if (Array.isArray(tags)) payload.tags = tags;
        const upd = ops.find((o) => o.op === "update");
        if (!upd) {
          os.add({ ts: Date.now(), retries: 0, op: "update", entity_type: "drawing", cid, payload });
          added = true;
          return;
        }
        upd.payload = Object.assign({}, upd.payload || {}, payload);
        os.put(upd);
      };
      tx.oncomplete = () => resolve(added);
      tx.onerror = () => reject(tx.error);
    }));
  }

  // Pastikan ada op create/update tertunda (dipakai push bila record masih dirty setelah request,
  // pull untuk record dirty tanpa op, dan heal). Resolve true bila op baru ditambahkan.
  function ensureDrawingUpdateOp(cid, meta) {
    return queueDrawingUpdate(cid, meta);
  }

  // Op diantre di luar mutasi lewat API (mis. heal saat GET) → beri tahu UI agar menjadwalkan push.
  function notifyQueued() {
    try {
      if (root && typeof root.dispatchEvent === "function" && typeof CustomEvent === "function") {
        root.dispatchEvent(new CustomEvent("tf:outbox-queued", { detail: { entity: "drawing" } }));
      }
    } catch (_) {}
  }

  function metaOf(rec) {
    return { title: rec.title, svg_preview: rec.svg_preview || "", is_pinned: rec.is_pinned ? 1 : 0 };
  }

  // updateDrawing diserialkan: simpan beruntun (mis. pesan 'change' iframe yang berdekatan) diterapkan
  // sesuai urutan panggilan, tidak bergantung urutan selesainya transaksi IndexedDB.
  let _updateChain = Promise.resolve();
  function serialUpdate(task) {
    const run = _updateChain.then(task, task);
    _updateChain = run.then(() => undefined, () => undefined);
    return run;
  }

  // ── Snapshot helpers (heal & gabung) ────────────────────────────────────────
  function parseJson(s) {
    if (s == null) return undefined;
    if (typeof s !== "string") return s;
    try { return JSON.parse(s); } catch (_) { return undefined; }
  }
  // Snapshot tldraw yang layak digabung: objek dengan `store` (map record).
  function isTldrawSnapshot(s) {
    const o = parseJson(s);
    return !!(o && typeof o === "object" && o.store && typeof o.store === "object" && !Array.isArray(o.store));
  }
  // Serialisasi kanonik (kunci terurut) → bandingkan isi tanpa peduli urutan kunci.
  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function sameContent(a, b) {
    if (a === b) return true;
    const pa = parseJson(a), pb = parseJson(b);
    if (pa === undefined || pb === undefined) return false;
    return canonical(pa) === canonical(pb);
  }
  // mergeDrawingSnapshots milik syncpull diambil lazy saat dipakai (syncpull me-require drawingrepo).
  function mergeSnapshots(localJson, remoteJson, opts) {
    const pull = isNode ? require("./syncpull.js") : (root.TF && root.TF.syncpull);
    return pull.mergeDrawingSnapshots(localJson, remoteJson, opts);
  }

  function setTags(cid, tags) {
    if (!Array.isArray(tags) || !TFtag || !TFtag.setEntityTags) return Promise.resolve();
    return TFtag.setEntityTags("drawing", cid, tags).catch(() => {});
  }
  // Petakan server_id → cid bila belum ada pemetaan (op update push butuh idmap).
  function mapIdIfMissing(sid, cid) {
    if (sid == null || !TFidmap || !TFidmap.cidOf) return Promise.resolve();
    return TFidmap.cidOf("drawing", sid)
      .then((known) => (known ? null : TFidmap.mapPut("drawing", sid, cid)))
      .catch(() => {});
  }
  function dropBlob(ref) {
    return ref ? Promise.resolve(BlobStore.delete(ref)).catch(() => {}) : Promise.resolve();
  }
  // ── Blob dasar (T2, three-way merge) ─────────────────────────────────────────
  // record.base_blob_ref = snapshot pada base_rev (versi server yang terakhir diadopsi / data yang terakhir
  // terkirim), record.base_title = judulnya. Boleh BERBAGI id dengan blob_ref (record bersih) → blob lama hanya
  // dibuang bila tidak lagi dirujuk oleh blob_ref maupun base_blob_ref record. Dipakai pull untuk membedakan
  // "dihapus di satu sisi" dari "ditambah di sisi lain".
  // Buang blob kandidat `refs` yang tidak ada di `keep` (ref yang masih dipakai record), tanpa duplikat.
  function releaseBlobs(refs, keep) {
    const keepSet = new Set((keep || []).filter(Boolean));
    const seen = new Set();
    return (refs || []).filter(Boolean).reduce((p, ref) => {
      if (keepSet.has(ref) || seen.has(ref)) return p;
      seen.add(ref);
      return p.then(() => dropBlob(ref));
    }, Promise.resolve());
  }
  function refsOf(rec) { return rec ? [rec.blob_ref, rec.base_blob_ref] : []; }

  // ── Standalone Drawing Methods ──────────────────────────────────────────────

  function createDrawing(doc, opts) {
    doc = doc || {};
    opts = opts || {};
    const now = opts.now || new Date().toISOString();
    const cid = TFids.newCid();
    const dataJson = doc.data_json || "{}";

    return BlobStore.put(dataJson, { mime: "application/json" }).then((ref) => {
      const rec = {
        cid,
        server_id: null,
        title: doc.title || "Untitled Drawing",
        blob_ref: ref,
        svg_preview: doc.svg_preview || "",
        svg_stale: (dataJson !== "{}" && !doc.svg_preview) ? 1 : 0,
        is_pinned: doc.is_pinned ? 1 : 0,
        list_id: doc.list_id != null ? doc.list_id : null,
        user_id: currentUid(),
        last_edited_by: currentUid(),
        last_editor_username: null,
        last_editor_display_name: null,
        created_at: now,
        updated_at: now,
        deleted: false,
        dirty: 1,
        base_rev: null,
        rev: 1,
      };
      return putRec(rec).then(() => {
        const tagP = (doc.tags && TFtag && TFtag.setEntityTags)
          ? TFtag.setEntityTags("drawing", cid, doc.tags)
          : Promise.resolve();
        return tagP.then(() => {
          // Payload metadata saja: push create membaca data terkini dari blob record.
          return TFoutbox.outboxAdd({
            op: "create",
            entity_type: "drawing",
            cid,
            payload: {
              title: rec.title,
              svg_preview: rec.svg_preview,
              is_pinned: rec.is_pinned,
              tags: doc.tags || [],
              list_id: rec.list_id,
            },
          }).then(() => Object.assign(scopeOf(rec), {
            id: rec.cid,
            cid: rec.cid,
            server_id: null,
            title: rec.title,
            data_json: dataJson,
            svg_preview: rec.svg_preview,
            svg_stale: rec.svg_stale,
            is_pinned: rec.is_pinned,
            tags: doc.tags || [],
            dirty: rec.dirty,
            deleted: rec.deleted,
            created_at: rec.created_at,
            updated_at: rec.updated_at,
          }));
        });
      });
    });
  }

  // Record lokal belum ada → buat dari data server (cid = client_id server bila ada, konsisten
  // dengan pull). Idempoten: bila cid/server_id sudah ada lokal, rekonsiliasi record itu saja.
  function adoptServerDrawing(srv) {
    const missing = srv.data_json == null; // tanpa data → tandai data_missing, JANGAN buat placeholder "{}"
    return (missing ? Promise.resolve(null) : BlobStore.put(srv.data_json, { mime: "application/json" })).then((ref) => {
      const rec = Object.assign(scopeFromServer(srv), {
        cid: srv.client_id || TFids.newCid(),
        server_id: srv.id,
        client_id: srv.client_id || null,
        blob_ref: ref,
        title: srv.title != null ? srv.title : "Untitled Drawing",
        svg_preview: srv.svg_preview || "",
        svg_stale: 0,
        is_pinned: srv.is_pinned ? 1 : 0,
        updated_at: srv.updated_at,
        created_at: srv.created_at || srv.updated_at,
        deleted: false,
        dirty: 0,
        base_rev: missing ? null : srv.updated_at,
        base_blob_ref: ref, // snapshot dasar = data server yang diadopsi (berbagi blob dengan blob_ref)
        base_title: srv.title != null ? srv.title : "Untitled Drawing",
        data_missing: missing ? 1 : 0,
        rev: 0,
      });
      return insertDrawingIfAbsent(rec).then((res) => {
        if (!res.inserted) {
          return dropBlob(ref).then(() => (res.rec.note_cid === undefined ? reconcileWithServer(res.rec, srv) : res.rec));
        }
        return Promise.all([setTags(rec.cid, srv.tags || []), mapIdIfMissing(srv.id, rec.cid)]).then(() => rec);
      });
    });
  }

  // Server berubah (record bersih) → tulis blob server lalu CAS: hanya bila record masih bersih &
  // rev sama dengan saat dibaca. Bila berubah selama fetch → buang blob baru & pakai lokal terkini.
  function refreshFromServer(local, srv) {
    const readRev = local.rev || 0;
    return BlobStore.put(srv.data_json, { mime: "application/json" }).then((newRef) => {
      let oldRefs = [];
      return mutateDrawing(local.cid, (cur) => {
        if (!cur || cur.deleted || cur.dirty || (cur.rev || 0) !== readRev) return undefined;
        oldRefs = refsOf(cur);
        return Object.assign({}, cur, (srv.user_id !== undefined || srv.list_id !== undefined) ? scopeFromServer(srv) : {}, {
          server_id: srv.id != null ? srv.id : cur.server_id,
          blob_ref: newRef,
          title: srv.title != null ? srv.title : cur.title,
          svg_preview: srv.svg_preview || "",
          svg_stale: 0,
          data_missing: 0,
          is_pinned: srv.is_pinned ? 1 : 0,
          updated_at: srv.updated_at,
          base_rev: srv.updated_at,
          base_blob_ref: newRef, // T2: data server yang diadopsi = snapshot dasar
          base_title: srv.title != null ? srv.title : cur.title,
          dirty: 0,
          rev: readRev + 1,
        });
      }).then((saved) => {
        if (!saved) return dropBlob(newRef).then(() => getRaw(local.cid));
        return Promise.all([
          releaseBlobs(oldRefs, refsOf(saved)),
          setTags(saved.cid, srv.tags || []),
          mapIdIfMissing(srv.id, saved.cid),
        ]).then(() => saved);
      });
    });
  }

  // Heal data rusak versi lama (RC1: lokal lebih lengkap tapi ditandai bersih, server basi pada
  // base_rev yang sama): union lokal+server, tandai dirty + svg_stale, pastikan op update.
  function healDrawing(local, mergedJson) {
    const readRev = local.rev || 0;
    const now = new Date().toISOString();
    return BlobStore.put(mergedJson, { mime: "application/json" }).then((newRef) => {
      let oldRefs = [];
      return mutateDrawing(local.cid, (cur) => {
        if (!cur || cur.deleted || cur.dirty || (cur.rev || 0) !== readRev) return undefined;
        oldRefs = refsOf(cur);
        // S4: blob nyata ditulis → data_missing dibersihkan
        return Object.assign({}, cur, { blob_ref: newRef, dirty: 1, rev: readRev + 1, updated_at: now, svg_stale: 1, data_missing: 0 });
      }).then((saved) => {
        if (!saved) return dropBlob(newRef).then(() => getRaw(local.cid));
        return Promise.all([
          releaseBlobs(oldRefs, refsOf(saved)),
          ensureDrawingUpdateOp(saved.cid, metaOf(saved)),
        ]).then(() => { notifyQueued(); return saved; });
      });
    });
  }

  // Catat client_id server pada record lokal ber-cid lain (dibuat pull/adopsi lama) supaya id direktif
  // note dari mesin lain (= client_id) bisa ditemukan getRaw → simpan dari QuickDraw tidak gagal.
  function rememberClientId(local, srv) {
    const cid = srv && srv.client_id;
    if (!cid || !local || local.cid === cid || local.client_id === cid) return Promise.resolve(local);
    return mutateDrawing(local.cid, (cur) => (cur ? Object.assign({}, cur, { client_id: cid }) : undefined))
      .then((saved) => saved || local)
      .catch(() => local);
  }

  // Rekonsiliasi record standalone lokal dengan baris server (jalur online getDrawing).
  // Tidak pernah menghapus op outbox & tidak pernah menimpa edit lokal yang belum terkirim.
  function reconcileWithServer(local, srv) {
    if (!local) return adoptServerDrawing(srv);
    return rememberClientId(local, srv).then((cur) => reconcileKnown(cur, srv));
  }

  function isEmptyJsonObject(sv) {
    const o = parseJson(sv);
    return !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 0;
  }
  function hasSvgContent(svg) {
    return typeof svg === "string" && /<svg[\s>]/i.test(svg)
      && /<(path|g|rect|circle|ellipse|line|polyline|polygon|text|image|use)\b/i.test(svg);
  }
  // Data gambar lokal tidak tersedia: ditandai pull/adopsi (detail gagal diambil), blob hilang pada record
  // server, atau placeholder "{}" versi lama (record server, bersih, data "{}" tapi preview svg berisi gambar).
  function isDataMissing(rec, bytes) {
    if (rec.data_missing) return true;
    if (rec.server_id == null || rec.dirty) return false;
    if (bytes === undefined) return true;
    return isEmptyJsonObject(bytes) && hasSvgContent(rec.svg_preview);
  }
  // Placeholder lama terdeteksi → tandai data_missing + base_rev null (CAS) supaya pull berikutnya mengambil ulang.
  function markDataMissing(rec) {
    const readRev = rec.rev || 0;
    return mutateDrawing(rec.cid, (cur) => {
      if (!cur || cur.deleted || cur.dirty || (cur.rev || 0) !== readRev) return undefined;
      return Object.assign({}, cur, { data_missing: 1, base_rev: null });
    }).catch(() => null);
  }

  // Jejak record rusak versi lama (RC1): dibuat sebelum ada `rev` dan updated_at lokal (waktu edit, ISO Z)
  // ≠ base_rev server — push lama menandai bersih padahal data lokal belum terkirim.
  function isLegacyRc1(rec) {
    return rec.rev === undefined && String(rec.updated_at) !== String(rec.base_rev);
  }

  function reconcileKnown(local, srv) {
    if (local.deleted || local.dirty) return Promise.resolve(local); // dirty → pakai lokal (pull yang merge)
    if (srv.data_json == null) return Promise.resolve(local);
    // Hanya revisi server yang LEBIH BARU dari base_rev yang diadopsi; respons lebih lama (mis. cache basi) diabaikan.
    if (tsNewer(srv.updated_at, local.base_rev)) return refreshFromServer(local, srv);
    if (tsNewer(local.base_rev, srv.updated_at)) return Promise.resolve(local);
    return readBytes(local.blob_ref).then((bytes) => {
      if (bytes === srv.data_json) return local;
      if (!isTldrawSnapshot(bytes)) return refreshFromServer(local, srv); // blob lokal hilang/rusak
      if (sameContent(bytes, srv.data_json)) return local;
      // Revisi sama tapi isi beda: heal (union) HANYA untuk record legacy RC1; selain itu server yang benar.
      if (isLegacyRc1(local)) {
        const merged = mergeSnapshots(bytes, srv.data_json, { preferRemote: false });
        if (!sameContent(merged, srv.data_json)) return healDrawing(local, merged);
      }
      return refreshFromServer(local, srv);
    });
  }

  function getDrawing(idOrCid, opts) {
    opts = opts || {};
    const fetcher = opts.fetch || _fetcher;
    const online = opts.online != null ? opts.online : true;

    return getRaw(idOrCid).then((rec) => {
      // S6: hanya format standalone; record legacy ber-note_cid dikonversi upgradeLegacyNoteDrawings saat push
      const standalone = rec && rec.note_cid === undefined ? rec : null;
      // Record dirty: data lokal selalu menang (pull yang merge) → tidak perlu menunggu jaringan.
      const wantFetch = fetcher && online && !(standalone && standalone.dirty && !standalone.deleted);
      const doFetch = wantFetch
        ? Promise.resolve().then(() => fetcher(idOrCid)).catch(() => null)
        : Promise.resolve(null);

      let serverSaysEmpty = false; // server mengirim data_json "{}" secara eksplisit pada panggilan ini
      return doFetch.then((srv) => {
        if (srv && srv.title !== undefined) {
          serverSaysEmpty = srv.data_json != null && isEmptyJsonObject(srv.data_json);
          // Standalone drawing dari server → rekonsiliasi dengan record TERKINI (bisa berubah selama fetch)
          return (standalone ? getRec(standalone.cid) : Promise.resolve(null))
            .then((cur) => reconcileWithServer(cur, srv));
        }
        // Fetch failed or not online, fallback to whatever we have locally
        return (standalone && !standalone.deleted) ? standalone : null;
      }).then((finalRec) => {
         if (!finalRec || finalRec.deleted) return null;
         // Baca record & blob TERKINI (jangan pakai objek basi: blob-nya bisa sudah dihapus edit bersamaan → "{}" palsu)
         return readDrawingState(finalRec.cid).then(({ rec: cur, bytes }) => {
           if (!cur || cur.deleted) return null;
           // Data gambar tidak tersedia (detail server belum pernah terambil / placeholder lama) → JANGAN
           // pernah dikembalikan sebagai gambar kosong: parent membuka read-only + toast.
           const missing = !serverSaysEmpty && isDataMissing(cur, bytes);
           const markP = (missing && !cur.data_missing) ? markDataMissing(cur) : Promise.resolve();
           const tagP = (typeof TFtag !== "undefined" && TFtag.getEntityTags)
             ? TFtag.getEntityTags("drawing", cur.cid).then((tags) => tags.map((t) => t.name))
             : Promise.resolve([]);
           return Promise.all([tagP, markP]).then(([tagNames]) => Object.assign(scopeOf(cur), {
             id: cur.server_id != null ? cur.server_id : cur.cid,
             cid: cur.cid,
             server_id: cur.server_id,
             title: cur.title || "Untitled Drawing",
             data_json: missing ? null : (bytes || "{}"),
             data_missing: missing ? 1 : 0,
             svg_preview: cur.svg_preview || "",
             svg_stale: cur.svg_stale ? 1 : 0,
             is_pinned: cur.is_pinned || 0,
             tags: tagNames,
             created_at: cur.created_at,
             updated_at: cur.updated_at,
           }));
         });
      });
    });
  }

  function listDrawings(opts) {
    opts = opts || {};
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("tf_token") : null;
    // X-TF-Sync: SW meneruskan network-only (jangan pernah membaca cache GET /api/drawings yang basi)
    const fetchOnline = (typeof navigator !== "undefined" && navigator.onLine && token)
      ? window.fetch("/api/drawings?shared=1", { headers: { Authorization: "Bearer " + token, "X-TF-Sync": "1" } }).then(r => r.ok ? r.json() : []).catch(()=>[])
      : Promise.resolve([]);

    return Promise.all([fetchOnline, getAllRaw()]).then(([serverData, all]) => {
      const active = all.filter((r) => !r.deleted && r.note_cid === undefined);

      const promises = active.map((r) => {
        const tagP = (typeof TFtag !== "undefined" && TFtag.getEntityTags)
          ? TFtag.getEntityTags("drawing", r.cid).then((tags) => tags.map((t) => t.name))
          : Promise.resolve([]);
        return tagP.then((tagNames) => Object.assign(scopeOf(r), {
          id: r.server_id != null ? r.server_id : r.cid,
          cid: r.cid,
          server_id: r.server_id,
          title: r.title || "Untitled Drawing",
          svg_preview: r.svg_preview || "",
          is_pinned: r.is_pinned || 0,
          tags: tagNames,
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
      });

      return Promise.all(promises).then((localList) => {
        const map = new Map();
        for (const d of serverData) map.set(String(d.id), d);
        for (const d of localList) {
          const sid = d.server_id != null ? String(d.server_id) : null;
          if (sid && map.has(sid)) {
             if (new Date(d.updated_at).getTime() > new Date(map.get(sid).updated_at).getTime()) {
                map.set(sid, d);
             }
          } else {
             map.set(sid || String(d.id || d.cid), d);
          }
        }
        let list = Array.from(map.values());
        list.sort((a, b) => {
          const pinDiff = (b.is_pinned || 0) - (a.is_pinned || 0);
          if (pinDiff !== 0) return pinDiff;
          const tsA = new Date(a.updated_at).getTime() || 0;
          const tsB = new Date(b.updated_at).getTime() || 0;
          return tsB - tsA;
        });

        if (opts.tag) {
          const filterTag = String(opts.tag).toLowerCase();
          list = list.filter((d) => (d.tags || []).some((t) => String(t).toLowerCase() === filterTag));
        }
        if (opts.list_id != null && opts.list_id !== "") {
          if (opts.list_id === "personal") list = list.filter((d) => d.list_id == null);
          else list = list.filter((d) => d.list_id != null && String(d.list_id) === String(opts.list_id));
        }
        if (opts.is_pinned) {
          list = list.filter((d) => String(d.is_pinned) === "1" || d.is_pinned === true || d.is_pinned === 1);
        }
        return list;
      });
    });
  }

  // Simpan edit: tulis blob baru dulu, lalu terapkan ke record terkini secara atomik (dirty 1, rev+1);
  // blob lama dihapus SETELAH mutasi sukses. Antrean: op update metadata (lihat queueDrawingUpdate).
  function updateDrawing(idOrCid, patch, opts) {
    patch = patch || {};
    opts = opts || {};
    const now = opts.now || new Date().toISOString();

    return serialUpdate(() => getRaw(idOrCid).then((rec0) => {
      if (!rec0 || rec0.deleted) {
        return Promise.reject(new Error("Drawing not found"));
      }
      const cid = rec0.cid;
      const hasData = patch.data_json !== undefined;
      const blobP = hasData ? BlobStore.put(patch.data_json, { mime: "application/json" }) : Promise.resolve(null);

      return blobP.then((newRef) => {
        let oldRef = null;
        return mutateDrawing(cid, (cur) => {
          if (!cur || cur.deleted) return undefined;
          const next = Object.assign({}, cur);
          if (patch.title !== undefined) next.title = patch.title;
          if (patch.svg_preview !== undefined) next.svg_preview = patch.svg_preview;
          // svg_stale: svg preview tidak mewakili data terbaru (mis. flush pagehide tanpa svg)
          if (patch.svg_stale !== undefined) next.svg_stale = patch.svg_stale ? 1 : 0;
          else if (patch.svg_preview !== undefined) next.svg_stale = 0;
          else if (hasData) next.svg_stale = 1;
          if (newRef) { oldRef = cur.blob_ref; next.blob_ref = newRef; next.data_missing = 0; }
          next.last_edited_by = currentUid();
          next.last_editor_username = null;
          next.last_editor_display_name = null;
          next.updated_at = now;
          next.dirty = 1;
          next.rev = (cur.rev || 0) + 1;
          return next;
        }).then((saved) => {
          if (!saved) {
            return dropBlob(newRef).then(() => Promise.reject(new Error("Drawing not found")));
          }
          const tagP = (Array.isArray(patch.tags) && TFtag && TFtag.setEntityTags)
            ? TFtag.setEntityTags("drawing", cid, patch.tags)
            : Promise.resolve();
          // blob lama dipertahankan bila masih menjadi snapshot dasar (base_blob_ref) untuk merge 3-arah
          return Promise.all([releaseBlobs([oldRef], refsOf(saved)), tagP])
            .then(() => queueDrawingUpdate(cid, metaOf(saved), patch.tags))
            .then(() => (hasData ? patch.data_json : readBytes(saved.blob_ref)))
            .then((dataJson) => Object.assign(scopeOf(saved), {
              id: saved.server_id != null ? saved.server_id : saved.cid,
              cid: saved.cid,
              server_id: saved.server_id,
              title: saved.title,
              data_json: saved.data_missing ? null : dataJson,
              data_missing: saved.data_missing ? 1 : 0,
              svg_preview: saved.svg_preview,
              svg_stale: saved.svg_stale ? 1 : 0,
              is_pinned: saved.is_pinned || 0,
              tags: patch.tags || [],
              created_at: saved.created_at,
              updated_at: saved.updated_at,
            }));
        });
      });
    }));
  }

  // Hapus op create/update tertunda milik cid (gambar yang belum pernah di-push lalu dihapus: tidak perlu POST).
  function dropPendingContentOps(cid) {
    return TFoutbox.outboxByEntity("drawing", cid).then((ops) =>
      ops.filter((o) => o.op === "create" || o.op === "update" || o.op === "upsert")
        .reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve()));
  }

  function deleteDrawing(idOrCid) {
    return getRaw(idOrCid).then((rec) => {
      if (!rec) return { ok: true };
      if (isOthers(rec)) return Promise.reject(ownerOnlyError());
      let dropped = [];
      return mutateDrawing(rec.cid, (cur) => {
        if (!cur) return undefined;
        const next = Object.assign({}, cur, { deleted: true, dirty: 1, rev: (cur.rev || 0) + 1 });
        // Belum pernah di-push: blob tidak diperlukan lagi (tombstone tetap sampai op delete menghapus record —
        // POST yang mungkin sedang in-flight tetap tertangani oleh op delete).
        if (cur.server_id == null) { dropped = refsOf(cur); next.blob_ref = null; next.base_blob_ref = null; }
        return next;
      })
        .then((saved) => (saved && saved.server_id == null
          ? releaseBlobs(dropped, []).then(() => dropPendingContentOps(saved.cid))
          : null))
        .then(() => TFoutbox.outboxAdd({
          op: "delete",
          entity_type: "drawing",
          cid: rec.cid,
          payload: {},
        }))
        .then(() => ({ ok: true }));
    });
  }
  // Hapus record + blob-nya (dipakai op delete untuk gambar tanpa server_id, dan resolusi konflik "buang").
  function purgeDrawing(cid) {
    return getRec(cid).then((rec) => {
      if (!rec) return false;
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction("drawings", "readwrite");
        tx.objectStore("drawings").delete(cid);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })).then(() => releaseBlobs(refsOf(rec), [])).then(() => true);
    });
  }

  // Toggle pin: record & op pin ditulis dalam SATU transaksi (drawings + _outbox) supaya pull (adopsi pin
  // server) tidak pernah melihat pin lokal baru tanpa op-nya lalu membaliknya.
  function togglePin(idOrCid) {
    return getRaw(idOrCid).then((rec) => {
      if (!rec || rec.deleted) {
        return Promise.reject(new Error("Drawing not found"));
      }
      if (isOthers(rec)) return Promise.reject(ownerOnlyError());
      return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
        let saved = null;
        const tx = db.transaction(["drawings", "_outbox"], "readwrite");
        const os = tx.objectStore("drawings");
        const r = os.get(rec.cid);
        r.onsuccess = () => {
          const cur = r.result;
          if (!cur || cur.deleted) return;
          saved = Object.assign({}, cur, { is_pinned: cur.is_pinned ? 0 : 1 });
          os.put(saved);
          tx.objectStore("_outbox").add({ ts: Date.now(), retries: 0, op: "pin", entity_type: "drawing", cid: saved.cid, payload: { is_pinned: saved.is_pinned } });
        };
        tx.oncomplete = () => resolve(saved);
        tx.onerror = () => reject(tx.error);
      })).then((saved) => {
        if (!saved) return Promise.reject(new Error("Drawing not found"));
        return { id: saved.server_id != null ? saved.server_id : saved.cid, is_pinned: saved.is_pinned };
      });
    });
  }

  // ── Op outbox versi lama ────────────────────────────────────────────────────
  // Op drawing sebelum perbaikan menyimpan salinan data_json di payload (bisa basi); push kini
  // membaca blob. Record BERSIH + op update lama = blob sempat ditimpa versi server oleh getDrawing
  // lama sementara edit user hanya ada di payload → gabungkan payload ke blob (union) supaya tidak
  // hilang. Blob hilang/rusak → pakai payload. Setelah itu salinan data_json dibuang dari payload.
  function stripPayloadData(qid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("_outbox", "readwrite");
      const os = tx.objectStore("_outbox");
      const r = os.get(qid);
      r.onsuccess = () => {
        const op = r.result;
        if (!op || !op.payload || op.payload.data_json === undefined) return;
        const payload = Object.assign({}, op.payload);
        delete payload.data_json;
        op.payload = payload;
        os.put(op);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function upgradeLegacyOp(op) {
    const payloadData = op.payload.data_json;
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("drawings", "readonly").objectStore("drawings").get(op.cid);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    })).then((rec) => {
      if (!rec || rec.note_cid !== undefined || rec.deleted) return null;
      return Promise.resolve(BlobStore.getBytes(rec.blob_ref)).catch(() => undefined).then((bytes) => {
        let next = null;
        const payloadOk = isTldrawSnapshot(payloadData);
        if (!isTldrawSnapshot(bytes)) {
          if (payloadOk) next = payloadData; // blob hilang/rusak → data payload
        } else if (op.op === "update" && !rec.dirty && payloadOk && !sameContent(bytes, payloadData)) {
          next = mergeSnapshots(bytes, payloadData, { preferRemote: true });
          if (sameContent(next, bytes)) next = null;
        }
        if (next == null) return null;
        const readRev = rec.rev || 0;
        const svgFresh = sameContent(next, payloadData) && typeof op.payload.svg_preview === "string";
        return BlobStore.put(next, { mime: "application/json" }).then((newRef) => {
          let oldRef = null;
          return mutateDrawing(rec.cid, (cur) => {
            if (!cur || cur.deleted || (cur.rev || 0) !== readRev || !!cur.dirty !== !!rec.dirty) return undefined;
            oldRef = cur.blob_ref;
            const upd = { blob_ref: newRef, dirty: 1, rev: readRev + 1, svg_stale: svgFresh ? 0 : 1, data_missing: 0 };
            if (svgFresh) upd.svg_preview = op.payload.svg_preview;
            return Object.assign({}, cur, upd);
          }).then((saved) => (saved
            ? releaseBlobs([oldRef], refsOf(saved))
            : dropBlob(newRef)));
        });
      });
    }).then(() => stripPayloadData(op.qid));
  }

  function upgradeLegacyDrawingOps() {
    return TFoutbox.outboxAll().then((ops) => {
      const legacy = ops.filter((o) => o.entity_type === "drawing" && (o.op === "update" || o.op === "create")
        && o.payload && typeof o.payload.data_json === "string");
      return legacy.reduce((chain, op) => chain.then(() => upgradeLegacyOp(op).catch(() => null)), Promise.resolve())
        .then(() => legacy.length);
    }).then((n) => upgradeLegacyNoteDrawings().then((m) => n + m));
  }

  // ── S6: record legacy "gambar di dalam note" (note_cid) ─────────────────────
  // Versi lama menyimpan gambar sebagai record ber-`note_cid` dan mendorongnya dengan op `upsert` ke
  // PUT /api/drawings/{noteSid} — server menganggap itu id DRAWING (menimpa gambar lain / 404). Konversi menjadi
  // drawing standalone: note_cid dihapus, server_id null, blob dipertahankan, op create (client_id = cid).
  // Resolve record hasil konversi, atau null bila record tidak ada / bukan legacy.
  function convertLegacyNoteDrawing(cid, opts) {
    opts = opts || {};
    const now = opts.now || new Date().toISOString();
    let converted = null;
    return mutateDrawing(cid, (cur) => {
      if (!cur || cur.note_cid === undefined) return undefined;
      if (cur.deleted) { converted = null; return undefined; }
      const next = Object.assign({}, cur);
      delete next.note_cid;
      next.server_id = null;
      next.client_id = cid;
      next.title = cur.title || "Untitled Drawing";
      next.svg_preview = cur.svg_preview || "";
      next.svg_stale = 1;
      next.is_pinned = cur.is_pinned ? 1 : 0;
      next.created_at = cur.created_at || cur.updated_at || now;
      next.updated_at = cur.updated_at || now;
      next.dirty = 1;
      next.base_rev = null;
      next.base_blob_ref = null;
      next.rev = (cur.rev || 0) + 1;
      converted = next;
      return next;
    }).then((saved) => {
      if (!saved) return null;
      return TFoutbox.outboxByEntity("drawing", cid).then((ops) => {
        // op upsert lama dibuang (processOp juga membuangnya); pastikan satu op create
        const stale = ops.filter((o) => o.op === "upsert");
        return stale.reduce((p, o) => p.then(() => TFoutbox.outboxRemove(o.qid)), Promise.resolve())
          .then(() => (ops.some((o) => o.op === "create")
            ? null
            : TFoutbox.outboxAdd({ op: "create", entity_type: "drawing", cid: cid, payload: metaOf(saved) })));
      }).then(() => converted);
    });
  }
  function upgradeLegacyNoteDrawings() {
    return getAllRaw().then((all) => {
      const legacy = all.filter((r) => r && r.note_cid !== undefined);
      return legacy.reduce((chain, r) => chain.then((n) => (r.deleted
        ? purgeDrawing(r.cid).then(() => n)
        : convertLegacyNoteDrawing(r.cid).then((c) => (c ? n + 1 : n)).catch(() => n))), Promise.resolve(0));
    });
  }

  function configureFetcher(fn) { _fetcher = fn; }

  const exported = {
    setCurrentUser,
    currentUid,
    adoptServerDrawing,
    createDrawing,
    getDrawing,
    listDrawings,
    updateDrawing,
    deleteDrawing,
    togglePin,
    getRaw,
    mutateDrawing,
    readDrawingState,
    tsNewer,
    ensureDrawingUpdateOp,
    upgradeLegacyDrawingOps,
    upgradeLegacyNoteDrawings,
    convertLegacyNoteDrawing,
    purgeDrawing,
    releaseBlobs,
    isTldrawSnapshot,
    sameContent,
    configureFetcher,
    _BlobStore: BlobStore,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.drawingrepo = exported; }
  return exported;
});
