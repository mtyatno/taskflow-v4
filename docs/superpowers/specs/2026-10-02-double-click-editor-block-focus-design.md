# Design Specification: Double-Click Cursor & Block Focus in Note Editor

- **Date:** 2026-10-02
- **Topic:** Note Viewer Double-Click Focus Enhancement
- **Target Files:**
  - `static/index.html` (`NotePanel`, `NotesPage`, `NoteModal`)
  - `static/sw.js` (bump cache version)
  - `tests/offline/interactive_note_viewer.test.js`

---

## 1. Problem Statement & Motivation
When double-clicking text or a paragraph in the Note Viewer (`NotePanel`), the editor modal (`NoteModal`) currently opens, but the user's cursor/caret does not land on the double-clicked block. Instead:
1. The title input field steals focus due to `autoFocus={!focusMode}` on `<input className="note-modal-title-input">`.
2. Even if the Milkdown WYSIWYG editor gains focus, the ProseMirror caret defaults to document offset `0` (the very top of the note).
3. The user is forced to scroll through the document and manually click on the block they wanted to edit, introducing friction and disrupting their reading/writing workflow.

---

## 2. Goals & Non-Goals
### Goals
- Capture the specific block element (`p`, `h1..h6`, `li`, `blockquote`, `pre`, `tr`) that was double-clicked in the viewer.
- Pass the block metadata (text snippet, tag name, and child index) through `onEdit` into `NoteModal`.
- In `NoteModal`, once the ProseMirror instance is mounted and ready, find the corresponding block node in `view.state.doc`.
- Programmatically set `TextSelection` inside the target block node, dispatch the transaction with `.scrollIntoView()`, and scroll the modal view to center the block.
- Suppress `autoFocus` on the title input when an `initialBlockTarget` is provided.

### Non-Goals
- Altering the visual design or behavior when clicking the "✏ Edit" toolbar button (which still opens the editor with default focus at the top / title).
- Modifying Milkdown's internal parser or serialization.

---

## 3. Architecture & Data Flow

```
[User double-clicks block in .note-rendered]
                   │
                   ▼
  1. NotePanel.handleDoubleClick(e)
     - Guard: ignores interactive inputs/links/buttons
     - Find closest block: e.target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr')
     - Extract:
         blockText: (blockEl.textContent || '').trim().slice(0, 100)
         blockIndex: Array.from(container.querySelectorAll(...)).indexOf(blockEl)
         tag: blockEl.tagName.toLowerCase()
     - Calls: onEdit({ text: blockText, index: blockIndex, tag })
                   │
                   ▼
  2. NotesPage
     - State: initialEditorTarget
     - openEdit(activeNote, blockTarget):
         setSelected(activeNote);
         setInitialEditorTarget(blockTarget || null);
         setShowModal(true);
     - Renders: <NoteModal initialBlockTarget={initialEditorTarget} ... />
                   │
                   ▼
  3. NoteModal
     - Title input: autoFocus={!focusMode && !initialBlockTarget}
     - useEffect on [initialBlockTarget]:
         Poll/wait until getEditorView() returns active view
         Search view.state.doc for matching textblock:
           a. By text matching (textContent contains snippet or vice versa)
           b. Fallback by textblock index counter
         Resolve pos: doc.resolve(targetPos)
         Dispatch: tr.setSelection(TextSelection.near($pos)).scrollIntoView()
         Scroll DOM: view.nodeDOM(...).scrollIntoView({ behavior: 'smooth', block: 'center' })
         Focus: view.focus()
```

---

## 4. Detailed Component Changes

### 4.1 `NotePanel` (`static/index.html`)
Update `onDoubleClick` handler in `.note-rendered`:
```javascript
onDoubleClick: e => {
  if (e.target && e.target.closest && e.target.closest('input, a, button, [data-tasklink], [data-wiki-id], [data-wiki-title], [data-drawing-preview]')) return;
  const container = e.currentTarget;
  const blockEl = e.target && e.target.closest ? e.target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr') : null;
  let blockTarget = null;
  if (blockEl && container) {
    const allBlocks = Array.from(container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr'));
    const idx = allBlocks.indexOf(blockEl);
    blockTarget = {
      text: (blockEl.textContent || '').trim().slice(0, 80),
      index: idx >= 0 ? idx : 0,
      tag: blockEl.tagName.toLowerCase()
    };
  }
  if (typeof onEdit === 'function') onEdit(blockTarget);
}
```

