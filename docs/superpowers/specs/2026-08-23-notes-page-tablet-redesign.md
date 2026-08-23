# Design Specification: Notes Page Tablet & Portrait Layout Redesign

## 1. Overview & Objectives
Redesign the Notes Page (`NotesPage`) to provide an ergonomic, clutter-free, and highly responsive experience on tablet devices (specifically iPad Pro in portrait orientation, 768px–1024px screen width) as well as desktop and mobile.

## 2. Key Problems with Current Layout on Tablets
1. **Sub-Column Squeezing**: The left panel is currently partitioned into two fixed sub-columns (200px search/tags + note list), leaving the note list squeezed to <150px on portrait tablet screens.
2. **Tag Clutter ("Semrawut")**: All tags and multiple accordion sections are rendered vertically in the left column, taking excessive vertical height and visual clutter.
3. **Restricted Reading Area**: Note viewer panel is constrained to ~500px in portrait tablet mode without a prominent 1-tap full-width expansion.

## 3. Proposed Architecture (Option 1: Unified 2-Column Split View)

### 3.1. Master Layout (.notes-layout)
- **Unified Left Sidebar (`.notes-left`)**:
  - Replaces the 2-subcolumn system with a single, cohesive vertical panel.
  - Width: `320px` on tablets / `340px` on desktop (flexible max-width `380px`).
  - Collapsible: When collapsed (`sidebarCollapsed === true`), width transitions smoothly to `0`, allowing the Note Viewer (`.notes-right`) to expand to **100% full-width**.
  - Re-open mechanism: Floating button `.sidebar-toggle.visible` on the left edge or top bar button in `NotePanel` unhides the sidebar.
- **Right Viewer / Editor Panel (`.notes-right`)**:
  - Takes `flex: 1` (filling 100% of remaining width or 100% full screen when sidebar is hidden).
  - Multi-tab bar (`.note-tab-bar`) and scrollable note reader (`NotePanel`).

### 3.2. Left Sidebar Component Hierarchy
1. **Header**:
   - Title: `📝 Catatan` with total count badge.
   - Action buttons: `➕ Catatan Baru` (quick create) and `✕` (collapse sidebar to 100% full-width reader).
2. **Search Box**:
   - Modern full-width search input with search icon `🔍` and clear button `✕`.
   - Supports text search and `tag:xxx` syntax.
3. **Compact Filter Chip Strip**:
   - Displays a horizontal scrollable/wrapped bar of filter chips:
     - `[ Semua ]` (default / reset).
     - Top 2–3 most used tags (e.g. `[ #kerja (12) ]`, `[ #ide (8) ]`, `[ #proyek (5) ]`).
     - `[ 🏷️ +X Tags ▾ ]` button: Opens a popover/dropdown overlay showing all remaining tags with live filter search, counts, and `⬜ Tanpa Tag`.
     - `[ 🔗 Published (X) ]` chip (if published notes exist).
     - `[ 👥 Shared (X) ]` chip (if shared lists exist).
4. **Pinned Notes Accordion**:
   - Header: `📌 Disematkan (N)` with collapsible arrow `▲/▼`.
   - Displays pinned note cards with quick navigation and active tab indicator.
5. **Sort & Notes Header**:
   - Title `Semua Catatan (N)` with clean Sort Dropdown (`Terbaru`, `Terlama`, `A–Z`, `Terbanyak link`).
6. **Note Cards List (`.notes-left-inner`)**:
   - Comfortable card layout (~300px+ width): Title (bold), snippet preview (up to 2 lines), date, mini tags `#tag`, and wikilink connection indicators (`🔗3 ←1`).

### 3.3. Responsive Breakpoints
- **Desktop (>= 1025px)**: Unified sidebar (340px) + Viewer (flex: 1).
- **Tablet / iPad Portrait (768px – 1024px)**: Unified sidebar (320px) + Viewer (flex: 1). Collapse button `✕` gives 100% full-screen reader.
- **Mobile (< 768px)**: 1-column stack. When no note is active, shows sidebar 100%; when a note tab is active, shows viewer 100% with back button.

## 4. Verification & Testing
- JS Unit Tests in `tests/offline/notes_page_layout.test.js`:
  - Validates unified left panel DOM hierarchy (no split sub-columns).
  - Validates 2–3 top tags + `+X Tags` dropdown popover rendering.
  - Validates collapse/expand toggle behavior (0 width to full-width reader).
  - Validates filter chip triggers (`Semua`, `Published`, `Shared`, `Tags`).
- Pytest test suite regression.
- Service worker cache bump.
