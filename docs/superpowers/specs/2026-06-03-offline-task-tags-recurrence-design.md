# Offline Task Tags + Recurrence Persistence — Design (Plan #1e(a))

**Status:** Disetujui 2026-06-03
**Parent spec:** `docs/superpowers/specs/2026-06-03-offline-first-local-data-layer-design.md` (sub-proyek #1, Kelompok 1 domain personal)
**Predecessors:** #1a scaffold, #1b tasklogic, #1c taskrepo CRUD, #1d taskquery — semua SELESAI, 79 test Node hijau di `main`.

## Tujuan

Melengkapi data-layer task offline dengan dua kapabilitas yang sengaja ditunda di #1c/#1d:

1. **Tag domain (task-only)** — persist `#tags` dari judul task ke store lokal `tags` + `entity_tags`, dan **mengaktifkan filter `tag`** di `listTasks` (non-goal eksplisit #1d).
2. **Recurrence** — persist field `recurrence_*` saat create/update task, plus store `recurring_exceptions` dengan operasi `markOccurrence` + range-query `getExceptions`.

Semua Node-tested (`fake-indexeddb`), paritas perilaku `webapp.py`. Tidak menyentuh `index.html`/backend/Service Worker (itu #1e(b)).

## Non-goals (ditunda — ditulis eksplisit agar tak hilang)

- ❌ **Tag untuk notes / habits / mindmaps.** `tagrepo.js` dibuat lintas-entitas (API `setEntityTags(type, cid, names)`), tetapi pemanggilannya untuk note/habit/mindmap menyusul di **plan domain masing-masing** (note-repo offline, habit-repo offline, dst.) yang belum dibuat. Roadmap ini sudah tercatat di spec induk baris ~238 ("replikasi pola ke domain Kelompok 1 lain: … tags/entity_tags").
- ❌ **Ekspansi occurrence recurring.** `computeOccurrences()` sudah ada di `static/index.html` (frontend, ~baris 9963) dan **tetap di sana** — server pun tidak mengekspansi. Data-layer hanya menyimpan field + exceptions; frontend menghitung occurrence dari field tersebut. Tidak ada port `computeOccurrences`.
- ❌ **Push/sync ke server.** Konsisten **Opsi B**: tulis `_outbox` saja; push/pull/konflik di sub-proyek #2.
- ❌ **Wiring `index.html` / intercept `api` / SW.** Itu #1e(b).
- ❌ Notifikasi expiry recurring (`/api/recurring/check-expiry`) — server-side background, tak relevan offline.

## Sumber kebenaran (dari `webapp.py`)

### Tag
- Regex & normalisasi: `#([a-zA-Z0-9_À-ɏ]+)`, di-`lower()`, `strip()`. (`taskrepo.TAG_RE` sudah cocok.)
- **Create** (baris 916–919, 984–986): ekstrak tag dari judul, strip judul, `_upsert_tags_for_entity(... 'task' ...)`. `tags` unik per `(user_id, name)` via `INSERT OR IGNORE`. `entity_tags` `INSERT OR IGNORE (tag_id, user_id, entity_type, entity_id)`.
- **Update** (baris 1043–1049, 1118–1122): `task_tags` dihitung **hanya jika `title` ada di payload**. Jika ada → `DELETE FROM entity_tags WHERE entity_type='task' AND entity_id=?` lalu re-upsert. Jika `title` tidak dikirim → tag tak disentuh.
- **Filter list** (baris 895–902): `tag` di-`strip().lower()`; task lolos jika `id IN (SELECT entity_id FROM entity_tags JOIN tags WHERE entity_type='task' AND name=?)`.
- **GET `/api/tasks/{id}/tags`** (baris 1006–1018): kembalikan `[{id, name, color}]`, `ORDER BY name ASC`.
- **DELETE `/api/tasks/{id}/tags/{name}`** (baris 1021–1036): hapus relasi `entity_tags` untuk `name` (lower) pada task itu. (Tag global tetap ada.)
- **GET `/api/tags`**: daftar tag milik user (digunakan untuk filter/autocomplete).

### Recurrence
- Field task: `recurrence_type` ∈ {`daily`,`weekly`,`monthly`,`weekdays`} (selain itu → `null`); `recurrence_days` = **JSON string** (weekly `[0..6]` filter valid; monthly `[clamp(day,1,28)]`; lainnya `null`); `recurrence_end_date` = `today + 90 hari` **saat type di-set & belum ada end_date**; `recurrence_notif_level`.
- **Create** (baris 958–968): set field di atas; end_date selalu di-set saat type valid.
- **Update** (baris 1082–1101): `recurrence_renew` (prioritas) → end_date = today+90, notif_level = null. Else jika `recurrence_type` dikirim: valid → set type+days, end_date di-set hanya bila belum ada; invalid/null → clear semua field recurrence.
- **mark occurrence** `POST /api/tasks/{id}/occurrences/{date}/mark` (baris 1212–1239): `status` ∈ {`done`,`skipped`} else 400; tanggal valid `YYYY-MM-DD` else 400; task harus recurring else 400; `date` harus dalam `[created_at[:10], recurrence_end_date]` else 400; upsert by `(task_id, occurrence_date)` ON CONFLICT update `status`.
- **get exceptions** `GET /api/recurring/exceptions?from=&to=` (baris 1242–1269): range inklusif; balikan map `{ "<task_id>": [{occurrence_date, status}, …] }`, hanya task yang masih ada (JOIN tasks).

## Arsitektur — modul (boundary bersih, dapat diuji terpisah)

| Modul | Status | Tanggung jawab | Bergantung pada |
|---|---|---|---|
| `static/offline/tagrepo.js` | **BARU** | Lintas-entitas. `extractTags`, `setEntityTags`, `getEntityTags`, `getAllTags`, `removeEntityTag` | `db` |
| `static/offline/recurrence.js` | **BARU** | `markOccurrence`, `getExceptions` (store `recurring_exceptions`) | `db`, `outbox` |
| `static/offline/taskrepo.js` | **UBAH** | Simpan field `recurrence_*`; panggil `tagrepo.setEntityTags('task', cid, tags)` di create/update | + `tagrepo` |
| `static/offline/taskquery.js` | **UBAH** | Implement filter `tag` lewat `tagrepo` | + `tagrepo` |

### `tagrepo.js` (API)
- `extractTags(title) → { clean: string, tags: string[] }` — regex sama persis server; `tags` unik, lowercased, urut kemunculan; `clean` = judul tanpa tag, trimmed.
- `setEntityTags(entityType, entityCid, tagNames) → Promise` — untuk tiap nama: upsert `tags` by-name (cari index `name`; reuse `cid` bila ada, else buat `{cid, server_id:null, name, color:null, dirty:1}`); **rewrite** `entity_tags` entitas itu (hapus semua `[entityType, entityCid]` lalu insert ulang `{cid, tag_cid, entity_type, entity_cid, dirty:1}`). Set kosong → hanya hapus. Idempoten.
- `getEntityTags(entityType, entityCid) → Promise<[{name, color}]>` — urut `name` asc.
- `getAllTags() → Promise<[{name, color}]>` — semua tag, urut `name` asc.
- `removeEntityTag(entityType, entityCid, name) → Promise<{ok:true}>` — hapus relasi `entity_tags` untuk `name` (lower) pada entitas; tag global tetap.

> **Tag/entity_tags = indeks lokal turunan** untuk memberi filter & read offline. Tidak di-push terpisah ke server; saat sync (#2) server menurunkan ulang tag dari judul task. (Karena itu tag tidak menambah op `_outbox` sendiri.)

### `recurrence.js` (API)
- `markOccurrence(taskCid, occurrenceDate, status, opts) → Promise<record>` — validasi `status` ∈ {done,skipped} & format tanggal; task harus ada, recurring (`recurrence_type`), dan `occurrenceDate` dalam `[created_at[:10], recurrence_end_date]`; upsert `recurring_exceptions` (key `cid`, index `task_cid`) by `(task_cid, occurrence_date)`; rekam op ke `_outbox` (`{op:'mark_occurrence', entity_type:'recurring_exception', cid, payload}`); kembalikan record.
- `getExceptions(fromDate, toDate) → Promise<{ [task_cid]: [{occurrence_date, status}] }>` — range inklusif; hanya exception milik task yang masih ada & `deleted!==true`.

> Key map = `task_cid`. Saat wiring #1e(b), task row offline mengekspos `id := cid`, sehingga `recurExceptions[t.id]` di `index.html` tetap cocok.

### `taskrepo.js` (perubahan)
- `createTask`: tambah field record `recurrence_type` (validasi enum→null), `recurrence_days` (JSON string via aturan weekly/monthly), `recurrence_end_date` (today+90 jika type valid), `recurrence_notif_level: null`. Setelah `putRaw` + outbox, panggil `tagrepo.setEntityTags('task', rec.cid, extractedTags)` (tag diekstrak via `tagrepo.extractTags`, mengganti `stripTags` lama).
- `updateTask`: jika `patch.title` ada → ekstrak tag, set `setEntityTags('task', cid, tags)` (rewrite). Recurrence: `recurrence_renew` → end_date=today+90, notif_level=null; else jika `patch.recurrence_type` ada di patch → valid set type/days (+end_date bila belum ada), invalid/null clear semua. `recurrence_days` hanya berubah saat dikirim.
- Catatan outbox: payload task `create`/`update` tetap seperti sekarang (full record, judul sudah bersih). Fidelitas replay tag untuk server diserahkan #2 (server menurunkan tag dari judul; refinemen kontrak outbox di #2).

### `taskquery.js` (perubahan)
- `matchesQuery`: hapus komentar "tag diabaikan"; bila `q.tag` ada, resolusi async di `listTasks` — kumpulkan set `entity_cid` task yang punya `entity_tags`→tag bernama `q.tag.toLowerCase()`, filter task pada set itu. (Pre-resolve sekali per panggilan agar tetap satu pass in-memory.)

## Data flow

```
createTask(input)
  ├─ extractTags(title) → {clean, tags}
  ├─ rec = {…, title:clean, recurrence_*}      → putRaw + _outbox(create)
  └─ tagrepo.setEntityTags('task', cid, tags)  → upsert tags + rewrite entity_tags

listTasks({tag:'kerja'})
  ├─ getAllRaw → live tasks
  ├─ tagrepo: cid-set utk tag 'kerja'  (entity_tags ⋈ tags.name)
  └─ filter(matchesQuery + cid∈set) → sort → displayFrom

markOccurrence(taskCid,'2026-06-10','done')
  ├─ validasi (status/tanggal/range/recurring)
  ├─ upsert recurring_exceptions
  └─ _outbox(mark_occurrence)
```

## Testing (Node, paritas server)

- `tests/offline/tagrepo.test.js` (BARU): extractTags (regex, lower, unik, clean-trim); setEntityTags upsert+reuse-by-name+rewrite+empty-clear; getEntityTags/getAllTags sorted; removeEntityTag (relasi hilang, tag global tetap).
- `tests/offline/recurrence.test.js` (BARU): markOccurrence happy + tiap jalur 400 (status invalid, tanggal invalid, non-recurring, di luar range) + upsert-conflict update; getExceptions range inklusif + key by task_cid + skip task terhapus.
- `tests/offline/taskrepo.test.js` (PERLUAS): create simpan recurrence + persist tag (entity_tags terbentuk); update rewrite tag saat title berubah & tak sentuh tag saat title absen; recurrence set/renew/clear.
- `tests/offline/taskquery.test.js` (PERLUAS): `listTasks({tag})` menyaring sesuai entity_tags; tag tak ada → kosong.
- Perintah suite penuh ditambah dua file baru; semua hijau, tak hang (lihat `feedback_node_test_env`).

## Done criteria

1. `tagrepo.js` & `recurrence.js` ada, ter-export, Node-tested.
2. Tag task ter-persist saat create/update (paritas re-derive-on-title); `listTasks({tag})` berfungsi.
3. Field `recurrence_*` ter-persist (create + update renew/set/clear); `markOccurrence`/`getExceptions` paritas endpoint.
4. Read API tag lengkap: `getEntityTags`, `getAllTags`, `removeEntityTag`.
5. Outbox: `markOccurrence` enqueue; tag tidak (turunan).
6. Seluruh suite offline hijau, tanpa hang. Tak ada perubahan `index.html`/backend/SW.

## Next (di luar scope)

- #1e(b) **Wiring `index.html`** — intercept `api` via `LocalRouter` (map `/api/tasks*`, `/api/summary`, `/api/projects`, `/api/contexts`, `/api/tasks/{id}/tags`, `/api/tags`, `/api/recurring/exceptions`, `/api/tasks/{id}/occurrences/{date}/mark`), pensiunkan `OfflineDB`/`computeOfflineQuadrant` lama, hydration, bump SW cache. **Browser-verified.**
- Plan domain note/habit/mindmap offline → memanggil `tagrepo.setEntityTags` untuk entity_type masing-masing.
