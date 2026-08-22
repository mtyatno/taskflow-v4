# Milkdown Inline Interactive Drawing Card Design Spec

**Date:** 2026-08-22  
**Status:** Approved  
**Topic:** Interactive Inline Drawing Frames (`::draw[...]`) inside Milkdown Note Editor

---

## 1. Overview & Objective

Currently, when a user inserts an inline drawing using `/draw` or the toolbar button, the note editor (Milkdown / ProseMirror) treats the directive as plain paragraph text:
```markdown
::draw[drawing-uuid-123]{title="Diagram Arsitektur" size="M"}
```
The visual frame (`.note-draw-card`) with its rendered SVG only appears in the read-only Note Viewer (after saving and opening the reading view).

**Objective:**  
Implement a custom **Milkdown Node & Remark Plugin** for `drawingDirective` so that `::draw[...]` directives are rendered as **live, interactive drawing cards (`.note-draw-card`)** directly inside the Milkdown WYSIWYG note editor, featuring:
1. Live SVG drawing previews loaded from local cache / IndexedDB / server.
2. Inline size switching buttons (**S** / **M** / **L**).
3. Direct **✏️ Edit** button to open the canvas editor modal and live-update the preview upon save.
4. Seamless roundtrip Markdown serialization (`toMarkdown` / `parseMarkdown`).
5. Natural block atom behavior (clean selection, deletion with Backspace/Delete, undo/redo support).

---

## 2. Architecture & Component Design

```
                     ┌──────────────────────────────────────────────────────────┐
                     │                    Note Content (MD)                     │
                     │  "::draw[uuid]{title=\"Arsitektur\" size=\"M\" width=\"75%\"}"  │
                     └────────────────────────────┬─────────────────────────────┘
                                                  │ (Parsing)
                                                  ▼
                                     ┌─────────────────────────┐
                                     │    remarkDrawPlugin     │
                                     │ (Transforms text to AST)│
                                     └────────────┬────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │   ProseMirror Node      │
                                     │    'drawing' (Atom)     │
                                     └────────────┬────────────┘
                                                  │
                                                  ▼
                                     ┌─────────────────────────┐
                                     │ DOM: .note-draw-card    │
                                     │  - Header & S/M/L pills │
                                     │  - Edit / Open buttons  │
                                     │  - SVG Preview Canvas   │
                                     └────────────┬────────────┘
                                                  │ (Auto-Save / Serialize)
                                                  ▼
                     ┌──────────────────────────────────────────────────────────┐
                     │           Markdown Serializer (toMarkdown)               │
                     │  "::draw[uuid]{title=\"Arsitektur\" size=\"M\" width=\"75%\"}"  │
                     └──────────────────────────────────────────────────────────┘
```

### 2.1 Remark Plugin: `remarkDrawPlugin`
- **Location:** Inlined in `static/index.html` (alongside `remarkTasklinkPlugin` and `remarkWikilinkPlugin`).
- **AST Transformation:**
  - Scans paragraph text nodes for pattern:
    ```javascript
    /\\?::draw\\?\[([0-9a-zA-Z_-]+)\\?\](?:\s*\\?\{([^}]*)\\?\})?/gi
    ```
  - Parses attributes: `title`, `size` (`S` | `M` | `L`), `width` (`50%` | `75%` | `100%`), and `height` (`200px` | `300px` | `400px`).
  - Replaces matches with an MDAST node:
    ```javascript
    {
      type: 'drawingDirective',
      id: idStr,
      title: attrs.title || 'Gambar',
      size: size,
      width: widthVal,
      height: heightVal
    }
    ```

### 2.2 Milkdown Node Schema: `drawingNode`
- **Definition:** Registered via `MB.$node('drawing', ...)` and loaded into the Milkdown editor instance.
- **Node Spec:**
  - `group: 'block'`
  - `atom: true`
  - `selectable: true`
  - `draggable: true`
  - `attrs`:
    - `id`: `{ default: '' }`
    - `title`: `{ default: 'Gambar' }`
    - `size`: `{ default: 'L' }`
    - `width`: `{ default: '100%' }`
    - `height`: `{ default: '400px' }`
