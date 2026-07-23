# Note Tab Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tab bar to note viewer (`.notes-right`) so users can open up to 5 notes simultaneously in tabs, desktop only.

**Architecture:** `panelNote` (single object) → `openTabs` (array, max 5) + `activeTabId`. All panelNote readers derive from `getActiveNote()`. All panelNote setters go through `openTab(note)` helper. NotePanel, navTrail, modal edit, and autosave are untouched.

**Tech Stack:** React (in-browser JSX via Babel pre-compile), vanilla CSS, single file `static/index.html`

**Source Spec:** `docs/superpowers/specs/2026-07-23-note-tab-viewer-design.md`

## Global Constraints

- Desktop only — tab bar hidden on `@media (max-width: 767px)` via conditional display
- Max 5 tabs — evict oldest (index 0) when full
- Duplicate prevention — if note already in openTabs, switch to it
- No persistence — page navigation resets state
- NotePanel component unchanged — props remain identical
- navTrail unchanged — stays per-active-tab context
- New CSS class prefix: `.note-tab-*` (avoid conflict with existing `.note-tab`)

---

### Task 1: Add state variables and helper functions

**Files:**
- Modify: `static/index.html` — near line 18523

**Interfaces:**
- Produces: `const [openTabs, setOpenTabs] = useState([])`, `const [activeTabId, setActiveTabId] = useState(null)`, `getActiveNote()`, `openTab(note)`, `closeTab(noteId)`

- [ ] **Step 1: Add state declarations**

Replace line 18523:
```js
const [panelNote, setPanelNote] = useState(null);
```

With the following block (insert after line 18523, keep panelNote for now — removed in Task 5):
```js
const [panelNote, setPanelNote] = useState(null);
const [openTabs, setOpenTabs] = useState([]);   // max 5
const [activeTabId, setActiveTabId] = useState(null);

// Helper: derive active note from tabs
const getActiveNote = () => {
  if (!activeTabId) return null;
  const fromTabs = openTabs.find(t => t.id === activeTabId);
  if (fromTabs) return fromTabs;
  // fallback: find from allNotes (for cross-page open)
  return allNotes.find(n => n.id === activeTabId) || null;
};

// Helper: open a note in a tab (or switch if already open)
const openTab = (note) => {
  if (!note?.id) return;
  setOpenTabs(prev => {
    const exists = prev.findIndex(t => t.id === note.id);
    if (exists >= 0) {
      // Already open — just switch
      setActiveTabId(note.id);
      return prev;
    }
    if (prev.length >= 5) {
      // Evict oldest (index 0), push new
      const next = [...prev.slice(1), note];
      setActiveTabId(note.id);
      return next;
    }
    setActiveTabId(note.id);
    return [...prev, note];
  });
  setNavTrail([note]);
};

// Helper: close a tab by note id
const closeTab = (noteId) => {
  setOpenTabs(prev => {
    const idx = prev.findIndex(t => t.id === noteId);
    if (idx === -1) return prev;
    const next = prev.filter(t => t.id !== noteId);
    if (activeTabId === noteId) {
      // Switch to neighbor
      if (idx < next.length) setActiveTabId(next[idx]?.id || null);
      else if (next.length > 0) setActiveTabId(next[next.length - 1]?.id || null);
      else setActiveTabId(null);
    }
    return next;
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat(notes): add openTabs state + openTab/closeTab helpers"
```

---

### Task 2: Replace all setPanelNote calls with openTab

**Files:**
- Modify: `static/index.html` — ~6 call sites

**Interfaces:**
- Consumes: `openTab(note)` from Task 1
- Produces: All note-opening paths use tab system

- [ ] **Step 1: Replace `openNoteById` (line ~18653)**

Find:
```js
setPanelNote(note);
setNavTrail(t => {
  const idx = t.findIndex(x => x.id === note.id);
  return idx >= 0 ? [...t.slice(0, idx), note] : [...t.slice(-7), note];
});
```

Replace with:
```js
openTab(note);
```

