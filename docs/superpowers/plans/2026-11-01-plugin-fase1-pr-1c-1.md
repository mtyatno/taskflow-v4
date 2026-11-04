# Sistem Plugin Fase 1 — PR 1c-1: Timeline 1.1.0 (jadwal otomatis + CPM, batasan, SS/FF/SF, Slack, Jalur kritis, "Kenapa", Jadwalkan ulang, seksi tingkat 2–3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin `timeline` naik ke **1.1.0**: Gantt Manual 1b menjadi penjadwal ringan. Per **unit jadwal** (project pribadi, atau tiap project di dalam workspace — Q4a) ada sakelar **Jadwal otomatis** (record `project`, "Dinyalakan oleh {nama}" — Q3a) yang **selalu lewat pratinjau** (Terapkan/Batal); di project otomatis dependensi **FS/SS/FF/SF + lag** menggerakkan task lewat mesin CPM murni (`cpm.js` = `TLCpm`, forward/backward pass, SCC, slack bertanda, jalur kritis) dan rencana tulis murni (`plan.js` = `TLPlan`). Gestur di task otomatis mengalir ke penerus langsung + toast **Urungkan**, pratinjau bila > 20 task ikut bergeser (Q2a). Batasan **SNET/MFO** dan mode per task (`timeline.mode`), banner drift **"Tinjau"** (K27: mesin tidak pernah menulis sendiri), banner lingkaran, **"Kenapa dijadwalkan di sini?"**, **"Jadwalkan ulang yang belum selesai"** (K36), kolom **Slack**, sakelar **Jalur kritis**, seksi Jadwal **tingkat 2–3** (mockup `DetailRingkas.dc.html`/`Detail.dc.html`). Ditambah **jalur tulis massal lokal** di host agar Terapkan 200 task selesai lokal **≤ 2 s pada CPU 4×** (1c-0 mengukur 4,2–4,8 s; penyebabnya 200 tulis lokal berurutan, bukan render atau jaringan). Baseline dan tanggal aktual = 1c-2 (tidak di sini).

**Architecture:** Plugin murni klien (deploy statis, **tanpa restart** berkat K26 1c-0). Mesin = dua `parts` baru yang dites Node terpisah: `cpm.js` (graf, Tarjan SCC, Kahn, dua pass, slack, drift, `explain`) dan `plan.js` (diff, aliran gestur, sakelar unit, jadwalkan ulang, CAS, Urungkan, transformasi gestur K33). Aturan empat tipe dependensi hanya ada di **satu** tempat (`TLSched.depReq`/`depLimit`) dan dipakai mesin, pelanggaran Manual, dan "Geser ke setelah dependensi". UI tetap di `plugin.jsx` (satu-satunya berkas JSX): adaptor `projectStore(api)` (satu-satunya penyentuh `api.records` entitas `project`, pola `calendarStore`), hook `useEngine` (daftar task **lengkap**, mesin dijalankan **sesudah** gambar pertama, memo), dialog `PreviewDialog`/kartu `PreviewCard`, banner, kolom Slack, seksi tingkat 2–3. Satu perubahan host kecil dan aditif: `taskroutes.buildTaskRouter().extPatchMany` + `taskrepo.updateTaskExtMany` (satu transaksi IndexedDB untuk N task) dipakai `api.taskExt.setMany` bila tersedia, dengan fallback per item (kontrak `setMany` tidak berubah).

**Tech Stack:** UMD tanpa bundler, React 18.2 UMD (JSX → Babel classic oleh `compile.js`), `node --test` + React palsu/dispatcher hooks palsu (pola `tests/offline/timeline_ui.test.js`, `timeline_section.test.js`) + `fake-indexeddb` 6 (`tests/offline/setup.js`), `vm` untuk `plugin.js` hasil build (README §9), Playwright (E2E manual `temporary_files/`, tidak di CI). Tanpa dependensi baru.

**Spec:** `docs/superpowers/specs/2026-11-01-plugin-fase1-1c-otomatis-design.md` (salinan Project `claude/spec-plugin-fase1-1c-otomatis-2026-11-01.md`; **disetujui pemilik 2026-11-01 16.21 WIB, Q1–Q5 semuanya (a)**). PR 1c-1 = §3 baris 1c-1: §1 kriteria 1–7, 10–12 (bagian 1c-1); §2 K27–K39, K40 (sakelar/pratinjau/Jadwalkan ulang; baseline = 1c-2), K43, K44 (1c-1); §4 (tanpa `actual`/`baseline`); §5.1–§5.8 (tanpa fungsi 1c-2); §6.1, §6.2 (ukur drain), §6.4; §7.1–§7.5 (tanpa butir 1c-2); §7.6 (teks 1c-1); §8; §9 (bagian 1c-1); §10 baris 1c-1; §11 R4–R7, R9; plus **"Catatan implementasi PR 1c-0"** (setMany satu render, push ext saja, `setMany` 200 item lambat karena tulis lokal, K26). Juga: spec induk `docs/superpowers/specs/2026-10-31-plugin-fase1-timeline-design.md` (§2 K4–K7, K14, K15, K21; §9), rencana 1b `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1b-timeline.md` (R1–R26), rencana 1c-0 `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-0.md` (R1–R20), ADR-040..043 (`.agents/DECISIONS.md`), `docs/plugins/README.md` §5–§8, `.agents/PROTOCOL.md` §4, `CLAUDE.md`, mockup claude.ai "Mockup Timeline Alurik" (`Main.dc.html`, `DetailRingkas.dc.html`, `Detail.dc.html`). **Bukan** cakupan: record `baseline`, `timeline.actual`, bar baseline/aktual, "Mulai/Selesai aktual", tabel "Baseline vs sekarang", chip "baseline ±n" (1c-2); "Lihat di Timeline"; "Beban" (1d).

