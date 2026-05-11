# Milkdown WYSIWYG Editor — Design Spec

**Date:** 2026-05-11  
**Status:** Approved  
**Scope:** Replace plain textarea in note modal with Milkdown WYSIWYG inline editor

---

## 1. Overview

Replace the current split-tab editor (textarea "Tulis" ↔ rendered "Lihat") with a single WYSIWYG inline editor powered by Milkdown. Markdown syntax renders immediately as the user types — `**tebal**` becomes **bold** without switching tabs.

`marked.js` is retained for static rendering outside the editor (note list preview, print, export).

---

## 2. Bundle Strategy

Build a pre-bundled IIFE file using `esbuild` — done once by the developer, committed to the repo.

**Packages to bundle:**
- `@milkdown/core`
- `@milkdown/preset-commonmark`
- `@milkdown/plugin-listener`
- `@milkdown/plugin-history`

**Output:** `static/vendor/milkdown.bundle.js`  
**Global:** `window.MilkdownBundle` exposes `{ Editor, commonmark, listener, history, callCommand, ... }`

**Service Worker:** Add `milkdown.bundle.js` to the SW cache list in `sw.js` alongside other vendor files. SW cache version must be bumped on each update.

**Build command (run once locally):**
```bash
npx esbuild src/milkdown-bundle-entry.js \
  --bundle --format=iife --global-name=MilkdownBundle \
  --minify --outfile=static/vendor/milkdown.bundle.js
```

Entry file `src/milkdown-bundle-entry.js` re-exports all needed symbols from the four packages.

---

## 3. Component Architecture

### `MilkdownEditor` React Component

Replaces `<textarea>` in the note modal. Props:

| Prop | Type | Description |
|---|---|---|
| `value` | string | Current markdown content (controlled) |
| `onChange` | fn(string) | Called with new markdown string on every edit |
| `disabled` | bool | Read-only mode |
| `minHeight` | string/number | CSS min-height for the editor container |

**Lifecycle:**
- **Mount:** Initialize Milkdown editor in a `div` ref. Load `commonmark` preset + `listener` + `history` + wikilink plugin. Set initial content from `value` prop.
- **onChange sync:** `listener` plugin fires on every doc change → serialize to markdown string → call `props.onChange(markdownString)`. React `content` state stays as raw markdown; backend API is unchanged.
- **External value sync:** When `value` changes from outside (conflict resolution, note switch), call Milkdown's `replaceAll` command to reset editor content. Guard with a flag to prevent re-entrant onChange loop.
- **Unmount:** Call `editor.destroy()` to clean up ProseMirror DOM and listeners.

### Tab Bar Changes

Remove "✏ Tulis" and "◻ Lihat" tabs. Keep "⤢ Expand" for fullscreen. The tab bar becomes a single-item bar or is removed entirely in favor of just the expand button inline with the toolbar.

### NoteToolbar Rewiring

Keep existing `NoteToolbar` UI unchanged. Replace textarea string-manipulation functions with Milkdown command calls:

| Button | Current | New |
|---|---|---|
| Bold | `insert("**","**")` | `callCommand(toggleBold)` |
| Italic | `insert("*","*")` | `callCommand(toggleItalic)` |
| Code (inline) | `insert("\`","\`")` | `callCommand(toggleInlineCode)` |
| H1–H6 | `insertLinePrefix("# ")` | `callCommand(wrapInHeading, level)` |
| Bullet list | `insertLinePrefix("- ")` | `callCommand(wrapInBulletList)` |
| Checklist | `insertLinePrefix("- [ ] ")` | `callCommand(wrapInTaskList)` |
| Blockquote | `insertLinePrefix("> ")` | `callCommand(wrapInBlockquote)` |
| Numbered list | `insertLinePrefix("1. ")` | `callCommand(wrapInOrderedList)` |
| Strikethrough | `insert("~~","~~")` | `callCommand(toggleStrikethrough)` |
| Table | raw string insert | `callCommand(insertTable)` |
| Wikilink `[[]]` | `insert("[[","]]")` | insert wikilink node via command |
| HR `—` | raw string insert | `callCommand(insertHr)` |

NoteToolbar receives an `editorRef` (ref to the Milkdown editor instance) instead of `textareaRef`.

---

## 4. Wikilink Plugin

Custom plugin built as a Milkdown plugin factory. The most complex part of this implementation.

### 4.1 ProseMirror Schema Node

```
node: wikilink
  attrs: { title: string }
  inline: true
  group: "inline"
  atom: true  (non-editable as a unit, selected/deleted as whole)
```

**DOM render:** `<span class="wikilink-node" data-title="NoteTitle">[[NoteTitle]]</span>`  
Styled as a blue/accent-colored chip. Clickable to navigate to the linked note.

### 4.2 Input Rule

Pattern: `/\[\[([^\[\]]+)\]\]/`  
When user completes `[[NoteTitle]]` (types the closing `]]`), the input rule fires and replaces the typed text with a `wikilink` node. Works for pasted markdown too.

### 4.3 Autocomplete Integration

Reuse existing `wikiDropdown` React state and dropdown UI.

**Trigger:** Plugin adds a `keyup` listener on the editor DOM. Detects `[[` prefix at cursor position by reading text content from the current ProseMirror `TextSelection`.

**Dropdown position:** Calculated using `view.coordsAtPos(cursorPos)` — same precision as the current textarea-based approach.

**On selection:** Plugin exposes a command `insertWikilinkNode(title)` — called from the existing `insertWikilink` handler. Replaces the typed `[[query` text with a wikilink node.

**On Escape / click outside:** Close dropdown, leave typed text as-is.

### 4.4 Serializer (Markdown Output)

When Milkdown serializes the document back to markdown string, wikilink nodes output `[[NoteTitle]]`. This ensures `content` in React state and data stored in the backend remain standard markdown — backward compatible with existing notes and the Obsidian export feature.

### 4.5 Backward Compatibility

Notes already containing `[[NoteTitle]]` syntax load correctly — the input rule (or a parse rule) converts them to wikilink nodes on editor initialization.

---

## 5. Tag Autocomplete

Tag autocomplete (`#tagname` dropdown) currently works by detecting `#` in the textarea value. With Milkdown, detection moves to a `keyup` listener on the editor DOM, reading the current word at cursor from ProseMirror's `TextSelection`. The dropdown UI and positioning logic are reused unchanged.

---

## 6. Offline Behavior

No regression. Milkdown is pure client-side — no network calls for editing operations. Once `milkdown.bundle.js` is cached by the service worker, the WYSIWYG editor works fully offline. Existing online-dependent features (autosave API, wikilink note-list fetch) are unchanged.

---

## 7. What Is NOT Changed

- Backend API — `content` field remains raw markdown string
- `marked.js` — retained for note list preview, print, export
- Autosave polling logic
- Conflict banner (external editor detection)
- File attachment upload
- Note ToC (`NoteToc` component) — reads markdown string, no change needed
- Fullscreen expand mode (layout only, editor swaps in same container)

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Milkdown serializer markdown output differs slightly from input (e.g. extra newlines) | Test round-trip on existing notes before ship; adjust serializer options |
| Wikilink input rule fires mid-word unexpectedly | Anchor pattern strictly to `[[...]]` complete form only |
| NoteToolbar commands not available before editor is mounted | Disable toolbar until `editorReady` state is true |
| Bundle size too large for mobile on slow connection | Already cached by SW after first load; add `loading` indicator during first-load |
| Milkdown version breaking changes | Pin exact version in package.json; re-bundle only on explicit upgrade |
