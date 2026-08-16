# Mindmap Node Text Formatting (Fase 1) — Design Specification

**Date:** 2026-08-16
**Author:** Claude Code & User
**Status:** Approved by User
**Target:** TaskFlow WebApp (`static/offline/mindmapoutline.js`, `static/vendor/mind-elixir/index.html`, `static/index.html`, `static/app.css`)

---

## 1. Executive Summary

Node topics in the mindmap (canvas & outline) become markdown-formatted text. Formatting is stored as syntax inside the plain-string `topic` (data model unchanged), rendered by a shared renderer (`marked` v15, already vendored) on both surfaces, and entered via mini formatting toolbars shown while editing. Alignment is a per-node `align` field (not syntax). This is Fase 1 of a two-phase styling feature (Fase 2 = node background/font color/font size/icon/image, deferred).

## 2. Formats

| Format | Syntax | Renderer |
|---|---|---|
| Bold | `**teks**` | marked |
| Italic | `*teks*` | marked |
| Highlight | `__teks__` | preprocessor → `<strong class="underscore-emphasis">` (engine CSS class, yellow bg) |
| Underline | `<u>teks</u>` | raw-HTML passthrough (marked default) |
| Strikethrough | `~~teks~~` | marked |
| Heading | `# ` / `## ` / `### ` at line start | marked → h1-h3 (engine CSS has h1-h6 rules) |
| Inline code | `` `kode` `` | marked → `<code>` |
| Link | `[teks](url)` | marked → `<a>` (clickable: engine CSS allows pointer-events on links inside topics) |
| Unordered list | `- item` per line | marked → ul/li |
| Ordered list | `1. item` per line | marked → ol/li |
| Divider | `---` on its own line | marked → hr |
| Table | GFM pipe table | marked (gfm: true) + our CSS for table borders inside topics |
| **Align** | node field `align`: `left` \| `center` \| `right` \| `justify` | applied as CSS text-align on the node (canvas me-tpc / outline row) |

## 3. Shared Renderer

- New export `renderTopicMd(topic)` in `static/offline/mindmapoutline.js`:
  1. Replace `__text__` with `<strong class="underscore-emphasis">text</strong>` (raw HTML; marked passes it through).
  2. `marked.parse(topic, { gfm: true, breaks: true })`.
- Marked is loaded as a dependency of the module (UMD pattern `req("../vendor/marked.min.js", root.marked)`), so both the parent page and the iframe share one implementation, unit-testable in node.
- Topics with no markdown markers render as plain text — existing mindmaps are visually unchanged except topics containing literal `*`/`_` (documented minor breaking change).

## 4. Surfaces

### 4.1 Canvas (iframe `static/vendor/mind-elixir/index.html`)

- Load `marked.min.js` and `mindmapoutline.js` via script tags (marked before module).
- Engine constructor gains `markdown: (topic) => TF.mindmapoutline.renderTopicMd(topic)` — engine renders topics as HTML via its existing hook (`this.markdown ? innerHTML : textContent`), including the live display after finishEdit.
- New `#fmt-toolbar` row in the iframe UI (between `#node-toolbar` and `#map`), shown while editing a node (bus `operation` name `beginEdit` → show; `finishEdit`/blur → hide). Buttons: **B I U S ✨ H <> 🔗 ⊞ • 1. ─ L C R J**.
- Buttons mutate the selection inside the engine's `#input-box` (plaintext-only contenteditable — raw syntax is what users edit):
  - wrap/insert helpers from the module applied via `document.execCommand("insertText", …)` (fallback: Range manipulation).
  - Align buttons: set `currentNodeData.align`, re-apply alignment via `applyNodeStyles()`, and post `change` (getData includes the align field).
- `applyNodeStyles()` (in the same post-layout pass as badges): for each node element, set `textAlign` from `nodeObj.align`.

### 4.2 Outline (`MindmapOutline` in `static/index.html`)

- Row topic renders `renderTopicMd(topic)` HTML instead of plain text. When search is active (`matchSet`), fall back to the existing plain-text + `<mark>` highlight (formatted HTML is not highlighted in V1).
- Row text alignment from `node.align` (textAlign on the topic span).
- While inline-editing (textarea), a compact toolbar row appears above the textarea with the same buttons; insertion via `textarea.setRangeText` (or value splice + selection restore) using the shared helpers. Align buttons go through the module's `setNodeAlign(root, id, align)` → existing `onChange` pipeline (undo entry included via `edit()`).

## 5. Text-Insert Helpers (module, pure & unit-tested)

| Helper | Signature | Behavior |
|---|---|---|
| `wrapSelection` | `(text, start, end, before, after, placeholder)` → `{text, selStart, selEnd}` | wrap selection, or insert placeholder with caret inside when start===end |
| `prefixLines` | `(text, start, end, prefix, numbered)` → same | prefix each line in range; numbered → `1. `, `2. `… |
| `insertBlock` | `(text, start, end, block)` → same | insert block at caret line boundary (used for `---` divider, table template) |
| `renderTopicMd` | `(topic)` → html string | see §3 |
| `setNodeAlign` | `(root, id, align)` → new root | sets `align` on the node; no-op when missing/root-invalid |

## 6. Data & Compatibility

- `align` is a per-node field; engine serializer and outline helpers preserve unknown fields (verified). Persists through the existing save pipeline. No backend/schema changes.
- Canvas edit box is `plaintext-only` — users type raw markdown; typed HTML tags stay literal in the edit box but are stored as topic text (safe).

## 7. Testing

- **Unit (node --test, `tests/offline/mindmapoutline.test.js` extended):** renderTopicMd for every format (bold/italic/highlight/underline/strike/heading/code/link/lists/divider/table/plain-text passthrough); highlight preprocessor does not clobber `*`-based syntax; wrapSelection (no-selection placeholder + wrap + cursor positions); prefixLines (single + multi-line + numbered); insertBlock; setNodeAlign (set + preserve other fields + root guard). Export-surface test updated to include the 5 new exports.
- **Browser checklist (post-deploy):** all formats render in canvas and outline; toolbars appear during edit on both surfaces; B/I/U/list/table inserts work with and without selection; align persists after reload; existing mindmaps unchanged; search still highlights in outline; links clickable in canvas; no console errors; iframe version + SW bumped.

## 8. Files Touched

| File | Change |
|---|---|
| `static/offline/mindmapoutline.js` | +5 exports (renderer + helpers), marked dependency |
| `tests/offline/mindmapoutline.test.js` | extended tests |
| `static/vendor/mind-elixir/index.html` | script tags, engine `markdown` option, `#fmt-toolbar` row + wiring, `applyNodeStyles`, align handling |
| `static/index.html` | outline toolbar, row HTML rendering + search fallback, align per row, iframe src `?v` bump |
| `static/app.css` | CSS for topic list/table/hr/code/headings/links + toolbar styles |
| `static/sw.js` | cache name bump |
