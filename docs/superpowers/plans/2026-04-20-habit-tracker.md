# Habit Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah modul Habit Tracker — halaman khusus, modal toggle Task/Habit, check-in Done/Skip, dan full offline support.

**Architecture:** Backend baru di `repository.py` (2 tabel) dan `webapp.py` (5 endpoint). Frontend di `static/index.html` — toggle di `TaskFormModal`, komponen `HabitPage` + `HabitCheckinModal`, sidebar link, dan routing. Habit punya state sendiri di dalam `HabitPage`, tidak naik ke App. Offline: cache `habits_today` di IndexedDB, queue checkin + creation, reconstruct saat reload offline.

**Tech Stack:** FastAPI + SQLite (backend), React 18 UMD + CSS variables (frontend), IndexedDB via `OfflineDB` helper (offline).

---

## Files yang Dimodifikasi

- Modify: `repository.py` — tambah tabel `habits` dan `habit_logs` di `_init_db`
- Modify: `webapp.py` — tambah Pydantic schemas + 5 endpoint habit
- Modify: `static/index.html` — sidebar link, routing, `TaskFormModal` toggle, komponen `HabitPage` + `HabitCheckinModal`

---

## Task 1: DB Tables — `habits` dan `habit_logs`

**Files:**
- Modify: `repository.py` — di dalam `_init_db`, setelah blok `CREATE TABLE IF NOT EXISTS messages`

- [ ] **Step 1: Tambah tabel `habits` dan `habit_logs` di `_init_db`**

  Cari baris (setelah blok messages + index, sebelum `# Reply/quote migration`):
  ```python
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_list ON messages(list_id, created_at)")
  ```
  Tambahkan SETELAH baris tersebut:
  ```python
            # Habits tables
            conn.execute("""
                CREATE TABLE IF NOT EXISTS habits (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title           TEXT NOT NULL,
                    phase           TEXT NOT NULL DEFAULT 'pagi' CHECK(phase IN ('pagi','siang','malam')),
                    micro_target    TEXT DEFAULT '',
                    frequency       TEXT DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]',
                    identity_pillar TEXT DEFAULT '',
                    created_at      TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id)")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS habit_logs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    habit_id    INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
                    date        TEXT NOT NULL,
                    status      TEXT NOT NULL CHECK(status IN ('done','skipped','missed')),
                    skip_reason TEXT DEFAULT '',
                    created_at  TEXT DEFAULT (datetime('now')),
                    UNIQUE(habit_id, date)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs(habit_id, date)")
  ```

- [ ] **Step 2: Verifikasi tabel terbuat**

  Jalankan Python di direktori project:
  ```bash
  cd "Z:/Todolist Manager V5.0"
  python -c "from repository import TaskRepository; from config import DB_PATH; r = TaskRepository(DB_PATH); print('OK')"
  ```
  Expected: `OK` tanpa error.

  Cek tabel:
  ```bash
  python -c "
  import sqlite3; from config import DB_PATH
  conn = sqlite3.connect(DB_PATH)
  tables = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
  print([t[0] for t in tables])
  "
  ```
  Expected: list tabel includes `'habits'` dan `'habit_logs'`.

- [ ] **Step 3: Commit**

  ```bash
  git add repository.py
  git commit -m "feat: tambah tabel habits dan habit_logs"
  ```

---

## Task 2: Backend — Pydantic Schemas + 5 Endpoint Habit

**Files:**
- Modify: `webapp.py` — tambah schemas setelah `class SharedListCreate`, tambah endpoints di akhir file (sebelum `if __name__ == "__main__"` atau di akhir)

- [ ] **Step 1: Tambah Pydantic schemas**

  Cari:
  ```python
  class SharedListCreate(BaseModel):
      name: str = Field(min_length=1, max_length=100)
  ```
  Tambahkan SETELAH blok tersebut:
  ```python
  class HabitCreate(BaseModel):
      title: str = Field(min_length=1, max_length=200)
      phase: str = "pagi"
      micro_target: str = ""
      frequency: list = ["mon","tue","wed","thu","fri","sat","sun"]
      identity_pillar: str = ""

  class HabitCheckinReq(BaseModel):
      status: str          # "done" | "skipped"
      skip_reason: str = ""
      date: str = ""       # YYYY-MM-DD, jika kosong pakai hari ini di server
  ```