**Branch:** `claude/plugin-timeline-auto` dari `origin/main` ≥ `390e151d` (setelah #123 1c-0; SW `taskflow-v496-sinkron-ext`, `app.css?v=383`, IndexedDB v7, `index.html` 46.074 baris, `plugin-runtime.js` 1.661, `taskrepo.js` 348, `taskroutes.js` 345; Timeline 1.0.0: `plugin.jsx` 2.479, `schedule.js` 364, `layout.js` 588, `calendar.js` 250, `drag.js` 322; `tests/offline` 304 berkas). Angka tes terakhir (CURRENT_STATE 1c-0, HEAD 51054eaa): pytest **1435 passed, 1 skipped**; `npm test` **4145 tes, 1 gagal pra-ada** (`draw_local_reactive`); `tests/build-plugins.test.js` 26/26. Task 1 Step 0 menjalankan ulang dan mencatat baseline nyata.

**Keputusan pemilik (2026-11-04 16.17 WIB): P1 (a) teks whatsnew disetujui apa adanya; P2 (a) jalur tulis massal lokal masuk 1c-1 sebagai commit tersendiri dengan cadangan ke cara lama; P3 (a) sakelar dikunci "Menunggu data jadwal workspace…" sampai tarik pertama.**

## Urutan terhadap 1c-0 dan 1c-0b

| Prasyarat | Untuk | Cara memeriksa |
|---|---|---|
| **1c-0 (#123) ter-deploy + `taskflow-web` di-restart** | record `project` (K26: entitas baru diterima tanpa restart), push ext saja (K25) | CURRENT_STATE 1c-0 "Verifikasi pasca-deploy" (a) tercatat; bila belum → minta Bapak sebelum merge |
| **1c-0b ter-deploy** (server: waktu edit inti terpisah, menutup residual R2; direncanakan paralel) | **merge 1c-1 menunggu**; implementasi 1c-1 **tidak** memakai API 1c-0b | 1c-0b di `main` + deploy (dan restart bila rencananya menyebut) tercatat di CURRENT_STATE |

1c-1 dikerjakan di atas `main` 1c-0. Setelah 1c-0b di-merge: `git fetch origin main && git rebase origin/main`. Konflik yang diharapkan: berkas hasil build (`static/plugins/index.json`, blok `plugins:begin…end` `sw.js`) → `node compile.js --plugins-only`, bukan edit tangan; **`static/offline/taskrepo.js`** bila 1c-0b mengubah `updateTask` → selesaikan dengan mempertahankan fungsi bersama `applyTaskPatch` (R22) yang memuat perubahan 1c-0b, lalu tes kesetaraan T5 wajib lulus; versi SW/whatsnew → PROTOCOL §4 butir 4; nomor ADR → berikutnya setelah ADR 1c-0b.

## Peta perubahan

| File | Status | Isi (Task) |
|---|---|---|
| `static/plugins/timeline/schedule.js` | ubah (~+170) | tipe FS/SS/FF/SF, `mode`, `constraint`, `depReq`/`depLimit`, `unitOf`/`fnv1a32`, `violations`/`shiftAfterDeps` per tipe, edge membawa `type` (T1) |
| `static/plugins/timeline/cpm.js` | baru (~420) | `TLCpm.run`, `TLCpm.explain` (T2, T3) |
| `static/plugins/timeline/plan.js` | baru (~300) | `TLPlan` (T4) |
| `static/plugins/timeline/layout.js` | ubah (~+80) | `arrowPath(from, to, type)`, edge `type`, `wbsMap` (T7) |
| `static/plugins/timeline/manifest.json` | ubah | 1.1.0, `parts` + `cpm.js`, `plan.js`; `records.project`; `taskExt.keys` + `mode`, `constraint` (T6) |
| `static/plugins/timeline/plugin.jsx`, `style.css`, `plugin.js` (build) | ubah | `projectStore`, `useEngine` (T6); Slack/kritis/panah/pin (T7); toolbar, sakelar, pratinjau (T8); aliran gestur (T9); banner, Tinjau, Jadwalkan ulang (T10); seksi tingkat 1–3 (T11, T12) |
| `static/offline/taskrepo.js` | ubah (~+60) | `applyTaskPatch` (dikeluarkan dari `updateTask`, perilaku sama), `updateTaskExtMany` (T5) |
| `static/offline/taskroutes.js` | ubah (~+40) | `router.extPatchMany(items)` (T5) |
| `static/plugin-runtime.js` | ubah (~+30) | `setMany` jalur cepat + fallback (T5) |
| `static/plugins/index.json`, `static/sw.js` (blok plugins) | ditulis `compile.js` | hash/manifest baru (T6) |
| `tests/offline/timeline_cpm.test.js`, `timeline_plan.test.js`, `taskext_many.test.js` | baru | T2–T5 |
| `tests/offline/timeline_schedule.test.js`, `timeline_layout.test.js`, `timeline_ui.test.js`, `timeline_section.test.js`, `timeline_runtime.test.js`, `plugin_taskext_api.test.js`, `taskext_writers_fence.test.js`, `tests/build-plugins.test.js` | ubah (tambah kasus) | T1, T5–T13 |
| `tests/test_plugins_node.py` | ubah | `REQUIRED` + `timeline_cpm`, `timeline_plan`, `taskext_many` (T14) |
| `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION` + fallback — **string saja, 0 baris**), `static/whatsnew.json` | ubah | rilis tidak silent (T14) |
| `docs/plugins/README.md`, `.agents/DECISIONS.md` | ubah | §5 `setMany` jalur cepat, contoh record `project`, tipe dependensi; ADR-045 (atau berikutnya) (T14) |
| `temporary_files/e2e_plugin_fase1_1c1.py` | baru | E2E (T15) |
| spec 1c (catatan implementasi 1c-1), salinan rencana, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md` | ubah/baru | T16 |

**Tidak berubah:** `static/index.html` (selain string versi SW), `static/app.css` + `?v=383`, `db.js` (`DB_VERSION` 7), `syncpush.js`, `syncpull.js`, `plugin_sync.js`, `webapp.py`, `plugin_records.py`, `plugin_loader.py`, `task_ext.py`, server lain. `calendar.js`, `drag.js`, `holidays-id.js` tidak berubah kecuali disebut.

## Keputusan rencana (controller)

- **R1 — Urutan, branch, merge.** Lihat "Urutan terhadap 1c-0 dan 1c-0b". PR dibuka sebagai **draft**; "siap merge" hanya setelah rebase ke `main` yang memuat 1c-0b + verifikasi ulang T16 Step 1. Tanpa endpoint server baru (K23), tanpa modul server Timeline (K21).
- **R2 — Parts.** Urutan `["holidays-id.js", "calendar.js", "schedule.js", "cpm.js", "plan.js", "layout.js", "drag.js"]` (K44). Pola R2 1b: `const TLCpm = (function (CAL, SCHED) {…; return Object.freeze(api); })(typeof TLCal !== "undefined" ? TLCal : require("./calendar.js"), typeof TLSched !== "undefined" ? TLSched : require("./schedule.js")); if (typeof module !== "undefined" && module.exports) module.exports = TLCpm;`. `plan.js` bergantung pada `TLCal`, `TLSched`, `TLCpm`. `plugin.jsx` mengekspor `{TLHolidays, TLCal, TLSched, TLCpm, TLPlan, TLLayout, TLDrag}` + `pure`. Tanpa `Date` lokal di parts (tes regex 1b diperluas ke `cpm.js`/`plan.js`); "hari ini" selalu argumen.
- **R3 — Ext baru (K28, §4).** `TLSched.TYPES = ["FS", "SS", "FF", "SF"]`. `readSched(ext)` → `{start, duration, deps: [{key, ref, type, lag}], invalidDeps, mode: "auto"∣"manual"∣null, constraint: {type, date} | null}`; dependensi bertipe di luar `TYPES` tetap dihitung `invalidDeps` (bukan dibuang diam-diam); `constraint` rusak (tipe lain, tanggal tak sah, tahun < 1970 / > 2199) → `null` (ASAP); `mode` selain dua nilai → `null`. `sanitizePatch` menerima `mode` (`"auto"∣"manual"∣null`), `constraint` (`null` atau `{type: "SNET"∣"MFO", date: ISO sah 1970–2199}`), `deps[].type` empat nilai (bawaan `"FS"` bila tidak ada); kunci lain tetap ditolak. Memilih mode yang sama dengan unit → tulis `mode: null` (dilakukan pemanggil lewat `TLPlan.modePatch`).
- **R4 — Satu sumber rumus dependensi (§5.3, §5.4, K37).** `TLSched.depReq(c, type, pES, pEF, lag, d) → dn` = ES terkecil penerus menurut tabel §5.3 (FS `add(nw(pEF+1), L)`; SS `add(nw(pES), L)`; FF `e = add(pEF, L)` naik `nw` bila `d ≥ 1`, lalu `sff(e, d)`; SF `e = add(pw(pES−1), L)` naik `nw` bila `d ≥ 1`, lalu `sff(e, d)`). `TLSched.depLimit(c, type, sLS, sLF, lag, dP) → dn` = batas LF pendahulu menurut tabel §5.4. Pembantu `TLSched.fin(c, s, d)` dan `TLSched.sff(c, f, d)` (definisi §5.3) diekspor. `violations` (Manual) memakai `depReq` dengan `d` penerus: dilanggar bila `nw(start) < depReq` (milestone: `start < depReq`). `shiftAfterDeps` = maks `depReq`. Semua panggilan kalender lewat `safe()` (`TL_CAL_LOOP` → tidak terhitung).
- **R5 — Unit jadwal (K29, §4).** `TLSched.fnv1a32(str) → "xxxxxxxx"` (8 hex huruf kecil, atas unit kode UTF-16, offset `0x811c9dc5`, prima `0x01000193`, `Math.imul`, `>>> 0`). `TLSched.unitOf(x)` dengan `x` = task atau `{pageKind, listId, projectName}` → `{key, recId, scope, name, fold}`: workspace (`calTarget(list_id)` bukan `user`) → `recId = "prj@list:<lid>:" + (fold ? h : "-")`, `scope = "list:<lid>"`; pribadi → `"prj@user:" + (fold ? h : "-")`, `scope = "user"`; `fold = projectFold(project ?? "")`; `key = recId` (dipakai sebagai kunci `units`). **Satu-satunya** pembuat id record `project`. Id selalu cocok `^[A-Za-z0-9:@._-]{1,80}$` (`lid` divalidasi `calTarget`).
- **R6 — `projectStore(api)` (adaptor tunggal, pola `calendarStore` R5 1b).** `{loadUnits(page) → Promise<Map<recId, Unit>>, setAuto(unit, on, userId) → Promise<record>, subscribe(fn) → off}`, `Unit = {auto: boolean, by: number|null, updatedAt: string|null, pending: boolean, exists: boolean}`. Muat: halaman workspace → `api.records.list("project", {scope: "list:<lid>", limit: 1000})` (ikuti `next`); halaman project → `api.records.get("project", unitOf(page).recId)`. Data diterima hanya bila `v === 1`, `auto` boolean, `name` string ≤ 120, `by` integer∣null, dan `projectFold(name) === unit.fold` (penjaga tabrakan hash) — selain itu dianggap tidak ada (`auto: false`, `exists: false`). `setAuto` menulis `{v: 1, auto, name: <nama asli unit, dipotong 120>, by: userId}` dengan `scope` unit. `subscribe` meneruskan `onChange` entitas `project` dan peristiwa `pulled`. Tidak ada kode lain yang memanggil `api.records` untuk entitas `project` (tes sumber).
- **R7 — `useEngine(api, {scopeTasks, calData, units, pageKind})` (K31, K43).** Memuat **daftar lengkap** `api.data.tasks.list({includeDone: true})` saat pasang, saat identitas `scopeTasks` berubah (host memperbarui `allTasks` setelah `taskUpdated`), dan saat `sync.done` — debounce **300 ms**, hanya jawaban terbaru dipakai. Saringan: `scopeKeys = Set(scopeTasks.map(TLSched.scopeKeyOf))`; `tasks = list.filter(t => scopeKeys.has(scopeKeyOf(t)))`. Mesin dijalankan **sesudah gambar pertama**: `raf(() => setTimeout(run, 0))`; memo dengan kunci `engineKey` = JSON ringkas per task (`id`, `cid`, `server_id`, `parent_id`, `parent_cid`, `list_id`, `project`, `gtd_status`, `progress`, `pomodoros_done`, `completed_at`, `deadline`, `recurrence_type`, `archived`, `deleted`, ext `start/duration/deps/mode/constraint`) + `calKey` + kunci `units`. Keluaran `{status: "loading"∣"ready"∣"error", result, tasks, rawOf(task), rerun(patches) → result}`. `status !== "ready"` → Slack/kritis/banner/sakelar disembunyikan (kasus tepi §8). Hook ini **tidak pernah menulis**.
- **R8 — Simpul dan jangkar (K30, §5.1).** Dibuang: `recurrence_type` truthy, `gtd_status === "archived"`, `deleted`, `archived`. Ringkasan (punya anak hidup di daftar lengkap, `parent_id`/`parent_cid`) bukan simpul. Simpul = non-ringkasan dengan Mulai, atau (mode efektif otomatis ∧ punya pendahulu terjadwal terpecahkan). Mode efektif = `ext.mode ?? (units.get(unitOf(t).recId)?.auto ? "auto" : "manual")`. Jangkar `fixed`: `"manual"` (tersimpan), `"done"` (`es = start`, `ef = jkt(completed_at) ?? fin(es, d)`, `ef < es → es`), `"started"` (`progress > 0 ∨ pomodoros_done > 0`; `es = start`, `ef = fin(es, d)`), `"cycle"`, `"mfo"` (`ef = d ≥ 1 ? pw(date) : date`, `es = sff(ef, d)`). `jkt(iso) = floor((Date.parse(iso) + 7·3600e3) / 864e5)` (bukan `Date` lokal). Durasi hilang = 1 + `durGuess: true`. (`actual` = 1c-2; kode membaca `ext.actual` **tidak** di 1c-1.)
- **R9 — Graf deterministik (§5.2).** Kunci simpul = `String(id)`; simpul diurut `localeCompare` kunci sebelum Tarjan (iteratif, tanpa rekursi — 1.000+ simpul aman), daftar tetangga diurut. Sisi diabaikan dengan `reason` `"unresolved"∣"scope"∣"summary"∣"notNode"`. Komponen > 1 atau sisi-diri = lingkaran: anggotanya `fixed: "cycle"`, sisi di dalamnya diabaikan (`"cycle"`), sisi keluar dipakai. Kahn atas sisa graf dengan antrean terurut kunci. ES = maksimum (tidak bergantung urutan); `driver` seri → urutan `deps` tersimpan, lalu SNET, lalu jangkar akar.
- **R10 — Backward pass dan kelompok (§5.4).** Kelompok `g` = `unitOf(task).recId` (workspace: per project; pribadi: per project). `groupEnd.get(g) = P_g` = maks EF simpul kelompok. Batas awal `LF = P_g`, dijepit tenggat (`d ≥ 1 → pw(dl)`, milestone `dl`; tenggat dibaca 10 karakter, rusak diabaikan) dan MFO (`≤ ef`). `slack = LF ≥ EF ? workdays(EF+1, LF) : −workdays(LF+1, EF)`, rentang dijepit 3.660 hari. `critical = slack ≤ 0 ∧ fixed !== "done"`. Simpul selesai: `slack = null` (tampil "—").
- **R11 — Bentuk tulis (§5.7, K33, K36).** Item rencana `{task, key, before: {start, duration, constraint, mode}, patch, deltaHk, kind: "move"∣"new"∣"duration"∣"mode"∣"constraint"}`; `before` memuat **nilai mentah ext** (kunci tak ada → `null`) agar Urungkan persis. `patch` hanya kunci yang berubah. Urutan item = topologis. `diff` hanya menulis simpul otomatis non-jangkar yang `iso(es) !== start` atau tanpa Mulai (`"new"`, `duration` 1 bila hilang).
- **R12 — Gestur pada task otomatis (K33) murni.** `TLPlan.gesture(result, task, raw, patch, c)`: bila task bukan otomatis non-jangkar → `{ok: true, patch}` (perilaku 1b). Bila `patch.start` ada: syarat pendahulu `req` = maks `depReq` atas pendahulu terpecahkan; `start < req` → `{ok: false, reason: "early", es: req}` (view mengembalikan bar ke ES + toast "Tidak bisa lebih awal dari dependensinya"); berpendahulu atau ber-SNET → `patch + {constraint: {type: "SNET", date: patch.start}}`; akar tanpa SNET → `patch` apa adanya. Perubahan `duration`/`deps`/`mode`/`constraint` → apa adanya (aliran K32).
- **R13 — Jalur tulis view (K32, Q2a).** `issueMany(items)` di `createInteractions`: semua kunci ke `X.busy` dan `X.after` seketika, **satu** `api.taskExt.setMany(items.map(({task, patch}) => ({taskId: task.id, patch})))`. Aliran: `TLPlan.cascade(ctx, [{task, patch}])` → `{items, gestureCount, over}`; `over` (turunan berubah > 20) → `PreviewDialog`; turunan 0 → `set` 1b + toast 1b "Jadwal diubah"; selain itu `setMany` + toast "Jadwal diubah · {n} task ikut bergeser" + Urungkan. Urungkan = `setMany(TLPlan.undoItems(applied))`. Gagal sebagian → "Sebagian jadwal gagal disimpan ({k} dari {n})" + Urungkan hanya `err.applied`. Gestur dengan `useEngine` belum siap/gagal: task yang (dari `ext.mode`/`units` lokal) otomatis → tanpa tulis + toast "Jadwal gagal disimpan"; selain itu perilaku 1b.
- **R14 — Pratinjau (K34, §7.2).** `PreviewDialog` (`role="dialog"`, `aria-modal`, fokus terjebak, Esc = Batal, pola `CalendarPopover`) dan `PreviewCard` (seksi: 5 baris pertama + "dan {n} lainnya"). Model murni `TLPlan.preview(items, result, ctx, before) → {rows, moved, endBefore, endAfter, endDelta, late, notMoved: [{key, why: "anchor"∣"cycle"∣"mfo"}], brokenDeps}`. Baris "WBS · Task · Mulai lama → baru · Δ hk" (+ "baru dijadwalkan", "durasi berubah"); ringkasan "{n} task bergeser · Selesai project {lama} → {baru} ({±k} hk) · {m} lewat tenggat"; bagian "Tidak dipindah"; tiap baris bisa dibuka → teks "Kenapa". ≤ 50 baris + tombol "Tampilkan semua". Offline (`api.env.online === false`) → "Kamu sedang offline — jadwal dihitung dari data di perangkat ini". Jadwalkan ulang → baris "Hari ini: {tanggal}". **Terapkan**: muat ulang daftar lengkap (+ unit dari `projectStore` untuk pratinjau sakelar) → `TLPlan.revalidate(items, rawNow)` dan, untuk sakelar, `updatedAt` record unit sama dengan potret; berbeda → toast "Data berubah sejak pratinjau dibuka — hitung ulang" dan dialog **menghitung ulang** daftarnya (Terapkan perlu ditekan lagi); sama → `setMany` → toast "Jadwal diterapkan · {n} task" + Urungkan. Terapkan nonaktif bila 0 item.
- **R15 — Sakelar unit (K40, Q3a, Q4a, §7.1).** Halaman project: tombol sakelar "Jadwal otomatis" (`role="switch"`, `aria-checked`). Halaman workspace: tombol "Jadwal otomatis" membuka popover daftar kelompok project halaman (dari `lay.groups`; "(Tanpa project)" = unit `-`) dengan sakelar masing-masing dan keterangan "Dinyalakan oleh {nama} · {fmtShort(updated_at Jakarta)}" bila `auto`. Nama: `by === api.env.userId` → `currentUser.display_name || username`; selain itu `context.collaborators` (`display_name || username`); tak ditemukan → "Dinyalakan oleh anggota lain". ON: `TLPlan.toggleUnit(…, true)` → 0 item → `setAuto` + toast "Jadwal otomatis menyala — tidak ada task yang bergeser"; ada item → pratinjau "Nyalakan jadwal otomatis — {project}" → Terapkan: `setMany` dulu, lalu `setAuto` (setMany gagal → `setAuto` tidak dipanggil). OFF: `setAuto(false)` + toast "Jadwal otomatis dimatikan — tanggal tetap seperti sekarang" (tanpa tulis task). Lihat juga keputusan pemilik **P3**.
- **R16 — Banner drift dan lingkaran (K35, §7.3).** Satu baris `.plg-timeline-banner` di atas grafik (di luar header sticky). Drift: `n` = simpul `result.drift` yang ada di `scopeTasks` halaman → "Jadwal otomatis belum mutakhir: {n} task berbeda dari hasil hitung." + tombol "Tinjau" (pratinjau "Tinjau jadwal otomatis", item = `TLPlan.diff` dibatasi drift halaman). Lingkaran: "Dependensi melingkar: {judul}, {judul} — tidak dihitung" (≤ 3 judul + "dan {n} lainnya") + tombol "Buka" (→ `context.onTaskClick(task pertama)`). Tutup (`aria-label` "Tutup") per sesi: `Set` tingkat modul berkunci `page + jenis + n`. Tidak tampil sebelum `useEngine` siap.
- **R17 — Jadwalkan ulang (K36).** Tombol toolbar "Jadwalkan ulang" → `TLPlan.reschedule(ctx, result, T, unitKeys)`, `T = nextWork(dn(api.env.today()))`, `unitKeys` = unit halaman; selalu pratinjau "Jadwalkan ulang yang belum selesai" (juga bila 0 item: Terapkan nonaktif). Unit otomatis: penerus mengalir tanpa ambang; unit Manual: penerus tidak dipindah, pratinjau menyebut "{n} dependensi akan dilanggar" (dihitung dengan `violations` atas data + patch).
- **R18 — Slack dan Jalur kritis (K38).** `COLS_FULL` + `{id: "slack", label: "Slack", w: 56}` setelah "%"; `COLS_COMPACT` tidak (masuk "Kolom"). Teks: `0` → "0", `n > 0` → "{n} hk", `n < 0` → "−{n} hk" (minus U+2212), selesai/tak terhitung/simpul bukan → "—"; ringkasan = min slack anak. Sakelar "Jalur kritis" (`aria-pressed`) pref per perangkat `crit:<page>` (bawaan `false`, `cleanPref` boolean) → bar `is-critical` (garis tepi 2 px `var(--plg-timeline-danger)`, bukan isi), panah antara dua simpul kritis `is-critical` (tebal 2 px); legenda + "Jalur kritis". CPM juga dijalankan untuk unit Manual (semua jangkar).
- **R19 — Panah per tipe dan pin Manual (§7.4).** `TLLayout.arrowPath(fromRect, toRect, type = "FS")`: FS ujung→awal (perilaku 1b, path identik untuk tipe FS), SS awal→awal (keluar 6 px ke **kiri** dari awal pendahulu, masuk dari kiri ke awal penerus), FF ujung→ujung (keluar kanan, masuk dari kanan ke ujung penerus), SF awal→ujung (keluar kiri, masuk dari kanan); hanya H/V. Konflik jangkar (`conflict`) ditandai seperti pelanggaran 1b (merah putus-putus). Task `fixed: "manual"` di unit otomatis → ikon pin 10 px di sel Nama, `aria-label` "Manual".
- **R20 — Seksi Jadwal (K39, §7.5).** Mode efektif manual → **tingkat 1** 1b tidak berubah + di "Selengkapnya": kontrol **Mode** (`Manual | Otomatis`, nilai bawaan unit diberi keterangan "sama dengan project") dan, bila punya penerus otomatis berubah, "Mengubah task ini menggeser {n} task otomatis". Mode efektif otomatis → **tingkat 2** terlipat: kepala "Jadwal" + chip "Otomatis" + chip "lewat tenggat {n} hk" (bila `late > 0`); "{fmtShort(s)} → {fmtShort(f)} · {d} hari kerja"; "menunggu {WBS} (+{lag} hk) · diikuti {WBS} · slack {teks R18}" (maks 2 pendahulu/penerus + "…"); chip "Di jalur kritis"; drift → "Belum mutakhir — hasil hitung {fmtShort(es)}." + tombol "Perbarui" (aliran K32 dari task itu, patch `{start: iso(es)}` tanpa SNET). "Selengkapnya" membuka **tingkat 3**: Mode · Mulai (otomatis: teks + "Ubah" → input tanggal → R12) · Durasi · Selesai · Milestone · % selesai (baca saja) · **Batasan** (`Secepatnya (ASAP)` / `Mulai tidak lebih awal dari` + tanggal / `Harus selesai pada` + tanggal) · **Dependensi**: "Menunggu" (pendahulu, pilihan tipe empat label + lag hk + hapus) dan "Diikuti oleh" (penerus dari daftar lengkap, baca saja) · "Tambah dependensi" · "Kenapa dijadwalkan di sini?" (terlipat) · tombol "Ubah ke Manual". WBS seksi = `TLLayout.wbsMap(daftar lengkap scope, pageKind)` (tanpa filter panel; fallback judul ≤ 24 karakter). Aliran dari seksi: ≤ 20 turunan → langsung + toast; > 20 → `PreviewCard`.
- **R21 — Teks "Kenapa" (§5.6).** `TLCpm.explain` = struktur; teks disusun `whyText(ex, ctx) → Array<string | {b: string}>` di `plugin.jsx` (`pure`, dites). Varian persis: pred — "Mulai **{tgl}** karena menunggu **{WBS} {judul}** selesai {tglP}[, ditambah lag {L} hari]( ({daftar} dilewati))." (SS/FF/SF: "mulai {tglP}" / "selesai {tglP}" sesuai tipe); durasi — "Durasi {d} hari kerja melompati {daftar}, jadi selesai **{tglF}**"; tenggat — ", {k} hari kerja setelah tenggat {tglDl}." atau "."; root — "Mulai di tanggal yang kamu tentukan."; snet — "…karena batasan: mulai tidak lebih awal dari {tgl}."; mfo — "Harus selesai pada {tgl} (batasan)."; manual — "Task ini Manual: tanggal mengikuti yang kamu isi."; done — "Task ini sudah selesai: tanggalnya tidak dihitung ulang."; started — "Task ini sudah mulai: tanggal mulainya dikunci."; cycle — "Dependensinya melingkar dengan {judul}; tidak dihitung."; unscheduled — "Belum dijadwalkan." Daftar hari dilewati: "Sab–Min" untuk akhir pekan berurutan, nama libur bila ada, maks 6 lalu "dan {n} hari lain". Contoh mockup wajib persis: "Mulai Kam 5 Nov karena menunggu 1.2 Palet Sakura + Lavender selesai Sel 3 Nov, ditambah lag 1 hari (Rab 4 Nov dilewati). Durasi 4 hari kerja melompati Sab–Min, jadi selesai Sel 10 Nov, 1 hari kerja setelah tenggat Sen 9 Nov."
- **R22 — Jalur tulis massal lokal (catatan 1c-0; kriteria 7).** Penyebab 4,2–4,8 s: per item `taskroutes.resolveCid` = `getAll` store `tasks` (O(N) per item → O(N·M)), `getRaw` + `mutate` + `outboxAdd` (3 transaksi) + `withTaskRow` (baca `pomolog`). Perubahan: (a) `taskrepo.applyTaskPatch(base, patch, ctx) → next` = isi `applyTo` `updateTask` dipindah ke tingkat modul **tanpa perubahan perilaku** (`ctx = {now, today, cleanTitle, projectItems, contextItems, pc, cc, needLookup, needCtxLookup}`); `updateTask` memanggilnya. (b) `taskrepo.updateTaskExtMany(items: [{cid, ext_patch}], opts) → Promise<{recs, applied: string[], error: Error|null}>`: validasi `checkPatch` setiap item **sebelum** transaksi (gagal → reject tanpa tulis, tanpa `applied`); **satu** transaksi `readwrite` atas `["tasks", "_outbox"]`: berurutan per item `get` → hilang/terhapus → berhenti (`error = Error("Task not found")`), selain itu `applyTaskPatch(cur, {ext_patch}, ctx)` (`sizeError` → berhenti) → `put` → `_outbox.add({ts, retries: 0, op: "update", entity_type: "task", cid, payload: next})` (bentuk sama dengan `outboxAdd`); item sebelum titik berhenti tetap ter-commit. (c) `buildTaskRouter()` mengembalikan router dengan metode tambahan `extPatchMany(items: [{id, ext_patch}]) → Promise<{rows, appliedIds, error}>`: satu `getAll` untuk memetakan id → cid (urutan `resolveCid`: cid, server_id, client_id), id tak dikenal = titik berhenti `Task not found`, lalu `updateTaskExtMany`, lalu `withTaskRows(recs)` sekali. (d) Runtime `setMany`: bila `typeof localTaskRouter().extPatchMany === "function"` → `patchAll` (sama) → satu `extPatchMany` → `root.dispatchEvent(new CustomEvent("tf:outbox-queued"))` (host menjadwalkan push, `index.html:1005`, **0 baris**) → `refresh()` + `announce` sekali → resolve `rows`; `error` → reject `withApplied(mapExtError(error), appliedIds)`. Tanpa metode (modul lama dari cache SW) → jalur per item 1c-0 apa adanya. `set` tunggal tidak berubah. Kontrak README §5 `setMany` tidak berubah. `taskext_writers_fence` AUDIT + entri `updateTaskExtMany` (`cat: "rev+1"`, penanda via `extOnlyNext`) dan `P_OP` + 1.
- **R23 — Toolbar dan HP (§7.1).** Urutan: zoom · Hari ini · **Jadwal otomatis** · **Jalur kritis** · **Jadwalkan ulang** · Kalender kerja · Urutkan · Kolom · (Gantt|Daftar di HP). Kanan toolbar: "Selesai {fmtShort(P)}" (maks `groupEnd` unit halaman) + chip "{n} lewat tenggat" bila ada. ≤ 640 px atau `context.liveEdit`: Jadwal otomatis, Jalur kritis, Jadwalkan ulang masuk menu "Lainnya" (`aria-haspopup="menu"`). Mode Daftar (HP): tombol baru tetap di "Lainnya" (pratinjau berlaku), Slack/kritis tidak tampil di Daftar.
- **R24 — Kinerja (K43, kriteria 10).** `TLCpm.run` 500 simpul/400 sisi: median 5 putaran Node dicatat, asersi CI ≤ 150 ms; render awal view tidak menunggu mesin (tes: render pertama tanpa nilai Slack, setelah `raf`+`setTimeout` palsu dijalankan → ada); DOM ≤ 1.500 elemen dengan Slack + Jalur kritis + banner (tes T13 + E2E); pratinjau ≤ 50 baris tampil. Bila E2E mesin > 40 ms CPU 4× → indeks prefiks hari kerja (optimasi internal `TLCal`, tanpa perubahan API) sebagai commit terpisah.
- **R25 — Nol tulisan latar (K27, kriteria 1).** Panggilan `api.taskExt.set`, `api.taskExt.setMany`, dan `api.records.put` di `plugin.jsx` hanya boleh muncul di fungsi daftar-izin: `issue`, `issueMany` (view), `write`/`writeMany` (seksi), `projectStore.setAuto`, `calendarStore.save` (tes sumber regex atas `plugin.js` build: setiap kemunculan berada di dalam badan fungsi bernama tersebut). Tes perilaku: spy = 0 panggilan pada mount view/seksi, `sync.done`, `pulled`, `onChange` (project/calendar), `app.dayChanged`, perubahan kalender, perubahan `scopeTasks`, mesin selesai dengan drift > 0.
- **R26 — Rilis.** SW = nomor berikutnya setelah 1c-0b (perkiraan `taskflow-v498-jadwal-otomatis`; PROTOCOL §4 butir 4 bila bentrok); whatsnew **tidak silent** (teks **P1**); `app.css?v=383` tetap; IndexedDB v7; `index.html` +0 baris; tanpa restart (K26 + tidak ada perubahan server); ADR-045 (atau berikutnya setelah ADR 1c-0b).
- **R27 — Kompatibilitas dan rollback (kriteria 11, §10).** Klien 1.0 mengabaikan `mode`/`constraint` dan record `project`; dependensi SS/FF/SF tampil "dependensi rusak atau tidak dikenali versi ini" dan hanya terhapus bila tombol "Hapus dependensi rusak" ditekan (R4 spec) — disebut di catatan rilis rollback. Data 1b tidak berubah sampai pengguna bertindak (tidak ada migrasi). Rollback = matikan plugin, atau revert sebagai rilis baru (SW bump + whatsnew `silent`; kunci/record dibiarkan); revert juga mengembalikan `setMany` ke jalur per item (fallback, tanpa data hilang).
- **R28 — Teks tambahan di luar §7.6** (diterima controller, diperiksa tes): "Tampilkan semua", "dan {n} lainnya", "Hari ini: {tanggal}", "Lainnya", "Buka", "Ubah", "Selesai {tanggal}", "Mengubah task ini menggeser {n} task otomatis", "Dinyalakan oleh anggota lain", "Jadwal diterapkan · {n} task", varian "Kenapa" R21. Bila **P3 (a)**: "Menunggu data jadwal workspace…".

## Global Constraints

- `static/index.html` **+0 baris** (hanya string `__SW_VERSION` + fallback); `app.css?v=383` tetap; IndexedDB v7; tanpa perubahan server/skema; perubahan `static/offline/` **hanya** `taskrepo.js` dan `taskroutes.js` (R22); `plugin-runtime.js` hanya `setMany` (R22); `apiVersion` tetap 1.
- Plugin: `version` `1.1.0`, `defaultEnabled: false`, `minApi: 1`, slot dan `permissions` tidak berubah, `records` = `{calendar: {conflict: "lww", maxBytes: 16384}, project: {conflict: "lww", maxBytes: 1024}}`, `taskExt.keys` = `["start", "duration", "deps", "mode", "constraint"]`, `parts` R2. Lint `compile.js` lulus.
- Kunci ext persis: `timeline.mode` `"auto"∣"manual"` (tidak ada = ikut project), `timeline.constraint` `{type: "SNET"∣"MFO", date: "YYYY-MM-DD"}` (tidak ada = ASAP), `timeline.deps[].type` `"FS"∣"SS"∣"FF"∣"SF"`, lag −99..999, ≤ 20 dependensi. Record `project`: id `prj@user:<h>` ∣ `prj@list:<lid>:<h>` ∣ `prj@list:<lid>:-`, data `{v: 1, auto, name, by}`, tanpa `start`.
- **Mesin tidak pernah menulis** (K27, R25); setiap tulisan berasal dari gestur, Terapkan, atau aksi eksplisit di perangkat ini.
- Teks UI persis (§7.6, bagian 1c-1): "Jadwal otomatis", "Otomatis", "Manual", "sama dengan project", "Nyalakan jadwal otomatis — {project}", "Tinjau jadwal otomatis", "Terapkan", "Batal", "{n} task bergeser", "baru dijadwalkan", "durasi berubah", "Tidak dipindah", "Selesai project {lama} → {baru}", "{n} lewat tenggat", "Jadwal diterapkan", "Jadwal diubah · {n} task ikut bergeser", "Sebagian jadwal gagal disimpan ({k} dari {n})", "Data berubah sejak pratinjau dibuka — hitung ulang", "Kamu sedang offline — jadwal dihitung dari data di perangkat ini", "Jadwal otomatis menyala — tidak ada task yang bergeser", "Jadwal otomatis dimatikan — tanggal tetap seperti sekarang", "Jadwal otomatis belum mutakhir: {n} task berbeda dari hasil hitung.", "Tinjau", "Belum mutakhir — hasil hitung {tanggal}.", "Perbarui", "Dependensi melingkar", "Tidak bisa lebih awal dari dependensinya", "Dinyalakan oleh {nama}", "Jalur kritis", "Di jalur kritis", "Slack", "Batasan", "Secepatnya (ASAP)", "Mulai tidak lebih awal dari", "Harus selesai pada", "Menunggu", "Diikuti oleh", "Selesai → Mulai (FS)", "Mulai → Mulai (SS)", "Selesai → Selesai (FF)", "Mulai → Selesai (SF)", "Kenapa dijadwalkan di sini?", "Ubah ke Manual", "Jadwalkan ulang", "Jadwalkan ulang yang belum selesai", "{n} dependensi akan dilanggar", "durasi belum diisi, dianggap 1 hari kerja"; tambahan R28. Teks 1b tetap.
- CSS hanya `.plg-timeline-*` + pengubah `.is-*`, token tema saja (tanpa hex/rgb/hsl); merah = `var(--plg-timeline-danger)`.
- Setelah setiap task: `npm test` (hanya gagal pra-ada `draw_local_reactive`), `node compile.js --plugins-only` dua kali tanpa diff; mulai T6 juga `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`; T5 juga `python3 -m pytest tests/ -q -k "sync or task"`.
- Commit `feat(timeline)`, `feat(offline)` (T5 host, commit tersendiri agar bisa di-revert terpisah), `feat(plugin)` (runtime), `test(timeline)`, `docs(plugin)`, `chore(release)`; atribusi sesi.

## Review Focus

1. **Tulisan latar tersembunyi** — efek yang "merapikan" (mis. menyimpan ulang record `project` yang dinormalisasi saat dimuat, "Perbarui" yang terpicu saat seksi dipasang ulang, pratinjau yang diterapkan otomatis saat 0 item). Diharapkan: 0 panggilan tulis tanpa klik/ketik pengguna. Tes: T6 Step 1 (spy 0 + regex daftar-izin R25), T11/T12 (seksi dipasang ulang dengan drift).
2. **Rumus FF/SF di tepi** — milestone sebagai pendahulu/penerus SF/FF, lag negatif melewati libur, SNET di hari libur, MFO yang bertabrakan dengan pendahulu, durasi 0 di hari libur. Diharapkan: identitas `ES = LS` untuk rantai, MFO menang + `conflict`. Tes: T1 vektor `depReq`/`depLimit`, T2 identitas + konflik.
3. **Tulis massal tidak setara dengan tulis tunggal** — record hasil `updateTaskExtMany` berbeda dari `updateTask` (penanda `ext_only_rev`, `ext_dirty`, `rev`, `quadrant`, `updated_at`), task terhapus sinkron di tengah batch, modul `taskroutes` lama tanpa `extPatchMany`. Diharapkan: record identik, berhenti di item gagal dengan `applied` tepat, fallback per item. Tes: T5 kesetaraan + gagal di tengah + fallback; T13 lewat runtime nyata.
4. **Aliran menyelundupkan drift** — task otomatis lain yang sudah drift tetapi bukan turunan gestur, jangkar (selesai/sudah mulai/Manual), atau task di unit lain yang hanya bertetangga lewat dependensi diabaikan. Diharapkan: hanya patch gestur ∪ turunan yang berubah; Urungkan mengembalikan `constraint`/`mode` yang dulu tidak ada sebagai `null`. Tes: T4 cascade + undo, T9 view.
5. **Pratinjau basi dan dua anggota** — sinkron menimpa `start` saat dialog terbuka; anggota lain mematikan Otomatis saat pratinjau ON terbuka; nama project berganti (unit kembali Manual). Diharapkan: CAS menolak + hitung ulang; tidak ada tulisan dari data lama; unit hilang = Manual tanpa tulis. Tes: T4 `revalidate`, T8 dialog dengan data berubah, T13 dua `fakeRecords`/runtime.

---

### Task 1: `schedule.js` — tipe dependensi, mode, batasan, unit jadwal, rumus bersama

**Files:**
- Modify: `static/plugins/timeline/schedule.js`, `tests/offline/timeline_schedule.test.js`

**Interfaces (Produces, tambahan `TLSched`):** `TYPES`; `CONSTRAINT_TYPES = ["SNET", "MFO"]`; `readSched(ext)` (R3); `sanitizePatch(p)` (R3); `fin(c, s, d)`, `sff(c, f, d)`; `depReq(c, type, pES, pEF, lag, d) → dn|undefined`; `depLimit(c, type, sLS, sLF, lag, dP) → dn|undefined` (R4); `resolveDeps(rows, index)` → edge `{from, to, type, lag, ok}`; `violations(c, spans, edges)` per tipe (detail `{succ, pred, earliest, type}`); `shiftAfterDeps(c, succ, preds)` dengan `preds[i] = {span, lag, type}`; `fnv1a32(str)`; `unitOf(x) → {key, recId, scope, name, fold}` (R5); `modeOf(raw, units, task) → "auto"∣"manual"`.

- [ ] **Step 0: Baseline.** `git fetch origin main && git checkout -b claude/plugin-timeline-auto origin/main`; catat `python3 -m pytest tests/ -q`, `npm test`, `node --test tests/build-plugins.test.js` (angka + versi Python/Node) untuk handover.
- [ ] **Step 1: Tulis tes gagal** (tambah ke `timeline_schedule.test.js`):
  - `"readSched: deps SS/FF/SF dibaca dengan type; type 'XX' → invalidDeps; mode 'auto'/'manual'/lain→null; constraint {SNET,'2026-11-05'} ok, {ALAP,…}/tanggal 1969-12-31/2200-01-01 → null"`.
  - `"sanitizePatch: {mode: null} ok; {mode: 'x'} gagal; {constraint: {type: 'MFO', date: '2026-02-30'}} gagal; {constraint: null} ok; deps tanpa type → 'FS'; type 'SF' dipertahankan; kunci 'actual' ditolak (1c-2)"`.
  - `"depReq (kalender bawaan 2026, Sen–Jum + libur): FS lag 0/1/−1, SS lag 0/2, FF dan SF dengan d = 0 dan d = 4; pendahulu selesai Jumat; lag melewati Idulfitri 2026"` — nilai harapan ditulis sebagai ISO tetap (dihitung tangan, dicantumkan di tes).
  - `"depLimit: kebalikan depReq — untuk setiap tipe × lag −2..3 × d ∈ {0,1,4}: depLimit(c, t, depReq(...)…) memberi LF pendahulu = EF pendahulu (identitas rantai dua simpul)"`.
  - `"violations: SS — penerus mulai sebelum pendahulu mulai → ditandai; FF — penerus selesai sebelum pendahulu selesai → ditandai; tepat batas → tidak"`; `"shiftAfterDeps maks atas FS dan SS campuran"`.
  - `"fnv1a32: '' → '811c9dc5'; 'a' → 'e40c292c'; 'proyek alpha' stabil"`; `"unitOf: task workspace list_id 12 project 'Rilis' → prj@list:12:<fnv('rilis')>; project kosong → prj@list:12:-; pribadi → prj@user:<h>; 'Rilis ' ≠ 'Rilis'; semua id cocok pola README"`.
  - `"modeOf: ext.mode menang; tanpa ext.mode → units.get(recId).auto"`.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/timeline_schedule.test.js`.
- [ ] **Step 3: Implementasi** (R3–R5). `canLink`/1b tetap lulus (dup = pasangan apa pun tipe).
- [ ] **Step 4: Jalankan → PASS** + `node --test tests/offline/timeline_layout.test.js tests/offline/timeline_ui.test.js tests/offline/timeline_section.test.js` (regresi 1b).
- [ ] **Step 5: Commit** `feat(timeline): dependensi FS/SS/FF/SF, mode, batasan, unit jadwal`

### Task 2: `cpm.js` — `TLCpm.run` (SCC, forward/backward pass, slack, kritis, drift)

**Files:**
- Create: `static/plugins/timeline/cpm.js`, `tests/offline/timeline_cpm.test.js`

**Interfaces (Produces `TLCpm`):** `run({tasks, cal, units, readExt}) → Result` dengan `readExt(task) → raw ext tanpa prefiks` (di view = `api.taskExt.read`), `cal` = hasil `TLCal.compile`, `units: Map<recId, {auto}>`; `Result = {nodes: Map<key, Node>, order: string[] (topologis), succ: Map<key, string[]>, pred: Map<key, Array<{key, type, lag}>>, cycles: string[][], ignored: Array<{from, to, reason}>, groupEnd: Map<g, dn>, drift: Set<key>, summaries: Map<key, string[]>}`; `Node = {key, task, es, ef, ls, lf, slack, critical, mode, fixed?, driver: {kind: "pred"∣"snet"∣"root"∣"fixed", from?, type?, lag?} , conflict?, durGuess?, d, g, late}` (`late` = `TLSched.deadlineLate(ef)`); `uncomputable: Set<key>` untuk `TL_CAL_LOOP`.

- [ ] **Step 1: Tulis tes gagal** `timeline_cpm.test.js` (tanggal tetap, tanpa "hari ini"; pembangun data `mk({id, start, d, deps, mode, constraint, done, progress, deadline, project, list_id, parent})`):
  - `"FS/SS/FF/SF × lag −2..3 × penerus milestone/biasa: ES/EF penerus otomatis = depReq; ES = nw(ES) untuk d ≥ 1, milestone tidak dijepret"`.
  - `"identitas: rantai 6 simpul tanpa cabang/tenggat, setiap tipe → ES = LS dan slack 0 di semua simpul"`.
  - `"akar otomatis: ES = Mulai tersimpannya sendiri (bukan ditarik ke awal project); akar dengan SNET lebih lambat → SNET"`; `"task tanpa Mulai dan tanpa pendahulu → bukan simpul"`; `"tanpa Mulai, berpendahulu, otomatis → simpul, durGuess bila durasi hilang"`.
  - `"jangkar: manual, selesai (ef dari completed_at '2026-11-05T17:30:00Z' → 2026-11-06 Jakarta), sudah mulai (progress 10 / pomodoros_done 1), MFO; pendahulu memaksa lebih lambat → conflict true, nilai tetap"`.
  - `"backward: LF = maks EF kelompok project (dua project di workspace tidak saling memberi slack); tenggat sebelum EF → slack negatif (−1); kritis = slack ≤ 0 ∧ tidak selesai; selesai → slack null"`.
  - `"SCC: 2-lingkaran, sisi diri, lingkaran dengan hilir → anggota fixed 'cycle', hilir tetap dihitung dari nilai tersimpan; cycles berisi kunci terurut; tidak menggantung"`.
  - `"diabaikan dengan alasan: ref hilang (unresolved), lintas scope (scope), ke/dari ringkasan (summary), ujung bukan simpul (notNode)"`; `"berulang/archived/deleted dibuang"`.
  - `"drift: otomatis non-jangkar dengan iso(es) ≠ start tersimpan → di drift; jangkar tidak pernah"`; `"unit Manual → semua jangkar, slack tetap dihitung"`.
  - `"kalender buntu (weekdays [1], semua Senin libur) → simpul uncomputable, run tidak melempar"`.
  - `"determinisme: 50 permutasi acak (benih tetap, LCG di tes) dari 120 task/150 dep → JSON hasil terurut identik"`.
  - `"kinerja: 500 simpul / 400 sisi (generator tetap) → median 5 putaran dicatat console.log, asersi ≤ 150 ms"` (R24).
- [ ] **Step 2: Jalankan → FAIL**.
- [ ] **Step 3: Implementasi** (R8–R10; Tarjan iteratif, Kahn terurut, dua pass memakai `depReq`/`depLimit`).
- [ ] **Step 4: Jalankan → PASS**; regex "tanpa Date lokal" (tes 1b `timeline_calendar.test.js`) diperluas ke `cpm.js`, `plan.js`.
- [ ] **Step 5: Commit** `feat(timeline): mesin CPM — SCC, forward/backward pass, slack, jalur kritis, drift`

### Task 3: `TLCpm.explain` — struktur "Kenapa dijadwalkan di sini?"

**Files:**
- Modify: `static/plugins/timeline/cpm.js`, `tests/offline/timeline_cpm.test.js`

**Interfaces (Produces):** `explain(result, key, cal) → {kind: "pred"∣"root"∣"snet"∣"mfo"∣"manual"∣"done"∣"started"∣"cycle"∣"unscheduled", pred?: key, type?, lag?, base: dn, lagDays: dn[], start: dn, skipped: Array<{dn, why: "Sabtu"∣"Minggu"∣"libur"∣"cuti"∣"tambahan", name?}>, finish: dn, durSkipped: same-shape, late: int, deadline: dn|null, cycleWith?: key[]}`. `base` = titik acuan pendahulu (FS: selesai, SS/SF: mulai, FF: selesai); `lagDays` = hari kerja yang dipakai lag (teks: "ditambah lag {L} hari ({daftar} dilewati)"); `skipped` = hari non-kerja antara `base` dan `start` di luar `lagDays`; `durSkipped` = hari non-kerja di dalam `[start, finish]`.

- [ ] **Step 1: Tulis tes gagal**: `"contoh mockup: pendahulu 1.2 selesai Sel 3 Nov 2026, FS lag 1, d 4, tenggat Sen 9 Nov → kind pred, base Sel 3 Nov, lagDays [Rab 4 Nov], skipped [], start Kam 5 Nov, durSkipped [Sab 7 'Sabtu', Min 8 'Minggu'], finish Sel 10 Nov, late 1"`; `"FS lag 0 dari Jumat → skipped Sab+Min, start Senin"`; varian akar, SNET, MFO, manual, done, started, cycle (`cycleWith` terurut), unscheduled; libur bernama (Nyepi 2026-03-19) → `why: "libur", name`; cuti bersama → `why: "cuti"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (dipanggil hanya untuk satu task; tidak di jalur render). **Step 4: PASS**.
- [ ] **Step 5: Commit** `feat(timeline): penjelasan jadwal per task (Kenapa dijadwalkan di sini?)`

### Task 4: `plan.js` — rencana tulis murni

**Files:**
- Create: `static/plugins/timeline/plan.js`, `tests/offline/timeline_plan.test.js`

**Interfaces (Produces `TLPlan`):** `CASCADE_MAX = 20`; `ctx = {tasks, cal, units, readExt}` (sama dengan masukan `run`); `diff(result, ctx, onlyKeys?: Set) → Item[]` (R11); `cascade(ctx, gestures: Array<{task, patch}>) → {items, gestureCount, over, result}` (mesin atas data + patch gestur; turunan = BFS `result.succ` semua tipe dari task gestur; item = gestur ∪ turunan otomatis non-jangkar yang berubah); `toggleUnit(ctx, recId, on) → {items, units}` (`off` → `items: []`); `reschedule(ctx, result, T, unitKeys: Set) → {items, broken: int}` (K36; `r = max(1, ceil(d × (1 − progress/100)))`, durasi baru `workdays(start, add(T, r − 1))` dijepit ≤ 999); `gesture(result, task, raw, patch, cal) → {ok, patch} | {ok: false, reason: "early", es}` (R12); `modePatch(task, units, want) → {mode: want | null}`; `preview(items, result, ctx, before) → PreviewModel` (R14); `revalidate(items, rawNow: Map<key, raw>) → {ok: true} | {ok: false, keys}` (bandingkan `start/duration/constraint/mode` mentah dengan `before`); `undoItems(items) → Array<{taskId, patch}>` (patch = `before` persis, kunci tak ada → `null`).

- [ ] **Step 1: Tulis tes gagal** `timeline_plan.test.js`:
  - `"diff: hanya simpul yang berubah; jangkar tidak pernah; tanpa Mulai berpendahulu → kind new + duration 1 bila hilang; urutan topologis"`.
  - `"cascade: geser A (akar) +2 hk → B (FS) dan C (SS dari B) ikut; D drift tapi bukan turunan → tidak ikut; E selesai turunan → tidak ikut; F di unit Manual turunan → tidak ikut (jangkar)"`.
  - `"cascade: 25 turunan berubah → over true; 20 → false"`.
  - `"gesture: akar → patch start saja; berpendahulu jatuh setelah syarat → start + constraint SNET tanggal jatuh; jatuh sebelum syarat → {ok:false, reason:'early', es}; task Manual → patch apa adanya"`.
  - `"toggleUnit ON: unit dengan rantai berpelanggaran → item = penerus yang dipindah; akar tetap; OFF → []"`.
  - `"reschedule (T = 2026-11-09): belum mulai Mulai lampau di unit otomatis → constraint SNET T; di Manual → start T (milestone ikut); sudah mulai d 10 progress 40 EF < T → durasi = hari kerja start..add(T, 5); selesai tetap; Manual: broken = jumlah pelanggaran baru"`.
  - `"revalidate: start sama → ok; constraint berubah → {ok:false, keys}"`; `"undoItems: kunci constraint/mode yang dulu tidak ada → null; urutan sama"`.
  - `"preview: moved, Selesai project lama → baru + Δ hk, late, notMoved (jangkar bertabrakan, cycle), brokenDeps"`.
  - `"modePatch: pilih nilai sama dengan unit → {mode: null}"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R11, R12, R14, R17). **Step 4: PASS**.
