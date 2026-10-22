# Banner Pembaruan + Modal "Apa yang baru" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Klik "Perbarui Sekarang" selalu berakhir di versi baru, banner palsu hilang, dan setelah pembaruan pengguna melihat modal "Apa yang baru" yang isinya ditulis agent di `static/whatsnew.json`.

**Architecture:**
- `/api/version` membaca versi dari `static/sw.js` di disk.
- Logika banner pindah ke modul murni `static/offline/appupdate.js`. Banner hanya muncul dari SW menunggu.
- Logika pemilihan catatan ada di modul murni `static/offline/whatsnew.js`.
- Modal dan tombol Pengaturan ada di `index.html`, gayanya di `app.css`.
- `whatsnew.json` dan kedua modul di-precache sebagai shell.
- Format catatan dijaga `tests/test_whatsnew.py` di CI.

**Tech Stack:** FastAPI (`webapp.py`), React 18 tanpa JSX (`React.createElement` di `static/index.html`), modul UMD `static/offline/*`, `node --test`, pytest, Playwright (Python).

**Spec:** `docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md` (dibaca bersama plan ini).

## Global Constraints

- Basis `main` @ `d950796`. Versi baru **`taskflow-v466-apa-yang-baru`**, `app.css?v=364`, ADR **ADR-030**. Sebelum merge, cek `main`: bila nomor sudah dipakai, naikkan ke nomor kosong berikutnya di semua tempat, termasuk entri `whatsnew.json`.
- Kunci localStorage penanda: `tf_whatsnew_seen`. URL catatan: `/static/whatsnew.json`, dimuat dengan `{cache: "no-cache"}` tanpa `apiUrl`.
- Batas: poin ≤ 140 karakter, `title` ≤ 60 karakter, file ≤ 65536 byte, modal maksimal 10 rilis, pengaman `apply()` 5000 ms, interval cek 1800000 ms.
- Setiap file lokal yang dimuat `index.html` (`<script src>` / stylesheet) wajib ada di `STATIC` `static/sw.js` dengan URL persis dan ter-track git (ADR-029, `tests/offline/sw_precache_shell.test.js`). Jalankan `git add` file baru sebelum tes node.
- Jangan ubah `install`, `activate`, atau cabang `fetch` di `sw.js`. Hanya daftar `STATIC` yang boleh berubah.
- Teks UI dalam bahasa Indonesia, ikon lewat komponen `Icon` (`static/ui-components.js`; nama yang ada: `sparkles`, `wrench`, `search`, `refresh`, `x`), tanpa emoji baru. Jangan pakai `border-left` aksen. Teks catatan dirender sebagai teks React, tidak pernah lewat `dangerouslySetInnerHTML`.
- Baseline `main` (2026-10-23): `npm test` 2997 tes, 1 gagal pra-ada (`draw_local_reactive`); `python -m pytest tests/ -q` 1162 passed, 1 skipped. `npm test` butuh `npm ci`, dengan `python3` berisi dependensi webapp di PATH.
- Commit diakhiri dua baris atribusi:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01DwGrZ5swNw11Zq9oohkSYH
  ```

## Review Focus

1. **localStorage melempar error** (mode privat, situs diblokir): aplikasi tidak crash, modal tidak muncul berulang, penanda dibaca sebagai kosong. Dipasang di Task 3 (`readSeen` / `writeSeen`).
2. **`whatsnew.json` di perangkat berbentuk aneh** (entri tanpa `version`, `new` bukan array, poin bukan string): entri atau poin rusak dilewati tanpa crash. Dipasang di Task 3 (`normalizeEntries`).
3. **`reg.update()` menolak saat offline di pengecekan otomatis:** tidak ada toast, tidak ada exception yang lolos. Dipasang di Task 4.
4. **`navigator.serviceWorker` ada tetapi pendaftaran gagal** (`getRegistration()` null): pengecekan memakai jalur `/api/version` "tidak terkendali". Dipasang di Task 4.
5. **Modal di layar 375 px dengan banyak rilis:** isi bisa digulir, tombol "Mengerti" tetap terlihat. Dipasang di Task 6 (E2E + screenshot).

---

### Task 1: `/api/version` membaca versi dari `static/sw.js`

**Files:**
- Modify: `webapp.py` (blok `@app.get("/api/version")`, ±baris 4891–4908; hapus literal `sw_cache = "…"`)
- Modify: `tests/test_version.py`
- Modify (hapus asersi `sw_cache` saja): `tests/offline/{note_slash_menu_grid,manage_workspace_icons,user_session_isolation,tasklist_view_icons,workspace_files_icons,note_paper_mode,admin_email_card,tasklist_focus_btn,note_slash_menu_dismiss,account_settings_ui,pages_icons_mindmap_draw,note_slash_task}.test.js`

**Interfaces:**
- Produces: `webapp._sw_version() -> str`. Membaca `STATIC_DIR / "sw.js"` lewat global `STATIC_DIR` saat dipanggil (bukan nilai yang ditangkap saat import), regex `^const CACHE = "([^"]+)";` (multiline), cache memori dengan kunci `(st_mtime_ns, st_size)`. Melempar `RuntimeError` bila file tidak terbaca atau baris tidak cocok.
- `GET /api/version` → 200 `{"app_version": "4.0.0", "sw_version": v, "cache_name": v, "timestamp": int}` dengan header no-cache yang sama. Bila `RuntimeError` → log `logger.exception` lalu 500 `{"detail": "SW version unavailable"}` (header no-cache yang sama).

- [ ] **Step 1: Tulis tes yang gagal di `tests/test_version.py`** (ganti `test_get_app_version`, pertahankan `test_serve_sw_headers`)

