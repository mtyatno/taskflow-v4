# Note Toggle List, Callout Blocks, and Code Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide Notion/Evernote-grade editing and reading blocks in Alurik Notes: code blocks with language syntax highlighting and copy-to-clipboard buttons, callout alert cards (`> [!NOTE]`, `> [!TIP]`, etc.), and collapsible toggle blocks (`<details><summary>`), backed by slash menu shortcuts in the Milkdown editor and offline Service Worker precaching.

**Architecture:** Integrate a lightweight Prism.js distribution in `static/vendor/` with CSS styling in `static/app.css`. Extend `renderMarkdown` and `marked.use` in `static/index.html` to render highlighted code cards with copy buttons, parse GitHub/Obsidian-style callout alerts into stylized colored boxes, and style collapsible HTML details. Wire `/code`, `/callout`, and `/toggle` into the Milkdown editor's slash menu. Precache all assets and bump Service Worker cache version to `taskflow-v352-toggle-callout-code-highlight`.

**Tech Stack:** JavaScript (ES6+), Prism.js, Marked.js, CSS3, Milkdown / ProseMirror, Service Worker (Cache API), Node.js Test Runner.

## Global Constraints
- Offline-first: All assets (`prism.min.js`, `prism.min.css`) must be vendored locally in `static/vendor/` and precached in `static/sw.js`.
- Zero database migrations: Preserves database schema completely; all rich blocks use standard Markdown or HTML5 formats stored in `scratchpad_notes.content`.
- Portability: Notes exported to `.md` or `.docx` must remain standard and readable.
- Superpowers discipline: No cowboy coding, all implementation and code review executed via subagents, full verification before claiming done.
- Service Worker version: Bump to `taskflow-v352-toggle-callout-code-highlight`.

---

### Task 1: Vendor Assets, Styling, and Markdown Parser for Code Highlighting, Callouts, and Toggles

**Files:**
- Create: `static/vendor/prism.min.js`
- Create: `static/vendor/prism.min.css`
- Modify: `static/app.css`
- Modify: `static/index.html:20-40, 15150-15500`
- Create: `tests/offline/note_rich_blocks.test.js`

**Interfaces:**
- Consumes: `marked` parser in `static/index.html`.
- Produces:
  - `window.Prism` loaded and available.
  - `window.copyCodeBlock(codeId, btn)` globally available for copy button clicks.
  - `.note-code-card` HTML with language badge and copy button.
  - `.note-callout` HTML for `[!NOTE]`, `[!TIP]`, `[!WARNING]`, `[!IMPORTANT]`, `[!CAUTION]`.
  - `.note-rendered details` and `summary` styles in `static/app.css`.

