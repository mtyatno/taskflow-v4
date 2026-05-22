# Perubahan Session: LaTeX/Math Support via KaTeX

## Konteks
Session ini menambahkan dukungan sintaks matematika/LaTeX ke TaskFlow V4.
Semua perubahan sudah di-merge ke branch `main` dan ter-deploy ke VPS via CI/CD.

---

## Arsitektur yang Perlu Dipahami Dulu

TaskFlow V4 punya **dua renderer berbeda untuk notes**:

| Mode | Renderer | File |
|---|---|---|
| Edit (WYSIWYG) | Milkdown (ProseMirror) | `static/index.html` — `MilkdownEditor` component |
| View/Read | marked.js + custom pre-processing | `static/index.html` — `renderMarkdown()` function |

Milkdown bundle di-build dari `milkdown-build/entry.js` menggunakan esbuild,
outputnya adalah `static/vendor/milkdown.bundle.js` yang di-commit ke git sebagai binary artifact.
CI/CD di VPS **tidak** rebuild bundle ini — bundle harus di-rebuild lokal lalu di-commit.

---

## Pilihan Arsitektur: Opsi B

KaTeX dimuat sebagai **vendor file terpisah** (bukan di-bundle ke dalam milkdown.bundle.js).
- `window.katex` tersedia global via `<script>` tag
- Milkdown bundle map `import katex from 'katex'` ke `window.katex` via shim `milkdown-build/katex-global.js`
- `renderMarkdown()` juga pakai `window.katex` langsung

---

## File yang Berubah

### 1. `milkdown-build/katex-global.js` ← FILE BARU
```js
export default globalThis.katex;
```
Shim untuk esbuild: memetakan `import katex from 'katex'` ke `window.katex`
supaya KaTeX tidak ikut ter-bundle ke dalam `milkdown.bundle.js`.

---

### 2. `milkdown-build/entry.js`
Ditambah satu baris export:
```js
export { math } from '@milkdown/plugin-math';
```
`math` adalah array plugin (remark-math + ProseMirror node inline + block)
yang di-bundle dan di-expose ke `window.MilkdownBundle.math`.

---

### 3. `milkdown-build/package.json`
- Ditambah dependency: `"@milkdown/plugin-math": "^7.5.9"`
- Build script ditambah flag `--alias:katex=./katex-global.js` supaya esbuild
  tahu bahwa `katex` harus di-resolve ke shim (bukan di-bundle):
```json
"build": "esbuild entry.js --bundle --format=iife --global-name=MilkdownBundle --minify --outfile=../static/vendor/milkdown.bundle.js --alias:katex=./katex-global.js"
```

---

### 4. `static/vendor/milkdown.bundle.js`
Di-rebuild ulang. Ukuran berubah dari sebelumnya menjadi **449.7kb**.
Sekarang include `@milkdown/plugin-math` dan `remark-math` di dalamnya,
tapi KaTeX sendiri tetap external (tidak ikut dalam bundle).

---

### 5. `static/vendor/katex/` ← DIREKTORI BARU
Berisi file KaTeX 0.16.47 yang di-copy dari `milkdown-build/node_modules/katex/dist/`:
```
static/vendor/katex/
├── katex.min.js
├── katex.min.css
└── fonts/
    ├── KaTeX_AMS-Regular.woff2
    ├── KaTeX_Caligraphic-Bold.woff2
    ├── KaTeX_Caligraphic-Regular.woff2
    ├── KaTeX_Fraktur-Bold.woff2
    ├── KaTeX_Fraktur-Regular.woff2
    ├── KaTeX_Main-Bold.woff2
    ├── KaTeX_Main-BoldItalic.woff2
    ├── KaTeX_Main-Italic.woff2
    ├── KaTeX_Main-Regular.woff2
    ├── KaTeX_Math-BoldItalic.woff2
    ├── KaTeX_Math-Italic.woff2
    ├── KaTeX_SansSerif-Bold.woff2
    ├── KaTeX_SansSerif-Italic.woff2
    ├── KaTeX_SansSerif-Regular.woff2
    ├── KaTeX_Script-Regular.woff2
    ├── KaTeX_Size1-Regular.woff2
    ├── KaTeX_Size2-Regular.woff2
    ├── KaTeX_Size3-Regular.woff2
    ├── KaTeX_Size4-Regular.woff2
    └── KaTeX_Typewriter-Regular.woff2
```

---

### 6. `static/sw.js`
Dua perubahan:

**a) Cache version di-bump:**
```js
// sebelum
const CACHE = "taskflow-v106-sw-robust";
// sesudah
const CACHE = "taskflow-v107-sw-robust";
```

**b) KaTeX files ditambah ke STATIC pre-cache list:**
```js
"/static/vendor/katex/katex.min.js",
"/static/vendor/katex/katex.min.css",
"/static/vendor/katex/fonts/KaTeX_AMS-Regular.woff2",
// ... 20 font files total
```
Tanpa ini, math tidak akan bisa render saat offline karena font tidak ter-cache.

