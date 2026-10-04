# Design Specification: Note Toggle List, Callout Blocks, and Code Highlighting

**Date:** 2026-10-03  
**Status:** Approved  
**Author:** Antigravity / Gemini  
**Target:** Alurik (TaskFlow) Notes / Scratchpad (`static/index.html`, `static/app.css`, `static/sw.js`, `static/vendor/`)

---

## 1. Problem Statement & Motivation
In the product roadmap comparing Alurik Notes with Notion and Evernote (Roadmap Item #5), users identified a gap in rich editing blocks:
1. **Code Blocks:** Currently rendered as plain monochrome text in the note viewer, lacking language syntax highlighting, language badges, copy-to-clipboard buttons, and a `/code` slash menu shortcut in the Milkdown editor.
2. **Callout Blocks:** Important insights, tips, and warnings cannot be visually emphasized with colored callout boxes; writing GitHub-style alert quotes (`> [!NOTE]`) renders them as plain standard blockquotes.
3. **Toggle Lists (Collapsible Blocks):** Long notes, meeting minutes, Q&As, or checklists cannot be collapsed or expanded accordion-style to keep reading spaces compact and focused.

This specification introduces these three lightweight, offline-first, client-rendered blocks without requiring any database schema migrations or backend API changes.

---

## 2. Architecture & Technical Strategy

### 2.1 Code Block with Syntax Highlighting & Copy Button
- **Vendor Integration:**
  - Self-contained Prism.js distribution placed in `static/vendor/prism.min.js` and `static/vendor/prism.min.css`.
  - Languages supported out-of-the-box: JavaScript, TypeScript, Python, HTML/XML, CSS, SQL, JSON, Bash/Shell, Markdown, PHP.
  - Precached in Service Worker `STATIC` array in `static/sw.js`.
- **Markdown Rendering (`renderMarkdown` in `static/index.html`):**
  - Custom marked renderer for `code` blocks:
    ```javascript
    renderer.code = function(code, infostring, escaped) {
      const lang = (infostring || '').match(/\S*/)[0] || '';
      const highlighted = (window.Prism && lang && Prism.languages[lang])
        ? Prism.highlight(code, Prism.languages[lang], lang)
        : escapeHtml(code);
      const langDisplay = lang ? lang.toUpperCase() : 'CODE';
      const codeId = 'code-' + Math.random().toString(36).slice(2, 9);
      return `<div class="note-code-card">
        <div class="note-code-header">
          <span class="note-code-lang">${langDisplay}</span>
          <button type="button" class="note-code-copy-btn" onclick="copyCodeBlock('${codeId}', this)">📋 Salin</button>
        </div>
        <pre><code id="${codeId}" class="language-${lang}">${highlighted}</code></pre>
      </div>`;
    };
    ```
  - Global helper `copyCodeBlock(codeId, btn)` to copy text to clipboard and temporarily toggle button label to `✓ Tersalin`.
- **Editor Slash Menu:**
  - Add `/code` (`Code Block`) to `slashMenu` in `static/index.html`.
  - When selected, creates a `code_block` node using ProseMirror schema (`state.schema.nodes.code_block`).

### 2.2 Callout Blocks (GitHub & Obsidian Alerts)
- **Standard Syntax:**
  GitHub Flavored Markdown Alerts format:
  ```markdown
  > [!NOTE]
  > Catatan informasi penting.

  > [!TIP]
  > Tips produktivitas harian.

  > [!WARNING]
  > Peringatan hal yang harus diperhatikan.

  > [!IMPORTANT]
  > Instruksi penting yang wajib dijalankan.

  > [!CAUTION]
  > Peringatan risiko tinggi atau bahaya.
  ```
- **Parsing Strategy (`renderMarkdown`):**
  - In `renderMarkdown`, post-process blockquotes matching `<blockquote>\s*<p>\[!(NOTE|INFO|TIP|WARNING|IMPORTANT|CAUTION)\]` or pre-process markdown blockquote alerts before `marked.parse`:
    ```html
    <div class="note-callout note-callout-{type}">
      <div class="note-callout-title">
        <span class="note-callout-icon">{icon}</span>
        <span>{title}</span>
      </div>
      <div class="note-callout-content">...</div>
    </div>
    ```
  - Icons and Themes:
    - `NOTE` / `INFO`: ℹ️ Blue accent (`rgba(59, 130, 246, 0.12)`, border `#3b82f6`).
    - `TIP`: 💡 Green accent (`rgba(34, 197, 94, 0.12)`, border `#22c55e`).
    - `WARNING`: ⚠️ Amber/Orange accent (`rgba(245, 158, 11, 0.12)`, border `#f59e0b`).
    - `IMPORTANT`: 📌 Purple accent (`rgba(168, 85, 247, 0.12)`, border `#a855f7`).
    - `CAUTION`: 🚨 Red accent (`rgba(239, 68, 68, 0.12)`, border `#ef4444`).
- **Editor Slash Menu:**
  - Add `/callout` (or `/note`, `/tip`, `/warning`) to `slashMenu` in `static/index.html`.
  - Inserts standard blockquote template: `> [!NOTE]\n> `.

### 2.3 Toggle Lists (Collapsible Accordions)
- **Standard Syntax:**
  HTML5 details & summary standard (standard in CommonMark/GFM):
  ```html
  <details>
    <summary>Judul Toggle</summary>
    Isi teks atau daftar yang disembunyikan.
  </details>
  ```
- **Styling in `static/app.css`:**
  - `.note-rendered details`:
    - Border: `1px solid var(--border)`.
    - Border Radius: `8px`.
    - Padding: `8px 12px`.
    - Background: `rgba(0, 0, 0, 0.02)` (light) / `rgba(255, 255, 255, 0.03)` (dark).
    - Margin: `10px 0`.
  - `.note-rendered summary`:
    - Cursor pointer, font-weight 600, user-select none, smooth disclosure arrow.
- **Editor Slash Menu:**
  - Add `/toggle` to `slashMenu` in `static/index.html`.
  - When clicked, inserts a toggle block `<details><summary>Judul Toggle</summary>\n\nIsi teks toggle...\n</details>`.

---

## 3. Data Integrity & Portability
- **Zero Database Changes:** All data is saved in `scratchpad_notes.content` as standard Markdown and HTML.
- **Full Portability:** Notes exported to `.md` or `.docx` maintain clean readability across external Markdown viewers (Obsidian, GitHub, VS Code).
- **Service Worker & Offline:**
  - Service Worker cache bumped to `taskflow-v352-toggle-callout-code-highlight`.
  - Precache `static/vendor/prism.min.js` and `static/vendor/prism.min.css`.

---

## 4. Verification Plan
1. **Unit & Offline Testing:**
   - Create `tests/offline/note_rich_blocks.test.js`:
     - Test code block syntax highlighting and copy button generation.
     - Test callout alerts parsing for `NOTE`, `TIP`, `WARNING`, `IMPORTANT`, `CAUTION`.
     - Test `<details><summary>` toggle list rendering and styling.
     - Test slash menu registration for `/code`, `/callout`, and `/toggle`.
     - Test SW cache version `v352` and precached vendor assets.
2. **Syntax and Code Quality:**
   - Run `node scratch/check_inline.js static/index.html` (5/5 scripts OK).
   - Run `node --check static/sw.js` (OK).
   - Run `node --test tests/offline/*.test.js` (all suites passing).
   - Run `python -m pytest tests/` (full backend test suite passing).
