# Goal System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Goal" tab to the "Buat Baru" modal that lets users create a set of habits + tasks from an offline template library, all auto-tagged with `#goal-<slug>`.

**Architecture:** Template data lives as a `GOAL_TEMPLATES` JS constant in `static/index.html`. Two-step UX: pick category → pick sub-template → fill name + confirm checklist. No backend or DB changes — the Goal System reuses existing `/api/habits` and `/api/tasks` POST endpoints.

**Tech Stack:** React (JSX in-browser via Babel), Tailwind CSS, existing `api.post()` helper, existing `TaskFormModal` component in `static/index.html`.

---

## File Structure

- **Modify:** `static/index.html`
  - Add `GOAL_TEMPLATES` constant (near top of `<script>` section, after other constants)
  - Add `slugify` helper function
  - Add `GoalTab` component (inline in same script block)
  - Extend `TaskFormModal`: add "🎯 Goal" to the mode toggle array, render `<GoalTab>` when `mode === "goal"`
- **Modify:** `static/sw.js` — bump cache version string to force SW update

---

## Task 1: Add `GOAL_TEMPLATES` constant

**Files:**
- Modify: `static/index.html` (find the line with `const DAYS =` inside `TaskFormModal` — insert `GOAL_TEMPLATES` **before** the `TaskFormModal` function definition, around line 1853)

- [ ] **Step 1: Locate insertion point**

Search for `function TaskFormModal` in `static/index.html` — it is at approximately line 1853. Insert the constant immediately before it.

- [ ] **Step 2: Insert `GOAL_TEMPLATES` constant**

Add this block immediately before the line `function TaskFormModal(`:

```js
    const GOAL_TEMPLATES = [
      {
        id: "kesehatan", label: "Kesehatan", icon: "💪",
        templates: [
          {
            id: "olahraga-rutin", label: "Olahraga Rutin",
            desc: "Bangun kebiasaan olahraga 3x seminggu",
            habits: [
              { title: "Olahraga 30 menit #goal-{slug}", frequency: ["mon","wed","fri"] },
              { title: "Stretching pagi #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Beli perlengkapan olahraga #goal-{slug}", gtd_status: "next" },
              { title: "Tentukan jadwal olahraga mingguan #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "pola-makan", label: "Pola Makan Sehat",
            desc: "Kurangi junk food, perbanyak sayur & buah",
            habits: [
              { title: "Makan sayur/buah #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
              { title: "Minum 8 gelas air #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Buat meal plan mingguan #goal-{slug}", gtd_status: "next" },
              { title: "Bersihkan makanan tidak sehat dari dapur #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "tidur-teratur", label: "Tidur Teratur",
            desc: "Tidur dan bangun di waktu yang konsisten",
            habits: [
              { title: "Tidur sebelum jam 23:00 #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
              { title: "Bangun jam 05:30 #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Matikan layar 1 jam sebelum tidur #goal-{slug}", gtd_status: "next" },
            ],
          },
        ],
      },
      {
        id: "produktivitas", label: "Produktivitas", icon: "⚡",
        templates: [
          {
            id: "deep-work", label: "Deep Work",
            desc: "Blok waktu fokus tanpa distraksi setiap hari",
            habits: [
              { title: "Deep work 90 menit #goal-{slug}", frequency: ["mon","tue","wed","thu","fri"] },
              { title: "Review to-do list pagi #goal-{slug}", frequency: ["mon","tue","wed","thu","fri"] },
            ],
            tasks: [
              { title: "Matikan notifikasi saat deep work #goal-{slug}", gtd_status: "next" },
              { title: "Tentukan waktu deep work harian #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "inbox-zero", label: "Inbox Zero",
            desc: "Proses dan kosongkan inbox email setiap hari",
            habits: [
              { title: "Proses inbox email #goal-{slug}", frequency: ["mon","tue","wed","thu","fri"] },
            ],
            tasks: [
              { title: "Unsubscribe dari newsletter tidak penting #goal-{slug}", gtd_status: "next" },
              { title: "Setup filter email otomatis #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "skill-baru", label: "Belajar Skill Baru",
            desc: "Konsisten belajar skill baru setiap hari",
            habits: [
              { title: "Belajar skill baru 30 menit #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Pilih skill yang ingin dipelajari #goal-{slug}", gtd_status: "next" },
              { title: "Cari resource belajar terbaik #goal-{slug}", gtd_status: "next" },
            ],
          },
        ],
      },
      {
        id: "keuangan", label: "Keuangan", icon: "💰",
        templates: [
          {
            id: "tabung-20", label: "Tabung 20%",
            desc: "Sisihkan 20% penghasilan setiap bulan",
            habits: [
              { title: "Catat pengeluaran harian #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Setup rekening tabungan terpisah #goal-{slug}", gtd_status: "next" },
              { title: "Atur transfer otomatis 20% gaji #goal-{slug}", gtd_status: "next" },
              { title: "Buat anggaran bulanan #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "catat-pengeluaran", label: "Catat Pengeluaran",
            desc: "Lacak setiap pengeluaran agar lebih sadar finansial",
            habits: [
              { title: "Catat pengeluaran sebelum tidur #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Pilih aplikasi/metode pencatatan #goal-{slug}", gtd_status: "next" },
              { title: "Kategorikan pengeluaran bulan lalu #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "lunasi-utang", label: "Lunasi Utang",
            desc: "Buat rencana pelunasan utang secara sistematis",
            habits: [
              { title: "Review progress pelunasan utang #goal-{slug}", frequency: ["mon"] },
            ],
            tasks: [
              { title: "List semua utang beserta bunganya #goal-{slug}", gtd_status: "next" },
              { title: "Pilih strategi: avalanche atau snowball #goal-{slug}", gtd_status: "next" },
              { title: "Set target lunas per utang #goal-{slug}", gtd_status: "next" },
            ],
          },
        ],
      },
      {
        id: "belajar", label: "Belajar", icon: "📚",
        templates: [
          {
            id: "baca-buku", label: "Baca Buku",
            desc: "Baca minimal 10 halaman setiap hari",
            habits: [
              { title: "Baca buku 10 halaman #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
            ],
            tasks: [
              { title: "Pilih buku pertama yang akan dibaca #goal-{slug}", gtd_status: "next" },
              { title: "Tentukan waktu membaca harian #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "kursus-online", label: "Kursus Online",
            desc: "Selesaikan kursus online dalam waktu 30 hari",
            habits: [
              { title: "Tonton 1 modul kursus #goal-{slug}", frequency: ["mon","tue","wed","thu","fri"] },
            ],
            tasks: [
              { title: "Pilih kursus yang akan diikuti #goal-{slug}", gtd_status: "next" },
              { title: "Buat jadwal penyelesaian kursus #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "bahasa-baru", label: "Bahasa Baru",
            desc: "Belajar bahasa baru 15 menit setiap hari",
            habits: [
              { title: "Latihan bahasa 15 menit #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
              { title: "Hafal 5 kosakata baru #goal-{slug}", frequency: ["mon","wed","fri"] },
            ],
            tasks: [
              { title: "Pilih platform belajar bahasa #goal-{slug}", gtd_status: "next" },
              { title: "Set target level bahasa dalam 3 bulan #goal-{slug}", gtd_status: "next" },
            ],
          },
        ],
      },
      {
        id: "relasi", label: "Relasi", icon: "❤️",
        templates: [
          {
            id: "quality-time", label: "Quality Time Keluarga",
            desc: "Luangkan waktu berkualitas bersama keluarga",
            habits: [
              { title: "Makan malam bersama keluarga #goal-{slug}", frequency: ["mon","tue","wed","thu","fri","sat","sun"] },
              { title: "Matikan HP saat bersama keluarga #goal-{slug}", frequency: ["sat","sun"] },
            ],
            tasks: [
              { title: "Rencanakan aktivitas weekend bersama #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "networking", label: "Networking",
            desc: "Perluas jaringan profesional secara konsisten",
            habits: [
              { title: "Kirim 1 pesan ke koneksi baru #goal-{slug}", frequency: ["mon","wed","fri"] },
            ],
            tasks: [
              { title: "Update LinkedIn profile #goal-{slug}", gtd_status: "next" },
              { title: "Daftar 1 komunitas/event profesional #goal-{slug}", gtd_status: "next" },
            ],
          },
        ],
      },
      {
        id: "proyek-pribadi", label: "Proyek Pribadi", icon: "🚀",
        templates: [
          {
            id: "bangun-produk", label: "Bangun Produk",
            desc: "Kerjakan proyek sampingan secara konsisten",
            habits: [
              { title: "Kerjakan proyek 1 jam #goal-{slug}", frequency: ["mon","tue","wed","thu","fri"] },
            ],
            tasks: [
              { title: "Tentukan MVP dan scope proyek #goal-{slug}", gtd_status: "next" },
              { title: "Buat roadmap fitur pertama #goal-{slug}", gtd_status: "next" },
              { title: "Set deadline rilis pertama #goal-{slug}", gtd_status: "next" },
            ],
          },
          {
            id: "tulis-konten", label: "Tulis Konten",
            desc: "Publikasi konten secara rutin di platform pilihan",
            habits: [
              { title: "Tulis draft konten 30 menit #goal-{slug}", frequency: ["mon","tue","wed","thu","fri"] },
            ],
            tasks: [
              { title: "Pilih platform & niche konten #goal-{slug}", gtd_status: "next" },
              { title: "Buat content calendar bulan pertama #goal-{slug}", gtd_status: "next" },
              { title: "Publikasi konten pertama #goal-{slug}", gtd_status: "next" },
            ],
          },
        ],
      },
    ];

    const slugifyGoal = (name) =>
      name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");

```

