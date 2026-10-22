;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.whatsnew = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  // Logika murni modal "Apa yang baru" (spec docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md §3.5).
  // Tanpa akses DOM/jaringan sendiri: storage dan fetch dilewatkan pemanggil supaya bisa dites di Node.
  const SEEN_KEY = "tf_whatsnew_seen";
  const WHATSNEW_URL = "/static/whatsnew.json";
  const DEFAULT_LIMIT = 10;
  const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);

  // Nomor dari versi SW, mis. "taskflow-v466-apa-yang-baru" -> 466. Selain itu null.
  function versionNumber(v) {
    if (typeof v !== "string") return null;
    const m = /^taskflow-v(\d+)/.exec(v);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isSafeInteger(n) ? n : null;
  }

  function points(raw) {
    return Array.isArray(raw) ? raw.filter((p) => typeof p === "string" && p.trim() !== "") : [];
  }

  // Bentuk seragam untuk semua entri; yang rusak dibuang (tidak pernah melempar).
  function normalizeEntries(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const e of raw) {
      if (!e || typeof e !== "object") continue;
      if (versionNumber(e.version) === null) continue;
      out.push({
        version: e.version,
        date: typeof e.date === "string" ? e.date : "",
        title: typeof e.title === "string" ? e.title : "",
        new: points(e.new),
        fixed: points(e.fixed),
        silent: e.silent === true,
      });
    }
    return out;
  }

  // Entri yang boleh tampil: bukan silent dan punya minimal satu poin.
  function isVisible(e) {
    return !e.silent && e.new.length + e.fixed.length > 0;
  }

  // Entri tampil (sudah dinormalkan) dengan nomor lolos `inRange`, urut menurun menurut nomor.
  function visibleSorted(entries, inRange) {
    const list = [];
    for (const e of normalizeEntries(entries)) {
      const n = versionNumber(e.version);
      if (isVisible(e) && inRange(n)) list.push({ e, n });
    }
    list.sort((a, b) => b.n - a.n);
    return list.map((x) => x.e);
  }

  function validLimit(limit) {
    return Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_LIMIT;
  }

  // Catatan yang belum dilihat pengguna, atau kosong. Rilis yang terlewat digabung (menurun, paling baru dulu).
  // seen kosong/rusak: pengguna lama (hadUser) hanya melihat rilis sekarang; perangkat baru tidak melihat apa pun.
  function pickUnseen({ entries, current, seen, hadUser, limit = DEFAULT_LIMIT } = {}) {
    const cur = versionNumber(current);
    if (cur === null) return { entries: [], hiddenCount: 0 };
    const seenNum = versionNumber(seen);
    let list;
    if (seenNum === null) {
      if (!hadUser) return { entries: [], hiddenCount: 0 };
      list = visibleSorted(entries, (n) => n === cur);
    } else {
      list = visibleSorted(entries, (n) => seenNum < n && n <= cur);
    }
    const max = validLimit(limit);
    return { entries: list.slice(0, max), hiddenCount: Math.max(0, list.length - max) };
  }

  // Riwayat untuk Pengaturan: entri tampil dengan nomor <= versi berjalan, paling baru dulu.
  function history({ entries, current, limit = DEFAULT_LIMIT } = {}) {
    const cur = versionNumber(current);
    if (cur === null) return [];
    return visibleSorted(entries, (n) => n <= cur).slice(0, validLimit(limit));
  }

  // Penanda tidak pernah diturunkan: rollback tidak membuat modal yang sama muncul dua kali.
  // Versi berjalan tak terbaca -> jangan menulis penanda.
  function shouldMarkSeen(seen, current) {
    const cur = versionNumber(current);
    if (cur === null) return false;
    const seenNum = versionNumber(seen);
    return seenNum === null || seenNum < cur;
  }

  // "2026-10-23" -> "23 Okt 2026"; tanggal tidak ada (mis. 2026-02-30) atau bukan YYYY-MM-DD -> "".
  function formatDate(iso) {
    const m = typeof iso === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
    if (!m) return "";
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const probe = new Date(0);
    probe.setUTCFullYear(y, mo - 1, d);
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return "";
    return d + " " + MONTHS[mo - 1] + " " + y;
  }

  // Entri ternormalkan, atau null bila gagal (jaringan, non-ok, bentuk salah). Pemanggil tidak mengubah penanda saat null.
  async function load(fetchFn) {
    try {
      const res = await fetchFn(WHATSNEW_URL, { cache: "no-cache" });
      if (!res || !res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.entries)) return null;
      return normalizeEntries(data.entries);
    } catch (_) {
      return null;
    }
  }

  function readSeen(storage) {
    try {
      const v = storage.getItem(SEEN_KEY);
      return typeof v === "string" && v ? v : null;
    } catch (_) {
      return null;
    }
  }

  function writeSeen(storage, version) {
    try {
      storage.setItem(SEEN_KEY, String(version));
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    SEEN_KEY,
    URL: WHATSNEW_URL,
    versionNumber,
    normalizeEntries,
    pickUnseen,
    history,
    shouldMarkSeen,
    formatDate,
    load,
    readSeen,
    writeSeen,
  };
});
