# Voice Dictation — Note Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voice-to-text dictation di editor note via Web Speech API `id-ID`, auto-restart saat silence, dengan UI tombol mic di toolbar dan teks interim di editor.

**Architecture:** Modul baru `voicedictate.js` (UMD, `window.TF.voicedictate`) membungkus `SpeechRecognition` API dengan auto-restart loop. `NoteToolbar` menerima props `voiceState` + `onToggleVoice`, render tombol mic. `NoteModal` memegang state voice dan integrasi dengan Milkdown editor untuk insert teks.

**Tech Stack:** Vanilla JS (Web Speech API), React (global), Milkdown/ProseMirror, CSS animation

## Global Constraints

- Browser target: Chrome/Edge Android + desktop (Web Speech API)
- Bahasa: `id-ID` (Bahasa Indonesia)
- Mode: continuous streaming dengan auto-restart loop
- Tombol mic hanya muncul jika browser support `SpeechRecognition || webkitSpeechRecognition`
- Tidak ada dependency baru, tidak ada API key, tidak ada server-side
- Ikuti pola UMD `window.TF.*` untuk modul baru
- Tauri capabilities: tambah `audio:allow-microphone`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `static/offline/voicedictate.js` | Create | Web Speech API wrapper (auto-restart, state machine) |
| `static/index.html` | Modify | Script tag, CSS animation, NoteToolbar mic button, NoteModal voice state+integration, prop wiring di 3 call site |
| `src-tauri/capabilities/default.json` | Modify | Add microphone permission for native desktop/Android |

---

### Task 1: Create `voicedictate.js` module

**Files:**
- Create: `static/offline/voicedictate.js`

**Interfaces:**
- Produces: `window.TF.voicedictate` object with:
  - `TF.voicedictate.isSupported()` → `boolean`
  - `TF.voicedictate.create(opts)` → `{ start, stop, getState }`
    - `opts.lang` — `string` (e.g. `'id-ID'`)
    - `opts.onInterim(text)` — callback, dipanggil tiap interim result
    - `opts.onFinal(text)` — callback, dipanggil tiap final result
    - `opts.onError(message)` — callback, dipanggil saat error fatal
    - `opts.onStateChange(state)` — callback, `'idle' | 'listening' | 'paused'`

- [ ] **Step 1: Write the module file**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const SpeechRecognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const MAX_RESTARTS = 50;

  function isSupported() {
    return !!SpeechRecognition;
  }

  function create(opts) {
    if (!isSupported()) {
      throw new Error("SpeechRecognition tidak didukung di browser ini");
    }

    var lang = opts.lang || "id-ID";
    var onInterim = opts.onInterim || function () {};
    var onFinal = opts.onFinal || function () {};
    var onError = opts.onError || function () {};
    var onStateChange = opts.onStateChange || function () {};

    var userStopped = false;
    var recognition = null;
    var restartCount = 0;
    var currentState = "idle";

    function setState(state) {
      if (currentState !== state) {
        currentState = state;
        onStateChange(state);
      }
    }

    function createRecognition() {
      if (userStopped) return;

      try {
        recognition = new SpeechRecognition();
      } catch (e) {
        onError("Browser tidak mendukung SpeechRecognition");
        setState("idle");
        return;
      }

      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onresult = function (event) {
        restartCount = 0; // reset counter on successful result
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var result = event.results[i];
          var transcript = result[0].transcript;
          if (result.isFinal) {
            onFinal(transcript);
          } else {
            onInterim(transcript);
          }
        }
      };

      recognition.onend = function () {
        if (!userStopped) {
          restartCount++;
          if (restartCount > MAX_RESTARTS) {
            setState("idle");
            onError("Sesi terlalu lama. Silakan mulai ulang.");
            return;
          }
          setState("paused");
          setTimeout(function () {
            if (!userStopped) createRecognition();
          }, 100);
        } else {
          setState("idle");
        }
      };

      recognition.onerror = function (event) {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          userStopped = true;
          setState("idle");
          onError("Mikrofon tidak diizinkan. Buka pengaturan browser.");
          return;
        }
        if (event.error === "no-speech") {
          // Normal saat silence, biarkan onend handle restart
          return;
        }
        // Network / audio-capture / aborted → retry
        if (!userStopped) {
          setState("paused");
          setTimeout(function () {
            if (!userStopped) createRecognition();
          }, 300);
        }
      };

      recognition.start();
      setState("listening");
    }

    function start() {
      userStopped = false;
      restartCount = 0;
      createRecognition();
    }

    function stop() {
      userStopped = true;
      if (recognition) {
        try { recognition.stop(); } catch (e) { /* already stopped */ }
        recognition = null;
      }
      setState("idle");
    }

    function getState() {
      return currentState;
    }

    return { start: start, stop: stop, getState: getState };
  }

  var exported = { isSupported: isSupported, create: create };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.voicedictate = exported; }
  return exported;
});
```

- [ ] **Step 2: Verify syntax**

```bash
node -e "require('./static/offline/voicedictate.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add static/offline/voicedictate.js
git commit -m "feat(voice): add voicedictate.js — Web Speech API wrapper with auto-restart"
```

---

### Task 2: Add script tag and CSS to index.html

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: `window.TF.voicedictate` (from Task 1)
- Produces: Loaded module + CSS animation classes for mic button

- [ ] **Step 1: Add script tag**

Insert after line 1474 (`<script src="/static/review/digest.js"></script>`):

```html
  <script src="/static/offline/voicedictate.js"></script>
