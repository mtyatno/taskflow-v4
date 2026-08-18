# Design Specification: Mindmap Multi-Tab View

**Date:** 2026-08-18  
**Author:** AI Pair Programmer (Antigravity / Gemini) & User  
**Status:** Approved  
**Target Release:** TaskFlow v5.0  

---

## 1. Overview & Purpose

Feature ini menambahkan dukungan **Multi-Tab View** pada halaman `MindmapPage` di TaskFlow, memungkinkan pengguna untuk membuka hingga **5 mindmap secara bersamaan** dalam tab terpisah di bagian atas layar. Fitur ini mengadopsi pola interaction & visual design yang sudah ada pada halaman `NotesPage` (`note-tab-bar`).

---

## 2. Requirements & Key Decisions

1. **Batas Maksimal Tab (Cap = 5):**
   * Pengguna dapat membuka maksimal 5 tab mindmap bersamaan.
   * Saat membuka mindmap ke-6, tab tertua (indeks 0 pada `openTabs`) akan ditutup secara otomatis untuk menjaga efisiensi RAM.

2. **Multi-Iframe Instances (Instant Tab Switch):**
   * Setiap tab mindmap yang terbuka merender instansi editor tersendiri (`.mindmap-tab-view-instance`).
   * Tab aktif diberikan style `display: flex; flex: 1; height: 100%`, sedangkan tab non-aktif disembunyikan dengan `display: none`.
   * **Manfaat:** Tab switch terjadi instan (0ms delay) tanpa reload iframe, serta mempertahankan state internal canvas/outline (posisi pan/zoom, node terpilih, undo-history Mind-Elixir).

3. **Automated Tab Lifecycle:**
   * **Open:** Memilih mindmap dari sidebar atau hasil pencarian global akan membuka tab baru (atau berpindah ke tab tersebut jika sudah terbuka).
   * **Create:** Membuat mindmap baru otomatis membuka tab baru dan menjadikannya tab aktif.
   * **Delete:** Menghapus mindmap otomatis menutup tab mindmap tersebut dan berpindah ke tab terdekat.
   * **Rename:** Mengubah nama mindmap memperbarui judul tab secara real-time.

---

## 3. Component Architecture & UI Layout

### UI Hierarchy in `MindmapPage`
```
div.mindmap-container
├── div.mindmap-sidebar (collapsible list)
└── div.mindmap-main
    ├── div.mindmap-tab-bar (NEW)
    │   ├── div.mindmap-tab-item[.active]
    │   │   ├── span.mindmap-tab-title
    │   │   └── button.mindmap-tab-close (×)
    │   └── ... (max 5 items)
    └── div.mindmap-tab-contents
        ├── div.mindmap-tab-view-instance (id: mm-1, display: flex)
        │   ├── header.mindmap-header
        │   ├── div.mindmap-canvas-container (iframe mind-elixir)
        │   └── div.mindmap-outline-container (MindmapOutline)
        ├── div.mindmap-tab-view-instance (id: mm-2, display: none)
        └── ...
```

### CSS Styling
Aturan CSS baru disisipkan di [`static/app.css`](file:///Z:/Todolist%20Manager%20V5.0/static/app.css) atau diselaraskan dengan kelas `.note-tab-bar` yang ada:
* `.mindmap-tab-bar`: `display: flex; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); overflow-x: auto; flex-shrink: 0;`
* `.mindmap-tab-item`: `display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer; border-right: 1px solid var(--border-color); font-size: 13px;`
* `.mindmap-tab-item.active`: `background: var(--bg-primary); font-weight: 600; border-bottom: 2px solid var(--accent-color);`
* `.mindmap-tab-close`: `border: none; background: transparent; cursor: pointer; border-radius: 50%; font-size: 14px;`

---

## 4. State & Event Disambiguation

### 1. Tab State Structure
```javascript
const [openTabs, setOpenTabs] = useState([]); // [{ id, title, data_json, viewMode, direction }]
const [activeTabId, setActiveTabId] = useState(null);
```

### 2. Message Disambiguation (`postMessage`)
Setiap instansi tab mendengarkan event message dari iframe-nya sendiri dengan mencocokkan `e.source`:
```javascript
useEffect(() => {
  const handleMessage = (e) => {
    if (e.source !== iframeRef.current?.contentWindow) return;
    // Process auto-save, links, openNote event for THIS tab only
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}, [tab.id]);
```

---

## 5. Verification & Test Plan

1. **TDD / Unit Tests:**
   * Menambahkan unit test di `tests/offline/` untuk helper manajemen tab (openTab, closeTab, eviction pada tab ke-6, active tab fallback saat close).
2. **Browser Verification:**
   * Buka 5 mindmap berbeda -> pastikan tab bar menampilkan 5 tab.
   * Buka mindmap ke-6 -> pastikan tab ke-1 tertutup dan tab ke-6 aktif.
   * Switch antar-tab -> pastikan posisi pan/zoom canvas di tab sebelumnya tidak ter-reset.
   * Edit judul -> pastikan judul tab berubah instan.
   * Hapus mindmap aktif -> pastikan tab tertutup dan tab sebelahnya diaktifkan.
3. **Regression Tests:**
   * Jalankan `npm test` untuk memastikan 406 test eksisting tetap 100% pass hijau.
