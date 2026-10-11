# Dashboard Progressive Disclosure & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghilangkan tampilan dingin dan intimidatif pada Dashboard pengguna baru yang belum memiliki tugas dengan menyembunyikan 17 kontainer kosong (KPI berangka 0, analitik kosong, matriks Eisenhower dan GTD kosong) dan menampilkan kartu panduan interaktif ramah "Mulai Langkah Pertama" (Quick Start Checklist).

**Architecture:** Menerapkan conditional rendering berbasis `hasTasks` (`tasks.length > 0`), `hasCompletedTasks`, dan `dismissedOnboarding` (`localStorage.getItem("tf_dismiss_onboarding")`) di `Dashboard` (`static/index.html`). Menambahkan komponen `DashOnboardingCard` pada kolom kiri `dash-main`, melengkapi CSS kelas baru di `static/app.css` tanpa `borderLeft` berwarna, serta bump cache Service Worker `v386` dan stylesheet `v322`.

**Tech Stack:** React, Vanilla CSS (CSS Variables), Service Worker Cache PWA, Node.js Test Runner, Pytest.

**Spec:** `docs/superpowers/specs/2026-10-11-dashboard-progressive-onboarding-design.md`

## Global Constraints
- TIDAK ADA border kiri berwarna (`borderLeft` styling dilarang keras).
- SW Cache version: `taskflow-v386-dashboard-progressive-onboarding`.
- Stylesheet version: `/static/app.css?v=322`.
- Backend version: `v386` di `tests/test_version.py` & `webapp.py`.
- No cowboy coding: delegate coding to subagents, test thoroughly before marking done.

---

### Task 1: SW Cache Version Bump, Backend Version, dan Unit Test Suite Baru

**Files:**
- Modify: `webapp.py:64`
- Modify: `static/sw.js:1`
- Modify: `tests/test_version.py:1-40`
- Modify: `tests/offline/note_toc.test.js`
- Modify: 7 synchronized offline test files in `tests/offline/`
- Create: `tests/offline/dashboard_onboarding.test.js`

**Interfaces:**
- Consumes: Existing offline test setup & Service Worker cache string.
- Produces: Service Worker cache `taskflow-v386-dashboard-progressive-onboarding`, backend version assertion `v386`, test suite `dashboard_onboarding.test.js`.

- [ ] **Step 1: Write the failing unit tests for Dashboard Progressive Disclosure**

Create `tests/offline/dashboard_onboarding.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../../static/index.html");
const cssPath = path.join(__dirname, "../../static/app.css");
const swPath = path.join(__dirname, "../../static/sw.js");

test("Service Worker and stylesheet versions are synchronized for v386", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const sw = fs.readFileSync(swPath, "utf8");

  assert.match(sw, /taskflow-v386-dashboard-progressive-onboarding/);
  assert.match(html, /taskflow-v386-dashboard-progressive-onboarding/);
  assert.match(html, /app\.css\?v=322/);
});

test("Dashboard contains conditional rendering logic for new users (hasTasks)", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  // State checks
  assert.match(html, /hasTasks\s*=\s*tasks\.length\s*>\s*0/);
  assert.match(html, /dismissedOnboarding/);
  assert.match(html, /tf_dismiss_onboarding/);

  // DashOnboardingCard component exists
  assert.match(html, /DashOnboardingCard/);
  assert.match(html, /Mulai Langkah Pertama/);

  // Guards on KPI and Matrix sections
  assert.match(html, /hasTasks\s*&&[\s\S]*?dash-kpis/);
  assert.match(html, /hasTasks\s*&&[\s\S]*?eisenhower/);
  assert.match(html, /hasTasks\s*&&[\s\S]*?gtd/);
  assert.match(html, /hasCompletedTasks\s*&&[\s\S]*?Analitik/);
});

test("app.css contains styling for DashOnboardingCard without border-left", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(css, /\.dash-onboarding-card/);
  assert.match(css, /\.onboarding-step-item/);
  assert.match(css, /\.onboarding-step-btn/);

  // Strict check: no border-left or borderLeft inside onboarding rules
  const onboardingSection = css.slice(css.indexOf(".dash-onboarding-card"));
  const relevantChunk = onboardingSection.slice(0, 2500);
  assert.strictEqual(/border-left\s*:/i.test(relevantChunk), false, "Must not use border-left styling");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/dashboard_onboarding.test.js`
Expected: FAIL (assertion on v386, hasTasks, and CSS classes).

- [ ] **Step 3: Update version constants in backend and Service Worker**

Update `webapp.py`:
`sw_cache = "taskflow-v386-dashboard-progressive-onboarding"`

Update `static/sw.js`:
`const CACHE = "taskflow-v386-dashboard-progressive-onboarding";`

Update `tests/test_version.py`:
`assert data["sw_version"] == "taskflow-v386-dashboard-progressive-onboarding"`
`assert "v386" in data["sw_version"]`

Update `tests/offline/note_toc.test.js`:
`assert.match(html, /app\.css\?v=322/);`

Synchronize SW cache string across all 8 test suites in `tests/offline/`.

