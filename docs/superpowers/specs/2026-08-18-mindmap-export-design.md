# Mindmap Export (PNG/SVG) — Design Specification

**Date:** 2026-08-18
**Author:** Claude Code & User
**Status:** Approved by User (design in chat — opsi 1, PNG + SVG)
**Target:** `static/vendor/mind-elixir/index.html`, `static/offline/mindmapops.js` (+tests), `static/index.html` (load message title + iframe bump), `static/sw.js` (cache bump)

---

## 1. Executive Summary

The vendored mind-elixir 5.15.1 engine already ships built-in export: `mind.exportSvg(excludeLinkText = false, opts)` → SVG `Blob`, and `mind.exportPng(excludeLinkText = false, opts)` → async PNG `Blob` (SVG rasterized via canvas). No UI exposes them. This change adds a small export row at the TOP of the iframe's right sidebar (above the Font/Ops/Links tabs — user-approved option 1) with two compact buttons: **PNG** and **SVG**. Click downloads the map as `<mindmap-title>.png|.svg`.

## 2. UI

- New `#export-row` inside `#side-panel`, above `#side-tabs` (flex row, two equal buttons, compact padding):
  - `🖼 PNG` (`#export-png`) — title "Ekspor PNG (gambar)"
  - `📄 SVG` (`#export-svg`) — title "Ekspor SVG (vektor)"
- Styled with the panel's existing CSS vars (`--side-card` bg, `--side-border`, `--side-accent` hover, `--side-text`) so it follows the app theme (light/dark) automatically.
- Row is inside the collapsible panel: hidden when the sidebar is collapsed (user opens it via ▸) — acceptable.
- Buttons no-op until a mindmap is loaded (`mind == null`); also guard mid-export double-clicks.

## 3. Behavior

1. Click PNG → `await mind.exportPng()` → Blob → trigger download `safeExportName(title, "png")`.
2. Click SVG → `mind.exportSvg()` → Blob → trigger download `safeExportName(title, "svg")`.
3. Download trigger: `URL.createObjectURL(blob)` + temporary `<a download href>` + `a.click()` + `URL.revokeObjectURL` (works in the non-sandboxed iframe; standard browser download on desktop & Android Chrome).
4. **Title source:** the parent adds `title: selected.title` to the existing `load` message; the iframe stores it (`currentMindmapTitle`, fallback `"mindmap"`). No title → fallback. (No other parent changes.)
5. `safeExportName(title, ext)` — NEW pure helper in `static/offline/mindmapops.js`: strip path-hostile characters (`[\\/:*?"<>|]` and control chars → `-`), trim, collapse whitespace, fallback `"mindmap"` when empty, return `name + "." + ext`.
6. `excludeLinkText` = engine default (false) — arrow labels kept.

## 4. Engine semantics (verified in MindElixir.iife.js)

- `exportSvg` builds an SVG document sized from the current rendered DOM (`e.nodes` offset sizes) and serializes nodes/arrows. It exports **what is currently rendered**: during Focus Mode that is the focused subtree (engine behavior — mirror, not a bug).
- `exportPng` = `exportSvg` → Image → canvas rasterization → PNG blob. No external deps.
- Theme follows the engine's current theme (already synced to the app theme).

## 5. Edge Cases & Known Limitations

- **Empty map (root only):** export works (single root node).
- **Mid-export click:** guard boolean, re-enabled after completion (PNG is async).
- **Filename fallback:** title empty/missing → `mindmap.png`/`mindmap.svg`.
- **Tauri native (desktop .exe / Android APK):** WebView blob-URL downloads may not trigger the system download manager — KNOWN LIMITATION, web-first; device-test reveals whether Tauri needs a plugin (deferred; not in scope).
- **iOS Safari:** `a.download` may open a share/preview instead of saving — browser platform behavior, acceptable.

## 6. Versioning & Deployment

- `static/offline/mindmapops.js` is MODIFIED → its reference in the iframe bumps `?v=1` → `?v=2`.
- Iframe HTML modified → parent reference bumps `?v=133` → `?v=134`.
- `static/sw.js` cache name bumps `taskflow-v235-mindmap-ops-context-actions` → `taskflow-v236-mindmap-export`.

## 7. Testing

- **Automated (TDD):** `safeExportName` unit tests in `tests/offline/mindmap_ops.test.js` (path-hostile chars, whitespace collapse, empty → fallback, ext appended). Full suite stays green (405 + new = ~409).
- **Syntax:** inline-script checker on iframe + parent.
- **Manual device checklist (user):**
  1. Desktop & phone → buka mindmap → sidebar → tombol 🖼 PNG dan 📄 SVG di atas tabs.
  2. PNG: file `<judul>.png` ter-download, gambar = peta utuh sesuai arah/direction yang aktif.
  3. SVG: file `<judul>.svg` ter-download, terbuka di browser/viewer.
  4. Dark mode: hasil export mengikuti tema aktif.
  5. Judul mindmap dengan karakter aneh (mis. `Rencana Q3: /v1`) → nama file aman.
  6. Focus mode aktif → export menampilkan subtree (perilaku engine, wajar).
  7. Tombol export tak merusak panel/ops yang ada.

## 8. Non-Goals

- Tauri native download plugin (deferred — lihat §5).
- PDF/Markdown/OPML export.
- Export dari outline mode (hanya canvas).
- `excludeLinkText` toggle UI.
