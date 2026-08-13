# Note Editor — Always Expanded (Default Fullscreen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove compact/modal mode from both note editors. Editor always opens fullscreen with Expand (lengkap) as default, Focus (minimal) as toggle.

**Architecture:** Two components changed in `static/index.html`: NoteModal (line ~15207) and TaskFormModal note tab (line ~3635). Both lose their compact/inline rendering path and always render fullscreen. A new `focusMode` / `noteFocusMode` boolean controls whether non-editor sections (TOC, drawing, attachments, tasks, backlinks, save button) are visible.

**Tech Stack:** Vanilla React JSX (pre-compiled), inline styling, Milkdown editor

## Global Constraints

- All changes in `static/index.html` only
- No backend, SW, CSS file changes
- `noteDrawFullscreen` / `drawFullscreen` (drawing fullscreen) remain independent — untouched
- Safe-area insets must remain functional
- Z-index: Expand default 1000, any overlays above that
- Wikilink/tasklink autocomplete must still work in both modes

---

### Task 1: NoteModal — Replace expanded + textareaFullscreen with focusMode

**Files:**
- Modify: `static/index.html` (lines ~15250, ~15460, ~16214, ~16216, ~16314)

**Interfaces:**
- Produces: `const [focusMode, setFocusMode] = useState(false)` — `false` = Expand (default, fullscreen lengkap), `true` = Focus (fullscreen minimal: header + title + toolbar + editor only)

- [ ] **Step 1: Remove `expanded` state and add `focusMode`**

Find the NoteModal function (line ~15207). Replace the `expanded` state declaration at line ~15250:

```js
// REMOVE this line (~15250):
const [expanded, setExpanded] = useState(false);

// ADD in its place:
const [focusMode, setFocusMode] = useState(false);
```

- [ ] **Step 2: Remove `textareaFullscreen` state**

At line ~15460, remove the entire line:

```js
// REMOVE:
const [textareaFullscreen, setTextareaFullscreen] = React.useState(false);
```

- [ ] **Step 3: Update all references from `expanded` → `!focusMode`**

Find and replace these three references in NoteModal's `topFixed` and `inner`:

**Line ~16214** — `autoFocus`:
```js
// BEFORE:
autoFocus: !expanded,

// AFTER:
autoFocus: !focusMode,
```

**Line ~16216** — `fontSize`:
```js
// BEFORE:
fontSize: expanded ? 22 : undefined

// AFTER:
fontSize: !focusMode ? 22 : undefined
```

**Line ~16314** — `minHeight`:
```js
// BEFORE:
minHeight: expanded ? 'calc(100vh - 320px)' : 120,

// AFTER:
minHeight: focusMode ? 'calc(100vh - 100px)' : 'calc(100vh - 320px)',
```

- [ ] **Step 4: Verify no remaining `expanded` or `setExpanded` references in NoteModal**

Search within NoteModal (lines ~15207–17303) for any remaining `expanded` or `setExpanded` or `textareaFullscreen` or `setTextareaFullscreen` references. All should be removed or replaced.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "refactor(NoteModal): replace expanded+textareaFullscreen with focusMode state"
```

---

### Task 2: NoteModal — Always render fullscreen, remove compact modal

**Files:**
- Modify: `static/index.html` (lines ~16888–17303)

**Interfaces:**
- Consumes: `focusMode` from Task 1
- Produces: NoteModal always renders fullscreen panel; `focusMode` toggles section visibility in `inner`

- [ ] **Step 1: Update header Focus button to toggle focusMode**

At line ~16888, change the Focus button from setting `textareaFullscreen` to toggling `focusMode`:

```js
// BEFORE (line ~16888):
onClick: () => setTextareaFullscreen(true),
title: "Focus — editor fullscreen",
// ... button shows "● Focus" always

// AFTER — show "● Focus" when NOT in focus, "⤢ Expand" when in focus:
onClick: () => setFocusMode(f => !f),
title: focusMode ? "Expand — tampilkan semua" : "Focus — editor fullscreen",
// ... button label:
focusMode
  ? React.createElement(React.Fragment, null,
      React.createElement("span", { className: "note-hdr-icon" }, "⤢ "), "Expand")
  : React.createElement(React.Fragment, null,
      React.createElement("span", { className: "note-hdr-icon" }, "● "), "Focus")