- [ ] **Step 4: Run pytest version test**

Run: `venv/bin/python -m pytest tests/test_version.py`
Expected: PASS.

- [ ] **Step 5: Commit version synchronization**

```bash
git add webapp.py static/sw.js tests/test_version.py tests/offline/
git commit -m "feat(version): bump SW cache to v386 and register onboarding test suite"
```

---

### Task 2: Implementasi CSS Styling Onboarding Card & Empty State di `static/app.css`

**Files:**
- Modify: `static/app.css`

**Interfaces:**
- Consumes: Alurik theme variables (`--bg-card`, `--border`, `--radius`, `--accent`, `--text-main`, `--text-muted`).
- Produces: CSS classes `.dash-onboarding-card`, `.onboarding-head`, `.onboarding-title`, `.onboarding-sub`, `.onboarding-badge`, `.onboarding-dismiss-btn`, `.onboarding-steps`, `.onboarding-step-item`, `.onboarding-step-icon`, `.onboarding-step-body`, `.onboarding-step-title`, `.onboarding-step-desc`, `.onboarding-step-btn`.

- [ ] **Step 1: Check existing dashboard styles in `static/app.css`**

Locate `.dash-prio-card`, `.dash-card`, `.dash-main`.

- [ ] **Step 2: Add CSS rules for Onboarding Card**

Append clean, compliant styling to `static/app.css`:
```css
/* ── Onboarding Card for New Users (Empty State) ── */
.dash-onboarding-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 16px);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.onboarding-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.onboarding-head-left {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.onboarding-rocket-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(168, 197, 0, 0.15);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.onboarding-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-main);
  margin: 0 0 4px 0;
}

.onboarding-sub {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
}

.onboarding-head-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.onboarding-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 9999px;
  background: rgba(168, 197, 0, 0.15);
  color: var(--accent);
  white-space: nowrap;
}

.onboarding-dismiss-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  line-height: 1;
  transition: background 0.15s, color 0.15s;
}

.onboarding-dismiss-btn:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--text-main);
}

.onboarding-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.onboarding-step-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: var(--bg-subtle, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: border-color 0.15s, background 0.15s;
}

.onboarding-step-item.is-done {
  opacity: 0.75;
}

.onboarding-step-icon {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--bg-hover, rgba(255, 255, 255, 0.08));
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.onboarding-step-item.is-done .onboarding-step-icon {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border-color: rgba(34, 197, 94, 0.3);
}

.onboarding-step-body {
  flex: 1;
  min-width: 0;
}

.onboarding-step-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: 2px;
}

.onboarding-step-item.is-done .onboarding-step-title {
  text-decoration: line-through;
  color: var(--text-muted);
}

.onboarding-step-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.onboarding-step-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-main);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.onboarding-step-btn:hover {
  background: var(--accent);
  color: #1a1a1a;
  border-color: var(--accent);
}

@media (max-width: 640px) {
  .onboarding-step-item {
    flex-wrap: wrap;
  }
  .onboarding-step-btn {
    width: 100%;
    justify-content: center;
    margin-top: 6px;
  }
}
```

- [ ] **Step 3: Verify CSS syntax and absence of `border-left`**

Run node script or test to assert no `border-left` exists.
Expected: PASS.

- [ ] **Step 4: Commit CSS styles**

```bash
git add static/app.css
git commit -m "feat(dashboard): add responsive CSS for onboarding card and empty state"
```

---

### Task 3: Implementasi Progressive Disclosure & `DashOnboardingCard` di `static/index.html`

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: CSS classes from Task 2, `tasks`, `notes`, `summary`, `onNav`.
- Produces: Reactive conditional dashboard display for new users vs active users.

- [ ] **Step 1: Implement `DashOnboardingCard` component in `static/index.html`**

