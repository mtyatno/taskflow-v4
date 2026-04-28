# Goal Templates Databank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded GOAL_TEMPLATES in GoalTab with a 3-step flow (category → subcategory → checklist) powered by HABIT_DATABANK embedded in index.html.

**Architecture:** Embed `habits_tasks_1000.json` as `HABIT_DATABANK` JS constant in `index.html`. A `buildGoalCategories()` helper groups the databank by kategori/subkategori to replace GOAL_TEMPLATES. GoalTab gains a third step where users pick individual habits/tasks via checklist before creating.

**Tech Stack:** Vanilla React (JSX in single HTML file), no build step, no test framework — verification is manual via dev server.

---

## Files

- Modify: `static/index.html` — all changes happen here
  - Lines ~1853–2068: remove `GOAL_TEMPLATES`, add `HABIT_DATABANK` + `buildGoalCategories()`
  - Lines ~2073–2313: refactor `GoalTab` component

---

### Task 1: Add HABIT_DATABANK constant

**Files:**
- Modify: `static/index.html` at line ~1853 (just before current `GOAL_TEMPLATES`)

- [ ] **Step 1: Read habits_tasks_1000.json and insert as JS constant**

Find the line `const GOAL_TEMPLATES = [` (~line 1853) and insert BEFORE it:

```js
    const HABIT_DATABANK = /* paste full contents of habits_tasks_1000.json here */;
```

To get the content, run in terminal:
```bash
python3 -c "import json; f=open('habits_tasks_1000.json'); print(json.dumps(json.load(f)))"
```

Then insert the output as the value of `HABIT_DATABANK`. The result looks like:
```js
    const HABIT_DATABANK = [{"kategori":"Karir","subkategori":"Profesionalisme","type":"task","item":"Latihan profesionalisme 10 menit siang","frequency":"daily","priority":"low","difficulty":"hard","tags":["profesionalisme","karir"]}, ...];
```

- [ ] **Step 2: Verify constant loads**

Open browser console on the app page and run:
```js
HABIT_DATABANK.length
// Expected: 1000
HABIT_DATABANK[0].kategori
// Expected: "Karir"
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: embed HABIT_DATABANK constant (1000 items) into index.html"
```

---

### Task 2: Add buildGoalCategories helper and mapping constants

**Files:**
- Modify: `static/index.html` — insert after `HABIT_DATABANK`, before `GOAL_TEMPLATES`

- [ ] **Step 1: Add FREQ_MAP, PRIORITY_MAP, CATEGORY_ICONS, and buildGoalCategories**

Insert this block after `const HABIT_DATABANK = [...];`:

```js
    const FREQ_MAP = {
      daily: ["mon","tue","wed","thu","fri","sat","sun"],
      monthly: ["mon"],
    };

    const PRIORITY_MAP = { low: "P3", medium: "P2", high: "P1" };

    const CATEGORY_ICONS = {
      "Karir": "💼",
      "Keuangan": "💰",
      "Pengembangan Diri": "📚",
      "Produktivitas": "⚡",
      "Relasi & Keluarga": "❤️",
      "Spiritual": "🕌",
    };

    function buildGoalCategories() {
      const map = {};
      for (const item of HABIT_DATABANK) {
        if (!map[item.kategori]) map[item.kategori] = new Set();
        map[item.kategori].add(item.subkategori);
      }
      return Object.entries(map).map(([label, subs]) => ({
        id: slugifyGoal(label),
        label,
        icon: CATEGORY_ICONS[label] || "📋",
        subcategories: [...subs].sort(),
      }));
    }
```

Note: `slugifyGoal` is defined at line ~2070, just before GoalTab. These constants are inserted before GOAL_TEMPLATES which is before GoalTab — that's fine because `buildGoalCategories` is a function (not called at parse time).

- [ ] **Step 2: Verify in browser console**

```js
buildGoalCategories().length
// Expected: 6

buildGoalCategories().map(c => c.label)
// Expected: ["Karir", "Keuangan", "Pengembangan Diri", "Produktivitas", "Relasi & Keluarga", "Spiritual"]

buildGoalCategories()[0].subcategories
// Expected: ["Networking", "Produktivitas kerja", "Profesionalisme"]
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add buildGoalCategories, FREQ_MAP, PRIORITY_MAP, CATEGORY_ICONS helpers"
```

---

### Task 3: Remove GOAL_TEMPLATES constant

**Files:**
- Modify: `static/index.html` lines ~1853–2068

- [ ] **Step 1: Delete the GOAL_TEMPLATES block**

Delete everything from:
```js
    const GOAL_TEMPLATES = [
```
through the closing:
```js
    ];
```
(the line just before `const slugifyGoal = ...`).

