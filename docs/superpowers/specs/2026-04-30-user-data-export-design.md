# User Data Export — Design Spec

**Goal:** User dapat mendownload semua datanya (notes, tasks, habits) sebagai satu file ZIP untuk backup, dengan notes dalam format Markdown yang kompatibel dengan Obsidian (wikilink tetap berfungsi).

**Architecture:** Satu endpoint `GET /api/export/download` (auth required). Server generate ZIP in-memory menggunakan Python stdlib `zipfile`, stream langsung ke browser sebagai file download. Tidak ada dependency baru.

**Tech Stack:** FastAPI, Python `zipfile` + `io.BytesIO`, SQLite, React (tombol di Settings page).

---

## ZIP Structure

```
taskflow-export-YYYY-MM-DD.zip
├── notes/
│   ├── {sanitized_title}.md   (satu file per note)
│   └── ...
├── tasks.json
├── tasks.csv
├── habits.json
└── habits.csv
```

---

## Notes Format

Setiap note dari tabel `scratchpad_notes` diekspor sebagai file `.md` tersendiri.

**Nama file:** judul note, karakter illegal (`/\:*?"<>|`) diganti `-`, strip whitespace di awal/akhir. Jika judul kosong, gunakan `untitled-{id}.md`. Jika ada duplikat, tambah suffix `({n})`.

**Isi file:**
```markdown
---
tags: [tag1, tag2]
created_at: 2026-04-01T10:00:00
updated_at: 2026-04-29T15:30:00
---

{content as-is}
```

**Wikilink:** Konten dibiarkan as-is — `[[Judul Note]]` tidak diubah. Kompatibilitas:
- Obsidian ✅ — resolve otomatis ke file `.md` dengan nama sama
- Logseq ✅ — native support
- VS Code + Foam/Dendron ✅ — dengan extension
- Typora / editor standard — tampil sebagai teks biasa `[[Judul]]`

---

## Tasks Format

**tasks.json** — array of tasks, subtasks dan notes di-embed:
```json
[
  {
    "id": 1,
    "title": "Beli laptop",
    "priority": "high",
    "quadrant": "Q1",
    "gtd_status": "next",
    "due_date": "2026-05-01",
    "project": "Kantor",
    "context": "@online",
    "done": false,
    "created_at": "2026-04-01T10:00:00",
    "subtasks": [
      {"title": "Cek harga", "done": true}
    ],
    "notes": ["Cari di Tokopedia dulu"]
  }
]
```

**tasks.csv** — flat, satu baris per task (subtasks tidak ikut):
```
id,title,priority,quadrant,gtd_status,due_date,project,context,done,created_at
1,Beli laptop,high,Q1,next,2026-05-01,Kantor,@online,false,2026-04-01T10:00:00
```

---

## Habits Format

**habits.json** — habits dengan log history di-embed:
```json
[
  {
    "title": "Olahraga pagi",
    "phase": "pagi",
    "micro_target": "30 menit",
    "logs": [
      {"date": "2026-04-29", "status": "done", "skip_reason": ""},
      {"date": "2026-04-28", "status": "skipped", "skip_reason": "hujan"}
    ]
  }
]
```

**habits.csv** — flat, satu baris per log entry:
```
habit_title,phase,micro_target,date,status,skip_reason
Olahraga pagi,pagi,30 menit,2026-04-29,done,
Olahraga pagi,pagi,30 menit,2026-04-28,skipped,hujan
```

---

## API Endpoint

```
GET /api/export/download
Authorization: cookie JWT (get_current_user)
Response: application/zip
Content-Disposition: attachment; filename="taskflow-export-2026-04-30.zip"
```

Generate ZIP in-memory (`io.BytesIO`), query semua data milik `user_id` dari:
- `scratchpad_notes` (+ join `tags` via `entity_tags`)
- `tasks` + `subtasks` + `task_notes`
- `habits` + `habit_logs`

---

## UI — Settings Page

Tambah section "Backup & Export" di paling bawah settings page, setelah section yang sudah ada:

```
─── Backup & Export ───────────────────────────
Download semua data kamu: notes (Markdown,
kompatibel Obsidian), tasks, dan habits.

[⬇ Download Backup (.zip)]
```

- Tombol klik → fetch `GET /api/export/download` → `blob()` → create object URL → trigger `<a>` click → auto-download
- Saat loading: tombol disabled + label "Menyiapkan..."
- Tidak ada konfirmasi dialog
- File name: `taskflow-export-YYYY-MM-DD.zip`
