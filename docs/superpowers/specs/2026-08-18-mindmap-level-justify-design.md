# Design Spec: Mindmap Level-Justify (Columnar & Row Depth Alignment)

**Date:** 2026-08-18  
**Status:** Approved  
**Author:** Antigravity (Gemini 3.7 Flash)

---

## 1. Executive Summary

Saat ini, cabang-cabang mindmap pada Mind-Elixir tersusun secara organik berdasarkan panjang teks masing-masing node induk (*parent*), sehingga node pada kedalaman/level yang sama berada pada posisi koordinat yang berbeda (staggered).

Fitur **Level-Justify** menambahkan opsi penataan layout baru di mana node-node yang berada pada **tingkat kedalaman/level yang sama** ($L = 1, 2, 3, \dots$) akan diratakan secara sejajar:
- **Arah Horizontal (Left, Right, Dual):** Node pada level yang sama memiliki lebar slot seragam sehingga semua anak (*child*) di level berikutnya sejajar tegak lurus membentuk **kolom-kolom vertikal**.
- **Arah Vertikal (Bottom / Org Chart):** Node pada level yang sama memiliki tinggi slot seragam sehingga sejajar membentuk **baris-baris horizontal**.

Fitur ini diaktifkan/dinonaktifkan melalui tombol toggle chip `[ ⇤⇥ Justify ]` di toolbar atas mindmap, berdampingan dengan tombol pengatur arah (`←`, `→`, `⇄`, `↓`).

---

## 2. Requirements & User Stories

1. **Opsi Pengaturan Serbaguna:**
   * Pengguna dapat mengaktifkan atau menonaktifkan mode Justify kapan saja untuk seluruh 4 varian arah (`Left`, `Right`, `Dual/Side`, `Bottom`).
2. **Preservasi State & Auto-Save:**
   * Status aktif/tidak aktif (`justify: true/false`) tersimpan di dalam mindmap (`data_json.justify`) dan otomatis dipulihkan saat mindmap dimuat ulang atau berpindah tab.
3. **Performa & Responsivitas:**
   * Perhitungan perataan level instan (0ms flicker) dan garis penghubung (*SVG branch lines*) otomatis diperbarui menggunakan `mind.linkDiv()`.
4. **Indikator Visual Jelas:**
   * Tombol chip toolbar `[ ⇤⇥ Justify ]` memberikan umpan balik visual jelas (warna aksen aktif vs netral tidak aktif).

---

## 3. Data Model & Persistence

Parameter `justify` disimpan sebagai boolean di dalam payload JSON mindmap (`data_json`):

```json
{
  "nodeData": {
    "id": "root",
    "topic": "Central Topic",
    "root": true,
    "children": [...]
  },
  "direction": 2,
  "justify": true
}
```

* `justify`: `false` (default / organik) atau `true` (level justify aktif).

---

## 4. UI & Interaction Design

### Toolbar Header Mindmap

Di komponen `MindmapTabInstance` pada `static/index.html`:
* Di samping tombol direction `[ ← | → | ⇄ | ↓ ]`, ditambahkan tombol chip toggle Justify:
  * **Icon/Label:** `[ ⇤⇥ Justify ]` (atau `[ ⇤⇥ ]` di layar kecil / mobile dengan tooltip `"Ratakan kolom level (Justify)"`).
  * **Gaya Saat Non-Aktif (`justify === false`):**
    * Background: `var(--bg-card)`
    * Border: `1px solid var(--border)`
    * Color: `var(--text-secondary)`
  * **Gaya Saat Aktif (`justify === true`):**
    * Background: `var(--accent)`
    * Border: `1px solid var(--accent)`
    * Color: `#000000` (kontras aksen tema)
    * Font Weight: `700`

---

## 5. Layout Engine Implementation (Level Alignment Algorithm)

Di dalam Iframe Mindmap (`static/vendor/mind-elixir/index.html`), ditambahkan helper `applyLevelJustify(mind, justify)`:

