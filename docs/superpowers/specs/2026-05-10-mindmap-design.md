# Design Spec: Mindmap Page

**Date:** 2026-05-10  
**Status:** Approved  
**Library:** mind-elixir (MIT, ~85 KB IIFE)

---

## Overview

Add a dedicated Mindmap page to TaskFlow with a collapsible sidebar (list of mindmaps) and a full-width mind-elixir editor embedded via iframe. Data stored in backend SQLite. Works 100% offline with localStorage queue.

---

## 1. Backend

### Schema

```sql
CREATE TABLE mindmaps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL DEFAULT 'Untitled',
  data_json  TEXT NOT NULL DEFAULT '{}',
  is_pinned  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/mindmaps` | List all mindmaps for current user (id, title, is_pinned, updated_at — no data_json). Pinned first, then by updated_at DESC |
| POST | `/api/mindmaps` | Create new mindmap `{title, data_json}` → returns full object |
| GET | `/api/mindmaps/:id` | Get single mindmap including data_json |
| PUT | `/api/mindmaps/:id` | Update mindmap `{title?, data_json?}` |
| PATCH | `/api/mindmaps/:id/pin` | Toggle is_pinned (0→1, 1→0) → returns updated object |
| DELETE | `/api/mindmaps/:id` | Delete mindmap |

All endpoints require auth (`get_current_user` dependency, same as other endpoints).

---

## 2. mind-elixir Integration

### Files

```
static/vendor/mind-elixir/
  ├── index.html          # Standalone iframe page
  ├── MindElixir.iife.js  # Downloaded from npm/jsdelivr
  └── MindElixir.css      # Downloaded from npm/jsdelivr
```

### iframe page (`index.html`)

- Loads `MindElixir.iife.js` + `MindElixir.css` locally
- Initializes `new MindElixir({ el: '#map', direction: 2, draggable: true, editable: true })`
- Listens for `postMessage` from parent:
  - `{type: "load", data: <mind-elixir data object>}` → `mind.init(data)`
  - `{type: "clear"}` → reset to empty
- Posts to parent on every node change:
  - `{type: "change", data: mind.getData()}`
  - `{type: "ready"}` on init complete

### Parent SPA communication

```
MindmapPage                     iframe (mind-elixir)
     │                               │
     │── postMessage({type:"load"}) ─▶│  mind.init(data)
     │                               │
     │◀─ postMessage({type:"change"})─│  on every edit
     │                               │
     │  debounce 1s → PUT /api/mindmaps/:id
```

---

## 3. Page Structure

### Navigation

- Add `{ id: "mindmap", icon: "🧠", label: "Mindmap" }` to sidebar nav links (after Notes & Draw)

### MindmapPage Component Layout

```
┌─────────────────────────────────────────────────────┐
│ topbar: [☰] 🧠 <mindmap title>    [Rename][Del][Export] │
├──────────────────┬──────────────────────────────────┤
│ Sidebar (200px)  │  iframe: mind-elixir editor      │
│                  │                                   │
│ [🔍 Cari...]     │  (full width, full height)        │
│ [+ Baru]         │                                   │
│ ── PINNED ──     │                                   │
│ ★ Product Rmap ← │                                   │
│ ── SEMUA ──      │                                   │
│   Sprint Plan    │                                   │
│   Biz Model      │                                   │
│   Team Struct    │                                   │
│                  │                                   │
│ [‹ collapse]     │                                   │
└──────────────────┴──────────────────────────────────┘
```

### Sidebar Collapsed State

```
┌────┬────────────────────────────────────────────────┐
│ 🧠 │  iframe: mind-elixir (full width)              │
│    │                                                 │
│ [›]│                                                 │
└────┴────────────────────────────────────────────────┘
```

Collapsed sidebar: 36px wide, shows only icon + expand button.  
State persisted to `localStorage` key `tf_mindmap_sidebar` (`"open"` | `"collapsed"`).

---

## 4. CRUD UX

### Create
- Click "+ Baru" → inline input in sidebar (auto-focused)
- Press Enter or blur → POST `/api/mindmaps` with title + default data:
  ```json
  {"nodeData":{"id":"root","topic":"<title>","root":true,"children":[]}}
  ```
- New mindmap auto-selected and loaded in editor

### Open
- Click mindmap name in sidebar → GET `/api/mindmaps/:id` → postMessage load to iframe

### Rename
- Double-click name in sidebar **or** click Rename button in topbar
- Inline edit in sidebar list → blur/Enter → PUT `/api/mindmaps/:id` with new title

### Delete
- Click Delete in topbar → inline confirm ("Hapus mindmap ini?  [Ya] [Batal]")
- DELETE `/api/mindmaps/:id` → select next mindmap in list (or show empty state)

### Pin / Unpin
- Hover mindmap item in sidebar → ☆ icon appears on the right
- Click ☆ → PATCH `/api/mindmaps/:id/pin` → toggle pinned state
- Pinned: item moves to "Pinned" section at top, icon becomes ★ (accent color)
- Pinned section only shown if at least 1 mindmap is pinned
- Section labels: "★ Pinned" and "Semua" (shown only when pinned section exists)

### Search
- Search input at top of sidebar (always visible, not collapsible)
- Filters list client-side in realtime as user types
- Searches against mindmap title (case-insensitive)
- Clears with ✕ button or Escape key
- When search active: section labels (Pinned/Semua) hidden, flat filtered list shown
- No results: "Tidak ada mindmap yang cocok"

### Export
- Click Export in topbar → triggers mind-elixir built-in export (SVG/PNG)
- No backend involvement — client-side only

### Auto-save
- On every `{type:"change"}` message from iframe
- Debounced 1000ms
- PUT `/api/mindmaps/:id` with `data_json`
- Save status indicator: "Menyimpan..." → "Tersimpan" → "Offline"

---

## 5. Offline Behavior

- On save failure (offline): store to `localStorage` key `tf_mindmap_pending_<id>`
- Show status "Offline — tersimpan lokal"
- On `window online` event: flush pending data → PUT to backend → clear localStorage key
- List fetch failure: show cached list from `localStorage` key `tf_mindmap_list`

---

## 6. Empty States

| State | Display |
|-------|---------|
| No mindmaps yet | Center: 🧠 + "Belum ada mindmap" + "+ Buat Mindmap Pertama" button |
| Mindmap selected but iframe not ready | Loading spinner in editor area |
| No mindmap selected (list not empty) | Center: "Pilih mindmap dari daftar" |

---

## 7. Mobile

- Sidebar default hidden on mobile (`window.innerWidth < 768`)
- Hamburger button (☰) in topbar toggles sidebar as overlay (not push)
- Overlay sidebar closes when mindmap selected

---

## 8. Affected Files

| File | Change |
|------|--------|
| `webapp.py` | Add 6 mindmap API endpoints + `mindmaps` table migration (incl. `is_pinned`) |
| `static/index.html` | Add `MindmapPage` component + nav link |
| `static/vendor/mind-elixir/index.html` | New: iframe host page |
| `static/vendor/mind-elixir/MindElixir.iife.js` | New: downloaded from npm |
| `static/vendor/mind-elixir/MindElixir.css` | New: downloaded from npm |

No changes to existing components.
