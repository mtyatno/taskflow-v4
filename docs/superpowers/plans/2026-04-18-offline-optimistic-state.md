# Offline Optimistic State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task yang dibuat saat offline langsung muncul di GTD, Eisenhower, dan sidebar counts — tanpa harus menunggu kembali online.

**Architecture:** Dua perubahan kecil di `static/index.html` — (1) fungsi `computeOfflineQuadrant` untuk menghitung kuadran Eisenhower secara lokal dari `priority` + `deadline_date`, dipakai saat membuat `tempTask` di `TaskFormModal`; (2) `pendingCounts` useMemo di `Sidebar` yang menghitung jumlah pending tasks per `gtd_status` dan per `quadrant`, lalu di-merge ke dalam count sidebar. Tidak ada perubahan backend.

**Tech Stack:** React 18 UMD, single-file SPA (`static/index.html`), IndexedDB (`OfflineDB`).

---

## Files yang Dimodifikasi

- Modify: `static/index.html` — fungsi `computeOfflineQuadrant` (tambah sebelum `TaskFormModal`), baris ~1649 (ganti `quadrant: "Q4"`), baris ~1418 (`Sidebar` component — tambah `pendingCounts` dan update links array)

---

## Task 1: Local Quadrant Computation

**Files:**
- Modify: `static/index.html` — tambah fungsi sebelum `TaskFormModal`, update `tempTask` di baris ~1649–1654

- [ ] **Step 1: Tambah fungsi `computeOfflineQuadrant` sebelum `TaskFormModal`**

  Cari baris yang berisi deklarasi `TaskFormModal` (cari `function TaskFormModal` atau `const TaskFormModal`):
  ```bash
  grep -n "function TaskFormModal\|TaskFormModal = " static/index.html
  ```
  Expected: menemukan baris seperti `    function TaskFormModal({` atau `    const TaskFormModal = (`

  Tambahkan fungsi berikut **tepat sebelum** baris tersebut:
  ```js
    function computeOfflineQuadrant(priority, deadline_date) {
      const isImportant = priority === "P1" || priority === "P2";
      const isUrgent = deadline_date
        ? (new Date(deadline_date) - new Date()) / 86400000 <= 3
        : false;
      if (isImportant && isUrgent)  return "Q1";
      if (isImportant && !isUrgent) return "Q2";
      if (!isImportant && isUrgent) return "Q3";
      return "Q4";
    }
  ```

  Catatan priority mapping (lihat form di baris ~1677):
  - `"P1"` = Critical → important
  - `"P2"` = High → important
  - `"P3"` = Normal → not important
  - `"P4"` = Low → not important

- [ ] **Step 2: Ganti `quadrant: "Q4"` hardcoded di `tempTask`**

  Cari (baris ~1649–1654):
  ```js
            const tempTask = {
              ...form, id: tempId, _pending: true, quadrant: "Q4",
              is_overdue: false, is_focused: false, days_until_deadline: null,
              assigned_to_name: null, parent_title: null,
              created_at: new Date().toISOString(),
            };
  ```
  Ganti dengan:
  ```js
            const tempTask = {
              ...form, id: tempId, _pending: true,
              quadrant: computeOfflineQuadrant(form.priority, form.deadline_date),
              is_overdue: false, is_focused: false, days_until_deadline: null,
              assigned_to_name: null, parent_title: null,
              created_at: new Date().toISOString(),
            };
  ```

- [ ] **Step 3: Verifikasi manual**

  1. Buka DevTools → Network → set "Offline"
  2. Buka app → Tambah Task → pilih Priority P1, deadline hari ini atau besok → Save
  3. Task harus muncul di **Eisenhower Q1** (bukan Q4)
  4. Tambah Task lain → Priority P3, tanpa deadline → Task harus masuk **Q4**
  5. Tambah Task → Priority P2, deadline 1 bulan lagi → Task harus masuk **Q2**

