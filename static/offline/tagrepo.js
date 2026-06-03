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

  const TAG_RE = /#([a-zA-Z0-9_À-ɏ]+)/g;

  // Pure: lowercased, de-duplicated tag names (in first-seen order) + the title with tags removed.
  function extractTags(title) {
    const s = String(title == null ? "" : title);
    const tags = [];
    const seen = {};
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(s)) !== null) {
      const name = m[1].toLowerCase();
      if (!seen[name]) { seen[name] = true; tags.push(name); }
    }
    return { clean: s.replace(TAG_RE, "").trim(), tags: tags };
  }

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }

  // Replace the entity's links with the given tag names (normalized). Upserts `tags` by name.
  function setEntityTags(entityType, entityCid, tagNames) {
    const names = [];
    const seen = {};
    for (const raw of (tagNames || [])) {
      const n = String(raw).trim().toLowerCase();
      if (n && !seen[n]) { seen[n] = true; names.push(n); }
    }
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(["tags", "entity_tags"], "readwrite");
      const tagStore = tx.objectStore("tags");
      const etStore = tx.objectStore("entity_tags");
      const nameIdx = tagStore.index("name");
      const entityIdx = etStore.index("entity");

      const delReq = entityIdx.openCursor(IDBKeyRange.only([entityType, entityCid]));
      delReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { cur.delete(); cur.continue(); }
        else { upsertNext(0); }
      };

      function upsertNext(i) {
        if (i >= names.length) return; // done — tx.oncomplete resolves
        const g = nameIdx.get(names[i]);
        g.onsuccess = () => {
          let tagCid;
          if (g.result) {
            tagCid = g.result.cid;
          } else {
            tagCid = TFids.newCid();
            tagStore.add({ cid: tagCid, server_id: null, name: names[i], color: null, dirty: 1 });
          }
          etStore.add({
            cid: TFids.newCid(), tag_cid: tagCid,
            entity_type: entityType, entity_cid: entityCid, dirty: 1,
          });
          upsertNext(i + 1);
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  function getEntityTags(entityType, entityCid) {
    return Promise.all([getAll("entity_tags"), getAll("tags")]).then(([ets, tags]) => {
      const tagByCid = {};
      for (const t of tags) tagByCid[t.cid] = t;
      const out = [];
      for (const et of ets) {
        if (et.entity_type === entityType && et.entity_cid === entityCid) {
          const t = tagByCid[et.tag_cid];
          if (t) out.push({ name: t.name, color: t.color != null ? t.color : null });
        }
      }
      out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return out;
    });
  }

  function getAllTags() {
    return getAll("tags").then((rows) =>
      rows.map((t) => ({ name: t.name, color: t.color != null ? t.color : null }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    );
  }

  function removeEntityTag(entityType, entityCid, name) {
    const norm = String(name).trim().toLowerCase();
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(["tags", "entity_tags"], "readwrite");
      const nameIdx = tx.objectStore("tags").index("name");
      const entityIdx = tx.objectStore("entity_tags").index("entity");
      const g = nameIdx.get(norm);
      g.onsuccess = () => {
        const tag = g.result;
        if (!tag) return;
        const cur = entityIdx.openCursor(IDBKeyRange.only([entityType, entityCid]));
        cur.onsuccess = (e) => {
          const c = e.target.result;
          if (c) { if (c.value.tag_cid === tag.cid) c.delete(); c.continue(); }
        };
      };
      tx.oncomplete = () => resolve({ ok: true });
      tx.onerror = () => reject(tx.error);
    }));
  }

  function cidsForTag(entityType, tagName) {
    const norm = String(tagName).trim().toLowerCase();
    return Promise.all([getAll("entity_tags"), getAll("tags")]).then(([ets, tags]) => {
      const set = new Set();
      const tag = tags.find((t) => t.name === norm);
      if (!tag) return set;
      for (const et of ets) {
        if (et.entity_type === entityType && et.tag_cid === tag.cid) set.add(et.entity_cid);
      }
      return set;
    });
  }

  const exported = { extractTags, setEntityTags, getEntityTags, getAllTags, removeEntityTag, cidsForTag };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.tagrepo = exported; }
  return exported;
});