- [ ] **Step 2: Tambah endpoint `GET /api/habits`**

  Tambahkan di akhir `webapp.py` (sebelum baris `if __name__` jika ada, atau langsung append):
  ```python
  # ── Habits ────────────────────────────────────────────────────────────────────

  @app.get("/api/habits")
  async def get_habits(user=Depends(get_current_user)):
      uid = user["sub"]
      with get_db() as conn:
          rows = conn.execute(
              "SELECT * FROM habits WHERE user_id = ? ORDER BY phase, id",
              (uid,)
          ).fetchall()
      return [dict(r) for r in rows]
  ```

- [ ] **Step 3: Tambah endpoint `POST /api/habits`**

  Append setelah Step 2:
  ```python
  @app.post("/api/habits")
  async def create_habit(req: HabitCreate, user=Depends(get_current_user)):
      uid = user["sub"]
      if req.phase not in ("pagi", "siang", "malam"):
          raise HTTPException(status_code=400, detail="phase harus pagi/siang/malam")
      freq_json = json.dumps(req.frequency)
      with get_db() as conn:
          cur = conn.execute(
              """INSERT INTO habits (user_id, title, phase, micro_target, frequency, identity_pillar)
                 VALUES (?,?,?,?,?,?)""",
              (uid, req.title, req.phase, req.micro_target, freq_json, req.identity_pillar)
          )
          row = conn.execute("SELECT * FROM habits WHERE id = ?", (cur.lastrowid,)).fetchone()
      return dict(row)
  ```

- [ ] **Step 4: Tambah endpoint `DELETE /api/habits/{habit_id}`**

  Append setelah Step 3:
  ```python
  @app.delete("/api/habits/{habit_id}")
  async def delete_habit(habit_id: int, user=Depends(get_current_user)):
      uid = user["sub"]
      with get_db() as conn:
          row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
          if not row:
              raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
          conn.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
      return {"ok": True}
  ```

- [ ] **Step 5: Tambah endpoint `GET /api/habits/today`**

  Append setelah Step 4:
  ```python
  @app.get("/api/habits/today")
  async def get_habits_today(user=Depends(get_current_user)):
      uid = user["sub"]
      today = date.today().isoformat()
      # 7 hari terakhir (Sen s/d hari ini minggu ini)
      from datetime import timedelta
      week_dates = [(date.today() - timedelta(days=date.today().weekday() - i)).isoformat() for i in range(7)]

      with get_db() as conn:
          habits = conn.execute(
              "SELECT * FROM habits WHERE user_id = ? ORDER BY phase, id", (uid,)
          ).fetchall()

          result = []
          for h in habits:
              hid = h["id"]
              # Status hari ini
              today_log = conn.execute(
                  "SELECT status, skip_reason FROM habit_logs WHERE habit_id = ? AND date = ?",
                  (hid, today)
              ).fetchone()
              # 7-hari log (minggu ini Sen–Min)
              logs = conn.execute(
                  "SELECT date, status FROM habit_logs WHERE habit_id = ? AND date IN ({})".format(
                      ",".join("?" * len(week_dates))
                  ),
                  [hid] + week_dates
              ).fetchall()
              log_map = {l["date"]: l["status"] for l in logs}
              week_log = [log_map.get(d, None) for d in week_dates]
              # Streak: hitung dari hari ini ke belakang
              streak = 0
              check_date = date.today()
              while True:
                  log = conn.execute(
                      "SELECT status FROM habit_logs WHERE habit_id = ? AND date = ?",
                      (hid, check_date.isoformat())
                  ).fetchone()
                  if log and log["status"] == "done":
                      streak += 1
                      check_date -= timedelta(days=1)
                  elif log and log["status"] == "skipped":
                      check_date -= timedelta(days=1)  # skip tidak putus streak
                  else:
                      break

              result.append({
                  "id": hid,
                  "title": h["title"],
                  "phase": h["phase"],
                  "micro_target": h["micro_target"],
                  "frequency": json.loads(h["frequency"]) if h["frequency"] else [],
                  "identity_pillar": h["identity_pillar"],
                  "today_status": today_log["status"] if today_log else None,
                  "skip_reason": today_log["skip_reason"] if today_log else "",
                  "streak": streak,
                  "week_log": week_log,
              })
      return result
  ```