```python
import os, re, shutil
import webapp

SW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "sw.js")

def _cache_name(path=SW):
    return re.search(r'^const CACHE = "([^"]+)";', open(path, encoding="utf-8").read(), re.M).group(1)

def test_get_app_version(client):
    r = client.get("/api/version")
    assert r.status_code == 200
    d = r.json()
    assert d["app_version"] == "4.0.0"
    assert d["sw_version"] == _cache_name() == d["cache_name"]
    assert isinstance(d["timestamp"], int) and d["timestamp"] > 0
    cc = r.headers.get("Cache-Control", "")
    assert "no-cache" in cc and "no-store" in cc and "must-revalidate" in cc
    assert r.headers.get("Pragma") == "no-cache" and r.headers.get("Expires") == "0"

def test_version_follows_sw_js_without_restart(client, tmp_path, monkeypatch):
    shutil.copy(SW, tmp_path / "sw.js")
    monkeypatch.setattr(webapp, "STATIC_DIR", tmp_path)
    assert client.get("/api/version").json()["sw_version"] == _cache_name()
    p = tmp_path / "sw.js"
    p.write_text(re.sub(r'^const CACHE = "[^"]+";', 'const CACHE = "taskflow-v999-uji";', p.read_text(encoding="utf-8"), flags=re.M), encoding="utf-8")
    st = os.stat(p); os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns + 2_000_000_000))
    assert client.get("/api/version").json()["sw_version"] == "taskflow-v999-uji"

def test_version_500_when_sw_missing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(webapp, "STATIC_DIR", tmp_path)
    r = client.get("/api/version")
    assert r.status_code == 500
    assert r.json()["detail"] == "SW version unavailable"

def test_webapp_has_no_hardcoded_sw_version():
    src = open(os.path.join(os.path.dirname(SW), "..", "webapp.py"), encoding="utf-8").read()
    assert 'sw_cache = "' not in src
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `python -m pytest tests/test_version.py -q`
Expected: `test_version_follows_sw_js_without_restart`, `test_version_500_when_sw_missing`, dan `test_webapp_has_no_hardcoded_sw_version` FAIL.

- [ ] **Step 3: Implementasikan `_sw_version()` dan endpoint di `webapp.py`**, lalu hapus literal `sw_cache`.

- [ ] **Step 4: Hapus asersi `sw_cache` dari 12 tes node di atas.** Hanya pernyataan `assert.match(<var>, /sw_cache = …/…)` yang dihapus; asersi `sw.js` dan `index.html` tetap.

Run: `grep -rn "sw_cache" tests/ webapp.py static/`
Expected: hanya `tests/test_version.py` (`'sw_cache = "' not in src`).

- [ ] **Step 5: Jalankan tes**

Run: `python -m pytest tests/test_version.py -q && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: pytest 5 passed. `npm test` hanya gagal 1 (`draw_local_reactive`).

- [ ] **Step 6: Commit** — `feat(version): /api/version membaca CACHE dari sw.js tanpa restart`

---

### Task 2: `static/whatsnew.json`, penjaga CI, versi v466, aturan agent

**Files:**
- Create: `static/whatsnew.json`
- Create: `tests/test_whatsnew.py`
- Modify: `static/sw.js` (`CACHE` → v466; tambah `"/static/whatsnew.json"` di `STATIC` setelah `"/config.js"`)
- Modify: `static/index.html` (`window.__SW_VERSION` dan fallback `window.__SW_VERSION || "…"`)
- Modify: semua `tests/**` yang memuat `taskflow-v465-note-lampiran-gambar`
- Modify: `tests/build-tauri-dist.test.js` (tambah asersi `static/whatsnew.json` tersalin)
- Modify: `.agents/PROTOCOL.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`

**Interfaces:**
- Produces: `static/whatsnew.json` = `{"entries": [Entry, …]}` dengan `Entry = {version, date, title?, new?, fixed?, silent?}` (spec §3.3). Entri teratas = `CACHE`.
- Produces (Python, di `tests/test_whatsnew.py`): `validate(data: dict, cache: str, index_version: str) -> list[str]` (daftar pesan galat, kosong = valid) dan `static_entries(sw_src: str) -> list[str]` (isi array `STATIC`). Task 3 dan 4 menambah asersi memakai `static_entries`.

- [ ] **Step 1: Tulis `tests/test_whatsnew.py`.** `validate` menerapkan aturan 1–8 spec §3.3; regex versi `^taskflow-v(\d+)-[a-z0-9-]+$`; tanggal divalidasi dengan `datetime.date.fromisoformat`; kunci yang diizinkan `{"version","date","title","new","fixed","silent"}`. Tes:

```python
def test_whatsnew_file_valid():
    assert validate(load(), sw_cache(), index_sw_version()) == []

def test_whatsnew_file_size():
    assert os.path.getsize(WHATSNEW) <= 65536

def test_whatsnew_json_precached():
    assert "/static/whatsnew.json" in static_entries(read(SW))

GOOD = {"version": "taskflow-v10-a", "date": "2026-10-23", "title": "Judul", "new": ["Poin."]}
@pytest.mark.parametrize("data, needle", [
    ({"entries": []}, "kosong"),
    ({"entries": [dict(GOOD, version="v10-a")]}, "version"),
    ({"entries": [dict(GOOD, date="2026-13-01")]}, "date"),
    ({"entries": [GOOD, dict(GOOD, version="taskflow-v10-b")]}, "turun"),
    ({"entries": [dict(GOOD, version="taskflow-v9-a")]}, "CACHE"),
    ({"entries": [dict(GOOD, silent=True)]}, "silent"),
    ({"entries": [{k: v for k, v in GOOD.items() if k != "title"}]}, "title"),
    ({"entries": [dict(GOOD, new=[], fixed=[])]}, "poin"),
    ({"entries": [dict(GOOD, new=["x" * 141])]}, "140"),
    ({"entries": [dict(GOOD, new=["<b>tebal</b>"])]}, "<"),
    ({"entries": [dict(GOOD, title="t" * 61)]}, "60"),
    ({"entries": [dict(GOOD, link="/x")]}, "kunci"),
])
def test_validator_rejects(data, needle):
    errs = validate(data, "taskflow-v10-a", "taskflow-v10-a")
    assert errs and any(needle in e for e in errs), errs

def test_validator_accepts_silent_and_gaps():
    data = {"entries": [GOOD, {"version": "taskflow-v7-z", "date": "2026-10-22", "silent": True}]}
    assert validate(data, "taskflow-v10-a", "taskflow-v10-a") == []
```

