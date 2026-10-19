;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Cache entitas project (PR 5) di `_meta` key "projects:v1" = { at, items }. Item = baris
  // GET /api/projects?format=full&scope=all&include_archived=1. Scope: list_id terisi → workspace itu,
  // null → pribadi. Nama dibandingkan/diurutkan NOCASE (lipat A–Z ASCII saja, seperti SQLite).
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFmeta = req("./meta.js", root.TF && root.TF.meta);
  // taskquery dimuat malas: taskrepo → projectcache → taskquery → taskrepo (siklus require di Node).
  const taskquery = () => (isNode ? require("./taskquery.js") : (root.TF && root.TF.taskquery));

  const KEY = "projects:v1";
  const FULL_PATH = "/api/projects?format=full&scope=all&include_archived=1";

  function nocaseKey(s) {
    return String(s == null ? "" : s).replace(/[A-Z]/g, (c) => c.toLowerCase());
  }
  function nocaseEq(a, b) { return nocaseKey(a) === nocaseKey(b); }
  function nocaseCompare(a, b) {
    const ka = nocaseKey(a), kb = nocaseKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  }
  function scopeKey(listId) {
    return (listId == null || listId === "") ? null : String(listId);
  }
  function inScope(item, listId) {
    return scopeKey(item && item.list_id) === scopeKey(listId);
  }

  // Pull memakai `rawFetch(path)` → Response (atau nilai mentah di tes). Gagal / bukan array → throw;
  // cache lama dipertahankan.
  function refresh(transport) {
    return Promise.resolve(transport(FULL_PATH)).then((res) => {
      if (!res || res.ok === false || (typeof res.status === "number" && res.status >= 400)) {
        const e = new Error("http " + (res ? res.status : "null"));
        e.status = res ? res.status : null;
        throw e;
      }
      return typeof res.json === "function" ? res.json() : res;
    }).then((items) => {
      if (!Array.isArray(items)) throw new Error("projects: bukan daftar");
      return TFmeta.metaSet(KEY, { at: Date.now(), items: items });
    });
  }

  function allItems() {
    return TFmeta.metaGet(KEY).then((v) => (v && Array.isArray(v.items) ? v.items : []), () => []);
  }

  // Pure: item cache di scope itu (tanpa arsip kecuali includeArchived).
  function filterScope(items, listId, opts) {
    const includeArchived = !!(opts && opts.includeArchived);
    return (items || []).filter((p) => inScope(p, listId) && (includeArchived || !p.archived));
  }

  function list(listId, opts) {
    return allItems().then((items) => filterScope(items, listId, opts));
  }

  // Pure: gabungkan daftar nama, dedup + urut NOCASE (nama pertama yang muncul menang).
  function mergeNames(lists) {
    const seen = new Set();
    const out = [];
    for (const arr of lists) {
      for (const n of arr || []) {
        if (n == null || n === "") continue;
        const k = nocaseKey(n);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(n);
      }
    }
    return out.sort(nocaseCompare);
  }

  function names(listId) {
    return Promise.all([list(listId), taskquery().getProjectsInScope(listId)])
      .then(([items, taskNames]) => mergeNames([items.map((p) => p.name), taskNames]));
  }

  // Pure: id project bernama `name` di scope itu (termasuk arsip), atau null.
  function findId(items, listId, name) {
    if (name == null || name === "") return null;
    for (const p of items || []) {
      if (inScope(p, listId) && nocaseEq(p.name, name)) return p.id;
    }
    return null;
  }

  function idFor(listId, name) {
    return allItems().then((items) => findId(items, listId, name));
  }

  // Pure: nama yang mengikat `project_id` di record task (disimpan sebagai `project_ref_name` setiap kali id
  // ditulis). Id null → null.
  function refNameFor(project, projectId) {
    return projectId == null ? null : (project != null ? project : "");
  }
  // Record lama tanpa `project_ref_name`: teks `project` saat ini dianggap nama ikatannya.
  function refNameOf(record) {
    if (!record || record.project_id == null) return null;
    return record.project_ref_name != null ? record.project_ref_name : (record.project != null ? record.project : "");
  }

  // Pure: project_id yang boleh dikirim ke server untuk record task (F1 final review).
  // - Teks `project` record masih sama (NOCASE) dengan nama ikatannya → kirim `project_id` record apa adanya,
  //   walau cache (yang disegarkan pull sebelum push) sudah menunjukkan project itu di-rename atau dihapus:
  //   server mempertahankan id yang di-rename dan mengabaikan id yang dihapus, sehingga nama lama tidak dibuat
  //   ulang. Satu-satunya pengecualian: id ada di cache tapi di scope lain → tidak dikirim (cegah 400).
  // - Teks sudah berbeda (user memilih project lain offline) → id hanya bila cache memetakan teks baru itu di
  //   scope task; selain itu null (kirim teks saja).
  function payloadProjectId(record, items) {
    if (!record || record.project_id == null || !Array.isArray(items)) return null;
    if (nocaseEq(record.project, refNameOf(record))) {
      for (const p of items) {
        if (String(p.id) === String(record.project_id) && !inScope(p, record.list_id)) return null;
      }
      return record.project_id;
    }
    return findId(items, record.list_id, record.project);
  }

  const exported = {
    KEY, FULL_PATH,
    refresh, list, names, idFor, allItems,
    filterScope, mergeNames, findId, payloadProjectId, refNameFor, refNameOf, nocaseKey, nocaseCompare, nocaseEq,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.projectcache = exported; }
  return exported;
});
