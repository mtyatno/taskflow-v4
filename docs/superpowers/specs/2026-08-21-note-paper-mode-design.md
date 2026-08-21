# Design Spec: Continuous Paper Mode for Note Editor

## 1. Overview
Enhance the existing Milkdown Live Preview editor by adding a "Continuous Paper Mode". This mode visually restyles the editor to resemble a physical sheet of paper (like Google Docs "Pageless" mode or MS Word "Web Layout" with constrained width), giving a professional word-processor feel.

## 2. Approach: Continuous Paper Mode
Instead of building a complex paginated DOM splitting engine (which breaks WYSIWYG stability), we will use CSS to simulate a physical paper sheet.
- The editor container will be centered on a gray background.
- The editor will have a fixed width corresponding to standard paper sizes (e.g., A4: 210mm).
- The editor will have physical paper margins (e.g., 20mm padding).
- As content grows, the paper seamlessly expands downwards (infinite height).

## 3. Data Model & Storage
To persist the paper mode settings per note, we will add a new column to the SQLite database:
- Table: `scratchpad_notes`
- New Column: `meta_json TEXT NOT NULL DEFAULT '{}'`
- The JSON object will store:
  ```json
  {
    "paper_mode": {
      "enabled": true,
      "size": "A4", // A4, Letter, A3, Legal
      "orientation": "portrait" // portrait, landscape
    }
  }
  ```
- The offline synchronization engine (`syncpush.js`, `syncpull.js`, `noterepo.js`) will be updated to transmit and store this `meta_json` field.

## 4. User Interface (UI)
- **Toolbar Toggle**: A new "Kertas" (Paper) button in the `NoteToolbar`.
- **Configuration Popover**: When the Paper Mode is enabled, clicking a setting icon or dropdown allows the user to change:
  - Format (A4, Letter, A3)
  - Orientation (Portrait / Landscape)
- **Visual Styling**:
  ```css
  .paper-mode-active .milkdown-editor-container {
      background: #e5e7eb;
      padding: 2rem 0;
  }
  .paper-mode-active .milkdown-editor {
      background: white;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      margin: 0 auto;
      /* Dynamic inline styles applied based on selected size/orientation */
      width: 210mm; /* A4 Portrait */
      padding: 20mm; /* Margins */
      min-height: 297mm; /* Minimum height before it stretches */
  }
  ```
- **Page Break Guides (Optional UI)**: We can inject subtle CSS background patterns (e.g., repeating horizontal dashed lines every 297mm) to give the user a rough visual cue of where the page breaks will occur if printed.

## 5. Migration Strategy
- `webapp.py`: Add an `ALTER TABLE` statement in the `init_db()` to safely inject `meta_json` into existing databases.
- `noterepo.js`: Update the local IndexedDB schema to include `meta_json` in the object store.
- Backend APIs (`PUT /api/scratchpad/{id}`, `GET /api/scratchpad/{id}`): Update serialization models to parse and return `meta_json`.

## 6. Implementation Steps (For writing-plans phase)
1. Backend Database Migration (`webapp.py`).
2. Offline Engine Schema Update (`noterepo.js`, `noteroutes.js`).
3. Sync Engine Update (`syncpush.js`, `syncpull.js`).
4. UI State Management (React state for `paper_mode`).
5. Toolbar UI Components (Buttons and Dropdowns).
6. CSS Styling for Paper Mode wrapper.