- [ ] **Step 6: Tambah endpoint `POST /api/habits/{habit_id}/checkin`**

  Append setelah Step 5:
  ```python
  @app.post("/api/habits/{habit_id}/checkin")
  async def checkin_habit(habit_id: int, req: HabitCheckinReq, user=Depends(get_current_user)):
      uid = user["sub"]
      if req.status not in ("done", "skipped"):
          raise HTTPException(status_code=400, detail="status harus done atau skipped")
      log_date = req.date if req.date else date.today().isoformat()
      with get_db() as conn:
          row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
          if not row:
              raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
          conn.execute(
              """INSERT INTO habit_logs (habit_id, date, status, skip_reason)
                 VALUES (?,?,?,?)
                 ON CONFLICT(habit_id, date) DO UPDATE SET status=excluded.status, skip_reason=excluded.skip_reason""",
              (habit_id, log_date, req.status, req.skip_reason)
          )
      return {"ok": True, "habit_id": habit_id, "date": log_date, "status": req.status}
  ```

- [ ] **Step 7: Verifikasi endpoints bisa diakses**

  Restart server lokal jika ada, lalu cek tidak ada syntax error:
  ```bash
  cd "Z:/Todolist Manager V5.0"
  python -c "import webapp; print('OK')"
  ```
  Expected: `OK` tanpa error.

- [ ] **Step 8: Commit**

  ```bash
  git add webapp.py
  git commit -m "feat: API endpoints habit — GET/POST/DELETE habits, today, checkin"
  ```

---

## Task 3: Frontend — Sidebar Link + Routing

**Files:**
- Modify: `static/index.html` — `Sidebar` component (baris ~1454), `renderContent` (~baris 5062), `getPageTitle` (~baris 5042), `getPageIcon` (~baris 5049)

- [ ] **Step 1: Tambah sidebar link "Habit Tracker"**

  Cari (baris ~1454):
  ```js
        { id: "today", icon: "🍅", label: "Fokus Hari Ini", count: todayCount },
        { id: "chat", icon: "💬", label: "Diskusi" },
  ```
  Ganti dengan:
  ```js
        { id: "today", icon: "🍅", label: "Fokus Hari Ini", count: todayCount },
        { id: "habit", icon: "🔁", label: "Habit Tracker" },
        { id: "chat", icon: "💬", label: "Diskusi" },
  ```

- [ ] **Step 2: Tambah ke `pageTitles`**

  Cari:
  ```js
          settings: "Pengaturan"
        };
        return titles[page] || "Tasks";
  ```
  Ganti dengan:
  ```js
          settings: "Pengaturan",
          habit: "Habit Tracker"
        };
        return titles[page] || "Tasks";
  ```

- [ ] **Step 3: Tambah ke `pageIcons`**

  Cari:
  ```js
          settings: "⚙️"
        };
        return icons[page] || "📋";
  ```
  Ganti dengan:
  ```js
          settings: "⚙️",
          habit: "🔁"
        };
        return icons[page] || "📋";
  ```

- [ ] **Step 4: Tambah routing `page === "habit"`**

  Cari:
  ```js
        if (page === "settings") {
          return <SettingsPage user={user} onUsernameChange={(u) => setUser(u)} showToast={showToast} />;
        }
  ```
  Tambahkan SEBELUM baris tersebut:
  ```js
        if (page === "habit") {
          return <HabitPage user={user} showToast={showToast} />;
        }
  ```

- [ ] **Step 5: Verifikasi manual**

  Buka app → sidebar harus ada item "🔁 Habit Tracker" antara "Fokus Hari Ini" dan "Diskusi". Klik → halaman kosong (HabitPage belum dibuat, akan error — itu normal, akan difix di Task 5).

