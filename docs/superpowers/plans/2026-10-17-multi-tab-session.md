# Rencana: sesi login koheren antar-tab + perpanjangan token otomatis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-17 · Agent: Claude · Branch: `claude/multi-tab-session-fix` · SW **v415** `taskflow-v415-multi-tab-session`

**Status: dieksekusi** (subagent implementasi server + klien, review independen 2 putaran). Tambahan dari review:
adopsi token hanya untuk akun yang sama (token akun lain → App memutuskan, `beginTabReload()` memblokir semua request
sampai reload); perpanjangan tidak menulis token bila logout dimulai (`beginLogoutGuard`/`tf_logout_at`) atau
token berganti; `__tokenWriteFailed` (localStorage gagal ditulis → tidak disinkronkan); server: fallback cookie/query
hanya untuk `sub` yang sama, cookie diperbarui refresh hanya bila request membawa cookie. Keputusan: ADR-007.

## Laporan Bapak

"Ketika sudah login dan berpindah tab, kadang perlu login kembali."

## Akar masalah (terverifikasi di kode + Playwright, server lokal commit `2fe02d3`)

Token disimpan di `localStorage.tf_token` (bersama untuk semua tab satu profil) **dan** di variabel `__token`
per tab yang hanya dibaca sekali saat script dimuat (`static/index.html` ±326). Tidak ada listener `storage`,
jadi tab-tab tidak pernah saling tahu. Sejak PR #26 (K1, 2026-10-15) setiap 401 dari jalur mana pun
(`api.fetch`, pull, push, `tryAuth`) langsung memanggil `handleAuthExpired()` → form login.

Reproduksi (`repro_tabs.py`, satu konteks browser = beberapa tab):

| Skenario | Hasil di main |
|---|---|
| S1: token kedaluwarsa → tab A & B sama-sama ke form login → login di A → pindah ke B | B **tetap di form login** (harus login lagi) |
| S2: tab C masih memegang token lama; respons 401 request lama tiba setelah A login | `handleAuthExpired` di C menghapus `tf_token` **baru milik A** dari localStorage → A minta login lagi setelah reload |
| S3: logout manual di tab A | tab B tetap "masuk" dengan IndexedDB yang sudah dihapus A (data akun bisa tercampur bila akun lain masuk) |

Faktor kedua: JWT berlaku tetap 72 jam (`JWT_EXPIRE_HOURS`) tanpa perpanjangan. Sebelum PR #26 401 di tengah
sesi tidak terlihat (sesi "zombie", baru ketahuan saat reload); sekarang form login muncul tepat saat tab
kembali aktif (`visibilitychange` → `fetchAll` → `sync()` → 401). Pengguna aktif tetap terlempar ke form
login tiap ±3 hari.

Faktor ketiga (server): `_resolve_user` memakai cookie `token` lebih dulu dan **mengabaikan** header
`Authorization` bila cookie ada, walaupun token cookie tidak valid/berbeda akun.

## Prinsip desain

1. `localStorage.tf_token` = sumber kebenaran bersama; `__token` hanya cache per tab yang disinkronkan
   (event `storage`, plus baca ulang saat `visibilitychange`/`focus`/`pageshow`).
2. 401 hanya mengakhiri sesi bila token **yang dipakai request itu** masih token yang tersimpan. Bila
   localStorage sudah berisi token lain (tab lain login / token diperpanjang) → adopsi token itu, jangan
   tampilkan login, jangan hapus apa pun. Satu laporan 401 per request (di transport), bukan dua.
3. Perubahan token oleh tab lain diterapkan ke tab ini: login akun sama → tab yang di form login pulih
   sendiri; logout manual → tab lain ikut keluar (reload); akun berbeda → reload; sesi berakhir → form login.
4. Perpanjangan geser (sliding): token berumur ≥ 1/3 masa berlakunya (24 jam dari 72) diperpanjang lewat
   `POST /api/auth/refresh` saat app dipakai. Batas absolut `SESSION_MAX_DAYS` (default 30) sejak login
   dengan password (`auth_time`), dan ditolak bila password sudah diganti (`pwv`). Sejalan dengan kandidat
   ADR "refresh 30 hari" di roadmap Capacitor; tidak ada token di-revoke, jadi tidak ada race rotasi antar-tab.
