
    // Service Worker & App Update Detection
    window.__APP_VERSION = "4.0.0";
    window.__SW_VERSION = "taskflow-v411-inbox-wizard-edit";
    window.__SW_REGISTRATION = null;
    window.__APP_UPDATE_AVAILABLE = false;

    function notifyAppUpdateAvailable() {
      window.__APP_UPDATE_AVAILABLE = true;
      window.dispatchEvent(new CustomEvent("appupdateavailable"));
    }

    window.applyAppUpdate = function() {
      const reg = window.__SW_REGISTRATION;
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
      } else if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
        setTimeout(() => window.location.reload(), 300);
      } else {
        window.location.reload();
      }
    };

    window.checkForAppUpdate = async function(options) {
      const isManual = Boolean(options && options.manual);
      const toastFn = window.showToast || window.__showToast;
      if (isManual && typeof toastFn === "function") {
        toastFn("Mengecek pembaruan...", "info");
      }

      let updateFound = false;
      const reg = window.__SW_REGISTRATION;

      try {
        if (reg) {
          await reg.update().catch(err => console.warn("SW update check failed:", err));
          if (reg.waiting && navigator.serviceWorker.controller) {
            updateFound = true;
          }
        }

        try {
          const res = await fetch("/api/version?t=" + Date.now(), {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && data.sw_version && data.sw_version !== window.__SW_VERSION) {
              updateFound = true;
            }
          }
        } catch (e) {
          console.warn("Fetch /api/version failed:", e);
        }

        if (updateFound || (reg && reg.waiting && navigator.serviceWorker.controller)) {
          notifyAppUpdateAvailable();
          if (isManual && typeof toastFn === "function") {
            toastFn("Pembaruan tersedia! Silakan muat ulang.", "info");
          }
        } else if (isManual && typeof toastFn === "function") {
          toastFn("Aplikasi sudah dalam versi terbaru", "success");
        }
      } catch (err) {
        console.error("Error checking for update:", err);
        if (isManual && typeof toastFn === "function") {
          toastFn("Gagal memeriksa pembaruan", "error");
        }
      }
    };

    if ("serviceWorker" in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

      const trackInstall = (reg) => {
        window.__SW_REGISTRATION = reg;
        if (reg.waiting && navigator.serviceWorker.controller) {
          notifyAppUpdateAvailable();
        }
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller && reg.waiting) {
              notifyAppUpdateAvailable();
            }
          });
        });
      };

      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" })
          .then(reg => {
            trackInstall(reg);
            reg.update().catch(() => {});
          })
          .catch(err => console.warn("SW register failed:", err));
      });

      // Visibility change: saat tab kembali aktif
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          window.checkForAppUpdate();
        }
      });

      // Auto check setiap 30 menit (1800000 ms)
      setInterval(() => {
        window.checkForAppUpdate();
      }, 1800000);
    }
  