```javascript
function applyLevelJustify(mind, isJustify) {
  if (!mind || !mind.map) return;
  const root = mind.map.querySelector("me-root");
  if (!root) return;

  const isVertical = mind.direction === 3; // Bottom / Org Chart

  if (!isJustify) {
    // Reset custom min-width / min-height on all node containers
    mind.map.querySelectorAll("me-parent").forEach(el => {
      el.style.minWidth = "";
      el.style.minHeight = "";
    });
    mind.linkDiv();
    return;
  }

  // Traversal untuk mengelompokkan elemen me-parent per depth level
  const levels = new Map(); // depth -> array of { parentEl, tpcEl }

  function traverse(wrapper, depth) {
    const parentEl = wrapper.querySelector(":scope > me-parent");
    const tpcEl = parentEl?.querySelector(":scope > me-tpc");
    if (parentEl && tpcEl) {
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push({ parentEl, tpcEl });
    }
    const childrenEl = wrapper.querySelector(":scope > me-children");
    if (childrenEl) {
      const childWrappers = childrenEl.querySelectorAll(":scope > me-wrapper");
      childWrappers.forEach(cw => traverse(cw, depth + 1));
    }
  }

  // Cari semua main wrappers (cabang utama level 1)
  const mainWrappers = mind.map.querySelectorAll("me-main > me-wrapper");
  mainWrappers.forEach(mw => traverse(mw, 1));

  // Terapkan dimensi seragam per level
  levels.forEach((nodes, depth) => {
    if (isVertical) {
      // Untuk arah Bottom (Org chart): seragamkan tinggi
      let maxH = 0;
      nodes.forEach(n => {
        n.parentEl.style.minHeight = "";
        maxH = Math.max(maxH, n.tpcEl.offsetHeight);
      });
      nodes.forEach(n => {
        n.parentEl.style.minHeight = maxH + "px";
      });
    } else {
      // Untuk arah Horizontal (Left, Right, Dual): seragamkan lebar
      let maxW = 0;
      nodes.forEach(n => {
        n.parentEl.style.minWidth = "";
        maxW = Math.max(maxW, n.tpcEl.offsetWidth);
      });
      nodes.forEach(n => {
        n.parentEl.style.minWidth = maxW + "px";
      });
    }
  });

  // Gambar ulang garis SVG cabang penghubung
  mind.linkDiv();
}
```

### Hook ke Lifecycle Mind-Elixir
Helper `applyLevelJustify` dipanggil pada:
1. Saat pesan `{ type: 'load', data }` diterima dari parent.
2. Saat pesan `{ type: 'setJustify', justify }` diterima dari parent.
3. Setelah operasi yang mengubah pohon struktur: `mind.bus.addListener('operation', () => { if (mind.isJustify) applyLevelJustify(mind, true); })`.
4. Setelah pergantian arah: `mind.bus.addListener('changeDirection', () => { if (mind.isJustify) applyLevelJustify(mind, true); })`.

---

## 6. Protokol Komunikasi (Iframe & Parent)

| Pengirim | Event Type | Payload | Deskripsi |
| :--- | :--- | :--- | :--- |
| **Parent $\rightarrow$ Iframe** | `setJustify` | `{ type: 'setJustify', justify: boolean }` | Mengubah status justify dan trigger render ulang |
| **Parent $\rightarrow$ Iframe** | `load` | `{ type: 'load', data: { ..., justify: boolean }, title: string }` | Memuat data awal termasuk flag justify |
| **Iframe $\rightarrow$ Parent** | `change` | `{ type: 'change', data: { ..., justify: boolean } }` | Mengirim data terupdate saat justify berubah untuk disimpan |

---

## 7. Testing & Verification

1. **Unit Tests (Node test runner):**
   * Verifikasi serialisasi dan deserialisasi payload `data_json.justify`.
   * Verifikasi helper function `applyLevelJustify` logika perataan dimensi per level.
2. **Browser / UI Tests:**
   * Buka mindmap dengan banyak cabang bercabang tidak beraturan.
   * Klik tombol `[ ⇤⇥ Justify ]` $\rightarrow$ periksa semua node level 1 sejajar dalam kolom 1, node level 2 sejajar kolom 2, dst.
   * Ganti arah layout (`←`, `→`, `⇄`, `↓`) $\rightarrow$ pastikan mode justify tetap bekerja secara adaptif.
   * Reload / ganti tab $\rightarrow$ pastikan status justify tersimpan dan tidak reset.
