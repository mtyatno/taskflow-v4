;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.dbupgrade = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Banner status pembaruan IndexedDB (K2 / R12, spec plugin Fase 1 §4). DOM polos tanpa React agar
  // tetap tampil walau app gagal render; status dari TF.db.subscribe / TF.db.upgradeState.
  const TEXT_BLOCKED = "Tutup tab Alurik lain untuk menyelesaikan pembaruan";
  const TEXT_ELSEWHERE = "Alurik diperbarui di tab lain. Muat ulang tab ini.";
  const RELOAD_LABEL = "Muat ulang";
  const BANNER_ID = "tf-db-banner";
  const STYLE = "position:fixed;top:0;left:0;right:0;z-index:10050;display:flex;align-items:center;" +
    "justify-content:center;flex-wrap:wrap;gap:8px 12px;padding:10px 16px;font-size:14px;line-height:1.4;" +
    "background:var(--bg-card);color:var(--text-primary);border-bottom:1px solid var(--border);" +
    "box-shadow:0 2px 10px rgba(0,0,0,.12)";
  const BTN_STYLE = "padding:6px 14px;border-radius:8px;border:1px solid transparent;cursor:pointer;" +
    "font:inherit;font-weight:600;background:var(--accent);color:var(--accent-ink)";

  // Elsewhere menang: koneksi tab ini sudah ditutup, satu-satunya jalan keluar adalah muat ulang.
  function bannerFor(state) {
    const s = state || {};
    if (s.upgradedElsewhere) return { kind: "elsewhere", text: TEXT_ELSEWHERE, role: "alert", reload: true };
    if (s.blocked) return { kind: "blocked", text: TEXT_BLOCKED, role: "status", reload: false };
    return null;
  }

  // Satu elemen #tf-db-banner: dibuat, diganti utuh, atau dihapus (spec null).
  function render(doc, spec, onReload) {
    if (!doc) return null;
    const old = doc.getElementById(BANNER_ID);
    if (old) old.remove();
    if (!spec || !doc.body) return null;
    const el = doc.createElement("div");
    el.setAttribute("id", BANNER_ID);
    el.setAttribute("role", spec.role);
    el.setAttribute("style", STYLE);
    const msg = doc.createElement("span");
    msg.textContent = spec.text;
    el.appendChild(msg);
    if (spec.reload) {
      const btn = doc.createElement("button");
      btn.setAttribute("type", "button");
      btn.setAttribute("style", BTN_STYLE);
      btn.textContent = RELOAD_LABEL;
      btn.addEventListener("click", () => { if (typeof onReload === "function") onReload(); });
      el.appendChild(btn);
    }
    doc.body.appendChild(el);
    return el;
  }

  function install(win) {
    const w = win;
    const TFdb = w && w.TF && w.TF.db;
    if (!TFdb || typeof TFdb.subscribe !== "function" || typeof TFdb.upgradeState !== "function") return false;
    const doc = w.document;
    if (!doc) return false;
    const reload = () => { try { w.location.reload(); } catch (_) {} };
    const draw = () => { try { render(doc, bannerFor(TFdb.upgradeState()), reload); } catch (_) {} };
    TFdb.subscribe(draw);
    if (doc.body) draw();
    else if (typeof doc.addEventListener === "function") doc.addEventListener("DOMContentLoaded", draw, { once: true });
    return true;
  }

  const api = { TEXT_BLOCKED, TEXT_ELSEWHERE, RELOAD_LABEL, BANNER_ID, bannerFor, render, install };
  if (typeof module === "undefined" && root && root.document) install(root);
  return api;
});
