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
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  function getAllLists() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("lists", "readonly").objectStore("lists").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function putList(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteList(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("lists", "readwrite");
      tx.objectStore("lists").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("list", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("list", serverId, fresh).then(() => fresh);
    });
  }
  function listFromServer(s, cid) {
    return {
      cid: cid, server_id: s.id, name: s.name,
      owner_id: s.owner_id != null ? s.owner_id : null,
      role: s.role, member_count: s.member_count != null ? s.member_count : 0, dirty: 0,
      pinned: s.pinned === true, pin_position: s.pin_position != null ? s.pin_position : null,
      description: typeof s.description === "string" ? s.description : "",
      color_idx: s.color_idx != null ? s.color_idx : null,
      avatar: s.avatar != null ? s.avatar : null,
      updated_at: s.updated_at != null ? s.updated_at : null,
    };
  }

  function pullLists(serverLists) {
    const list = serverLists || [];
    const cache = {};
    return list.reduce((p, s) => p.then(() => ensureCid(s.id, cache)), Promise.resolve())
      .then(() => getAllLists())
      .then((localAll) => {
        const byCid = {};
        for (const r of localAll) byCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0 };
        let chain = Promise.resolve();
        for (const s of list) {
          const cid = cache[s.id];
          const existing = byCid[cid];
          chain = chain.then(() => { if (existing) result.updated++; else result.created++; return putList(listFromServer(s, cid)); });
        }
        const serverIds = new Set(list.map((s) => String(s.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => { result.deleted++; return deleteList(r.cid); });
        }
        return chain.then(() => result);
      });
  }

  function getLocalLists() {
    return getAllLists().then((rows) => rows.map((r) => ({
      id: r.server_id != null ? r.server_id : r.cid,
      name: r.name, owner_id: r.owner_id, role: r.role, member_count: r.member_count,
      pinned: r.pinned === true, pin_position: r.pin_position != null ? r.pin_position : null,
      description: typeof r.description === "string" ? r.description : "",
      color_idx: r.color_idx != null ? r.color_idx : null,
      avatar: r.avatar != null ? r.avatar : null,
      updated_at: r.updated_at != null ? r.updated_at : null,
    })));
  }

  // T1: respons gagal (503 OFFLINE dari SW, 401, 5xx) → throw; body error tidak boleh diurai sebagai daftar
  // (daftar kosong = semua list lokal dihapus). Daftar yang ok boleh menghapus list lokal yang hilang.
  function listJsonOrThrow(res) {
    if (res && (res.ok === false || (typeof res.status === "number" && res.status >= 400))) {
      const e = new Error("http " + res.status);
      e.status = res.status;
      throw e;
    }
    return res && typeof res.json === "function" ? res.json() : res;
  }

  function pullAndReconcileLists(rawFetch) {
    return Promise.resolve(rawFetch("/api/lists"))
      .then(listJsonOrThrow)
      .then((l) => {
        if (l != null && !Array.isArray(l)) throw new Error("bad list body"); // body bukan daftar → jangan hapus apa pun
        return pullLists(l || []);
      });
  }

  // Pin/unpin online sukses → tulis status pin ke record list lokal (sebelum pull penuh), supaya
  // GET /api/lists dari router lokal langsung mencerminkan pin baru. Record tak ditemukan → no-op.
  function setLocalPin(serverId, pinned, pinPosition) {
    return getAllLists().then((rows) => {
      const rec = rows.find((r) => r.server_id != null && String(r.server_id) === String(serverId));
      if (!rec) return false;
      const next = Object.assign({}, rec, {
        pinned: pinned === true,
        pin_position: pinned === true && pinPosition != null ? pinPosition : null,
      });
      return putList(next).then(() => true);
    });
  }

  // Edit identitas online sukses → tulis field ke record lokal. Hanya kunci identitas yang diterima.
  const IDENTITY_KEYS = ["name", "description", "color_idx", "avatar", "updated_at"];
  function setLocalIdentity(serverId, fields) {
    return getAllLists().then((rows) => {
      const rec = rows.find((r) => r.server_id != null && String(r.server_id) === String(serverId));
      if (!rec) return false;
      const next = Object.assign({}, rec);
      for (const k of IDENTITY_KEYS) if (fields && Object.prototype.hasOwnProperty.call(fields, k)) next[k] = fields[k];
      return putList(next).then(() => true);
    });
  }

  // Urutan pin: pin_position = indeks tiap id. Mengembalikan jumlah record yang diperbarui.
  function setLocalPinOrder(serverIds) {
    const ids = (serverIds || []).map(String);
    return getAllLists().then((rows) => {
      let chain = Promise.resolve(), n = 0;
      for (const r of rows) {
        const i = r.server_id != null ? ids.indexOf(String(r.server_id)) : -1;
        if (i < 0) continue;
        chain = chain.then(() => { n++; return putList(Object.assign({}, r, { pin_position: i })); });
      }
      return chain.then(() => n);
    });
  }

  const exported = { pullLists, getLocalLists, pullAndReconcileLists, listFromServer, setLocalPin, setLocalIdentity, setLocalPinOrder };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.listsync = exported; }
  return exported;
});
