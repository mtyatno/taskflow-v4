# Pomodoro Focus Task Guard & Tasklist Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengharuskan satu task aktif terpilih sebelum Pomodoro dapat dimulai (dengan notifikasi peringatan jika belum), memindahkan task yang sedang fokus ke urutan paling atas di task list, dan otomatis menjeda Pomodoro saat task selesai atau batal fokus.

**Architecture:** Modifikasi frontend offline-first pada hook `usePomodoro` dan komponen `TodayFocusView` di `static/index.html`. Guard pemanggilan `timer.start()` memeriksa keberadaan `focusTask` dan menampilkan toast warning jika kosong. Pengurutan `sortedTasks` memprioritaskan `focusTask.id` di urutan pertama (indeks 0). Service Worker di-bump ke `taskflow-v366-focus-task-guard`.

**Tech Stack:** JavaScript (React tanpa build/Babel inline), Node.js test runner (`node:test`, `node:assert/strict`), Service Worker Cache API.

## Global Constraints

- **No Cowboy Coding:** Kode implementasi dan code review WAJIB dilakukan melalui subagent (`invoke_subagent`).
- **Offline-First:** Tidak memerlukan endpoint backend baru; seluruh perubahan state berada di klien dan kompatibel offline.
- **Service Worker Version:** Bump cache version ke `taskflow-v366-focus-task-guard`.
- **Preserve Conventions:** Pertahankan struktur kode inline React `React.createElement` dan pola helper `fnSource` di test suite offline.

---

### Task 1: Unit Tests for Pomodoro Guard, Pause on Done/Unfocus, and Tasklist Reordering

**Files:**
- Modify: `tests/offline/focus_workstation.test.js`

**Interfaces:**
- Consumes: `usePomodoro`, `TodayFocusView`, `PomodoroTimer` dari `static/index.html`.
- Produces: 4 tes baru di `tests/offline/focus_workstation.test.js`:
  1. `assert.match(hook, /if\s*\(!focusTask\)/)` dan pengecekan toast warning.
  2. `assert.match(view, /if\s*\(focusTask\)\s*\{\s*if\s*\(a\.id === focusTask\.id\)\s*return -1/m)` atau pola comparator yang menempatkan `focusTask` di atas.
  3. `assert.match(view, /Fokus dilepas/m)` saat membatalkan fokus ketika timer jalan.
  4. `assert.match(view, /Task selesai/m)` saat task yang sedang fokus ditandai selesai.

- [ ] **Step 1: Write the failing unit tests in `tests/offline/focus_workstation.test.js`**

Tambahkan pengujian baru di akhir `tests/offline/focus_workstation.test.js`:

```javascript
test("usePomodoro: start() ditolak tanpa focusTask dan memicu peringatan", () => {
  const hook = fnSource("usePomodoro");
  assert.match(hook, /if\s*\(!focusTask\)/, "usePomodoro harus memeriksa keberadaan focusTask");
  assert.match(hook, /window\.__showToast\?\.\(.*"warning"\)/, "harus menampilkan toast warning");
});

test("TodayFocusView: task yang sedang fokus diposisikan di urutan paling atas", () => {
  const view = fnSource("TodayFocusView");
  assert.match(view, /if\s*\(focusTask\)\s*\{[\s\S]*a\.id === focusTask\.id[\s\S]*return -1/, "focusTask harus berada di puncak sortedTasks");
});

test("TodayFocusView: membatalkan fokus atau menyelesaikan task menjeda Pomodoro", () => {
  const view = fnSource("TodayFocusView");
  assert.match(view, /timer\.pause\(\)/, "harus memanggil timer.pause()");
  assert.match(view, /Fokus dilepas/, "harus memberi toast saat fokus dilepas");
  assert.match(view, /Task selesai/, "harus memberi toast saat task selesai");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/focus_workstation.test.js`  
Expected: FAIL dengan asersi "usePomodoro harus memeriksa keberadaan focusTask".

- [ ] **Step 3: Commit test changes**

```bash
git add tests/offline/focus_workstation.test.js
git commit -m "test: add tests for pomodoro focus task guard and tasklist reordering"
```

---

### Task 2: Implement Pomodoro Guard, Pause on Done/Unfocus, and Tasklist Reordering in `static/index.html`

**Files:**
- Modify: `static/index.html:6609-6725` (`usePomodoro`)
- Modify: `static/index.html:7321-7540` (`TodayFocusView`)

**Interfaces:**
- Consumes: `focusTask` prop di `usePomodoro`, state `focusTask` dan handler `onDone` di `TodayFocusView`.
- Produces:
  - `start()` di `usePomodoro` memvalidasi `if (!focusTask) { window.__showToast?.("Pilih satu task terlebih dahulu untuk memulai Pomodoro!", "warning"); return false; } setIsRunning(true); return true;`
  - `sortedTasks` di `TodayFocusView` membandingkan `focusTask.id` di baris pertama comparator.
  - `handleStartFocus` di `TodayFocusView` menjeda timer jika membatalkan fokus task aktif.
  - `handleTaskDone` di `TodayFocusView` membungkus `onDone` untuk menjeda timer jika task aktif selesai.