Pesan galat wajib memuat kata kunci di kolom `needle` (mis. `"entries kosong"`, `"version … tidak valid"`, `"nomor versi tidak turun tegas"`, `"entri teratas ≠ CACHE"`, `"silent tidak boleh punya title/new/fixed"`, `"title wajib"`, `"minimal satu poin"`, `"poin > 140 karakter"`, `"poin memuat < atau >"`, `"title > 60 karakter"`, `"kunci tidak dikenal"`). Untuk aturan 4, pesan juga dipakai saat `index_version` ≠ `cache`.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `python -m pytest tests/test_whatsnew.py -q`
Expected: `test_whatsnew_file_valid`, `test_whatsnew_file_size`, dan `test_whatsnew_json_precached` FAIL (file belum ada); semua `test_validator_*` PASS.

- [ ] **Step 3: Naikkan versi ke v466**

Run: `grep -rl "taskflow-v465-note-lampiran-gambar" static tests | xargs sed -i 's/taskflow-v465-note-lampiran-gambar/taskflow-v466-apa-yang-baru/g'`
Expected: `grep -rn "taskflow-v465" static tests` kosong.

- [ ] **Step 4: Buat `static/whatsnew.json` dengan isi persis ini** (kalimat boleh disunting pemilik saat review PR):

```json
{
  "entries": [
    {"version": "taskflow-v466-apa-yang-baru", "date": "2026-10-23", "title": "Catatan pembaruan",
     "new": ["Setelah Alurik diperbarui, muncul ringkasan fitur baru dan perbaikan seperti ini.",
             "Riwayat pembaruan bisa dibuka lagi lewat tombol Apa yang baru di Pengaturan."],
     "fixed": ["Tombol Perbarui Sekarang kini selalu memasang versi terbaru, dan pemberitahuannya tidak muncul berulang-ulang."]},
    {"version": "taskflow-v465-note-lampiran-gambar", "date": "2026-10-23", "title": "Lampiran gambar di catatan",
     "fixed": ["Gambar yang dilampirkan di catatan kini tampil sebagai gambar, bukan teks.",
               "Saat melampirkan file di catatan, kini terlihat proses unggah beserta persentasenya.",
               "Catatan lama yang lampirannya tampil sebagai teks dipulihkan otomatis saat dibuka."]},
    {"version": "taskflow-v464-sw-precache-shell", "date": "2026-10-23", "title": "Tampilan lebih andal setelah pembaruan",
     "fixed": ["Alurik tidak lagi tampil tanpa gaya saat dibuka dengan internet lambat setelah HP dinyalakan ulang.",
               "Pembaruan kini lebih hemat kuota karena file yang tidak berubah tidak diunduh ulang."]},
    {"version": "taskflow-v463-lampiran-tanpa-cookie", "date": "2026-10-22", "title": "Membuka lampiran task",
     "fixed": ["Lampiran task kini terbuka di dalam Alurik dan tidak lagi gagal dengan pesan Not authenticated."]},
    {"version": "taskflow-v462-fokus-checklist-hitungan", "date": "2026-10-22", "title": "Checklist di halaman Fokus",
     "new": ["Daftar centang di dalam task kini disebut Checklist."],
     "fixed": ["Menambah checklist atau catatan di halaman Fokus tidak lagi gagal karena request timeout."]},
    {"version": "taskflow-v461-task-selesai-instan", "date": "2026-10-22", "title": "Tandai selesai lebih cepat",
     "fixed": ["Task yang ditandai selesai kini langsung hilang dari daftar, tanpa menunggu beberapa detik."]},
    {"version": "taskflow-v460-fokus-hero-mobile", "date": "2026-10-22", "title": "Kartu Pomodoro ringkas di HP",
     "new": ["Di HP, kartu Pomodoro halaman Fokus kini lebih ringkas: mode, suara latar, dan task aktif dalam satu kartu."]},
    {"version": "taskflow-v458-fokus-filter-redesign", "date": "2026-10-22", "title": "Tampilan filter halaman Fokus",
     "new": ["Bar filter halaman Fokus kini satu kartu yang rapi, dan task dikelompokkan per workspace dan project."]},
    {"version": "taskflow-v457-task-pindah-workspace", "date": "2026-10-22", "title": "Pindah task ke workspace",
     "new": ["Task pribadi kini bisa dipindahkan ke workspace lewat tombol Pindah ke Workspace di detail task."]},
    {"version": "taskflow-v456-focus-filter", "date": "2026-10-22", "title": "Pilih task di halaman Fokus",
     "new": ["Tandai task dengan bintang untuk menjadikannya Target hari ini di halaman Fokus.",
             "Halaman Fokus kini punya tab Semua, Hari ini, dan Terlambat, kolom cari, serta filter prioritas."]}
  ]
}
```

Lalu tambahkan `"/static/whatsnew.json",` ke `STATIC` di `static/sw.js`, dan `git add static/whatsnew.json`.

- [ ] **Step 5: Tambahkan asersi Tauri** di `tests/build-tauri-dist.test.js` (tes pertama): `assert.ok(fs.existsSync(path.join(out, "static", "whatsnew.json")), "missing static/whatsnew.json");`