```

- [ ] **Step 2: Add CSS before `</style>`**

Insert before line 1399 (`</style>`):

```css
    /* Voice dictation mic button */
    @keyframes micPulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
      50%      { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
    }
    .note-mic-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      padding: 0 9px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s;
      font-family: inherit;
      flex-shrink: 0;
    }
    .note-mic-btn:hover {
      background: var(--bg-primary);
      border-color: var(--accent);
      color: var(--text-primary);
    }
    .note-mic-btn.listening {
      color: #ef4444;
      border-color: #ef4444;
      animation: micPulse 1.5s ease-in-out infinite;
    }
    .note-mic-btn.paused {
      color: #eab308;
      border-color: #eab308;
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(voice): add voicedictate.js script tag + mic CSS animations"
```

---

### Task 3: Add mic button to NoteToolbar

**Files:**
- Modify: `static/index.html` — function `NoteToolbar` (starts ~line 14655)

**Interfaces:**
- Consumes: `voiceState` (`'idle'|'listening'|'paused'|'unsupported'`), `onToggleVoice` (function)
- Produces: Mic button rendered di ujung toolbar

- [ ] **Step 1: Add props to NoteToolbar function signature**

**Find** (line ~14655):
```js
function NoteToolbar({
  milkdownEditorRef,
  noteId,
  onAttachUploaded,
  content,
  onApplyTemplate,
  onInsertTask
}) {
```

**Replace with:**
```js
function NoteToolbar({
  milkdownEditorRef,
  noteId,
  onAttachUploaded,
  content,
  onApplyTemplate,
  onInsertTask,
  voiceState,
  onToggleVoice
}) {
```

- [ ] **Step 2: Add mic button after attachment button**

**Find** (the attachment button ending, line ~15167):
```js
    }, "📎"));
}
```

**Replace with:**
```js
    }, "📎")), voiceState && voiceState !== 'unsupported' ? /*#__PURE__*/React.createElement("button", {
      type: "button",
      onPointerDown: function(e) { e.preventDefault(); if (onToggleVoice) onToggleVoice(); },
      className: "note-mic-btn" + (voiceState === 'listening' ? ' listening' : '') + (voiceState === 'paused' ? ' paused' : ''),
      title: voiceState === 'listening' ? 'Stop rekaman' : voiceState === 'paused' ? 'Menunggu suara...' : 'Mulai dikte suara',
      style: { marginLeft: 4 }
    }, voiceState === 'listening' ? "🔴" : voiceState === 'paused' ? "🟡" : "🎙️") : null);
}
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(voice): add mic button to NoteToolbar with 3 visual states"
```

---

### Task 4: Add voice state and handlers to NoteModal

**Files:**
- Modify: `static/index.html` — function `NoteModal` (starts ~line 15823)

**Interfaces:**
- Consumes: `TF.voicedictate` (from Task 1), NoteToolbar props (from Task 3)
- Produces: Voice state management, Milkdown text insertion, cleanup on unmount/note change

- [ ] **Step 1: Add voice state variables**

**Find** (the `textareaFullscreen` state, line ~16006):
```js
  const [textareaFullscreen, setTextareaFullscreen] = React.useState(false);