- [ ] **Step 5: Commit** `feat(timeline): rencana tulis — diff, aliran ke hilir, sakelar, jadwalkan ulang, CAS, Urungkan`

### Task 5: Host — jalur tulis massal lokal (`updateTaskExtMany`, `extPatchMany`, `setMany` cepat)

**Files:**
- Modify: `static/offline/taskrepo.js`, `static/offline/taskroutes.js`, `static/plugin-runtime.js` (`makeTaskExt.setMany`), `tests/offline/taskext_writers_fence.test.js` (AUDIT), `tests/offline/plugin_taskext_api.test.js`, `docs/plugins/README.md` §5 (satu kalimat: "`setMany` menulis semua item dalam satu transaksi lokal bila tersedia; kontrak sama")
- Create: `tests/offline/taskext_many.test.js`

**Interfaces:**
- Consumes: `TF.taskext.checkPatch/applyPatch/sizeError/extOnlyNext/isExtOnlyPatch/EXT_ONLY_KEY` (1c-0), `TFdb.openDB`.
- Produces: `TF.taskrepo.applyTaskPatch(base, patch, ctx) → next`; `TF.taskrepo.updateTaskExtMany(items, opts) → Promise<{recs, applied, error}>`; `router.extPatchMany(items) → Promise<{rows, appliedIds, error}>` (R22).