```

- [ ] **Step 2: Remove the old Expand/Compact toggle button**

At lines ~16904–16921, remove the entire Expand/Compact button element (the one with `onClick: () => setExpanded(e => !e)` and `expanded ? "Compact" : "Expand"` labels). This button is no longer needed since Expand is now the only default.

- [ ] **Step 3: Remove the `if (expanded)` conditional — always render fullscreen panel**

At line ~17013, the code has:
```js
// ── Expanded: full-screen panel ───────────────────────────────
if (expanded) {
  return React.createElement("div", { style: { position: "fixed", inset: 0, ... } }, header, topFixed, inner);
}

// ── Compact: modal ────────────────────────────────────────────
return React.createElement(React.Fragment, null, ...);
```

**Change:** Remove the `if (expanded)` wrapper. Always return the fullscreen panel. Delete the compact modal return entirely.

```js
// ── Always full-screen panel ──────────────────────────────────
return React.createElement("div", {
  style: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-card)",
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    padding: "24px 32px"
  }
}, header, topFixed, React.createElement("div", {
  style: {
    flex: 1,
    overflowY: "auto",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 14
  }
}, inner));
```

The entire "Compact: modal" section (lines ~17036–17302, which includes the `textareaFullscreen` overlay Fragment and the `ReactDOM.createPortal` with `note-modal-overlay`) must be removed.

- [ ] **Step 4: Wrap non-editor sections in `inner` with `!focusMode` guard**

In the `inner` content, wrap sections that should be hidden during Focus mode with `!focusMode && (...)`:

1. **TOC** (line ~16515): `tocItems.length >= 2 && React.createElement(NoteToc, ...)` → wrap with `!focusMode && tocItems.length >= 2 && ...`
2. **Tags display** (line ~16517): `tags.length > 0 && ...` → wrap with `!focusMode && tags.length > 0 && ...`
3. **Tag suggestions** (line ~16535): `tagSuggestions.length > 0 && ...` → wrap with `!focusMode && tagSuggestions.length > 0 && ...`
4. **Drawing/Canvas** (line ~16568): `!drawFullscreen && React.createElement("button", ...)` → wrap with `!focusMode && !drawFullscreen && ...`
5. **Drawing fullscreen block** (line ~16568+): the `drawFullscreen && ...` block → wrap with `!focusMode && drawFullscreen && ...`
6. **Attachments** (line ~16695): `attachments.length > 0 && ...` → wrap with `!focusMode && attachments.length > 0 && ...`
7. **Linked tasks** (line ~16747): `linkedTaskIds.length > 0 && ...` → wrap with `!focusMode && linkedTaskIds.length > 0 && ...`
8. **Backlinks** (line ~16794): `backlinks.length > 0 && ...` → wrap with `!focusMode && backlinks.length > 0 && ...`
9. **Save button footer** (line ~16817): `React.createElement("div", { className: "note-mobile-footer", ...` → wrap with `!focusMode && ...`

The editor and its dropdowns (AI, task, wikilink) remain visible in both modes.

- [ ] **Step 5: Verify the overall structure compiles and has no orphaned references**

Check that:
- No remaining `expanded`, `setExpanded`, `textareaFullscreen`, `setTextareaFullscreen` in NoteModal
- No remaining `note-modal-overlay`, `note-modal-box`, `note-modal-scroll-area` references (these were only used in the compact modal)
- The `header`, `topFixed`, `inner` variables are all defined before the return statement

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(NoteModal): always render fullscreen, remove compact modal — focusMode toggles sections"
```

---

### Task 3: TaskFormModal note tab — Replace noteTextareaFullscreen with noteFocusMode

**Files:**
- Modify: `static/index.html` (line ~2821)

**Interfaces:**
- Produces: `const [noteFocusMode, setNoteFocusMode] = React.useState(false)` — `false` = Expand (default), `true` = Focus

- [ ] **Step 1: Rename state variable**

In TaskFormModal (function starts at line ~2673), find line ~2821:

```js
// BEFORE:
const [noteTextareaFullscreen, setNoteTextareaFullscreen] = React.useState(false);

// AFTER:
const [noteFocusMode, setNoteFocusMode] = React.useState(false);
```

- [ ] **Step 2: Update all references to the old variable name**

Search within TaskFormModal (lines ~2673–4553) for all `noteTextareaFullscreen` and `setNoteTextareaFullscreen` references and replace:

- `noteTextareaFullscreen` → `noteFocusMode`
- `setNoteTextareaFullscreen(v)` → `setNoteFocusMode(v)`

These appear at lines ~3679, ~3689, ~3698, ~3708, ~3732–3734, ~3740 (approximately 6-7 sites).

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "refactor(TaskFormModal): rename noteTextareaFullscreen to noteFocusMode"
```

---

### Task 4: TaskFormModal note tab — Fullscreen when mode is note

**Files:**
- Modify: `static/index.html` (lines ~3415, ~3635–4060)

**Interfaces:**
- Consumes: `noteFocusMode` from Task 3, `mode` state, `onClose` prop
- Produces: When `mode === "note"`, early-return fullscreen note editor instead of rendering inside modal

- [ ] **Step 1: Add early return before the modal render**

At the start of TaskFormModal's return statement (line ~3415), add an early return for note mode:

```js
// ADD before the main return (line ~3415):
if (mode === "note") {
  return React.createElement(React.Fragment, null,
    // Fullscreen note editor (see Step 2 for full rendering)
  );
}
```

- [ ] **Step 2: Build the fullscreen note editor rendering**

The fullscreen note editor reuses the existing note form JSX (currently inside the modal at lines ~3635–4060) but wraps it in a fullscreen container with a header. The structure:

```js
if (mode === "note") {
  return React.createElement(React.Fragment, null,
    // Fullscreen overlay
    React.createElement("div", {
      style: {
        position: "fixed",
        inset: 0,
        background: "var(--bg-card)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        padding: "calc(24px + env(safe-area-inset-top, 0px)) calc(32px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(32px + env(safe-area-inset-left, 0px))"
      }
    },
      // Header bar
      React.createElement("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          flexShrink: 0
        }
      },
        React.createElement("div", {
          style: { fontSize: 13, fontWeight: 700, color: "var(--accent)" }
        }, "📝 Catatan Baru"),
        React.createElement("div", {
          style: { display: "flex", gap: 6, alignItems: "center" }
        },
          // Focus/Expand toggle button
          React.createElement("button", {
            type: "button",
            onClick: () => setNoteFocusMode(f => !f),
            title: noteFocusMode ? "Expand — tampilkan semua" : "Focus — editor fullscreen",
            style: {
              background: "none",
              border: "1.5px solid var(--accent)",
              borderRadius: 20,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--accent)",
              fontWeight: 700,
              padding: "2px 10px",
              lineHeight: 1.5
            }
          }, noteFocusMode
            ? React.createElement(React.Fragment, null,
                React.createElement("span", { className: "note-hdr-icon" }, "⤢ "), "Expand")
            : React.createElement(React.Fragment, null,
                React.createElement("span", { className: "note-hdr-icon" }, "● "), "Focus")
          ),
          // Close button
          React.createElement("button", {
            type: "button",
            onClick: onClose,
            style: {
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: 20,
              cursor: "pointer",
              lineHeight: 1
            }
          }, "✕")
        )
      ),

      // Top area: title input
      React.createElement("div", {
        style: {
          flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 10,
          marginBottom: 6
        }
      },
        React.createElement("input", {
          className: "input",
          value: noteForm.title,
          onChange: e => { setNote("title", e.target.value); setTitleManuallyEdited(true); },
          placeholder: "Judul catatan...",
          autoFocus: true,
          style: { marginBottom: 0, fontSize: 22 }
        })
      ),

      // Scrollable content area
      React.createElement("div", {
        style: {
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 14
        }
      },
        // Toolbar + Editor
        React.createElement(React.Fragment, null,
          React.createElement("div", {
            style: { marginBottom: 4, flexShrink: 0 }
          },
            React.createElement(NoteToolbar, {
              milkdownEditorRef: noteMilkdownRef,
              noteId: null,
              onAttachUploaded: function() {},
              content: noteForm.content,
              onApplyTemplate: function(tpl) { return setNote("content", tpl); },
              onInsertTask: openNoteTaskDropdown,
              voiceState: noteVoiceState,
              onToggleVoice: handleToggleNoteVoice
            })
          ),
          React.createElement("div", {
            style: { position: "relative", flex: 1, overflow: "auto", minHeight: 0 }
          },
            React.createElement(MilkdownEditor, {
              value: noteForm.content,
              onChange: handleNoteContentChange,
              editorRef: noteMilkdownRef,
              minHeight: noteFocusMode ? "calc(100vh - 100px)" : "calc(100vh - 320px)",
              onWikilinkClick: function() {},
              tasksGetter: noteTasksGetterRef.current,
              onTasklinkClick: function() {},
              onImagePaste: null
            }),
            // Note tag dropdown (unchanged — same as existing)
            noteTagDropdown && noteTagDropdown.items.length > 0 && React.createElement("div", {
              className: "wiki-autocomplete",
              style: { position: "fixed", top: noteTagDropdown.top, left: noteTagDropdown.left, zIndex: 1070 }
            }, /* ... same as existing ... */),
            // Note wiki dropdown (unchanged)
            // Note task dropdown (unchanged)
            // Note AI dropdown (unchanged)
          )
        ),

        // Below sections — hidden in Focus mode
        !noteFocusMode && React.createElement(React.Fragment, null,
          // Detected tags (unchanged from existing ~line 3917)
          detectedTags.length > 0 && /* ... same as existing ... */,

          // Canvas/Drawing section (unchanged from existing ~line 3945)
          !noteDrawFullscreen && /* Canvas toggle button ... */,
          /* Canvas iframe container ... */,

          // Batal / Simpan buttons (unchanged from existing ~line 4050)
          React.createElement("div", {
            style: { display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }
          },
            React.createElement("button", {
              type: "button",
              className: "btn btn-secondary",
              onClick: onClose
            }, "Batal"),
            React.createElement("button", {
              type: "submit",
              className: "btn btn-primary",
              disabled: loading,
              onClick: handleSubmit
            }, loading ? "Menyimpan..." : "Simpan Note")
          )
        )
      )
    )
  );
}
```

**Important implementation notes:**
- Copy the EXACT existing JSX from the old rendering. Source locations:
  - NoteToolbar + MilkdownEditor + noteTagDropdown: lines ~3720–3899
  - noteTaskDropdown (with keyboard handlers): lines ~3750–3866
  - noteWikiDropdown: lines ~3867–3899
  - noteAiDropdown: lines ~3900–3917
  - Detected tags: lines ~3917–3940
  - Canvas/drawing section: lines ~3945–4036
  - Batal/Simpan buttons: lines ~4050–4059
- Do not rewrite from scratch — copy verbatim and wrap conditionally
- The `handleSubmit` reference in the save button will call the existing handler which checks `mode === "note"` and saves accordingly — no change needed.
- **After copying**, the `minHeight` prop on MilkdownEditor should use `noteFocusMode` conditional: `minHeight: noteFocusMode ? 'calc(100vh - 100px)' : 'calc(100vh - 320px)'`
- **After copying**, the `style` on the editor container div should use fullscreen styles: `flex: 1, overflow: 'auto', minHeight: 0` (not the old `noteTextareaFullscreen ? ... : ...` ternary)

- [ ] **Step 3: Remove the old inline note tab rendering**

After adding the early return, remove the old `mode === "note" && (() => { ... })()` block at lines ~3635–4060. The entire IIFE from `mode === "note" && (() => {` to the closing `})()` should be deleted, since the note editor now renders via the early return path.

- [ ] **Step 4: Update the "Batal" button in the fullscreen editor**

The "Batal" button already calls `onClose` (same as before), which sets `showForm(false)` and returns to the dashboard. No change needed — just verify the reference is correct.

- [ ] **Step 5: Verify console/compile errors**

After all changes, verify there are no:
- Undefined variable references
- Missing closing brackets/parens in JSX
- References to removed variables (`noteTextareaFullscreen`, `setNoteTextareaFullscreen`)

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(TaskFormModal): note tab always fullscreen with focusMode toggle"
```

---

### Verification Checklist

After all tasks are complete, manually verify:

1. **Open existing note** → should open fullscreen expanded (not modal)
2. **Click "Focus"** → should hide TOC/drawing/attachments/tasks/backlinks/save, keep header+title+toolbar+editor
3. **Click "Expand"** (in Focus mode) → should show all sections again
4. **Create new note** (Buat Baru → Note tab) → should open fullscreen immediately
5. **Focus toggle in new note** → should hide canvas/save/tags, keep title+toolbar+editor
6. **Wikilink `[[` autocomplete** → should work in both Expand and Focus modes
7. **Drawing fullscreen toggle** → should still work independently
8. **Mobile safe-area** → fullscreen should respect safe-area-inset-*
9. **Close button** → should return to dashboard / note list
10. **No console errors** in browser DevTools