Note: `{slug}` is a literal placeholder string in template data — it will be replaced at runtime by `GoalTab` with the actual goal slug before POST.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add GOAL_TEMPLATES constant and slugifyGoal helper"
```

---

## Task 2: Add `GoalTab` component

**Files:**
- Modify: `static/index.html` — insert `GoalTab` component immediately after the `GOAL_TEMPLATES` constant and `slugifyGoal` function (still before `function TaskFormModal`)

- [ ] **Step 1: Insert `GoalTab` component**

Add this block immediately after `slugifyGoal` and before `function TaskFormModal(`:

```js
    function GoalTab({ onSave, onClose }) {
      const [step, setStep] = React.useState("category"); // "category" | "template" | "confirm"
      const [selectedCategory, setSelectedCategory] = React.useState(null);
      const [selectedTemplate, setSelectedTemplate] = React.useState(null);
      const [goalName, setGoalName] = React.useState("");
      const [checkedHabits, setCheckedHabits] = React.useState([]);
      const [checkedTasks, setCheckedTasks] = React.useState([]);
      const [loading, setLoading] = React.useState(false);

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

      const toggleHabit = (i) => setCheckedHabits(prev =>
        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
      );
      const toggleTask = (i) => setCheckedTasks(prev =>
        prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
      );

      const freqLabel = (freq) => {
        if (freq.length === 7) return "setiap hari";
        const map = { mon:"Sen", tue:"Sel", wed:"Rab", thu:"Kam", fri:"Jum", sat:"Sab", sun:"Min" };
        return freq.map(d => map[d] || d).join(", ");
      };

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

      // ── Step: category ─────────────────────────────────
      if (step === "category") {
        return (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
              Pilih kategori goalmu:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {GOAL_TEMPLATES.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => selectCategory(cat)}
                  style={{
                    padding: "14px 10px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--bg-primary)",
                    cursor: "pointer",
                    textAlign: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseOver={e => e.currentTarget.style.borderColor = "var(--accent)"}
                  onMouseOut={e => e.currentTarget.style.borderColor = "var(--border)"}
                >
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{cat.icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{cat.label}</div>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className="btn" onClick={onClose}>Batal</button>
            </div>
          </div>
        );
      }

      // ── Step: template ─────────────────────────────────
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

      // ── Step: confirm ─────────────────────────────────
      return (
        <div>
          <button
            type="button"
            onClick={() => setStep("template")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 13, padding: "0 0 12px 0", display: "flex", alignItems: "center", gap: 4 }}
          >
            ← {selectedTemplate.label}
          </button>

          <label className="input-label">Nama Goal *</label>
          <input
            className="input"
            value={goalName}
            onChange={e => setGoalName(e.target.value)}
            placeholder="contoh: Hidup Sehat 2026"
            style={{ marginBottom: 16 }}
            autoFocus
          />

          {selectedTemplate.habits.length > 0 && (
            <>
              <label className="input-label">Habits yang akan dibuat</label>
              <div style={{ marginBottom: 14 }}>
                {selectedTemplate.habits.map((h, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checkedHabits.includes(i)}
                      onChange={() => toggleHabit(i)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {h.title.replace(" #goal-{slug}", "")}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>
                      {freqLabel(h.frequency)}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}

          {selectedTemplate.tasks.length > 0 && (
            <>
              <label className="input-label">Tasks yang akan dibuat</label>
              <div style={{ marginBottom: 16 }}>
                {selectedTemplate.tasks.map((t, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={checkedTasks.includes(i)}
                      onChange={() => toggleTask(i)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span style={{ color: "var(--text-primary)" }}>
                      {t.title.replace(" #goal-{slug}", "")}
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

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: add GoalTab component with two-step category/template flow"
```

---

## Task 3: Add "Goal" tab to `TaskFormModal`

**Files:**
- Modify: `static/index.html` — two changes inside `TaskFormModal`:
  1. Add `"goal"` to the mode toggle array (line ~2103)
  2. Render `<GoalTab>` when `mode === "goal"` (after Note form section)

- [ ] **Step 1: Extend mode toggle array**

Find this line in `TaskFormModal` (approx line 2103):

```js
{[["task","✓ Task"],["habit","🔁 Habit"],["note","📝 Note"]].map(([m, label]) => (
```

Replace with:

```js
{[["task","✓ Task"],["habit","🔁 Habit"],["note","📝 Note"],["goal","🎯 Goal"]].map(([m, label]) => (
```

- [ ] **Step 2: Render GoalTab when mode is "goal"**

Find the closing of the Note form section — look for this block (approx line 2285-2295):

```js
              {/* ── Note Form ── */}
              {mode === "note" && (() => {
```

After the entire `{mode === "note" && ...}` block closes (find the matching `})}` that ends it), add:

```js
              {/* ── Goal Tab ── */}
              {mode === "goal" && (
                <GoalTab onSave={onSave} onClose={onClose} />
              )}
```

- [ ] **Step 3: Verify the Note form closing brace**

The Note form is an IIFE pattern: `{mode === "note" && (() => { ... return (...); })()}`. Find the `})()}` that closes it. Insert the Goal tab block immediately after that closing.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add Goal tab to TaskFormModal mode toggle"
```

---

## Task 4: Bump SW cache version

**Files:**
- Modify: `static/sw.js` — line 1, change the cache name string

- [ ] **Step 1: Bump cache version**

In `static/sw.js`, change line 1:

```js
const CACHE = "taskflow-v5-tg-link";
```

To:

```js
const CACHE = "taskflow-v5-goal-system";
```

- [ ] **Step 2: Commit**

```bash
git add static/sw.js
git commit -m "chore: bump SW cache version for goal system release"
```

---

## Task 5: Manual smoke test & push

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd "Z:/Todolist Manager V5.0"
python webapp.py
```

Open `http://localhost:8000` in browser.

- [ ] **Step 2: Test the Goal tab**

1. Click "+ Buat Baru" → confirm "🎯 Goal" tab appears as 4th tab
2. Click "Goal" tab → confirm 6 category cards render in 2-column grid
3. Click "Kesehatan" → confirm 3 sub-template cards appear with "← Kesehatan" back button
4. Click "Olahraga Rutin" → confirm confirm form appears with:
   - "Nama Goal" text input (auto-focused)
   - 2 habit checkboxes (all pre-checked)
   - 2 task checkboxes (all pre-checked)
   - "Buat Goal" button disabled when name is empty
5. Type "Hidup Sehat 2026" → confirm tag preview shows `#goal-hidup-sehat-2026`
6. Uncheck one habit → confirm it stays unchecked
7. Click "Buat Goal" → confirm modal closes, check task list and habit list for new items tagged `#goal-hidup-sehat-2026`

- [ ] **Step 3: Test back navigation**

1. Open modal → Goal tab → click Kesehatan → click "← Kesehatan" → confirm back to category grid
2. Click Produktivitas → click Deep Work → click "← Deep Work" → confirm back to Produktivitas templates

- [ ] **Step 4: Test edge case — no items selected**

Check all boxes off → confirm "Buat Goal" button is disabled.

- [ ] **Step 5: Push to deploy**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage check:**
- ✅ 4th tab "Goal" in modal (Task 3)
- ✅ Two-step UX: category → sub-template (Task 2 GoalTab)
- ✅ Inline confirm form with name input + checklist (Task 2 GoalTab step "confirm")
- ✅ User can uncheck items (toggleHabit / toggleTask)
- ✅ Auto-tag `#goal-<slug>` on all generated items (handleCreate replaces `{slug}`)
- ✅ `GOAL_TEMPLATES` with 6 categories, 15 sub-templates (Task 1)
- ✅ No backend/DB changes — reuses `/api/habits` and `/api/tasks`
- ✅ Tag preview shown before creation
- ✅ SW cache bumped (Task 4)

**Placeholder scan:** No TBDs, no vague steps — all code blocks are complete.

**Type consistency:**
- `GOAL_TEMPLATES[].templates[].habits[].frequency` → array of day strings → matches `habitForm.frequency` field
- `GOAL_TEMPLATES[].templates[].tasks[].gtd_status` → string → matches `form.gtd_status` field
- `slugifyGoal` defined in Task 1, used in Task 2 — consistent naming
- `GoalTab` defined in Task 2, rendered in Task 3 — consistent naming