- [ ] **Step 1: Tulis tes gagal** `taskext_many.test.js` (`fake-indexeddb`, 500 task tersimpan):
  - `"kesetaraan: untuk 20 task (bersih, kotor inti, sudah ext saja), updateTask(cid, {ext_patch}) dan updateTaskExtMany([{cid, ext_patch}]) dengan now/today sama menghasilkan record identik (ext, ext_dirty, rev, dirty, updated_at, quadrant, ext_only_rev) dan op outbox berbentuk sama"`.
  - `"satu transaksi readwrite: 200 item → db.transaction dipanggil ≤ 3 kali (getAll id, readwrite tasks+_outbox, pomolog) — spy pada openDB().transaction"`; `"waktu 200 item dicatat (console.log), jalur lama dicatat sebagai pembanding"`.
  - `"berhenti di gagal: item ke-6 cid hilang → applied 5 cid pertama, record 6–200 tidak berubah, error Task not found; patch tak sah di item mana pun → reject sebelum tulis, tanpa applied"`; `"ukuran ext > 4096 di item ke-3 → applied 2"`.
  - `"extPatchMany: id angka server_id, cid string, client_id → terpetakan seperti resolveCid; rows berbentuk sama dengan PUT lokal (id = server_id ?? cid, pomodoros_done)"`.
  - `plugin_taskext_api.test.js`: `"setMany dengan router.extPatchMany: patchTaskExt semua item dalam satu batch, satu extPatchMany, satu refreshTasks, satu taskUpdated, event tf:outbox-queued dipancarkan sekali; reject membawa applied dari appliedIds"`; `"router tanpa extPatchMany → jalur per item lama (tes 1c-0 tetap lulus tanpa ubah asersi)"`; `"set tunggal tidak memakai extPatchMany"`.
  - `taskext_writers_fence.test.js`: entri AUDIT baru (`P_TX`/`P_OP` di `updateTaskExtMany`, `cat: "rev+1"`) — tes pagar gagal sebelum entri ditambahkan, lulus sesudahnya.
