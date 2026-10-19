;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Sampah mindmap offline (spec #5): teks UI, cermin GET /api/mindmaps/trash di _meta, daftar gabungan
  // (cermin + hapus lokal yang belum terkirim), pulihkan lokal / antre op "restore".
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  // Dibaca malas (saat dipanggil) agar urutan muat skrip di browser tidak jadi masalah.
  const TFdb = () => req("./db.js", root.TF && root.TF.db);
  const TFmeta = () => req("./meta.js", root.TF && root.TF.meta);
  const TFoutbox = () => req("./outbox.js", root.TF && root.TF.outbox);
  const TFmm = () => req("./mindmaprepo.js", root.TF && root.TF.mindmaprepo);

  const CONFIRM_MOVE = "Pindahkan peta ini ke Sampah? Bisa dipulihkan dalam 30 hari.";
  const TOAST_MOVED = "🗑 Dipindahkan ke Sampah";
  const TOAST_RESTORED = "♻️ Peta dipulihkan";
  const TOAST_RESTORE_QUEUED = "♻️ Peta dipulihkan — disinkronkan saat online";
  const CONFIRM_PURGE = "Hapus peta ini secara permanen? Tindakan ini tidak bisa dibatalkan.";
  const CONFIRM_EMPTY = "Kosongkan Sampah mindmap? Semua peta di Sampah akan dihapus permanen.";
  const SOURCE_MISSING_MSG = "Catatan sumbernya sudah tidak ada — pulihkan catatannya dulu";
  const PURGE_OFFLINE_MSG = "Perlu koneksi internet untuk menghapus permanen";
  const PENDING_LABEL = "menunggu sinkron";
  const META_KEY = "mindmapTrash:v1";
  const RETENTION_DAYS = 30;

  // Sama dengan _mindmap_plain (webapp.py).
  function plain(topic) {
    let s = String(topic == null ? "" : topic).slice(0, 2000);
    s = s.replace(/<[^>]+>/g, "");
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    s = s.replace(/\*\*|__|~~|==|`/g, "");
    s = s.replace(/^#{1,6}\s*/, "");
    return s.replace(/\s+/g, " ").trim();
  }
  // Sama dengan _mindmap_topics: topic polos semua node pre-order (root dulu), yang kosong dilewati.
  function topicsOf(dataJson) {
    let data;
    try { data = JSON.parse(dataJson || ""); } catch (_) { return []; }
    const rootNode = data && typeof data === "object" && !Array.isArray(data) ? data.nodeData : null;
    if (!rootNode || typeof rootNode !== "object" || Array.isArray(rootNode)) return [];
    const out = [];
    const stack = [rootNode];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const t = plain(node.topic);
      if (t) out.push(t);
      if (Array.isArray(node.children)) for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
    }
    return out;
  }
  // ≤ 3 topic pertama setelah root, " · " (sama dengan preview GET /api/mindmaps/trash).
  function previewOf(dataJson) {
    return topicsOf(dataJson).slice(1, 4).join(" · ");
  }

  function normMirror(v) {
    v = v && typeof v === "object" ? v : {};
    return {
      items: Array.isArray(v.items) ? v.items : [],
      restoring: Array.isArray(v.restoring) ? v.restoring.map(Number) : [],
      errors: v.errors && typeof v.errors === "object" ? Object.assign({}, v.errors) : {},
    };
  }
  function readMirror() {
    return TFmeta().metaGet(META_KEY).then(normMirror);
  }
  function saveMirror(m) {
    return TFmeta().metaSet(META_KEY, { items: m.items, restoring: m.restoring, errors: m.errors });
  }
  // Ganti items (hasil GET /trash); restoring/errors hanya dipertahankan untuk sid yang masih ada di items.
  function writeMirror(items) {
    items = Array.isArray(items) ? items : [];
    return readMirror().then((m) => {
      const sids = new Set(items.map((i) => String(i.id)));
      const errors = {};
      for (const k of Object.keys(m.errors)) if (sids.has(String(k))) errors[k] = m.errors[k];
      return saveMirror({ items, restoring: m.restoring.filter((s) => sids.has(String(s))), errors });
    });
  }
  // Hasil push op restore: ok/gone → item keluar dari cermin; lainnya → errors[sid] = outcome.
  function markRestoreResult(sid, outcome) {
    const key = String(sid);
    return readMirror().then((m) => {
      m.restoring = m.restoring.filter((s) => String(s) !== key);
      if (outcome === "ok" || outcome === "gone") {
        m.items = m.items.filter((i) => String(i.id) !== key);
        delete m.errors[key];
      } else {
        m.errors[key] = outcome;
      }
      return saveMirror(m);
    });
  }

  function allMindmapsRaw() {
    return TFdb().openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  // Hapus lokal yang belum terkirim: belum pernah di server, atau op delete (bukan penanda then_restore_sid)
  // masih di outbox. `alive` = sid record lokal yang tidak terhapus (dipulihkan lokal) → item cermin-nya disembunyikan.
  function localState() {
    return Promise.all([allMindmapsRaw(), TFoutbox().outboxAll()]).then(([all, ops]) => {
      const delCids = new Set(ops.filter((o) => o.entity_type === "mindmap" && o.op === "delete"
        && !(o.payload && o.payload.then_restore_sid != null)).map((o) => o.cid));
      return {
        pending: all.filter((m) => m.deleted && m.trashed_at && (m.server_id == null || delCids.has(m.cid))),
        alive: new Set(all.filter((m) => !m.deleted && m.server_id != null).map((m) => String(m.server_id))),
      };
    });
  }
  function pendingLocal() { return localState().then((s) => s.pending); }
  function timeOf(s) { const t = Date.parse(s); return isNaN(t) ? 0 : t; }

  function localItem(rec) {
    const linked = !!TFmm().isLinked(rec);
    return {
      id: rec.server_id != null ? rec.server_id : rec.cid, cid: rec.cid,
      title: rec.title, preview: linked ? "" : previewOf(rec.data_json),
      list_id: rec.list_id != null ? rec.list_id : null,
      source_note_id: rec.source_note_id != null ? rec.source_note_id : null,
      linked, client_id: rec.client_id || rec.cid,
      deleted_at: rec.trashed_at, days_left: RETENTION_DAYS, pending: true, error: null,
    };
  }
  function mirrorItem(it, errors) {
    return {
      id: it.id, cid: it.client_id != null && it.client_id !== "" ? String(it.client_id) : null,
      title: it.title, preview: it.preview || "",
      list_id: it.list_id != null ? it.list_id : null,
      source_note_id: it.source_note_id != null ? it.source_note_id : null,
      linked: !!it.linked, client_id: it.client_id != null ? it.client_id : null,
      deleted_at: it.deleted_at, days_left: it.days_left, pending: false,
      error: errors[String(it.id)] || null,
    };
  }

  // Daftar gabungan, terbaru dulu (Date.parse — format campur Z/+07:00); record lokal menang atas cermin.
  function listTrash() {
    return Promise.all([readMirror(), localState()]).then(([m, st]) => {
      const locals = st.pending;
      const out = locals.map(localItem);
      const localSids = new Set(locals.filter((r) => r.server_id != null).map((r) => String(r.server_id)));
      for (const k of st.alive) localSids.add(k);
      const restoring = new Set(m.restoring.map(String));
      for (const it of m.items) {
        const k = String(it.id);
        if (restoring.has(k) || localSids.has(k)) continue;
        out.push(mirrorItem(it, m.errors));
      }
      out.sort((a, b) => timeOf(b.deleted_at) - timeOf(a.deleted_at));
      return out;
    });
  }

  function notInTrash() { return Promise.reject(TFmm().notInTrashError()); }

  // Antre restore untuk item cermin — SATU transaksi (_meta + _outbox): op dan tanda `restoring` ditulis bersama
  // (outboxAdd gagal tidak bisa menyembunyikan item selamanya); op restore yang sudah ada untuk sid → idempoten
  // (klik ganda tidak mengantre dua op). Resolve sid atau null (tidak ada di cermin).
  function queueMirrorRestore(key) {
    return TFdb().openDB().then((db) => new Promise((resolve, reject) => {
      let out = null;
      const tx = db.transaction(["_meta", "_outbox"], "readwrite");
      const mt = tx.objectStore("_meta");
      const ob = tx.objectStore("_outbox");
      const rm = mt.get(META_KEY);
      rm.onsuccess = () => {
        const m = normMirror(rm.result);
        const it = m.items.find((i) => String(i.id) === key);
        if (!it) return;
        const sid = Number(it.id);
        const ra = ob.getAll();
        ra.onsuccess = () => {
          const exists = (ra.result || []).some((o) => o.entity_type === "mindmap" && o.op === "restore"
            && o.payload && String(o.payload.server_id) === String(sid));
          if (!exists) ob.add({ ts: Date.now(), retries: 0, op: "restore", entity_type: "mindmap", cid: "trash:" + sid, payload: { server_id: sid } });
          if (!m.restoring.some((s) => String(s) === String(sid))) m.restoring.push(sid);
          delete m.errors[String(it.id)];
          mt.put({ items: m.items, restoring: m.restoring, errors: m.errors }, META_KEY);
          out = sid;
        };
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("mindmap trash restore aborted"));
    }));
  }

  // Pulihkan: hapus lokal tertunda → mindmaprepo.restoreLocal; item cermin → antre op restore (sid → restoring).
  function restore(idOrCid) {
    const key = String(idOrCid);
    return pendingLocal().then((locals) => {
      const rec = locals.find((r) => r.cid === key) || locals.find((r) => r.server_id != null && String(r.server_id) === key);
      if (rec) return TFmm().restoreLocal(rec.cid).then(() => ({ restored: "local", cid: rec.cid }));
      return queueMirrorRestore(key).then((sid) => (sid == null ? notInTrash() : { restored: "queued", id: sid }));
    });
  }

  const exported = {
    CONFIRM_MOVE, TOAST_MOVED, TOAST_RESTORED, TOAST_RESTORE_QUEUED, CONFIRM_PURGE, CONFIRM_EMPTY,
    SOURCE_MISSING_MSG, PURGE_OFFLINE_MSG, PENDING_LABEL, META_KEY, RETENTION_DAYS,
    previewOf, readMirror, writeMirror, markRestoreResult, listTrash, restore,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaptrash = exported; }
  return exported;
});