This removes ~215 lines.

- [ ] **Step 2: Verify app still loads without error**

Open browser. GoalTab will break (still references GOAL_TEMPLATES) but the page should load without a parse error. Browser console should NOT show `SyntaxError`.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "refactor: remove hardcoded GOAL_TEMPLATES constant"
```

---

### Task 4: Refactor GoalTab state and handlers

**Files:**
- Modify: `static/index.html` — GoalTab component (~line 2073)

- [ ] **Step 1: Update state declarations**

Replace the existing state block inside `GoalTab`:
```js
      const [step, setStep] = React.useState("category");
      const [selectedCategory, setSelectedCategory] = React.useState(null);
      const [selectedTemplate, setSelectedTemplate] = React.useState(null);
      const [goalName, setGoalName] = React.useState("");
      const [checkedHabits, setCheckedHabits] = React.useState([]);
      const [checkedTasks, setCheckedTasks] = React.useState([]);
      const [loading, setLoading] = React.useState(false);
```

With:
```js
      const [step, setStep] = React.useState("category");
      const [selectedCategory, setSelectedCategory] = React.useState(null);
      const [selectedSubcategory, setSelectedSubcategory] = React.useState(null);
      const [goalName, setGoalName] = React.useState("");
      const [checkedHabits, setCheckedHabits] = React.useState([]);
      const [checkedTasks, setCheckedTasks] = React.useState([]);
      const [loading, setLoading] = React.useState(false);
```

- [ ] **Step 2: Replace selectCategory and selectTemplate handlers**

Replace:
```js
      const selectCategory = (cat) => {
        setSelectedCategory(cat);
        setStep("template");
      };

      const selectTemplate = (tpl) => {
        setSelectedTemplate(tpl);
        setCheckedHabits(tpl.habits.map((_, i) => i));
        setCheckedTasks(tpl.tasks.map((_, i) => i));
        setGoalName("");
        setStep("confirm");
      };
```

With:
```js
      const selectCategory = (cat) => {
        setSelectedCategory(cat);
        setStep("subcategory");
      };

      const selectSubcategory = (sub) => {
        const items = HABIT_DATABANK.filter(x => x.kategori === selectedCategory.label && x.subkategori === sub);
        const habits = items.filter(x => x.type === "habit");
        const tasks = items.filter(x => x.type === "task");
        setSelectedSubcategory(sub);
        setCheckedHabits(habits.map((_, i) => i));
        setCheckedTasks(tasks.map((_, i) => i));
        setGoalName("");
        setStep("confirm");
      };
```

- [ ] **Step 3: Replace handleCreate**

Replace the full `handleCreate` function:
```js
      const handleCreate = async () => {
        if (!goalName.trim()) { alert("Nama goal wajib diisi"); return; }
        const slug = slugifyGoal(goalName);
        setLoading(true);
        try {
          for (const i of checkedHabits) {
            const h = selectedTemplate.habits[i];
            const title = h.title.replace("{slug}", slug);
            await api.post("/api/habits", {
              title,
              phase: "pagi",
              micro_target: "",
              frequency: h.frequency,
              identity_pillar: "",
            });
          }
          for (const i of checkedTasks) {
            const t = selectedTemplate.tasks[i];
            const title = t.title.replace("{slug}", slug);
            await api.post("/api/tasks", {
              title,
              gtd_status: t.gtd_status,
              priority: "P3",
              description: "",
              project: "",
              context: "",
              deadline: "",
              waiting_for: "",
              list_id: null,
              assigned_to: null,
              progress: 0,
            });
          }
          window.dispatchEvent(new CustomEvent("habitSaved"));
          window.dispatchEvent(new CustomEvent("taskSaved"));
          onSave();
        } catch (err) {
          alert("Gagal membuat goal: " + err.message);
        }
        setLoading(false);
      };
