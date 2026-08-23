# Design Specification: Floating TOC (Table of Contents) Overlay for Note Viewer

## 1. Overview & Goal
Transform the static side-column Table of Contents in `NotePanel` into a non-intrusive, sticky floating button and floating popover overlay. This eliminates the ~135px horizontal width consumption while keeping article navigation pinned and instantly accessible throughout long documents on desktop, tablet (iPad portrait/landscape), and mobile.

## 2. Problem Statement
The current TOC (`NoteToc` component) is mounted as a static sticky side-column (`.note-toc-sticky`, `width: 120px` + margins). On tablets (such as iPad Pro portrait mode) and desktops with the left sidebar open, this static column shrinks the note reading area by ~135px, causing tables, code blocks, drawings, and markdown body text to be squeezed horizontally.

## 3. Architecture & User Interface Design

### 3.1. Floating Trigger Button (`Floating TOC Trigger`)
- **Location**: Anchored at the top-right of the scrollable note viewport (`.notes-right-scroll`).
- **Positioning**: `position: sticky; top: 8px; float: right; z-index: 50; margin-bottom: -32px;` (or positioned relative to the reader viewport so it floats over the top-right without creating layout shift).
- **Appearance**: Sleek pill-shaped button:
  - Text: `📑 Isi (${tocItems.length}) ▾`
  - Style: `background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 20px; padding: 4px 12px; font-size: 12px; font-weight: 600; color: var(--text-secondary); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.06); backdrop-filter: blur(8px);`
  - Active/Open Style: `border-color: var(--accent); color: var(--accent); background: rgba(168,197,0,0.08);`
- **Visibility**: Only rendered when `tocItems.length >= 2`.

### 3.2. Floating Popover Overlay (`Floating TOC Overlay`)
- **Mounting**: Rendered as a floating popover directly anchored below the trigger button when `tocOpen === true`.
- **Dimensions**: `width: 250px; max-height: 60vh;` with internal scrolling (`overflow-y: auto; scrollbar-width: none;`).
- **Styling**: `background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); padding: 10px 12px; z-index: 100; position: absolute; top: calc(100% + 6px); right: 0; backdrop-filter: blur(12px);`.
- **Content Hierarchy**:
  - Header: `📑 DAFTAR ISI (${tocItems.length})` with close button `✕`.
  - Item List: Hierarchical indented headings (H1: bold, H2: indent 10px, H3: indent 20px).
- **Interactions**:
  - Clicking an item triggers `handleClick(item)`: smooth scrolls to `#note-h-${item.idx}`, sets active heading, and closes the popover.
  - Clicking outside closes the popover via document `pointerdown` listener.
  - Pressing `Escape` key closes the popover.

### 3.3. Note Body Layout
- `NotePanel` main container no longer renders the static `.note-toc-sticky` side column.
- Note content occupies **100% full width** of `.notes-right-scroll`.

## 4. Verification & Testing
- Unit tests in `tests/offline/notes_page_layout.test.js` or `tests/offline/note_toc.test.js`:
  - Verify `NotePanel` renders the floating TOC trigger button when `tocItems.length >= 2`.
  - Verify clicking the trigger opens the floating TOC popover overlay.
  - Verify static `.note-toc-sticky` side-column is removed and note body takes 100% width.
  - Verify click-outside handler dismisses the popover.
- Pytest regression tests.
- Service worker cache bump.
