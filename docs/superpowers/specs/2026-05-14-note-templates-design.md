# Note Templates — Design Spec
**Tanggal:** 2026-05-14
**Status:** Approved for implementation

---

## Overview

Fitur template catatan memungkinkan user memilih struktur markdown siap pakai saat membuat catatan baru. Template dipilih via dropdown di toolbar editor, hanya aktif saat konten masih kosong, dan dikelola di page Akun.

---

## Data Model

### Tabel: `note_templates`

```sql
CREATE TABLE IF NOT EXISTS note_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    group_name  TEXT NOT NULL,
    content     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

- Satu row per template per user
- `group_name` adalah string bebas (tidak ada tabel grup terpisah)
- Template diurutkan by `group_name`, lalu `sort_order`, lalu `name`

---

## Default Templates

Di-seed otomatis saat user pertama kali hit `GET /api/note-templates` dan belum punya template apapun. Default templates bisa diedit/dihapus oleh user.

### Grup 1: Umum & Penangkapan Cepat

**Catatan Cepat**
```markdown
# Catatan Cepat

## Inti Pikiran
- 

## Detail
- 

## Tindakan Selanjutnya
- [ ] 
```

**Curah Pikiran**
```markdown
# Curah Pikiran

## Apa yang Sedang Saya Pikirkan
- 
```

### Grup 2: Pekerjaan & Proyek

**Log Harian**
```markdown
# Log Harian - [Tanggal]

## Fokus Hari Ini
- 

## Progress
- 

## Hambatan
- 

## Besok
- 
```

**Catatan Rapat**
```markdown
# Judul Rapat

**Tanggal:**  
**Peserta:**  

## Agenda
- 

## Diskusi
- 

## Keputusan
- 

## Tindak Lanjut
- [ ] 
```

**Perencanaan Proyek**
```markdown
# Nama Proyek

## Tujuan
- 

## Ruang Lingkup
- 

## Timeline & Milestone
- 

## Tugas
- [ ] 
```

**Pemecahan Masalah**
```markdown
# Masalah / Isu

## Kondisi Saat Ini
- 

## Akar Penyebab
- 

## Dampak
- 

## Solusi
- 

## Tindakan Lanjutan
- [ ] 
```

**Pengambilan Keputusan**
```markdown
# Topik Keputusan

## Opsi
- 

## Kelebihan & Kekurangan
- **Opsi A:** (+)... (-) ...
- **Opsi B:** (+)... (-) ...

## Keputusan Akhir
- 
```

### Grup 3: Evaluasi & Pembelajaran

**Tinjauan Mingguan**
```markdown
# Tinjauan Mingguan

## Pencapaian
- 

## Kegagalan / Tantangan
- 

## Pelajaran yang Dipetik
- 

## Fokus Minggu Depan
- 
```

**Catatan Pembelajaran**
```markdown
# Topik

**Sumber:**  

## Insight Utama
- 

## Kutipan Penting
> 

## Hal yang Dapat Diterapkan
- 
```

---

## API Endpoints

### `GET /api/note-templates`
- Return semua template milik user, diurutkan by group_name → sort_order → name
- Jika user belum punya template, seed 9 default lalu return
- Response: `[{ id, name, group_name, content, sort_order }]`

### `POST /api/note-templates`
- Body: `{ name, group_name, content }`
- sort_order default: max sort_order dalam group + 1
- Return: template baru

### `PUT /api/note-templates/{id}`
- Body: `{ name?, group_name?, content? }` (partial update)
- Owner-only: 403 jika bukan milik user
- Return: template updated

### `DELETE /api/note-templates/{id}`
- Owner-only: 403 jika bukan milik user
- Return: `{ ok: true }`

---

## Frontend

### NoteToolbar — Perubahan

**Prop baru:**
- `content: string` — isi editor saat ini, untuk cek apakah kosong
- `onApplyTemplate: (markdownContent: string) => void` — dipanggil saat user pilih template

**Behavior tombol:**
- Label: `📋 Template ▾`
- Posisi: **paling kiri** di toolbar, sebelum separator dan tombol H
- Aktif (accent border + teks accent): hanya jika `content` kosong atau hanya whitespace
- Disabled (abu-abu, tidak bisa diklik): jika `content` sudah ada isi
- Template di-fetch sekali saat `NoteToolbar` mount via `GET /api/note-templates`, disimpan di state lokal

**Dropdown:**
- Muncul di bawah tombol saat diklik (absolute positioned, z-index tinggi)
- Dikelompokkan by `group_name`, dengan divider antar grup
- Label grup: uppercase, abu-abu kecil
- Item: nama template, klik → panggil `onApplyTemplate(template.content)`
- Footer (terpisah divider): `⚙️ Kelola Template...` → navigate ke Akun page (dispatch event atau setPage("settings"))
- Tutup saat klik di luar atau pilih item

**Urutan toolbar setelah perubahan:**
```
📋 Template ▾  |  H ▾  B  I  </>  |  ≡  ☑  ❝  +  —  📎
```

### Cakupan — 3 Tempat

`NoteToolbar` sudah dipakai di tiga tempat; perubahan prop `content` dan `onApplyTemplate` berlaku untuk keduanya:

| Tempat | `content` dari | `onApplyTemplate` |
|---|---|---|
| NoteModal | state `content` | `setContent(tpl)` |
| TaskFormModal tab Note | state `noteForm.content` | `setNote("content", tpl)` |
| Expand view fullscreen | state `content` | `setContent(tpl)` |

### Page Akun — Section Baru: "Template Catatan"

Ditambahkan sebagai section di dalam `SettingsPage` (atau komponen terpisah `NoteTemplatesSettings`).

**UI:**
- Header section: judul "📋 Template Catatan" + deskripsi + tombol "＋ Tambah Template"
- List dikelompokkan by `group_name` dengan label grup
- Setiap item: nama template | badge "default"/"custom" | tombol Edit | tombol Hapus
- Edit/Tambah: form inline atau modal kecil dengan field:
  - Nama template (input teks)
  - Grup (dropdown dari grup yang sudah ada + opsi "Grup baru...")
  - Konten (textarea, markdown)
  - Tombol Simpan / Batal
- Hapus: konfirmasi singkat sebelum delete

---

## Offline Behavior

`GET /api/note-templates` otomatis di-cache oleh Service Worker (network-first + cache fallback, seperti semua `GET /api/*`). Tidak ada perubahan di `sw.js`.

Mutasi (POST/PUT/DELETE) saat offline: tidak di-queue (template management adalah rare operation, tidak kritis saat offline).

---

## Out of Scope

- Drag-drop reorder template
- Rename/reorder grup
- Share template antar user
- Preview template sebelum dipilih
