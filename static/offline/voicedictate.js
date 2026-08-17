;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { voicedictate: factory(root) };
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const SpeechRecognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const MAX_RESTARTS = 50;

  // ── Native Android bridge (Tauri APK) ────────────────────────────
  // Web Speech API sudah mati di Android (layanan Google ditutup). Di APK,
  // dikte memakai SpeechRecognizer native via file-bridge speech_cmd.json /
  // speech_events (pola pending_share). Deteksi: Tauri + userAgent Android.
  function isTauri() {
    var T = root.__TAURI__;
    return !!(T && T.core && typeof T.core.invoke === "function");
  }

  function isAndroid() {
    return !!(root.navigator && /android/i.test(root.navigator.userAgent));
  }

  function isNativeBridgeAvailable() {
    return isTauri() && isAndroid();
  }

  function isSupported() {
    return !!SpeechRecognition || isNativeBridgeAvailable();
  }

  function create(opts) {
    if (!isSupported()) {
      throw new Error("SpeechRecognition tidak didukung di browser ini");
    }
    if (isNativeBridgeAvailable()) {
      return createNativeAndroid(opts);
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
          }, 50);
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

  // Pure: parse baris-baris JSON dari file speech_events → array event.
  // Baris korup / tanpa `type` dilewati. Di-export untuk unit test.
  function parseSpeechEvents(raw) {
    if (!raw) return [];
    var events = [];
    var lines = String(raw).split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var obj = JSON.parse(line);
        if (obj && obj.type) events.push(obj);
      } catch (e) { /* baris korup — lewati */ }
    }
    return events;
  }

  // Pure: rencanakan aksi insert untuk satu potong teks dikte.
  // prev = full text utterance terakhir yang sudah di-insert;
  // text = full text utterance saat ini (partial/final hasil recognizer).
  // Kasus:
  //   skip    — teks sama dengan prev (event ganda) atau kosong
  //   append  — text adalah perpanjangan prev → cukup sisipkan delta
  //             TANPA spasi prefix (delta = lanjutan kata yang sama)
  //   replace — recognizer merevisi hipotesis (text bukan perpanjangan
  //             prev) → segmen yang sudah ter-insert harus DIGANTI,
  //             bukan diduplikasi
  //   insert  — utterance baru (prev kosong/ter-reset) → insert utuh
  function planInsert(prev, text) {
    if (!text) return { kind: "skip" };
    if (text === prev) return { kind: "skip" };
    if (prev && text.length > prev.length && text.slice(0, prev.length) === prev) {
      return { kind: "append", delta: text.slice(prev.length) };
    }
    if (prev) return { kind: "replace", text: text };
    return { kind: "insert", text: text };
  }

  // Pure: dispatch event → handler. "waiting" dipetakan ke "paused" agar
  // tombol tetap menampilkan state menunggu (konsisten dgn UI lama).
  // Return jumlah event yang diproses (0 = tidak ada event baru).
  function dispatchEvents(raw, handlers) {
    var events = parseSpeechEvents(raw);
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      switch (ev.type) {
        case "state":
          handlers.onState(ev.state === "waiting" ? "paused" : ev.state);
          break;
        case "partial":
          if (ev.text) handlers.onText(ev.text, false);
          break;
        case "final":
          if (ev.text) handlers.onText(ev.text, true);
          break;
        case "error":
          handlers.onError(ev.message || "");
          break;
        case "end":
          handlers.onState("paused");
          break;
      }
    }
    return events.length;
  }

  function createNativeAndroid(opts) {
    var lang = opts.lang || "id-ID";
    var onInterim = opts.onInterim || function () {};
    var onFinal = opts.onFinal || function () {};
    var onError = opts.onError || function () {};
    var onStateChange = opts.onStateChange || function () {};

    var currentState = "idle";
    var pollTimer = null;
    var silentCycles = 0;
    var gotAnyEvent = false;
    var diagnosticFired = false;
    var silentLimit = opts.silentLimit || 20; // ~6 detik tanpa event saat listening → diagnostik path
    var pollIntervalMs = opts.pollIntervalMs || 300;

    function setState(state) {
      if (currentState !== state) {
        currentState = state;
        onStateChange(state);
      }
    }

    function invoke(cmd, args) {
      return root.__TAURI__.core.invoke(cmd, args || {});
    }

    function poll() {
      invoke("read_speech_events", {}).then(function (raw) {
        if (currentState === "idle") return; // sudah di-stop
        var n = dispatchEvents(raw, {
          onState: function (s) {
            silentCycles = 0;
            setState(s);
          },
          onText: function (text, isFinal) {
            silentCycles = 0;
            if (isFinal) onFinal(text);
            else onInterim(text);
          },
          onError: function (msg) {
            silentCycles = 0;
            setState("idle");
            if (msg) onError(msg);
            if (pollTimer) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
          }
        });
        if (n > 0) gotAnyEvent = true;
        if (n === 0) {
          silentCycles++;
          // Diagnostik: kemungkinan mapping filesDir tidak cocok — tampilkan
          // lokasi yang dicek Rust (pola share_debug). Hanya fire SEKALI per
          // sesi dan hanya jika sama sekali belum ada event (pause berpikir
          // normal tidak boleh memicunya).
          if (silentCycles >= silentLimit && currentState === "listening" &&
              !gotAnyEvent && !diagnosticFired) {
            diagnosticFired = true;
            silentCycles = 0;
            invoke("speech_debug", {}).then(function (dbg) {
              onError("Dikte tidak merespons.\nLokasi yang dicek:\n\n" + dbg);
            }).catch(function () {});
          }
        }
      }).catch(function () { /* invoke transient error — poll berikutnya coba lagi */ });
    }

    function start() {
      setState("listening");
      silentCycles = 0;
      gotAnyEvent = false;
      diagnosticFired = false;
      // Buang event stale dari sesi sebelumnya (mis. app crash saat recording).
      invoke("read_speech_events", {}).catch(function () {});
      invoke("speech_cmd", { cmd: JSON.stringify({ cmd: "start", lang: lang }) }).catch(function (e) {
        setState("idle");
        onError("Gagal memulai dikte: " + String(e));
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      });
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(poll, pollIntervalMs);
    }

    function stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      invoke("speech_cmd", { cmd: JSON.stringify({ cmd: "stop" }) }).catch(function () {});
      setState("idle");
    }

    function getState() {
      return currentState;
    }

    return { start: start, stop: stop, getState: getState };
  }

  var exported = {
    isSupported: isSupported,
    create: create,
    parseSpeechEvents: parseSpeechEvents,
    dispatchEvents: dispatchEvents,
    planInsert: planInsert
  };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.voicedictate = exported; }
  return exported;
});
