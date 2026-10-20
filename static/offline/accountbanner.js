;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.accountbanner = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Banner pengingat akun (fase 0a): akun Telegram yang belum diatur, atau akun tanpa email.
  const DISMISS_KEY = "tf_email_banner_dismissed_until";
  const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/; // sama dengan EMAIL_RE di webapp.py
  const USERNAME_RE = /^[A-Za-z0-9_]{3,50}$/; // sama dengan USERNAME_RE (fullmatch) di webapp.py

  function dismissUntil(now) {
    return now + DISMISS_MS;
  }

  // null | "incomplete" | "no_email". password_set undefined (respons login) = dianggap sudah diatur;
  // field email tidak ada (user dari payload token saat offline) = tidak diketahui → tidak ditampilkan.
  function decide(opts) {
    const o = opts || {};
    const user = o.user;
    if (!user) return null;
    const until = Number(o.dismissedUntil);
    if (o.dismissedUntil != null && Number.isFinite(until) && until > o.now) return null;
    if (user.password_set === false) return "incomplete";
    if (Object.prototype.hasOwnProperty.call(user, "email")) {
      const e = user.email;
      if (e == null || String(e).trim() === "") return "no_email";
    }
    return null;
  }

  function usernameError(name) {
    const u = String(name == null ? "" : name);
    if (!USERNAME_RE.test(u)) return "Username hanya boleh huruf, angka, dan _ (3–50 karakter)";
    if (u.toLowerCase().startsWith("tg_")) return "Username tidak boleh diawali tg_";
    return null;
  }

  // Validasi form "Lengkapi akun" sebelum POST /api/auth/complete-account → pesan error | null
  function validateCompleteAccount(f) {
    const v = f || {};
    const un = String(v.username || "").trim();
    if (un) {
      const err = usernameError(un);
      if (err) return err;
    }
    const email = String(v.email || "").trim();
    if (!email) return "Email wajib diisi";
    if (!EMAIL_RE.test(email)) return "Format email tidak valid";
    const pw = String(v.password || "");
    if (pw.length < 4) return "Password minimal 4 karakter";
    if (pw !== String(v.confirm || "")) return "Password baru tidak cocok";
    return null;
  }

  return { DISMISS_KEY, DISMISS_MS, dismissUntil, decide, usernameError, validateCompleteAccount };
});
