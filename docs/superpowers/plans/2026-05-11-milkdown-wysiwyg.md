# Milkdown WYSIWYG Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain textarea + preview-tab note editor with a single Milkdown WYSIWYG inline editor where markdown renders as you type, preserving wikilink `[[...]]` support, NoteToolbar, autocompletes, and 100% offline capability.

**Architecture:** Pre-bundle Milkdown once with esbuild into `static/vendor/milkdown.bundle.js` (IIFE global `window.MilkdownBundle`). A new `MilkdownEditor` React component replaces `<textarea>` everywhere in the note editor. The React `content` state stays as raw markdown string — backend API unchanged. `marked.js` is retained for static rendering outside the editor (list preview, print, export).

**Tech Stack:** Milkdown v7 (`@milkdown/core`, `@milkdown/preset-gfm`, `@milkdown/plugin-listener`, `@milkdown/plugin-history`, `@milkdown/utils`), esbuild (bundler), existing React + Babel-in-browser app.

**Spec:** `docs/superpowers/specs/2026-05-11-milkdown-wysiwyg-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `milkdown-build/package.json` | Create | npm project for esbuild bundling |
| `milkdown-build/entry.js` | Create | esbuild entry — re-exports all needed Milkdown symbols |
| `static/vendor/milkdown.bundle.js` | Generate | Pre-built IIFE bundle (run once, commit) |
| `static/sw.js` | Modify | Add milkdown.bundle.js to SW cache, bump version |
| `static/index.html` | Modify | Add script tag, MilkdownEditor component, wikilink plugin, rewire NoteToolbar, replace textarea |

---

## Task 1: Build the Milkdown bundle

**Files:**
- Create: `milkdown-build/package.json`
- Create: `milkdown-build/entry.js`
- Generate: `static/vendor/milkdown.bundle.js`

- [ ] **Step 1: Create milkdown-build directory and package.json**

Create `milkdown-build/package.json`:
```json
{
  "name": "milkdown-build",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "esbuild entry.js --bundle --format=iife --global-name=MilkdownBundle --minify --outfile=../static/vendor/milkdown.bundle.js"
  },
  "dependencies": {
    "@milkdown/core": "^7.5.6",
    "@milkdown/preset-gfm": "^7.5.6",
    "@milkdown/plugin-listener": "^7.5.6",
    "@milkdown/plugin-history": "^7.5.6",
    "@milkdown/utils": "^7.5.6"
  },
  "devDependencies": {
    "esbuild": "^0.21.0"
  }
}
```

- [ ] **Step 2: Create milkdown-build/entry.js**

```javascript
export {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
  commandsCtx,
  EditorStatus,
} from '@milkdown/core';

export {
  gfm,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
  toggleStrikethroughCommand,
  insertTableCommand,
} from '@milkdown/preset-gfm';

export { listener, listenerCtx } from '@milkdown/plugin-listener';
export { history } from '@milkdown/plugin-history';
export { callCommand, $node, $remark, $inputRule, replaceAll } from '@milkdown/utils';

