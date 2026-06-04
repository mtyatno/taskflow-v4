# Offline Habits — Local Layer + Read + Checkin (#2e-1) Design

**Status:** Disetujui 2026-06-04
**Parent:** Inisiatif offline native (Model B), Kelompok 1 domain personal. Slice pertama domain **habits**. #1 + #2a–d-1 SELESAI & deployed (SW v124, 167 test). Lihat [[project_offline_native]].
**Predecessor state:** Habits saat ini online + cache `OfflineDB` legacy (`habits_today` cacheSet + queueAdd). Store `habits` + `habit_logs` SUDAH ada di db.js (v3). Mesin sync (push/pull/konflik) sudah ada untuk tasks.

## Tujuan

Membawa domain **habits** ke local-first: lihat daftar habits, **today view** (status hari ini + week_log + **streak**), monthly, dan **checkin** (toggle done/skipped) — semua jalan offline dari IndexedDB. Mengikuti pola tasks #1 (lokal dulu, **Opsi B**: tulis ke `_outbox`, BELUM push ke server; sync di #2e-2).

## Keputusan terkunci (brainstorming 2026-06-04)

1. **Dekomposisi:** #2e-1 = local layer + read + checkin (ini). #2e-2 = sync (extend push/pull untuk op habit).
2. **Sync = extend pragmatis** (di #2e-2): tambah handler op `habit`/`habit_log` ke syncpush + `pullHabits` di syncpull; tanpa refactor handler task.
3. **Streak butuh riwayat log → tambah endpoint backend kecil** `GET /api/habits/logs?since=`. Read-only, tanpa skema baru.
4. **Konflik habits (di #2e-2):** habits & habit_logs **tak punya `updated_at`** → bukan LWW timestamp; definisi habit = **local-wins**; `habit_logs` upsert by `(habit,date)` = LWW-by-sync natural.

## Non-goals (eksplisit)

- ❌ Sync/push habits ke server (Opsi B → #2e-2). Checkin offline = lokal + outbox, belum merambat.
- ❌ habit-templates offline (online dulu).
- ❌ Notes/mindmap/chat (#2f/#2g/#2h).

## Sumber kebenaran (dari `webapp.py`, kecuali endpoint baru)

- **Schema:** `habits{id,user_id,title,phase('pagi'|'siang'|'malam'),micro_target,frequency(JSON weekdays),identity_pillar,created_at}` (NO updated_at). `habit_logs{id,habit_id,date,status('done'|'skipped'|'missed'),skip_reason,created_at, UNIQUE(habit_id,date)}`.
- `GET /api/habits?tag=` → `[habit dict]` `ORDER BY phase, id`; tag filter via entity_tags (entity_type='habit').
- `POST /api/habits` (`HabitCreate{title,phase,micro_target,frequency[],identity_pillar}`): strip+derive #tags dari title; phase ∈ pagi/siang/malam.
- `POST /api/habits/{id}/update` (`HabitUpdate` sama) — re-derive tag (delete+reinsert).
- `DELETE /api/habits/{id}`.
- `GET /api/habits/{id}/tags`, `DELETE /api/habits/{id}/tags/{name}`.
- `GET /api/habits/today` → per habit: `{id,title,phase,micro_target,frequency,identity_pillar, today_status, skip_reason, streak, week_log[7]}`. `_today_jkt`=tanggal Asia/Jakarta (UTC+7). week_dates = Sen..Min minggu ini (today_dow=weekday, 0=Sen). **streak**: dari hari ini mundur — `done`→streak+1 & lanjut; `skipped`→lanjut (tak +1); lainnya→stop. week_log[i] = status pada week_dates[i] atau null.
- `GET /api/habits/monthly` → `{days:[{day,done}], avg, today_day, days_in_month}` (count `done` per hari bulan ini; avg sampai hari ini).
- `POST /api/habits/{id}/checkin` (`HabitCheckinReq{status,skip_reason,date}`): status ∈ done/skipped; date default today_jkt; **upsert** `habit_logs` ON CONFLICT(habit_id,date) set status+skip_reason.
- **BARU `GET /api/habits/logs?since=YYYY-MM-DD`** (default today_jkt-90d): `[{habit_id, date, status, skip_reason}]` milik user dgn `date >= since`. (untuk hydration riwayat.)

## Arsitektur

| Unit | Status | Tanggung jawab | Uji |
|---|---|---|---|
| `webapp.py` | **UBAH** | `GET /api/habits/logs?since=` (read-only) | manual/browser |
| `static/offline/habitlogic.js` | **BARU** | pure: `todayJkt`, `weekDates`, `deriveToday`, `monthly` | Node |
| `static/offline/habitrepo.js` | **BARU** | `createHabit`/`updateHabit`/`deleteHabit`/`checkin` + outbox + tag | Node |
| `static/offline/habitquery.js` | **BARU** | `getHabits`, `getHabitsToday`, `getHabitsMonthly` | Node |
| `static/offline/habithydrate.js` | **BARU** | pull `/api/habits` + `/api/habits/logs` → seed store | Node |
| `static/offline/habitroutes.js` | **BARU** | `registerHabitRoutes(router)` (8 route habit) | Node |
| `static/offline/taskroutes.js` | **UBAH** | `buildTaskRouter` panggil `registerHabitRoutes(router)` | Node |
| `static/index.html` | **UBAH** | load modul habit; hydrate habits di boot; pensiun OfflineDB legacy habit | Browser |
| `static/sw.js` | **UBAH** | bump + precache modul habit | Browser |

### `habitlogic.js` (pure, paritas server)
- `todayJkt(nowMs) → "YYYY-MM-DD"` — tanggal di UTC+7: `new Date(nowMs + 7*3600e3).toISOString().slice(0,10)`.
- `weekDates(todayStr) → [7 "YYYY-MM-DD"]` Sen..Min (hitung weekday lokal-agnostik via UTC math).
- `deriveToday(habit, logsByDate, todayStr) → {today_status, skip_reason, streak, week_log}` — port loop streak + week_log.
- `monthly(logs, year, month, todayDay) → {days, avg, today_day, days_in_month}`.

### `habitrepo.js`
- `createHabit(input, opts)`: `extractTags(title)`; record `{cid, server_id:null, title:clean, phase, micro_target, frequency:JSON.stringify(freq), identity_pillar, created_at, deleted:false, dirty:1}`; `_outbox` `{op:'create', entity_type:'habit', cid, payload}`; `tagrepo.setEntityTags('habit', cid, tags)`.
- `updateHabit(cid, patch, opts)`: re-derive tag bila title; update fields; outbox `update`.
- `deleteHabit(cid, opts)`: tombstone `deleted:true`; outbox `delete`.
- `checkin(habitCid, date, status, skipReason, opts)`: upsert `habit_logs` `{cid, habit_cid, date, status, skip_reason, dirty:1}` by index `[habit_cid,date]`; outbox `{op:'checkin', entity_type:'habit_log', cid, payload}`.

### `habitquery.js`
- `getHabits(query)`: load habits lokal (non-tombstone) urut phase→server_id; filter `tag` via tagrepo `cidsForTag('habit', tag)`; +`id`.
- `getHabitsToday(opts)`: load habits + habit_logs lokal; per habit `deriveToday`; urut phase; +`id`.
- `getHabitsMonthly(opts)`: dari habit_logs lokal via `habitlogic.monthly`.

### `habithydrate.js`
- `hydrateHabits(serverHabits)` + `hydrateLogs(serverLogs)` (map server_id↔cid via idmap type `habit`; logs map habit_id→habit_cid). `ensureHabits(rawFetch)`: `GET /api/habits` + `GET /api/habits/logs` → seed. Idempoten.

### `habitroutes.js` → `registerHabitRoutes(router)`
`GET /api/habits` → getHabits; `GET /api/habits/today` → getHabitsToday; `GET /api/habits/monthly` → getHabitsMonthly; `POST /api/habits` → createHabit; `POST /api/habits/:id/update` → resolve→updateHabit; `POST /api/habits/:id/checkin` → resolve→checkin; `DELETE /api/habits/:id` → resolve→deleteHabit; `GET /api/habits/:id/tags` → getEntityTags('habit'); `DELETE /api/habits/:id/tags/:name` → removeEntityTag('habit'). `id`=server_id‖cid; `resolveHabitCid` via habits store. `buildTaskRouter` memanggil `registerHabitRoutes(router)`.

### `index.html` + SW
- Load modul habit (urutan: setelah tagrepo/idmap; habitroutes sebelum taskroutes — lihat [[feedback_umd_load_order]]).
- Boot: hydrate habits (`ensureHabits`) saat online (gabung dgn sync tasks atau panggilan terpisah).
- **Pensiun OfflineDB legacy habit**: hapus cache `habits_today` + queueAdd habit (kini ter-intercept lokal). Hati-hati: jangan sentuh notes (masih OfflineDB).
- SW bump v125 + precache modul habit.

## Opsi B
Checkin/CRUD habit offline → lokal + `_outbox`, **belum push** sampai #2e-2. "Pulau" habit sementara (sama spt tasks setelah #1). Diterima.

## Testing
- Node: `habitlogic.test.js` (streak: done/skip/break; week_log; todayJkt UTC+7; monthly avg), `habitrepo.test.js`, `habitquery.test.js`, `habithydrate.test.js`, `habitroutes` (extend taskroutes test atau file baru).
- Browser: offline → daftar habits + today (streak benar pasca-hydrate dari `/api/habits/logs`) + checkin toggle; monthly; notes tetap jalan (OfflineDB legacy utuh).
- **Deploy:** endpoint backend baru → **user restart manual `taskflow-web`** di VPS sekali (deploy.yml tak restart; CI tak boleh sudo). Verifikasi `GET /api/habits/logs` balas 200 setelah restart.

## Done criteria
1. `GET /api/habits/logs` ada (read-only). `habitlogic`/`habitrepo`/`habitquery`/`habithydrate`/`habitroutes` Node-tested; routes habit ter-intercept.
2. Offline: habits list/today/monthly/checkin dari lokal; streak paritas server pasca-hydrate.
3. OfflineDB legacy habit dipensiun; notes utuh. SW bump.
4. Node suite hijau; browser-verified.

## Next
- **#2e-2 Habits sync** (extend push/pull untuk op habit; konflik local-wins). Lalu #2f notes, #2g mindmap, #2h chat → #3 Tauri.
