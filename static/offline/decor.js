;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.decor = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Registri dekorasi tema (Sakura/Lavender): kelopak pojok halaman dan maskot bunga untuk keadaan kosong.
  // Hanya string SVG statis (tanpa DOM saat dimuat). Warna wajib memakai token tema Alurik, bukan hex:
  // var(--accent), var(--accent-duo), var(--accent-soft), var(--bg-card), var(--text-primary) atau currentColor,
  // supaya mengikuti palet dan mode terang/gelap. Slot → id dipetakan oleh TF.themes (PALETTES[].decor);
  // glyph "petal" (penghitung sesi Pomodoro) bukan entri di sini, melainkan VIEW_GLYPHS di index.html.

  // Lima kelopak bunga di sekeliling (48,48) — dipakai bersama oleh kedua maskot.
  const FLOWER =
    '<g fill="var(--bg-card)" stroke="var(--accent)" stroke-width="2.2">' +
    '<ellipse cx="48" cy="24" rx="15" ry="19"></ellipse>' +
    '<ellipse cx="48" cy="24" rx="15" ry="19" transform="rotate(72 48 48)"></ellipse>' +
    '<ellipse cx="48" cy="24" rx="15" ry="19" transform="rotate(144 48 48)"></ellipse>' +
    '<ellipse cx="48" cy="24" rx="15" ry="19" transform="rotate(216 48 48)"></ellipse>' +
    '<ellipse cx="48" cy="24" rx="15" ry="19" transform="rotate(288 48 48)"></ellipse>' +
    "</g>" +
    '<circle cx="48" cy="48" r="17" fill="var(--accent-duo)"></circle>' +
    '<circle cx="42" cy="46" r="2.4" fill="var(--text-primary)"></circle>' +
    '<circle cx="54" cy="46" r="2.4" fill="var(--text-primary)"></circle>';
  const CHEEKS =
    '<circle cx="37.5" cy="52" r="2.6" fill="var(--accent)" opacity="0.45"></circle>' +
    '<circle cx="58.5" cy="52" r="2.6" fill="var(--accent)" opacity="0.45"></circle>';

  const PETALS_SVG =
    '<svg viewBox="0 0 130 90" aria-hidden="true">' +
    '<g fill="var(--accent-duo)">' +
    '<path d="M20 30c6-10 18-8 20 0-6 8-16 9-20 0z" transform="rotate(-20 30 30)"></path>' +
    '<path d="M78 14c5-8 14-6 16 0-5 6-13 7-16 0z" transform="rotate(25 86 14)"></path>' +
    '<path d="M104 58c6-9 16-7 18 0-6 7-15 8-18 0z" transform="rotate(-35 113 58)"></path>' +
    '<path d="M56 70c4-6 11-5 12 0-4 5-10 5-12 0z"></path>' +
    "</g></svg>";

  const MASCOT_HAPPY_SVG =
    '<svg viewBox="0 0 96 96" aria-hidden="true">' +
    FLOWER +
    '<path d="M43.5 52.5q4.5 4 9 0" fill="none" stroke="var(--text-primary)" stroke-width="2.2" stroke-linecap="round"></path>' +
    CHEEKS +
    "</svg>";

  // Wajah sama, mulut "o" kecil, kaca pembesar di kanan bawah (kosong karena filter/pencarian).
  const MASCOT_SEARCH_SVG =
    '<svg viewBox="0 0 96 96" aria-hidden="true">' +
    FLOWER +
    '<circle cx="48" cy="53" r="2.2" fill="none" stroke="var(--text-primary)" stroke-width="2"></circle>' +
    CHEEKS +
    '<circle cx="70" cy="70" r="11" fill="var(--bg-card)" fill-opacity="0.85" stroke="var(--accent)" stroke-width="3.2"></circle>' +
    '<path d="M78 78l10 10" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"></path>' +
    "</svg>";

  // animated: true = boleh diberi animasi lembut oleh CSS (themes.css); pemakai wajib menghormati
  // prefers-reduced-motion.
  const DECOR = Object.freeze({
    petals: Object.freeze({ svg: PETALS_SVG, animated: true }),
    "mascot-happy": Object.freeze({ svg: MASCOT_HAPPY_SVG }),
    "mascot-search": Object.freeze({ svg: MASCOT_SEARCH_SVG }),
  });

  // String SVG untuk id dekorasi; null bila id tidak dikenal (termasuk "petal" dan nama bawaan Object).
  function svgFor(id) {
    return typeof id === "string" && Object.prototype.hasOwnProperty.call(DECOR, id) ? DECOR[id].svg : null;
  }

  return Object.freeze({ DECOR, svgFor });
});
