# Note Paper Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Continuous Paper Mode" to the Note Editor that simulates a physical sheet of paper with configurable size and orientation, saving the settings persistently per note.

**Architecture:** A new `meta_json` column is added to `scratchpad_notes` to store the paper mode configuration. The frontend offline engine syncs this data and applies dynamic CSS to the Milkdown editor to constrain width and add margins.

**Tech Stack:** Python (SQLite3, FastAPI), Vanilla JS / React (Frontend), CSS.

## Global Constraints

- No third-party pagination libraries for ProseMirror. Use pure CSS for visual constraints.
- Maintain compatibility with the offline sync engine.

---

### Task 1: Backend Database Schema Update

**Files:**
- Modify: `webapp.py`
- Create: `scratch/migrate_meta_json.py`

**Interfaces:**
- Produces: `meta_json` column in `scratchpad_notes` table.

- [ ] **Step 1: Write migration script**
```python
import sqlite3
def migrate():
    conn = sqlite3.connect('taskflow.db')
    try:
        conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'")
        conn.commit()
        print("Migration successful")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e):
            print("Already migrated")
        else:
            raise e
migrate()
```

- [ ] **Step 2: Run migration script**
Run: `python scratch/migrate_meta_json.py`
Expected: PASS (Migration successful)

- [ ] **Step 3: Update `webapp.py` init_db**
Modify `webapp.py` inside `init_db()` where `scratchpad_notes` is created, adding `meta_json TEXT NOT NULL DEFAULT '{}'`.

- [ ] **Step 4: Update `webapp.py` models and endpoints**
Add `meta_json` to `NoteCreate` and `NoteUpdate` Pydantic models. Update the `GET`, `POST`, and `PUT` queries for `/api/scratchpad` to include `meta_json`.

- [ ] **Step 5: Commit**
```bash
git add webapp.py scratch/migrate_meta_json.py
git commit -m "feat(db): add meta_json column to scratchpad_notes"
```

---

### Task 2: Offline Engine Schema Update

**Files:**
- Modify: `static/offline/noterepo.js`
- Modify: `static/offline/noteroutes.js`

**Interfaces:**
- Consumes: `meta_json` from Backend API.
- Produces: `meta_json` in IndexedDB `scratchpad_notes` store.

- [ ] **Step 1: Update `noterepo.js` createNote/updateNote**
Modify `createNote` to include `meta_json: doc.meta_json || "{}"`. Modify `updateNote` to include `meta_json: patch.meta_json !== undefined ? patch.meta_json : rec.meta_json`. Ensure `TFoutbox.outboxAdd` payload includes `meta_json`.

- [ ] **Step 2: Update `noteroutes.js`**
Ensure the offline router allows `meta_json` to pass through in `POST /api/scratchpad` and `PUT /api/scratchpad/:id`.

- [ ] **Step 3: Commit**
```bash
git add static/offline/noterepo.js static/offline/noteroutes.js
git commit -m "feat(offline): add meta_json support to noterepo"
```

---

### Task 4: Sync Engine Update

**Files:**
- Modify: `static/offline/syncpush.js`
- Modify: `static/offline/syncpull.js`

**Interfaces:**
- Consumes: `meta_json` from `noterepo.js`.
- Produces: Synced notes with `meta_json`.

- [ ] **Step 1: Update `syncpush.js`**
In `opNoteUpsert`, modify the payload sent to `send(transport, "PUT", "/api/scratchpad/" + sid, ...)` to include `meta_json: rec.meta_json`.
In `opNoteCreate`, modify the payload sent to `send(transport, "POST", "/api/scratchpad", ...)` to include `meta_json: payload.meta_json`.

- [ ] **Step 2: Update `syncpull.js`**
In `syncNotes`, ensure `serverRec.meta_json` is safely merged into `localUpdate` object.

- [ ] **Step 3: Commit**
```bash
git add static/offline/syncpush.js static/offline/syncpull.js
git commit -m "feat(sync): push and pull meta_json for notes"
```

---

### Task 5: UI Toolbar and State Management

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: `note.meta_json`

- [ ] **Step 1: Add React State to NotePage/NoteModal**
Parse `note.meta_json` on load. Default to `{ paper_mode: { enabled: false, size: 'A4', orientation: 'portrait' } }`.
Create state variables `paperMode`, `paperSize`, `paperOrientation`.
Create a function `savePaperConfig(newConfig)` that calls `api.put` to update `meta_json` and updates the local state.

- [ ] **Step 2: Add Toolbar Buttons**
In `NoteToolbar` (or equivalent header), add a toggle button: "📄 Kertas".
When enabled, show two small `<select>` dropdowns:
- Size: A4 (210mm), Letter (215.9mm), A3 (297mm), Legal (215.9mm)
- Orientation: Portrait, Landscape

- [ ] **Step 3: Commit**
```bash
git add static/index.html
git commit -m "feat(ui): add paper mode toggle and state to Note editor"
```

---

### Task 6: CSS Styling for Continuous Paper Mode

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: `paperMode`, `paperSize`, `paperOrientation` states.

- [ ] **Step 1: Dynamic Wrapper Classes**
Wrap the `MilkdownEditor` component in a container `div` that conditionally applies a `.paper-mode-active` class based on state.

- [ ] **Step 2: Add CSS Rules**
Add a `<style>` block for paper mode:
```css
.paper-mode-active {
    background-color: #e5e7eb;
    padding: 2rem;
    overflow-y: auto;
    display: flex;
    justify-content: center;
}
.paper-mode-active .milkdown-editor {
    background-color: white !important;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    margin: 0;
    transition: width 0.3s ease, min-height 0.3s ease;
}
/* Paper Guides */
.paper-guide-dashed {
    background-image: linear-gradient(to bottom, transparent 99%, #cbd5e1 1%);
}
```

- [ ] **Step 3: Apply Dynamic Dimensions**
Calculate width based on Size + Orientation.
E.g. A4 Portrait = `width: 210mm; min-height: 297mm; padding: 20mm;`.
Apply these as `style={{ width, minHeight, padding, backgroundSize }}` on the `.milkdown-editor` container.

- [ ] **Step 4: Commit**
```bash
git add static/index.html
git commit -m "feat(style): implement CSS for physical paper simulation"
```
