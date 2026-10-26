;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.themes = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Logika murni tema Alurik: preferensi (mode terang/gelap/sistem, palet, dekorasi), penyelesaian ke
  // atribut <html>, dan registri palet. Tanpa akses DOM saat dimuat: storage dan document dilewatkan
  // pemanggil supaya bisa dites di Node (skrip boot di <head> index.html memakai aturan yang sama).
  const KEYS = Object.freeze({ mode: "tf_theme", palette: "tf_palette", decor: "tf_decor" });
  const MODES = Object.freeze(["light", "dark", "system"]);
  const DEFAULT_PREFS = Object.freeze({ mode: "light", palette: "default", decor: "on" });

  // PR A hanya berisi palet Default; Sakura/Lavender menyusul. swatch = contoh warna di pemilih tema.
  const PALETTES = Object.freeze([
    {
      id: "default",
      name: "Default",
      swatch: {
        light: { accent: "#A8C500", soft: "#F4FAD6", bg: "#FCFCFB" },
        dark: { accent: "#A8C500", soft: "rgba(168,197,0,0.18)", bg: "#171717" },
      },
      themeColor: { light: "#0f172a", dark: "#0f172a" },
      decor: {},
    },
  ]);

  function paletteById(id) {
    return PALETTES.find((p) => p.id === id) || null;
  }

  // Slot dekorasi (mis. "page-corner") milik palet; null bila palet/slot tidak ada.
  function decorFor(paletteId, slot) {
    const p = paletteById(paletteId);
    return p && typeof p.decor[slot] === "string" ? p.decor[slot] : null;
  }

  function isDecorAvailable(paletteId) {
    const p = paletteById(paletteId);
    return !!p && Object.keys(p.decor).length > 0;
  }

  function getItem(storage, key) {
    try {
      return storage ? storage.getItem(key) : null;
    } catch (_) {
      return null;
    }
  }

  // Nilai tak dikenal/hilang/storage rusak -> bawaan. Nilai lama tf_theme=light|dark tetap sah.
  function readPrefs(storage) {
    const mode = getItem(storage, KEYS.mode);
    const palette = getItem(storage, KEYS.palette);
    const decor = getItem(storage, KEYS.decor);
    return {
      mode: MODES.includes(mode) ? mode : DEFAULT_PREFS.mode,
      palette: paletteById(palette) ? palette : DEFAULT_PREFS.palette,
      decor: decor === "off" ? "off" : DEFAULT_PREFS.decor,
    };
  }

  function validValue(field, v) {
    if (field === "mode") return MODES.includes(v);
    if (field === "palette") return !!paletteById(v);
    return v === "on" || v === "off";
  }

  // Hanya kunci yang ada di prefs dan sah yang ditulis (prefs parsial boleh); galat storage ditelan.
  function writePrefs(storage, prefs) {
    if (!storage || !prefs) return;
    for (const field of Object.keys(KEYS)) {
      if (!validValue(field, prefs[field])) continue;
      try {
        storage.setItem(KEYS[field], prefs[field]);
      } catch (_) {
        /* storage penuh/diblokir: preferensi tetap berlaku untuk sesi ini */
      }
    }
  }

  // Preferensi -> nilai atribut <html> dan warna meta theme-color. systemDark = prefers-color-scheme: dark.
  function resolve(prefs, systemDark) {
    const p = prefs || {};
    const theme = p.mode === "dark" || (p.mode === "system" && systemDark) ? "dark" : "light";
    const palette = paletteById(p.palette) ? p.palette : DEFAULT_PREFS.palette;
    return {
      theme,
      palette,
      decor: p.decor === "off" ? "off" : "on",
      themeColor: paletteById(palette).themeColor[theme],
    };
  }

  // Pasang ke dokumen; hanya menyentuh yang berbeda. Mengembalikan nama yang benar-benar diubah.
  function apply(resolved, doc) {
    const changed = [];
    const el = doc.documentElement;
    const attrs = { "data-theme": resolved.theme, "data-palette": resolved.palette, "data-decor": resolved.decor };
    for (const name of Object.keys(attrs)) {
      if (el.getAttribute(name) !== attrs[name]) {
        el.setAttribute(name, attrs[name]);
        changed.push(name);
      }
    }
    let meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta && typeof doc.createElement === "function" && doc.head) {
      meta = doc.createElement("meta");
      meta.setAttribute("name", "theme-color");
      doc.head.appendChild(meta);
    }
    if (meta && meta.getAttribute("content") !== resolved.themeColor) {
      meta.setAttribute("content", resolved.themeColor);
      changed.push("theme-color");
    }
    return { changed };
  }

  return { PALETTES, KEYS, MODES, DEFAULT_PREFS, paletteById, decorFor, isDecorAvailable, readPrefs, writePrefs, resolve, apply };
});
