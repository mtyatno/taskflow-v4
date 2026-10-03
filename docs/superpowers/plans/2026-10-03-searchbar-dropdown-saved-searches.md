# Search Bar Dropdown for Saved Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Notes saved searches UI from a static horizontal chips row below the search bar into an anchored dropdown popover attached to the search bar.

**Architecture:** Update `NotesPage` in `static/index.html` to manage `showSearchDropdown` state and `searchBarRef`, replace the horizontal chips row with an anchored `.scratchpad-search-dropdown` popover with rich rows, quick save action, outside-click and escape dismissal, bump Service Worker cache version to `taskflow-v351-note-search-dropdown`, and update test assertions.

**Tech Stack:** React 18 (inlined JSX in `static/index.html`), Service Worker (`static/sw.js`), Node.js Test Runner (`node --test tests/offline/*.test.js`).

## Global Constraints
- Multi-user isolation: Preserved, no backend query changes.
- Offline-first: Full offline functionality retained with IndexedDB caching (`note_saved_searches`).
- Zero data loss: Preserves all existing saved searches and CRUD operations.
- Superpowers discipline: No cowboy coding, all implementation and code review executed via subagents, full verification before claiming done.
- Service Worker version: Bump to `taskflow-v351-note-search-dropdown`.

---

### Task 1: Implement Search Bar Dropdown Popover, Dismissal Handlers, and SW v351

**Files:**
- Modify: `static/index.html:22320-22500` (in `NotesPage`)
- Modify: `static/sw.js:1-10`
- Modify: `tests/offline/note_saved_searches_view_mode.test.js`
- Modify: `tests/offline/drawing_sync_ui.test.js`
- Modify: `tests/offline/interactive_note_viewer.test.js`
- Modify: `tests/offline/note_search_filters.test.js`

**Interfaces:**
- Consumes: `savedSearches`, `fetchSavedSearches`, `handleSaveSearch`, `handleDeleteSavedSearch`, `handleSearch`, `q`, `setQ`.
- Produces: Dropdown popover `.scratchpad-search-dropdown` anchored to `.scratchpad-bar`, outside click handling with `searchBarRef`, toggle button `▾`/`▴`.

- [ ] **Step 1: Write failing offline test assertions**
Add tests in `tests/offline/note_saved_searches_view_mode.test.js` verifying:
1. `scratchpad-search-dropdown` popover exists in `static/index.html`.
2. Toggle button `▾` or `▴` exists in `static/index.html`.
3. `showSearchDropdown` state and outside click listener exist.
4. Old horizontal chips row below searchbar is replaced by the dropdown.
5. Service Worker cache version is `taskflow-v351-note-search-dropdown`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/offline/note_saved_searches_view_mode.test.js`
Expected: FAIL due to missing dropdown and older SW version.

- [ ] **Step 3: Implement search bar dropdown and SW bump**
1. In `static/index.html` inside `NotesPage`:
   - Add state: `const [showSearchDropdown, setShowSearchDropdown] = React.useState(false);`
   - Add ref: `const searchBarRef = React.useRef(null);`
   - Add outside click listener:
     ```javascript
     React.useEffect(() => {
       if (!showSearchDropdown) return;
       const handleOutside = e => {
         if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
           setShowSearchDropdown(false);
         }
       };
       document.addEventListener("pointerdown", handleOutside);
       return () => document.removeEventListener("pointerdown", handleOutside);
     }, [showSearchDropdown]);
     ```
   - On `.scratchpad-bar`:
     - Attach `ref: searchBarRef` and `position: "relative"`.
     - Input `onFocus: () => setShowSearchDropdown(true)`.
     - Input `onKeyDown: e => { if (e.key === "Escape") setShowSearchDropdown(false); }`.
     - Add toggle button `▾` / `▴`:
       ```javascript
       /*#__PURE__*/React.createElement("button", {
         type: "button",
         onClick: () => setShowSearchDropdown(!showSearchDropdown),
         title: showSearchDropdown ? "Tutup pencarian tersimpan" : "Buka pencarian tersimpan",
         style: {
           background: "none",
           border: "none",
           cursor: "pointer",
           fontSize: 11,
           color: "var(--text-secondary)",
           padding: "0 2px",
           lineHeight: 1
         }
       }, showSearchDropdown ? "▴" : "▾")
       ```
     - Inside `.scratchpad-bar` (anchored dropdown):
       When `showSearchDropdown` is true, render `.scratchpad-search-dropdown`:
       ```javascript
       /*#__PURE__*/React.createElement("div", {
         className: "scratchpad-search-dropdown",
         style: {
           position: "absolute",
           top: "calc(100% + 4px)",
           left: 0,
           right: 0,
           zIndex: 60,
           background: "var(--bg-primary)",
           border: "1px solid var(--border)",
           borderRadius: 8,
           boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
           maxHeight: 260,
           overflowY: "auto",
           padding: "6px 0"
         }
       }, ... header, items, quick-save footer, empty note ...)
       ```
   - Remove the old horizontal chips row (`savedSearches.length > 0 && React.createElement("div", { style: { display: "flex", gap: 6, overflowX: "auto" ... } })`).
2. In `static/sw.js`:
   - Bump cache version to `const CACHE_NAME = 'taskflow-v351-note-search-dropdown';`
3. Update version string in test files:
   - `tests/offline/drawing_sync_ui.test.js`
   - `tests/offline/interactive_note_viewer.test.js`
   - `tests/offline/note_search_filters.test.js`
   - `tests/offline/note_saved_searches_view_mode.test.js`

- [ ] **Step 4: Run test to verify it passes**
Run:
- `node scratch/check_inline.js static/index.html` (must report 5/5 scripts OK)
- `node --check static/sw.js` (must pass)
- `node --test tests/offline/note_saved_searches_view_mode.test.js` (must pass)
- `node --test tests/offline/*.test.js` (all suites must pass)
- `python -m pytest tests/` (full test suite must pass)

- [ ] **Step 5: Commit**
```bash
git add static/index.html static/sw.js tests/offline/
git commit -m "feat(client): display saved searches in search bar dropdown popover and bump SW to v351"
```
