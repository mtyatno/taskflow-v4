# Android Offline Voice Dictation — SpeechRecognizer Native

**Spec date:** 2026-08-15
**Status:** Design approved, pending implementation plan

## Purpose

Mengganti jalur dikte suara di **APK Android** yang mati karena Google menutup Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), dengan engine native Android (`android.speech.SpeechRecognizer`) yang bekerja **offline** — mesin yang sama dengan dikte offline Gboard. UX tetap: klik mic → rekam terus → teks muncul live → klik lagi untuk stop.

## Root Cause (kenapa fitur lama mati)

1. **Web Speech API ditutup Google.** Desktop Chrome 160+ (awal 2026) silent-fail — tombol tampak listening tapi `onresult` tidak pernah fire, tanpa error. Android Chromium tidak pernah ship model on-device (`available()` → "unavailable"), jalur legacy cloud juga rusak. Sumber: Chromium bugs 40286514, 40948113; demo resmi Google (`google.com/intl/en/chrome/demos/speech.html`) juga gagal.
2. **APK Tauri tidak pernah punya `RECORD_AUDIO`** — project Android di-generate `tauri android init` di CI dan hanya di-patch untuk share-target. Jadi capture audio mustahil di APK untuk pendekatan apa pun.

Kesimpulan: bukan bug kode — fondasi fitur (browser-native recognition) dicabut. Perlu arsitektur baru untuk platform Android.

## Technical Decisions

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Engine | `android.speech.SpeechRecognizer` + `EXTRA_PREFER_OFFLINE` | On-device, offline, gratis, kualitas id-ID terbaik per byte (paket offline Google), tanpa model di-bundle |
| Integrasi | File-bridge `filesDir` (pola `pending_share.json` yang sudah terbukti) | Zero dependensi native baru, bebas risiko build CI, dua arah (JS→Kotlin cmd, Kotlin→JS events) |
| Cakupan | **Android APK saja**; web/desktop dibiarkan seperti sekarang | Prioritas user: dikte offline di ponsel; web/desktop butuh internet/engine lain |
| Bahasa | `id-ID` via `EXTRA_LANGUAGE` | Konsisten dengan fitur lama |
| Mode | Continuous streaming (toggle), partial results live | UX sama persis dengan fitur lama; `EXTRA_PARTIAL_RESULTS` memberi interim text |
| Interface JS | `TF.voicedictate.create()` pilih impl otomatis — **call site index.html tidak diubah** | Satu entry point, dua impl: Web Speech API (web/desktop) & native bridge (Android Tauri) |
| Alternatif yang ditolak | whisper.cpp / Vosk / sherpa-ncnn on-device; `tauri-plugin-stt` | Model +50–200MB, build NDK/JNI berisiko di CI (sejarah brotli), kualitas id-ID whisper tiny/base di bawah paket offline Google, plugin komunitas tak terawat. Reconsider hanya jika HP tanpa Google app |
| Prasyarat di HP (bukan kode) | Paket "Bahasa Indonesia" di-download sekali: Google app → Settings → Voice → Offline speech recognition | Tanpa paket, engine fallback online saat ada internet; tanpa Google app sama sekali → fitur tak tersedia (toast panduan) |

## Architecture

### Alur data

```
JS (NoteEditor 15422 / TaskFormModal 2725) → TF.voicedictate.create()
  ├─ deteksi Android-Tauri (window.__TAURI__.core.invoke + UA Android) → native impl
  ├─ start: invoke('speech_cmd', {cmd:'start', lang:'id-ID'})
  │     → Rust tulis speech_cmd.json (path-probe seperti get_pending_share)
  │     → SpeechBridge.kt poller (~250ms, main thread) baca cmd → startListening
  │     → onPartialResults/onResults/onError/onEnd → append baris JSON ke speech_events file
  └─ JS poller (~300ms): invoke('read_speech_events') → parse baris
        → feed onInterim / onFinal / onError / onStateChange
        (logika dedup voiceLastTextRef di index.html TIDAK berubah)
stop: invoke('speech_cmd', {cmd:'stop'}) → recognizer.cancel()
```

