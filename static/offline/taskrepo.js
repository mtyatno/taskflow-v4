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
  const TFdb = isNode ? require("./db.js") : root.TF.db;
  const TFids = isNode ? require("./ids.js") : root.TF.ids;
  const TFoutbox = isNode ? require("./outbox.js") : root.TF.outbox;
  const TFlogic = isNode ? require("./tasklogic.js") : root.TF.tasklogic;

  function getRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }

  // Build the frontend-facing display object from a stored record.
  function assemble(rec, todayISO) {
    const derived = TFlogic.deriveTaskFields(rec, todayISO);
    return getParentTitle(rec.parent_cid).then((parentTitle) =>
      Object.assign({}, rec, {
        is_focused: !!rec.is_focused,
        days_until_deadline: derived.days_until_deadline,
        is_overdue: derived.is_overdue,
        assigned_to_name: null, // resolution deferred (no local users store yet)
        parent_title: parentTitle,
      })
    );
  }

  function getParentTitle(parentCid) {
    if (!parentCid) return Promise.resolve(null);
    return getRaw(parentCid).then((p) => (p && !p.deleted ? p.title : null));
  }

  function getTask(cid, todayISO) {
    return getRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return undefined;
      return assemble(rec, todayISO);
    });
  }

  const exported = { getTask };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.taskrepo = exported; }
  return exported;
});
