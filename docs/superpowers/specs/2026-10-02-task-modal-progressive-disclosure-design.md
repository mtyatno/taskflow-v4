# Design Specification: TaskFormModal Progressive Disclosure

**Date:** 2026-10-02  
**Status:** Approved  
**Topic:** TaskFormModal UX Refinement via Progressive Disclosure  

---

## 1. Problem Statement & Motivation

In Alurik (formerly TaskFlow), when a user opens the "Buat Baru" (New Task) modal, they are immediately presented with 8–10 form inputs and selectors:
- Title (`Judul *`)
- Priority (`Priority`)
- GTD Status (`GTD Status`)
- Project (`Project`)
- Context (`Context`)
- Shared List (`Shared List`)
- Deadline (`Deadline`)
- Recurrence (`Berulang`)
- Description (`Deskripsi`)
- Subtasks (`Subtask`)

### Issues:
1. **Cognitive Overload & High Friction:** Even though only `Judul` is mandatory, all fields are displayed with equal visual prominence upfront. New and daily users experience decision fatigue, feeling as if they must configure a bureaucratic form just to record a quick thought or todo.
2. **Violation of GTD Philosophy:** The core tenet of Getting Things Done (GTD) is *"Capture first, clarify later"*. Forcing project, context, and status assignment at the initial capture moment creates unnecessary mental friction.
3. **Screen Real Estate:** On standard laptops and mobile screens, the modal exceeds the viewport height, forcing users to scroll past secondary settings just to reach the save button.

---

## 2. Proposed Solution: Progressive Disclosure

Adopt the industry standard **Progressive Disclosure** pattern (seen in Linear, Things 3, and Notion):
- When creating a **New Task (`!isEdit`)**, display only the essential fields initially:
  1. **Judul Task** (large input, auto-focused, supporting `#tag` autocomplete and instant `Enter` key submission).
  2. **Quick Attributes Bar (3 columns/chips):**
     - 📅 **Deadline**
     - 🚩 **Priority** (defaults to `P3 Medium`)
     - 📁 **Project** (defaults to empty)
- Hide complex and situational GTD/task metadata behind a clean, collapsible accordion:
  - Button: `▸ Opsi Tambahan (GTD Status, Context, Deskripsi, Subtask, Berulang)`
  - When expanded, it reveals:
    - 🔄 **GTD Status** (Inbox, Next, Waiting, Someday, Done) & *Waiting For* (if status is waiting).
    - 🏷️ **Context** (ComboSelect).
    - 👥 **Shared List** & **Assignee** (if shared lists are available).
    - 🔁 **Berulang** (Recurrence rules).
    - 📝 **Deskripsi** (MentionInput textarea).
    - 📌 **Subtasks** (List and add subtask inputs).
- **Smart Filled Count Indicator:** If any attribute inside the advanced section is modified or populated (e.g. description is written, or recurrence is enabled), the accordion toggle displays an indicator pill (e.g. `▾ Opsi Tambahan (2 diisi)`) so the user knows hidden fields are active.
- **Edit Mode (`isEdit === true`):**
  - When editing an existing task, the modal displays the full form (or auto-expands the advanced section) because the user's explicit intent is reviewing and modifying full task details.

---

## 3. UI/UX Wireframe & Layout

### 3.1. New Task Mode (`!isEdit`) — Collapsed (Default)

```
┌────────────────────────────────────────────────────────┐
│  ➕ Buat Baru               [Task] [Habit] [Note] [Goal] │
│                                                      ✕ │
│  Judul *                                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Judul task... atau tambahkan #tag                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Deadline           Priority          Project          │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ dd/mm/yyyy  📅│  │ 🟡 P3 Med  ▼ │  │ — Project — ▼│ │
│  └───────────────┘  └──────────────┘  └──────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ▸ Opsi Tambahan (GTD, Context, Deskripsi, dll)   │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│                              [ Batal ] [ Tambah Task ] │
└────────────────────────────────────────────────────────┘
```

### 3.2. New Task Mode (`!isEdit`) — Expanded

```
┌────────────────────────────────────────────────────────┐
│  ➕ Buat Baru               [Task] [Habit] [Note] [Goal] │
│                                                      ✕ │
│  Judul *                                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Beli kopi arabika                                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  Deadline           Priority          Project          │
│  ┌───────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 05/10/2026  📅│  │ 🟡 P3 Med  ▼ │  │ Belanja     ▼│ │
│  └───────────────┘  └──────────────┘  └──────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ ▾ Sembunyikan Opsi Tambahan                      │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  GTD Status                       Context        │  │
│  │  ┌──────────────┐                 ┌────────────┐ │  │
│  │  │ 📥 Inbox   ▼ │                 │ Supermarket│ │  │
│  │  └──────────────┘                 └────────────┘ │  │
│  │  Shared List (opsional)                          │  │
│  │  ┌─────────────────────────────────────────────┐ │  │
│  │  │ — Personal (tidak di-share) —             ▼ │ │  │
│  │  └─────────────────────────────────────────────┘ │  │
│  │  [ ] 🔄 Berulang                                 │  │
│  │  Deskripsi                                       │  │
│  │  ┌─────────────────────────────────────────────┐ │  │
│  │  │ Catatan tambahan...                         │ │  │
│  │  └─────────────────────────────────────────────┘ │  │
│  │  📌 Subtask                                      │  │
│  │  ┌─────────────────────────┐ ┌─────────┐ [Tambah]│  │
│  │  │ Subtask baru...         │ │ Inbox ▼ │         │  │
│  │  └─────────────────────────┘ └─────────┘         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│                              [ Batal ] [ Tambah Task ] │
└────────────────────────────────────────────────────────┘
```