### Format file (di `filesDir`, lokasi identik `pending_share.json`)

**`speech_cmd.json`** — ditulis Rust (overwrite), dibaca lalu **dihapus** Kotlin setelah dikonsumsi (agar command tidak dieksekusi ulang di siklus poll berikutnya):
```json
{"cmd": "start", "lang": "id-ID"}
{"cmd": "stop"}
```

**`speech_events`** — append-only oleh Kotlin, dibaca-then-truncate oleh Rust; satu baris JSON per event:
```json
{"type":"state","state":"listening"}
{"type":"partial","text":"..."}
{"type":"final","text":"..."}
{"type":"error","message":"..."}
{"type":"end"}
```

### Komponen

| Unit | Isi | Testable terpisah |
|---|---|---|
| `scripts/patch-android-speech.js` | Dipanggil CI setelah `patch-android-share.js`: (a) tambah `<uses-permission android:name="android.permission.RECORD_AUDIO"/>` ke manifest; (b) salin `src-tauri/android-template/SpeechBridge.kt` ke package `id.web.yatno.taskflow` di gen/android; (c) inject `onRequestPermissionsResult` + static instance ke MainActivity.kt (pola patch share) | — (verifikasi via build CI) |
| `src-tauri/android-template/SpeechBridge.kt` | Poller cmd (~250ms, `Handler` main thread); lifecycle `SpeechRecognizer`; request izin runtime `RECORD_AUDIO`; auto-restart saat silence (guard maks. 50, mirror JS lama); append events ke file | — (verifikasi via build + device test) |
| Rust `src-tauri/src/lib.rs` | `speech_cmd(app, cmd_json)` → tulis `speech_cmd.json`; `read_speech_events(app)` → baca+truncate events, return **string raw** (baris-baris JSON dipisah `\n`; parsing dilakukan di JS agar unit-testable); `speech_debug(app)` → daftar path kandidat + isi terakhir (pola `share_debug`) | path-probe dipakai juga oleh `get_pending_share` (sudah jalan) |
| `static/offline/voicedictate.js` | Tambah `createNativeAndroid(opts)` + deteksi di `create()`; `isSupported()` = true jika web SpeechRecognition ATAU native bridge tersedia; export parser events murni (`parseSpeechEvents(lines)`) untuk unit test node | ✅ node --test |
| `static/index.html` | **Tidak diubah** (kedua call site tetap) | — |

### Lifecycle & error mapping (Kotlin)

| Event native | Aksi |
|---|---|
| `onReadyForSpeech` | append `{"type":"state","state":"listening"}` |
| `onPartialResults` | append `{"type":"partial","text":<full utterance>}` (Kotlin ambil `results[0]`, full text — konsisten dengan interim Web Speech API) |
| `onResults` | append `{"type":"final","text":...}` |
| `onEnd` (bukan stop user) | restart dengan delay ~300ms, guard 50x → `{"type":"error","message":"Sesi terlalu lama"}` + berhenti |
| `ERROR_NO_MATCH` / `ERROR_SPEECH_TIMEOUT` | silence normal → `{"type":"end"}` + restart (sama seperti atas) |
| `ERROR_INSUFFICIENT_PERMISSIONS` | stop permanen + `{"type":"error","message":"Mikrofon tidak diizinkan. Buka pengaturan aplikasi."}` |
| `ERROR_CLIENT` / `ERROR_RECOGNIZER_BUSY` | stop permanen + `{"type":"error","message":"Engine suara tidak tersedia. Pastikan Google app terpasang dan paket offline Bahasa Indonesia sudah di-download."}` |
| `ERROR_NETWORK` | `{"type":"error","message":"Perlu internet atau paket offline: download Bahasa Indonesia di Google app → Voice → Offline speech recognition"}` + berhenti (jangan restart loop) |
| Izin runtime belum diberikan | `ActivityCompat.requestPermissions(RECORD_AUDIO)` dulu; hasil via `onRequestPermissionsResult` (di-inject ke MainActivity) → grant = start, deny = error di atas |