- [ ] **Step 6: Tulis aturan agent.**
  - `.agents/PROTOCOL.md`: bagian baru `## 4. CHECKLIST RILIS FRONTEND (setiap kenaikan versi SW)` berisi lima butir spec §3.7, persis.
  - `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`: tambahkan butir spec §3.7 ke daftar aturan wajib (bagian "MANDATORY WORKFLOW RULES").

- [ ] **Step 7: Jalankan tes**

Run: `python -m pytest tests/test_whatsnew.py tests/test_version.py tests/test_sw_precache_node.py -q && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: semua pytest lolos; `npm test` hanya gagal 1 (`draw_local_reactive`).

- [ ] **Step 8: Commit** — `feat(whatsnew): catatan pembaruan whatsnew.json + penjaga CI + checklist rilis; SW v466`

---

### Task 3: Modul `static/offline/whatsnew.js` (`TF.whatsnew`)

**Files:**
- Create: `static/offline/whatsnew.js` (pola UMD `static/offline/focusfilter.js`)
- Create: `tests/offline/whatsnew.test.js`
- Create: `tests/test_app_update_node.py` (pola `tests/test_sw_precache_node.py`; daftar `NODE_TESTS = ["whatsnew"]` + tes "daftar lengkap")
- Modify: `static/index.html` (`<script src="/static/offline/whatsnew.js"></script>` setelah baris `accountbanner.js`)
- Modify: `static/sw.js` (`"/static/offline/whatsnew.js",` di `STATIC` setelah `accountbanner.js`)
- Modify: `tests/test_whatsnew.py` (asersi `"/static/offline/whatsnew.js" in static_entries(...)`)

**Interfaces:**
- Produces `TF.whatsnew` / `module.exports`:
  - `SEEN_KEY = "tf_whatsnew_seen"`, `URL = "/static/whatsnew.json"`
  - `versionNumber(v: any) -> number|null` (regex `^taskflow-v(\d+)`)
  - `normalizeEntries(raw: any) -> Entry[]`: membuang entri tanpa nomor versi; `title` non-string → `""`; `new`/`fixed` → array berisi string tidak kosong saja; `silent` → `silent === true`.
  - `pickUnseen({entries, current, seen, hadUser, limit = 10}) -> {entries: Entry[], hiddenCount: number}`, sesuai aturan spec §3.5
  - `history({entries, current, limit = 10}) -> Entry[]`
  - `shouldMarkSeen(seen, current) -> boolean`
  - `formatDate(iso: string) -> string`: bulan `Jan Feb Mar Apr Mei Jun Jul Agu Sep Okt Nov Des`; tanggal tidak valid → `""`.
  - `load(fetchFn) -> Promise<Entry[]|null>`: memanggil `fetchFn(URL, {cache: "no-cache"})`; respons non-ok, error, atau `entries` bukan array → `null`; selain itu `normalizeEntries(data.entries)`.
  - `readSeen(storage) -> string|null` dan `writeSeen(storage, version) -> boolean`: menelan exception (`null` / `false`).
  - Entri non-silent = `!e.silent` **dan** punya minimal satu poin setelah normalisasi. `pickUnseen` dan `history` selalu menormalkan input lewat `normalizeEntries` lebih dulu.

- [ ] **Step 1: Tulis `tests/offline/whatsnew.test.js`**

```js
const wn = require("../../static/offline/whatsnew.js");
const E = (n, extra) => ({ version: `taskflow-v${n}-x`, date: "2026-10-23", title: `R${n}`, new: [`Poin ${n}.`], ...extra });
const ENTRIES = [E(466), E(465, { silent: true, title: undefined, new: undefined }), E(464), E(462), E(460)];

