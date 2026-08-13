# Goal System Design

**Date:** 2026-04-27
**Status:** Approved

## Overview

Add a "Goal" tab to the existing "Buat Baru" modal, allowing users to create goals from an offline template library. Each goal generates a set of pre-configured habits and tasks, all auto-tagged with `#goal-<slug>` for tracking.

---

## Architecture

Template data is stored as a JS constant `GOAL_TEMPLATES` in `static/index.html` — no backend or DB changes required. Goal state is implicit: a goal exists as long as its tagged habits/tasks exist in the system.

**Data flow:**

1. User opens "Buat Baru" modal → clicks "Goal" tab
2. Two-step UX: pick category → pick sub-template
3. User fills in goal name + optionally unchecks unwanted habits/tasks
4. Frontend POSTs each item to existing `/api/tasks` and `/api/habits` endpoints
5. Modal closes, toast confirmation shown

No new DB tables. No new API endpoints.

---

## Template Structure

```js
const GOAL_TEMPLATES = [
  {
    id: "kesehatan",
    label: "Kesehatan",
    icon: "💪",
    templates: [
      {
        id: "olahraga-rutin",
        label: "Olahraga Rutin",
        desc: "Bangun kebiasaan olahraga 3x seminggu",
        habits: [
          { title: "Olahraga 30 menit", freq: 3 }
        ],
        tasks: [
          { title: "Beli perlengkapan olahraga" },
          { title: "Tentukan jadwal olahraga mingguan" }
        ]
      }
    ]
  }
]
```

### Starter Categories (6 categories, ~15 sub-templates total)

| Category          | Sub-templates                                   |
| ----------------- | ----------------------------------------------- |
| Kesehatan 💪      | Olahraga Rutin, Pola Makan Sehat, Tidur Teratur |
| Produktivitas ⚡   | Deep Work, Inbox Zero, Belajar Skill Baru       |
| Keuangan 💰       | Tabung 20%, Catat Pengeluaran, Lunasi Utang     |
| Belajar 📚        | Baca Buku, Kursus Online, Bahasa Baru           |
| Relasi ❤️         | Quality Time Keluarga, Networking               |
| Proyek Pribadi 🚀 | Bangun Produk, Tulis Konten                     |

---

## UI Flow

### Tab placement

Modal tabs: **Task | Habit | Note | Goal**

### Step 1 — Pilih Kategori

- 2-column grid of category cards (icon + label)
- Tap card → navigate to Step 2

### Step 2 — Pilih Sub-template

- Header: "← Kembali" button + category name
- List of sub-template cards: label, short description, preview ("3 habits · 2 tasks")
- Tap card → expand inline form below

### Inline form

```
Nama Goal: [________________]

Habits yang akan dibuat:
  ☑ Olahraga 30 menit (3x/minggu)
  ☑ Stretching pagi (7x/minggu)

Tasks yang akan dibuat:
  ☑ Beli perlengkapan olahraga
  ☑ Tentukan jadwal mingguan

[Buat Goal]
```

- User can uncheck items they don't want
- Goal name is slugified for the tag: "Hidup Sehat" → `#goal-hidup-sehat`
- All generated habits/tasks receive this tag automatically
- "Buat Goal" → POST all checked items → modal closes → toast "Goal berhasil dibuat"

---

## Tag Convention

- Tag format: `#goal-<slug>` where slug is lowercase, spaces replaced with `-`
- Applied to every habit and task generated from the goal
- Existing tag system handles display and filtering with no changes

---

## Scope Boundaries

**In scope:**

- Goal tab + two-step UI in existing modal
- `GOAL_TEMPLATES` constant with 15 starter sub-templates
- Bulk creation of habits + tasks with auto-tag
- User can uncheck individual items before creating

**Out of scope:**

- Goal progress dashboard or dedicated goal view
- Custom goal creation without a template
- Editing or deleting a goal as a unit
- Backend changes or new DB tables