### JS wrapper (native impl di voicedictate.js)

- `start()` → reset buffer + `invoke('speech_cmd', {cmd:'start', lang})`; state `listening`.
- Poller `setInterval` ~300ms → `invoke('read_speech_events')` → parse baris → dispatch: `state`→`onStateChange`, `partial`/`final`→`onInterim`/`onFinal` (dedup tetap di sisi call site, tidak diubah), `error`→`onError` + `onStateChange('idle')`, `end`→`onStateChange('paused')`.
- `stop()` → `invoke('speech_cmd', {cmd:'stop'})` + hentikan poller + state `idle`.
- Bersihkan `speech_events` stale saat `start()` (invoke `read_speech_events` sekali & buang).
- Kalau 10 siklus poll (~3 detik) tanpa event apa pun setelah start → tampilkan `speech_debug` via `onError` (diagnostik path mapping — mitigasi risiko lama filesDir↔app_local_data_dir, pola share_debug).

## Edge Cases & Robustness

| Kasus | Penanganan |
|---|---|
| filesDir (Kotlin) ≠ app_local_data_dir (Rust) | Path-probe semua kandidat (pola `candidate_share_paths`) + diagnostik on-screen `speech_debug` |
| Race baca/tulis events (Rust truncate tepat saat Kotlin append) | Worst case 1 event hilang/tertunda 1 siklus poll (~300ms) — diterima; Kotlin append kecil (<1KB) |
| SpeechRecognizer harus di main thread | `SpeechBridge.kt` hanya pakai `Handler(Looper.getMainLooper())` |
| HP tanpa Google app / tanpa paket offline | ERROR_CLIENT/NETWORK → toast panduan; kalau online tanpa paket, `EXTRA_PREFER_OFFLINE` masih izinkan engine jalan online |
| Pindah note / tutup editor saat recording | Cleanup `useEffect` yang ada memanggil `.stop()` — native impl kirim `{cmd:'stop'}` |
| APK WebView lama (web SpeechRecognition hang senyap) | `isSupported()` di Android-Tauri → native bridge; jalur Web Speech API tidak lagi dipakai di APK |
| Dua editor (NoteEditor + form catatan baru) | Keduanya pakai `TF.voicedictate.create()` — impl native sama; satu sesi recording per editor (pola lama) |

## Testing

1. **Unit test node** `tests/offline/voicedictate_native.test.js`: parser `parseSpeechEvents`, mapping event→callback, state transitions, timeout-diagnostik — fungsi murni diekspor dari UMD `voicedictate.js` (pola `syncpush.test.js`).
2. **Build CI**: workflow "Build Android APK" hijau = manifest punya `RECORD_AUDIO`, `SpeechBridge.kt` ter-compile (proves Kotlin valid).
3. **Device test manual (user)** — checklist:
   - Klik mic → izin mic muncul → izinkan → tombol merah + bicara → teks interim muncul live di editor → klik stop → teks final masuk.
   - **Mode pesawat** → dikte tetap jalan (verifikasi offline beneran; pastikan paket offline sudah di-download).
   - Tolak izin mic → toast panduan, tombol kembali normal.
   - Diam >10 detik → auto-restart, bicara lagi tetap masuk.

## Scope & Out of Scope

### In scope
- Bridge file-based 2 arah (patch script, SpeechBridge.kt, 3 command Rust)
- Impl native di `voicedictate.js` + deteksi platform
- `RECORD_AUDIO` manifest + izin runtime
- Error handling + diagnostik `speech_debug`
- SW cache bump (voicedictate.js berubah)
- Unit test node

### Out of scope (future)
- Dikte web/desktop (mati sampai browser pulih — Chrome on-device SODA / VPS whisper / whisper-rs desktop)
- whisper.cpp / Vosk / sherpa-ncnn on-device (reconsider hanya jika HP tanpa Google app)
- Dikte iOS (Tauri iOS belum dibuild)
- Speaker diarization, voice commands