test("versionNumber", () => {
  assert.equal(wn.versionNumber("taskflow-v466-apa"), 466);
  assert.equal(wn.versionNumber("dev"), null);
  assert.equal(wn.versionNumber(null), null);
});
test("pickUnseen: rilis terlewat digabung, silent dibuang, urut menurun", () => {
  const r = wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: "taskflow-v460-x", hadUser: true });
  assert.deepEqual(r.entries.map(e => e.version), ["taskflow-v466-x", "taskflow-v464-x", "taskflow-v462-x"]);
  assert.equal(r.hiddenCount, 0);
});
test("pickUnseen: seen = current → kosong", () => {
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: "taskflow-v466-x", hadUser: true }).entries.length, 0);
});
test("pickUnseen: tanpa penanda + hadUser → hanya entri versi sekarang", () => {
  const r = wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: null, hadUser: true });
  assert.deepEqual(r.entries.map(e => e.version), ["taskflow-v466-x"]);
});
test("pickUnseen: tanpa penanda + perangkat baru → kosong", () => {
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: null, hadUser: false }).entries.length, 0);
});
test("pickUnseen: penanda rusak diperlakukan seperti kosong", () => {
  assert.deepEqual(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v466-x", seen: "zzz", hadUser: true }).entries.map(e => e.version), ["taskflow-v466-x"]);
});
test("pickUnseen: rollback (seen > current) → kosong; current tak terbaca → kosong", () => {
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "taskflow-v464-x", seen: "taskflow-v466-x", hadUser: true }).entries.length, 0);
  assert.equal(wn.pickUnseen({ entries: ENTRIES, current: "dev", seen: "taskflow-v400-x", hadUser: true }).entries.length, 0);
});
test("pickUnseen: maksimal limit, sisanya hiddenCount", () => {
  const many = Array.from({ length: 13 }, (_, i) => E(500 - i));
  const r = wn.pickUnseen({ entries: many, current: "taskflow-v500-x", seen: "taskflow-v400-x", hadUser: true });
  assert.equal(r.entries.length, 10); assert.equal(r.hiddenCount, 3);
});
test("history: non-silent ≤ current, menurun, maksimal 10", () => {
  assert.deepEqual(wn.history({ entries: ENTRIES, current: "taskflow-v464-x" }).map(e => e.version), ["taskflow-v464-x", "taskflow-v462-x", "taskflow-v460-x"]);
});
test("shouldMarkSeen tidak pernah menurunkan penanda", () => {
  assert.equal(wn.shouldMarkSeen(null, "taskflow-v466-x"), true);
  assert.equal(wn.shouldMarkSeen("taskflow-v465-x", "taskflow-v466-x"), true);
  assert.equal(wn.shouldMarkSeen("taskflow-v466-x", "taskflow-v466-x"), false);
  assert.equal(wn.shouldMarkSeen("taskflow-v467-x", "taskflow-v466-x"), false);
  assert.equal(wn.shouldMarkSeen("rusak", "taskflow-v466-x"), true);
});
test("formatDate", () => {
  assert.equal(wn.formatDate("2026-10-23"), "23 Okt 2026");
  assert.equal(wn.formatDate("2026-05-01"), "1 Mei 2026");
  assert.equal(wn.formatDate("bukan"), "");
});
test("normalizeEntries membuang yang rusak tanpa crash", () => {
  const out = wn.normalizeEntries([{ version: "x" }, { version: "taskflow-v9-a", title: 5, new: "x", fixed: ["ok", 3, ""] }, null]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].new, []); assert.deepEqual(out[0].fixed, ["ok"]); assert.equal(out[0].title, "");
  assert.deepEqual(wn.normalizeEntries("x"), []);
});
test("load: URL + cache no-cache; gagal → null", async () => {
  let seen;
  const ok = await wn.load((u, o) => { seen = [u, o]; return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [E(1)] }) }); });
  assert.deepEqual(seen, ["/static/whatsnew.json", { cache: "no-cache" }]); assert.equal(ok.length, 1);
  assert.equal(await wn.load(() => Promise.resolve({ ok: false })), null);
  assert.equal(await wn.load(() => Promise.reject(new Error("offline"))), null);
  assert.equal(await wn.load(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })), null);
});
test("readSeen/writeSeen menelan storage yang melempar", () => {
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  assert.equal(wn.readSeen(bad), null); assert.equal(wn.writeSeen(bad, "v"), false);
  const m = new Map(); const good = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.equal(wn.writeSeen(good, "taskflow-v1-a"), true); assert.equal(wn.readSeen(good), "taskflow-v1-a");
});
```

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `node --test tests/offline/whatsnew.test.js`
Expected: FAIL `Cannot find module '../../static/offline/whatsnew.js'`.

- [ ] **Step 3: Implementasikan `static/offline/whatsnew.js`**, lalu tambahkan `<script src>`, entri `STATIC`, `tests/test_app_update_node.py`, dan asersi di `test_whatsnew.py`. Jalankan `git add` file baru.

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/offline/whatsnew.test.js tests/offline/sw_precache_shell.test.js && python -m pytest tests/test_app_update_node.py tests/test_whatsnew.py -q`
Expected: semua PASS.

- [ ] **Step 5: Commit** — `feat(whatsnew): modul TF.whatsnew (pilih catatan, penanda, riwayat)`

---

### Task 4: Modul `static/offline/appupdate.js` dan skrip inline banner

**Files:**
- Create: `static/offline/appupdate.js`
- Create: `tests/offline/app_update_flow.test.js`
- Modify: `static/index.html` (`<script src="/static/offline/appupdate.js"></script>` setelah `whatsnew.js`; ganti seluruh skrip inline terakhir "Service Worker & App Update Detection")
- Modify: `static/sw.js` (`"/static/offline/appupdate.js",` di `STATIC`)
- Modify: `tests/offline/app_update_notifier.test.js` (tes 6: pola yang pindah sekarang dicek di `appupdate.js`)
- Modify: `tests/test_app_update_node.py` (`NODE_TESTS = ["whatsnew", "app_update_flow"]`), `tests/test_whatsnew.py` (asersi `"/static/offline/appupdate.js"` di `STATIC`)

**Interfaces:**
- Produces `TF.appupdate` / `module.exports`:
  - `APPLY_FALLBACK_MS = 5000`
  - `TEXT = { checking: "Mengecek pembaruan...", ready: "Pembaruan tersedia! Silakan muat ulang.", downloading: "Mengunduh pembaruan…", failed: "Pembaruan gagal diunduh, coba lagi saat koneksi stabil.", latest: "Aplikasi sudah dalam versi terbaru", checkFailed: "Gagal memeriksa pembaruan" }`. Jenis toast: `checking`/`ready`/`downloading` → `"info"`, `failed`/`checkFailed` → `"error"`, `latest` → `"success"`.
  - `createAppUpdater({ sw, getRegistration, fetch, reload, setTimeout, toast, pageVersion, onReady }) -> { track(reg), check({manual} = {}) : Promise<void>, apply() : void }`
    - `sw` = `navigator.serviceWorker` atau `null`; *terkendali* = `!!(sw && sw.controller)`, dinilai saat dipanggil.
    - `getRegistration()` → registration atau `null`.
    - `toast(message, type)` boleh `null`.
    - `onReady()` dipanggil saat *siap* (spec §3.1).
    - URL versi: `"/api/version?t=" + Date.now()` dengan `{cache: "no-store", headers: {"Cache-Control": "no-cache"}}`.
    - `watch(worker)` internal: pendengar `statechange` dipasang sekali per worker (`WeakSet`).
  - Perilaku `track` / `check` / `apply` persis spec §3.1, termasuk: pengecekan otomatis tidak pernah memanggil `toast`, dan semua error/penolakan ditelan.
