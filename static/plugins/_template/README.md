# Templat plugin

1. Salin folder ini ke `static/plugins/<id>/` — `<id>` cocok dengan `[a-z][a-z0-9-]{2,31}` dan sama dengan
   `id` di `manifest.json`. Folder berawalan `_` tidak dibangun.
2. Isi `manifest.json` (`id`, `name`, `description`, `version` semver, `minApi`, `slots`, `permissions`
   (Fase 0a: `[]` atau `["storage"]`), `defaultEnabled`).
3. Tulis UI di `plugin.jsx` (JSX → `React.createElement`). Konstanta `manifest` disuntik saat build.
   Opsional: `style.css` (kelas berawalan `.plg-<id>-`, hanya token warna seperti `var(--accent)`).
4. `npm run compile:plugins` → menulis `plugin.js`, `static/plugins/index.json`, dan entri precache di
   `static/sw.js` (`?v=<hash>`). Commit ketiganya.

Aturan: hanya `TF.api` (`api.events`, `api.storage`, `api.data`, `api.ui`, `api.env`, `api.log`) dan React.
Tanpa modul host, penyimpanan browser langsung, atau jaringan — build gagal bila dilanggar.
Panduan lengkap: `docs/plugins/README.md`.
