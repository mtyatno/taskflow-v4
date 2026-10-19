;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Kolaborasi langsung mindmap (#4, Task B5): logika tab yang bisa diuji tanpa React.
  // Tab memegang pasangan basis (baseDocRef = data_json yang menjadi dasar kanvas/outline) dan
  // lastKnownAtRef (if_updated_at). Keduanya SELALU maju bersama dari snapshot yang sama, dan hanya setelah isi
  // jarak jauh benar-benar diterapkan di iframe (remoteApplied). remoteSkipped / edit lokal yang berpapasan dengan
  // remoteUpdate → basis tetap, remoteStaleRef = true (autosave berikutnya me-merge, lalu tab membaca record).
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = () => req("./db.js", root.TF && root.TF.db);
  const TFidmap = () => req("./idmap.js", root.TF && root.TF.idmap);

  const RECONNECT_MIN_MS = 2000;
  const RECONNECT_MAX_MS = 60000;
  // Galat berturut-turut (tanpa onopen) sebelum berhenti mencoba; online / tab diaktifkan lagi memulai ulang.
  const RECONNECT_MAX_ATTEMPTS = 8;
  const LIVE_LABEL = "🟢 Langsung";
  const LIVE_TITLE = "Perubahan anggota lain tampil otomatis";
  const DELETED_MSG = "Peta ini dihapus oleh pemiliknya";
  const ACCESS_LOST_MSG = "Akses ke peta ini dicabut";

  // Jeda sambung ulang stream: 2 s, 4 s, 8 s … maks 60 s (tidak pernah loop panas).
  function backoffMs(attempt) {
    const a = Math.max(0, Math.floor(Number(attempt) || 0));
    if (a >= 16) return RECONNECT_MAX_MS;
    return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * Math.pow(2, a));
  }

  function shouldReconnect(failures) {
    return (Number(failures) || 0) < RECONNECT_MAX_ATTEMPTS;
  }

  // session_id instans tab (dibuat sekali per tab yang di-mount): salinan konflik router dipakai ulang hanya oleh
  // tab yang sama (B3).
  function newSessionId() {
    try {
      const c = root.crypto;
      if (c && typeof c.randomUUID === "function") return c.randomUUID();
    } catch (_) {}
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function conflictToast(editor, copyTitle) {
    return "✂ Sebagian perubahanmu bentrok dengan " + (editor || "anggota lain") + " — versimu disimpan sebagai '" + copyTitle + "'";
  }

  function parseData(dataJson) {
    let data = null;
    try { data = typeof dataJson === "string" ? JSON.parse(dataJson) : dataJson; } catch (_) { return null; }
    if (!data || typeof data !== "object") return null;
    if (data.nodeData) data.nodeData.root = true;
    return data;
  }

  // refs: { baseDocRef, lastKnownAtRef, remoteStaleRef, remoteSeqRef, pendingRemoteRef (Map seq → entri) }
  function createTabLive(refs) {
    const pending = () => refs.pendingRemoteRef.current;
    return {
      // Tab dimuat dari record (tab.data_json + tab.updated_at = satu snapshot).
      load(doc) {
        refs.baseDocRef.current = doc && doc.data_json != null ? doc.data_json : null;
        refs.lastKnownAtRef.current = doc && doc.updated_at != null ? doc.updated_at : null;
        refs.remoteStaleRef.current = false;
        pending().clear();
      },
      // Pesan induk→iframe untuk record jarak jauh (null bila data tak terbaca). Basis BELUM maju.
      // Isi sama dengan basis (mis. gema simpan sendiri setelah push, catch-up tanpa perubahan) dan judul tidak berubah
      // (opts.title = judul tab) dan tidak ada tawaran lain di jalan → null: kanvas TIDAK dimuat ulang (refresh
      // mengosongkan seleksi + riwayat undo); hanya if_updated_at yang maju (isi record = basis, jadi pasangan tetap sah).
      offerRemote(doc, opts) {
        if (!doc) return null;
        const data = parseData(doc.data_json);
        if (!data) return null;
        const dataStr = typeof doc.data_json === "string" ? doc.data_json : JSON.stringify(doc.data_json);
        const sameTitle = !opts || opts.title == null || doc.title == null || String(doc.title) === String(opts.title);
        if (dataStr === refs.baseDocRef.current && sameTitle && pending().size === 0) {
          if (doc.updated_at != null) refs.lastKnownAtRef.current = doc.updated_at;
          return null;
        }
        const seq = ++refs.remoteSeqRef.current;
        pending().set(seq, {
          data, dataStr, updatedAt: doc.updated_at != null ? doc.updated_at : null,
          title: doc.title != null ? doc.title : null,
          editor: doc.last_editor_display_name || doc.last_editor_username || null,
          raced: false,
        });
        return { type: "remoteUpdate", data, title: doc.title || "", seq };
      },
      // Edit pengguna (change iframe / outline): remoteUpdate yang masih di jalan dibuat iframe di atas pohon lama.
      noteLocalEdit() {
        pending().forEach((e) => { e.raced = true; });
      },
      // iframe: remoteApplied {seq}. Basis + if_updated_at maju bersama dari snapshot entri — kecuali bila edit lokal
      // berpapasan (autosave yang tertunda membawa edit itu; merge router menggabungkannya, tab membaca ulang).
      applied(seq) {
        const e = pending().get(seq);
        if (!e) return null;
        pending().forEach((_v, k) => { if (k <= seq) pending().delete(k); });
        if (e.raced) {
          refs.remoteStaleRef.current = true;
          // kanvas perlu dikembalikan ke versi lokal hanya bila tidak ada remoteUpdate lebih baru yang menggantikannya
          return Object.assign({}, e, { revert: seq === refs.remoteSeqRef.current });
        } else {
          refs.baseDocRef.current = e.dataStr;
          refs.lastKnownAtRef.current = e.updatedAt;
        }
        return e;
      },
      // iframe: remoteSkipped {seq} (pengguna sedang mengetik di #input-box). Basis tidak maju.
      skipped(seq) {
        pending().delete(seq);
        refs.remoteStaleRef.current = true;
      },
      // Autosave sukses: basis = data_json yang disimpan. if_updated_at maju hanya untuk tulis biasa
      // (merged / conflict_copy → isi record ≠ kanvas; maju lewat remoteApplied hasilnya).
      saved(dataStr, res) {
        refs.baseDocRef.current = dataStr;
        const applyResult = !!(res && (res.merged || res.conflict_copy));
        if (res && !applyResult && res.updated_at != null) refs.lastKnownAtRef.current = res.updated_at;
        return { applyResult };
      },
    };
  }

  // Sinyal stream untuk revisi yang sudah dikenal record lokal (mis. gema simpan sendiri): tidak perlu pull.
  function isEcho(sid, updatedAt) {
    if (updatedAt == null) return Promise.resolve(false);
    return TFidmap().cidOf("mindmap", sid).then((cid) => {
      if (cid == null) return false;
      return TFdb().openDB().then((db) => new Promise((resolve) => {
        const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get(cid);
        r.onsuccess = () => resolve(!!(r.result && r.result.base_rev != null && String(r.result.base_rev) === String(updatedAt)));
        r.onerror = () => resolve(false);
      }));
    }).catch(() => false);
  }

  const exported = {
    RECONNECT_MIN_MS, RECONNECT_MAX_MS, RECONNECT_MAX_ATTEMPTS, LIVE_LABEL, LIVE_TITLE, DELETED_MSG, ACCESS_LOST_MSG,
    backoffMs, shouldReconnect, newSessionId, conflictToast, createTabLive, isEcho,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaplive = exported; }
  return exported;
});
