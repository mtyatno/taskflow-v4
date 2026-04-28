# Goal Templates Databank Design

**Date:** 2026-04-28
**Status:** Approved

## Overview

Replace hardcoded `GOAL_TEMPLATES` in GoalTab with templates derived from `habits_tasks_1000.json` databank. Users select a category, then a subcategory, then pick individual habits/tasks via checklist before creating the goal.

## Data & Architecture

### HABIT_DATABANK constant

Embed the full `habits_tasks_1000.json` (1000 items, ~80KB) directly into `index.html` as a JS constant:

```js
const HABIT_DATABANK = [ /* 1000 items */ ];
```

Each item shape:
```js
{
  kategori: "Produktivitas",
  subkategori: "Fokus kerja",
  type: "habit" | "task",
  item: "Deep work 90 menit pagi",
  frequency: "daily" | "monthly",
  priority: "low" | "medium" | "high",
  difficulty: "easy" | "medium" | "hard",
  tags: ["fokus kerja", "produktivitas"]
}
```

### buildGoalCategories()

Replace `GOAL_TEMPLATES` with a derived function that groups the databank:

```js
function buildGoalCategories() {
  // returns: [{ id, label, icon, subcategories: [{ id, label, items: [...] }] }]
}
```

### Category Icon Mapping

| JSON kategori     | Icon |
|-------------------|------|
| Karir             | 💼   |
| Keuangan          | 💰   |
| Pengembangan Diri | 📚   |
| Produktivitas     | ⚡   |
| Relasi & Keluarga | ❤️   |
| Spiritual         | 🕌   |

### Frequency Mapping

| JSON frequency | App frequency array                                      |
|----------------|----------------------------------------------------------|
| `daily`        | `["mon","tue","wed","thu","fri","sat","sun"]`             |
| `monthly`      | `["mon"]` (once a week as practical approximation)        |

## GoalTab Flow

### Step 1 — Pilih Kategori
Grid 6 kartu, satu per kategori dari `buildGoalCategories()`. Sama seperti sekarang secara visual.

### Step 2 — Pilih Subkategori
Grid subkategori sebagai template cards. Tiap card tampilkan:
- Nama subkategori
- Badge jumlah item (misal "17 items")

### Step 3 — Checklist Item (NEW)
Setelah pilih subkategori, tampilkan semua item dari databank untuk subkategori tersebut, dibagi dua seksi:

**Habits** — daftar habit items dengan checkbox
**Tasks** — daftar task items dengan checkbox

Tiap item tampilkan:
- Nama item
- Badge `frequency` (daily/monthly)
- Badge `priority` (low/medium/high)

Controls per seksi: tombol "Pilih Semua" / "Hapus Semua"

Tombol **"Buat Goal"** aktif jika minimal 1 item dipilih.

## Component Changes

### State

```js
const [step, setStep] = useState(1);           // 1 | 2 | 3
const [selectedCategory, setSelectedCategory] = useState(null);
const [selectedSubcategory, setSelectedSubcategory] = useState(null);
const [selectedItems, setSelectedItems] = useState(new Set());
```

### Create Logic (Step 3 Confirm)

- Items dengan `type: "habit"` → POST `/api/habits` dengan frequency dari mapping
- Items dengan `type: "task"` → POST `/api/tasks` dengan `gtd_status: "next"`
- Semua item mendapat tag `#goal-{slug}` menggunakan `slugifyGoal(subkategori)` yang sudah ada

### Removed

- `const GOAL_TEMPLATES = [...]` — seluruh blok ~200 baris dihapus
- Logic step 2 lama yang auto-create langsung setelah pilih template

### Added

- `const HABIT_DATABANK = [...]` — 1000 item dari JSON
- `function buildGoalCategories()` — grouping databank by kategori → subkategori
- Step 3 checklist UI di dalam GoalTab component

## Scope

- Perubahan hanya di `static/index.html` (GoalTab component + data constants)
- Tidak ada perubahan backend, API baru, atau komponen lain
- `slugifyGoal` helper yang sudah ada digunakan untuk tag generation
