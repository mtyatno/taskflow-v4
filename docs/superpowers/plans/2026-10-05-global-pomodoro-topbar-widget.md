# Global Pomodoro Persistence & Top Bar Mini Pomodoro Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memastikan timer Pomodoro dan task aktif tetap berjalan tanpa henti ketika berpindah halaman, memunculkan widget mini Pomodoro interaktif di top bar saat berada di luar halaman Fokus Hari Ini, dan menyimpan status waktu ke localStorage.

**Architecture:** Mengangkat state `usePomodoro` dan `focusTask` ke komponen induk `App` di `static/index.html`. Menambahkan persistensi berbasis timestamp (`targetEndTime`) pada `usePomodoro` dengan kunci `tf_pomo_state`. Menambahkan komponen `TopBarPomodoroChip` yang dirender di `desktop-topbar` dan `mobile-topbar` ketika `page !== "today"` dan ada task fokus. Menyesuaikan `TodayFocusView` agar menerima instance timer dan task dari `App`. Service Worker di-bump ke `taskflow-v367-global-pomodoro`.

**Tech Stack:** JavaScript (React tanpa build/Babel inline), CSS3 (CSS variables di `static/app.css`), Node.js test runner (`node:test`, `node:assert/strict`), Service Worker Cache API.

## Global Constraints

- **No Cowboy Coding:** Seluruh kode implementasi dan code review WAJIB dijalankan melalui subagent (`invoke_subagent`).
- **Offline-First:** Semua data timer tersimpan lokal di memori dan `localStorage`, tanpa dependensi backend.
- **Service Worker Version:** Bump cache version ke `taskflow-v367-global-pomodoro`.
- **Top Bar Integration:** Tampilan chip di top bar harus responsif, tidak mematahkan layout header di mobile maupun desktop.

---

### Task 1: Unit Tests for App-Level Pomodoro State Lifting, Topbar Widget, and Persistence

**Files:**
- Modify: `tests/offline/focus_workstation.test.js`

**Interfaces:**
- Consumes: `App`, `TopBarPomodoroChip`, `usePomodoro`, `TodayFocusView` dari `static/index.html`.
- Produces: 4 unit tests baru di `tests/offline/focus_workstation.test.js`:
  1. `App: mengelola timer Pomodoro dan focusTask di level App`
  2. `TopBarPomodoroChip: didefinisikan dan dirender di top bar saat page !== "today"`
  3. `TopBarPomodoroChip: navigasi ke today saat diklik dan memiliki tombol play/pause`
  4. `usePomodoro: menyimpan snapshot ke localStorage (tf_pomo_state)`

- [ ] **Step 1: Write the failing unit tests in `tests/offline/focus_workstation.test.js`**

Tambahkan pengujian baru di akhir `tests/offline/focus_workstation.test.js`:

```javascript
test("App: mengelola timer Pomodoro dan focusTask di level App", () => {
  const appSrc = fnSource("App");
  assert.match(appSrc, /const timer = usePomodoro\(/, "App harus menginstansiasi usePomodoro");
  assert.match(appSrc, /pomoTimer|focusTask/, "App harus mengelola state Pomodoro");
  assert.match(appSrc, /TodayFocusView,[\s\S]*timer:/, "App harus mengoper timer ke TodayFocusView");
});

test("TopBarPomodoroChip: didefinisikan dan dirender di top bar saat page !== 'today'", () => {
  assert.ok(indexHtml.includes("function TopBarPomodoroChip("), "TopBarPomodoroChip harus didefinisikan");
  const appSrc = fnSource("App");
  assert.match(appSrc, /React\.createElement\(TopBarPomodoroChip/, "App harus merender TopBarPomodoroChip");
  const chipSrc = fnSource("TopBarPomodoroChip");
  assert.match(chipSrc, /topbar-pomo-chip/, "chip harus memiliki kelas CSS topbar-pomo-chip");
});

test("TopBarPomodoroChip: navigasi ke today saat diklik dan memiliki tombol play/pause", () => {
  const chipSrc = fnSource("TopBarPomodoroChip");
  assert.match(chipSrc, /timer\.isRunning \? timer\.pause : timer\.start/, "chip harus memiliki tombol play/pause");
  assert.match(chipSrc, /onNavigateToday/, "chip harus memanggil onNavigateToday");
});

test("usePomodoro: menyimpan snapshot ke localStorage (tf_pomo_state)", () => {
  const hook = fnSource("usePomodoro");
  assert.match(hook, /localStorage\.setItem\("tf_pomo_state"/, "usePomodoro harus menyimpan ke localStorage");
  assert.match(hook, /targetEndTime/, "usePomodoro harus menghitung targetEndTime");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/focus_workstation.test.js`  
Expected: FAIL dengan pesan asersi pertama "App harus menginstansiasi usePomodoro".

- [ ] **Step 3: Commit test changes**

```bash
git add tests/offline/focus_workstation.test.js
git commit -m "test: add tests for app-level pomodoro lifting and topbar chip"
```

---

### Task 2: Implement App-Level Pomodoro State Lifting, Topbar Widget, and Styles

**Files:**
- Modify: `static/index.html:6609-6730` (`usePomodoro`)
- Modify: `static/index.html:6950-7000` (Add `TopBarPomodoroChip`)
- Modify: `static/index.html:7321-7550` (`TodayFocusView`)
- Modify: `static/index.html:28230-28600` (`App`)
- Modify: `static/app.css` (Styles for `.topbar-pomo-chip`)

**Interfaces:**
- Consumes: `focusTask`, `setFocusTask`, `timer` di `App`.
- Produces:
  - `usePomodoro` dengan persistensi `tf_pomo_state` dan `targetEndTime`.
  - Komponen `TopBarPomodoroChip` terpasang di `mobile-topbar` dan `desktop-topbar`.
  - `TodayFocusView` menerima `timer` dan `focusTask` dari props `App`.

