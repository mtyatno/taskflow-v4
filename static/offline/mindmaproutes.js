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
  const TFrepo = req("./mindmaprepo.js", root.TF && root.TF.mindmaprepo);
  // Dibaca malas: urutan tag <script> di browser tidak masalah.
  const TFtrash = () => req("./mindmaptrash.js", root.TF && root.TF.mindmaptrash);

  function allMindmaps() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  const displayId = (rec) => (rec.server_id != null ? rec.server_id : rec.cid);
  function meta(rec) {
    return {
      id: displayId(rec), title: rec.title, is_pinned: rec.pinned ? 1 : 0,
      // client_id = id link node mindmap lintas perangkat (sama dengan clientIdOf di syncpush)
      client_id: rec.client_id || rec.cid || null,
      list_id: rec.list_id != null ? rec.list_id : null,
      source_note_id: rec.source_note_id != null ? rec.source_note_id : null,
      source_note_cid: rec.source_note_cid != null ? rec.source_note_cid : null,
      user_id: rec.user_id != null ? rec.user_id : null,
      last_edited_by: rec.last_edited_by != null ? rec.last_edited_by : null,
      last_editor_username: rec.last_editor_username != null ? rec.last_editor_username : null,
      last_editor_display_name: rec.last_editor_display_name != null ? rec.last_editor_display_name : null,
      created_at: rec.created_at, updated_at: rec.updated_at,
    };
  }
  function full(rec) { return Object.assign(meta(rec), { data_json: rec.data_json }); }

  function resolveMindmapCid(idOrCid) {
    return allMindmaps().then((all) => {
      for (const m of all) if (m.cid === idOrCid) return m.cid;
      for (const m of all) if (m.server_id != null && String(m.server_id) === String(idOrCid)) return m.cid;
      // id dari perangkat lain (link node mindmap = cid pembuat = client_id server; cid lokal bisa berbeda)
      for (const m of all) if (m.client_id != null && String(m.client_id) === String(idOrCid)) return m.cid;
      return null;
    });
  }
  function notFound() { return Promise.reject(new Error("Mindmap not found")); }

  function listMindmaps() {
    return allMindmaps().then((all) => {
      const personal = all.filter((m) => !m.deleted);
      personal.sort((a, b) => {
        const pa = a.pinned ? 1 : 0, pb = b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0;
      });
      return personal.map(meta);
    });
  }
  function getFull(cid) {
    return allMindmaps().then((all) => {
      const rec = all.find((m) => m.cid === cid);
      return rec ? full(rec) : null;
    });
  }

  function registerMindmapRoutes(router) {
    router.register("GET", "/api/mindmaps", () => listMindmaps());
    router.register("POST", "/api/mindmaps", ({ body }) =>
      TFrepo.createMindmap(body || {}, {}).then((rec) => full(rec)));
    router.register("GET", "/api/mindmaps/:id", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? getFull(cid) : notFound())));
    // PUT: body.if_updated_at (opsional, dari tab editor) = updated_at yang dimuat tab; bila record sudah diganti
    // pull/adopsi → (tanpa body.base_data_json) edit disimpan sebagai salinan konflik dan respons membawa `conflict_copy` (meta salinan)
    // + isi record asli (versi server) supaya tab memuat ulang (T3).
    router.register("PUT", "/api/mindmaps/:id", ({ params, body }) =>
      resolveMindmapCid(params.id).then((cid) => (cid
        ? TFrepo.updateMindmap(cid, body || {}, {}).then((saved) => getFull(cid).then((f) => {
          if (saved && saved.merged) {
            // #4: if_updated_at basi + base_data_json → hasil merge3 (salinan konflik hanya bila node sama bentrok)
            return Object.assign(f, { merged: true, merge_conflicts: saved.merge_conflicts },
              saved.conflict_copy ? { conflict_copy: full(saved.conflict_copy) } : {});
          }
          return saved && saved.conflict_copy ? Object.assign(f, { conflict_copy: full(saved.conflict_copy) }) : f;
        }))
        : notFound())));
    router.register("PATCH", "/api/mindmaps/:id/pin", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.togglePin(cid).then(() => getFull(cid)) : notFound())));
    router.register("DELETE", "/api/mindmaps/:id", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.deleteMindmap(cid) : notFound())));
    // Sampah (spec #5): segmen statis "trash" menang atas :id (spesifisitas router). Hapus permanen/kosongkan
    // hanya online — shouldRouteLocally mengecualikan DELETE /api/mindmaps/trash… (taskroutes.isMindmapTrashDelete).
    router.register("GET", "/api/mindmaps/trash", () => TFtrash().listTrash());
    router.register("POST", "/api/mindmaps/trash/:id/restore", ({ params }) => TFtrash().restore(params.id));
    router.register("GET", "/api/lists/:id/mindmaps", ({ params }) =>
      allMindmaps().then((all) => all
        .filter((m) => !m.deleted && m.list_id != null && String(m.list_id) === String(params.id))
        .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0))
        .map((m) => ({ id: m.server_id != null ? m.server_id : m.cid, title: m.title, updated_at: m.updated_at,
          source_note_id: m.source_note_id != null ? m.source_note_id : null }))));
  }

  const exported = { registerMindmapRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaproutes = exported; }
  return exported;
});
