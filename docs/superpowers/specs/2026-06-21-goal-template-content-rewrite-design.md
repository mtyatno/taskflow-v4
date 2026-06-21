# Goal Template Content Rewrite — Design

**Date:** 2026-06-21
**Status:** Approved (design), pending implementation

## Problem

The Goal tab ("Buat Baru → Goal") generates Habits and Tasks from `habit_templates`,
seeded from `habits_tasks_1000.json`. Those 1000 rows were produced by a mechanical
permutation — `{verb} {subkategori} {durasi} menit {waktu}` (e.g. "Perbaiki kontrol diri
20 menit pagi") — so the suggestions read as robotic, near-duplicate, and unhelpful.

## Goal

Replace the formulaic templates with a small, hand-curated set of natural, specific,
actionable Indonesian habits and tasks per subcategory.

## Scope

- **In:** new curated content, a generator script, a versioned DB reseed migration.
- **Out:** frontend/UX changes (GoalForm already reads `/api/habit-templates`), changes
  to the admin template editor, changes to the habit/task creation flow.

## Data Model (unchanged schema)

Each template row keeps its existing fields:
`kategori, subkategori, type (habit|task), item, frequency (daily|weekly|monthly),
priority (low|medium|high), difficulty (easy|medium|hard), tags (JSON array)`.

There are **6 kategori** and **21 (kategori, subkategori) pairs** — note `Sosial` appears
under both `Relasi & Keluarga` and `Spiritual`, so it is authored twice with
context-appropriate content.

| Kategori | Subkategori |
|---|---|
| Karir | Networking, Produktivitas kerja, Profesionalisme |
| Keuangan | Investasi, Kontrol diri, Menabung, Pengeluaran |
| Pengembangan Diri | Belajar, Mindset, Skill |
| Produktivitas | Disiplin, Fokus kerja, Manajemen waktu, Organisasi |
| Relasi & Keluarga | Kebersamaan, Kepedulian, Komunikasi, Sosial |
| Spiritual | Ibadah, Refleksi, Sosial |

## Content Rules

- **~6 habits + ~6 tasks** per (kategori, subkategori) pair → ~250 items total.
- Natural, concrete, specific. No `{verb} {subkat} {N} menit {waktu}` permutations.
- Habits: small recurring actions, mostly `daily`/`weekly`.
- Tasks: setup/one-off/periodic actions, mostly `weekly`/`monthly`.
- `priority`/`difficulty` assigned per item by judgment.
- `tags`: `[subkategori_lower, kategori_tag]` (same convention as current data) to keep
  the schema consistent; tags are not currently consumed by GoalForm but kept valid.

## Components

### 1. Generator — `scripts/gen_habit_templates.py`
Holds the curated content as Python literals (per pair: lists of habit/task entries with
metadata), fills in `kategori`/`subkategori`/`tags`, and writes
`habit_templates_curated.json`. Re-runnable; the JSON is the build artifact committed to
the repo.

### 2. Reseed migration (server)
- New tiny table `app_meta(key TEXT PRIMARY KEY, value TEXT)` (created in `migrate_db()`).
- Constant `HABIT_TEMPLATES_SEED_VERSION` in `webapp.py`.
- `seed_habit_templates()` becomes version-aware:
  1. Read `app_meta['habit_templates_version']`.
  2. If missing/less than target → `DELETE FROM habit_templates`, insert all rows from
     `habit_templates_curated.json`, set `app_meta['habit_templates_version']` to target.
  3. Else no-op.
- Idempotent across restarts; reseeds once per version bump.
- Point the seed loader at the new JSON filename.

**Rejected alternatives:** `PRAGMA user_version` (global to the whole DB, collision risk);
sentinel file (fragile across deploys/hosts).

## Data Flow

deploy → startup → `migrate_db()` (ensures `app_meta`) → `seed_habit_templates()`
(version check → wipe+reseed if stale) → `/api/habit-templates` serves curated rows →
GoalForm renders curated habits/tasks.

## Error Handling

- If the JSON file is missing, skip reseed (same guard as today) — never crash startup.
- Wrap reseed in the existing `get_db()` transaction so a failure rolls back and leaves
  the prior data intact.

## Verification

- Generated JSON: every (kategori, subkategori) pair has ≥1 habit and ≥1 task; total
  ~250; no item matches the old `\d+ menit (pagi|siang|malam)` pattern; field values are
  within allowed domains.
- After reseed: row count matches JSON; spot-read several subcategories in the UI.

## Out-of-scope follow-ups

- Rebuild `.exe`/APK (native) is not required for this server-side/data change but can be
  done later if desired.
