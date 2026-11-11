;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.checklistroutes = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Rute lokal checklist (checklist offline Fase 2, spec docs/superpowers/specs/2026-11-11-checklist-offline-fase2-
  // design.md §4.3, E6, E7; rencana PR B2 R3). Semua endpoint yang dipakai ChecklistTree, respons meniru webapp.py:
  //   GET    /api/tasks/:id/subtasks      → [butir] pre-order
  //   POST   /api/tasks/:id/subtasks      → butir + task_progress
  //   PATCH  /api/subtasks/:id            → butir + changed_ids + task_progress
  //   POST   /api/subtasks/:id/toggle     → butir + changed_ids + task_progress (antrean: set_done, bukan toggle)
  //   POST   /api/subtasks/:id/move       → {items, task_progress}
  //   DELETE /api/subtasks/:id            → {ok: true, deleted_ids, task_progress}
  // task_progress lokal = {done, total, progress} (tanpa rev/rev_bumped). `:id` = id server atau cid (task maupun
  // butir). Galat ChecklistError → 422 berteks persis _CHECKLIST_ERRORS server; tipe body tidak sah (yang di server
  // ditolak pydantic) → 422 "Data tidak valid"; task / butir tidak dikenal → 404 "Task not found" / "Subtask not found".
  // Error = Error(detail) {status, body: {detail}, code} (pola taskroutes `invalid`; api.fetch menyalinnya).
  //
  // `routeDecision(method, path)` (dipakai taskroutes.shouldRouteLocally, SINKRON): null = bukan endpoint checklist;
  // false = jaringan; true = lokal. Id task/butir bukan angka (cid: belum tersinkron) → SELALU lokal, juga sebelum
  // unduhan awal selesai (server selalu menolak id bukan angka; task yang dibuat offline bisa langsung diberi checklist,
  // F2; GET cid tak dikenal = [] seperti v502). Id angka → lokal hanya bila TF.checklistrepo.isReady() (unduhan awal
  // selesai) DAN task/butir dikenal lokal (rev tersimpan atau butir lokal); selain itu jaringan (perilaku v502).
  // api.fetch (index.html) menunggu checklistrepo.start() sebelum memanggil keputusan ini untuk path checklist.

  const isNode = typeof module !== "undefined" && module.exports;
  // Dibaca saat dipanggil: modul ini dimuat sebelum taskroutes.js (yang me-req-nya), sesudah checklistrepo.js.
  const repoMod = () => (isNode ? require("./checklistrepo.js") : root.TF && root.TF.checklistrepo);

  const ERRORS = {
    PARENT_NOT_FOUND: "Induk checklist tidak ditemukan",
    CYCLE: "Butir tidak bisa dipindah ke dalam dirinya sendiri",
    EMPTY_TITLE: "Teks butir tidak boleh kosong",
    NO_CHANGE: "Tidak ada perubahan",
  };
  const INVALID_TEXT = "Data tidak valid";

  function httpError(status, detail, code) {
    return Object.assign(new Error(detail), { status: status, body: { detail: detail }, code: code });
  }
  const reject = (status, detail, code) => Promise.reject(httpError(status, detail, code));
  const invalid = () => reject(422, INVALID_TEXT, "INVALID");

  // Galat checklistrepo → galat HTTP; galat lain (IndexedDB) diteruskan apa adanya.
  function mapError(err) {
    const code = err && err.code;
    if (code === "TASK_NOT_FOUND") throw httpError(404, "Task not found", code);
    if (code === "NOT_FOUND") throw httpError(404, "Subtask not found", code);
    if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) throw httpError(422, ERRORS[code], code);
    if (code === "INVALID") throw httpError(422, INVALID_TEXT, code);
    throw err;
  }

  // Kontrak body (pydantic server): index int ≥ 0 / null; parent_id angka bulat / null (lokal: juga cid).
  const isIndex = (v) => v == null || (typeof v === "number" && Number.isInteger(v) && v >= 0);
  const isParent = (v) => v == null || typeof v === "string" || (typeof v === "number" && Number.isInteger(v));
  const isDone = (v) => v == null || typeof v === "boolean" || v === 0 || v === 1;
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  // Butir + field tambahan respons (task_progress, changed_ids).
  const withExtra = (item, extra) => Object.assign({}, item, extra);

  function registerChecklistRoutes(router) {
    if (!repoMod()) return false;
    const repo = () => repoMod();

    router.register("GET", "/api/tasks/:id/subtasks", ({ params }) =>
      repo().resolveTask(params.id).then((t) => (t ? repo().itemsForTask(t.cid) : [])));

    router.register("POST", "/api/tasks/:id/subtasks", ({ params, body }) => {
      const b = isObj(body) ? body : {};
      if (b.title != null && typeof b.title !== "string") return invalid();
      if (b.client_id != null && typeof b.client_id !== "string") return invalid();
      if (!isParent(b.parent_id) || !isIndex(b.index)) return invalid();
      if (typeof b.title !== "string" || !b.title.trim()) return reject(422, ERRORS.EMPTY_TITLE, "EMPTY_TITLE");
      return repo().resolveTask(params.id).then((t) => {
        if (!t) throw httpError(404, "Task not found", "TASK_NOT_FOUND");
        return repo().create(t.cid, { title: b.title, parent_id: b.parent_id, index: b.index, client_id: b.client_id });
      }).then((r) => withExtra(r.item, { task_progress: r.task_progress }), mapError);
    });

    router.register("PATCH", "/api/subtasks/:id", ({ params, body }) => {
      const b = isObj(body) ? body : {};
      if ((b.title != null && typeof b.title !== "string") || !isDone(b.is_done)) return invalid();
      const ch = {};
      if (b.title != null) ch.title = b.title;
      if (b.is_done != null) ch.is_done = !!b.is_done;
      return repo().patch(params.id, ch)
        .then((r) => withExtra(r.item, { changed_ids: r.changed_ids, task_progress: r.task_progress }), mapError);
    });

    router.register("POST", "/api/subtasks/:id/toggle", ({ params }) =>
      repo().toggle(params.id)
        .then((r) => withExtra(r.item, { changed_ids: r.changed_ids, task_progress: r.task_progress }), mapError));

    router.register("POST", "/api/subtasks/:id/move", ({ params, body }) => {
      // parent_id wajib ADA di body (boleh null = level atas), seperti SubtaskMove server.
      if (!isObj(body) || !Object.prototype.hasOwnProperty.call(body, "parent_id")) return invalid();
      if (!isParent(body.parent_id) || !isIndex(body.index)) return invalid();
      return repo().move(params.id, body.parent_id, body.index)
        .then((r) => ({ items: r.items, task_progress: r.task_progress }), mapError);
    });

    router.register("DELETE", "/api/subtasks/:id", ({ params }) =>
      repo().remove(params.id)
        .then((r) => ({ ok: true, deleted_ids: r.deleted_ids, task_progress: r.task_progress }), mapError));

    return true;
  }

  // Endpoint checklist dari (method, path): {kind: "task", method, id} | {kind: "item", method, id, action} | null.
  function parseCall(method, path) {
    const m = String(method || "GET").toUpperCase();
    const p = String(path || "");
    const q = p.indexOf("?");
    const base = (q === -1 ? p : p.slice(0, q)).replace(/\/+$/, "");
    const dec = (s) => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    let x = /^\/api\/tasks\/([^/]+)\/subtasks$/.exec(base);
    if (x) return m === "GET" || m === "POST" ? { kind: "task", method: m, id: dec(x[1]) } : null;
    x = /^\/api\/subtasks\/([^/]+)(?:\/(toggle|move))?$/.exec(base);
    if (!x) return null;
    const action = x[2] || "";
    const ok = action ? m === "POST" : (m === "PATCH" || m === "DELETE");
    return ok ? { kind: "item", method: m, id: dec(x[1]), action: action } : null;
  }

  function routeDecision(method, path) {
    const c = parseCall(method, path);
    if (!c) return null;
    const repo = repoMod();
    if (!repo) return null;
    if (!/^\d+$/.test(c.id)) return true; // cid: hanya ada di perangkat ini (server menolak id bukan angka)
    if (!repo.isReady()) return false;
    return c.kind === "task" ? repo.knowsTask(c.id) : repo.knowsItem(c.id);
  }

  return { ERRORS, INVALID_TEXT, registerChecklistRoutes, routeDecision, parseCall };
});
