# Mindmap Sub-Map & Inter-Mindmap Linking Design

**Date:** 2026-08-19  
**Status:** Approved  
**Author:** Antigravity & User  
**Target:** TaskFlow v4 Mindmap System

---

## 1. Problem & Context

Mindmaps are inherently single-rooted trees (each node has exactly one parent). However, many real-world domains — such as **family genealogies (*silsilah keluarga*)**, complex multi-tier project roadmaps, and software architectural diagrams — require multi-parent or modular sub-hierarchies (e.g. maternal vs. paternal ancestry, or microservice drill-down).

Attempting to force massive multi-parent structures into a single mindmap canvas leads to visual clutter, performance degradation, and layout limitations.

**Solution:** **Sub-Map Linking / Drill-Down Navigation**.
Nodes in a mindmap can be linked to other mindmaps (`type: 'mindmap'`). Clicking a linked sub-map badge immediately opens or focuses that mindmap in the **Multi-Tab View**, enabling modular, infinitely-nestable mindmap ecosystems.

---

## 2. Architecture & Data Model

### 2.1 Link Data Structure
Existing node links in `data_json` support `'note'` and `'task'`. We extend the union type to `'mindmap'`:

```typescript
type NodeLink = 
  | { type: 'note'; id: number; title: string; preview?: string }
  | { type: 'task'; id: number; title: string; priority?: string; deadline?: string; status?: string }
  | { type: 'mindmap'; id: number; title: string };
```

Nodes in `data_json` store links in an array:
```json
{
  "id": "node_maternal_line",
  "topic": "Ibu (Siti)",
  "links": [
    {
      "type": "mindmap",
      "id": 142,
      "title": "Silsilah Keluarga Besar Ibu Siti"
    }
  ]
}
```

---

## 3. User Experience & UI Specifications

### 3.1 Link Picker Modal (Iframe & Parent)
Both the inline Link Picker in the canvas iframe (`static/vendor/mind-elixir/index.html`) and the parent `LinkPickerModal` (`static/index.html`) will include:
1. **Tabs:** `Semua` | `Notes` | `Tasks` | `Mindmaps` (new tab with icon `🧠`).
2. **Search Results:** Display matching mindmaps from `GET /api/search?q=...` with badge `MAP` (accent purple/indigo `#8b5cf6`).
3. **Quick Create Action:** When query text is typed, show **`➕ Mindmap "{query}"`** button.
   * Clicking this creates a new mindmap (`POST /api/mindmaps` with `{ title: query, data_json: ... }`), then automatically adds it as a `{ type: 'mindmap', id, title }` link to the active node.

### 3.2 Canvas Link Panel & Badge
* In the right sidebar **🔗 Links** pane (`static/vendor/mind-elixir/index.html`):
  * Mindmap links render with badge `MAP` (`background: #8b5cf6; color: #fff`).
  * Action button `↗` (Buka) sends `postMessage({ type: 'openMindmap', id: link.id }, window.location.origin)`.
* In the node link count badge (`.node-link-badge`), mindmap links increment the badge count identically to notes and tasks.

### 3.3 Outline View Integration
* In `MindmapOutline` (`static/index.html`):
  * Mindmap link chips render with icon `🧠` and label `MAP`.
  * Clicking the link calls `onOpenMindmap(link.id)`, which dispatches the `openMindmap` event to open/switch tabs in the parent app.

### 3.4 Multi-Tab System Interaction
When an `openMindmap` event/message is triggered:
1. If the target mindmap is already present in `openTabs`:
   * Set `activeTabId = targetId` (instant 0ms switch without reloading or losing state).
2. If the target mindmap is not in `openTabs`:
   * Fetch full record from `/api/mindmaps/{id}`.
   * Call `mindmaptabs.openTab(prevTabs, fullMindmap, 5)` to add the tab (auto-evicting the oldest if at 5 tabs) and activate it.

---

## 4. Error Handling & Edge Cases

1. **Deleted / Inaccessible Mindmap:**
   * If a linked mindmap has been deleted or is inaccessible, `selectMindmap` catches the 404 and displays toast: *"Mindmap tidak ditemukan atau telah dihapus"*.
2. **Self-Linking Guard:**
   * In the Link Picker, prevent linking a mindmap to itself by filtering out the currently opened mindmap ID from search results.
3. **Offline Behavior:**
   * If offline and the linked mindmap is cached in local storage / IndexedDB, it opens offline. If not cached, toast alerts user: *"Mindmap tidak tersedia — offline"*.

---

## 5. Verification Plan

1. **Automated Unit Tests:**
   * Test link picker selection and type handling for `'mindmap'`.
   * Test `MindmapOutline` rendering and click dispatch for `'mindmap'` links.
   * Full test suite regression (`npm test` & `pytest`).
2. **Manual / Device Verification Checklist:**
   * Open a mindmap $\rightarrow$ select a node $\rightarrow$ open Link panel $\rightarrow$ search mindmap $\rightarrow$ attach link.
   * Test Quick-Create: type new title $\rightarrow$ click `➕ Mindmap` $\rightarrow$ verify newly created mindmap is attached.
   * Click `↗` on `MAP` link $\rightarrow$ verify target mindmap opens in a new tab.
   * Switch back to primary mindmap $\rightarrow$ click `↗` again $\rightarrow$ verify tab switches smoothly without duplication.