### 4.2 `NotesPage` (`static/index.html`)
- Add state `initialBlockTarget`:
  ```javascript
  const [initialBlockTarget, setInitialBlockTarget] = useState(null);
  ```
- Update `openEdit`:
  ```javascript
  const openEdit = (note, blockTarget) => {
    setSelected(note);
    setInitialBlockTarget(blockTarget || null);
    setShowModal(true);
  };
  ```
- Pass prop to `NoteModal`:
  ```javascript
  initialBlockTarget: initialBlockTarget
  ```

### 4.3 `NoteModal` (`static/index.html`)
- Accept prop `initialBlockTarget = null`.
- Update `<input className="note-modal-title-input">`:
  ```javascript
  autoFocus: !focusMode && !initialBlockTarget,
  ```
- Add `useEffect` to locate node in ProseMirror and apply cursor/scroll:
  ```javascript
  React.useEffect(() => {
    if (!initialBlockTarget) return;
    let timer = null;
    let tries = 0;
    const locateAndFocus = () => {
      const view = getEditorView();
      if (!view) {
        if (++tries < 40) timer = setTimeout(locateAndFocus, 100);
        return;
      }
      const MB = window.MilkdownBundle;
      if (!MB?.editorViewCtx) return;
      const doc = view.state.doc;
      let targetPos = null;

      // Strategy 1: Match by text snippet
      if (initialBlockTarget.text) {
        const needle = initialBlockTarget.text.slice(0, 50).toLowerCase();
        doc.descendants((node, pos) => {
          if (targetPos !== null) return false;
          if (node.isBlock && node.isTextblock) {
            const txt = (node.textContent || '').trim().toLowerCase();
            if (txt && (txt.includes(needle) || needle.includes(txt.slice(0, 30)))) {
              targetPos = pos + 1;
              return false;
            }
          }
        });
      }

      // Strategy 2: Fallback by index counter
      if (targetPos === null && typeof initialBlockTarget.index === 'number' && initialBlockTarget.index >= 0) {
        let blockCount = 0;
        doc.descendants((node, pos) => {
          if (targetPos !== null) return false;
          if (node.isBlock && node.isTextblock) {
            if (blockCount === initialBlockTarget.index) {
              targetPos = pos + 1;
              return false;
            }
            blockCount++;
          }
        });
      }

      if (targetPos !== null) {
        try {
          const $pos = doc.resolve(Math.min(targetPos, doc.content.size));
          const sel = MB.TextSelection ? MB.TextSelection.near($pos) : null;
          let tr = view.state.tr;
          if (sel) tr = tr.setSelection(sel);
          view.dispatch(tr.scrollIntoView());
          view.focus();

          const domNode = view.nodeDOM ? (view.nodeDOM($pos.before($pos.depth)) || view.nodeDOM($pos.pos)) : null;
          if (domNode && domNode.scrollIntoView) {
            domNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } catch (_) {}
      }
    };
    locateAndFocus();
    return () => clearTimeout(timer);
  }, [initialBlockTarget]);
  ```

---

## 5. Verification & Testing Strategy
1. **Unit Tests in `tests/offline/interactive_note_viewer.test.js`**:
   - Verify `onDoubleClick` in `NotePanel` extracts block metadata (`blockTarget`) and passes to `onEdit`.
   - Verify `NotesPage` passes `initialBlockTarget` to `NoteModal`.
   - Verify `NoteModal` title input disables `autoFocus` when `initialBlockTarget` is provided.
   - Verify `NoteModal` includes ProseMirror node descendant search and `TextSelection.near` positioning.
2. **Offline JS & Python Pytest Suite**:
   - `node --test tests/offline/*.test.js` must pass 805/805.
   - `python -m pytest tests/` must pass 61/61.
   - Inline script syntax `check_inline.js` must pass 5/5.
3. **Cache Busting**:
   - Bump SW cache version to `taskflow-v343-double-click-block-focus`.