---

## 4. Technical Architecture & Component Changes

### 4.1. Component: `TaskFormModal` in `static/index.html`

1. **State Addition:**
   ```javascript
   const [showAdvanced, setShowAdvanced] = React.useState(isEdit);
   ```
   - For new tasks (`!isEdit`): default to `false`.
   - For existing task edits (`isEdit`): default to `true`.

2. **Active Count Computation:**
   Compute non-default / populated fields inside the advanced section to show an active indicator badge:
   ```javascript
   const advancedFilledCount = React.useMemo(() => {
     let count = 0;
     if (form.gtd_status && form.gtd_status !== 'inbox') count++;
     if (form.context && form.context.trim()) count++;
     if (form.list_id) count++;
     if (recurringOn) count++;
     if (form.description && form.description.trim()) count++;
     if (pendingSubtasks.length > 0) count += pendingSubtasks.length;
     if (form.waiting_for && form.waiting_for.trim()) count++;
     return count;
   }, [form.gtd_status, form.context, form.list_id, recurringOn, form.description, pendingSubtasks, form.waiting_for]);
   ```

3. **Layout Restructuring:**
   - **Primary Row:**
     ```javascript
     <div className="task-quick-attributes">
       <div>
         <label className="input-label">Deadline</label>
         <input type="date" className="input" value={form.deadline} onChange={e => set('deadline', e.target.value)} />
       </div>
       <div>
         <label className="input-label">Priority</label>
         <select className="input" value={form.priority} onChange={e => set('priority', e.target.value)}>
           <option value="P1">🔴 P1 Critical</option>
           <option value="P2">🟠 P2 High</option>
           <option value="P3">🟡 P3 Medium</option>
           <option value="P4">🟢 P4 Low</option>
         </select>
       </div>
       <div>
         <label className="input-label">Project</label>
         <ComboSelect value={form.project} onChange={v => set('project', v)} options={projects} placeholder="— Pilih Project —" icon="📁" />
       </div>
     </div>
     ```

   - **Accordion Toggle:**
     Rendered when `!isEdit`:
     ```javascript
     <button
       type="button"
       onClick={() => setShowAdvanced(prev => !prev)}
       className="task-advanced-toggle"
       style={{
         display: 'flex',
         alignItems: 'center',
         justifyContent: 'space-between',
         width: '100%',
         padding: '8px 12px',
         marginBottom: showAdvanced ? 12 : 16,
         borderRadius: 8,
         border: '1px dashed var(--border)',
         background: 'var(--bg-primary)',
         color: 'var(--text-secondary)',
         cursor: 'pointer',
         fontSize: 12,
         fontWeight: 600,
         transition: 'background 0.15s, border-color 0.15s'
       }}
     >
       <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
         <Icon name={showAdvanced ? 'chevron-down' : 'chevron-right'} size={14} />
         {showAdvanced ? 'Sembunyikan Opsi Tambahan' : 'Opsi Tambahan (GTD, Context, Deskripsi, Subtask)'}
       </span>
       {!showAdvanced && advancedFilledCount > 0 && (
         <span style={{ background: 'var(--accent)', color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
           {advancedFilledCount} diisi
         </span>
       )}
     </button>
     ```

   - **Advanced Container:**
     Rendered when `isEdit || showAdvanced`:
     Encapsulates GTD Status, Context, Shared List, Recurrence, Description, and Subtasks.

---

## 5. Mobile & Responsive Styling

In `static/app.css`:
```css
/* TaskFormModal 3-column quick attributes */
.task-quick-attributes {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
@media (max-width: 640px) {
  .task-quick-attributes {
    grid-template-columns: 1fr;
    gap: 8px;
  }
}
.task-advanced-toggle:hover {
  background: var(--bg-hover) !important;
  border-color: var(--accent) !important;
  color: var(--text-primary) !important;
}
```

---

## 6. Backward Compatibility & Data Integrity

- **Form Submission Unchanged:** All data fields submitted to `onSave` / `onOfflineSave` are identical. `gtd_status` defaults to `'inbox'`, `priority` defaults to `'P3'`.
- **Keyboard Shortcuts:** Hitting Enter in the title input continues to trigger task creation seamlessly.
- **Offline & Outbox Synchronization:** Unchanged. All IndexedDB and outbox queuing mechanics operate without modification.
- **Subtasks & MentionInput:** Preserved identically inside the advanced section.

---

## 7. Testing & Verification Plan

### 7.1. Offline Unit Tests (`tests/offline/task_modal_progressive_disclosure.test.js`)
1. **Initial Mount State:** Verify `showAdvanced` is false for new tasks (`!isEdit`) and true for edit mode (`isEdit`).
2. **Compact View Elements:** Verify Title, Deadline, Priority, and Project are present in the primary DOM block.
3. **Advanced Toggle Behavior:** Verify clicking the toggle flips `showAdvanced`.
4. **Advanced Fields Containment:** Verify GTD Status, Context, Recurrence, Description, and Subtasks are contained within the collapsible section.
5. **Indicator Pill:** Verify `advancedFilledCount` increments when a non-default GTD status, context, description, or subtask is set.
6. **Submission Payload Integrity:** Verify saving a task from compact mode sends default `inbox` GTD status and `P3` priority.

### 7.2. Full Test Suite Verification
- `node scratch/check_inline.js static/index.html` (5/5 scripts OK)
- `node --test tests/offline/*.test.js` (all suites pass)
- `python -m pytest tests/` (61/61 backend tests pass)
