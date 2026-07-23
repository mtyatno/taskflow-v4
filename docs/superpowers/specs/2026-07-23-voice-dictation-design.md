# Voice Dictation — Note Editor

**Spec date:** 2026-07-23
**Status:** Design approved, pending implementation plan

## Purpose

Voice-to-text dictation di halaman note. Use case utama: merekam rapat → transkrip otomatis masuk ke editor note secara real-time, tanpa user harus bolak-balik menyentuh layar.

## Technical Decisions

| Keputusan | Pilihan | Alasan |
|---|---|---|
| Engine | Web Speech API (`SpeechRecognition`) | Chrome Android/desktop support `id-ID`; zero biaya server; zero dependency |
| Bahasa | `id-ID` (Bahasa Indonesia) | Rapat mostly bahasa Indonesia |
| Mode | Continuous streaming | Tap sekali → rekam terus sampai user stop |
| Platform prioritas | Mobile-first (Android); desktop bonus | Use case rapat sambil bawa device |
| Silence handling | Auto-restart loop | Rapat sering sepi 2-5 menit saat mencari data; tidak boleh auto-stop permanen |

## UI/UX

### Tombol Microphone

- **Lokasi:** Ujung kanan `NoteToolbar` (setelah tombol attachment)
- **Visibility:** Hanya tampil jika browser support `SpeechRecognition` / `webkitSpeechRecognition`
- **Tiga state visual:**

| State | Ikon | Warna | Keterangan |
|---|---|---|---|
| `idle` | 🎤 | Abu-abu (default toolbar) | Belum merekam |
| `listening` | 🔴 pulse | Merah (`--pomodoro`) | Sedang merekam + menampilkan teks interim |
| `paused` | 🟡 | Oranye (`--p3`) | Silence temporary; auto-restart pending |

- **Animasi pulse** di state `listening` (CSS `@keyframes micPulse`)

### Teks Interim (ghost text)

Tampil sebagai teks **italic abu-abu** di posisi kursor editor via Milkdown decoration, menunjukkan transkrip yang belum final. Begitu `isFinal=true`, teks langsung di-commit sebagai markdown normal.

### Status bar

Indikator kecil di pojok kanan atas modal: `🔴 Merekam... 02:34` — menampilkan durasi sesi, bisa diklik untuk stop.

## Architecture

### File Baru

**`static/offline/voicedictate.js`** — modul terpisah, dipanggil dari `NoteModal`.

```
VoiceDictation: factory function
├── createVoiceDictation(opts)
│   ├── opts.lang           → 'id-ID'
│   ├── opts.onInterim(text) → callback — tampil ghost text di editor
│   ├── opts.onFinal(text)   → callback — insert markdown ke Milkdown
│   ├── opts.onError(msg)    → callback — toast
│   └── opts.onStateChange(s)→ 'idle' | 'listening' | 'paused'
├── .start()                 → mulai recording (set userStopped=false)
├── .stop()                  → stop permanen (set userStopped=true)
└── VoiceDictation.isSupported() → cek browser capability
```

### Auto-Restart Loop (mengatasi silence)

```js
rec.onend = () => {
  if (!userStopped) {
    setTimeout(() => createRecognition(), 100);
  }
};

rec.onerror = (e) => {
  if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
    // Permission ditolak → jangan restart
    userStopped = true;
    onError('Mikrofon tidak diizinkan');
    return;
  }
  // Network / no-speech / audio-capture → retry
  if (!userStopped) {
    setTimeout(() => createRecognition(), 300);
  }
};
```

### Integrasi dengan Milkdown

Text insertion via ProseMirror API:

```js
// Di NoteModal
editor.action(ctx => {
  const view = ctx.get(MB.editorViewCtx);
  const { from } = view.state.selection;
  const tr = view.state.tr.insertText(transcript, from, from);
  view.dispatch(tr);
});
```

### Integrasi dengan NoteModal

```js
// Di NoteModal body
const voiceRef = useRef(null);

useEffect(() => {
  if (VoiceDictation.isSupported()) {
    voiceRef.current = VoiceDictation.create({...});
  }
  return () => voiceRef.current?.stop(); // cleanup saat modal close
}, []);
```

Tombol mic di `NoteToolbar` hanya di-render kalau `isSupported() === true`.

### Tauri Permission

Untuk desktop & Android native, tambahkan di `src-tauri/capabilities/default.json`:

```json
"permissions": [
  "core:default",
  "opener:allow-open-url",
  "audio:allow-microphone"   // ← baru
]
```

## Edge Cases & Robustness

| Kasus | Penanganan |
|---|---|
| Permission mic ditolak | Toast merah, state tetap `idle`, jangan restart, jangan tampil error loop |
| Browser tidak support | Tombol mic tidak muncul; tidak ada error di console |
| Network loss sementara | Auto-retry 3× dengan backoff 1s / 3s / 5s, lalu stop + toast |
| Silence > 5 menit | `onend` → `setTimeout(100)` → `createRecognition` baru; invisible ke user |
| Pindah note saat recording | `useEffect` cleanup → `.stop()` otomatis |
| Modal close saat recording | `useEffect` cleanup → `.stop()` otomatis |
| Sesi sangat panjang (2 jam+) | Max restart counter = 50, setelah itu stop + toast "Sesi terlalu lama" |
| Tabs / app background di Android | `recognition.abort()` via `visibilitychange` listener; resume saat kembali |
| `no-speech` error | Normal saat silence; log debug-only, jangan toast |

## Browser Support

| Browser | Status | Catatan |
|---|---|---|
| Chrome Android | ✅ Penuh | Target utama |
| Chrome Desktop | ✅ Penuh | Bonus |
| Edge Desktop | ✅ Penuh | Bonus |
| Safari iOS/macOS | ⚠️ Terbatas | `SpeechRecognition` ada tapi `continuous` tidak stabil |
| Firefox | ❌ Tidak support | Tombol mic tidak muncul |

## Scope & Out of Scope

### In scope
- Modul `voicedictate.js` (Web Speech API wrapper)
- Tombol mic di `NoteToolbar`
- Teks interim (ghost text)
- Auto-restart loop
- Indikator durasi
- Permission handling
- Tauri capabilities update

### Out of scope (future)
- Cloud STT fallback (Deepgram / Whisper)
- Voice commands (formating suara)
- Voice di halaman draw (tldraw)
- Custom vocabulary / istilah khusus
- Transkrip multi-speaker / speaker diarization
- Ekspor transkrip sebagai file terpisah