- [ ] **Step 6: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: sidebar + routing untuk Habit Tracker"
  ```

---

## Task 4: Frontend — Modal Toggle Task/Habit

**Files:**
- Modify: `static/index.html` — `TaskFormModal` component (~baris 1623)

- [ ] **Step 1: Tambah state `mode` dan segmented control di atas form**

  Cari di dalam `TaskFormModal` (setelah semua useState declarations, sebelum `return (`):
  ```js
      const [listMembers, setListMembers] = useState([]);
  ```
  Tambahkan SETELAH baris itu:
  ```js
      const [mode, setMode] = useState("task"); // "task" | "habit"
      const [habitForm, setHabitForm] = useState({
        title: "",
        phase: "pagi",
        micro_target: "",
        frequency: ["mon","tue","wed","thu","fri","sat","sun"],
        identity_pillar: "",
      });
      const setHabit = (k, v) => setHabitForm(f => ({ ...f, [k]: v }));
      const DAYS = [
        { key: "mon", label: "Sen" }, { key: "tue", label: "Sel" },
        { key: "wed", label: "Rab" }, { key: "thu", label: "Kam" },
        { key: "fri", label: "Jum" }, { key: "sat", label: "Sab" },
        { key: "sun", label: "Min" },
      ];
      const toggleDay = (key) => setHabitForm(f => ({
        ...f,
        frequency: f.frequency.includes(key) ? f.frequency.filter(d => d !== key) : [...f.frequency, key]
      }));
  ```

- [ ] **Step 2: Tambah handler submit untuk habit**

  Cari di dalam `handleSubmit` (di akhir fungsi, sebelum `setLoading(false)`):
  ```js
        setLoading(false);
      };
  ```
  Ganti `handleSubmit` seluruhnya — cari pembukaan fungsinya:
  ```js
      const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
  ```
  Dan tambahkan blok habit di awal `try` block, SEBELUM `if (isEdit)`:
  ```js
      const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
          // ── Habit mode ────────────────────────────────────────────
          if (mode === "habit") {
            if (!habitForm.title.trim()) { alert("Nama habit wajib diisi"); setLoading(false); return; }
            try {
              await api.post("/api/habits", habitForm);
              onSave();
            } catch (err) {
              if (isOfflineErr(err) && onOfflineSave) {
                const tempId = `tmp_habit_${Date.now()}`;
                await OfflineDB.queueAdd({ method: "POST", url: "/api/habits", body: habitForm, tempId, createdAt: Date.now() });
                onOfflineSave({ ...habitForm, id: tempId, _pending: true, _type: "habit" });
              } else {
                alert(err.message);
              }
            }
            setLoading(false);
            return;
          }
          // ── Task mode (existing) ──────────────────────────────────
  ```
  Dan tutup dengan baris setelah blok catch existing:
  ```js
        } catch (err) {
          alert(err.message);
        }
        setLoading(false);
      };
  ```

  **Catatan:** Pastikan struktur try/catch tidak nested bermasalah. Blok habit punya try/catch sendiri dan `return` early.

- [ ] **Step 3: Tambah UI segmented control + form habit di JSX**

  Cari baris pembuka modal content (setelah `<form onSubmit={handleSubmit}>`):
  ```jsx
            <form onSubmit={handleSubmit}>
              <label className="input-label">Judul *</label>
  ```
  Ganti dengan:
  ```jsx
            <form onSubmit={handleSubmit}>
              {/* Mode toggle — hanya tampil saat tambah baru (bukan edit) */}
              {!isEdit && (
                <div style={{ display: "flex", background: "var(--bg-primary)", borderRadius: 8, padding: 3, marginBottom: 18, gap: 3 }}>
                  {[["task","✓ Task"],["habit","🔁 Habit"]].map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setMode(m)} style={{
                      flex: 1, padding: "7px 0", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
                      background: mode === m ? "var(--accent)" : "transparent",
                      color: mode === m ? "#fff" : "var(--text-secondary)",
                      transition: "all 0.15s",
                    }}>{label}</button>
                  ))}
                </div>
              )}

              {/* ── Habit Form ── */}
              {mode === "habit" && (
                <div>
                  <label className="input-label">Nama Habit *</label>
                  <input className="input" value={habitForm.title} onChange={e => setHabit("title", e.target.value)} required style={{ marginBottom: 14 }} placeholder="Meditasi, Olahraga, Baca..." />

                  <label className="input-label">Fase</label>
                  <select className="input" value={habitForm.phase} onChange={e => setHabit("phase", e.target.value)} style={{ marginBottom: 14 }}>
                    <option value="pagi">☀️ Pagi (05:30–06:15)</option>
                    <option value="siang">🌤️ Siang (06:15–18:30)</option>
                    <option value="malam">🌙 Malam (18:30–22:00)</option>
                  </select>

                  <label className="input-label">Micro Target <span style={{ color: "var(--text-light)", fontWeight: 400 }}>(opsional)</span></label>
                  <input className="input" value={habitForm.micro_target} onChange={e => setHabit("micro_target", e.target.value)} style={{ marginBottom: 14 }} placeholder="5 menit, 2 halaman, 10 push-up..." />

                  <label className="input-label">Frekuensi</label>
                  <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                    {DAYS.map(d => (
                      <button key={d.key} type="button" onClick={() => toggleDay(d.key)} style={{
                        padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12,
                        background: habitForm.frequency.includes(d.key) ? "var(--accent)" : "var(--bg-primary)",
                        color: habitForm.frequency.includes(d.key) ? "#fff" : "var(--text-secondary)",
                        fontWeight: habitForm.frequency.includes(d.key) ? 600 : 400,
                      }}>{d.label}</button>
                    ))}
                  </div>

                  <label className="input-label">Identity Pillar <span style={{ color: "var(--text-light)", fontWeight: 400 }}>(opsional)</span></label>
                  <input className="input" value={habitForm.identity_pillar} onChange={e => setHabit("identity_pillar", e.target.value)} style={{ marginBottom: 14 }} placeholder="Saya adalah orang yang..." />

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                    <button type="button" className="btn" onClick={onClose}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "..." : "Tambah Habit"}</button>
                  </div>
                </div>
              )}

              {/* ── Task Form (existing, hidden in habit mode) ── */}
              {mode === "task" && (
                <div>
                  <label className="input-label">Judul *</label>
  ```

  Kemudian cari penutup form task (tombol Batal/Tambah di bawah form task). Cari pola:
  ```jsx
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
                  <button type="button" className="btn" onClick={onClose}>Batal</button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "..." : isEdit ? "Simpan" : "Tambah"}</button>
                </div>
  ```
  Tambahkan `</div>` penutup SETELAH div buttons tersebut:
  ```jsx
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24 }}>
                  <button type="button" className="btn" onClick={onClose}>Batal</button>
                  <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "..." : isEdit ? "Simpan" : "Tambah"}</button>
                </div>
                </div>
              )}
  ```

- [ ] **Step 4: Verifikasi manual**

  1. Klik "+ Tambah Task" → modal terbuka, ada toggle `[✓ Task] [🔁 Habit]` di atas
  2. Klik "Task" → form task normal muncul
  3. Klik "Habit" → form habit muncul (Nama, Fase, Micro Target, Frekuensi, Identity Pillar)
  4. Isi form habit → klik "Tambah Habit" → toast sukses
  5. Saat edit task (`isEdit = true`) → toggle tidak muncul, form task langsung tampil

- [ ] **Step 5: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: modal toggle Task/Habit + habit form dengan offline support"
  ```