5. Server: header `Authorization` (eksplisit milik tab) didahulukan; bila tidak valid coba cookie, lalu query
   (SSE). Error yang dilaporkan = error kandidat pertama.

## Tugas

### Task 1 — Server (`webapp.py`) + `tests/test_auth_session.py`

- [ ] `from datetime import ... timezone`; konstanta `SESSION_MAX_DAYS = int(os.getenv("SESSION_MAX_DAYS", "30"))` dekat `JWT_EXPIRE_HOURS`.
- [ ] `_pw_fingerprint(password_hash) -> str` = `sha256(password_hash or "")[:16]`.
- [ ] `create_token(user_id, username, auth_time=None, pwv=None)`: tambah klaim `iat` (epoch int, UTC), `auth_time` (epoch int; default = iat), `pwv` (bila ada); `exp` tetap `JWT_EXPIRE_HOURS`. Pemanggil: register (hash dihitung sebelum INSERT), login (`user["password_hash"]`), `/auth/magic` (SELECT `password_hash` juga).
- [ ] `_resolve_user`: kandidat berurutan header Bearer → cookie `token` → query `token` (hanya `allow_query`), tanpa duplikat; kandidat pertama yang lolos `decode_token` + cek `ext_tokens` dipakai; bila semua gagal raise error kandidat pertama; tanpa kandidat → 401 "Not authenticated" (perilaku lama).
- [ ] `POST /api/auth/refresh` (`get_current_user`): scope `ext` → 403; user tidak ada → 401; `pwv` di token ≠ fingerprint sekarang → 401 "Password sudah diganti — masuk lagi"; `auth_time` (token lama tanpa klaim → `exp - JWT_EXPIRE_HOURS*3600`) lebih tua dari `SESSION_MAX_DAYS` → 200 `{"renewed": false, "reason": "max_age"}`; selain itu token baru (auth_time sama, pwv sekarang), set cookie seperti login, balas `{"renewed": true, "token", "expires_in"}`.
- [ ] Tes: klaim login/register; refresh → token baru valid, `auth_time` sama, cookie diset; batas 30 hari (token buatan dengan `auth_time` lama) → renewed false; ganti password (reset) → 401; token ext → 403; token lama tanpa `auth_time/pwv` → bisa refresh; header valid + cookie rusak → 200; header rusak + cookie valid → 200; header & cookie valid beda akun → identitas header. Jalankan seluruh `python -m pytest tests/` (TestClient menyimpan cookie antar-request — pastikan tes lama tetap hijau).

### Task 2 — Klien: koherensi token antar-tab (`static/index.html`)

- [ ] Foundation (±326): `readStoredToken()` (try/catch), `tokenStore.syncFromStorage()` (adopsi nilai localStorage, return true bila berubah), `tokenStore.clearIfStored(t)` (hapus localStorage hanya bila nilainya masih `t`; `__token` → null).
- [ ] `tokenPayload(t)` (base64url aman, null bila gagal) — dipakai renewal, sharedTokenAction, offline fallback tryAuth boleh tetap `atob` lama.
- [ ] `handleAuthExpired(failedToken)` (signature baru; `undefined` = token tab ini saat ini). Bila token tersimpan ada dan ≠ token gagal → adopsi (`__token = stored`), `schedulePush()`, return `true`. Bila tidak ada token sama sekali → return false. Selain itu → `clearIfStored(used)`, Tauri `delete_token`, `__onAuthExpired()`, return false. Tidak pernah memanggil `clearLocalUserData`.
- [ ] `api.fetch`: simpan `reqToken = __token` untuk header; 401 (bukan `/api/auth/`) → `handleAuthExpired(reqToken)`; bila return true dan belum retry → ulangi sekali dengan token baru (flag internal, jangan diteruskan ke `fetch`).
- [ ] `__syncTransport.request` & `__syncRawFetch`: tangkap token saat request; status 401 → `handleAuthExpired(tok)`; respons tetap dikembalikan apa adanya (syncpush tetap berhenti drain, pull tetap throw).
- [ ] Hapus `window.addEventListener("tf:auth-expired", handleAuthExpired)` dan panggilan auth di `stepFailed` (`sync()`), dengan komentar: 401 sudah ditangani transport dengan token yang tepat; laporan kedua tanpa token akan menghapus token yang baru diadopsi.
- [ ] `sharedTokenAction(token, currentUserId, lastUserId, storedUserId)` → `"reload" | "expire" | "restore" | "none"`:
  token dihapus: tab tanpa user → none; `tf_user_id` masih ada → expire; tidak ada → reload (logout manual).
  token baru: tab punya user → `sub` beda → reload, sama → none; tab di form login → `lastUserId` ada dan `sub` beda → reload, selain itu restore.
