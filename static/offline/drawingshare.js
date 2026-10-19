;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.drawingshare = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Drawing milik workspace (PR 3): share/unshare (online saja), salin, rencana scope untuk note,
  // dan adopsi `moved_drawings` dari respons simpan/share note.
  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFrepo = req("./drawingrepo.js", root.TF && root.TF.drawingrepo);
  // drawdirective.js dimuat SETELAH modul ini di index.html → di browser dicari saat dipakai, bukan saat dimuat.
  const TFdirNode = isNode ? require("./drawdirective.js") : null;
  function dir() { return TFdirNode || (root.TF && root.TF.drawdirective); }

  const OFFLINE_SHARE_MSG = "Butuh koneksi untuk membagikan gambar.";
  const OFFLINE_DATA_MSG = "Data gambar belum tersedia offline.";

  const nn = (v) => (v != null ? v : null);
  const sameList = (a, b) => nn(a) === nn(b) || (a != null && b != null && String(a) === String(b));
  function isOffline() { return typeof navigator !== "undefined" && navigator && navigator.onLine === false; }
  // Baris tanpa user_id (legacy lokal) dianggap milik sendiri (sama dengan guard drawingrepo).
  function isMine(d, myUid) {
    return d.user_id == null || myUid == null || String(d.user_id) === String(myUid);
  }

  // ── Scope notice ────────────────────────────────────────────────────────────
  function scopeNotice(drawing, noteListId, myUid) {
    const d = drawing || {};
    const nl = nn(noteListId);
    if (sameList(d.list_id, nl)) return { kind: "same", listId: nl };
    if (nl == null) return { kind: "ws_in_personal", listId: nn(d.list_id) };
    if (d.list_id == null && isMine(d, myUid)) return { kind: "own_to_ws", listId: nl };
    return { kind: "other_ws_copy", listId: nl };
  }

  function noticeText(notice, listName) {
    const w = listName || "workspace";
    switch (notice && notice.kind) {
      case "own_to_ws":
        return "Gambar ini akan dibagikan ke workspace " + w + " supaya semua anggota bisa melihatnya.";
      case "ws_in_personal":
        return "Gambar ini milik workspace " + w + ". Notemu tetap menautkannya, tetapi hanya anggota " + w + " yang bisa melihatnya.";
      case "other_ws_copy":
        return "Gambar ini bukan milik " + w + ". Salinannya akan dibuat di " + w + " dan tautan di note diganti.";
      default:
        return "";
    }
  }

  // ── Token direktif ::draw[...] ──────────────────────────────────────────────
  function globalDrawRegex() { return new RegExp(dir().DRAW_REGEX.source, "gi"); }
  function tokensOf(drawing) {
    const out = [];
    for (const v of [drawing && drawing.server_id, drawing && drawing.client_id, drawing && drawing.cid, drawing && drawing.id]) {
      if (v != null && v !== "") out.push(String(v).toLowerCase());
    }
    return out;
  }
  function idOfToken(t) {
    const s = String(t == null ? "" : t);
    const m = dir().DRAW_REGEX.exec(s);
    return m ? m[1] : s;
  }

  function replaceDrawingToken(content, drawing, newToken) {
    const src = String(content == null ? "" : content);
    const mine = new Set(tokensOf(drawing));
    const newId = idOfToken(newToken);
    return src.replace(globalDrawRegex(), (whole, id) => {
      if (!mine.has(String(id).toLowerCase())) return whole;
      // Ganti hanya id di dalam kurung → bentuk ter-escape, huruf ::DRAW, dan atribut {...} tetap utuh.
      const at = whole.indexOf(id, whole.indexOf("["));
      return whole.slice(0, at) + newId + whole.slice(at + id.length);
    });
  }

  function planNoteShare(content, targetListId, drawingsById, myUid) {
    const map = {};
    for (const k of Object.keys(drawingsById || {})) map[k.toLowerCase()] = drawingsById[k];
    const noTarget = targetListId == null; // note pribadi: drawing workspace tetap tautan, tidak ada yang dipindah/disalin
    const plan = { move: [], copy: [], unavailable: [] };
    const seen = new Set();
    const seenTok = new Set();
    const re = globalDrawRegex();
    const src = String(content == null ? "" : content);
    let m;
    while ((m = re.exec(src)) !== null) {
      const tok = m[1];
      const d = map[tok.toLowerCase()] || null;
      if (!d) {
        if (!seenTok.has(tok)) { seenTok.add(tok); plan.unavailable.push(tok); }
        continue;
      }
      const key = d.cid != null ? "c" + d.cid : d.server_id != null ? "s" + d.server_id : "o" + String(d.client_id);
      if (noTarget || seen.has(key)) continue;
      seen.add(key);
      if (sameList(d.list_id, targetListId)) continue;
      if (d.list_id == null && isMine(d, myUid)) plan.move.push(d);
      else plan.copy.push(d);
    }
    return plan;
  }

  // ── Aksi (online saja untuk share; salin lokal jalan offline) ──────────────
  function errBody(err) {
    return (err && (err.body || err.data)) || null;
  }
  // Offline hanya bila error bergaya fetch (tanpa status, pesan jaringan) atau navigator offline;
  // TypeError biasa = bug kode → ERROR, bukan "butuh koneksi".
  function isNetworkError(err) {
    if (!err || err.status != null) return false;
    return /failed to fetch|networkerror|load failed/i.test(String(err.message || "")) || isOffline();
  }
  function warn(msg, err) { try { console.warn("[drawingshare] " + msg, err); } catch (_) {} }
  // Kegagalan pemanggilan jaringan (bukan langkah lokal).
  function failure(err) {
    if (isNetworkError(err)) return { ok: false, code: "OFFLINE", message: OFFLINE_SHARE_MSG };
    return { ok: false, code: "ERROR", message: (err && err.message) || "Terjadi kesalahan." };
  }
  function call(api, method, url, body) {
    const opts = { method, body: JSON.stringify(body), network: true };
    if (api && typeof api.fetch === "function") return api.fetch(url, opts);
    const fn = method === "PATCH" ? api && api.patch : api && api.post;
    if (typeof fn !== "function") return Promise.reject(new Error("api tidak tersedia"));
    return fn.call(api, url, body, { network: true });
  }
  function serverIdOf(drawing) {
    if (drawing && drawing.server_id != null) return drawing.server_id;
    return null;
  }

  function shareDrawing(api, drawing, listId) {
    if (isOffline()) return Promise.resolve({ ok: false, code: "OFFLINE", message: OFFLINE_SHARE_MSG });
    const sid = serverIdOf(drawing);
    if (sid == null) return Promise.resolve({ ok: false, code: "ERROR", message: "Gambar belum tersinkron ke server." });
    return call(api, "PATCH", "/api/drawings/" + sid + "/share", { list_id: nn(listId) }).then((updated) => {
      const patch = { list_id: updated && updated.list_id !== undefined ? updated.list_id : nn(listId) };
      // Server mem-bump updated_at saat share → adopsi sebagai base_rev (pola MindmapTabInstance.handleShare).
      // Record bisa saja dirty: bump itu berasal dari share kita sendiri, bukan edit orang lain.
      if (updated && updated.updated_at) { patch.updated_at = updated.updated_at; patch.base_rev = updated.updated_at; }
      const built = Object.assign({}, drawing, patch);
      // Adopsi lokal dipisah dari panggilan jaringan: server sudah berhasil, jadi gagal lokal tidak membalik hasil.
      return TFrepo.getRaw(sid).then((rec) => {
        if (!rec) return built;
        return TFdb.mutate("drawings", rec.cid, (cur) => (cur ? Object.assign({}, cur, patch, { rev: (cur.rev || 0) + 1 }) : undefined))
          .then((saved) => (saved ? Object.assign(built, { rev: saved.rev }) : built));
      }).catch((err) => { warn("adopsi lokal setelah share gagal", err); return built; })
        .then((d) => ({ ok: true, drawing: d }));
    }, (err) => {
      const body = errBody(err);
      const detail = body && body.detail;
      if (err && err.status === 409 && detail && typeof detail === "object" && detail.code === "DRAWING_IN_USE") {
        return { ok: false, code: "DRAWING_IN_USE", notes: detail.notes || [], hidden_count: detail.hidden_count || 0 };
      }
      return failure(err);
    });
  }

  function localDataOf(drawing) {
    if (drawing && drawing.data_json != null && !drawing.data_missing) return Promise.resolve(drawing.data_json);
    if (drawing && drawing.data_missing) return Promise.resolve(null);
    const key = drawing && (drawing.cid != null ? drawing.cid : drawing.id);
    if (key == null) return Promise.resolve(null);
    return TFrepo.getDrawing(key, { online: false }).then((d) => (d && !d.data_missing && d.data_json != null ? d.data_json : null));
  }

  function copyDrawing(api, drawing, listId, title) {
    const name = title || (drawing && drawing.title) || "Untitled Drawing";
    const localFail = (err) => ({ ok: false, code: "ERROR", message: (err && err.message) || "Terjadi kesalahan." });
    return localDataOf(drawing).then((data) => {
      if (data != null) {
        return TFrepo.createDrawing({ title: name, data_json: data, list_id: nn(listId), svg_preview: (drawing && drawing.svg_preview) || "" })
          .then((d) => ({ ok: true, drawing: d }));
      }
      if (isOffline()) return { ok: false, code: "OFFLINE", message: OFFLINE_DATA_MSG };
      const sid = serverIdOf(drawing);
      if (sid == null) return { ok: false, code: "ERROR", message: OFFLINE_DATA_MSG };
      const body = { list_id: nn(listId) };
      if (title) body.title = title;
      return call(api, "POST", "/api/drawings/" + sid + "/copy", body).then((srv) => {
        // Salinan sudah ada di server: gagal adopsi lokal tidak membalik hasil (pull akan membawanya).
        return Promise.resolve().then(() => TFrepo.adoptServerDrawing(srv))
          .catch((err) => { warn("adopsi lokal setelah salin gagal", err); return Object.assign({}, srv, { server_id: srv.id, cid: srv.client_id || null }); })
          .then((rec) => ({ ok: true, drawing: rec }));
      }, (err) => {
        const f = failure(err);
        if (f.code === "OFFLINE") f.message = OFFLINE_DATA_MSG;
        return f;
      });
    }, localFail).catch(localFail);
  }

  // ── moved_drawings dari respons simpan/share note ──────────────────────────
  function applyMovedDrawings(moved) {
    const list = Array.isArray(moved) ? moved.filter((m) => m && typeof m === "object") : [];
    return list.reduce((p, m) => p.then(() => {
      const find = (m.id != null ? TFrepo.getRaw(m.id) : Promise.resolve(null))
        .then((r) => r || (m.client_id != null ? TFrepo.getRaw(m.client_id) : null));
      return find.then((rec) => {
        if (!rec) return null;
        return TFdb.mutate("drawings", rec.cid, (cur) => {
          if (!cur) return undefined;
          const patch = {};
          if (m.list_id !== undefined) patch.list_id = nn(m.list_id);
          if (m.updated_at) { patch.updated_at = m.updated_at; patch.base_rev = m.updated_at; }
          const changed = Object.keys(patch).some((k) => cur[k] !== patch[k]);
          if (!changed) return undefined;
          return Object.assign({}, cur, patch, { rev: (cur.rev || 0) + 1 });
        });
      });
    }), Promise.resolve()).then(() => undefined);
  }

  return { scopeNotice, noticeText, shareDrawing, copyDrawing, replaceDrawingToken, planNoteShare, applyMovedDrawings };
});
