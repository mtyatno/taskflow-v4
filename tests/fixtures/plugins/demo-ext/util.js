// Part demo-ext (rencana Fase 1 PR 1a-1 Task 8): fungsi murni, digabung mentah ke plugin.js oleh compile.js
// sebelum kode plugin.jsx; di Node bisa di-require untuk diuji terpisah.
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.__demoExt = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  function label(t) {
    var title = t && typeof t.title === "string" ? t.title.trim() : "";
    return title || "(tanpa judul)";
  }
  return { label: label };
});
