;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.focuspage = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const ZEN_KEY = "tf_focus_zen";
  const PARK_MAX = 200;

  // Payload task inbox untuk "Parkir Distraksi"; null bila teks kosong.
  function parkPayload(text) {
    const title = String(text == null ? "" : text).trim().slice(0, PARK_MAX);
    if (!title) return null;
    return { title, gtd_status: "inbox", priority: "P2", deadline: null };
  }

  // Mode Zen hanya aktif saat diaktifkan, sesi kerja, dan timer berjalan.
  function zenActive(s) {
    return !!(s && s.enabled && s.mode === "work" && s.isRunning);
  }

  function readZenPref(storage) {
    try { return storage.getItem(ZEN_KEY) === "1"; } catch (_) { return false; }
  }

  function writeZenPref(storage, on) {
    try { storage.setItem(ZEN_KEY, on ? "1" : "0"); } catch (_) { /* abaikan */ }
  }

  return { parkPayload, zenActive, readZenPref, writeZenPref, ZEN_KEY, PARK_MAX };
});