---

## Task 5: Frontend — HabitPage + HabitCheckinModal

**Files:**
- Modify: `static/index.html` — tambah dua komponen baru sebelum `// MAIN APP` atau sebelum definisi `function App(`

  Cari marker lokasi:
  ```bash
  grep -n "function App\b\|function SettingsPage" static/index.html | tail -5
  ```
  Tambahkan komponen baru SEBELUM `function App(`.

- [ ] **Step 1: Tambah CSS untuk HabitPage**

  Cari blok CSS di `<style>` tag (cari `/* ── Chat` atau area CSS terakhir). Tambahkan di akhir blok `<style>`:
  ```css
  /* ── Habit Tracker ── */
  .habit-phase-header { font-weight: 700; font-size: 12px; letter-spacing: 0.05em; padding: 6px 10px; }
  .habit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .habit-table th { text-align: center; padding: 6px 4px; color: var(--text-secondary); font-weight: 600; font-size: 11px; border-bottom: 1px solid var(--border); }
  .habit-table th:first-child { text-align: left; padding-left: 10px; }
  .habit-table td { padding: 8px 4px; border-bottom: 1px solid var(--border); text-align: center; vertical-align: middle; }
  .habit-table td:first-child { text-align: left; padding-left: 10px; }
  .habit-table tr.habit-row { cursor: pointer; transition: background 0.12s; }
  .habit-table tr.habit-row:hover { background: rgba(168,197,0,0.07); }
  .habit-table td.today-col { background: rgba(168,197,0,0.08); font-weight: 700; border-left: 2px solid var(--accent); border-right: 2px solid var(--accent); }
  .habit-phase-group-pagi { background: rgba(168,197,0,0.06); }
  .habit-phase-group-siang { background: rgba(250,204,21,0.06); }
  .habit-phase-group-malam { background: rgba(129,140,248,0.06); }
  .habit-card { background: var(--bg-card); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; cursor: pointer; border: 1px solid var(--border); transition: box-shadow 0.15s, transform 0.15s; }
  .habit-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); transform: translateY(-1px); }
  .habit-week-dots { display: flex; gap: 4px; margin-top: 8px; }
  .habit-week-dot { width: 18px; height: 18px; border-radius: 4px; background: var(--bg-primary); border: 1px solid var(--border); }
  .habit-week-dot.done { background: var(--accent); border-color: var(--accent); }
  .habit-week-dot.skipped { background: #facc15; border-color: #facc15; }
  .habit-week-dot.missed { background: #ef4444; border-color: #ef4444; opacity: 0.5; }
  .habit-checkin-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .habit-checkin-modal-box { background: var(--bg-card); border-radius: 16px; padding: 24px; width: 300px; box-shadow: 0 8px 32px rgba(0,0,0,0.25); }
  ```

