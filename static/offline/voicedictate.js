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

  var exported = { isSupported: isSupported, create: create };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.voicedictate = exported; }
  return exported;
});
