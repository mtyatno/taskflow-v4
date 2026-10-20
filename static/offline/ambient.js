;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.ambient = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Suara latar kartu Pomodoro: pemetaan status timer -> aksi suara,
  // preferensi localStorage, dan pemutar (satu <audio loop> + GainNode).

  const SOUNDS = [
    { key: "off", label: "Off" },
    { key: "hujan", label: "Hujan" },
    { key: "brown-noise", label: "Brown Noise" },
    { key: "detak-jam", label: "Detak Jam" }
  ];
  const FADE_MS = 1000;
  const VOLUME_RAMP_MS = 100;
  const FADE_STEP_MS = 50;
  const SOUND_KEY = "tf_ambient_sound";
  const VOLUME_KEY = "tf_ambient_volume";
  const DEFAULT_VOLUME = 50;
  const WORK_SECONDS = 1500;

  function isSoundKey(key) {
    return SOUNDS.some((s) => s.key === key);
  }

  function clampVolume(v) {
    if (v == null || v === "") return DEFAULT_VOLUME;
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_VOLUME;
    return Math.min(100, Math.max(0, Math.round(n)));
  }

  // Work berjalan (countdown / Overtime) -> play; Work diam di 25:00 -> stop; lainnya -> pause.
  function ambientTarget(snap) {
    const s = snap || {};
    if (s.mode === "work" && s.isRunning) return "play";
    if (s.mode === "work" && (s.phase || "countdown") === "countdown" && !s.isRunning && s.timeLeft === WORK_SECONDS) return "stop";
    return "pause";
  }

  function readPrefs(storage) {
    let sound = null;
    let volume = null;
    try {
      sound = storage.getItem(SOUND_KEY);
      volume = storage.getItem(VOLUME_KEY);
    } catch (_) {
      return { sound: "off", volume: DEFAULT_VOLUME };
    }
    return { sound: isSoundKey(sound) ? sound : "off", volume: clampVolume(volume) };
  }

  function writePrefs(storage, prefs) {
    const p = prefs || {};
    try {
      if (p.sound !== undefined) storage.setItem(SOUND_KEY, isSoundKey(p.sound) ? p.sound : "off");
      if (p.volume !== undefined) storage.setItem(VOLUME_KEY, String(clampVolume(p.volume)));
    } catch (_) { /* storage penuh / diblokir: abaikan */ }
  }

  function soundUrl(key, canPlayOgg) {
    return "/static/sounds/" + key + "-v1." + (canPlayOgg ? "ogg" : "mp3");
  }

  function defaultEnv() {
    const AC = root.AudioContext || root.webkitAudioContext;
    return {
      createAudio: () => new root.Audio(),
      createAudioContext: AC ? () => new AC() : null,
      fetch: (url) => root.fetch(url),
      createObjectURL: (b) => root.URL.createObjectURL(b),
      revokeObjectURL: (u) => root.URL.revokeObjectURL(u),
      setTimeout: (fn, ms) => root.setTimeout(fn, ms),
      clearTimeout: (id) => root.clearTimeout(id),
      now: () => Date.now(),
      document: root.document || null,
      onState: null
    };
  }

  function createPlayer(envIn) {
    const env = Object.assign(defaultEnv(), envIn || {});

    let sound = "off";
    let volume = DEFAULT_VOLUME;
    let target = null;          // "play" | "pause" | "stop" | null (belum ada update)
    let disposed = false;

    let audio = null;           // satu elemen per pemutar
    let ctx = null;
    let gainNode = null;
    let gainVal = 0;

    let currentKey = null;      // key yang terpasang di audio.src
    let objectUrl = null;       // Blob URL milik audio.src
    let pending = null;         // {key, url} hasil fetch yang menunggu dipasang
    let loadingKey = null;
    let loadSeq = 0;
    let errorKey = null;

    let fadeTimer = null;
    let fadeGoal = null;
    let playPending = false;
    let sounding = false;       // play() berhasil dan sedang/menuju terdengar
    let waitingTap = false;
    let tapListener = null;

    let lastEmitted = null;

    function statusName() {
      if (sound !== "off" && loadingKey === sound) return "loading";
      if (sound !== "off" && errorKey === sound) return "error";
      if (waitingTap) return "waiting-tap";
      if (sounding) return "playing";
      return "idle";
    }

    function state() {
      return {
        state: statusName(), sound, volume, target,
        paused: audio ? !!audio.paused : true, gain: gainVal
      };
    }

    function emit() {
      if (disposed || typeof env.onState !== "function") return;
      const s = state();
      const sig = s.state + "|" + s.sound + "|" + s.volume + "|" + s.target;
      if (sig === lastEmitted) return;
      lastEmitted = sig;
      try { env.onState(s); } catch (_) { /* UI tidak boleh mematikan pemutar */ }
    }

    function ensureAudio() {
      if (audio) return audio;
      audio = env.createAudio();
      audio.loop = true;
      try { audio.preload = "auto"; } catch (_) { /* opsional */ }
      if (typeof env.createAudioContext === "function") {
        try {
          ctx = env.createAudioContext();
          const src = ctx.createMediaElementSource(audio);
          gainNode = ctx.createGain();
          src.connect(gainNode);
          gainNode.connect(ctx.destination);
        } catch (_) {
          ctx = null;
          gainNode = null;
        }
      }
      setGain(0);
      return audio;
    }

    function setGain(v) {
      gainVal = v;
      if (gainNode) gainNode.gain.value = v;
      else if (audio) audio.volume = v;
    }

    function cancelFade() {
      if (fadeTimer != null) env.clearTimeout(fadeTimer);
      fadeTimer = null;
      fadeGoal = null;
    }

    // Fade bertahap ke `goal`; fade baru membatalkan yang lama. Fade ke 0 diakhiri settle().
    function fadeTo(goal, ms) {
      if (fadeTimer != null && fadeGoal === goal) return;
      cancelFade();
      if (gainVal === goal) {
        if (goal === 0) settle();
        return;
      }
      const from = gainVal;
      const t0 = env.now();
      const interval = ms / Math.max(1, Math.round(ms / FADE_STEP_MS));
      fadeGoal = goal;
      const step = () => {
        const k = Math.min(1, Math.max(0, (env.now() - t0) / ms));
        setGain(k >= 1 ? goal : from + (goal - from) * k);
        if (k >= 1) {
          fadeTimer = null;
          fadeGoal = null;
          if (goal === 0) settle();
        } else {
          fadeTimer = env.setTimeout(step, interval);
        }
      };
      fadeTimer = env.setTimeout(step, interval);
    }

    // Setelah hening: pause (posisi tetap), reset bila stop, pasang sumber baru bila ada.
    function settle() {
      if (disposed || !audio) return;
      sounding = false;
      if (!audio.paused) audio.pause();
      if (target === "stop") resetPosition();
      if (pending) swapSource();
      apply();
      emit();
    }

    function resetPosition() {
      try { audio.currentTime = 0; } catch (_) { /* belum ada metadata */ }
    }

    function swapSource() {
      if (objectUrl) env.revokeObjectURL(objectUrl);
      objectUrl = pending.url;
      currentKey = pending.key;
      pending = null;
      setGain(0);
      audio.src = objectUrl;
    }

    function ctxSuspended() {
      return !!(ctx && ctx.state === "suspended");
    }

    // Tanpa gesture, resume() bisa tidak pernah selesai; dengan gesture (force) selalu dicoba.
    function resumeCtx(force) {
      if (!ctx || typeof ctx.resume !== "function") return;
      if (!force && !ctxSuspended()) return;
      try {
        const r = ctx.resume();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch (_) { /* abaikan */ }
    }

    function wantsPlay() {
      return target === "play" && sound !== "off" && volume > 0;
    }

    function removeTap() {
      if (tapListener && env.document) env.document.removeEventListener("pointerdown", tapListener, true);
      tapListener = null;
      waitingTap = false;
    }

    function waitForTap() {
      waitingTap = true;
      if (!tapListener && env.document) {
        tapListener = onGesture;
        env.document.addEventListener("pointerdown", tapListener, { capture: true, once: true });
      }
    }

    function onGesture() {
      tapListener = null;
      if (disposed) return;
      resumeCtx(true);
      waitingTap = false;
      apply(true);
      emit();
    }

    function tryPlay() {
      if (playPending) return;
      playPending = true;
      setGain(0);
      resumeCtx();
      let p;
      try { p = audio.play(); } catch (e) { p = Promise.reject(e); }
      Promise.resolve(p).then(() => {
        playPending = false;
        if (disposed) return;
        if (!wantsPlay() || currentKey !== sound || pending) {
          // Status berubah selagi play() berjalan: diamkan lagi.
          settle();
          emit();
          return;
        }
        if (ctxSuspended()) { waitForTap(); emit(); return; }
        sounding = true;
        fadeTo(volume / 100, FADE_MS);
        emit();
      }, (err) => {
        playPending = false;
        if (disposed) return;
        const name = err && err.name;
        if (name === "NotAllowedError") {
          if (wantsPlay()) waitForTap();
        } else if (name !== "AbortError") {
          errorKey = currentKey;
        }
        if (name === "AbortError") apply();
        emit();
      });
    }

    // Menyelaraskan audio dengan sound/target/volume saat ini.
    function apply(fromGesture) {
      if (disposed) return;
      if (sound === "off") {
        cancelFade();
        removeTap();
        sounding = false;
        if (audio && !audio.paused) audio.pause();
        setGain(0);
        return;
      }
      if (!audio) return;
      if (currentKey !== sound || pending) {
        // Sumber yang benar belum terpasang: hening dulu (settle memasang sumber baru).
        removeTap();
        if (!audio.paused && !playPending) { sounding = false; fadeTo(0, FADE_MS); }
        else if (audio.paused && pending) swapSource();
        if (currentKey !== sound) return;
      }
      if (errorKey === sound) return;
      if (wantsPlay()) {
        if (waitingTap && !fromGesture) return;
        if (audio.paused) {
          if (!playPending) tryPlay();
        } else if (!playPending) {
          if (ctxSuspended() && !fromGesture) { waitForTap(); return; }
          sounding = true;
          fadeTo(volume / 100, FADE_MS);
        }
        return;
      }
      removeTap();
      if (!audio.paused) {
        if (playPending) return; // diselesaikan oleh tryPlay
        sounding = false;
        fadeTo(0, FADE_MS);
      } else {
        cancelFade();
        sounding = false;
        if (target === "stop") resetPosition();
      }
    }

    function load(key) {
      if (disposed) return;
      if (loadingKey === key) return;
      if (pending && pending.key === key) return;
      if (currentKey === key && !pending) return;
      const a = ensureAudio();
      const seq = ++loadSeq;
      loadingKey = key;
      errorKey = null;
      const ogg = typeof a.canPlayType === "function" && a.canPlayType('audio/ogg; codecs="vorbis"') !== "";
      let req;
      try { req = Promise.resolve(env.fetch(soundUrl(key, ogg))); } catch (e) { req = Promise.reject(e); }
      req.then((r) => {
        if (!r || !r.ok) throw new Error("HTTP " + (r && r.status));
        return r.blob();
      }).then((blob) => {
        if (disposed || seq !== loadSeq) return;
        loadingKey = null;
        if (pending) env.revokeObjectURL(pending.url);
        pending = { key, url: env.createObjectURL(blob) };
        apply();
        emit();
      }).catch(() => {
        if (disposed || seq !== loadSeq) return;
        loadingKey = null;
        errorKey = key;
        apply();
        emit();
      });
    }

    function needsLoad() {
      return sound !== "off" && currentKey !== sound && loadingKey !== sound && !(pending && pending.key === sound);
    }

    function setSound(key, opts) {
      if (disposed) return;
      const preload = !(opts && opts.preload === false);
      const next = isSoundKey(key) ? key : "off";
      if (next !== sound) removeTap();
      sound = next;
      if (sound === "off") {
        loadSeq++;
        loadingKey = null;
        errorKey = null;
      } else if (loadingKey && loadingKey !== sound) {
        loadSeq++;          // hasil fetch lama diabaikan
        loadingKey = null;
      }
      if (needsLoad() && (preload || wantsPlay())) load(sound);
      apply();
      emit();
    }

    function setVolume(v) {
      if (disposed) return;
      volume = clampVolume(v);
      if (audio && sounding && !audio.paused && !waitingTap) {
        if (volume === 0) { sounding = false; fadeTo(0, VOLUME_RAMP_MS); }
        else fadeTo(volume / 100, VOLUME_RAMP_MS);
      } else {
        if (needsLoad() && wantsPlay() && errorKey !== sound) load(sound);
        apply();
      }
      emit();
    }

    function update(snap) {
      if (disposed) return;
      const next = ambientTarget(snap);
      if (next === target) return;
      target = next;
      if (target === "play" && sound !== "off" && volume > 0 && (needsLoad() || errorKey === sound)) {
        errorKey = null;
        load(sound);
      }
      apply();
      emit();
    }

    function dispose() {
      if (disposed) return;
      cancelFade();
      removeTap();
      loadSeq++;
      disposed = true;
      if (audio) {
        try { if (!audio.paused) audio.pause(); } catch (_) { /* abaikan */ }
        try { audio.removeAttribute ? audio.removeAttribute("src") : (audio.src = ""); } catch (_) { /* abaikan */ }
      }
      if (objectUrl) env.revokeObjectURL(objectUrl);
      if (pending) env.revokeObjectURL(pending.url);
      objectUrl = null;
      pending = null;
      if (ctx && typeof ctx.close === "function") {
        try { const c = ctx.close(); if (c && c.catch) c.catch(() => {}); } catch (_) { /* abaikan */ }
      }
    }

    return {
      setSound, setVolume, update, state, dispose
    };
  }

  return { SOUNDS, FADE_MS, SOUND_KEY, VOLUME_KEY, ambientTarget, readPrefs, writePrefs, soundUrl, createPlayer };
});