- [ ] **Step 2: Jalankan → FAIL** `node --test tests/offline/taskext_many.test.js tests/offline/plugin_taskext_api.test.js tests/offline/taskext_writers_fence.test.js`.
- [ ] **Step 3: Implementasi** (R22): pindahkan `applyTo` → `applyTaskPatch` tanpa ubah logika (diff `updateTask` hanya pemanggilan), lalu `updateTaskExtMany`, `extPatchMany`, jalur cepat runtime.
- [ ] **Step 4: Jalankan → PASS**; `npm test`; `python3 -m pytest tests/ -q` (tes `syncpush`/`syncpull`/`taskext_only_flow` lulus tanpa ubah asersi).
- [ ] **Step 5: Commit** dua commit: `feat(offline): tulis ext massal satu transaksi (updateTaskExtMany, extPatchMany)` dan `feat(plugin): setMany memakai jalur tulis massal lokal bila tersedia`.

### Task 6: Manifest 1.1.0, build, `projectStore`, `useEngine`, pagar nol tulisan latar

**Files:**
- Modify: `static/plugins/timeline/manifest.json`, `plugin.jsx`, `tests/offline/timeline_ui.test.js`, `tests/build-plugins.test.js`
- Generated: `plugin.js`, `static/plugins/index.json`, blok plugins `static/sw.js`

