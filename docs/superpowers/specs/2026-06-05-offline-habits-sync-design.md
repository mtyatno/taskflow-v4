# Offline Habits — Sync (#2e-2) Design

**Status:** Disetujui 2026-06-05
**Parent:** Inisiatif offline native (Model B). Sub-proyek #2 (sync engine). Slice habits kedua. #1 + #2a–d-1 + #2e-1 SELESAI & deployed (SW v125, 185 test). Lihat [[project_offline_native]].
**Predecessor state:** Habits sudah local-first (#2e-1): `habitrepo` (createHabit/updateHabit/deleteHabit/checkin) merekam `_outbox` (op `create`/`update`/`delete` entity_type `habit`, op `checkin` entity_type `habit_log`) tapi **belum push** (Opsi B). `habithydrate.ensureHabits` blind-pull saat boot. Mesin sync task lengkap: `syncpush.processOp` (dispatch `entity_type`+`op`), `syncpull.pullTasks` (full-list reconcile, skip-dirty, LWW by `updated_at`, edit-vs-delete→flag). `sync()` = **pull→push** (sejak #2c).

## Tujuan

Sambungkan domain **habits** ke mesin sync: perubahan habit/checkin lokal (yang selama ini "pulau" sejak #2e-1) merambat ke server (terlihat di web/bot), dan perubahan server (device lain/web) ditarik ke lokal. Extend `syncpush` + `syncpull` secara pragmatis — **tanpa modul baru, tanpa perubahan backend**.

## Keputusan terkunci (brainstorming 2026-06-05)

1. **Extend, bukan refactor.** Tambah mapper + handler op habit ke `syncpush.js`; tambah `pullHabits`/`pullHabitLogs` ke `syncpull.js`. Handler task tak disentuh.
2. **Habit tak punya `updated_at`** → bukan LWW timestamp. **Definisi habit = local-wins.**
3. **Edit-vs-delete habit (local-wins, re-create).** Saat push update kena **404** (habit dihapus device lain), buat ulang via `POST /api/habits` + remap `server_id` baru → edit lokal bertahan. (Bukan banner seperti task #2c; habit single-user low-stakes.)
4. **habit_logs = upsert-by-(habit,date).** Tanpa deteksi server-delete (server tak pernah hapus log; checkin = INSERT/UPDATE). Reconcile = upsert.
5. **`pullHabits` menggantikan `ensureHabits` di boot** (seperti `syncpull` menggantikan `hydrate.ensureTasks` di #2b). `ensureHabits` jadi unused → tandai cleanup.

## Non-goals (eksplisit)

- ❌ Endpoint delta `?since=` / tombstone server (tetap full-list reconcile client-only).
- ❌ Deteksi server-delete habit_logs (kode mati — server tak punya jalurnya).
- ❌ Banner/prompt konflik habit (local-wins otomatis).
- ❌ habit-templates sync (online dulu).
- ❌ Notes/mindmap/chat (#2f/#2g/#2h) & Tauri/Android (#3/#4).

## Kontrak server (dari `webapp.py`, TAK diubah)

- `GET /api/habits` → `[habit dict]` (`id, title, phase, micro_target, frequency(JSON string), identity_pillar, created_at`) `ORDER BY phase, id`. **NO `updated_at`.**
- `POST /api/habits` (`HabitCreate{title, phase, micro_target, frequency[], identity_pillar}`): strip+derive `#tag` dari title; phase ∈ pagi/siang/malam. Balas full habit dict (incl. `id`).
- `POST /api/habits/{id}/update` (`HabitUpdate` sama): re-derive tag. Balas `{ok, id}`. **404** bila habit tak ada/milik user lain.
- `DELETE /api/habits/{id}`: hard delete (cascade habit_logs). Balas `{ok}`. **404** bila sudah hilang.
- `POST /api/habits/{id}/checkin` (`HabitCheckinReq{status, skip_reason, date}`): upsert `habit_logs` ON CONFLICT(habit_id,date). Balas `{ok, habit_id, date, status}`. **404** bila habit tak ada.
- `GET /api/habits/logs?since=` (dari #2e-1, default today_jkt-90d): `[{habit_id, date, status, skip_reason}]`.

## Bentuk record & `_outbox` (dari #2e-1)

- **Habit lokal:** `{cid, server_id, title(bersih), phase, micro_target, frequency(JSON string), identity_pillar, created_at, deleted, dirty}`. (Tag di `entity_tags` lokal entity_type `habit`.) NO `updated_at`/`base_rev`.
- **habit_log lokal:** `{cid, habit_cid, date, status, skip_reason, dirty}` — index `habit_date` = `[habit_cid, date]` (unik).
- **Outbox:** `{op:'create'|'update'|'delete', entity_type:'habit', cid, payload}`; `{op:'checkin', entity_type:'habit_log', cid, payload}`.

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `static/offline/syncpush.js` | **UBAH** | mapper `habitToCreatePayload`/`habitToUpdatePayload`/`checkinPayload` + handler op habit/habit_log (incl. 404→re-create) | Node |
| `static/offline/syncpull.js` | **UBAH** | `pullHabits` + `pullHabitLogs` + `pullHabitsAndLogs(rawFetch)` | Node |
| `static/index.html` | **UBAH** | `sync()` tambah pull habits; hapus `ensureHabits()` boot | Browser |
| `static/sw.js` | **UBAH** | bump v125→v126 | Browser |

### `syncpush.js` (extend)

Mapper pure (frequency lokal = JSON string → array untuk server):
- `habitToCreatePayload(rec, tagNames)` → `{title: titleWithTags(rec, tagNames), phase: rec.phase||'pagi', micro_target: rec.micro_target||'', frequency: rec.frequency ? JSON.parse(rec.frequency) : [], identity_pillar: rec.identity_pillar||''}`.
- `habitToUpdatePayload(rec, tagNames)` → bentuk sama (endpoint update terima `HabitUpdate` identik).
- `checkinPayload(rec)` → `{date: rec.date, status: rec.status, skip_reason: rec.skip_reason||''}`.

Reuse `titleWithTags` (sudah ada). `tagsFor` habit: `tagrepo.getEntityTags('habit', cid).then(ts => ts.map(t => t.name))` — `opts.habitTagsFor` injectable; default ke tagrepo.

Handler op (tambah cabang di `processOp`):
- **habit/create** (`opHabitCreate`): `getHabitRaw(cid)`; `!rec`→remove op; `rec.server_id != null`→remove op (idempotent); else tags → `POST /api/habits` → 2xx: `mapPut('habit', data.id, cid)` + put `{server_id, dirty:0}` + remove op + pushed++. 403/4xx→drop+log. network→stop.
- **habit/update** (`opHabitUpdate`): `getHabitRaw(cid)` + `serverIdOf('habit', cid)`; `!rec`‖`sid==null`→remove op; else tags → `POST /api/habits/{sid}/update` → 2xx: put `{dirty:0}` + remove + pushed++. **404 → re-create**: `mapDelete('habit', sid)` → `POST /api/habits` (create payload) → 2xx: `mapPut('habit', newId, cid)` + put `{server_id:newId, dirty:0}` + remove + pushed++ (re-create network→stop; 4xx→drop). other 4xx→drop. network→stop.
- **habit/delete** (`opHabitDelete`): `serverIdOf('habit', cid)`; `sid==null`→hard-delete record lokal + remove op (tak pernah ter-create); else `DELETE /api/habits/{sid}` → 2xx/404: **hard-delete record lokal** + `mapDelete('habit', sid)` + remove op + pushed++. network→stop. (Hard-delete = purge bersih; tak biarkan tombstone menggantung — beda dgn task yang andalkan pull pass-3.)
- **habit_log/checkin** (`opHabitCheckin`): `serverIdOf('habit', rec.habit_cid)`; `sid==null`→remove op (habit terhapus); else `POST /api/habits/{sid}/checkin` body `checkinPayload(rec)` → 2xx: put log `{dirty:0}` + remove + pushed++. 4xx→drop. network→stop.

NO `base_rev` (habit tanpa `updated_at`). Urutan qid: checkin habit baru akan punya qid > create habit-nya → `serverIdOf` tersedia.

### `syncpull.js` (extend)

`pullHabits(serverHabits) → {created, updated, deleted, skipped}` — full-list reconcile:
- **Pass 1:** ensure cid tiap `h.id` via `idmap.cidOf('habit', h.id)` (mint + `mapPut` bila baru).
- **Pass 2 per `h`:** `cid=map[h.id]`, `local=getHabitRaw(cid)`:
  - `!local` → CREATE: put `habitFromServer(h, cid)` (dirty=0); created++.
  - `local.dirty` → **SKIP** (local-wins; tak ada updated_at utk LWW); skipped++.
  - `local clean & berubah` (bandingkan title/phase/micro_target/frequency/identity_pillar) → UPDATE: put `habitFromServer(h, cid)`; updated++.
  - else (clean, sama) → unchanged.
- **Pass 3 (server-delete):** tiap habit lokal `r` ber-`server_id` yang hilang dari `serverHabits`:
  - `r.dirty` → **SKIP** (local-wins; push resolusi: edit→re-create 404, tombstone→DELETE 404); skipped++.
  - else → hard-delete record lokal + `mapDelete('habit', r.server_id)`; deleted++.
- `habitFromServer(h, cid)` = `{cid, server_id:h.id, title:h.title, phase:h.phase||'pagi', micro_target:h.micro_target??'', frequency: typeof h.frequency==='string'? h.frequency : JSON.stringify(h.frequency||DEFAULT_FREQ), identity_pillar:h.identity_pillar??'', created_at:h.created_at??null, deleted:false, dirty:0}`. (Helper lokal di syncpull; konsisten dgn `habithydrate`.)

`pullHabitLogs(serverLogs) → {created, updated, skipped}` — upsert-by-(habit,date), TANPA delete:
- ensure habit cid via `idmap.cidOf('habit', l.habit_id)` (cache; skip log bila habit_id tak terpetakan & tak bisa di-mint — selalu bisa mint).
- cari log lokal via index `habit_date` = `[habit_cid, l.date]`:
  - `!local` → create `{cid:newCid(), habit_cid, date:l.date, status:l.status, skip_reason:l.skip_reason??'', dirty:0}`; created++.
  - `local.dirty` → SKIP (local-wins); skipped++.
  - `local clean & beda` (status‖skip_reason) → put `{...local, status, skip_reason, dirty:0}`; updated++.
  - else unchanged.
- Log local-only (tak ada di serverLogs) dibiarkan (dirty→push kirim; clean local-only seharusnya tak ada).

`pullHabitsAndLogs(rawFetch)`: `GET /api/habits` + `GET /api/habits/logs` (raw, token; BUKAN `api`) → `.json()` → `pullHabits` lalu `pullHabitLogs`.

### Wiring `index.html`

- `sync()` (kini pull→push) → tambah pull habits: `sync()` = `pullAndReconcile(rawFetch)` (tasks) **+ `pullHabitsAndLogs(rawFetch)`** → `pushOutbox(transport)`. `pushOutbox` otomatis kuras op habit/habit_log begitu handler ada. Tetap try/catch per-blok agar gagal satu domain tak menggagalkan lain.
- **Boot:** hapus panggilan `habithydrate.ensureHabits(...)` (blind-overwrite `dirty=0` → menimpa edit offline) — `pullHabits` dalam `sync()` menggantikan (lokal kosong = semua create). `ensureHabits` jadi unused (cleanup nanti, sama spt `hydrate.ensureTasks`).
- `__syncRawFetch` (raw fetch + token) & `__syncTransport` sudah ada — reuse.

### `sw.js`
- Bump cache `v125` → `v126`. Tak ada modul baru (extend `syncpush.js`/`syncpull.js` yang sudah di-precache).

## Data flow

```
sync()  [boot / online / manual]
  ├─ pullAndReconcile(rawFetch)        // tasks (sudah ada)
  ├─ pullHabitsAndLogs(rawFetch)
  │    GET /api/habits      → pullHabits:      create / update-clean / skip-dirty / delete-clean
  │    GET /api/habits/logs → pullHabitLogs:   upsert-by-(habit,date), skip-dirty
  └─ pushOutbox(transport)
       habit create  → POST /api/habits             → server_id + idmap, dirty=0
       habit update  → POST /api/habits/{sid}/update → dirty=0  (404 → re-create POST + remap)
       habit delete  → DELETE /api/habits/{sid}      → hard-delete lokal + mapDelete
       checkin       → POST /api/habits/{sid}/checkin → dirty=0
  network error → STOP (sisa op retry saat online berikut)
```

## Testing

- **Node** extend `tests/offline/syncpush.test.js` (`fake-indexeddb` + seed habits/habit_logs/outbox + fake transport):
  - mapper: `habitToCreatePayload` (judul+tag, frequency JSON→array), `habitToUpdatePayload`, `checkinPayload`.
  - `pushOutbox` habit: create set `server_id`+idmap+dirty=0+remove; update dirty=0; **update 404→re-create** (server_id baru, idmap remap, op terhapus); delete hard-delete+mapDelete; checkin pakai `serverIdOf(habit_cid)`, sid null→drop; idempotent create (server_id ada→skip); stop-on-network; drop-on-4xx.
- **Node** extend `tests/offline/syncpull.test.js`:
  - `pullHabits`: remote create; update clean (field beda→tertimpa); skip dirty (local-wins); unchanged; delete clean (server_id hilang→terhapus+mapDelete); skip-dirty-delete (dirty hilang dari server→dibiarkan).
  - `pullHabitLogs`: create log baru; upsert clean (status beda→tertimpa); skip dirty; unchanged.
- **Browser** (reset SW dulu di tab login): offline buat habit `#tag` → online → push → habit+tag di server (cek raw fetch/web); edit→update; checkin→log di server; buat habit di server (web/device lain) → `__syncNow()` → muncul lokal; (opsional) edit lokal + hapus di server → re-create. Notes tetap jalan (OfflineDB legacy utuh).
- **Deploy:** backend tak berubah → **tak perlu restart `taskflow-web`**. Static auto via deploy.yml. Verifikasi SW v126 via `curl https://todo.yatno.web.id/sw.js | grep CACHE`.

## Done criteria

1. `syncpush` ekspor `habitToCreatePayload`/`habitToUpdatePayload`/`checkinPayload` + handler 4 op habit/habit_log (incl. 404→re-create); `syncpull` ekspor `pullHabits`/`pullHabitLogs`/`pullHabitsAndLogs`. Node-tested.
2. Habit CRUD + checkin lokal merambat ke server; pull menarik perubahan habit/log; definisi=local-wins via re-create; log upsert-by-(habit,date) tanpa delete.
3. `sync()` tambah pull habits; `ensureHabits` boot diganti pull; SW bump v126; backend tak berubah.
4. Suite Node hijau (185 + tambahan); browser-verified end-to-end.

## Next (slice berikutnya)

- **#2f Notes** offline (scratchpad + drawings + attachments + pins) → local layer + sync. Lalu **#2g mindmap**, **#2h chat/kolaboratif** → **#3 Tauri shell** (baru muncul `.exe`/AppImage) → **#4 Android** (Tauri v2).