- [ ] Listener `storage` (key `tf_token` atau `null`, area localStorage) + `visibilitychange` visible / `focus` / `pageshow` → `onSharedTokenChanged()`: bila localStorage ≠ `__token` → `__token = stored` lalu `window.__onSharedTokenChanged(stored, prev)` (try/catch).
- [ ] App: `userRef`, `lastUserIdRef`; `tryAuth` dapat dipanggil ulang (`window.__restoreSession`); 401 di `tryAuth` → `handleAuthExpired(tokenYangDipakai)`, bila return true → jalankan `tryAuth` lagi. `window.__onSharedTokenChanged` menjalankan aksi `sharedTokenAction`: reload → `location.reload()`, expire → `onAuthExpired()`, restore → `__restoreSession()`.

### Task 3 — Klien: perpanjangan token

- [ ] `tokenRenewDue(payload, nowMs)`: `exp` wajib; sudah lewat → false; masa berlaku = `exp-iat` (tanpa `iat` → 72 jam); due bila umur ≥ masa/3.
- [ ] `maybeRenewToken()`: butuh `__token`, online, tidak ada request in-flight, due, throttle antar-tab `localStorage.tf_token_renew_at` (10 menit). `POST apiUrl("/api/auth/refresh")` dengan header Bearer (fetch langsung, bukan `api.fetch`). Sukses `{token}` dan `__token` masih token yang dikirim → `tokenStore.set` (+ Tauri `save_token`). Semua error diabaikan.
- [ ] Pemicu: setelah `tryAuth` sukses, `visibilitychange` visible, event `online`, interval 1 jam.

### Task 4 — Versi + tes JS

- [ ] SW v415 `taskflow-v415-multi-tab-session`: `static/sw.js` CACHE, 2 fallback di `index.html`, `sw_cache` di `webapp.py`, `tests/test_version.py`, semua tes `tests/offline/*.test.js` yang menyebut v414. `app.css` tidak berubah.
- [ ] `tests/offline/auth_session_tabs.test.js` (baru): ekstrak fungsi dari `index.html` (pola `new Function` seperti `sync_robustness.test.js`) dan uji: adopsi token baru vs sesi berakhir, S2 (401 basi tidak menghapus token baru), `sharedTokenAction` semua cabang, listener storage, `tokenPayload` base64url, `tokenRenewDue`, `maybeRenewToken` (due / tidak due / token berganti saat in-flight / throttle), retry `api.fetch` sekali, transport melaporkan token yang dipakai.
- [ ] Perbarui asersi lama di `sync_robustness.test.js` & `user_session_isolation.test.js` sesuai desain baru (tetap: tidak ada `clearLocalUserData` di jalur 401).

### Verifikasi

- `node --test tests/offline/*.test.js` (1 gagal pra-ada `draw_local_reactive`), `python -m pytest tests/`, `node temporary_files/check_inline_scripts.js static/index.html`, `node --check static/sw.js`, 0 `border-left` baru.
- Playwright `repro_tabs.py` + skenario perpanjangan: S1 B pulih sendiri, S2 token A tetap, S3 B ikut keluar, token berumur > 24 jam diganti saat tab aktif.

## Di luar cakupan (catatan)

- Login magic link Telegram (`/auth/magic`) hanya menyetel cookie; SPA tanpa `tf_token` tetap menampilkan form login. Bisa diperbaiki kemudian dengan bootstrap `POST /api/auth/refresh` memakai cookie.
- Ganti password belum mencabut token yang sudah terbit (hanya mencegah perpanjangan).