- [ ] **Step 2: Tambah komponen `HabitCheckinModal`**

  Tambahkan sebelum `function App(` (cari baris itu dengan `grep -n "function App(" static/index.html`):

  ```jsx
    function HabitCheckinModal({ habit, onClose, onCheckin }) {
      const [skipReason, setSkipReason] = useState("");
      const [showSkipInput, setShowSkipInput] = useState(false);
      const [loading, setLoading] = useState(false);

      const submit = async (status) => {
        setLoading(true);
        await onCheckin(habit.id, status, status === "skipped" ? skipReason : "");
        setLoading(false);
        onClose();
      };

      return (
        <div className="habit-checkin-modal" onClick={onClose}>
          <div className="habit-checkin-modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{habit.title}</div>
            {habit.micro_target && (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>🎯 {habit.micro_target}</div>
            )}
            <div style={{ fontSize: 12, color: "var(--text-light)", marginBottom: 20 }}>
              {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}
            </div>

            {habit.today_status ? (
              <div style={{ textAlign: "center", padding: "12px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{habit.today_status === "done" ? "✅" : "⏭️"}</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                  Sudah {habit.today_status === "done" ? "selesai" : "di-skip"} hari ini
                </div>
                {habit.skip_reason && <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 4 }}>"{habit.skip_reason}"</div>}
                <button className="btn" style={{ marginTop: 16 }} onClick={onClose}>Tutup</button>
              </div>
            ) : (
              <div>
                {!showSkipInput ? (
                  <div style={{ display: "flex", gap: 10 }}>
                    <button className="btn btn-primary" style={{ flex: 1, padding: "10px 0", fontSize: 15 }} disabled={loading}
                      onClick={() => submit("done")}>
                      ✓ Done
                    </button>
                    <button className="btn" style={{ flex: 1, padding: "10px 0", fontSize: 15, background: "var(--bg-primary)" }} disabled={loading}
                      onClick={() => setShowSkipInput(true)}>
                      ↷ Skip
                    </button>
                  </div>
                ) : (
                  <div>
                    <label className="input-label">Alasan skip <span style={{ fontWeight: 400, color: "var(--text-light)" }}>(opsional)</span></label>
                    <input className="input" value={skipReason} onChange={e => setSkipReason(e.target.value)}
                      placeholder="Alasan singkat..." style={{ marginBottom: 12 }} autoFocus />
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn" style={{ flex: 1 }} onClick={() => setShowSkipInput(false)}>Kembali</button>
                      <button className="btn btn-primary" style={{ flex: 1, background: "#facc15", color: "#000" }} disabled={loading}
                        onClick={() => submit("skipped")}>
                        ↷ Skip
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
  ```