- [ ] **Step 2: Replace pinned note click (line ~19156)**

Find:
```js
setPanelNote(n);
setNavTrail([n]);
```

Replace with:
```js
openTab(n);
```

- [ ] **Step 3: Replace note list click (line ~19230)**

Find:
```js
setPanelNote(n);
setNavTrail([n]);
```

Replace with:
```js
openTab(n);
```

- [ ] **Step 4: Replace NotePanel `onNavigate` prop (line ~19355-19361)**

Find:
```js
onNavigate: async n => {
  const full = allNotes.find(x => x.id === n.id) || (await api.get(`/api/scratchpad/${n.id}`).catch(() => n));
  setPanelNote(full);
  setNavTrail(t => {
    const idx = t.findIndex(x => x.id === full.id);
    return idx >= 0 ? [...t.slice(0, idx), full] : [...t.slice(-7), full];
  });
},
```

Replace with:
```js
onNavigate: async n => {
  const full = allNotes.find(x => x.id === n.id) || (await api.get(`/api/scratchpad/${n.id}`).catch(() => n));
  openTab(full);
},
```

- [ ] **Step 5: Replace NotePanel `onTrailClick` prop (line ~19363-19367)**

Find:
```js
onTrailClick: n => {
  const idx = navTrail.findIndex(x => x.id === n.id);
  const full = allNotes.find(x => x.id === n.id) || n;
  setPanelNote(full);
  setNavTrail(idx >= 0 ? navTrail.slice(0, idx + 1) : navTrail);
},
```

Replace with:
```js
onTrailClick: n => {
  const idx = navTrail.findIndex(x => x.id === n.id);
  const full = allNotes.find(x => x.id === n.id) || n;
  setActiveTabId(full.id);
  setNavTrail(idx >= 0 ? navTrail.slice(0, idx + 1) : navTrail);
},
```

- [ ] **Step 6: Replace NotePanel `onNavigateFrom` prop (line ~19369-19372)**

Find:
```js
onNavigateFrom: (child, parentIdx) => {
  const full = allNotes.find(x => x.id === child.id) || child;
  setPanelNote(full);
  setNavTrail(t => t.slice(0, parentIdx + 1).concat([full]));
}
```

Replace with:
```js
onNavigateFrom: (child, parentIdx) => {
  const full = allNotes.find(x => x.id === child.id) || child;
  setActiveTabId(full.id);
  setNavTrail(t => t.slice(0, parentIdx + 1).concat([full]));
}
```

- [ ] **Step 7: Replace taskUpdated handler (line ~18631)**

Find:
```js
setPanelNote(updated);
```

