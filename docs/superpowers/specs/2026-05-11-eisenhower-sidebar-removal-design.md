# Design: Remove Eisenhower Sidebar Section & Set Quadrant as Default GroupBy

**Date:** 2026-05-11  
**Status:** Approved

## Background

Priority (P1-P4) dan Eisenhower quadrant (Q1-Q4) adalah dua hal yang berbeda:

- **Priority (P1-P4):** Diset manual oleh user. Static.
- **Eisenhower (Q1-Q4):** Dikalkulasi otomatis oleh `eisenhower.py` setiap beberapa menit, berdasarkan kombinasi Priority (importance) + Due Date proximity (urgency). Bergerak otomatis seiring waktu.

Saat ini sidebar memiliki section EISENHOWER dengan 4 dedicated page links (Q1, Q2, Q3, Q4). Ini redundan karena:
1. `TaskListView` sudah memiliki filter Quadrant dan groupBy "quadrant" yang berjalan di semua task list pages.
2. Dashboard sudah memiliki Eisenhower Matrix 2x2 untuk overview lintas status.

## Goal

- Hapus section EISENHOWER dari sidebar.
- Jadikan groupBy "quadrant" sebagai default view di semua task list pages.
- Tidak ada perubahan logika kalkulasi Q1-Q4 di backend.

## Design

### 1. Sidebar — Hapus Section EISENHOWER

Hapus 5 entri dari array `links` di komponen `Sidebar` (`static/index.html` ~line 1704):

```js
// HAPUS:
{ section: "EISENHOWER" },
{ id: "q1", icon: "🔥", label: "Q1 Lakukan", count: qc("Q1") },
{ id: "q2", icon: "📅", label: "Q2 Rencanakan", count: qc("Q2") },
{ id: "q3", icon: "👋", label: "Q3 Delegasikan", count: qc("Q3") },
{ id: "q4", icon: "🗑️", label: "Q4 Singkirkan", count: qc("Q4") },
```

Sekaligus hapus `pendingByQuadrant` useMemo dan `qc()` helper di dalam `Sidebar` — keduanya hanya dipakai untuk counter ke-4 link tersebut.

### 2. Routing — Hapus Q Pages

Hapus referensi Q1-Q4 sebagai page dari 3 lokasi di `renderContent()` / helper functions:

**`getFilteredTasks()`** — hapus 4 case:
```js
// HAPUS:
case "q1": return tasks.filter(t => t.quadrant === "Q1" && ...);
case "q2": return tasks.filter(t => t.quadrant === "Q2" && ...);
case "q3": return tasks.filter(t => t.quadrant === "Q3" && ...);
case "q4": return tasks.filter(t => t.quadrant === "Q4" && ...);
```

**`getPageTitle()`** — hapus keys `q1, q2, q3, q4` dari object `titles`.

**`getPageIcon()`** — hapus keys `q1, q2, q3, q4` dari object `icons`.

**`showQuadrant` prop** — sederhanakan dari:
```js
showQuadrant={!["q1","q2","q3","q4"].includes(page)}
```
Cukup hapus prop (default di `TaskListView` sudah `showQuadrant = true`).

### 3. Default GroupBy — Quadrant

Ubah 1 baris di `TaskListView` (~line 5150):

```js
// Before
const [groupBy, setGroupBy] = useState(() => localStorage.getItem("tf_groupby") || "none");

// After
const [groupBy, setGroupBy] = useState(() => localStorage.getItem("tf_groupby") || "quadrant");
```

User yang sudah memiliki nilai `"tf_groupby"` di localStorage tidak terpengaruh — perubahan ini hanya berlaku untuk fresh session atau setelah clear localStorage.

## Scope

| File | Perubahan |
|------|-----------|
| `static/index.html` | Satu-satunya file yang diubah |

Tidak ada perubahan backend, tidak ada perubahan `eisenhower.py`, tidak ada perubahan model.

## Out of Scope

- Badge Q1-Q4 di task card — tidak ditambahkan (keputusan user).
- Perubahan default groupBy per-page — semua pages menggunakan satu shared localStorage key.
- Eisenhower Matrix di Dashboard — tidak diubah, tetap ada.