- Consumes: global `window.__SW_VERSION`, `window.showToast` / `window.__showToast`, event `appupdateavailable`, `window.__APP_UPDATE_AVAILABLE` (dipakai `App`).

- [ ] **Step 1: Tulis `tests/offline/app_update_flow.test.js`.** Sediakan fake kecil:
  - `fakeWorker(state)` dengan `postMessage` spy, `addEventListener("statechange")`, dan `set(state)` yang memicu event;
  - `fakeReg({waiting, installing})` dengan `update` spy (bisa diatur menolak atau mengisi `installing`) dan `addEventListener("updatefound")` + `fire()`;
  - `fakeFetch(version | Error)`, serta spy `reload`, `toast`, `onReady`, dan `setTimeout` manual (`flush()`).

  Tes (nama dan asersi):
  1. `track: SW menunggu + terkendali → onReady sekali`
  2. `track: installing sudah ada → onReady setelah state "installed"` (celah C)
  3. `track: updatefound → worker baru → "installed" → onReady`
  4. `auto check terkendali + /api/version beda → reg.update dipanggil, onReady TIDAK dipanggil, toast tidak dipanggil` (bug A)
  5. `auto check terkendali + versi sama → reg.update tidak dipanggil`
  6. `auto check: reg.update menolak (offline) → tidak ada exception, tidak ada toast` (Review Focus 3)
  7. `auto check: fetch versi gagal → diam`
  8. `tidak terkendali + versi beda → onReady`; `sw ada tapi getRegistration() null + versi beda → onReady` (Review Focus 4)
  9. `apply dengan reg.waiting → postMessage({type:"SKIP_WAITING"}) ke worker menunggu, bukan ke sw.controller; reload setelah 5000 ms` (bug B)
  10. `apply tanpa SW menunggu → reload langsung`
  11. `manual: waiting → toast ready "info"`; `manual: installing → toast downloading lalu failed saat "redundant"`; `manual: installing → toast ready saat "installed"`; `manual: tidak ada update → toast latest "success"`; `manual: reg.update menolak → toast checkFailed "error"`
  12. `skrip inline index.html: tanpa TF.appupdate tetap register("/sw.js") pada load dan reload sekali pada controllerchange`. Ambil `<script>` terakhir yang memuat `window.applyAppUpdate` dari `static/index.html`, jalankan di `vm.createContext` dengan stub `window` (tanpa `TF`), `navigator.serviceWorker` (register spy → Promise reg palsu, `addEventListener`), `document`, `location.reload` spy, `setInterval`; picu `load` lalu dua kali `controllerchange` → `register` dipanggil dengan `"/sw.js"` dan `reload` dipanggil tepat 1 kali.

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `node --test tests/offline/app_update_flow.test.js`
Expected: seluruh file FAIL dengan `Cannot find module '../../static/offline/appupdate.js'`. Tes 12 adalah penjaga regresi untuk skrip inline baru.

- [ ] **Step 3: Implementasikan `static/offline/appupdate.js`.**

- [ ] **Step 4: Ganti skrip inline terakhir `index.html`.**
  - Pertahankan `window.__APP_VERSION = "4.0.0"`, `window.__SW_REGISTRATION`, `window.__APP_UPDATE_AVAILABLE`, `notifyAppUpdateAvailable()`.
  - Buat updater bila `window.TF && window.TF.appupdate`, dengan:
    - `sw: navigator.serviceWorker || null`
    - `getRegistration: () => window.__SW_REGISTRATION`
    - `fetch: window.fetch.bind(window)`
    - `reload: () => window.location.reload()`
    - `setTimeout: window.setTimeout.bind(window)`
    - `toast: (m, t) => { const f = window.showToast || window.__showToast; if (typeof f === "function") f(m, t); }`
    - `pageVersion: window.__SW_VERSION`
    - `onReady: notifyAppUpdateAvailable`
  - `window.applyAppUpdate` = `updater ? updater.apply() : location.reload()`; `window.checkForAppUpdate(opts)` = `updater ? updater.check(opts) : Promise.resolve()`.
  - Di luar kondisi updater (`if ("serviceWorker" in navigator)`):
    - pendengar `controllerchange` dengan penjaga `refreshing`;
    - `load` → `register("/sw.js", {scope: "/"})` → set `__SW_REGISTRATION`, `updater && updater.track(reg)`, `reg.update().catch(() => {})`;
    - `visibilitychange` visible → `checkForAppUpdate()`;
    - `setInterval(checkForAppUpdate, 1800000)`.

  Lalu tambahkan `<script src>`, entri `STATIC`, `NODE_TESTS`, dan asersi `test_whatsnew.py`; perbarui tes 6 `app_update_notifier.test.js`. Jalankan `git add`.

- [ ] **Step 5: Jalankan tes**

Run: `node --test tests/offline/app_update_flow.test.js tests/offline/app_update_notifier.test.js tests/offline/sw_precache_shell.test.js && python -m pytest tests/test_app_update_node.py tests/test_whatsnew.py -q && node temporary_files/check_inline_scripts.js static/index.html`
Expected: semua PASS; inline OK.

- [ ] **Step 6: Commit** — `fix(update): banner hanya dari SW menunggu; logika ke TF.appupdate`

---

### Task 5: Modal "Apa yang baru", tombol Pengaturan, banner tanpa emoji

**Files:**
- Modify: `static/index.html`
  - skrip awal `<body>` (dekat `window.__SW_VERSION = …`): tambahkan `window.__TF_HAD_USER_AT_LOAD`;
  - komponen baru `WhatsNewModal` dan hook `useWhatsNewOnLoad` di atas `function App()`, dekat `UpdateNotificationBanner`;
  - `UpdateNotificationBanner`;
  - `App` (panggil hook dan render modal di cabang login);
  - `SettingsPage` (kartu "Pembaruan Aplikasi");
  - `<link … app.css?v=364>`.