**Interfaces:**
- Consumes: T1–T4; `api.records` (`get`/`list`/`put`/`onChange`, peristiwa `pulled`); `api.data.tasks.list`; `api.events.on("sync.done")`.
- Produces: `projectStore(api)` (R6); `useEngine(api, opts)` (R7); `fakeRecords()` di tes diperluas ke entitas `project` + `list` dengan `scope`.

- [ ] **Step 1: Tulis tes gagal**:
  - `build-plugins.test.js`: `"timeline 1.1.0: parts urutan R2, records.project {lww, 1024}, taskExt.keys lima kunci, hash berubah, build dua kali stabil"`; `"cpm.js dan plan.js bisa di-require sendiri"`.
  - `timeline_ui.test.js`: `"projectStore.loadUnits workspace: list scope list:12 (dua halaman next) → Map per recId; data name fold beda → exists false; v 2 → diabaikan"`; `"setAuto menulis {v:1, auto, name, by} scope unit"`; `"task pindah ke project lain / project diganti nama → unitOf baru tanpa record → mode efektif manual, 0 tulis"` (Review Focus 5).
  - `"useEngine: render pertama status loading tanpa memanggil TLCpm.run (spy); setelah raf + setTimeout palsu → ready; scopeTasks identitas sama → tidak muat ulang; berubah / sync.done → satu muat ulang setelah 300 ms (dua kejadian beruntun = satu)"`.
  - **Nol tulisan (R25):** `"spy taskExt.set/setMany + records.put = 0 setelah: mount view workspace 500 task dengan drift > 0, sync.done, onChange project dari sync, pulled, app.dayChanged, kalender berubah, scopeTasks baru"`; `"sumber plugin.js: setiap 'taskExt.set(' / 'taskExt.setMany(' / 'records.put(' berada di dalam fungsi issue|issueMany|write|writeMany|setAuto|save"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi**; `node compile.js --plugins-only`.
- [ ] **Step 4: Jalankan → PASS**; `npm test`; `python3 -m pytest tests/test_plugins_node.py tests/test_sw_precache_node.py -q`; build kedua tanpa diff.
- [ ] **Step 5: Commit** `feat(timeline): manifest 1.1.0, record project, mesin di view tanpa tulisan latar`

### Task 7: Tata letak dan grafik — panah per tipe, kolom Slack, Jalur kritis, pin Manual

**Files:**
- Modify: `static/plugins/timeline/layout.js`, `plugin.jsx`, `style.css`, `tests/offline/timeline_layout.test.js`, `tests/offline/timeline_ui.test.js`

**Interfaces:**
- Produces: `TLLayout.arrowPath(fromRect, toRect, type)` (R19); `layout(...).edges[i].type`; `TLLayout.wbsMap(tasks, pageKind, readSchedOf) → Map<key, wbs>`; `slackText(n) → string` (`pure`); render menerima `eng = {result, crit}` tanpa mengubah memo `lay` (overlay terpisah, `React.useMemo([lay, eng.result])`).

- [ ] **Step 1: Tulis tes gagal**:
  - `timeline_layout.test.js`: `"arrowPath FS identik dengan 1b untuk semua kasus lama; SS/FF/SF: titik awal dan akhir di sisi benar, hanya H/V, penerus di kiri/kanan"`; `"edges membawa type"`; `"wbsMap = nomor WBS layout"`.
  - `timeline_ui.test.js`: `"kolom Slack setelah %, teks 0 / '6 hk' / '−1 hk' / '—'; ringkasan min anak; tidak ada di COLS_COMPACT"`; `"sebelum mesin siap: sel Slack '—' dan tanpa is-critical"`; `"Jalur kritis OFF bawaan; ON → bar slack ≤ 0 is-critical, panah antar kritis is-critical, legenda + 'Jalur kritis'; pref crit:<page> ditulis lewat storage"`; `"task Manual di unit otomatis → pin aria-label 'Manual'"`; `"konflik jangkar → panah merah putus-putus"`; `"tanpa hex di style.css"` (tes 1b tetap).
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R18, R19). **Step 4: PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): kolom Slack, jalur kritis, panah SS/FF/SF, penanda Manual`

### Task 8: Toolbar, sakelar Jadwal otomatis, dialog pratinjau

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

**Interfaces:**
- Consumes: `projectStore`, `useEngine`, `TLPlan.toggleUnit/preview/revalidate/undoItems`.
- Produces: `PreviewDialog({title, model, offline, todayLabel?, onApply, onCancel, whyOf})`; `applyPlan(items, {onDone})` (satu `setMany` + toast + Urungkan, dipakai T9/T10); `UnitPopover`; `MoreMenu` (HP).

- [ ] **Step 1: Tulis tes gagal**:
  - `"toolbar urutan R23; ≤ 640 px / liveEdit → tiga tombol di menu 'Lainnya'; mesin belum siap → tombol Jadwal otomatis/Jalur kritis/Jadwalkan ulang tidak tampil"`; `"kanan toolbar 'Selesai {tgl}' + chip '{n} lewat tenggat'"`.
  - `"halaman project: sakelar ON, 0 item → records.put auto true + toast 'Jadwal otomatis menyala — tidak ada task yang bergeser', tanpa setMany"`; `"ON dengan 3 item → dialog 'Nyalakan jadwal otomatis — {project}', Batal/Esc → 0 tulis; Terapkan → satu setMany lalu satu put; setMany reject → put tidak dipanggil, toast 'Sebagian jadwal gagal disimpan (k dari n)'"`; `"OFF → put auto false + toast 'dimatikan — tanggal tetap…', 0 setMany"`.
  - `"halaman workspace: popover per kelompok project + '(Tanpa project)'; 'Dinyalakan oleh Sari · Kam 5 Nov' dari collaborators; by tak dikenal → 'Dinyalakan oleh anggota lain'"`.
  - `"dialog: baris 'WBS · Task · Mulai lama → baru · Δ hk', 'baru dijadwalkan', 'durasi berubah', ringkasan '{n} task bergeser · Selesai project … ({±k} hk) · {m} lewat tenggat', 'Tidak dipindah'; 60 item → 50 baris + 'Tampilkan semua'; fokus terjebak, Esc"`; `"item durGuess → catatan 'durasi belum diisi, dianggap 1 hari kerja'"`; `"offline → catatan offline"`.
  - `"CAS: daftar lengkap berubah (start item 2) sebelum Terapkan → toast 'Data berubah sejak pratinjau dibuka — hitung ulang', 0 setMany, dialog menghitung ulang"`; `"anggota lain mematikan unit (onChange project, updatedAt baru) saat pratinjau ON terbuka → Terapkan ditolak dengan toast yang sama, 0 tulis"`; `"Urungkan → setMany undoItems persis (constraint null)"`.
  - Bila **P3 (a)**: `"workspace, record unit tidak ada lokal dan belum ada peristiwa pulled sejak pasang → sakelar disabled + 'Menunggu data jadwal workspace…'; setelah pulled + muat ulang selesai → aktif (pola kunci kalender ADR-042 #12); halaman project pribadi tidak pernah terkunci"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R14, R15, R23). **Step 4: PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): sakelar Jadwal otomatis per project dengan pratinjau dan Urungkan`

