# Rebrand TaskFlow → Alurik — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti semua string brand **user-visible** dari "TaskFlow" menjadi "Alurik" (domain alurik.com sudah dibeli user) tanpa merusak data/identitas internal.

**Architecture:** Penggantian string langsung pada file yang ada (frontend compiled index.html + manifest + backend python + tauri conf + docs) + ikon placeholder monogram "A" via Pillow. Identifier internal PERTAHANKAN (lihat Global Constraints).

**Tech Stack:** Vanilla JS/HTML (compiled React output), FastAPI (webapp.py), python-telegram-bot (bot.py), Tauri config JSON, Pillow untuk ikon, node:test + pytest.

## Global Constraints

- `static/index.html` adalah **compiled output** — edit langsung, JANGAN jalankan `node compile.js`, JANGAN tambah JSX.
- **WAJIB PERTAHANKAN (jangan diubah — mengubahnya = data hilang / identitas app baru):**
  - `static/offline/db.js:11` → `DB_NAME = "taskflow-offline"` (IndexedDB data offline)
  - `static/index.html:290` → `const NAME = "taskflow-legacy-cache",`
  - `static/sw.js:1` → prefix cache `taskflow-vXXX-...` (hanya angka & suffix yang diganti)
  - `src-tauri/tauri.conf.json:5` → `"identifier": "id.web.yatno.taskflow"` (package id Android — ganti = aplikasi terpisah di Play Store)
  - `tests/conftest.py:11` → prefix tempdir `taskflow-test-`
  - `tests/offline/patch_android_speech.test.js` → string package id `id.web.yatno.taskflow`
  - `webapp.py:179` → komentar tentang path `/TaskFlow/attachments` (routing internal)
  - `bot.py:79` → `logger = logging.getLogger("taskflow")`
  - Nama modul python, repo, path VPS, systemd services, cookie — semua tetap.
- Setiap ubah aset static → **wajib bump** versi cache `static/sw.js`.
- JS tests: `node --test "tests/offline/*.test.js"` (LAMBAT di Z:, 3–5 menit — baca output sendiri, laporkan angka asli). Pytest: `python -m pytest tests/` (bukan bare).
- Pemeriksa parse inline: `node scratch/check_inline.js static/index.html scratch/tmp_check` — wajib 5/5 OK.
- Commit style: `feat(rebrand): ...` / `chore(...)` + baris `Co-Authored-By: Claude <noreply@anthropic.com>`. Push = deploy (Actions). Verifikasi live via curl, jangan percaya Action hijau.
- **Restart service VPS dibutuhkan untuk perubahan webapp.py/bot.py** (tidak bisa di-ssh dari mesin ini) → catat sebagai PENDING user action; bagian static live langsung setelah push.

---

### Task 1: Rebrand frontend (index.html + manifest.json) + test regresi

**Files:**
- Modify: `static/index.html` (8 titik), `static/manifest.json`, `static/sw.js` (bump)
- Test: `tests/offline/rebrand.test.js` (file baru)