```

**Add after:**
```js
  const [voiceState, setVoiceState] = React.useState(
    window.TF && window.TF.voicedictate && window.TF.voicedictate.isSupported() ? 'idle' : 'unsupported'
  );
  const voiceRef = React.useRef(null);
  const voiceInterimRef = React.useRef(null); // track interim text node for replacement
```

- [ ] **Step 2: Add voice setup useEffect**

**Find** (the first `useEffect` or after the state declarations section — add after the `voiceState` declarations above).

Insert a new `useEffect` block after the voice state declarations:

```js
  // Voice dictation setup + cleanup
  React.useEffect(function () {
    if (!window.TF || !window.TF.voicedictate || !window.TF.voicedictate.isSupported()) return;
    var vd = window.TF.voicedictate.create({
      lang: 'id-ID',
      onInterim: function (text) {
        // Store interim text for potential commit
        voiceInterimRef.current = text;
      },
      onFinal: function (text) {
        // Clear interim tracking
        voiceInterimRef.current = null;
        // Insert final text at cursor position in Milkdown
        var editor = milkdownEditorRef.current;
        if (!editor) return;
        try {
          editor.action(function (ctx) {
            var MB = window.MilkdownBundle;
            var view = ctx.get(MB.editorViewCtx);
            var from = view.state.selection.from;
            // Insert with space prefix if not at start of line
            var before = view.state.doc.textBetween(Math.max(0, from - 1), from);
            var prefix = (from === 0 || before === '\n' || before === ' ') ? '' : ' ';
            var tr = view.state.tr.insertText(prefix + text, from, from);
            view.dispatch(tr);
          });
        } catch (e) { /* editor mungkin belum siap */ }
      },
      onError: function (msg) {
        showToast(msg);
      },
      onStateChange: function (s) {
        setVoiceState(s);
      }
    });
    voiceRef.current = vd;
    return function () {
      if (voiceRef.current) { voiceRef.current.stop(); voiceRef.current = null; }
      voiceInterimRef.current = null;
    };
  }, []); // hanya setup sekali saat mount
```

- [ ] **Step 3: Add toggleVoice handler**

**Find** a location near other handler functions (e.g., near `handleModalShare` or after the voice useEffect above):

```js
  function handleToggleVoice() {
    if (!voiceRef.current) return;
    if (voiceRef.current.getState() === 'listening' || voiceRef.current.getState() === 'paused') {
      // Commit any pending interim text before stopping
      if (voiceInterimRef.current) {
        var editor = milkdownEditorRef.current;
        if (editor) {
          try {
            var pendingText = voiceInterimRef.current;
            voiceInterimRef.current = null;
            editor.action(function (ctx) {
              var MB = window.MilkdownBundle;
              var view = ctx.get(MB.editorViewCtx);
              var from = view.state.selection.from;
              var before = view.state.doc.textBetween(Math.max(0, from - 1), from);
              var prefix = (from === 0 || before === '\n' || before === ' ') ? '' : ' ';
              var tr = view.state.tr.insertText(prefix + pendingText, from, from);
              view.dispatch(tr);
            });
          } catch (e) { /* ignore */ }
        }
      }
      voiceRef.current.stop();
    } else {
      voiceRef.current.start();
    }
  }