- [ ] **Step 3: Tambah komponen `HabitPage`**

  Tambahkan tepat setelah `HabitCheckinModal` (masih sebelum `function App(`):

  ```jsx
    function HabitPage({ user, showToast }) {
      const [habits, setHabits] = useState([]);
      const [loading, setLoading] = useState(true);
      const [checkinTarget, setCheckinTarget] = useState(null); // habit object untuk modal
      const isDesktop = window.innerWidth >= 768;

      const fetchHabits = async () => {
        try {
          const data = await api.get("/api/habits/today");
          setHabits(data);
          OfflineDB.cacheSet("habits_today", data);
        } catch (err) {
          // Offline: load dari cache, apply pending queue
          const cached = await OfflineDB.cacheGet("habits_today");
          if (cached) {
            const q = await OfflineDB.queueGetAll();
            let list = [...cached];
            for (const item of q) {
              // Apply pending checkin
              const checkinMatch = item.method === "POST" && item.url.match(/^\/api\/habits\/(\d+)\/checkin$/);
              if (checkinMatch) {
                const hid = parseInt(checkinMatch[1]);
                list = list.map(h => h.id === hid ? { ...h, today_status: item.body.status, skip_reason: item.body.skip_reason || "" } : h);
              }
              // Apply pending creation
              if (item.method === "POST" && item.url === "/api/habits" && item.tempId) {
                const exists = list.some(h => String(h.id) === item.tempId);
                if (!exists) list.push({
                  ...item.body, id: item.tempId, _pending: true,
                  today_status: null, skip_reason: "", streak: 0,
                  week_log: [null,null,null,null,null,null,null],
                });
              }
            }
            setHabits(list);
          }
        }
        setLoading(false);
      };

      useEffect(() => { fetchHabits(); }, []);

      const handleCheckin = async (habitId, status, skipReason) => {
        const today = new Date().toISOString().split("T")[0];
        try {
          await api.post(`/api/habits/${habitId}/checkin`, { status, skip_reason: skipReason, date: today });
        } catch (err) {
          if (isOfflineErr(err)) {
            await OfflineDB.queueAdd({ method: "POST", url: `/api/habits/${habitId}/checkin`, body: { status, skip_reason: skipReason, date: today } });
            showToast("Tersimpan offline, akan sync saat online 📶");
          } else {
            showToast(err.message, "error");
            return;
          }
        }
        // Update local state
        setHabits(prev => prev.map(h => h.id === habitId ? { ...h, today_status: status, skip_reason: skipReason } : h));
        if (status === "done") showToast("✅ Habit selesai!");
        else showToast("⏭️ Di-skip");
      };

      const PHASE_LABEL = { pagi: "☀️ PAGI", siang: "🌤️ SIANG", malam: "🌙 MALAM" };
      const PHASE_COLOR = { pagi: "var(--accent)", siang: "#facc15", malam: "#818cf8" };
      const DAY_LABELS = ["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
      const todayDow = (new Date().getDay() + 6) % 7; // 0=Sen ... 6=Min

      const quoteHabit = habits.find(h => h.identity_pillar);
      const quote = quoteHabit?.identity_pillar || "Jadikan hari ini lebih baik dari kemarin.";

      // Group by phase
      const phases = ["pagi","siang","malam"];
      const grouped = phases.reduce((acc, p) => { acc[p] = habits.filter(h => h.phase === p); return acc; }, {});

      // Desktop: table layout
      const renderDesktop = () => (
        <div style={{ overflowX: "auto" }}>
          <table className="habit-table">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Habit</th>
                {DAY_LABELS.map((d, i) => (
                  <th key={d} style={{ minWidth: 36, color: i === todayDow ? "var(--accent)" : undefined, fontWeight: i === todayDow ? 700 : 600 }}>{d}</th>
                ))}
                <th>🔥</th>
              </tr>
            </thead>
            <tbody>
              {phases.map(phase => {
                const phaseHabits = grouped[phase];
                if (!phaseHabits.length) return null;
                return (
                  <React.Fragment key={phase}>
                    <tr className={`habit-phase-group-${phase}`}>
                      <td colSpan={DAY_LABELS.length + 2} className="habit-phase-header" style={{ color: PHASE_COLOR[phase] }}>
                        {PHASE_LABEL[phase]}
                      </td>
                    </tr>
                    {phaseHabits.map(h => (
                      <tr key={h.id} className="habit-row" onClick={() => setCheckinTarget(h)}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{h.title}{h._pending && <span style={{ fontSize: 10, color: "var(--text-light)", marginLeft: 6 }}>⏳</span>}</div>
                          {h.micro_target && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{h.micro_target}</div>}
                        </td>
                        {(h.week_log || []).map((s, i) => (
                          <td key={i} className={i === todayDow ? "today-col" : ""}>
                            {s === "done" ? <span style={{ color: "var(--accent)" }}>✓</span>
                            : s === "skipped" ? <span style={{ color: "#facc15" }}>~</span>
                            : <span style={{ color: "var(--border)" }}>–</span>}
                          </td>
                        ))}
                        <td style={{ color: "var(--accent)", fontWeight: 700 }}>{h.streak > 0 ? `🔥${h.streak}` : "–"}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      );

      // Mobile: card layout
      const renderMobile = () => (
        <div>
          {phases.map(phase => {
            const phaseHabits = grouped[phase];
            if (!phaseHabits.length) return null;
            return (
              <div key={phase} style={{ marginBottom: 24 }}>
                <div className="habit-phase-header" style={{ color: PHASE_COLOR[phase], marginBottom: 8, fontSize: 13 }}>
                  {PHASE_LABEL[phase]}
                </div>
                {phaseHabits.map(h => (
                  <div key={h.id} className="habit-card" onClick={() => setCheckinTarget(h)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                          {h.today_status === "done" ? "✅ " : h.today_status === "skipped" ? "⏭️ " : ""}{h.title}
                          {h._pending && <span style={{ fontSize: 10, color: "var(--text-light)", marginLeft: 6 }}>⏳</span>}
                        </div>
                        {h.micro_target && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{h.micro_target}</div>}
                      </div>
                      {h.streak > 0 && <div style={{ color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>🔥 {h.streak}</div>}
                    </div>
                    <div className="habit-week-dots">
                      {(h.week_log || []).map((s, i) => (
                        <div key={i} className={`habit-week-dot${s === "done" ? " done" : s === "skipped" ? " skipped" : s === "missed" ? " missed" : ""}`}
                          title={DAY_LABELS[i]}
                          style={{ outline: i === todayDow ? "2px solid var(--accent)" : "none", outlineOffset: 1 }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      );

      if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-secondary)" }}>Memuat habits...</div>;

      return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>
              {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div style={{ fontSize: 15, color: "var(--text-secondary)", fontStyle: "italic" }}>"{quote}"</div>
          </div>

          {habits.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-secondary)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🌱</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Belum ada habit</div>
              <div style={{ fontSize: 13 }}>Klik "+ Tambah Task" lalu pilih tab Habit untuk mulai.</div>
            </div>
          ) : (
            isDesktop ? renderDesktop() : renderMobile()
          )}

          {checkinTarget && (
            <HabitCheckinModal
              habit={checkinTarget}
              onClose={() => setCheckinTarget(null)}
              onCheckin={handleCheckin}
            />
          )}
        </div>
      );
    }
  ```