- Modify: `static/app.css` (tambahkan blok `.whatsnew-*` di akhir file)
- Modify: `static/sw.js` (`"/static/app.css?v=364"`)
- Create: `tests/offline/whatsnew_ui.test.js`
- Modify: `tests/offline/app_update_notifier.test.js` (tes 5 dan 7: emoji diganti ikon / teks baru)

**Interfaces:**
- Consumes: `TF.whatsnew` (Task 3); `window.applyAppUpdate` (Task 4); `Icon({name, size})`; `showToast` di `SettingsPage`.
- Produces:
  - `window.__TF_HAD_USER_AT_LOAD: boolean` = `!!(localStorage.getItem("tf_user_id") || localStorage.getItem("tf_token"))`, dibungkus try/catch → `false`.
  - `WhatsNewModal({ entries, hiddenCount, onClose })`, struktur dan teks persis spec §3.6:
    - `div.modal-overlay.whatsnew-overlay` (klik pada overlay itu sendiri → `onClose`);
    - `div.modal-content.whatsnew-modal` dengan `role="dialog"`, `aria-modal="true"`, `aria-labelledby="whatsnew-title"`;
    - `h2#whatsnew-title` "Apa yang baru di Alurik", tombol ✕ `aria-label="Tutup"` (`Icon x`);
    - per entri `section.whatsnew-release`: `h3.whatsnew-release-title` + `span.whatsnew-date` (`formatDate`);
    - `div.whatsnew-group` "Baru" (`Icon sparkles`) / "Diperbaiki" (`Icon wrench`) berisi `ul > li` (teks);
    - `p.whatsnew-more` "dan N pembaruan lain sebelumnya" bila `hiddenCount > 0`;
    - tombol `btn btn-primary` "Mengerti" yang menerima fokus saat terbuka;
    - Esc (keydown di `document`) → `onClose`.
  - `useWhatsNewOnLoad(user) -> { modal: {entries, hiddenCount} | null, close(): void }`, alur spec §3.5 langkah 1–6:
    - berjalan sekali per pemuatan halaman (flag modul `_whatsNewStarted`), dimulai saat `user` terisi;
    - tunda selama `document.body.classList.contains("driver-active")`, dicek ulang tiap 1000 ms;
    - `TF.whatsnew.load(window.fetch.bind(window))`;
    - penanda lewat `readSeen` / `writeSeen(localStorage, …)`;
    - pendengar `storage` aktif selama `modal` tidak null.

- [ ] **Step 1: Tulis `tests/offline/whatsnew_ui.test.js`** (pola `fnSource` dari `app_update_notifier.test.js`):

```js
test("WhatsNewModal: dialog aksesibel, teks Indonesia, tanpa HTML mentah", () => {
  const s = fnSource("WhatsNewModal");
  for (const re of [/role: "dialog"/, /"aria-modal": "true"/, /"aria-labelledby": "whatsnew-title"/, /Apa yang baru di Alurik/,
                    /"Baru"/, /"Diperbaiki"/, /Mengerti/, /pembaruan lain sebelumnya/, /name: "sparkles"/, /name: "wrench"/, /Escape/])
    assert.match(s, re);
  assert.doesNotMatch(s, /dangerouslySetInnerHTML/);
});
test("useWhatsNewOnLoad: penanda, tur, storage, sekali per muat", () => {
  const s = fnSource("useWhatsNewOnLoad");
  for (const re of [/TF\.whatsnew\.load/, /pickUnseen/, /shouldMarkSeen/, /writeSeen/, /driver-active/, /"storage"/, /__TF_HAD_USER_AT_LOAD/, /_whatsNewStarted/])
    assert.match(s, re);
});
test("App memanggil hook dan merender WhatsNewModal", () => {
  const s = fnSource("App");
  assert.match(s, /useWhatsNewOnLoad\(user\)/);
  assert.match(s, /React\.createElement\(WhatsNewModal/);
});
test("__TF_HAD_USER_AT_LOAD diset di skrip awal body sebelum skrip aplikasi", () => {
  const i = indexHtml.indexOf("window.__TF_HAD_USER_AT_LOAD");
  assert.ok(i > 0 && i < indexHtml.indexOf('<script src="/static/offline/'));
});
test("penanda tidak ikut dihapus saat logout", () => {
  assert.doesNotMatch(fnSource("clearLocalUserData"), /tf_whatsnew_seen/);
});
test("SettingsPage: tombol Apa yang baru (riwayat) + Cek Pembaruan tanpa emoji", () => {
  const s = fnSource("SettingsPage");
  assert.match(s, /Apa yang baru/); assert.match(s, /TF\.whatsnew\.history/);
  assert.match(s, /Catatan pembaruan belum tersedia/); assert.doesNotMatch(s, /🔍/);
});
test("UpdateNotificationBanner: ikon, bukan emoji; status Memperbarui…", () => {
  const s = fnSource("UpdateNotificationBanner");
  assert.doesNotMatch(s, /🚀|🔄/); assert.match(s, /Memperbarui…/); assert.match(s, /disabled/);
});
test("app.css: gaya modal + mode gelap + versi cocok dengan STATIC", () => {
  assert.match(appCss, /\.whatsnew-modal\s*\{/); assert.match(appCss, /\[data-theme="dark"\][^{]*\.whatsnew-/);
  assert.match(indexHtml, /app\.css\?v=364/); assert.match(swJs, /"\/static\/app\.css\?v=364"/);
});
```

(`clearLocalUserData` adalah `async function`. Tambahkan `fnSource` yang juga mencari `async function ${name}(`.)

- [ ] **Step 2: Jalankan dan pastikan gagal**