- [ ] **Step 1: Add timestamp & localStorage persistence to `usePomodoro`**

Perbarui `usePomodoro` di `static/index.html` untuk memuat dan menyimpan `tf_pomo_state` di `localStorage`, serta menyelaraskan `targetEndTime` dengan waktu nyata.

- [ ] **Step 2: Create `TopBarPomodoroChip` component**

Buat komponen `TopBarPomodoroChip` di `static/index.html`:
```javascript
function TopBarPomodoroChip({
  timer,
  focusTask,
  onNavigateToday
}) {
  if (!focusTask) return null;
  return React.createElement("div", {
    className: `topbar-pomo-chip${timer.isRunning ? " is-running" : " is-paused"}`,
    onClick: onNavigateToday,
    role: "button",
    tabIndex: 0,
    title: `Fokus: ${focusTask.title} (${timer.timeDisplay}) — Klik untuk buka Fokus Hari Ini`
  }, React.createElement("span", {
    className: "topbar-pomo-icon"
  }, timer.isBreak ? "☕" : "🍅"), React.createElement("span", {
    className: "topbar-pomo-time"
  }, timer.timeDisplay), React.createElement("span", {
    className: "topbar-pomo-task"
  }, focusTask.title), React.createElement("button", {
    type: "button",
    className: "topbar-pomo-btn",
    onClick: e => {
      e.stopPropagation();
      if (timer.isRunning) timer.pause();
      else timer.start();
    },
    title: timer.isRunning ? "Jeda Pomodoro" : "Lanjutkan Pomodoro",
    "aria-label": timer.isRunning ? "Jeda Pomodoro" : "Lanjutkan Pomodoro"
  }, React.createElement(FocusGlyph, {
    name: timer.isRunning ? "pause" : "play",
    size: 13
  })));
}
```

- [ ] **Step 3: Lift state to `App` and connect to `TodayFocusView` and Topbars**

1. Di `App`:
   - Deklarasikan `focusTaskId`, `taskPomodoros`, `focusTask = tasks.find(t => t.id === focusTaskId) || null`.
   - Deklarasikan `pomoTimer = usePomodoro({ focusTask, setTaskPomodoros, onUnfocus: () => setFocusTaskId(null) })`.
   - Render `page !== "today" && React.createElement(TopBarPomodoroChip, { timer: pomoTimer, focusTask: focusTask, onNavigateToday: () => setPage("today") })` di `desktop-topbar` dan `mobile-topbar`.
   - Teruskan `timer: pomoTimer`, `focusTask: focusTask`, `setFocusTask: (t) => setFocusTaskId(t ? t.id : null)`, `taskPomodoros`, `setTaskPomodoros` ke `TodayFocusView`.
2. Di `TodayFocusView`:
   - Gunakan `props.timer`, `props.focusTask`, `props.setFocusTask`, `props.taskPomodoros`, `props.setTaskPomodoros`.

- [ ] **Step 4: Add CSS styles for `.topbar-pomo-chip` in `static/app.css`**

Tambahkan styling:
```css
.topbar-pomo-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
  line-height: 1;
}
.topbar-pomo-chip:hover {
  border-color: var(--primary);
  background: var(--bg-hover, var(--bg-card));
}
.topbar-pomo-time {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.topbar-pomo-task {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
@media (max-width: 640px) {
  .topbar-pomo-task {
    max-width: 85px;
  }
}
.topbar-pomo-btn {
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  color: var(--text-secondary);
  border-radius: 4px;
}
.topbar-pomo-btn:hover {
  color: var(--primary);
  background: rgba(0,0,0,0.05);
}
```

- [ ] **Step 5: Verify unit tests and syntax**

Run:
`node --test tests/offline/focus_workstation.test.js`
`node scratch/check_inline.js static/index.html`

- [ ] **Step 6: Commit implementation**

```bash
git add static/index.html static/app.css
git commit -m "feat(client): lift pomodoro state to App and add topbar mini widget"
```

---

### Task 3: Bump Service Worker Version to v367 and Synchronize Version Tests

**Files:**
- Modify: `static/sw.js:1`
- Modify: `tests/offline/*.test.js` (6 test files)

**Interfaces:**
- Consumes: `taskflow-v367-global-pomodoro`
- Produces: Service Worker cache version `v367` synchronized in tests.

- [ ] **Step 1: Bump version in `static/sw.js`**
```javascript
const CACHE = "taskflow-v367-global-pomodoro";
```

- [ ] **Step 2: Update cache assertions in test files**
Update `taskflow-v366-focus-task-guard` to `taskflow-v367-global-pomodoro` across all 6 test files.

- [ ] **Step 3: Run full verification suite**
Run:
`node --check static/sw.js`
`node --test tests/offline/focus_workstation.test.js tests/offline/direct_messages_ui.test.js tests/offline/drawing_sync_ui.test.js tests/offline/interactive_note_viewer.test.js tests/offline/note_saved_searches_view_mode.test.js tests/offline/note_search_filters.test.js`

- [ ] **Step 4: Commit SW bump**

```bash
git add static/sw.js tests/offline/
git commit -m "chore(sw): bump cache version to taskflow-v367-global-pomodoro"
```

---

### Task 4: Full Verification and Session Documentation Handover

**Files:**
- Modify: `.agents/CURRENT_STATE.md`
- Modify: `.agents/SESSION_LOG.md`

- [ ] **Step 1: Run complete verification**
Run:
`node scratch/check_inline.js static/index.html`
`node --check static/sw.js`
`node --test tests/offline/focus_workstation.test.js`
`python -m pytest tests/`

- [ ] **Step 2: Update documentation & commit**
Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.
