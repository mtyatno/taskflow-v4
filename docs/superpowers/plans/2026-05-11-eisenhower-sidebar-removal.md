# Eisenhower Sidebar Removal & Quadrant Default GroupBy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hapus section EISENHOWER dari sidebar dan jadikan groupBy "quadrant" sebagai default view di semua task list pages.

**Architecture:** Perubahan terbatas pada satu file (`static/index.html`). Filter dan groupBy quadrant sudah ada di `TaskListView` — tidak ada logika baru yang perlu dibangun. Tiga perubahan independen: (1) sidebar cleanup, (2) routing cleanup, (3) default groupBy.

**Tech Stack:** React (JSX in-browser via Babel), single HTML file (`static/index.html`)

---

## File yang Diubah

| File | Perubahan |
|------|-----------|
| `static/index.html` | Satu-satunya file. 3 lokasi berbeda yang diubah. |

---

### Task 1: Hapus Section EISENHOWER dari Sidebar

**Files:**
- Modify: `static/index.html:1680-1708`

- [ ] **Step 1: Hapus `pendingByQuadrant` useMemo dan `qc` helper**

Cari dan hapus baris 1680–1689. Kedua variabel ini hanya digunakan untuk counter pada Q1-Q4 sidebar links.

Sebelum:
```js
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

Sesudah (hapus `pendingByQuadrant` dan `qc`, pertahankan `sc`):
```js
      const sc = (status) => (summary?.by_status?.[status] || 0) + (pendingByStatus[status] || 0);
```

- [ ] **Step 2: Hapus 5 entri dari array `links` di Sidebar**

Cari dan hapus baris 1704–1708 (section EISENHOWER + 4 Q links):

Sebelum:
```js
        { section: "EISENHOWER" },
        { id: "q1", icon: "🔥", label: "Q1 Lakukan", count: qc("Q1") },
        { id: "q2", icon: "📅", label: "Q2 Rencanakan", count: qc("Q2") },
        { id: "q3", icon: "👋", label: "Q3 Delegasikan", count: qc("Q3") },
        { id: "q4", icon: "🗑️", label: "Q4 Singkirkan", count: qc("Q4") },
```

Sesudah: hapus ke-5 baris tersebut. Baris sebelumnya adalah `{ id: "someday", ... }` dan baris sesudahnya adalah `...(user?.is_admin ? ...)`.

- [ ] **Step 3: Verifikasi browser**

Buka app di browser, buka sidebar. Pastikan:
- Section "EISENHOWER" tidak muncul
- Link Q1, Q2, Q3, Q4 tidak ada
- Section GTD (Inbox, Next, Waiting, Someday) masih tampil normal
- Tidak ada JavaScript error di console

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: remove Eisenhower section from sidebar"
```

---

### Task 2: Hapus Routing Q1-Q4 Pages

**Files:**
- Modify: `static/index.html:10695-10789`

- [ ] **Step 1: Hapus 4 case dari `getFilteredTasks()`**

Cari dan hapus baris 10695–10698:

Sebelum:
```js
          case "q1": return tasks.filter(t => t.quadrant === "Q1" && t.gtd_status !== "done" && t.gtd_status !== "archived");
          case "q2": return tasks.filter(t => t.quadrant === "Q2" && t.gtd_status !== "done" && t.gtd_status !== "archived");
          case "q3": return tasks.filter(t => t.quadrant === "Q3" && t.gtd_status !== "done" && t.gtd_status !== "archived");
          case "q4": return tasks.filter(t => t.quadrant === "Q4" && t.gtd_status !== "done" && t.gtd_status !== "archived");
```

Sesudah: hapus ke-4 baris. Switch case langsung dari `someday` ke `overdue`.

- [ ] **Step 2: Hapus keys q1-q4 dari `getPageTitle()`**