**Interfaces:**
- Consumes: —
- Produces: brand "Alurik" di semua string UI frontend; test regresi yang mengunci: (a) string lama user-visible HILANG, (b) identifier internal TETAP ADA. Task 2 & 3 tidak bergantung kode dari task ini.

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/offline/rebrand.test.js` dengan konten lengkap berikut:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
const indexHtml = read("static/index.html");
const manifest = read("static/manifest.json");
const swJs = read("static/sw.js");
const dbJs = read("static/offline/db.js");
const tauriConf = read("src-tauri/tauri.conf.json");

test("Rebrand Alurik — user-visible strings", async (t) => {
  await t.test("title & apple title jadi Alurik", () => {
    assert.ok(indexHtml.includes("<title>Alurik</title>"), "title harus <title>Alurik</title>");
    assert.ok(indexHtml.includes('content="Alurik"'), "apple-mobile-web-app-title harus Alurik");
  });

  await t.test("UI string lama hilang", () => {
    assert.strictEqual(indexHtml.includes("⚡ TaskFlow"), false, '"⚡ TaskFlow" tidak boleh ada');
    // semua identifier internal di file ini lowercase ("taskflow-..."), jadi literal
    // kapital-quoted '"TaskFlow"' yang tersisa pasti string UI — wajib nol.
    assert.strictEqual(indexHtml.includes('"TaskFlow"'), false, 'literal UI "TaskFlow" (kapital, quoted) tidak boleh ada');
    assert.strictEqual(indexHtml.includes("TaskFlow V4"), false, '"TaskFlow V4" tidak boleh ada');
  });

  await t.test("brand baru muncul di UI & ekspor", () => {
    assert.ok(indexHtml.includes("⚡ Alurik"), '"⚡ Alurik" harus ada di UI');
    assert.ok(indexHtml.includes("a.download = 'alurik-export-' + today + '.zip';"), "nama file ekspor harus alurik-export");
    assert.ok(indexHtml.includes("Navigasi utama Alurik"), "teks tour harus menyebut Alurik");
  });

  await t.test("manifest PWA pakai Alurik", () => {
    assert.ok(manifest.includes('"name": "Alurik"'), "manifest name = Alurik");
    assert.ok(manifest.includes('"short_name": "Alurik"'), "manifest short_name = Alurik");
    assert.strictEqual(manifest.includes("TaskFlow"), false, "manifest tidak boleh menyebut TaskFlow");
  });

  await t.test("identifier internal TETAP (data & identitas app)", () => {
    assert.ok(dbJs.includes('DB_NAME = "taskflow-offline"'), "IndexedDB name wajib tetap");
    assert.ok(indexHtml.includes('const NAME = "taskflow-legacy-cache"'), "legacy cache name wajib tetap");
    assert.ok(/^const CACHE = "taskflow-v\d+-/.test(swJs.trim().split("\n")[0]), "prefix cache sw.js wajib tetap taskflow-v");
    assert.ok(tauriConf.includes('"identifier": "id.web.yatno.taskflow"'), "package id Android wajib tetap");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `node --test tests/offline/rebrand.test.js`
Expected: FAIL — title/UI/manifest masih TaskFlow.

- [ ] **Step 3: Implementasi — edit `static/index.html` (8 titik, compiled output, old_string harus persis unik; cek grep dulu)**

1. Baris 9: `<title>TaskFlow V4</title>` → `<title>Alurik</title>`
2. Baris 14: `<meta name="apple-mobile-web-app-title" content="TaskFlow">` → `content="Alurik"`
3. Baris 413: `a.download = 'taskflow-export-' + today + '.zip';` → `a.download = 'alurik-export-' + today + '.zip';`
4. Baris 954, 1010, 1113, 1207: setiap `"⚡ TaskFlow")` → `"⚡ Alurik")` (4 kemunculan identik — pakai replace_all pada string persis `"⚡ TaskFlow")`)
5. Baris 2221: `}), "TaskFlow"), /*#__PURE__*/React.createElement("div", {` → `}), "Alurik"), /*#__PURE__*/React.createElement("div", {`
6. Baris 19583: `...<span>TaskFlow V4</span></div>` (di template print note) → `...<span>Alurik</span></div>`
7. Baris 23648: `description: 'Navigasi utama TaskFlow — Dashboard, Kalender, Fokus Hari Ini, Habit Tracker, Notes & Draw, Mindmap, dan Diskusi. Klik salah satu untuk berpindah halaman.'` → ganti `TaskFlow` → `Alurik`
8. `static/app.css` baris 1485: komentar `/* Driver.js tour overrides — match TaskFlow theme */` → `/* Driver.js tour overrides — match Alurik theme */`

**JANGAN sentuh** baris 290 (`taskflow-legacy-cache`).

- [ ] **Step 4: Implementasi — `static/manifest.json`**

```json
{
  "name": "Alurik",
  "short_name": "Alurik",
  "description": "Semua alur kerjamu — task, catatan, mindmap, & canvas",
```

(sisa file tidak diubah)

- [ ] **Step 5: Bump SW**

`static/sw.js` baris 1: `const CACHE = "taskflow-v302-table-toolbar-offset";` → `const CACHE = "taskflow-v303-rebrand-alurik";`

- [ ] **Step 6: Verifikasi**

1. `node --test tests/offline/rebrand.test.js` → PASS semua subtest
2. `node scratch/check_inline.js static/index.html scratch/tmp_check` → 5/5 OK
3. `node --test "tests/offline/*.test.js"` → suite penuh hijau (catat angka)
4. `grep -n -i "taskflow" static/index.html static/manifest.json` → hasil yang tersisa HANYA `taskflow-legacy-cache` (baris 290)

- [ ] **Step 7: Commit**

```bash
git add static/index.html static/manifest.json static/sw.js static/app.css tests/offline/rebrand.test.js
git commit -m "feat(rebrand): rename user-visible frontend strings TaskFlow → Alurik

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Rebrand backend (webapp.py + bot.py) + test regresi

**Files:**
- Modify: `webapp.py` (15 titik), `bot.py` (5 titik user-visible)
- Test: `tests/test_rebrand.py` (file baru)

**Interfaces:**
- Consumes: —
- Produces: seluruh string user-visible backend = "Alurik"; identifier internal tetap. Task 3 tidak bergantung kode dari task ini.

- [ ] **Step 1: Tulis test yang gagal**

Buat `tests/test_rebrand.py`:

```python
"""Test regresi rebrand TaskFlow → Alurik pada file backend."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")

def test_webapp_visible_strings_rebranded():
    src = _read("webapp.py")
    assert "Alurik" in src, "webapp.py harus menyebut Alurik"
    # string user-visible lama wajib hilang
    for old in [
        "TaskFlow V4",
        "Buka TaskFlow",
        "Published via TaskFlow",
        "Back to TaskFlow",
        "TaskFlow Publish",
        "TaskFlow Note AI",
        "TaskFlowBookmark",
        "taskflow-export-",
        "di TaskFlow",
    ]:
        assert old not in src, f"webapp.py masih mengandung: {old!r}"

def test_webapp_internal_identifiers_kept():
    src = _read("webapp.py")
    assert "/TaskFlow/attachments" in src, "komentar routing internal wajib tetap"

def test_bot_visible_strings_rebranded():
    src = _read("bot.py")
    assert "Alurik" in src, "bot.py harus menyebut Alurik"
    for old in ["TaskFlow V4", "Selamat datang! TaskFlow"]:
        assert old not in src, f"bot.py masih mengandung: {old!r}"
    assert 'logging.getLogger("taskflow")' in src, "logger internal wajib tetap taskflow"
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `python -m pytest tests/test_rebrand.py -v`
Expected: FAIL — string lama masih ada.

- [ ] **Step 3: Implementasi — `webapp.py` (15 titik; daftar lengkap, semua persis)**

1. Baris 2 docstring: `TaskFlow V4 — Web Application (FastAPI)` → `Alurik — Web Application (FastAPI)`
2. Baris 963: `app = FastAPI(title="TaskFlow V4", docs_url="/api/docs")` → `title="Alurik"`
3. Baris 1751: `...Buka TaskFlow untuk membuat ulang.'` → `Buka Alurik untuk membuat ulang.`
4. Baris 1755: `...Buka TaskFlow untuk memperpanjang.'` → `Buka Alurik untuk memperpanjang.`
5. Baris 1759: `...Buka TaskFlow untuk memperpanjang.'` → `Buka Alurik untuk memperpanjang.` (kemunculan kedua — pakai replace_all untuk `Buka TaskFlow untuk`)
6. Baris 2526: `return HTMLResponse("<h1>TaskFlow V4</h1><p>Static files not found.</p>")` → `"<h1>Alurik</h1>"`
7. Baris 3638: `filename = f"taskflow-export-{today}.zip"` → `f"alurik-export-{today}.zip"`
8. Baris 3971: `"User-Agent": "Mozilla/5.0 (compatible; TaskFlowBookmark/1.0)"` → `AlurikBookmark/1.0`
9. Baris 4041: `"Kamu adalah asisten penulisan catatan di TaskFlow. "` → `di Alurik. `
10. Baris 4057: `extra_headers={"X-Title": "TaskFlow Note AI"}` → `"Alurik Note AI"`
11. Baris 4688: `<title>{title} — TaskFlow Publish</title>` → `— Alurik Publish`
12. Baris 4700: `Published via TaskFlow` → `Published via Alurik`
13. Baris 4751: `Published with &#10084; by <a href="{base_url}">TaskFlow</a>` → `Alurik`
14. Baris 4899: `<title>Not Found — TaskFlow</title>` → `Not Found — Alurik`
15. Baris 4904: `&#8592; Back to TaskFlow` → `Back to Alurik`
16. Baris 4910: `<title>🔒 Protected — TaskFlow</title>` → `Protected — Alurik`

**JANGAN sentuh** baris 179 (komentar `/TaskFlow/attachments`).

- [ ] **Step 4: Implementasi — `bot.py` (5 titik user-visible)**

1. Baris 2 docstring: `TaskFlow V4 - Telegram Bot` → `Alurik - Telegram Bot`
2. Baris 190: `⚡ <b>TaskFlow V4</b>` → `⚡ <b>Alurik</b>`
3. Baris 192: `Selamat datang! TaskFlow membantu mengelola task dengan:` → `Selamat datang! Alurik membantu mengelola task dengan:`
4-5. Cari sisa kemunculan `TaskFlow` di bot.py (`grep -n "TaskFlow" bot.py`) — SELAIN baris 79 (`logging.getLogger("taskflow")`), ganti semua dengan `Alurik` (teks help/welcome). Kalau teksnya menyebut metodologi (GTD/Eisenhower), hanya ganti kata brand-nya.

**JANGAN sentuh** baris 79.

- [ ] **Step 5: Verifikasi**

1. `python -m pytest tests/test_rebrand.py -v` → PASS semua
2. `python -m pytest tests/` → 43/43 + test baru hijau
3. `grep -n "TaskFlow" webapp.py bot.py` → sisa HANYA: webapp.py:179 (komentar routing) + bot.py:79 (logger)

- [ ] **Step 6: Commit**

```bash
git add webapp.py bot.py tests/test_rebrand.py
git commit -m "feat(rebrand): rename user-visible backend strings TaskFlow → Alurik

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Ikon placeholder + docs + deploy + handover

**Files:**
- Create: `scratch/gen_alurik_icons.py` (script sekali pakai, dihapus setelah jalan)
- Modify: `static/favicon.png`, `static/icon-32.png`, `static/icon-192.png`, `static/icon-512.png` (file biner, hasil generate)
- Modify: `src-tauri/tauri.conf.json` (productName + title), `README.md`, `.agents/PROJECT_MAP.md`, `CLAUDE.md`
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md` (handover)

**Interfaces:**
- Consumes: Task 1 & 2 sudah committed.
- Produces: ikon monogram "A" (placeholder), docs ter-update, deploy LIVE, SW `taskflow-v303-rebrand-alurik`.

- [ ] **Step 1: Generate ikon placeholder monogram "A" (Pillow)**

Tulis `scratch/gen_alurik_icons.py`:

```python
"""Generate placeholder Alurik icons: monogram 'A' on dark slate with lime accent."""
from PIL import Image, ImageDraw, ImageFont

BG = (15, 23, 42, 255)        # #0f172a (manifest background_color)
FG = (168, 197, 0, 255)       # #a8c500 (accent lime)

def make(size: int, path: str):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    # font bold: coba DejaVuSans-Bold, fallback default
    try:
        font = ImageFont.truetype("arialbd.ttf", int(size * 0.62))
    except OSError:
        font = ImageFont.load_default(size=int(size * 0.5))
    text = "A"
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, fill=FG, font=font)
    img.save(path)
    print("wrote", path)

for size, path in [(48, "static/favicon.png"), (32, "static/icon-32.png"),
                   (192, "static/icon-192.png"), (512, "static/icon-512.png")]:
    make(size, path)
```

Jalankan: `python scratch/gen_alurik_icons.py` — pastikan ke-4 file tertulis (cek `file static/*.png`). Lalu HAPUS `scratch/gen_alurik_icons.py` (sekali pakai).

- [ ] **Step 2: Tauri conf — nama tampil saja (identifier TETAP)**

`src-tauri/tauri.conf.json`:
- Baris 3: `"productName": "TaskFlow",` → `"productName": "Alurik",`
- Baris 13: `"title": "TaskFlow",` → `"title": "Alurik",`
- **JANGAN sentuh** baris 5 `"identifier": "id.web.yatno.taskflow"`.

Catatan: ikon native `src-tauri/icons/*` menyusul saat build native berikutnya (di luar scope task ini).

- [ ] **Step 3: Docs**

- `README.md`: baris 1 `# 🚀 TaskFlow V4` → `# 🚀 Alurik`; ganti semua sebutan "TaskFlow" di badan README menjadi "Alurik" (README murni user-visible).
- `.agents/PROJECT_MAP.md` baris 9: `| TaskFlow (Todolist Manager V5.0) | ...` → ganti sel pertama tabel menjadi `Alurik — dulu TaskFlow (Todolist Manager V5.0)`.
- `CLAUDE.md`: baris "Read `.agents/PROJECT_MAP.md` — ... this repo contains ONLY TaskFlow" → ganti "TaskFlow" → "Alurik (dulu TaskFlow)".

- [ ] **Step 4: Verifikasi penuh**

```bash
node --test "tests/offline/*.test.js"
python -m pytest tests/
node scratch/check_inline.js static/index.html scratch/tmp_check
node --check static/sw.js
```
Semua hijau (catat angka; SW sudah v303 dari Task 1).

- [ ] **Step 5: Commit + push**

```bash
git add static/favicon.png static/icon-32.png static/icon-192.png static/icon-512.png src-tauri/tauri.conf.json README.md .agents/PROJECT_MAP.md CLAUDE.md
git commit -m "feat(rebrand): Alurik placeholder icons, tauri display name, and docs

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 6: Verifikasi live (jangan percaya Action hijau)**

Poll tiap ~20s sampai muncul (maks 5 menit):
```bash
curl -s https://todo.yatno.web.id/static/sw.js | head -1    # → taskflow-v303-rebrand-alurik
curl -s https://todo.yatno.web.id/ | grep -o "<title>[^<]*</title>" | head -1   # → <title>Alurik</title>
curl -s https://todo.yatno.web.id/static/manifest.json | head -3                # → "name": "Alurik"
```
Catatan: perubahan **webapp.py/bot.py baru aktif setelah restart service** (di luar kendali kita) — bagian static aktif seketika.

- [ ] **Step 7: Handover `.agents/*`**

- `.agents/CURRENT_STATE.md`: ganti blok 🟢 Active Task dengan ringkasan rebrand: apa yang diganti, apa yang dipertahankan, SW v303, status LIVE, dan **PENDING user**: (1) hard refresh browser; (2) restart VPS `sudo systemctl restart taskflow taskflow-web` agar backend & bot pakai nama baru; (3) cek telegram bot `/start` menampilkan "⚡ Alurik"; (4) ikon Tauri menyusul saat build native; (5) logo placeholder monogram bisa diganti desain kapan saja (regenerasi 4 file PNG).
- `.agents/SESSION_LOG.md`: append entri format standar.
- Commit + push `.agents/*` sebagai commit terpisah `docs(agents): record Alurik rebrand`.

---

## Catatan post-plan

- Setelah semua live: sampaikan ke user bahwa URL tetap `todo.yatno.web.id` (domain alurik.com belum di-pointing — konfigurasi DNS/HTTPS VPS = langkah terpisah yang butuh akses user ke Cloudflare/registrar & VPS).
- Logo asli (bukan monogram) = desain terpisah; placeholder mudah diganti.