- [ ] **Step 4: Verifikasi manual**

  1. Buka app → klik "🔁 Habit Tracker" di sidebar → halaman muncul (empty state atau habits)
  2. Tambah habit via modal (toggle ke Habit) → habit muncul di HabitPage setelah refresh
  3. Klik habit → `HabitCheckinModal` terbuka dengan tombol Done/Skip
  4. Klik Done → ✅ muncul di kartu, toast "Habit selesai!"
  5. Klik Skip → input alasan muncul → submit → ⏭️ muncul di kartu
  6. DevTools → Offline → tambah habit → tersimpan dengan badge ⏳
  7. DevTools → Offline → cek-in habit → tersimpan offline, local state update
  8. Tutup browser saat offline → buka lagi → habits + pending checkin masih muncul

- [ ] **Step 5: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: HabitPage + HabitCheckinModal — desktop table, mobile cards, full offline"
  ```

---

## Task 6: Deploy & Verifikasi Production

- [ ] **Step 1: Push ke GitHub**

  ```bash
  git push origin main
  ```

- [ ] **Step 2: Restart service di VPS (perlu untuk perubahan backend)**

  Backend berubah (`repository.py`, `webapp.py`) → perlu restart service:
  ```
  # Jalankan manual di VPS:
  sudo systemctl restart taskflow
  # atau sesuai setup VPS
  ```

- [ ] **Step 3: Verifikasi di production `https://todo.yatno.web.id`**

  1. Sidebar → "🔁 Habit Tracker" ada antara Fokus Hari Ini dan Diskusi
  2. "+ Tambah Task" → toggle `[✓ Task] [🔁 Habit]` tampil
  3. Tambah habit → muncul di HabitPage
  4. Klik habit → modal Done/Skip berfungsi
  5. Desktop: tabel dengan kolom hari, klik row → modal
  6. Mobile: cards per fase, tap card → modal
  7. Offline: check-in dan tambah habit tersimpan, muncul saat reload