// ProseMirror re-exports needed for custom wikilink plugin
export { InputRule } from '@milkdown/prose/inputrules';
export { TextSelection } from '@milkdown/prose/state';
```

- [ ] **Step 3: Install dependencies and build**

Run inside `milkdown-build/`:
```
cd milkdown-build
npm install
npm run build
```

Expected: `static/vendor/milkdown.bundle.js` created (~400-600KB minified).

- [ ] **Step 4: Verify bundle exports**

Open browser DevTools console on any page and run:
```javascript
const s = document.createElement('script');
s.src = '/static/vendor/milkdown.bundle.js';
document.head.appendChild(s);
// After load:
console.log(typeof MilkdownBundle.Editor);        // "function"
console.log(typeof MilkdownBundle.gfm);           // "object"
console.log(typeof MilkdownBundle.callCommand);    // "function"
console.log(typeof MilkdownBundle.InputRule);      // "function"
```

If any is `undefined`, check entry.js export name against the package's actual exports in `milkdown-build/node_modules/@milkdown/*/dist/index.d.ts`.

- [ ] **Step 5: Commit**

```bash
git add milkdown-build/package.json milkdown-build/entry.js milkdown-build/package-lock.json static/vendor/milkdown.bundle.js
git commit -m "build: add Milkdown pre-bundle (esbuild IIFE)"
```

---

## Task 2: Update service worker and add script tag

**Files:**
- Modify: `static/sw.js` (lines 1-14)
- Modify: `static/index.html` (line 24 area — vendor script tags)

- [ ] **Step 1: Bump SW cache version and add milkdown to cache list**

In `static/sw.js` line 1, change:
```javascript
const CACHE = "taskflow-v33-notesfix";
```
to:
```javascript
const CACHE = "taskflow-v34-milkdown";
```

In the `STATIC` array (lines 3-14), add after `marked.min.js`:
```javascript
  "/static/vendor/milkdown.bundle.js",
```

- [ ] **Step 2: Add script tag in index.html**

In `static/index.html`, after line 24 (`<script src="/static/vendor/marked.min.js"></script>`), add:
```html
  <script src="/static/vendor/milkdown.bundle.js"></script>
```

- [ ] **Step 3: Verify SW caches the file**

Open the app in browser → DevTools → Application → Service Workers → click "Update" → then Application → Cache Storage → look for `taskflow-v34-milkdown` → verify `milkdown.bundle.js` is listed.

- [ ] **Step 4: Commit**

```bash
git add static/sw.js static/index.html
git commit -m "feat: cache Milkdown bundle in service worker"
```

---

## Task 3: MilkdownEditor base component (no wikilink yet)

**Files:**
- Modify: `static/index.html` — add `MilkdownEditor` function component near line 7223 (after `NoteToolbar` function, before `NoteEditModal`)

- [ ] **Step 1: Add MilkdownEditor CSS**

In `static/index.html`, inside the `<style>` block, add:
```css
.milkdown-editor {
  outline: none;
  overflow-y: auto;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
}
/* Match existing textarea styling */
.milkdown-editor .ProseMirror {
  min-height: inherit;
  padding: 8px 12px;
  outline: none;
}
/* Placeholder text */
.milkdown-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-light);
  pointer-events: none;
  float: left;
  height: 0;
}
```

- [ ] **Step 2: Add MilkdownEditor component to index.html**

Add this function component in `static/index.html` after the closing `}` of the `NoteToolbar` function (around line 7353):

```javascript
function MilkdownEditor({ value, onChange, minHeight, editorRef, placeholder }) {
  const containerRef = React.useRef(null);
  const instanceRef = React.useRef(null);
  const isExternalUpdate = React.useRef(false);
  const [ready, setReady] = React.useState(false);

  // Mount editor once
  React.useEffect(() => {
    if (!containerRef.current) return;
    const MB = window.MilkdownBundle;
    let cancelled = false;

    MB.Editor.make()
      .config(ctx => {
        ctx.set(MB.rootCtx, containerRef.current);
        ctx.set(MB.defaultValueCtx, value || '');
        ctx.get(MB.listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (!isExternalUpdate.current) {
            onChange(markdown);
          }
        });
      })
      .use(MB.gfm)
      .use(MB.listener)
      .use(MB.history)
      .create()
      .then(editor => {
        if (cancelled) { editor.destroy(); return; }
        instanceRef.current = editor;
        if (editorRef) editorRef.current = editor;
        setReady(true);
      });

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
      if (editorRef) editorRef.current = null;
      setReady(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external value into editor (conflict resolution, note switch)
  React.useEffect(() => {
    const editor = instanceRef.current;
    if (!editor || !ready) return;
    const MB = window.MilkdownBundle;

    const current = editor.action(ctx => {
      const view = ctx.get(MB.editorViewCtx);
      const serializer = ctx.get(MB.serializerCtx);
      return serializer(view.state.doc);
    });

    if (current.trim() !== (value || '').trim()) {
      isExternalUpdate.current = true;
      editor.action(MB.callCommand(MB.replaceAll, value || ''));
      setTimeout(() => { isExternalUpdate.current = false; }, 0);
    }
  }, [value, ready]);

  return (
    <div
      ref={containerRef}
      className="milkdown-editor note-modal-content-input"
      style={{ minHeight: minHeight || 120 }}
    />
  );
}
```

- [ ] **Step 3: Manual test — basic editor**

Open any note. Temporarily replace the note modal's `<textarea>` with:
```jsx
<MilkdownEditor value={content} onChange={handleContentChange} minHeight={120} />
```
Verify: editor renders, typing updates the `content` state (check autosave fires), bold text typed as `**word**` renders as bold after closing `**`, Ctrl+Z undoes.

Revert this temporary change before committing (Task 8 does the real replacement).

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add MilkdownEditor base component (no wikilink)"
```

---

## Task 4: Wikilink plugin — remark + ProseMirror node + input rule

**Files:**
- Modify: `static/index.html` — add wikilink plugin code after `MilkdownEditor` component, update `MilkdownEditor`'s `.use()` chain

- [ ] **Step 1: Add wikilink plugin CSS**

In the `<style>` block, add:
```css
.wikilink-node {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: 4px;
  padding: 0 3px;
  cursor: pointer;
  text-decoration: none;
  font-size: 0.95em;
  user-select: all;
}
.wikilink-node:hover {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  text-decoration: underline;
}
```

- [ ] **Step 2: Add remark wikilink parser function**

Add after `MilkdownEditor` closing brace:

```javascript
function remarkWikilinkPlugin() {
  return function transformer(tree) {
    function walk(node, parent, index) {
      if (node.type === 'text' && typeof node.value === 'string') {
        const regex = /\[\[([^\[\]\n]+)\]\]/g;
        const parts = [];
        let lastIndex = 0;
        let match;
        while ((match = regex.exec(node.value)) !== null) {
          if (match.index > lastIndex) {
            parts.push({ type: 'text', value: node.value.slice(lastIndex, match.index) });
          }
          parts.push({ type: 'wikilink', title: match[1] });
          lastIndex = regex.lastIndex;
        }
        if (parts.length > 0) {
          if (lastIndex < node.value.length) {
            parts.push({ type: 'text', value: node.value.slice(lastIndex) });
          }
          parent.children.splice(index, 1, ...parts);
          return index + parts.length;
        }
      }
      if (node.children && Array.isArray(node.children)) {
        let i = 0;
        while (i < node.children.length) {
          const next = walk(node.children[i], node, i);
          i = next !== undefined ? next : i + 1;
        }
      }
    }
    walk(tree, null, 0);
  };
}
```

- [ ] **Step 3: Add wikilink Milkdown plugin factory**

Add after the remark function:

```javascript
function createWikilinkPlugin(onWikilinkClick) {
  const MB = window.MilkdownBundle;

  const wikilinkNode = MB.$node('wikilink', () => ({
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { title: { default: '' } },
    toDOM: (node) => [
      'span',
      {
        class: 'wikilink-node',
        'data-wikilink': '',
        'data-title': node.attrs.title,
        title: `Open: ${node.attrs.title}`,
      },
      `[[${node.attrs.title}]]`,
    ],
    parseDOM: [{
      tag: 'span[data-wikilink]',
      getAttrs: (dom) => ({ title: dom.getAttribute('data-title') || '' }),
    }],
    parseMarkdown: {
      match: (node) => node.type === 'wikilink',
      runner: (state, node, type) => {
        state.addNode(type, { title: node.title });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'wikilink',
      runner: (state, node) => {
        state.addNode('text', undefined, undefined, `[[${node.attrs.title}]]`);
      },
    },
  }));

  const wikilinkRemark = MB.$remark('wikilink-remark', () => remarkWikilinkPlugin);

  const wikilinkInputRule = MB.$inputRule((ctx) => {
    const nodeType = ctx.get(wikilinkNode.type);
    return new MB.InputRule(
      /\[\[([^\[\]\n]+)\]\]$/,
      (state, match, start, end) => {
        return state.tr.replaceWith(start, end, nodeType.create({ title: match[1] }));
      }
    );
  });

  return [wikilinkRemark, wikilinkNode, wikilinkInputRule];
}
```

- [ ] **Step 4: Register wikilink plugin in MilkdownEditor**

In the `MilkdownEditor` component, change the `.create()` chain to include the wikilink plugin. Update the component props to accept `onWikilinkClick`:

```javascript
// Props: add onWikilinkClick
function MilkdownEditor({ value, onChange, minHeight, editorRef, onWikilinkClick }) {
```

And in the `Editor.make()` chain, add after `.use(MB.history)`:
```javascript
      .use(createWikilinkPlugin(onWikilinkClick))
```

Also add a click handler on the container div to handle wikilink clicks:
```javascript
  const handleContainerClick = React.useCallback((e) => {
    const target = e.target.closest('[data-wikilink]');
    if (target && onWikilinkClick) {
      onWikilinkClick(target.getAttribute('data-title'));
    }
  }, [onWikilinkClick]);

  // In the return JSX:
  return (
    <div
      ref={containerRef}
      className="milkdown-editor note-modal-content-input"
      style={{ minHeight: minHeight || 120 }}
      onClick={handleContainerClick}
    />
  );
```

- [ ] **Step 5: Manual test — wikilink rendering**

Open a note that has `[[SomeTitle]]` in its content. Verify:
- The note opens and `[[SomeTitle]]` renders as a blue chip
- Type `[[TestNote]]` in the editor — after closing `]]`, it converts to a chip
- Click the chip — `onWikilinkClick` fires (log it for now)
- Autosave fires — content saved as `[[TestNote]]` in the DB (check via API or note reload)

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat: add Milkdown wikilink plugin (node + remark + inputRule)"
```

---

## Task 5: Wikilink autocomplete with Milkdown

**Files:**
- Modify: `static/index.html` — rewrite `handleContentChange` wikilink detection + `insertWikilink` to use ProseMirror

Context: `handleContentChange` is around line 7679. `insertWikilink` is around line 7723. These currently use `textareaRef.current.selectionStart`. With Milkdown, we read cursor position from ProseMirror view and insert via a transaction.

- [ ] **Step 1: Add helper to read text-before-cursor from ProseMirror**

Add this helper inside `NoteEditModal` (or inline in handleEditorChange), after the existing state declarations:

```javascript
const milkdownEditorRef = React.useRef(null);

function getTextBeforeCursor() {
  const editor = milkdownEditorRef.current;
  if (!editor) return '';
  const MB = window.MilkdownBundle;
  let result = '';
  editor.action(ctx => {
    const view = ctx.get(MB.editorViewCtx);
    const { from } = view.state.selection;
    result = view.state.doc.textBetween(0, from, '\n', '\0');
  });
  return result;
}

function getCursorCoords() {
  const editor = milkdownEditorRef.current;
  if (!editor) return { top: 100, left: 100 };
  const MB = window.MilkdownBundle;
  let coords = { top: 100, left: 100 };
  editor.action(ctx => {
    const view = ctx.get(MB.editorViewCtx);
    const { from } = view.state.selection;
    const c = view.coordsAtPos(from);
    coords = { top: c.bottom + 4, left: c.left };
  });
  return coords;
}
```

- [ ] **Step 2: Rewrite handleContentChange for wikilink detection**

Replace the existing `handleContentChange` function with `handleEditorChange` (called from `MilkdownEditor`'s `onChange` prop):

```javascript
const handleEditorChange = (markdown) => {
  setContent(markdown);

  // Auto-extract tags
  const extracted = [...new Set(
    (markdown.match(/#([a-zA-Z0-9_À-ɏ]+)/g) || [])
      .map(t => t.slice(1).toLowerCase().trim())
  )].filter(Boolean);
  if (JSON.stringify(extracted) !== JSON.stringify(tags)) {
    setTags(extracted);
  }

  const textBefore = getTextBeforeCursor();

  // Tag autocomplete
  const tagMatch = textBefore.match(/#([a-zA-Z0-9_À-ɏ]*)$/);
  if (tagMatch) {
    const query = tagMatch[1].toLowerCase();
    const items = existingTags
      .filter(t => t.name.startsWith(query) && !extracted.includes(t.name))
      .slice(0, 6);
    if (items.length > 0) {
      const coords = getCursorCoords();
      setTagDropdown({ query, items, top: coords.top, left: coords.left });
    } else {
      setTagDropdown(null);
    }
  } else {
    setTagDropdown(null);
  }

  // Wikilink autocomplete
  const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
  if (!wikiMatch) { setWikiDropdown(null); return; }
  const query = wikiMatch[1];
  const queryTrimmed = query.trim();
  const queryLow = queryTrimmed.toLowerCase();
  const items = noteTitles
    .filter(n => n.title.toLowerCase().includes(queryLow) && n.title !== title)
    .slice(0, 6);
  const exactMatch = noteTitles.some(n => n.title.toLowerCase() === queryLow);
  const canCreate = queryTrimmed.length > 0 && !exactMatch;
  const coords = getCursorCoords();
  setWikiDropdown({ top: coords.top, left: coords.left, query, items, activeIdx: 0, canCreate });
};
```

- [ ] **Step 3: Rewrite insertWikilink to use Milkdown transaction**

Replace `insertWikilink`:

```javascript
const insertWikilink = (noteTitle) => {
  const editor = milkdownEditorRef.current;
  if (!editor) return;
  const MB = window.MilkdownBundle;
  setWikiDropdown(null);

  editor.action(ctx => {
    const view = ctx.get(MB.editorViewCtx);
    const { from } = view.state.selection;
    const textBefore = view.state.doc.textBetween(0, from, '\n', '\0');
    const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
    if (!wikiMatch) return;

    const replaceFrom = from - wikiMatch[0].length;
    const nodeType = view.state.schema.nodes.wikilink;
    if (nodeType) {
      view.dispatch(
        view.state.tr.replaceWith(replaceFrom, from, nodeType.create({ title: noteTitle }))
      );
    } else {
      // Fallback: insert as plain text if node not yet registered
      view.dispatch(
        view.state.tr.replaceWith(replaceFrom, from,
          view.state.schema.text(`[[${noteTitle}]]`))
      );
    }
  });
  editor.action(ctx => ctx.get(MB.editorViewCtx).focus());
};
```

- [ ] **Step 4: Rewrite insertTag to use Milkdown transaction**

Replace `insertTag`:

```javascript
const insertTag = (tagName) => {
  const editor = milkdownEditorRef.current;
  if (!editor) return;
  const MB = window.MilkdownBundle;
  setTagDropdown(null);

  editor.action(ctx => {
    const view = ctx.get(MB.editorViewCtx);
    const { from } = view.state.selection;
    const textBefore = view.state.doc.textBetween(0, from, '\n', '\0');
    const tagMatch = textBefore.match(/#([a-zA-Z0-9_À-ɏ]*)$/);
    if (!tagMatch) return;
    const replaceFrom = from - tagMatch[0].length;
    view.dispatch(
      view.state.tr.insertText(`#${tagName} `, replaceFrom, from)
    );
  });
  editor.action(ctx => ctx.get(MB.editorViewCtx).focus());

  // Re-run tag extraction on updated content
  setTimeout(() => {
    if (milkdownEditorRef.current) {
      milkdownEditorRef.current.action(ctx => {
        const view = ctx.get(window.MilkdownBundle.editorViewCtx);
        const serializer = ctx.get(window.MilkdownBundle.serializerCtx);
        const md = serializer(view.state.doc);
        handleEditorChange(md);
      });
    }
  }, 0);
};
```

- [ ] **Step 5: Add keyboard navigation handler for dropdowns**

The existing `handleContentKeyDown` managed dropdown keyboard nav (ArrowUp/Down/Enter/Escape) and Enter list continuation. With Milkdown:
- **List continuation** — handled natively by Milkdown GFM preset (no code needed)
- **Dropdown nav** — attach a `keydown` listener on the editor container div

Add a `useEffect` inside `NoteEditModal` (near other effects):

```javascript
React.useEffect(() => {
  const container = milkdownEditorRef.current
    ? document.querySelector('.milkdown-editor .ProseMirror')
    : null;
  if (!container) return;

  const onKeyDown = (e) => {
    if (tagDropdown) {
      if (e.key === 'Escape') { setTagDropdown(null); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (tagDropdown.items[0]) insertTag(tagDropdown.items[0].name);
        return;
      }
    }
    if (wikiDropdown) {
      const total = wikiDropdown.items.length + (wikiDropdown.canCreate ? 1 : 0);
      if (e.key === 'ArrowDown') { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.min(d.activeIdx + 1, total - 1) })); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.max(d.activeIdx - 1, 0) })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (wikiDropdown.activeIdx < wikiDropdown.items.length) {
          insertWikilink(wikiDropdown.items[wikiDropdown.activeIdx].title);
        } else if (wikiDropdown.canCreate) {
          createNewNote(wikiDropdown.query.trim());
        }
        return;
      }
      if (e.key === 'Escape') { setWikiDropdown(null); return; }
    }
  };

  container.addEventListener('keydown', onKeyDown, true);
  return () => container.removeEventListener('keydown', onKeyDown, true);
}, [tagDropdown, wikiDropdown, insertWikilink, insertTag]);
```

Note: use `[tagDropdown, wikiDropdown, ...]` in deps so the closure captures fresh values.

- [ ] **Step 6: Manual test — autocomplete**

Open a note, type `[[` — verify dropdown appears. Use ArrowDown to navigate, Enter to insert. Type `#` — verify tag dropdown appears. Press Escape — verify dropdowns close.

- [ ] **Step 7: Commit**

```bash
git add static/index.html
git commit -m "feat: adapt wikilink and tag autocomplete to Milkdown ProseMirror"
```

---

## Task 6: Rewire NoteToolbar to Milkdown commands

**Files:**
- Modify: `static/index.html` — `NoteToolbar` function (lines ~7223-7353)

Context: NoteToolbar currently receives `textareaRef`, `value`, `onChange`. After this task it receives `milkdownEditorRef` and `noteId`, `onAttachUploaded` (unchanged).

- [ ] **Step 1: Replace NoteToolbar signature and helpers**

Replace the first lines of `NoteToolbar`:

```javascript
function NoteToolbar({ milkdownEditorRef, noteId, onAttachUploaded }) {
  const [hOpen, setHOpen] = React.useState(false);
  const hRef = React.useRef(null);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const [uploading, setUploading] = React.useState(false);

  // Generic Milkdown command caller
  const cmd = (commandKey, payload) => {
    const editor = milkdownEditorRef?.current;
    if (!editor) return;
    editor.action(window.MilkdownBundle.callCommand(commandKey, payload));
  };

  // Insert raw text at cursor (for wikilink button and attachment syntax)
  const insertText = (text) => {
    const editor = milkdownEditorRef?.current;
    if (!editor) return;
    editor.action(ctx => {
      const view = ctx.get(window.MilkdownBundle.editorViewCtx);
      const { tr, selection } = view.state;
      view.dispatch(tr.insertText(text, selection.from, selection.to));
    });
    editor.action(ctx => ctx.get(window.MilkdownBundle.editorViewCtx).focus());
  };
```

- [ ] **Step 2: Remove old insert/insertLinePrefix helpers**

Delete the entire `insert` function (lines ~7265-7276) and `insertLinePrefix` function (lines ~7278-7290). They are replaced by `cmd` and `insertText` above.

- [ ] **Step 3: Update toolbar button handlers**

Replace each button's `onClick` handler:

**Bold:**
```javascript
onClick={() => cmd(window.MilkdownBundle.toggleStrongCommand.key)}
```

**Italic:**
```javascript
onClick={() => cmd(window.MilkdownBundle.toggleEmphasisCommand.key)}
```

**Inline code `</>`:**
```javascript
onClick={() => cmd(window.MilkdownBundle.toggleInlineCodeCommand.key)}
```

**Heading H1-H6** (inside the headings map, `onMouseDown`):
```javascript
onMouseDown={e => {
  e.preventDefault();
  cmd(window.MilkdownBundle.wrapInHeadingCommand.key, h.level);
  setHOpen(false);
}}
```
The `headings` array stays the same (labels), but `prefix` field is no longer needed — use `h.level` (1-6) as the number.

Update `headings` array to:
```javascript
const headings = [
  { label: "H1", hint: "#",      level: 1 },
  { label: "H2", hint: "##",     level: 2 },
  { label: "H3", hint: "###",    level: 3 },
  { label: "H4", hint: "####",   level: 4 },
  { label: "H5", hint: "#####",  level: 5 },
  { label: "H6", hint: "######", level: 6 },
];
```

**Bullet list ≡:**
```javascript
onClick={() => cmd(window.MilkdownBundle.wrapInBulletListCommand.key)}
```

**Checklist ☑:**
```javascript
// GFM task list — wrapInBulletListCommand then toggle task
// If wrapInTaskListCommand not in bundle, use insertText as fallback
onClick={() => {
  if (window.MilkdownBundle.wrapInTaskListCommand) {
    cmd(window.MilkdownBundle.wrapInTaskListCommand.key);
  } else {
    insertText('- [ ] ');
  }
}}
```

**Blockquote ❝:**
```javascript
onClick={() => cmd(window.MilkdownBundle.wrapInBlockquoteCommand.key)}
```

**Numbered list 1.:**
```javascript
onClick={() => { cmd(window.MilkdownBundle.wrapInOrderedListCommand.key); setMoreOpen(false); }}
```

**Strikethrough S:**
```javascript
onClick={() => { cmd(window.MilkdownBundle.toggleStrikethroughCommand.key); setMoreOpen(false); }}
```

**Table ⊞:**
```javascript
onClick={() => { cmd(window.MilkdownBundle.insertTableCommand.key); setMoreOpen(false); }}
```

**Wikilink `[[]]`:**
```javascript
onClick={() => { insertText('[['); setMoreOpen(false); }}
```

**Horizontal rule `—`:**
```javascript
onClick={() => cmd(window.MilkdownBundle.insertHrCommand.key)}
```

**File attachment 📎** — only change the `insert(syntax, '', '')` call inside `handleAttachFile`:
```javascript
// Replace:  insert(syntax, '', '');
// With:
insertText(syntax);
```

- [ ] **Step 4: Manual test — toolbar commands**

Open a note, select some text, click Bold → verify text becomes bold in editor. Click H2 → verify heading applied. Click bullet list → verify list prefix applied. Click table → verify table inserted. Click attachment icon, upload an image → verify image markdown inserted.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: rewire NoteToolbar to use Milkdown commands"
```

---

## Task 7: Replace textarea with MilkdownEditor + cleanup

**Files:**
- Modify: `static/index.html` — note editor JSX section (~lines 7864-7939), fullscreen overlay (~lines 8204-8233)

- [ ] **Step 1: Remove preview state and tab bar, replace textarea**

In `NoteEditModal`, find the state declaration:
```javascript
const [preview, setPreview] = React.useState(false);
```
Delete this line.

Find the `textareaRef` declaration:
```javascript
const textareaRef = React.useRef(null);
```
Delete this line (or keep as unused — will be cleaned up after verify).

- [ ] **Step 2: Replace tab bar + textarea block**

Find the tab bar block (lines ~7866-7899):
```jsx
<div className="note-tab-bar">
  <div className={`note-tab${!preview ? ' note-tab-active' : ''}`} onClick={() => setPreview(false)}>✏ Tulis</div>
  <div className={`note-tab${preview ? ' note-tab-active' : ''}`} onClick={() => setPreview(true)}>◻ Lihat</div>
  <div className="note-tab" onClick={() => setTextareaFullscreen(true)}>⤢ Expand</div>
</div>
{!preview && <NoteToolbar textareaRef={textareaRef} value={content} onChange={handleContentChange} ... />}
{!preview && (
  <div className="note-word-count">...</div>
)}
{preview ? (
  <div className="note-rendered ...">...</div>
) : (
  <div style={{ position: 'relative' }}>
    <textarea ... />
  </div>
)}
```

Replace with:
```jsx
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
  <NoteToolbar milkdownEditorRef={milkdownEditorRef} noteId={savedNoteId} onAttachUploaded={att => setAttachments(prev => [...prev, att])} />
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <div className="note-word-count" style={{ marginBottom: 0, marginTop: 0 }}>
      <span>{wordCount} kata</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {saving ? <span style={{ color: 'var(--text-light)' }}>Menyimpan...</span> : <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ Tersimpan</span>}
      </span>
    </div>
    <button
      type="button"
      className="note-tab"
      onClick={() => setTextareaFullscreen(true)}
      style={{ margin: 0 }}
    >⤢ Expand</button>
  </div>
</div>
<MilkdownEditor
  value={content}
  onChange={handleEditorChange}
  minHeight={expanded ? (focus ? 'calc(100vh - 180px)' : 'calc(100vh - 320px)') : 120}
  editorRef={milkdownEditorRef}
  onWikilinkClick={title => {
    const target = noteTitles.find(n => n.title === title);
    if (target) onNavigate?.(target);
  }}
/>
```

- [ ] **Step 3: Update fullscreen overlay to use MilkdownEditor**

Find the `textareaFullscreen` overlay (~lines 8204-8233). Replace the `<textarea>` inside it:

```jsx
{textareaFullscreen && (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'var(--bg-primary)',
    display: 'flex', flexDirection: 'column', padding: 16
  }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <button
        onClick={() => setTextareaFullscreen(false)}
        style={{ background: 'none', border: 'none', cursor: 'pointer',
                 fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
        ✕ Tutup
      </button>
    </div>
    <input
      className="note-modal-title-input"
      placeholder="Judul catatan..."
      value={title}
      onChange={e => setTitle(e.target.value)}
      style={{ marginBottom: 8 }}
    />
    <MilkdownEditor
      value={content}
      onChange={handleEditorChange}
      minHeight="calc(100vh - 120px)"
      onWikilinkClick={title => {
        setTextareaFullscreen(false);
        const target = noteTitles.find(n => n.title === title);
        if (target) onNavigate?.(target);
      }}
    />
  </div>
)}
```

Note: the fullscreen overlay uses a separate `MilkdownEditor` instance (no shared `editorRef`). Both instances share `content` state — the external value sync `useEffect` in each instance keeps them consistent when only one is visible at a time.

- [ ] **Step 4: Remove ToC dependency on preview state**

Find this line:
```jsx
{preview && tocItems.length >= 2 && <NoteToc items={tocItems} />}
```
Change to:
```jsx
{tocItems.length >= 2 && <NoteToc items={tocItems} />}
```

ToC is now always visible alongside the editor (the existing layout already positions it to the side).

- [ ] **Step 5: Remove dead code**

Remove:
- `handleContentKeyDown` function (entirely replaced by ProseMirror keydown in Task 5)
- `handlePreviewClick` function (preview mode gone)
- `handleContentChange` function (replaced by `handleEditorChange`)
- `const [preview, setPreview]` state declaration
- `textareaRef` ref declaration

- [ ] **Step 6: Manual test — full flow**

Test these scenarios in order:
1. Open an existing note with `[[wikilink]]`, bullet lists, bold text → verify all render correctly
2. Type new content including `**bold**` → verify renders as bold inline
3. Type `[[` → autocomplete appears → press Enter → wikilink chip inserted
4. Click ⤢ Expand → fullscreen opens with same content → type something → close → verify change persisted
5. Trigger conflict (edit note in two tabs) → verify conflict banner still works
6. Go offline (DevTools → Network → Offline) → edit note → re-enable network → verify autosave queued

- [ ] **Step 7: Bump SW cache version (content changed)**

In `static/sw.js`, bump:
```javascript
const CACHE = "taskflow-v35-milkdown-ui";
```

- [ ] **Step 8: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat: replace textarea with MilkdownEditor WYSIWYG in note modal"
```

---

## Task 8: Style polish + edge case fixes

**Files:**
- Modify: `static/index.html` — CSS style block + minor JSX fixes

- [ ] **Step 1: Scope Milkdown styles to avoid global bleed**

In the `<style>` block, verify these styles don't override global elements. If `h1, h2, p` etc. inside `.milkdown-editor .ProseMirror` conflict with existing app styles, add the `.milkdown-editor .ProseMirror` scope prefix:

```css
.milkdown-editor .ProseMirror h1 { font-size: 1.6em; font-weight: 700; margin: 0.5em 0; }
.milkdown-editor .ProseMirror h2 { font-size: 1.3em; font-weight: 700; margin: 0.5em 0; }
.milkdown-editor .ProseMirror h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0; }
.milkdown-editor .ProseMirror ul  { list-style: disc; padding-left: 1.5em; margin: 0.3em 0; }
.milkdown-editor .ProseMirror ol  { list-style: decimal; padding-left: 1.5em; margin: 0.3em 0; }
.milkdown-editor .ProseMirror li  { margin: 0.1em 0; }
.milkdown-editor .ProseMirror blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 12px;
  color: var(--text-secondary);
  margin: 0.5em 0;
}
.milkdown-editor .ProseMirror code {
  background: var(--bg-secondary);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: monospace;
  font-size: 0.9em;
}
.milkdown-editor .ProseMirror pre {
  background: var(--bg-secondary);
  padding: 10px 14px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.5em 0;
}
.milkdown-editor .ProseMirror hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1em 0;
}
.milkdown-editor .ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.5em 0;
}
.milkdown-editor .ProseMirror th,
.milkdown-editor .ProseMirror td {
  border: 1px solid var(--border);
  padding: 4px 8px;
  font-size: 0.9em;
}
.milkdown-editor .ProseMirror input[type="checkbox"] {
  margin-right: 6px;
  accent-color: var(--accent);
}
/* Dark mode — Milkdown adds .milkdown class on root */
[data-theme="dark"] .milkdown-editor .ProseMirror {
  color: var(--text-primary);
}
```

- [ ] **Step 2: Verify dark mode**

Toggle dark mode in the app. Verify the editor text and wikilink chips are readable. If wikilink `color-mix` isn't supported in the target browser, replace with:
```css
background: rgba(var(--accent-rgb, 99, 102, 241), 0.1);
```
(requires defining `--accent-rgb` CSS variable if not already present).

- [ ] **Step 3: Verify note list preview, print, export unchanged**

1. Open note list → verify note preview cards still render markdown correctly (they use `marked.js`, not Milkdown)
2. Open a note panel → click Print → verify print layout renders markdown
3. Go to Settings → Backup & Export → download → open the backup JSON → verify note content is raw markdown (no HTML artifacts)

- [ ] **Step 4: Final commit**

```bash
git add static/index.html
git commit -m "style: scope Milkdown CSS, verify dark mode and static rendering"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in task |
|---|---|
| Pre-bundle with esbuild → `static/vendor/milkdown.bundle.js` | Task 1 |
| SW cache for offline | Task 2 |
| `MilkdownEditor` component with mount/onChange/external-sync/destroy | Task 3 |
| Tab bar removed, "⤢ Expand" kept | Task 7 step 2 |
| NoteToolbar rewired to commands | Task 6 |
| Wikilink ProseMirror node + remark plugin + input rule | Task 4 |
| Wikilink autocomplete (detect `[[`, position via coordsAtPos, insert node) | Task 5 |
| Tag autocomplete adapted | Task 5 |
| Keyboard nav for dropdowns | Task 5 step 5 |
| Fullscreen overlay with MilkdownEditor | Task 7 step 3 |
| `marked.js` retained for non-editor rendering | Task 8 step 3 (verify) |
| Offline behavior (SW cache) | Task 2 |

**No placeholders found.** All code blocks are complete. Method names match across tasks (`handleEditorChange` defined in Task 5, used in Task 7; `milkdownEditorRef` defined in Task 5, used in Tasks 6 and 7).

**Scope:** 8 tasks producing working, testable increments.