```

- [ ] **Step 4: Wire props to NoteToolbar call**

**Find** the NoteToolbar call inside NoteModal (line ~16708):
```js
  }, /*#__PURE__*/React.createElement(NoteToolbar, {
    milkdownEditorRef: milkdownEditorRef,
    noteId: savedNoteId,
    onAttachUploaded: att => setAttachments(prev => [...prev, att]),
    content: content,
    onApplyTemplate: tpl => setContent(tpl),
    onInsertTask: openTaskDropdown
  })), /*#__PURE__*/React.createElement("div", {
```

**Replace with:**
```js
  }, /*#__PURE__*/React.createElement(NoteToolbar, {
    milkdownEditorRef: milkdownEditorRef,
    noteId: savedNoteId,
    onAttachUploaded: function(att) { return setAttachments(function(prev) { return prev.concat([att]); }); },
    content: content,
    onApplyTemplate: function(tpl) { return setContent(tpl); },
    onInsertTask: openTaskDropdown,
    voiceState: voiceState,
    onToggleVoice: handleToggleVoice
  })), /*#__PURE__*/React.createElement("div", {
```

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat(voice): add voice state, handlers, and Milkdown integration to NoteModal"
```

---

### Task 5: Wire voice props at remaining NoteToolbar call sites

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Consumes: NoteToolbar updated signature (from Task 3)

There are 3 total call sites. Task 4 handled `NoteModal`. This task handles the other 2:
1. `NoteTaskFormModal` (line ~5127) — the "buat baru" note form
2. `NotePanelContent` (line ~17485) — the tab viewer readonly panel

- [ ] **Step 1: Wire at NoteTaskFormModal (~line 5127)**

**Find:**
```js
    }, /*#__PURE__*/React.createElement(NoteToolbar, {
      milkdownEditorRef: noteMilkdownRef,
      noteId: null,
      onAttachUploaded: () => {},
      content: noteForm.content,
      onApplyTemplate: tpl => setNote("content", tpl),
      onInsertTask: openNoteTaskDropdown
    })), /*#__PURE__*/React.createElement("div", {
```

**Replace with:**
```js
    }, /*#__PURE__*/React.createElement(NoteToolbar, {
      milkdownEditorRef: noteMilkdownRef,
      noteId: null,
      onAttachUploaded: function() {},
      content: noteForm.content,
      onApplyTemplate: function(tpl) { return setNote("content", tpl); },
      onInsertTask: openNoteTaskDropdown,
      voiceState: 'unsupported',
      onToggleVoice: null
    })), /*#__PURE__*/React.createElement("div", {
```

> Catatan: `NoteTaskFormModal` adalah form buat note baru tanpa `savedNoteId`. Voice dictation butuh note ID untuk save. Pass `'unsupported'` agar mic tidak muncul di form ini. Kalau nanti ingin support, bisa ditambah state serupa seperti Task 4.

- [ ] **Step 2: Wire at NotePanelContent (~line 17485)**

**Find:**
```js
  }, /*#__PURE__*/React.createElement(NoteToolbar, {
    milkdownEditorRef: milkdownEditorRef,
    noteId: savedNoteId,
    onAttachUploaded: att => setAttachments(prev => [...prev, att]),
    content: content,
    onApplyTemplate: tpl => setContent(tpl),
    onInsertTask: openTaskDropdown
  }), /*#__PURE__*/React.createElement("button", {
```

**Replace with:**
```js
  }, /*#__PURE__*/React.createElement(NoteToolbar, {
    milkdownEditorRef: milkdownEditorRef,
    noteId: savedNoteId,
    onAttachUploaded: function(att) { return setAttachments(function(prev) { return prev.concat([att]); }); },
    content: content,
    onApplyTemplate: function(tpl) { return setContent(tpl); },
    onInsertTask: openTaskDropdown,
    voiceState: 'unsupported',
    onToggleVoice: null
  }), /*#__PURE__*/React.createElement("button", {
```

> Catatan: `NotePanelContent` adalah panel read-only di tab viewer. Voice dictation tidak aktif di sini karena ini view-only. Pass `'unsupported'` agar mic tidak muncul.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(voice): wire voiceState prop at remaining NoteToolbar call sites"
```

---

### Task 6: Add Tauri microphone permission

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add permission**

**Find** (line 6):
```json
  "permissions": ["core:default", "opener:allow-open-url"]
```

**Replace with:**
```json
  "permissions": ["core:default", "opener:allow-open-url", "audio:allow-microphone"]
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat(voice): add audio:allow-microphone Tauri capability for native apps"
```

---

### Task 7: Verification checklist

**Files:**
- No code changes — manual verification

- [ ] **Step 1: Verify browser detection**

Buka app di Chrome desktop/Android. Buka note → toolbar harus menampilkan tombol mic 🎙️ di ujung kanan.

Buka di Firefox. Tombol mic **tidak muncul**.

- [ ] **Step 2: Verify dictation flow**

1. Klik tombol mic → harus berubah jadi 🔴 (listening) dengan animasi pulse
2. Bicara dalam Bahasa Indonesia → teks muncul di editor
3. Diam 10-30 detik → tombol berubah jadi 🟡 (paused), lalu otomatis kembali ke 🔴 saat ada suara
4. Klik tombol lagi → berhenti, tombol kembali ke 🎙️

- [ ] **Step 3: Verify cleanup**

1. Start recording → close modal → recording harus stop (tidak lanjut di background)
2. Start recording di satu note → pindah ke note lain → recording harus stop
3. Permission mic ditolak (block via browser settings) → toast "Mikrofon tidak diizinkan"

- [ ] **Step 4: Verify SW cache version bump (if needed)**

SW cache versi harus di-bump agar `voicedictate.js` ter-cache. Cek `static/sw.js` line ~2 untuk `CACHE_NAME` atau `VERSION`. Jika belum di-bump setelah perubahan ini, bump versinya.

```js
// di static/sw.js, cari dan update:
const CACHE_NAME = 'taskflow-v185'; // bump dari versi sebelumnya
```

---

## Spec Coverage Self-Review

| Requirement | Task |
|---|---|
| Web Speech API `id-ID` wrapper | Task 1 (`voicedictate.js`) |
| Auto-restart loop saat silence | Task 1 (`recognition.onend` → `setTimeout(createRecognition)`) |
| Tombol mic di NoteToolbar | Task 3 (mic button JSX) |
| 3 state visual (idle/listening/paused) | Task 2 (CSS) + Task 3 (className dinamis) |
| Animasi pulse saat listening | Task 2 (`@keyframes micPulse`) |
| Teks interim → final via Milkdown | Task 4 (`onInterim` + `onFinal` callbacks) |
| Indikator durasi | OUT OF SCOPE iterasi ini (future enhancement) |
| Permission handling | Task 1 (`onerror` → `not-allowed`) + Task 7 (manual test) |
| Cleanup saat modal close | Task 4 (`useEffect` return cleanup) |
| Cleanup saat pindah note | Task 4 (`useEffect` return cleanup) |
| Max restart counter (50) | Task 1 (`MAX_RESTARTS` constant) |
| Tauri microphone permission | Task 6 (`audio:allow-microphone`) |
| Browser tidak support → tombol tidak muncul | Task 4 (`isSupported()` check → `'unsupported'`) |
| `visibilitychange` handler (tab background) | OUT OF SCOPE iterasi ini (bisa ditambah nanti) |
| SW cache version bump | Task 7 Step 4 |

No TBDs, no placeholders, no ambiguous requirements.