- [ ] **Step 4: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: hitung quadrant Eisenhower secara lokal saat offline"
  ```

---

## Task 2: Sidebar Counts — Merge Pending Tasks

**Files:**
- Modify: `static/index.html` — `Sidebar` component (~baris 1418–1475)

- [ ] **Step 1: Tambah `pendingCounts` useMemo di Sidebar**

  Cari blok di dalam `Sidebar` (baris ~1422–1429):
  ```js
      // Count tasks per project
      const projCounts = {};
      (projects || []).forEach(p => {
        projCounts[p] = (tasks || []).filter(t => t.project === p && t.gtd_status !== "done" && t.gtd_status !== "archived").length;
      });

      // Count today's focus tasks
      const todayCount = (tasks || []).filter(t => (t.quadrant === "Q1" || t.is_overdue || t.is_focused) && t.gtd_status !== "done" && t.gtd_status !== "archived").length;
  ```
  Tambahkan **setelah** blok `todayCount` tersebut:
  ```js
      // Pending offline tasks — merge ke sidebar counts
      const pendingByStatus = React.useMemo(() =>
        (tasks || []).filter(t => t._pending).reduce((acc, t) => {
          const s = t.gtd_status || "inbox";
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {}),
        [tasks]
      );
      const pendingByQuadrant = React.useMemo(() =>
        (tasks || []).filter(t => t._pending).reduce((acc, t) => {
          const q = t.quadrant || "Q4";
          acc[q] = (acc[q] || 0) + 1;
          return acc;
        }, {}),
        [tasks]
      );
      const sc = (status) => (summary?.by_status?.[status] || 0) + (pendingByStatus[status] || 0);
      const qc = (q) => (summary?.by_quadrant?.[q] || 0) + (pendingByQuadrant[q] || 0);
  ```

- [ ] **Step 2: Update `links` array untuk pakai `sc()` dan `qc()`**

  Cari (baris ~1436–1445):
  ```js
        { id: "inbox", icon: "📥", label: "Inbox", count: summary?.by_status?.inbox },
        { id: "next", icon: "▶️", label: "Next Actions", count: summary?.by_status?.next },
        { id: "waiting", icon: "⏳", label: "Waiting For", count: summary?.by_status?.waiting },
        { id: "someday", icon: "💭", label: "Someday", count: summary?.by_status?.someday },
        { section: "EISENHOWER" },
        { id: "q1", icon: "🔥", label: "Q1 Lakukan", count: summary?.by_quadrant?.Q1 },
        { id: "q2", icon: "📅", label: "Q2 Rencanakan", count: summary?.by_quadrant?.Q2 },
        { id: "q3", icon: "👋", label: "Q3 Delegasikan", count: summary?.by_quadrant?.Q3 },
        { id: "q4", icon: "🗑️", label: "Q4 Singkirkan", count: summary?.by_quadrant?.Q4 },
  ```
  Ganti dengan:
  ```js
        { id: "inbox", icon: "📥", label: "Inbox", count: sc("inbox") },
        { id: "next", icon: "▶️", label: "Next Actions", count: sc("next") },
        { id: "waiting", icon: "⏳", label: "Waiting For", count: sc("waiting") },
        { id: "someday", icon: "💭", label: "Someday", count: sc("someday") },
        { section: "EISENHOWER" },
        { id: "q1", icon: "🔥", label: "Q1 Lakukan", count: qc("Q1") },
        { id: "q2", icon: "📅", label: "Q2 Rencanakan", count: qc("Q2") },
        { id: "q3", icon: "👋", label: "Q3 Delegasikan", count: qc("Q3") },
        { id: "q4", icon: "🗑️", label: "Q4 Singkirkan", count: qc("Q4") },
  ```

  Juga update `done` dan `overdue` di baris ~1474–1475:
  
  Cari:
  ```js
      links.push({ id: "overdue", icon: "⚠️", label: "Overdue", count: summary?.overdue });
      links.push({ id: "done", icon: "✅", label: "Done", count: summary?.by_status?.done });
  ```
  Biarkan tidak berubah — overdue dan done tidak relevan untuk pending tasks (pending tasks belum punya `is_overdue` dan bukan `done`).

- [ ] **Step 3: Verifikasi manual**

  1. DevTools → Network → Offline
  2. Tambah Task → Priority P1, GTD: Inbox, deadline besok
  3. Sidebar count **Inbox** harus bertambah 1
  4. Sidebar count **Q1 Lakukan** harus bertambah 1
  5. Kembali Online → setelah sync, count kembali normal dari server

- [ ] **Step 4: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: sidebar counts include pending offline tasks"
  ```

---

## Task 3: Deploy & Verifikasi Production

- [ ] **Step 1: Push ke GitHub**

  ```bash
  git push origin main
  ```

- [ ] **Step 2: Verifikasi di production**

  Buka `https://todo.yatno.web.id`:
  1. DevTools → Network → Offline
  2. Tambah Task (Priority P1, GTD: Next Actions, deadline besok) → Save
  3. Task muncul di:
     - Sidebar: **Next Actions** count +1, **Q1 Lakukan** count +1
     - GTD panel: task dengan badge "⏳" muncul di Next Actions
     - Eisenhower: task muncul di Q1
  4. DevTools → Network → Online → tunggu sync
  5. Badge "⏳" hilang, counts normal dari server
