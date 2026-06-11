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
  const TFrepo = req("./chatrepo.js", root.TF && root.TF.chatrepo);

  const onlineNow = () => (typeof navigator !== "undefined" ? navigator.onLine !== false : true);

  function buildUrl(listId, q) {
    let url = "/api/lists/" + listId + "/messages";
    const qs = [];
    if (q && q.limit != null) qs.push("limit=" + encodeURIComponent(q.limit));
    if (q && q.before_id != null) qs.push("before_id=" + encodeURIComponent(q.before_id));
    if (qs.length) url += "?" + qs.join("&");
    return url;
  }

  function registerChatRoutes(router) {
    router.register("GET", "/api/lists/:id/messages", ({ params, query }) => {
      const listId = params.id;
      const q = query || {};
      const fetcher = TFrepo.getFetcher();
      if (onlineNow() && fetcher) {
        return Promise.resolve(fetcher(buildUrl(listId, q)))
          .then((serverMsgs) => {
            const list = Array.isArray(serverMsgs) ? serverMsgs : [];
            return TFrepo.cacheMessages(list).then(() => list);
          })
          .catch(() => TFrepo.getMessages(listId, q));
      }
      return TFrepo.getMessages(listId, q);
    });
    router.register("POST", "/api/lists/:id/messages", ({ params, body }) =>
      TFrepo.sendMessage(params.id, body || {}, TFrepo.getCurrentUser(), {}));
  }

  const exported = { registerChatRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.chatroutes = exported; }
  return exported;
});