### Task 9: Aliran gestur di Gantt (K32, K33)

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx` (`createInteractions`: `finish`, `key`, `slotUp`, `link`, `issueMany`), `tests/offline/timeline_ui.test.js`

**Interfaces:**
- Consumes: `TLPlan.gesture/cascade/undoItems`, `applyPlan`, `PreviewDialog` (T8), `X.cur.eng` (hasil `useEngine`).
- Produces: `issueMany(items) → Promise` (R13); `flow(task, rr, patch, prev)` = satu pintu untuk seret/Alt+panah/klik-jadwalkan/tautkan.

- [ ] **Step 1: Tulis tes gagal**:
  - `"unit Manual tanpa penerus otomatis: seret = satu set + toast 'Jadwal diubah' (1b, tanpa ubah asersi lama)"`.
  - `"unit otomatis: seret akar +2 hk dengan 3 turunan → satu setMany 4 item (gestur + turunan) + toast 'Jadwal diubah · 3 task ikut bergeser' + Urungkan → setMany nilai lama"`; `"turunan 0 → set + 'Jadwal diubah'"`; `"turunan 21 → PreviewDialog, 0 tulis sebelum Terapkan"`.
  - `"seret task berpendahulu ke sebelum syaratnya → 0 tulis, bar kembali (restore), toast 'Tidak bisa lebih awal dari dependensinya'"`; `"seret task berpendahulu ke setelah syarat → patch berisi constraint SNET tanggal jatuh"`.
  - `"Alt+→ pada task otomatis = satu tulis per tekan (set/setMany), tombol ditahan saat busy diabaikan"`; `"klik-jadwalkan di unit otomatis → akar baru {start, duration: 1}"`; `"tautkan A→B (B otomatis) → deps + B dan hilirnya mengalir dalam satu setMany"`.
  - `"mesin belum siap/gagal: task otomatis (unit auto) → 0 tulis + 'Jadwal gagal disimpan'; task Manual → perilaku 1b"`.
  - `"drift di luar turunan tidak ikut setMany"` (Review Focus 4).
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R12, R13). **Step 4: PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): gestur di project otomatis mengalir ke penerus dengan Urungkan`

### Task 10: Banner drift dan lingkaran, "Tinjau", "Jadwalkan ulang"

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`, `style.css`, `tests/offline/timeline_ui.test.js`

- [ ] **Step 1: Tulis tes gagal**:
  - `"drift 4 task di halaman → banner 'Jadwal otomatis belum mutakhir: 4 task berbeda dari hasil hitung.' + 'Tinjau' → dialog 'Tinjau jadwal otomatis' berisi 4 item; Terapkan = satu setMany"`; `"drift di luar halaman (task tersaring panel tetapi di scope) tidak dihitung; banner tidak tampil saat loading"`.
  - `"lingkaran A↔B → 'Dependensi melingkar: A, B — tidak dihitung' + 'Buka' → onTaskClick(A)"`; `"Tutup → tidak tampil lagi sampai jumlah berubah, termasuk setelah view dipasang ulang (Set modul)"`.
  - `"Jadwalkan ulang (today 2026-11-07 Sabtu → T Sen 9 Nov): dialog 'Jadwalkan ulang yang belum selesai' + 'Hari ini: Sab 7 Nov'; unit otomatis → SNET T + penerus; unit Manual → start T + '{n} dependensi akan dilanggar'; 0 item → Terapkan nonaktif"`.
  - `"0 tulisan sampai Terapkan; Batal → 0"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R16, R17). **Step 4: PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): banner jadwal belum mutakhir dan lingkaran, Tinjau, Jadwalkan ulang`

### Task 11: Seksi Jadwal — kontrol Mode (tingkat 1) dan kartu tingkat 2

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx` (`ScheduleBody`), `style.css`, `tests/offline/timeline_section.test.js`

**Interfaces:**
- Consumes: `projectStore` (unit task: `get`), `useCalendar`, `TLCpm.run` atas daftar lengkap scope task (memakai `all` yang sudah dimuat 1b, dijalankan di `useMemo` setelah `all` ada — tidak di render pertama), `TLLayout.wbsMap`.
- Produces: `writeMany(items)` seksi (satu `setMany`, state lokal optimistis untuk task sendiri, toast + Urungkan); `secEngine` = `{result, node, wbs}`.

- [ ] **Step 1: Tulis tes gagal**:
  - `"mode efektif manual: tingkat 1 1b tidak berubah (asersi lama lulus); Selengkapnya → kontrol Mode Manual|Otomatis, nilai unit 'sama dengan project'; pilih Otomatis di unit Manual → patch {mode: 'auto'}; pilih Manual → {mode: null} + aliran penerus"`; `"punya 3 penerus otomatis → 'Mengubah task ini menggeser 3 task otomatis'"`.
  - `"mode efektif otomatis: kartu tingkat 2 — chip 'Otomatis', 'lewat tenggat 1 hk', 'Kam 5 Nov → Sel 10 Nov · 4 hari kerja', 'menunggu 1.2 (+1 hk) · diikuti 3.1 · slack 0', chip 'Di jalur kritis'"` (data mockup).
  - `"drift → 'Belum mutakhir — hasil hitung Kam 5 Nov.' + 'Perbarui' → setMany task + turunan; dipasang ulang/props berubah → 0 tulis"`.
  - `"task berulang / tanpa id → null (1b); ringkasan → teks 1b"`; `"variant panel dan modal sama"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R20 tingkat 1–2). **Step 4: PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): seksi Jadwal — mode per task dan ringkasan otomatis`

### Task 12: Seksi Jadwal tingkat 3 — Batasan, Dependensi bertipe, "Kenapa", "Ubah ke Manual", kartu pratinjau

**Files:**
- Modify: `static/plugins/timeline/plugin.jsx`, `style.css`, `tests/offline/timeline_section.test.js`

**Interfaces:**
- Produces: `whyText(ex, ctx) → Array<string|{b}>` (`pure`, R21); `PreviewCard({model, onApply, onCancel})`.

- [ ] **Step 1: Tulis tes gagal**:
  - `"tingkat 3 urutan: Mode · Mulai (teks + 'Ubah') · Durasi · Selesai · Milestone · % selesai · Batasan · Dependensi (Menunggu / Diikuti oleh) · Tambah dependensi · Kenapa dijadwalkan di sini? · Ubah ke Manual"`.
  - `"Batasan: pilih 'Mulai tidak lebih awal dari' + 2026-11-12 → patch constraint SNET + aliran; 'Harus selesai pada' → MFO; 'Secepatnya (ASAP)' → constraint null"`.
  - `"Menunggu: pilihan tipe berlabel 'Selesai → Mulai (FS)'…'Mulai → Selesai (SF)'; ubah ke SS → deps ditulis ulang utuh (dependensi lain apa adanya); lag 1 → '+1 hk'; Diikuti oleh = penerus dari daftar lengkap, tanpa input"`.
  - `"Ubah (Mulai otomatis) → input; tanggal sebelum syarat → toast 'Tidak bisa lebih awal dari dependensinya', 0 tulis; sesudah → start + SNET"`.
  - `"whyText contoh mockup persis (R21) dan varian root/snet/mfo/manual/done/started/cycle/unscheduled; >6 hari dilewati → 'dan {n} hari lain'"`; `"Kenapa terlipat bawaan; explain dipanggil hanya saat dibuka (spy)"`.
  - `"Ubah ke Manual di unit otomatis → {mode: 'manual'}"`; `"aliran dari seksi > 20 → PreviewCard 5 baris + 'dan {n} lainnya', Terapkan = satu setMany, Batal = 0"`; `"durasi hilang → 'durasi belum diisi, dianggap 1 hari kerja'"`.
- [ ] **Step 2: Jalankan → FAIL**. **Step 3: Implementasi** (R20 tingkat 3, R21). **Step 4: PASS**; build; `npm test`.
- [ ] **Step 5: Commit** `feat(timeline): seksi Jadwal tingkat 3 — batasan, dependensi bertipe, Kenapa, Ubah ke Manual`

### Task 13: Integrasi runtime nyata, anggaran DOM dan kinerja

**Files:**
- Modify: `tests/offline/timeline_runtime.test.js`, `tests/offline/timeline_ui.test.js`

**Interfaces:**
- Consumes: `static/plugin-runtime.js` (`P._reset`, `P.init`, `P.load` lewat `vm`), `TF.pluginsync` + `fake-indexeddb`, `taskroutes` lokal (router dengan `extPatchMany`).

- [ ] **Step 1: Tulis tes gagal**:
  - `timeline_runtime.test.js`: `"index.json repo: timeline 1.1.0, records.project tersalin, taskExt.keys lima"`; `"api.records nyata: put project prj@list:12:<h> scope list:12 → pending + op outbox plugin; id cocok pola server"`; `"api.taskExt.setMany nyata 200 item lewat router.extPatchMany: IndexedDB memuat 200 nilai, ext_only_rev sah, 200 op update, satu event tf:outbox-queued"`; `"setMany nyata dengan item ke-6 terhapus → err.applied 5"`; `"api.taskExt.set mode/constraint lolos validasi host (ukuran)"`.
  - `timeline_ui.test.js`: `"DOM 500 task/400 dep, Jalur kritis ON, Slack, banner drift → ≤ 1.500 elemen"`; `"render awal tidak menjalankan TLCpm.run (spy) — mesin setelah raf+setTimeout"` (R24).
- [ ] **Step 2: Jalankan → FAIL** (atau PASS langsung — catat). **Step 3: Sesuaikan** bila nama berbeda (bukan kontrak). **Step 4: PASS**; `npm test`; `python3 -m pytest tests/ -q`.
- [ ] **Step 5: Commit** `test(timeline): integrasi runtime 1.1 — record project, setMany massal, anggaran DOM`

### Task 14: Rilis — SW, whatsnew (tidak silent), README, ADR, pola tes CI

**Files:**
- Modify: `static/sw.js` (`CACHE`), `static/index.html` (`__SW_VERSION` + fallback; string saja), berkas `static/`+`tests/` bervers lama (sed **kecuali** `static/whatsnew.json`), `static/whatsnew.json`, `tests/test_plugins_node.py`, `docs/plugins/README.md`, `.agents/DECISIONS.md`

- [ ] **Step 1: Versi** → nomor berikutnya setelah 1c-0b (perkiraan `taskflow-v498-jadwal-otomatis`, R26); `app.css?v=383` tetap.
- [ ] **Step 2: whatsnew** entri teratas — **teks menunggu persetujuan pemilik (P1)**; usulan (semua ≤ 60/140 karakter, tanpa istilah teknis; panjang diperiksa `tests/test_whatsnew.py`):
  ```json
  {"version": "taskflow-v498-jadwal-otomatis", "date": "<tanggal rilis WIB>", "title": "Timeline: jadwal otomatis dan jalur kritis",
   "new": ["Nyalakan Jadwal otomatis per project: task mengikuti dependensinya, selalu lewat pratinjau sebelum ada tanggal yang berubah.",
           "Di project otomatis, menggeser satu task ikut menggeser task sesudahnya. Salah geser? Tekan Urungkan.",
           "Jalur kritis dan kolom Slack menunjukkan task mana yang tidak boleh terlambat.",
           "Dependensi kini bisa Mulai–Mulai, Selesai–Selesai, dan Mulai–Selesai, dengan jeda hari kerja.",
           "Jadwalkan ulang task yang terlambat ke setelah hari ini dalam satu langkah. Detail task menjelaskan kenapa dijadwalkan di sana."]}
  ```