```

With:
```js
      const handleCreate = async () => {
        if (!goalName.trim()) { alert("Nama goal wajib diisi"); return; }
        const slug = slugifyGoal(goalName);
        const items = HABIT_DATABANK.filter(x => x.kategori === selectedCategory.label && x.subkategori === selectedSubcategory);
        const habits = items.filter(x => x.type === "habit");
        const tasks = items.filter(x => x.type === "task");
        setLoading(true);
        try {
          for (const i of checkedHabits) {
            const h = habits[i];
            await api.post("/api/habits", {
              title: `${h.item} #goal-${slug}`,
              phase: "pagi",
              micro_target: "",
              frequency: FREQ_MAP[h.frequency] || FREQ_MAP.daily,
              identity_pillar: "",
            });
          }
          for (const i of checkedTasks) {
            const t = tasks[i];
            await api.post("/api/tasks", {
              title: `${t.item} #goal-${slug}`,
              gtd_status: "next",
              priority: PRIORITY_MAP[t.priority] || "P3",
              description: "",
              project: "",
              context: "",
              deadline: "",
              waiting_for: "",
              list_id: null,
              assigned_to: null,
              progress: 0,
            });
          }
          window.dispatchEvent(new CustomEvent("habitSaved"));
          window.dispatchEvent(new CustomEvent("taskSaved"));
          onSave();
        } catch (err) {
          alert("Gagal membuat goal: " + err.message);
        }
        setLoading(false);
      };
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "refactor: update GoalTab state and handlers for databank flow"
```

---

### Task 5: Update Step "category" UI

**Files:**
- Modify: `static/index.html` — GoalTab `step === "category"` render block

- [ ] **Step 1: Replace GOAL_TEMPLATES reference with buildGoalCategories()**

Find inside the `step === "category"` render block:
```js
              {GOAL_TEMPLATES.map(cat => (
```

Replace with:
```js
              {buildGoalCategories().map(cat => (
```

- [ ] **Step 2: Verify in browser**

Open the app → buka form tambah task/habit → pilih tab Goal. Step 1 harus tampil 6 kartu kategori (Karir, Keuangan, Pengembangan Diri, Produktivitas, Relasi & Keluarga, Spiritual) masing-masing dengan icon yang benar.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: update GoalTab step 1 to use buildGoalCategories"
```

---

### Task 6: Update Step "subcategory" UI (was "template")

**Files:**
- Modify: `static/index.html` — GoalTab `step === "template"` render block

- [ ] **Step 1: Replace entire step "template" block**

Find and replace:
```js
      if (step === "template") {
        return (
          <div>
            <button
              type="button"
              onClick={() => setStep("category")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13, padding: "0 0 12px 0", display: "flex", alignItems: "center", gap: 4 }}
            >
              ← {selectedCategory.label}
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedCategory.templates.map(tpl => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => selectTemplate(tpl)}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--bg-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = "var(--accent)"}
                  onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>{tpl.label}</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 5 }}>{tpl.desc}</div>
                  <div style={{ fontSize: 11, color: "var(--text-light)" }}>
                    {tpl.habits.length} habit · {tpl.tasks.length} task
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className="btn" onClick={onClose}>Batal</button>
            </div>
          </div>
        );
      }
```

With:
```js
      if (step === "subcategory") {
        return (
          <div>
            <button
              type="button"
              onClick={() => setStep("category")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13, padding: "0 0 12px 0", display: "flex", alignItems: "center", gap: 4 }}
            >
              ← {selectedCategory.label}
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {selectedCategory.subcategories.map(sub => {
                const count = HABIT_DATABANK.filter(x => x.kategori === selectedCategory.label && x.subkategori === sub).length;
                return (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => selectSubcategory(sub)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      background: "var(--bg-primary)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = "var(--accent)"}
                    onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>{sub}</div>
                    <div style={{ fontSize: 11, color: "var(--text-light)" }}>{count} item tersedia</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className="btn" onClick={onClose}>Batal</button>
            </div>
          </div>
        );
      }
```

- [ ] **Step 2: Verify in browser**

Pilih kategori → harus tampil daftar subkategori sebagai kartu. Misal pilih "Produktivitas" → tampil: Disiplin, Fokus kerja, Manajemen waktu, Organisasi. Tiap kartu tampil badge "X item tersedia".

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: update GoalTab step 2 to subcategory picker from databank"
```

---

### Task 7: Update Step "confirm" checklist UI

**Files:**
- Modify: `static/index.html` — GoalTab `step === "confirm"` render block (the final `return (...)`)

- [ ] **Step 1: Add Select All / None helper and derive habits/tasks from databank**

Add these two lines just before the final `return (` in GoalTab (after `handleCreate`):

```js
      const subcatItems = selectedSubcategory
        ? HABIT_DATABANK.filter(x => x.kategori === selectedCategory.label && x.subkategori === selectedSubcategory)
        : [];
      const subcatHabits = subcatItems.filter(x => x.type === "habit");
      const subcatTasks  = subcatItems.filter(x => x.type === "task");
```

- [ ] **Step 2: Replace the full confirm return block**

Replace everything from the final `return (` through `);` (end of GoalTab) with:

```js
      return (
        <div>
          <button
            type="button"
            onClick={() => setStep("subcategory")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13, padding: "0 0 12px 0", display: "flex", alignItems: "center", gap: 4 }}
          >
            ← {selectedSubcategory}
          </button>

          <label className="input-label">Nama Goal *</label>
          <input
            className="input"
            value={goalName}
            onChange={e => setGoalName(e.target.value)}
            placeholder="contoh: Karir Impian 2026"
            style={{ marginBottom: 16 }}
            autoFocus
          />

          {subcatHabits.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label className="input-label" style={{ marginBottom: 0 }}>Habits</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => setCheckedHabits(subcatHabits.map((_, i) => i))}>Pilih Semua</button>
                  <button type="button" style={{ fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => setCheckedHabits([])}>Hapus Semua</button>
                </div>
              </div>
              <div style={{ marginBottom: 14, maxHeight: 180, overflowY: "auto" }}>
                {subcatHabits.map((h, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checkedHabits.includes(i)}
                      onChange={() => toggleHabit(i)}
                      style={{ accentColor: "var(--accent)", flexShrink: 0 }}
                    />
                    <span style={{ color: "var(--text-primary)", flex: 1 }}>{h.item}</span>
                    <span style={{ fontSize: 10, color: "var(--text-light)", background: "var(--bg-primary)", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>
                      {h.frequency === "daily" ? "harian" : "bulanan"}
                    </span>
                    <span style={{ fontSize: 10, color: h.priority === "high" ? "#e74c3c" : h.priority === "medium" ? "#f39c12" : "var(--text-light)", background: "var(--bg-primary)", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>
                      {h.priority}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {subcatTasks.length > 0 && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label className="input-label" style={{ marginBottom: 0 }}>Tasks</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => setCheckedTasks(subcatTasks.map((_, i) => i))}>Pilih Semua</button>
                  <button type="button" style={{ fontSize: 11, color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => setCheckedTasks([])}>Hapus Semua</button>
                </div>
              </div>
              <div style={{ marginBottom: 16, maxHeight: 180, overflowY: "auto" }}>
                {subcatTasks.map((t, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checkedTasks.includes(i)}
                      onChange={() => toggleTask(i)}
                      style={{ accentColor: "var(--accent)", flexShrink: 0 }}
                    />
                    <span style={{ color: "var(--text-primary)", flex: 1 }}>{t.item}</span>
                    <span style={{ fontSize: 10, color: t.priority === "high" ? "#e74c3c" : t.priority === "medium" ? "#f39c12" : "var(--text-light)", background: "var(--bg-primary)", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>
                      {t.priority}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {goalName.trim() && (
            <div style={{ fontSize: 11, color: "var(--text-light)", marginBottom: 14 }}>
              Tag otomatis: <code style={{ background: "var(--bg-primary)", padding: "1px 5px", borderRadius: 4 }}>#goal-{slugifyGoal(goalName)}</code>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn" onClick={onClose}>Batal</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={loading || !goalName.trim() || (checkedHabits.length + checkedTasks.length === 0)}
            >
              {loading ? "Membuat..." : "Buat Goal"}
            </button>
          </div>
        </div>
      );
    }
```

- [ ] **Step 3: Verify full flow in browser**

Test full flow:
1. Buka form → tab Goal
2. Pilih kategori (misal "Karir") → harus pindah ke subcategory step
3. Pilih subkategori (misal "Profesionalisme") → harus tampil checklist habits + tasks dengan badge frequency & priority
4. Klik "Hapus Semua" di Habits → semua habits unchecked; tombol "Buat Goal" tetap aktif jika ada tasks
5. Klik "Pilih Semua" → semua habits checked kembali
6. Isi nama goal → tag otomatis tampil
7. Klik "Buat Goal" → habits dan tasks terbuat, modal tertutup
8. Cek habits page → item baru muncul dengan tag #goal-{slug}
9. Cek tasks page → item baru muncul dengan tag #goal-{slug}

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: update GoalTab step 3 to databank checklist with Select All/None and priority badges"
```

---

### Task 8: Final smoke test and push

- [ ] **Step 1: Full end-to-end test**

Test satu goal per kategori untuk memastikan semua 6 kategori berjalan:
- Pilih setiap kategori → subkategori tampil dengan benar
- Pilih satu subkategori dari tiap kategori → checklist tampil (ada habits dan/atau tasks)
- Cek tidak ada JS error di console

- [ ] **Step 2: Verify frequency mapping**

Di habits yang terbuat dari item `frequency: "daily"` → habit harus punya frequency 7 hari.
Di habits dari item `frequency: "monthly"` → habit harus punya frequency `["mon"]`.

Cek via browser network tab → request POST /api/habits → lihat payload `frequency`.

- [ ] **Step 3: Push**

```bash
git push
```
