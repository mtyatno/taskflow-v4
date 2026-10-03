# Design Specification: Search Bar Dropdown for Saved Searches

**Date:** 2026-10-03  
**Status:** Approved  
**Author:** Antigravity / Gemini  
**Target:** Alurik (TaskFlow) Notes / Scratchpad (`static/index.html`, `static/sw.js`)

---

## 1. Problem Statement & Motivation
In Roadmap Item #4, the Saved Searches feature was introduced with a horizontal row of scrollable chips rendered directly beneath `.scratchpad-bar`. While functional, having a permanent chips bar takes up vertical space in the sidebar above tags and note lists even when the user is not actively searching.

The user requested moving Saved Searches into a dropdown popover anchored directly to the search bar. This cleans up the sidebar layout and makes accessing saved searches seamless and focused during search interactions.

---

## 2. User Experience & Interface Design

### 2.1 Search Bar Component (`.scratchpad-bar`)
- **Container Styling:**
  - `position: relative` to serve as the positioning context for the absolute popover.
  - Border, background, and padding remain consistent with existing styles.
- **Controls inside `.scratchpad-bar`:**
  1. `🔍` Search icon (opacity 0.6).
  2. `<input class="scratchpad-search-input">`:
     - `onFocus`: Sets `showSearchDropdown(true)`.
     - `onKeyDown`: Handles `Escape` to close dropdown; `Enter` to search.
  3. `⭐` Save icon button (when `q.trim()` has text that is not yet saved).
  4. `✕` Clear icon button (when `q` is non-empty).
  5. `▾` / `▴` Dropdown toggle button:
     - Toggles `showSearchDropdown(!showSearchDropdown)`.
     - Displays `▴` when open and `▾` when closed.
     - Accessible button with title "Tampilkan pencarian tersimpan".

### 2.2 Dropdown Popover (`.scratchpad-search-dropdown`)
- **Positioning:**
  - `position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60;`
  - Ensures it opens immediately beneath the search bar across its full width without pushing down other content.
- **Styling:**
  - Background: `var(--bg-primary)`.
  - Border: `1px solid var(--border)`.
  - Border Radius: `8px`.
  - Box Shadow: `0 8px 24px rgba(0,0,0,0.18)`.
  - Max Height: `260px` with `overflow-y: auto`.
- **Content Hierarchy:**
  1. **Header:**
     - Small header: "PENCARIAN TERSIMPAN" (font-size 10px, uppercase, tracking, muted text `var(--text-secondary)`).
  2. **Saved Searches List:**
     - Each item displays:
       - Star icon `⭐`.
       - Query label name `s.name` (font-size 12px, font-weight 600).
       - Query preview `s.query` (font-size 11px, color `var(--text-secondary)`, truncated if long).
       - Active state: If `q.trim() === s.query.trim()`, highlighted with `var(--accent)`.
       - Delete button `×` on the far right (with `e.stopPropagation()` to delete without triggering the search).
     - Clicking an item:
       - Calls `handleSearch(s.query)`.
       - Closes the dropdown (`setShowSearchDropdown(false)`).
  3. **Quick Save Action (Footer):**
     - When `q.trim()` is non-empty and does not match any existing saved search name/query:
       - Displays an actionable footer item: `⭐ Simpan pencarian "${q}"`.
       - Clicking it triggers `handleSaveSearch()` and closes the dropdown.
  4. **Empty State:**
     - If `savedSearches` is empty and `q` is empty:
       - Displays a helpful muted note: "Belum ada pencarian tersimpan. Ketik kueri dan klik ⭐ untuk menyimpan."

### 2.3 Dismissal Behavior
- **Outside Click:**
  - Standard React `useRef` on `.scratchpad-bar` container with `pointerdown` / `click` event listener.
  - Clicking outside closes `showSearchDropdown(false)`.
- **Keyboard Navigation:**
  - Pressing `Escape` while focused on the search bar or dropdown closes the dropdown.
- **Item Selection:**
  - Selecting any saved search closes the dropdown.

---

## 3. Architecture & Data Flow

### 3.1 Frontend Component State in `NotesPage`
```javascript
const [showSearchDropdown, setShowSearchDropdown] = useState(false);
const searchBarRef = useRef(null);
```

### 3.2 Outside Click Listener
```javascript
useEffect(() => {
  if (!showSearchDropdown) return;
  const handleClickOutside = (e) => {
    if (searchBarRef.current && !searchBarRef.current.contains(e.target)) {
      setShowSearchDropdown(false);
    }
  };
  document.addEventListener('pointerdown', handleClickOutside);
  return () => document.removeEventListener('pointerdown', handleClickOutside);
}, [showSearchDropdown]);
```

### 3.3 Backend & Offline Storage
- Backend endpoints (`GET`, `POST`, `DELETE /api/scratchpad/saved-searches`) and IndexedDB cache (`note_saved_searches`) are completely preserved and reused without modifications.
- Service Worker version bumped to `taskflow-v351-note-search-dropdown`.

---

## 4. Verification & Testing Plan
1. **Node.js Offline Tests:**
   - Update `tests/offline/note_saved_searches_view_mode.test.js` to verify:
     - The dropdown toggle and container exist in `static/index.html`.
     - Outside click and keyboard handlers are wired.
     - SW cache version matches `taskflow-v351-note-search-dropdown`.
   - Synchronize SW cache version assertions across:
     - `tests/offline/drawing_sync_ui.test.js`
     - `tests/offline/interactive_note_viewer.test.js`
     - `tests/offline/note_search_filters.test.js`
2. **Syntax and Code Quality:**
   - Run `node scratch/check_inline.js static/index.html` (5/5 scripts OK).
   - Run `node --check static/sw.js` (OK).
   - Run `node --test tests/offline/*.test.js` (all suites passing).
   - Run `python -m pytest tests/` (full test suite passing).
