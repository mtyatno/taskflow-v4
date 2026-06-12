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
      list_id: rec.list_id != null ? rec.list_id : null,
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
    router.register("PUT", "/api/mindmaps/:id", ({ params, body }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.updateMindmap(cid, body || {}, {}).then(() => getFull(cid)) : notFound())));
    router.register("PATCH", "/api/mindmaps/:id/pin", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.togglePin(cid).then(() => getFull(cid)) : notFound())));
    router.register("DELETE", "/api/mindmaps/:id", ({ params }) =>
      resolveMindmapCid(params.id).then((cid) => (cid ? TFrepo.deleteMindmap(cid) : notFound())));
    router.register("GET", "/api/lists/:id/mindmaps", ({ params }) =>
      allMindmaps().then((all) => all
        .filter((m) => !m.deleted && m.list_id != null && String(m.list_id) === String(params.id))
        .sort((a, b) => (String(b.updated_at) < String(a.updated_at) ? -1 : String(b.updated_at) > String(a.updated_at) ? 1 : 0))
        .map((m) => ({ id: m.server_id != null ? m.server_id : m.cid, title: m.title, updated_at: m.updated_at }))));
  }

  const exported = { registerMindmapRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.mindmaproutes = exported; }
  return exported;
});
