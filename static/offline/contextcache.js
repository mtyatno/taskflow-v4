;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Cache entitas context / "tahap" Kanban di `_meta` key "contexts:v1" = { at, items }. Item = baris
  // GET /api/contexts?format=full&scope=all&include_archived=1. Scope: list_id terisi → workspace itu,
  // null → pribadi. Tahap yang dibuat saat offline disimpan terpisah di "contexts:pending:v1" = { items }
  // (R1: tanpa store IndexedDB baru) supaya `refresh` tidak pernah menghapusnya; `resolvePending` /
  // `dropPending` yang menyingkirkannya setelah push. Pembanding nama = NOCASE ASCII (pakai projectcache).
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFmeta = req("./meta.js", root.TF && root.TF.meta);
  const TFproj = req("./projectcache.js", root.TF && root.TF.projectcache);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  // taskquery dimuat malas: taskrepo → (cache) → taskquery → taskrepo (siklus require di Node).
  const taskquery = () => (isNode ? require("./taskquery.js") : (root.TF && root.TF.taskquery));

  const KEY = "contexts:v1";
  const PENDING_KEY = "contexts:pending:v1";
  const FULL_PATH = "/api/contexts?format=full&scope=all&include_archived=1";
  const EMPTY_NAME_MSG = "Nama tahap tidak boleh kosong";

  const nocaseKey = TFproj.nocaseKey, nocaseEq = TFproj.nocaseEq, nocaseCompare = TFproj.nocaseCompare;

  function scopeKey(listId) {
    return (listId == null || listId === "") ? null : String(listId);
  }
  function inScope(item, listId) {
    return scopeKey(item && item.list_id) === scopeKey(listId);
  }
  // Id server = bilangan bulat; cid lokal (UUID) bukan angka dan tidak boleh dikirim sebagai context_id.
  function isServerId(id) {
    return id != null && /^\d+$/.test(String(id));
  }

  // Pull memakai `transport(path)` → Response (atau nilai mentah di tes). Gagal / bukan array → throw;
  // cache lama dipertahankan. Tidak menyentuh PENDING_KEY.
  function refresh(transport) {
    return Promise.resolve(transport(FULL_PATH)).then((res) => {
      if (!res || res.ok === false || (typeof res.status === "number" && res.status >= 400)) {
        const e = new Error("http " + (res ? res.status : "null"));
        e.status = res ? res.status : null;
        throw e;
      }
      return typeof res.json === "function" ? res.json() : res;
    }).then((items) => {
      if (!Array.isArray(items)) throw new Error("contexts: bukan daftar");
      return TFmeta.metaSet(KEY, { at: Date.now(), items: items });
    });
  }

  const itemsOf = (v) => (v && Array.isArray(v.items) ? v.items : []);
  // Baca untuk tampilan: gagal baca dianggap kosong.
  function serverItems() {
    return TFmeta.metaGet(KEY).then(itemsOf, () => []);
  }
  function pendingItems() {
    return TFmeta.metaGet(PENDING_KEY).then(itemsOf, () => []);
  }
  // Baca untuk mutasi: kegagalan baca HARUS menolak (jangan dianggap kosong lalu ditulis balik, itu menghapus data).
  function strictServerItems() {
    return TFmeta.metaGet(KEY).then(itemsOf);
  }
  function strictPendingItems() {
    return TFmeta.metaGet(PENDING_KEY).then(itemsOf);
  }
  // list_id seragam dengan item server: string angka → number, ""/undefined/null → null.
  function normListId(listId) {
    if (listId == null || listId === "") return null;
    if (typeof listId === "string" && /^\d+$/.test(listId)) return Number(listId);
    return listId;
  }

  // Item server + item pending (pending di belakang).
  function allItems() {
    return Promise.all([serverItems(), pendingItems()]).then(([s, p]) => s.concat(p));
  }

  // Pure: urut `position`, lalu nama NOCASE, lalu String(id). Tidak mengubah input.
  function sortItems(items) {
    return (items || []).slice().sort((a, b) => {
      const pa = Number(a.position) || 0, pb = Number(b.position) || 0;
      if (pa !== pb) return pa < pb ? -1 : 1;
      const c = nocaseCompare(a.name, b.name);
      if (c !== 0) return c;
      const ia = String(a.id), ib = String(b.id);
      return ia < ib ? -1 : (ia > ib ? 1 : 0);
    });
  }

  function list(listId, opts) {
    const includeArchived = !!(opts && opts.includeArchived);
    return allItems().then((items) =>
      sortItems(items.filter((c) => inScope(c, listId) && (includeArchived || !c.archived))));
  }

  // Nama tahap di scope: item cache tidak diarsip (urut posisi), lalu nama context task aktif di scope
  // yang belum ada (NOCASE), diurut NOCASE (ejaan pertama menang).
  function names(listId) {
    return Promise.all([list(listId), taskquery().getContextsInScope(listId)]).then(([items, taskNames]) => {
      const out = items.map((c) => c.name);
      const seen = new Set(out.map(nocaseKey));
      const extra = [];
      for (const n of taskNames || []) {
        if (n == null || n === "") continue;
        const k = nocaseKey(n);
        if (seen.has(k)) continue;
        seen.add(k);
        extra.push(n);
      }
      return out.concat(extra.sort(nocaseCompare));
    });
  }

  // Pure: id tahap bernama `name` di scope itu (termasuk arsip dan pending), atau null.
  function findId(items, listId, name) {
    if (name == null || name === "") return null;
    for (const c of items || []) {
      if (inScope(c, listId) && nocaseEq(c.name, name)) return c.id;
    }
    return null;
  }

  // Penulisan PENDING_KEY dijalankan berurutan (baca-ubah-tulis) supaya panggilan bersamaan tidak saling menimpa.
  let chain = Promise.resolve();
  function serialized(fn) {
    const run = chain.then(fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  }
  function setPending(items) {
    return TFmeta.metaSet(PENDING_KEY, { items: items });
  }

  // Tambah tahap pending. Nama di-trim; kosong → reject. Nama yang sudah ada di scope (NOCASE, termasuk arsip
  // dan pending) dipakai ulang → created:false.
  function addPending(listId, name) {
    return serialized(() => {
      const trimmed = String(name == null ? "" : name).trim();
      if (!trimmed) throw new Error(EMPTY_NAME_MSG);
      return Promise.all([strictServerItems(), strictPendingItems()]).then(([server, pending]) => {
        const all = server.concat(pending);
        const existing = all.find((c) => inScope(c, listId) && nocaseEq(c.name, trimmed));
        if (existing) return { item: existing, created: false };
        let max = -1;
        for (const c of all) {
          if (!inScope(c, listId)) continue;
          const p = Number(c.position);
          if (!isNaN(p) && p > max) max = p;
        }
        const cid = TFids.newCid();
        const item = {
          id: cid, cid: cid, name: trimmed, list_id: normListId(listId),
          user_id: null, position: max + 1, color: null, archived: false, can_manage: true, pending: true,
        };
        return setPending(pending.concat([item])).then(() => ({ item, created: true }));
      });
    });
  }

  // Hapus entri pending `cid` dan upsert `serverItem` (berdasarkan id) ke cache server.
  function resolvePending(cid, serverItem) {
    return serialized(() => Promise.all([TFmeta.metaGet(KEY), strictPendingItems()]).then(([v, pending]) => {
      const items = v && Array.isArray(v.items) ? v.items.slice() : [];
      if (serverItem && serverItem.id != null) {
        const i = items.findIndex((c) => String(c.id) === String(serverItem.id));
        if (i >= 0) items[i] = serverItem; else items.push(serverItem);
      }
      const at = v && typeof v.at === "number" ? v.at : Date.now();
      return TFmeta.metaSet(KEY, { at, items })
        .then(() => setPending(pending.filter((c) => String(c.cid) !== String(cid))));
    }));
  }

  function dropPending(cid) {
    return serialized(() => strictPendingItems().then((pending) =>
      setPending(pending.filter((c) => String(c.cid) !== String(cid)))));
  }

  function pendingByCid(cid) {
    return pendingItems().then((pending) => pending.find((c) => String(c.cid) === String(cid)) || null);
  }
  // Untuk push: kegagalan baca MENOLAK (jangan dianggap "entri sudah tidak ada" → op dibuang).
  function pendingByCidStrict(cid) {
    return strictPendingItems().then((pending) => pending.find((c) => String(c.cid) === String(cid)) || null);
  }
  // Semua entri pending (baca strict: gagal → reject).
  function pendingList() {
    return strictPendingItems().then((pending) => pending.slice());
  }

  // Record lama tanpa `context_ref_name`: teks `context` saat ini dianggap nama ikatannya.
  function refNameOf(record) {
    if (!record || record.context_id == null) return null;
    return record.context_ref_name != null ? record.context_ref_name : (record.context != null ? record.context : "");
  }

  // Pure: context_id yang boleh dikirim ke server untuk record task (aturan F1 sama dengan
  // projectcache.payloadProjectId). Tambahan: id yang bukan angka (cid pending) tidak pernah dikirim → null.
  function payloadContextId(record, items) {
    if (!record || record.context_id == null || !Array.isArray(items)) return null;
    if (!isServerId(record.context_id)) return null;
    if (nocaseEq(record.context, refNameOf(record))) {
      for (const c of items) {
        if (String(c.id) === String(record.context_id) && !inScope(c, record.list_id)) return null;
      }
      return record.context_id;
    }
    const id = findId(items, record.list_id, record.context);
    return isServerId(id) ? id : null;
  }

  const exported = {
    KEY, PENDING_KEY, FULL_PATH,
    refresh, allItems, sortItems, list, names, findId,
    addPending, resolvePending, dropPending, pendingByCid, pendingByCidStrict, pendingList,
    refNameOf, payloadContextId,
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.contextcache = exported; }
  return exported;
});