- **`toDOM(node)`**:
  Constructs the DOM representation:
  ```javascript
  ['div', {
    class: 'note-draw-card editor-draw-card',
    'data-drawing-id': node.attrs.id,
    'data-size': node.attrs.size,
    style: `width:${node.attrs.width};max-width:${node.attrs.width};margin:10px ${node.attrs.width === '100%' ? '0' : 'auto'};`
  },
    ['div', { class: 'note-draw-header' },
      ['span', null, `🎨 ${node.attrs.title}`],
      ['div', { style: 'display:flex;gap:6px;align-items:center;' },
        ['div', { class: 'note-draw-size-pills' },
          ['button', { type: 'button', class: `note-draw-size-btn ${node.attrs.size === 'S' ? 'active' : ''}`, 'data-size-btn': 'S' }, 'S'],
          ['button', { type: 'button', class: `note-draw-size-btn ${node.attrs.size === 'M' ? 'active' : ''}`, 'data-size-btn': 'M' }, 'M'],
          ['button', { type: 'button', class: `note-draw-size-btn ${node.attrs.size === 'L' ? 'active' : ''}`, 'data-size-btn': 'L' }, 'L']
        ],
        ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'edit' }, '✏️ Edit'],
        ['button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'open' }, '↗️ Buka']
      ]
    ],
    ['div', {
      class: 'note-draw-preview-container',
      'data-drawing-preview': node.attrs.id,
      style: `max-height:${node.attrs.height};overflow:auto;cursor:pointer;`
    },
      ['div', { class: 'drawing-preview-placeholder' }, '🎨 Klik untuk membuka / mengedit gambar']
    ]
  ]
  ```
- **`parseDOM`**: Matches `div.note-draw-card[data-drawing-id]` to extract attributes.
- **`parseMarkdown`**: Matches `node.type === 'drawingDirective'`, mapping AST properties to ProseMirror node attributes.
- **`toMarkdown`**: Serializes the node back to:
  ```markdown
  ::draw[<id>]{title="<title>" size="<size>" width="<width>"}
  ```

---

## 3. Interactive Behaviors & Event Handling

1. **SVG Auto-Hydration in Editor:**
   - When the Milkdown editor loads or modifies a document, a hydration listener runs across all rendered `[data-drawing-preview]` elements inside `.milkdown-editor`.
   - Fetches cached SVG from `window.TF.drawingrepo` (IndexedDB) or `/api/drawings/:id`.
   - Replaces the placeholder with the actual sanitized `<svg>` element.

2. **Editing Drawings (Live Sync):**
   - Clicking the **✏️ Edit** button or the preview body triggers the standard custom event `editDrawingModal` with `{ id, title }`.
   - When the user finishes drawing in `QuickDrawModal` and saves, a `drawingSaved` event is dispatched.
   - The editor catches this event and immediately updates the SVG preview in-place without resetting editor cursor/history.

3. **Size Switching (S / M / L):**
   - Clicking **S**, **M**, or **L** on the card header intercepts the click event, locates the ProseMirror node position, and dispatches a transaction updating `size`, `width`, and `height`:
     - **S**: `size: 'S', width: '50%', height: '200px'`
     - **M**: `size: 'M', width: '75%', height: '300px'`
     - **L**: `size: 'L', width: '100%', height: '400px'`

4. **Insertion Command (`/draw`):**
   - `/draw` slash menu command or toolbar button `🎨 +Gambar` dispatches node insertion using `view.state.schema.nodes.drawing.create({ id, title })` or text fallback.

---

## 4. Offline & Cache Strategy

- **Service Worker Cache:** Service Worker version in `static/sw.js` will be bumped (e.g. `taskflow-v283-milkdown-inline-draw-card`).
- **IndexedDB Fallback:** Drawing SVGs are loaded from IndexedDB `drawingrepo` first for 100% offline-ready rendering.

---

## 5. Verification & Testing Plan

1. **Unit Tests (`tests/offline/drawdirective.test.js`):**
   - Test Markdown token regex parser with all variations (title with spaces/quotes, sizes S/M/L, escaped characters).
   - Test roundtrip conversion (Markdown ➔ AST ➔ Node ➔ Markdown).
2. **Integration Verification:**
   - Create new note -> Type `/draw` -> Insert drawing -> Confirm visual card renders with title and size buttons.
   - Switch sizes (S, M, L) -> Confirm CSS width updates and autosave saves clean directive string.
   - Click ✏️ Edit -> Draw canvas -> Save -> Confirm SVG preview updates in editor immediately.
   - Switch between Edit mode and View mode -> Confirm identical card layout.
   - Export Note to `.docx` / `.md` / `.pdf` -> Confirm drawing exports properly.
3. **Automated Suite:**
   - Full suite pass: `node --test tests/offline/*.test.js` (433+ pass, 0 fail).
   - Full Python suite pass: `python -m pytest tests/` (43 pass, 0 fail).