- [ ] **Step 1: Write the failing test**
Create `tests/offline/note_rich_blocks.test.js`:
Verify:
1. `prism.min.js` and `prism.min.css` exist in `static/vendor/` and are included in `static/index.html`.
2. `renderMarkdown` transforms code blocks with language into `.note-code-card` containing language label and copy button.
3. `renderMarkdown` transforms `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!IMPORTANT]`, `> [!CAUTION]` into `.note-callout` with proper icons and classes.
4. `static/app.css` defines `.note-code-card`, `.note-callout`, and `.note-rendered details`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/offline/note_rich_blocks.test.js`
Expected: FAIL due to missing vendor files and parser rules.

- [ ] **Step 3: Implement vendor assets, CSS, and markdown parsing**
1. Add `static/vendor/prism.min.js`:
   Self-contained lightweight Prism distribution supporting `javascript`, `typescript`, `python`, `markup` (html/xml), `css`, `sql`, `json`, `bash`, `markdown`, `php`.
2. Add `static/vendor/prism.min.css`:
   Clean syntax theme with light and dark mode variables matching Alurik's design system.
3. In `static/app.css`:
   Add styles for `.note-code-card`, `.note-code-header`, `.note-code-lang`, `.note-code-copy-btn`, `.note-callout` (and `-note`, `-tip`, `-warning`, `-important`, `-caution`), and `.note-rendered details` / `summary`.
4. In `static/index.html`:
   - Include `<link rel="stylesheet" href="/static/vendor/prism.min.css">` and `<script src="/static/vendor/prism.min.js"></script>`.
   - Add `window.copyCodeBlock`:
     ```javascript
     window.copyCodeBlock = function(codeId, btn) {
       var el = document.getElementById(codeId);
       if (!el) return;
       var text = el.innerText || el.textContent;
       navigator.clipboard.writeText(text).then(function() {
         if (!btn) return;
         var orig = btn.innerHTML;
         btn.innerHTML = '✓ Tersalin';
         btn.classList.add('copied');
         setTimeout(function() { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1800);
       }).catch(function(err) { console.error('Copy failed', err); });
     };
     ```
   - In `marked.use({ renderer: { ... } })`:
     Add custom `code` renderer:
     ```javascript
     code(code, infostring) {
       const lang = (infostring || '').match(/\S*/)[0] || '';
       const highlighted = (window.Prism && lang && Prism.languages[lang])
         ? Prism.highlight(code, Prism.languages[lang], lang)
         : escapeHtml(code);
       const langDisplay = lang ? lang.toUpperCase() : 'CODE';
       const codeId = 'code-' + Math.random().toString(36).slice(2, 9);
       return `<div class="note-code-card">
         <div class="note-code-header">
           <span class="note-code-lang">${langDisplay}</span>
           <button type="button" class="note-code-copy-btn" onclick="copyCodeBlock('${codeId}', this)" title="Salin kode">📋 Salin</button>
         </div>
         <pre><code id="${codeId}" class="language-${lang}">${highlighted}</code></pre>
       </div>\n`;
     }
     ```
   - In `renderMarkdown`:
     Add pre-processing for GitHub-style alert quotes:
     ```javascript
     const ALERT_ICONS = {
       NOTE: 'ℹ️', INFO: 'ℹ️', TIP: '💡', WARNING: '⚠️', IMPORTANT: '📌', CAUTION: '🚨'
     };
     const ALERT_TITLES = {
       NOTE: 'Catatan', INFO: 'Informasi', TIP: 'Tips', WARNING: 'Perhatian', IMPORTANT: 'Penting', CAUTION: 'Peringatan'
     };
     // Transform > [!NOTE] blockquotes into .note-callout
     ```

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/offline/note_rich_blocks.test.js`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add static/vendor/ static/app.css static/index.html tests/offline/note_rich_blocks.test.js
git commit -m "feat(notes): add syntax-highlighted code blocks, callout alerts, and toggle styling"
```

---

### Task 2: Editor Slash Menu Shortcuts (`/code`, `/callout`, `/toggle`) and Service Worker v352 Precache Bump

**Files:**
- Modify: `static/index.html:16300-16450` (in `MilkdownEditor` `slashMenu` & `doSlashAction`)
- Modify: `static/sw.js`
- Modify: `tests/offline/note_rich_blocks.test.js`
- Modify: `tests/offline/drawing_sync_ui.test.js`
- Modify: `tests/offline/interactive_note_viewer.test.js`
- Modify: `tests/offline/note_search_filters.test.js`
- Modify: `tests/offline/note_saved_searches_view_mode.test.js`

**Interfaces:**
- Consumes: `slashMenu` and `doSlashAction` in `static/index.html`.
- Produces:
  - Slash items: `/code` (Code Block), `/callout` (Callout / Kotak Info), `/toggle` (Toggle / Daftar Lipatan).
  - Service Worker cache bumped to `taskflow-v352-toggle-callout-code-highlight` with `prism.min.js` and `prism.min.css` in `STATIC`.

- [ ] **Step 1: Write failing test assertions**
Update `tests/offline/note_rich_blocks.test.js`:
1. Assert `slashMenu` contains items for `code_block` (`/code`), `callout` (`/callout`), and `toggle` (`/toggle`).
2. Assert `static/sw.js` precaches `/static/vendor/prism.min.js` and `/static/vendor/prism.min.css`.
3. Assert `CACHE_NAME` is `taskflow-v352-toggle-callout-code-highlight`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/offline/note_rich_blocks.test.js`
Expected: FAIL due to missing slash items and older SW version.

- [ ] **Step 3: Implement slash menu items and Service Worker v352 bump**
1. In `static/index.html` inside `MilkdownEditor`:
   - In `doSlashAction`:
     - Add `case 'code_block'`:
       ```javascript
       if (state.schema.nodes.code_block) {
         tr = tr.setBlockType(from, to, state.schema.nodes.code_block);
       }
       ```
     - Add `case 'callout'`:
       Insert alert blockquote template: `> [!NOTE]\n> ` at current line.
     - Add `case 'toggle'`:
       Insert `<details>\n<summary>Judul Toggle</summary>\n\nIsi rincian teks...\n</details>\n` at current line.
   - In `slashMenu.appendChild`:
     - `makeSlashItem('💻', 'Code Block (/code)', 'code_block')`
     - `makeSlashItem('💡', 'Callout / Info (/callout)', 'callout')`
     - `makeSlashItem('▶', 'Toggle / Lipatan (/toggle)', 'toggle')`
2. In `static/sw.js`:
   - Add `/static/vendor/prism.min.js` and `/static/vendor/prism.min.css` to `STATIC` array.
   - Bump cache version: `const CACHE_NAME = 'taskflow-v352-toggle-callout-code-highlight';`
3. Synchronize cache version assertions across:
   - `tests/offline/drawing_sync_ui.test.js`
   - `tests/offline/interactive_note_viewer.test.js`
   - `tests/offline/note_search_filters.test.js`
   - `tests/offline/note_saved_searches_view_mode.test.js`
   - `tests/offline/note_rich_blocks.test.js`

- [ ] **Step 4: Run full verification suite**
Run:
- `node scratch/check_inline.js static/index.html` (5/5 scripts OK)
- `node --check static/sw.js` (OK)
- `node --test tests/offline/*.test.js` (all suites pass)
- `python -m pytest tests/` (full test suite passes)

- [ ] **Step 5: Commit**
```bash
git add static/index.html static/sw.js tests/offline/
git commit -m "feat(editor): add slash menu shortcuts for code, callout, toggle and bump SW to v352"
```