Create `DashOnboardingCard`:
```javascript
const DashOnboardingCard = ({ tasks, notes, summary, onNav, onFocusInput, onDismiss }) => {
  const hasTask = tasks.length > 0;
  const hasNote = notes.length > 0;
  const hasDone = (summary.done_last_7_days ?? 0) > 0 || tasks.some(t => t.gtd_status === "done");

  const completedCount = (hasTask ? 1 : 0) + (hasNote ? 1 : 0) + (hasDone ? 1 : 0);

  return /*#__PURE__*/React.createElement("div", {
    className: "dash-onboarding-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-head-left"
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-rocket-icon"
  }, "🚀"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "onboarding-title"
  }, "Mulai Langkah Pertama"), /*#__PURE__*/React.createElement("p", {
    className: "onboarding-sub"
  }, "3 langkah mudah menyiapkan alur produktivitasmu"))), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-head-right"
  }, /*#__PURE__*/React.createElement("span", {
    className: "onboarding-badge"
  }, `${completedCount} dari 3 selesai`), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "onboarding-dismiss-btn",
    onClick: onDismiss,
    title: "Sembunyikan panduan"
  }, "✕"))), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-steps"
  }, /*#__PURE__*/React.createElement("div", {
    className: `onboarding-step-item${hasTask ? " is-done" : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-icon"
  }, hasTask ? "✓" : "1"), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-title"
  }, "Tulis tugas pertamamu"), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-desc"
  }, "Ketik rencana di kolom atas lalu tekan Enter, atau klik tombol di samping.")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "onboarding-step-btn",
    onClick: onFocusInput
  }, "✍️ Buat Tugas")), /*#__PURE__*/React.createElement("div", {
    className: `onboarding-step-item${hasNote ? " is-done" : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-icon"
  }, hasNote ? "✓" : "2"), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-title"
  }, "Buka atau buat catatan pertamamu"), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-desc"
  }, "Simpan ide, rangkuman, atau jurnal pribadi di tab Notes.")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "onboarding-step-btn",
    onClick: () => onNav("notes")
  }, "📝 Buka Notes")), /*#__PURE__*/React.createElement("div", {
    className: `onboarding-step-item${hasDone ? " is-done" : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-icon"
  }, hasDone ? "✓" : "3"), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-title"
  }, "Selesaikan tugas pertamamu"), /*#__PURE__*/React.createElement("div", {
    className: "onboarding-step-desc"
  }, "Centang tugas yang sudah rampung untuk mulai mengisi grafik performa harianmu.")), /*#__PURE__*/React.createElement("span", {
    className: "dash-muted-sm",
    style: { whiteSpace: "nowrap" }
  }, hasDone ? "Selesai 🎉" : "Menunggu tugas"))));
};
```

- [ ] **Step 2: Update `Dashboard` Component with Conditional Rendering**

In `Dashboard`:
1. Add state:
```javascript
const [dismissedOnboarding, setDismissedOnboarding] = useState(() => {
  try {
    return localStorage.getItem("tf_dismiss_onboarding") === "true";
  } catch (_) {
    return false;
  }
});
const handleDismissOnboarding = () => {
  setDismissedOnboarding(true);
  try {
    localStorage.setItem("tf_dismiss_onboarding", "true");
  } catch (_) {}
};
```
2. Compute flags:
```javascript
const hasTasks = tasks.length > 0;
const hasCompletedTasks = (summary.done_last_7_days ?? 0) > 0 || tasks.some(t => t.gtd_status === "done");
```
3. Update greeting summary when `tasks.length === 0`:
```javascript
const summaryLine = tasks.length === 0
  ? "Selamat datang di Alurik! Mari mulai dengan mencatat tugas atau ide pertamamu."
  : pendingToday.length > 0
  ? `Ada ${pendingToday.length} prioritas hari ini${overdueCount > 0 ? `, ${overdueCount} terlambat` : ""}.`
  : totalToday > 0
  ? "Semua prioritas hari ini sudah selesai. Kerja bagus! 🎉"
  : overdueCount > 0
  ? `Tidak ada prioritas baru, tapi ${overdueCount} task terlambat.`
  : "Tidak ada yang mendesak hari ini. Saat yang pas untuk merencanakan.";
```
4. Render `dash-kpis` conditionally:
```javascript
hasTasks && /*#__PURE__*/React.createElement("div", { className: "dash-kpis" }, ...)
```
5. In `dash-main`:
If `!hasTasks && !dismissedOnboarding`, render `DashOnboardingCard`.
Otherwise, render `dash-prio-card`.
6. Render Eisenhower Matrix conditionally:
```javascript
hasTasks && /*#__PURE__*/React.createElement(React.Fragment, null,
  /*#__PURE__*/React.createElement(DashSection, { icon: "target", title: "Eisenhower Matrix", sub: "Urgensi × kepentingan" }),
  /*#__PURE__*/React.createElement("div", { className: "eisenhower-grid dash-grid-2", "data-tour": "eisenhower" }, ...)
)
```
7. Render GTD status conditionally:
```javascript
hasTasks && /*#__PURE__*/React.createElement(React.Fragment, null,
  /*#__PURE__*/React.createElement(DashSection, { icon: "refresh", title: "Status GTD", sub: "Alur kerja Getting Things Done" }),
  /*#__PURE__*/React.createElement("div", { className: "gtd-grid dash-grid-2", "data-tour": "gtd-grid" }, ...)
)
```
8. Render Analitik conditionally:
```javascript
hasCompletedTasks && /*#__PURE__*/React.createElement(React.Fragment, null,
  /*#__PURE__*/React.createElement(DashSection, { icon: "dashboard", title: "Analitik", sub: "Gambaran performa kamu" }),
  /*#__PURE__*/React.createElement("div", { className: "charts-grid dash-charts" }, ...)
)
```
9. Update stylesheet link to `app.css?v=322` and SW version to `taskflow-v386-dashboard-progressive-onboarding`.

- [ ] **Step 3: Run Syntax & Offline Tests**

Run:
```bash
node --check static/sw.js
node temporary_files/check_inline_scripts.js static/index.html
node --test tests/offline/*.test.js
venv/bin/python -m pytest tests/test_version.py
```
Expected: All tests PASS (0 failures).

- [ ] **Step 4: Commit Dashboard Implementation**

```bash
git add static/index.html
git commit -m "feat(dashboard): implement progressive disclosure and onboarding card for new users"
```
