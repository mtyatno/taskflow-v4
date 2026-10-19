;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.TF = root.TF || {};
    root.TF.mindmaplinks = factory();
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Kartu link hidup: info diambil dari data lokal (api.get induk, lokal-first); snapshot di link
  // hanya cadangan saat data tidak tersedia. Tanpa dependensi (dimuat juga oleh iframe).
  const UNAVAILABLE_TITLE = "Data terbaru tidak tersedia di perangkat ini";
  const STATUS_LABEL = {
    inbox: "Inbox", next: "Next", waiting: "Waiting", someday: "Someday",
    project: "Project", done: "Selesai", archived: "Diarsipkan",
  };
  const ROUTE = { task: "/api/tasks/", note: "/api/scratchpad/", mindmap: "/api/mindmaps/" };

  const linkKey = (link) => String(link.type) + ":" + String(link.id);

  function collectLinkRefs(nodeData) {
    const seen = new Set();
    const out = [];
    (function walk(n) {
      if (!n) return;
      (Array.isArray(n.links) ? n.links : []).forEach((l) => {
        if (!l || l.id == null || !ROUTE[l.type]) return;
        const k = linkKey(l);
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ type: l.type, id: l.id });
      });
      (Array.isArray(n.children) ? n.children : []).forEach(walk);
    })(nodeData);
    return out;
  }

  function snippet(text, length) {
    if (!text) return "";
    const t = String(text).trim();
    return t.slice(0, length) + (t.length > length ? "…" : "");
  }
  const nn = (v) => (v === undefined || v === "" ? null : v);

  function toInfo(type, r) {
    if (!r || typeof r !== "object") return null;
    if (type === "task") {
      const status = nn(r.gtd_status);
      return {
        type, title: nn(r.title), priority: nn(r.priority), deadline: nn(r.deadline),
        status, done: status === "done" || status === "archived",
      };
    }
    if (type === "note") return { type, title: nn(r.title), preview: snippet(r.content, 80) };
    return { type, title: nn(r.title) };
  }

  function resolveLinkInfo(refs, get) {
    const info = {};
    return Promise.all((refs || []).map((ref) =>
      Promise.resolve()
        .then(() => get(ROUTE[ref.type] + encodeURIComponent(ref.id)))
        .then((r) => toInfo(ref.type, r), () => null)
        .then((v) => { info[linkKey(ref)] = v; })
    )).then(() => info);
  }

  function linkDisplay(link, info) {
    const live = !!info;
    const src = live ? info : link;
    const title = (src && src.title) || (live && link.title) || link.title || "(tanpa judul)";
    let meta = "";
    let done = false;
    if (link.type === "task") {
      const status = live ? info.status : link.status;
      done = live ? !!info.done : (status === "done" || status === "archived");
      const parts = [];
      if (src.priority) parts.push(src.priority);
      if (src.deadline) parts.push("Due " + String(src.deadline).slice(0, 10));
      if (status) parts.push(STATUS_LABEL[status] || status);
      meta = parts.join(" · ") || "—";
    } else if (link.type === "note") {
      meta = (live ? info.preview : link.preview) || "";
    }
    return { title, meta, live, done };
  }

  return { linkKey, collectLinkRefs, resolveLinkInfo, linkDisplay, STATUS_LABEL, UNAVAILABLE_TITLE };
});
