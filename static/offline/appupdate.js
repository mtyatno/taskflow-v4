;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.appupdate = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Alur banner "Pembaruan Alurik tersedia" (spec docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md §3.1).
  // Di halaman terkendali banner hanya datang dari SW menunggu; selisih /api/version hanya memicu reg.update().
  // Dependensi (navigator.serviceWorker, fetch, reload, setTimeout, toast) disuntikkan supaya bisa dites di Node.
  const APPLY_FALLBACK_MS = 5000;

  const TEXT = Object.freeze({
    checking: "Mengecek pembaruan...",
    ready: "Pembaruan tersedia! Silakan muat ulang.",
    downloading: "Mengunduh pembaruan…",
    failed: "Pembaruan gagal diunduh, coba lagi saat koneksi stabil.",
    latest: "Aplikasi sudah dalam versi terbaru",
    checkFailed: "Gagal memeriksa pembaruan",
  });

  const TOAST_TYPE = Object.freeze({
    checking: "info",
    ready: "info",
    downloading: "info",
    failed: "error",
    latest: "success",
    checkFailed: "error",
  });

  function createAppUpdater({ sw, getRegistration, fetch: fetchFn, reload, setTimeout: setTimer, toast, pageVersion, onReady }) {
    const watched = new WeakSet();
    // Worker yang hasil install-nya ditunggu pengecekan manual ("Mengunduh pembaruan…" sudah tampil).
    const announced = new WeakSet();

    const controlled = () => !!(sw && sw.controller);

    function ready() {
      if (typeof onReady === "function") onReady();
    }

    // Hanya dipanggil di jalur manual; pengecekan otomatis tidak pernah menampilkan toast.
    function say(key) {
      if (typeof toast !== "function") return;
      try {
        toast(TEXT[key], TOAST_TYPE[key]);
      } catch (_) {
        // toast bukan bagian penting alur pembaruan
      }
    }

    function watch(worker) {
      if (!worker || watched.has(worker)) return;
      watched.add(worker);
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          if (controlled()) ready();
          if (announced.delete(worker)) say("ready");
        } else if (worker.state === "redundant") {
          // Install atomik gagal (ADR-029): SW lama + cache lengkap tetap dipakai.
          if (announced.delete(worker)) say("failed");
        }
      });
    }

    function track(reg) {
      if (!reg) return;
      if (reg.waiting && controlled()) ready();
      // Celah C: worker yang sudah installing saat dilacak juga didengarkan.
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
    }

    // sw_version dari server, atau null bila gagal/tidak ada (offline, 500 "SW version unavailable").
    async function serverVersion() {
      try {
        const res = await fetchFn("/api/version?t=" + Date.now(), {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!res || !res.ok) return null;
        const data = await res.json();
        return data && typeof data.sw_version === "string" && data.sw_version ? data.sw_version : null;
      } catch (_) {
        return null;
      }
    }

    async function checkAuto(reg) {
      if (reg.waiting) {
        ready(); // banner yang ditutup muncul lagi
        return;
      }
      if (reg.installing) {
        watch(reg.installing); // hasilnya datang lewat statechange
        return;
      }
      const version = await serverVersion();
      if (!version || version === pageVersion) return;
      try {
        await reg.update();
      } catch (_) {
        return; // offline: diam
      }
      watch(reg.installing);
    }

    async function checkManual(reg) {
      try {
        await reg.update();
      } catch (_) {
        say("checkFailed");
        return;
      }
      if (reg.waiting) {
        ready();
        say("ready");
      } else if (reg.installing) {
        announced.add(reg.installing);
        watch(reg.installing);
        say("downloading");
      } else {
        say("latest");
      }
    }

    // Registration langsung dari navigator.serviceWorker (dipakai pengecekan manual sebelum register() selesai).
    async function swRegistration() {
      if (!sw || typeof sw.getRegistration !== "function") return null;
      try {
        return (await sw.getRegistration()) || null;
      } catch (_) {
        return null;
      }
    }

    // check({ manual }) — tidak pernah menolak.
    async function check(options) {
      const manual = !!(options && options.manual);
      try {
        if (manual) say("checking");
        let reg = getRegistration();
        if (controlled()) {
          // Selisih versi tidak pernah memunculkan banner langsung di halaman terkendali, juga saat
          // registration belum diketahui (mis. visibilitychange sebelum register() selesai).
          if (!reg && manual) reg = await swRegistration();
          if (!reg) {
            if (manual) say("checkFailed");
            return;
          }
          await (manual ? checkManual(reg) : checkAuto(reg));
          return;
        }
        // Tidak terkendali (tanpa SW, pendaftaran gagal, hard reload): selisih versi server → siap.
        const version = await serverVersion();
        if (version && version !== pageVersion) {
          ready();
          if (manual) say("ready");
        } else if (manual) {
          say("latest");
        }
      } catch (_) {
        if (manual) say("checkFailed");
      }
    }

    function apply() {
      const reg = getRegistration();
      const waiting = reg && reg.waiting;
      if (!waiting) {
        reload();
        return;
      }
      const controllerBefore = sw ? sw.controller : null;
      waiting.postMessage({ type: "SKIP_WAITING" });
      // controllerchange (skrip inline, penjaga refreshing) memuat ulang saat SW baru mengambil alih.
      // Pengaman: bila pengendali belum berganti dalam 5 detik, muat ulang sendiri.
      setTimer(() => {
        if (!sw || sw.controller === controllerBefore) reload();
      }, APPLY_FALLBACK_MS);
    }

    return { track, check, apply };
  }

  return {
    APPLY_FALLBACK_MS,
    TEXT,
    createAppUpdater,
  };
});