Cari object `titles` (~line 10714). Ubah dari:
```js
        const titles = {
          dashboard: "Dashboard", inbox: "Inbox", next: "Next Actions", waiting: "Waiting For",
          someday: "Someday / Maybe", q1: "Q1 — Do", q2: "Q2 — Schedule", q3: "Q3 — Delegate",
          q4: "Q4 — Eliminate", overdue: "Overdue", done: "Done", today: "Fokus Hari Ini", all: "Semua Task",
          settings: "Pengaturan",
          habit: "Habit Tracker"
        };
```

Menjadi:
```js
        const titles = {
          dashboard: "Dashboard", inbox: "Inbox", next: "Next Actions", waiting: "Waiting For",
          someday: "Someday / Maybe", overdue: "Overdue", done: "Done", today: "Fokus Hari Ini", all: "Semua Task",
          settings: "Pengaturan",
          habit: "Habit Tracker"
        };
```

- [ ] **Step 3: Hapus keys q1-q4 dari `getPageIcon()`**

Cari object `icons` (~line 10726). Ubah dari:
```js
        const icons = {
          dashboard: "📊", inbox: "📥", next: "▶️", waiting: "⏳", someday: "💭",
          q1: "🔥", q2: "📅", q3: "👋", q4: "🗑️", overdue: "⚠️", done: "✅", today: "🍅", all: "📋",
          settings: "⚙️",
          habit: "🔁"
        };
```

Menjadi:
```js
        const icons = {
          dashboard: "📊", inbox: "📥", next: "▶️", waiting: "⏳", someday: "💭",
          overdue: "⚠️", done: "✅", today: "🍅", all: "📋",
          settings: "⚙️",
          habit: "🔁"
        };
```

- [ ] **Step 4: Sederhanakan `showQuadrant` prop**

Cari `showQuadrant` prop pada render `TaskListView` (~line 10789):

Sebelum:
```jsx
            showQuadrant={!["q1","q2","q3","q4"].includes(page)}
```

Hapus baris tersebut sepenuhnya — default di `TaskListView` sudah `showQuadrant = true`.

- [ ] **Step 5: Verifikasi browser**

Buka app, navigasi ke semua GTD pages (Inbox, Next, Waiting, Someday, All, Overdue, Done). Pastikan:
- Semua page tampil normal
- Filter "Quadrant" muncul di filter panel setiap page
- Tidak ada JavaScript error di console

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat: remove Q1-Q4 dedicated page routing"
```

---

### Task 3: Set Default GroupBy ke "quadrant"

**Files:**
- Modify: `static/index.html:5150`

- [ ] **Step 1: Ubah default groupBy**

Cari baris ~5150 di `TaskListView`:

Sebelum:
```js
      const [groupBy, setGroupBy] = useState(() => localStorage.getItem("tf_groupby") || "none");
```

Sesudah:
```js
      const [groupBy, setGroupBy] = useState(() => localStorage.getItem("tf_groupby") || "quadrant");
```

- [ ] **Step 2: Test di browser — fresh session**

Buka browser dalam mode Incognito (agar localStorage kosong). Buka page "Next Actions". Pastikan:
- Tasks langsung tampil ter-group berdasarkan quadrant (Q1, Q2, Q3, Q4)
- Dropdown "Group by" menunjukkan "Quadrant" sebagai pilihan aktif

- [ ] **Step 3: Test — user dengan localStorage existing**

Di browser regular (bukan Incognito), buka page "Next Actions". Pastikan:
- Jika user sudah pernah set groupBy, preferensi mereka tetap dipakai (tidak override)

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: set quadrant as default groupBy for task list pages"
```

---

### Task 4: Deploy & Smoke Test

- [ ] **Step 1: Push ke GitHub**

```bash
git push origin main
```

CI/CD akan deploy otomatis ke VPS via GitHub Actions.

- [ ] **Step 2: Smoke test di production**

Buka app di URL production. Verifikasi:
1. Sidebar tidak ada section EISENHOWER
2. Buka page "Next Actions" — tasks ter-group by quadrant secara default
3. Buka page "Inbox" — filter Quadrant tersedia dan berfungsi
4. Dashboard → Eisenhower Matrix 2x2 masih tampil normal (tidak terpengaruh)
5. Tidak ada JavaScript error di console