---

### 7. `static/index.html`
Ini file utama. Ada 4 perubahan:

#### a) Load KaTeX di `<head>` (sekitar baris 25-26)
```html
<link rel="stylesheet" href="/static/vendor/katex/katex.min.css">
<script src="/static/vendor/katex/katex.min.js"></script>
```
Diletakkan **sebelum** `milkdown.bundle.js` supaya `window.katex` sudah ada
saat bundle di-load.

#### b) CSS tambahan (di dalam `<style>`, sekitar baris 1204-1229)
```css
.math-block {
  display: block;
  overflow-x: auto;
  padding: 0.75em 1em;
  margin: 0.75em 0;
  background: color-mix(in srgb, var(--bg-card) 60%, transparent);
  border-radius: 6px;
  border-left: 3px solid var(--accent);
  text-align: center;
}
.math-inline .katex { font-size: 1em; }
.math-error {
  color: #ef4444;
  font-family: monospace;
  font-size: 0.85em;
  background: rgba(239,68,68,0.08);
  border-radius: 4px;
  padding: 0 4px;
}
[data-theme="dark"] .math-block {
  background: rgba(255,255,255,0.05);
}
#note-print-area .math-block { border-left: none; background: none; text-align: left; }
```

#### c) Function `renderMath()` + math pre-processing di `renderMarkdown()` (sekitar baris 13588)

`renderMath()` adalah helper kecil untuk memanggil KaTeX dengan error fallback:
```js
function renderMath(latex, displayMode) {
  try {
    return window.katex.renderToString(latex, { displayMode, throwOnError: true, output: 'html' });
  } catch (e) {
    const escaped = latex.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<span class="math-error" title="${escapeAttr(e.message)}">${displayMode ? '$$' : '$'}${escaped}${displayMode ? '$$' : '$'}</span>`;
  }
}
```

Di dalam `renderMarkdown()`, math menjadi **Step 0** — dijalankan paling pertama
sebelum wikilink, tasklink, dan highlight. Alasannya: karakter `_`, `*`, dll
di dalam LaTeX akan dirusak oleh `marked.parse()` kalau tidak di-extract dulu.

Pola yang dipakai sama persis dengan wikilink/tasklink/highlight (placeholder pattern):
```js
const mathMap = {};
let mi = 0;

// Block math dulu ($$...$$) sebelum inline ($...$) untuk hindari double-match
const preMath0 = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex) => {
  const key = `MATH${mi++}MATHEND`;
  mathMap[key] = `<div class="math-block">${renderMath(latex.trim(), true)}</div>`;
  return key;
});

// Inline math — regex ketat: tidak match $10 atau $ spasi $
const preMath1 = preMath0.replace(/\$(?!\s)([^$\n\r]+?)(?<!\s)\$/g, (_, latex) => {
  const key = `MATH${mi++}MATHEND`;
  mathMap[key] = `<span class="math-inline">${renderMath(latex, false)}</span>`;
  return key;
});
```

Setelah `marked.parse()`, placeholder di-restore:
```js
for (const [k, v] of Object.entries(mathMap)) {
  html = html.split(k).join(v);
}
```

#### d) Plugin math aktif di `MilkdownEditor` (sekitar baris 14240)
```js
// sebelum
.use(MB.commonmark).use(MB.gfm).use(MB.listener).use(MB.history).use(createWikilinkPlugin(...))

// sesudah
.use(MB.commonmark).use(MB.gfm).use(MB.listener).use(MB.history).use(MB.math).use(createWikilinkPlugin(...))
```
`.use(MB.math)` mengaktifkan WYSIWYG math rendering langsung di dalam editor Milkdown.

---

## Sintaks yang Didukung

| Sintaks | Hasil |
|---|---|
| `$$E = mc^2$$` | Block math, centered, dengan border kiri accent |
| `$\frac{a}{b}$` | Inline math di dalam teks |
| LaTeX tidak valid | Tampil `.math-error` merah dengan raw LaTeX |

---

## Alur CI/CD (Tidak Ada yang Berubah)

Deploy tetap berjalan otomatis saat push ke `main`:
1. SSH ke VPS
2. `git checkout -- static/index.html` (reset ke JSX source)
3. `git pull origin main`
4. `node compile.js` (compile JSX → plain JS)
5. VPS tidak perlu rebuild Milkdown bundle — bundle sudah di-commit ke git

Tidak ada perubahan pada `deploy.yml`.

---

## Status
- Branch `claude/memori-project-review-aSFzi` sudah di-merge ke `main` via PR #1
- CI/CD sudah berjalan dan ter-deploy ke VPS
- Fitur sudah diverifikasi berjalan oleh user