Replace with:
```js
setOpenTabs(prev => prev.map(t => t.id === updated.id ? updated : t));
```

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat(notes): route all note-open paths through openTab helper"
```

---

### Task 3: Replace all panelNote reads with tab equivalents

**Files:**
- Modify: `static/index.html` — ~8 read sites

**Interfaces:**
- Consumes: `getActiveNote()`, `openTabs`, `activeTabId` from Task 1
- Produces: All panelNote reads now derive from tab state

- [ ] **Step 1: Update allNotes sync effect (line ~18592-18598)**

Find:
```js
useEffect(() => {
  setPanelNote(prev => {
    if (!prev?.id) return prev;
    const fresh = allNotes.find(n => n.id === prev.id);
    return fresh || prev;
  });
}, [allNotes]);
```

Replace with:
```js
useEffect(() => {
  setOpenTabs(prev => {
    const updated = prev.map(t => {
      const fresh = allNotes.find(n => n.id === t.id);
      return fresh || t;
    });
    // Only update if something changed
    if (updated.length === prev.length && updated.every((t, i) => t === prev[i])) return prev;
    return updated;
  });
}, [allNotes]);
```

- [ ] **Step 2: Update backlinks/outlinks effect (line ~18600-18613)**

Find `panelNote?.id` → replace with `activeTabId`:

```js
useEffect(() => {
  const activeNote = getActiveNote();
  if (!activeNote?.id) {
    setPanelBacklinks([]);
    setPanelOutlinks([]);
    return;
  }
  api.get(`/api/scratchpad/${activeNote.id}/backlinks`).then(setPanelBacklinks).catch(() => {});
  const wikiMatches = [...new Set([...(activeNote.content || "").matchAll(/(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}/g)].map(m => m[1]))];
  const parsedWikilinks = wikiMatches.map(s => parseWikilinkRaw(s));
  const outs = allNotes.filter(n => {
    if (n.id === activeNote.id) return false;
    return parsedWikilinks.some(p => p.title && (n.title || "").toLowerCase() === p.title.toLowerCase() || p.explicitId && String(n.id) === p.explicitId || p.numericId && String(n.id) === p.numericId);
  });
  setPanelOutlinks(outs);
}, [activeTabId, allNotes]);  // dependency on activeTabId triggers re-fetch
```

Note: also update the `panelNote?.content` reference to use `getActiveNote()?.content` inside the effect.

- [ ] **Step 3: Update noteSaved backlinks handler (line ~18619-18625)**

Find:
```js
useEffect(() => {
  const handler = () => {
    if (panelNote?.id) api.get(`/api/scratchpad/${panelNote.id}/backlinks`).then(setPanelBacklinks).catch(() => {});
  };
  window.addEventListener("noteSaved", handler);
  return () => window.removeEventListener("noteSaved", handler);
}, [panelNote?.id]);
```

Replace with:
```js
useEffect(() => {
  const handler = () => {
    if (activeTabId) api.get(`/api/scratchpad/${activeTabId}/backlinks`).then(setPanelBacklinks).catch(() => {});
  };
  window.addEventListener("noteSaved", handler);
  return () => window.removeEventListener("noteSaved", handler);
}, [activeTabId]);
```

- [ ] **Step 4: Update taskUpdated handler (line ~18626-18636)**

Find:
```js
useEffect(() => {
  const handler = async () => {
    if (!panelNote?.id) return;
    try {
      const updated = await api.get(`/api/scratchpad/${panelNote.id}`);
      setPanelNote(updated);
    } catch {}
  };
  window.addEventListener("taskUpdated", handler);
  return () => window.removeEventListener("taskUpdated", handler);
}, [panelNote?.id]);
```

Replace with:
```js
useEffect(() => {
  const handler = async () => {
    if (!activeTabId) return;
    try {
      const updated = await api.get(`/api/scratchpad/${activeTabId}`);
      setOpenTabs(prev => prev.map(t => t.id === updated.id ? updated : t));
    } catch {}
  };
  window.addEventListener("taskUpdated", handler);
  return () => window.removeEventListener("taskUpdated", handler);
}, [activeTabId]);
```

- [ ] **Step 5: Update `notes-layout` class condition (line ~18854)**

Find:
```js
className: `notes-layout${panelNote ? " note-open" : ""}`
```

Replace with:
```js
className: `notes-layout${openTabs.length > 0 ? " note-open" : ""}`
```

- [ ] **Step 6: Update pinned note active state (line ~19154)**

Find:
```js
className: `pinned-note-item${panelNote?.id === n.id ? " active" : ""}`,
```

Replace with:
```js
className: `pinned-note-item${activeTabId === n.id ? " active" : ""}`,
```

- [ ] **Step 7: Update note list selected state (line ~19225)**

Find:
```js
const isSelected = panelNote?.id === n.id;
```

Replace with:
```js
const isSelected = activeTabId === n.id;
```

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat(notes): replace panelNote reads with getActiveNote/openTabs"
```

---

### Task 4: Add tab bar CSS

**Files:**
- Modify: `static/index.html` — insert after line ~927 (after `.tag-section-label` block)

**Interfaces:**
- Produces: `.note-tab-bar`, `.note-tab-item`, `.note-tab-item.active`, `.note-tab-close` CSS classes

- [ ] **Step 1: Insert tab bar CSS**