- [ ] **Step 3: `tests/test_plugins_node.py`**: `REQUIRED` += `"timeline_cpm", "timeline_plan", "taskext_many"` (`PATTERNS` sudah mencakup `timeline_*` dan `taskext*`).
- [ ] **Step 4: README**: judul "(Fase 0a–1c-1)"; §5 `setMany` jalur cepat (R22) + `records` contoh kedua `project` (id deterministik ber-hash, penjaga nama, "jangan menulis dari efek"); §6.2 contoh Timeline 1.1 (mesin setelah gambar pertama, daftar lengkap bukan `scopeTasks`); §8 butir baru "Hasil hitung tidak pernah ditulis otomatis — tampilkan drift, tulis hanya dari gestur" (K27).
- [ ] **Step 5: ADR-045 (atau berikutnya setelah ADR 1c-0b)** "Timeline 1.1: jadwal otomatis klien tanpa tulisan latar, CPM murni, unit jadwal per project, tulis massal lokal satu transaksi" (Date / Agent / Context / Decision / Consequences): Context (spec 1c K27–K39, Q2–Q4, catatan 1c-0 setMany 4,2–4,8 s); Decision (R2–R5, R7–R14, R18, R22, R25); Consequences (drift banner bukan otomatis penuh; ganti nama project memutus unit → kembali Manual; dua anggota idempoten/LWW per kunci; drain 200 PUT di latar — ukuran E2E dan pemicu batch generik K23; klien 1.0 dan "Hapus dependensi rusak"; rollback = matikan plugin atau revert sebagai rilis baru + whatsnew `silent`, kunci/record dibiarkan, `setMany` kembali per item).
- [ ] **Step 6: Verifikasi** `python3 -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` (PROTOCOL §4 butir 5), `npm test`, `python3 -m pytest tests/ -q`, `node compile.js` idempoten; PROTOCOL §4 butir 6 (SKB 2027 sudah ada; tidak berubah).
- [ ] **Step 7: Commit** `chore(release): SW v498 Timeline 1.1 jadwal otomatis, README, ADR-045`

### Task 15: E2E Playwright

**Files:**
- Create: `temporary_files/e2e_plugin_fase1_1c1.py` (pola `e2e_plugin_fase1_1c0.py`/`1b.py`: `hd.seed`, `hd.check`, tangkapan `temporary_files/e2e_plugin_fase1_1c1/`; `TZ=Asia/Jakarta`; tidak di CI)

**Skenario** (U1 konteks A dan B, U2 anggota workspace W; Timeline ON untuk U1 dan U2; seed workspace **500 task + 400 dependensi** campuran FS/SS/FF/SF di 3 project):
1. **Nol tulisan latar:** A dan B membuka Timeline W; 2 siklus `__syncNow()`; pantau jaringan → **0 PUT task / 0 POST records** dari keduanya; buka seksi Jadwal 5 task → tetap 0.
2. **Sakelar + pratinjau:** A menyalakan Otomatis project P1 → dialog berisi n item, Batal → 0 PUT; Terapkan → PUT `{ext_patch}` saja (body tanpa field inti, K25), record `project` POST; B tarik → Gantt B sama, keterangan "Dinyalakan oleh <U1>"; B 0 PUT.
3. **Terapkan 200 task, CPU 4×** (CDP `Emulation.setCPUThrottlingRate(4)`, offline agar drain tidak bercampur): klik Terapkan → semua nilai tersimpan di IndexedDB ≤ **2 s** (kriteria 7) + **satu** commit React untuk optimistis (hook DevTools palsu, pola 1c-0 skenario 8); catat angka jalur lama (`extPatchMany` dinonaktifkan lewat `route`) sebagai pembanding.
4. **Drain** (K23): online, latensi 150 ms (route delay) → waktu drain 50 dan 200 task dicatat; bila drain 50 > 60 s catat sebagai pemicu PR batch generik.
5. **Judul bertahan:** U2 mengubah judul X lewat API; A (belum tarik) Terapkan 200 termasuk X → server memuat judul U2 + jadwal A.
6. **Aliran gestur:** seret akar P1 → toast "… task ikut bergeser" + Urungkan memulihkan semua (IndexedDB = nilai awal); seret ke sebelum pendahulu → toast "Tidak bisa lebih awal dari dependensinya", 0 PUT; seret dengan > 20 turunan → pratinjau.
7. **Klien 1.0 + 1.1:** konteks C memuat `plugin.js` 1.0.0 dari `origin/main` (route); C menyeret task otomatis berpendahulu (tanpa SNET) → A melihat banner drift "Tinjau"; dependensi SS tampil "tidak dikenali versi ini" di C dan tidak terhapus.
8. **Drift dari host:** U2 menyelesaikan pendahulu lewat centang host → A banner drift, 0 PUT dari A sampai Tinjau → Terapkan.
9. **Jadwalkan ulang** dengan jam tetap (CDP `Emulation.setTimezoneOverride` + `clock`) → pratinjau "Hari ini: …", Terapkan.
10. **Kinerja:** render awal ≤ 150 ms (R24 1b, klik kedua), mesin ≤ 40 ms (CPU 4×, `performance.measure` yang ditandai di dev build tes — atau waktu antara render pertama dan sel Slack terisi), DOM ≤ 1.500 dengan Jalur kritis ON.
11. **Offline:** A offline → Terapkan → catatan offline di pratinjau; online → op terkirim.
12. **375 px:** menu "Lainnya", seksi tingkat 2 di modal; `scrollWidth === 375`. **Sakura gelap**: garis kritis + banner terbaca (tangkapan); konsol tanpa error.
13. Regresi: `e2e_plugin_fase1_1b.py`, `1c0.py`, `1a2.py`, `1a1.py`, `0a.py`, `0b.py` lulus (cek kinerja 1b 6a/6d boleh derau mesin bila juga gagal di `origin/main` — catat).

- [ ] **Step 1:** tulis skrip; **Step 2:** `TZ=Asia/Jakarta python3 temporary_files/e2e_plugin_fase1_1c1.py` → semua cek lolos (catat N/N + angka 3, 4, 10); regresi.
- [ ] **Step 3: Commit** `test(timeline): E2E Timeline 1.1 (otomatis, 500/400, dua anggota, 1.0+1.1, offline, 200 Terapkan)`

### Task 16: Verifikasi akhir, dokumen, handover, review, PR draft

**Files:** spec 1c (+ "### Catatan implementasi PR 1c-1 (<tanggal>)" setelah catatan 1c-0), `docs/superpowers/plans/2026-11-01-plugin-fase1-pr-1c-1.md` (salinan rencana ini), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- [ ] **Step 1: Verifikasi** dan catat angka: `python3 -m pytest tests/ -q`; `npm test` (hanya `draw_local_reactive`); `node --test tests/build-plugins.test.js`; PROTOCOL §4 butir 5; `node temporary_files/check_inline_scripts.js static/index.html`; `node compile.js` dua kali tanpa diff; `git diff --stat origin/main -- static/app.css webapp.py plugin_records.py plugin_loader.py task_ext.py static/offline/syncpush.js static/offline/syncpull.js static/offline/db.js` kosong; `git diff origin/main -- static/offline` hanya `taskrepo.js` + `taskroutes.js`; `git diff origin/main -- static/index.html` hanya string versi SW; simulasi CI tanpa `node_modules`.
- [ ] **Step 2: Dokumen:** catatan implementasi di spec repo (penyimpangan + angka E2E 3/4/10) dan salinan Project `claude/spec-plugin-fase1-1c-otomatis-2026-11-01.md` lewat `project_write` (isi sama); salin rencana ke `docs/superpowers/plans/` dan Project `claude/plan-plugin-fase1-pr-1c-1-2026-11-01.md`.
- [ ] **Step 3: Handover** `CURRENT_STATE.md`: `## 🟡 Plugin Fase 1 — PR 1c-1: Timeline 1.1 jadwal otomatis — claude/plugin-timeline-auto — <tanggal> (Claude) — PR DRAFT, menunggu 1c-0b ter-deploy lalu "merge dan deploy"`: spec/plan/ADR; isi; rilis SW + whatsnew; deploy = file statis, **tanpa restart** (K26 1c-0, prasyarat restart 1c-0 terverifikasi); verifikasi pasca-deploy (Timeline 1.1.0 di Pengaturan › Plugin; sakelar Jadwal otomatis di project; `POST /api/plugins/timeline/records` entitas `project` 200 tanpa `INVALID`; DevTools: Terapkan → PUT `{ext_patch}` saja); rollback (R27, catatan "Hapus dependensi rusak" untuk klien 1.0); tindak lanjut (1c-2 baseline/aktual; batch push generik bila drain E2E melewati pemicu K23). `SESSION_LOG.md` entri baru (PROTOCOL §3.2).
- [ ] **Step 4: Commit** `docs(agents): handover PR 1c-1 Timeline jadwal otomatis`
- [ ] **Step 5: Review akhir oleh subagen reviewer terpisah** (Review Focus 1–5 + R1–R28; khusus: tidak ada tulisan dari efek/`sync.done`/`pulled`/timer; `depReq`/`depLimit` satu sumber dan identitas `ES = LS`; mesin tidak di jalur render awal; aliran hanya hilir; Urungkan persis; CAS; `applyTaskPatch` tanpa perubahan perilaku dan `updateTaskExtMany` setara; fallback modul lama; `index.html` +0; tanpa `localStorage`/`innerHTML`/hex). Perbaiki temuan wajib, ulangi Step 1.
- [ ] **Step 6: Push + PR draft** judul `Plugin Fase 1 — PR 1c-1: Timeline 1.1 (jadwal otomatis, CPM, SS/FF/SF, jalur kritis, Jadwalkan ulang)`; body: ringkasan, tangkapan (desktop terang, Sakura gelap, 375 px, pratinjau, seksi tingkat 2/3), tabel file, R penting, prasyarat merge (1c-0 restart terverifikasi + **1c-0b ter-deploy**), deploy statis tanpa restart, rollback, angka tes + E2E (200 Terapkan, drain, mesin, render); akhiri dengan atribusi sesi. Merge hanya setelah Bapak bilang "merge dan deploy".

---

## Keputusan untuk pemilik (sebelum Task 5 / Task 8 / Task 14)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| **P1** | **Teks "Apa yang baru"** untuk rilis ini (Task 14 Step 2) | (a) setujui apa adanya; (b) ubah | **(a)** — lima poin dari sudut pandang pengguna, ≤ 60/140 karakter, tanpa istilah teknis ("jeda hari kerja" menggantikan "lag"). |
| **P2** | **Mempercepat penyimpanan massal** (Terapkan 200 task ≤ 2 detik). Butuh perubahan kecil di penyimpanan task bersama (satu kali simpan untuk banyak task, bukan 200 kali). | (a) ikut di PR 1c-1 sebagai commit tersendiri, dengan cadangan otomatis ke cara lama; (b) PR dasar terpisah "1c-0c" sebelum 1c-1; (c) tunda — Terapkan 200 task tetap ±4–5 detik | **(a)** — hanya dipakai `setMany` (saat ini hanya Timeline), hasil simpannya diuji identik dengan simpan biasa, dan membatalkan 1c-1 otomatis kembali ke cara lama tanpa data hilang; (b) menambah satu siklus rilis tanpa mengurangi risiko berarti. |
| **P3** | **Perangkat yang belum menerima data workspace** (baru login / Timeline baru dinyalakan): sakelar "Jadwal otomatis" di halaman workspace… | (a) nonaktif sebentar dengan teks "Menunggu data jadwal workspace…" sampai sinkron pertama selesai, seperti Kalender kerja; (b) langsung bisa dipakai | **(a)** — tanpa itu, perangkat itu melihat semua project "Manual" padahal anggota lain sudah menyalakannya, dan menyalakan/mematikannya menimpa keterangan "Dinyalakan oleh". Jedanya biasanya beberapa detik. |
