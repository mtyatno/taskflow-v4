# Offline Optimistic State — Design Spec

**Date:** 2026-04-18
**Status:** Approved

## Context

Saat offline, user bisa membuat task baru. Task tersimpan di IndexedDB queue dan tersync saat kembali online. Namun task baru **tidak langsung muncul** di GTD panel, Eisenhower panel, maupun sidebar counts — user hanya melihatnya setelah kembali online.

Root cause utama: Service worker lama (`taskflow-v3`) serve cached `index.html` yang belum memiliki `handleOfflineSave` (logic yang menambah task ke React state). Fix SW sudah dilakukan (bump ke `taskflow-v4`, network-first untuk `/`). Setelah fix SW, GTD **seharusnya sudah berfungsi** karena filter GTD pakai `gtd_status` dari form input user.

Dua gap tersisa:
1. **Eisenhower quadrant** selalu `"Q4"` (hardcoded) — task muncul di kuadran salah
2. **Sidebar counts** dari `summary` API cache — tidak termasuk pending offline tasks

---

## Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Pendekatan | Optimistic local state (Approach A) — tambah ke React `tasks` state langsung saat offline |
| GTD | Tidak perlu perubahan code — sudah correct setelah fix SW |
| Eisenhower | Hitung quadrant lokal dari `priority` + `deadline_date` |
| Sidebar counts | Merge pending tasks ke dalam count display |
| Visual pending | Badge "⏳" sudah ada via `_pending: true` flag |

---

## Perubahan

### 1. Local Quadrant Computation (`static/index.html`)

Di `TaskFormModal` offline path (~line 1643), ganti `quadrant: "Q4"` hardcoded dengan hasil fungsi helper:

```js
function computeOfflineQuadrant(priority, deadline_date) {
  const isImportant = priority === "high" || priority === "medium";
  const isUrgent = deadline_date
    ? (new Date(deadline_date) - new Date()) / 86400000 <= 3
    : false;
  if (isImportant && isUrgent)  return "Q1";
  if (isImportant && !isUrgent) return "Q2";
  if (!isImportant && isUrgent) return "Q3";
  return "Q4";
}
```

Dipakai saat membuat `tempTask`:
```js
const tempTask = {
  ...form, id: tempId, _pending: true,
  quadrant: computeOfflineQuadrant(form.priority, form.deadline_date),
  // ... rest unchanged
};
```

Logic mapping ke Eisenhower:
- `priority = high/medium` → important
- `deadline_date` ≤ 3 hari dari sekarang → urgent
- Q1: important + urgent, Q2: important + not urgent, Q3: not important + urgent, Q4: not important + not urgent

Fungsi dideklarasikan **di luar** komponen (pure function, tidak perlu re-declare per render).

---

### 2. Sidebar Counts Merge (`static/index.html`)

Di App component, saat render sidebar nav items, tambahkan counts dari pending tasks ke `summary` counts.

Saat ini sidebar pakai `summary?.by_status?.inbox` dll. dari server cache. Tambahkan:

```js
// Hitung pending tasks per gtd_status
const pendingCounts = React.useMemo(() =>
  tasks
    .filter(t => t._pending)
    .reduce((acc, t) => {
      const s = t.gtd_status || "inbox";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {}),
  [tasks]
);

// Merge ke display count
const sidebarCount = (status) =>
  (summary?.by_status?.[status] || 0) + (pendingCounts[status] || 0);
```

Dipakai di render sidebar nav: ganti raw `summary?.by_status?.inbox` dengan `sidebarCount("inbox")` dst.

---

## Out of Scope

- Edit task offline (existing behavior unchanged)
- Animasi/transisi saat task muncul
- Konflik resolusi saat sync (server tetap jadi source of truth)
- Offline delete task

---

## Verifikasi

1. Matikan jaringan (DevTools → Network → Offline)
2. Buat task baru — pilih priority High, deadline 1 hari lagi, GTD status Inbox
3. Task langsung muncul di **GTD Inbox** dan **Eisenhower Q1**
4. Sidebar count **Inbox** bertambah 1
5. Nyalakan jaringan kembali → task tersync, badge "⏳" hilang, counts dari server