Add after line 927 (after `.tag-section-label` closing `}`):

```css
    /* ── Note tab bar (multi-note viewer) ── */
    .note-tab-bar {
      display: flex;
      align-items: stretch;
      gap: 4px;
      padding: 6px 10px 0;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      flex-shrink: 0;
      border-bottom: 1px solid var(--border);
      background: var(--bg-app);
      min-height: 36px;
    }
    .note-tab-bar::-webkit-scrollbar { display: none; }
    .note-tab-item {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      border-radius: 8px 8px 0 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-bottom: none;
      cursor: pointer;
      white-space: nowrap;
      max-width: 180px;
      min-width: 80px;
      user-select: none;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }
    .note-tab-item:hover {
      background: #E9EEF5;
    }
    .note-tab-item.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
      font-weight: 600;
    }
    .note-tab-item.active:hover {
      background: #A3C100;
      border-color: #A3C100;
    }
    .note-tab-title {
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }
    .note-tab-close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: inherit;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      opacity: 0.5;
      transition: opacity 0.15s, background 0.15s;
      flex-shrink: 0;
      padding: 0;
    }
    .note-tab-close:hover {
      opacity: 1;
      background: rgba(0,0,0,0.12);
    }
    .note-tab-item.active .note-tab-close:hover {
      background: rgba(255,255,255,0.2);
    }
    /* Hide tab bar on mobile */
    @media (max-width: 767px) {
      .note-tab-bar { display: none !important; }
    }
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "style(notes): add tab bar CSS for multi-note viewer"
```

---

### Task 5: Add tab bar UI + restructure notes-right render

**Files:**
- Modify: `static/index.html` — the `notes-right` div starting around line 19315

**Interfaces:**
- Consumes: `openTabs`, `activeTabId`, `getActiveNote()`, `closeTab(noteId)`, `openTab(note)` from Task 1; CSS from Task 4
- Produces: Tab bar rendered above NotePanel, desktop only

- [ ] **Step 1: Replace the notes-right render block**

Find the block starting at line ~19315:
```js
}, /*#__PURE__*/React.createElement("div", {
    className: "notes-right",
    "data-tour": "notes-editor"
  }, !panelNote ? /*#__PURE__*/React.createElement("div", {
    className: "notes-panel-empty",
    ...
  }, ... ) : /*#__PURE__*/React.createElement(NotePanel, {
    note: panelNote,
    ...
  }))
```

Replace the entire content INSIDE `notes-right` (from `!panelNote ?` through the closing of `<NotePanel>` + its props) with:

```js
}, /*#__PURE__*/React.createElement("div", {
    className: "notes-right",
    "data-tour": "notes-editor"
  }, /* Tab bar — only when tabs are open */
  openTabs.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "note-tab-bar"
  }, openTabs.map(tab => {
    const isActive = tab.id === activeTabId;
    return /*#__PURE__*/React.createElement("div", {
      key: tab.id,
      className: `note-tab-item${isActive ? ' active' : ''}`,
      onClick: () => {
        setActiveTabId(tab.id);
        setNavTrail([tab]);
      },
      title: tab.title || "(tanpa judul)"
    }, /*#__PURE__*/React.createElement("span", {
      className: "note-tab-title"
    }, tab.title || "(tanpa judul)"), /*#__PURE__*/React.createElement("button", {
      className: "note-tab-close",
      onClick: e => {
        e.stopPropagation();
        closeTab(tab.id);
      },
      title: "Tutup tab"
    }, "×"));
  })),
  /* Content area */
  (() => {
    const activeNote = getActiveNote();
    if (!activeNote) {
      return /*#__PURE__*/React.createElement("div", {
        className: "notes-panel-empty",
        "data-tour": "notes-new"
      }, /*#__PURE__*/React.createElement("span", {
        style: { fontSize: 40, opacity: 0.3 }
      }, "📝"), /*#__PURE__*/React.createElement("span", {
        style: { fontSize: 13 }
      }, "Pilih catatan untuk membaca"), /*#__PURE__*/React.createElement("button", {
        onClick: openNew,
        className: "btn btn-secondary btn-sm"
      }, "＋ Catatan Baru"));
    }
    return /*#__PURE__*/React.createElement(NotePanel, {
      note: activeNote,
      allNotes: allNotes,
      noteTitles: noteTitles,
      sharedLists: sharedLists,
      currentUserId: user?.id,
      backlinks: panelBacklinks,
      outlinks: panelOutlinks,
      navTrail: navTrail,
      onTaskClick: onTaskClick,
      tasks: tasks,
      onEdit: () => openEdit(activeNote),
      onClose: () => closeTab(activeNote.id),
      onDelete: id => {
        handleDelete(id);
        closeTab(id);
      },
      onPin: id => handlePin(id),
      onNavigate: async n => {
        const full = allNotes.find(x => x.id === n.id) || (await api.get(`/api/scratchpad/${n.id}`).catch(() => n));
        openTab(full);
      },
      onTrailClick: n => {
        const idx = navTrail.findIndex(x => x.id === n.id);
        const full = allNotes.find(x => x.id === n.id) || n;
        setActiveTabId(full.id);
        setNavTrail(idx >= 0 ? navTrail.slice(0, idx + 1) : navTrail);
      },
      onNavigateFrom: (child, parentIdx) => {
        const full = allNotes.find(x => x.id === child.id) || child;
        setActiveTabId(full.id);
        setNavTrail(t => t.slice(0, parentIdx + 1).concat([full]));
      }
    });
  })()
))
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat(notes): add tab bar UI in notes-right with multi-note support"
```

---

### Task 6: Clean up old panelNote state + final verification

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: All previous tasks
- Produces: Clean code — `panelNote` and `setPanelNote` removed

- [ ] **Step 1: Remove the old `panelNote` state declaration**

Remove this line (kept since Task 1 for backward compatibility during incremental changes):
```js
const [panelNote, setPanelNote] = useState(null);
```

- [ ] **Step 2: Verify — search for any remaining panelNote references**

Run:
```bash
grep -n "panelNote\|setPanelNote" static/index.html
```

Expected output: **empty** (no remaining references outside of NotePanel component prop name).

Also verify no `panelNote` remains in the props passed to NotePanel — the prop is named `note={activeNote}` now.

- [ ] **Step 3: Verify the complete notes-right section structure**

Read lines around 19315-19430 (`notes-right` div) and confirm:
- Tab bar renders only when `openTabs.length > 0`
- Empty state renders when `getActiveNote()` is null
- NotePanel receives `note={activeNote}` (not `panelNote`)
- onClose calls `closeTab(activeNote.id)` (not `setPanelNote(null)`)
- onDelete calls both `handleDelete(id)` and `closeTab(id)`

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "chore(notes): remove deprecated panelNote state"
```

---

### Task 7: Bump service worker version

**Files:**
- Modify: `static/sw.js`

- [ ] **Step 1: Bump SW cache version**

In `static/sw.js` line 1, change:
```js
const CACHE = "taskflow-v189-light-theme";
```
to:
```js
const CACHE = "taskflow-v190-light-theme";
```

- [ ] **Step 2: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache version for tab viewer"
```

---

## Verification Checklist

After all tasks complete, verify:
- [ ] Open 2+ notes from the note list → tabs appear in bar, active tab highlighted
- [ ] Click same note again → switches to existing tab (no duplicate)
- [ ] Click × on a tab → tab closes, switches to neighbor
- [ ] Open 6 notes → oldest tab evicted, max 5 maintained
- [ ] Navigate wikilink inside a note → new tab opens
- [ ] Click breadcrumb trail → switches active tab within existing tabs
- [ ] Delete a note → tab removed + note deleted
- [ ] Switch to Dashboard, return to Notes → tabs reset (clean state)
- [ ] Mobile viewport (≤767px) → tab bar hidden, single-note layout works
- [ ] "Pilih catatan untuk membaca" empty state still shows when no tabs open
