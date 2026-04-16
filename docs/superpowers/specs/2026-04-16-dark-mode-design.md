# Dark Mode — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Context

TaskFlow V4 saat ini hanya memiliki light theme (Cloud Dancer + Sunny Lime). User ingin dark mode sebagai pilihan, dengan toggle yang mudah diakses di top bar.

---

## Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Palette | Charcoal Dark |
| Toggle style | Toggle Switch (☀️/🌙) |
| Lokasi toggle | Top bar kanan, sebelum tombol "+ Tambah Task" |
| Persistensi | `localStorage` key `tf_theme` |

---

## Palette Charcoal Dark

| Variable | Light | Dark |
|---|---|---|
| `--bg-page` | `#FAFAF7` | `#171717` |
| `--bg-primary` | `#EEEEE6` | `#262626` |
| `--bg-secondary` | `#EEEEE6` | `#262626` |
| `--bg-card` | `#ffffff` | `#262626` |
| `--text-primary` | `#0f172a` | `#e5e5e5` |
| `--text-secondary` | `#64748b` | `#a3a3a3` |
| `--text-light` | `#94a3b8` | `#737373` |
| `--border` | `#E8E8E0` | `#404040` |
| `--accent` | `#A8C500` | `#A8C500` *(tetap)* |
| `--accent-hover` | `#95AD00` | `#95AD00` *(tetap)* |

Badge warna (P1/P2/Q1/dll) dan accent lime **tidak berubah** — kontras dengan dark background justru bagus.

---

## Komponen: ThemeToggle

```jsx
function ThemeToggle({ theme, onToggle }) {
  // theme: "light" | "dark"
  // Render: ☀️ [switch] 🌙
  // Switch pill: background #A8C500 saat dark, #e2e8f0 saat light
  // Knob geser kanan (dark) / kiri (light)
}
```

Ditempatkan di top bar, sebelah kiri tombol "+ Tambah Task".

---

## Implementasi CSS

Tambah blok `[data-theme="dark"]` di `<style>` yang override semua CSS variables:

```css
[data-theme="dark"] {
  --bg-page: #171717;
  --bg-primary: #262626;
  --bg-secondary: #262626;
  --bg-card: #262626;
  --text-primary: #e5e5e5;
  --text-secondary: #a3a3a3;
  --text-light: #737373;
  --border: #404040;
}
```

Tambah juga override untuk elemen yang **hardcoded** warna putih:

```css
[data-theme="dark"] .input { background: #171717; color: #e5e5e5; }
[data-theme="dark"] .modal-content { background: #262626; }
[data-theme="dark"] .task-row:hover { background: #404040; }
[data-theme="dark"] .mobile-topbar { background: #262626; }
[data-theme="dark"] select.input { background: #171717; }
```

---

## Logika Theme di App

```js
// Inisialisasi sebelum render (di luar React)
const savedTheme = localStorage.getItem("tf_theme") || "light";
document.documentElement.setAttribute("data-theme", savedTheme);

// Di dalam App component
const [theme, setTheme] = useState(savedTheme);

const toggleTheme = () => {
  const next = theme === "light" ? "dark" : "light";
  setTheme(next);
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("tf_theme", next);
};
```

---

## Komponen yang perlu dicek (inline styles hardcoded)

Saat implementasi, lakukan grep untuk warna hardcoded berikut dan ganti dengan CSS variable atau conditional:

- `background: "white"` → `var(--bg-card)`
- `background: "#f8fafc"` → `var(--bg-page)`
- `background: "#f1f5f9"` → `var(--bg-primary)`
- `color: "#0f172a"` → `var(--text-primary)`
- `border: "1px solid #e2e8f0"` → `var(--border)`

Tidak perlu sempurna 100% di iterasi pertama — fokus pada area yang paling terlihat (dashboard, sidebar, modal, task list).

---

## Out of Scope

- System preference auto-detect (`prefers-color-scheme`) — bisa ditambah nanti
- Per-user theme di server/DB — tidak perlu, localStorage cukup
