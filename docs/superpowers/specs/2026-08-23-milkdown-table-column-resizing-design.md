# Design Specification: Milkdown Interactive Table Column Resizing

**Date**: 2026-08-23  
**Status**: APPROVED by User (Interactive WYSIWYG Mode)  
**Author**: Antigravity  

---

## 1. Background & Goals

### Current State
* Note Editor in TaskFlow uses Milkdown WYSIWYG with `@milkdown/preset-gfm`.
* Table editing is currently limited to inserting tables, adding/removing rows & columns, and setting text alignments via the floating Table Toolbar.
* While `@milkdown/preset-gfm` already bundles `columnResizingPlugin` from `prosemirror-tables`, users cannot interactively resize columns because the required DOM styles (`.column-resize-handle`, `.resize-cursor`, and relative cell positioning) were not included in `static/app.css`.

### Goals
* Enable **Interactive Drag-to-Resize** on table columns inside the Milkdown Note Editor.
* Show a clear, polished visual resize grip (`col-resize` cursor and theme-colored vertical handle indicator) when hovering over cell borders.
* Maintain 100% pure GitHub Flavored Markdown (GFM) compatibility without corrupting raw Markdown storage, Note Viewer, or export pipelines (Word .docx / PDF).

---

## 2. Architecture & Approach

### Mode: Interactive WYSIWYG
* **In-Editor Behavior**: When editing a note with a table, ProseMirror attaches column resize handles to `th` and `td` elements. Dragging adjusts `<colgroup><col>` widths dynamically.
* **Storage & Serialization**: When serialized to Markdown, the table is cleanly formatted as standard GFM (`| Col 1 | Col 2 |`). No raw HTML `<table>` tags are written into the document, keeping notes clean, human-readable, and compatible across all platforms.

---

## 3. UI & Styling Specifications

### CSS Integration (`static/app.css` & `static/index.html`)

1. **Table Structure & Cell Positioning**:
   ```css
   .milkdown-editor .ProseMirror .tableWrapper {
     overflow-x: auto;
     margin: 12px 0;
     max-width: 100%;
   }
   .milkdown-editor .ProseMirror table {
     border-collapse: collapse;
     table-layout: fixed;
     width: 100%;
     overflow: hidden;
   }
   .milkdown-editor .ProseMirror td,
   .milkdown-editor .ProseMirror th {
     vertical-align: top;
     box-sizing: border-box;
     position: relative;
   }
   ```

2. **Column Resize Handle & Cursor**:
   ```css
   .milkdown-editor .ProseMirror .column-resize-handle {
     position: absolute;
     right: -2px;
     top: 0;
     bottom: 0;
     width: 4px;
     z-index: 20;
     background-color: var(--accent, #3b82f6);
     opacity: 0.8;
     pointer-events: none;
     border-radius: 2px;
   }
   .milkdown-editor .ProseMirror.resize-cursor,
   .milkdown-editor .ProseMirror.resize-cursor * {
     cursor: col-resize !important;
   }
   ```

3. **Cell Selection Indicator**:
   ```css
   .milkdown-editor .ProseMirror .selectedCell:after {
     z-index: 2;
     position: absolute;
     content: '';
     left: 0;
     right: 0;
     top: 0;
     bottom: 0;
     background: rgba(59, 130, 246, 0.2);
     pointer-events: none;
   }
   ```

4. **Paper Mode & Dark Mode Harmony**:
   * Works smoothly inside Paper Mode (`.paper-mode-active`) and standard live preview mode.
   * In dark mode (`[data-theme="dark"]`), `.column-resize-handle` uses `var(--accent)` with a crisp glow for high visibility.

---

## 4. Verification & Testing Strategy

1. **Visual & Interaction Verification**:
   * Hovering near the right border of any `th` or `td` shows the resize indicator and changes the cursor to `col-resize`.
   * Dragging left or right expands or contracts the column width.
   * Table Toolbar actions (add column, remove column, alignment) continue to function seamlessly.
2. **Markdown Integrity**:
   * Saving and reloading notes with tables preserves pure GFM syntax.
   * Word (`.docx`) and PDF export pipelines parse and export tables without error.
3. **Automated Test Suites**:
   * Run all offline unit tests (`node --test tests/offline/*.test.js`).
   * Run all pytest backend tests (`python -m pytest tests/`).