- [ ] **Step 1: Implement guard inside `usePomodoro` in `static/index.html`**

Ubah fungsi `start` di dalam `usePomodoro`:
```javascript
  const start = () => {
    if (!focusTask) {
      window.__showToast?.("Pilih satu task terlebih dahulu untuk memulai Pomodoro!", "warning");
      return false;
    }
    setIsRunning(true);
    return true;
  };
```

- [ ] **Step 2: Implement sorting and event handlers in `TodayFocusView` in `static/index.html`**

1. Perbarui sorting `sortedTasks`:
```javascript
  const sortedTasks = [...todayTasks].sort((a, b) => {
    if (focusTask) {
      if (a.id === focusTask.id) return -1;
      if (b.id === focusTask.id) return 1;
    }
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    const priOrder = {
      P1: 1,
      P2: 2,
      P3: 3,
      P4: 4
    };
    return priOrder[a.priority] - priOrder[b.priority];
  });
```

2. Perbarui `handleStartFocus`:
```javascript
  const handleStartFocus = task => {
    if (focusTask?.id === task.id) {
      setFocusTask(null);
      if (timer.isRunning) {
        timer.pause();
        window.__showToast?.("Fokus dilepas. Pomodoro dijeda.", "info");
      }
      return;
    }
    setFocusTask(task);
    setOpenId(task.id);
  };
```

3. Buat pembungkus `handleTaskDone`:
```javascript
  const handleTaskDone = taskId => {
    if (focusTask?.id === taskId) {
      setFocusTask(null);
      if (timer.isRunning) {
        timer.pause();
        window.__showToast?.("Task selesai! Pomodoro dijeda.", "info");
      }
    }
    onDone?.(taskId);
  };
```
Dan ganti `onDone: onDone` pada `FocusTaskItem` menjadi `onDone: handleTaskDone`.

- [ ] **Step 3: Run targeted test to verify it passes**

Run: `node --test tests/offline/focus_workstation.test.js`  
Expected: PASS (seluruh 8 tes lulus).

- [ ] **Step 4: Check inline JavaScript syntax**

Run: `node scratch/check_inline.js static/index.html`  
Expected: 5/5 scripts OK.

- [ ] **Step 5: Commit implementation**

```bash
git add static/index.html
git commit -m "feat(client): require focus task for pomodoro and move focused task to top"
```

---

### Task 3: Bump Service Worker Version to v366 & Synchronize Version Tests

**Files:**
- Modify: `static/sw.js:1`
- Modify: `tests/offline/direct_messages_ui.test.js`
- Modify: `tests/offline/drawing_sync_ui.test.js`
- Modify: `tests/offline/interactive_note_viewer.test.js`
- Modify: `tests/offline/note_saved_searches_view_mode.test.js`
- Modify: `tests/offline/note_search_filters.test.js`
- Modify: `tests/offline/focus_workstation.test.js`

**Interfaces:**
- Consumes: `taskflow-v366-focus-task-guard`
- Produces: Service Worker cache version `v366` terverifikasi di semua test suite.

- [x] **Step 1: Write the failing unit tests in `tests/offline/focus_workstation.test.js`**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Commit test changes**
...
- [x] **Step 1: Implement guard inside `usePomodoro` in `static/index.html`**
- [x] **Step 2: Implement sorting and event handlers in `TodayFocusView` in `static/index.html`**
- [x] **Step 3: Run targeted test to verify it passes**
- [x] **Step 4: Check inline JavaScript syntax**
- [x] **Step 5: Commit implementation**
...
- [x] **Step 1: Bump version in `static/sw.js`**
- [x] **Step 2: Update cache assertions in test files**
- [x] **Step 3: Verify syntax and test suite**
- [x] **Step 4: Commit SW bump**

```bash
git add static/sw.js tests/offline/
git commit -m "chore(sw): bump cache version to taskflow-v366-focus-task-guard"
```

---

### Task 4: Full Verification and Session Documentation Handover

**Files:**
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

- [ ] **Step 1: Run full verification suite**

Run:
```bash
node scratch/check_inline.js static/index.html
node --check static/sw.js
node --test tests/offline/focus_workstation.test.js
python -m pytest tests/
```
Expected: Semua script inline OK, SW check OK, unit test focus workstation lulus, pytest 122/122 lulus.

- [ ] **Step 2: Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`**

Catat implementasi fitur guard Pomodoro, reordering task fokus ke puncak list, auto-pause saat selesai/unfocus, dan bump SW v366.

- [ ] **Step 3: Commit documentation**

```bash
git add .agents/CURRENT_STATE.md .agents/SESSION_LOG.md docs/superpowers/plans/2026-10-04-focus-pomodoro-task-guard.md
git commit -m "docs: record session log and current state for pomodoro task guard"
```
