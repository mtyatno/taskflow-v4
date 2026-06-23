# Weekly Backup Reminder — Design

**Date:** 2026-06-23
**Status:** Approved

## Goal

Remind the user to download a data backup roughly once a week, so they don't go
long stretches without an exported copy of their notes/tasks/habits. The existing
Settings → "Backup & Export" section already provides a "⬇ Download Backup (.zip)"
button (`handleExport`); this feature adds a proactive reminder around it.

## Behavior

Per-device tracking via `localStorage` (no backend/DB changes):

- `tf_last_backup` — ISO timestamp, written whenever a backup `.zip` downloads
  successfully (from either the Settings button or the reminder banner).
- `tf_backup_snooze` — `YYYY-MM-DD` date string, written when the user dismisses
  the banner.

**Show the banner** (top of Dashboard) when, evaluated on app open / Dashboard
render, ALL hold:
1. user is logged in, AND
2. it has been **≥ 7 days** since `tf_last_backup`, AND
3. not snoozed today (`tf_backup_snooze` !== today's date).

**Baseline (no day-1 nag):** if `tf_last_backup` is unset (fresh install, or an
existing user receiving this update), set it to *now* on first detection. The
first reminder therefore appears 7 days later, never immediately.

## Banner UI

A dismissible notice card at the top of the Dashboard page:

> 💾 Sudah seminggu lebih sejak backup terakhir. Amankan datamu. **[⬇ Download Backup]** **✕**

- **⬇ Download Backup** → triggers the export directly (reuses the export helper).
  On success: writes `tf_last_backup`, banner disappears. On failure (e.g. offline):
  toast error, timestamp unchanged, banner stays.
- **✕** → snooze 1 day (`tf_backup_snooze` = today); reappears the next day if
  still no backup.

Styling follows existing in-app notice/banner patterns (warning/info accent),
consistent with the app's look.

## Code structure

- **Extract** the current Settings `handleExport` logic into a shared
  `downloadBackup()` helper: performs the fetch to `/api/export/download`,
  triggers the file download, and on success writes `tf_last_backup`. Both the
  Settings button and the banner call it — downloading from *either* place
  silences the reminder.
- **New `BackupReminder` component**, rendered at the top of the Dashboard.
  Self-contained: reads/writes localStorage, computes whether to show, renders
  the banner, and calls `downloadBackup()`.

## Scope / non-goals

- Frontend-only. No backend endpoint, no DB field, no new permissions.
- No OS push notifications (rejected: unreliable for PWA/Tauri, much more work).
- No account-wide sync of last-backup time (rejected for simplicity; per-device
  localStorage is sufficient).
- Constants: backup interval = 7 days; snooze = 1 day.
- Bump service worker cache version on ship (static change).

## Edge cases

- Offline / export fails → toast, no timestamp write, banner persists.
- Brand-new or freshly-updated user → baseline set to now, no immediate nag.
- Logged out → never shown.