Run: `node --test tests/offline/whatsnew_ui.test.js`
Expected: FAIL pada semua tes kecuali "penanda tidak ikut dihapus saat logout".

- [ ] **Step 3: Implementasikan UI.**
  - `UpdateNotificationBanner`: state `updating`; klik → `setUpdating(true)` lalu `applyAppUpdate()`; label "Memperbarui…"; `disabled: updating`; ikon `Icon sparkles` (depan) dan `Icon refresh` (tombol).
  - `SettingsPage`: tombol "Cek Pembaruan" memakai `Icon search`. Tombol baru `btn btn-secondary` "Apa yang baru" (`Icon sparkles`) memuat `TF.whatsnew.load`, lalu `history({entries, current: window.__SW_VERSION})`. Hasil kosong/null → `showToast("Catatan pembaruan belum tersedia", "info")`; selain itu render `WhatsNewModal` dengan `hiddenCount: 0`. Tombol ini tidak menyentuh penanda.
  - `app.css`:
    - `.whatsnew-modal` (max-width 520px; `max-height: 80vh`; isi `.whatsnew-list` bisa digulir; tombol "Mengerti" di footer yang selalu terlihat);
    - `@media (max-width: 600px)` → `width: calc(100% - 32px)`;
    - jarak antar rilis memakai `gap` / margin, bukan garis aksen kiri;
    - warna dari variabel tema, ditambah aturan `[data-theme="dark"] .whatsnew-…` untuk tanggal dan judul grup.

- [ ] **Step 4: Jalankan tes**

Run: `node --test tests/offline/whatsnew_ui.test.js tests/offline/app_update_notifier.test.js tests/offline/sw_precache_shell.test.js && node temporary_files/check_inline_scripts.js static/index.html && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: semua PASS; inline OK; `npm test` hanya gagal 1 (`draw_local_reactive`).

- [ ] **Step 5: Commit** — `feat(whatsnew): modal Apa yang baru + riwayat di Pengaturan; banner tanpa emoji; app.css v364`

---

### Task 6: E2E Playwright, ADR-030, verifikasi penuh

**Files:**
- Create: `temporary_files/e2e_apa_yang_baru.py` (pola `temporary_files/e2e_sw_precache_shell.py`: salin repo, uvicorn, `register`/`login` via localStorage, konteks persisten, `E2E_REPO` untuk membandingkan dengan `main`, screenshot ke `temporary_files/e2e_apa_yang_baru/`, keluar non-zero bila ada langkah gagal)
- Modify: `.agents/DECISIONS.md` (ADR-030 sesuai spec §8)

**Interfaces:**
- Consumes: semua task sebelumnya. Membaca `CACHE` dari `static/sw.js` salinan; versi rilis uji `taskflow-v998-e2e` / `taskflow-v999-e2e`. Setiap rilis uji juga menambahkan entri teratas yang cocok (judul `Rilis uji E2E`) ke `whatsnew.json` salinan bila file itu ada, supaya modal punya isi yang bisa diperiksa.

- [ ] **Step 1: Tulis skenario** (setiap langkah memanggil `check(step, ok, note)`):
  1. `d1–d3` deploy tanpa restart: SW aktif di versi awal, lalu `CACHE` (dan `__SW_VERSION`) di salinan diubah ke rilis uji **tanpa me-restart uvicorn**. Banner muncul, satu klik → versi uji. Setelah itu picu `visibilitychange` dan `checkForAppUpdate()` → `.update-notification-banner` tidak muncul lagi selama 5 detik. Di `main` langkah ini gagal karena `sw_cache` di `webapp.py` masih versi awal (bug A).
  2. `w1–w3`: banner baru ada setelah `reg.waiting`; satu klik → `window.__SW_VERSION` = rilis uji; banner tidak kembali setelah `checkForAppUpdate()`.
  3. `m1–m3`: setelah reload, `.whatsnew-modal` tampil berisi judul entri rilis uji. "Mengerti" → `tf_whatsnew_seen` = rilis uji. Lalu `context.set_offline(True)`, hapus penanda, reload → modal tetap tampil dari cache.
  4. `t1`: dua tab terbuka dengan modal, tutup di tab A → modal di tab B hilang dalam 2 detik.
  5. `n1`: profil baru, login di halaman → tidak ada modal setelah 3 detik, dan `tf_whatsnew_seen` = versi sekarang.
  6. `s1–s2`: Pengaturan → "Apa yang baru" → modal riwayat berisi ≥ 2 rilis; screenshot 375 px terang + gelap, tombol "Mengerti" terlihat di viewport.

- [ ] **Step 2: Jalankan di branch dan di `main`**

Run: `python3 temporary_files/e2e_apa_yang_baru.py` lalu `git worktree add /tmp/wt-main origin/main && E2E_REPO=/tmp/wt-main python3 temporary_files/e2e_apa_yang_baru.py`
Expected: branch 0 gagal. `main` gagal di `d*` / `w*` (bug A/B) dan `m*` / `t*` / `n*` / `s*` (fitur belum ada).

- [ ] **Step 3: Tambahkan ADR-030** ke `.agents/DECISIONS.md` (format ADR-029: Date, Agent, Context, Decision, Consequences, isi spec §8).

- [ ] **Step 4: Verifikasi penuh**

Run: `python -m pytest tests/ -q && npm test 2>&1 | grep -E "^# (tests|pass|fail)" && node temporary_files/check_inline_scripts.js static/index.html && node --test tests/build-tauri-dist.test.js`
Expected: pytest ≥ 1162 passed + tes baru, 0 failed; `npm test` hanya gagal 1 (`draw_local_reactive`); inline OK; build-tauri PASS.

- [ ] **Step 5: Commit** — `test(e2e): banner pembaruan + modal Apa yang baru; ADR-030`
