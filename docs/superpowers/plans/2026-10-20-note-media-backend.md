# Rencana: Audio & Video di Note — PR backend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Tanggal: 2026-10-20 · Agent: Claude · Branch: `claude/note-media-backend` · **Backend saja, tanpa frontend, tanpa kenaikan SW**

**Goal:** Server bisa menerima unggahan audio/video bertahap untuk sebuah note, memprosesnya ringan (ffprobe, faststart, poster), dan menyajikannya dengan Range lewat URL bertanda tangan (nginx `X-Accel-Redirect`) ke orang yang bisa membuka note dan ke pengunjung halaman publiknya.

**Architecture:**
- Media = baris `note_attachments` dengan `kind='media'` dan kolom baru. Snapshot Sampah dan restore yang sudah ada otomatis membawanya.
- Logika di empat modul baru tanpa dependensi ke `webapp.py`:
  - `media_storage.py`: kunci file + `LocalStorage`;
  - `media_probe.py`: sniff magic bytes, parse ffprobe, deteksi faststart, perintah ffmpeg;
  - `media_worker.py`: antrean pemrosesan satu thread;
  - `media_serve.py`: token HMAC, parse Range, header respons.
- Endpoint, akses, siklus hidup, dan render halaman publik tetap di `webapp.py` (pola `drawing_scope.py`/`safehtml.py`).

**Tech Stack:** Python 3.12, FastAPI, SQLite, pytest + Starlette TestClient, ffmpeg/ffprobe (subprocess), nginx.

**Spec:** `docs/superpowers/specs/2026-10-19-note-media-audio-video-design.md` (§2–§8, §10–§12). PR frontend (§9) direncanakan terpisah.

## Global Constraints

- **Konfigurasi (`config.py`, dibaca dari env):**
  - `MEDIA_STORAGE="local"`;
  - `MEDIA_ROOT="/var/lib/alurik/media"`;
  - `MEDIA_MAX_FILE_MB=2048`;
  - `MEDIA_CHUNK_MB=5`;
  - `MEDIA_URL_SECRET=""` (kosong → turunan `hmac(SECRET_KEY, b"alurik-media-url")` + `logger.warning` saat start);
  - `MEDIA_ACCEL=1`;
  - `MEDIA_URL_TTL_SEC=21600`;
  - `MEDIA_STUCK_HOURS=24`.
- **Body `PATCH`** ≤ `MEDIA_CHUNK_MB + 1` MB. Header `Upload-Offset` wajib.
- **Kunci file:**
  - media: `<yyyy>/<mm>/<uuid4><ext>`;
  - poster: `<yyyy>/<mm>/<uuid4>.poster.jpg`;
  - potongan sementara: `MEDIA_ROOT/.tmp/<att_id>.part`.
  - Kunci divalidasi dengan regex `^\d{4}/\d{2}/[0-9a-f-]{36}(\.poster\.jpg|\.[a-z0-9]{2,4})$` sebelum menyentuh disk.
- **Token:** `b64url("{att_id}.{variant}.{exp}") + "." + b64url(hmac_sha256(secret, payload))`, tanpa padding.
  - `variant ∈ {play, poster, download}`;
  - dibandingkan dengan `hmac.compare_digest`.
- **Header `/media/{token}`:**
  - `X-Content-Type-Options: nosniff`;
  - `Content-Security-Policy: sandbox; default-src 'none'`;
  - `Cache-Control: private, max-age=<sisa detik token>`;
  - `Accept-Ranges: bytes`;
  - `Content-Disposition` `inline` (play/poster) atau `attachment` (download), dengan `filename*=UTF-8''…` bila non-ASCII.
- **Status baris:** `uploading → processing → ready | failed`.
  - Baris lama: `kind='file'`, `storage='nextcloud'`, `status='ready'`.
  - Baris media: `nextcloud_path=''`.
- **Semua penolakan akses = 404** dengan detail `"Media tidak ditemukan"` (lampiran lama: `"Attachment tidak ditemukan"`).
- **Teks kartu tidak tersedia (halaman publik):** `Media tidak tersedia`.
- **Pesan gagal ffprobe:** `File tidak bisa dibaca sebagai audio/video`.
- **Format** (ekstensi nama file yang diterima saat init → hasil sniff menentukan mime final):

| Keluarga sniff | Signature | ext kunci | mime audio / video |
|---|---|---|---|
| `isobmff` brand `M4A `/`M4B ` | `ftyp` di offset 4 | `.m4a` | `audio/mp4` / — |
| `isobmff` brand `qt  ` | `ftyp` | `.mov` | — / `video/quicktime` |
| `isobmff` brand `3gp*`/`3g2*` | `ftyp` | `.3gp` | `audio/3gpp` / `video/3gpp` |
| `isobmff` brand `isom iso2 iso4 iso5 iso6 mp41 mp42 avc1 dash MSNV M4V ` | `ftyp` | `.mp4` | `audio/mp4` / `video/mp4` |
| `mpeg_audio` | `ID3`, atau 2 byte pertama `& 0xFFE0 == 0xFFE0` | `.mp3` | `audio/mpeg` (format ffprobe `aac` → `audio/aac`) / — |
| `ogg` | `OggS` | `.ogg` | `audio/ogg` / `video/ogg` |
| `wav` | `RIFF` + `WAVE` di offset 8 | `.wav` | `audio/wav` / — |
| `matroska` doctype `webm` | `1A 45 DF A3`, `webm` di 64 byte pertama | `.webm` | `audio/webm` / `video/webm` |
| `matroska` lainnya | `1A 45 DF A3` | `.mkv` | `audio/x-matroska` / `video/x-matroska` |
| `flac` | `fLaC` | `.flac` | `audio/flac` / — |
| `amr` | `#!AMR` | `.amr` | `audio/amr` / — |

  - Brand ftyp lain (mis. `heic`, `mif1`, `avif`) dan signature lain ditolak.
  - Ekstensi nama file yang diterima saat init: `mp3 m4a m4b aac wav ogg oga opus webm flac amr 3gp 3g2 mp4 m4v mov mkv`.
  - `media_type` awal: `video` untuk `.mov/.mp4/.webm/.mkv/.3gp` dari sniff, selain itu `audio`. Worker memperbaikinya dari ffprobe.
- **Deploy:** `restart taskflow-web` saja (`repository.py` tidak disentuh). Kolom baru ditambah di `migrate_db()` di `webapp.py`.

## Review Focus

1. **Klien mengirim ulang potongan yang sama setelah respons hilang** (offset = `received_bytes` lama, atau lebih kecil dari `received_bytes`). Server harus menjawab 409 + `received_bytes` tanpa merusak file. Menulis di offset yang sama dua kali menghasilkan file identik (seek + truncate). → Task 4.
2. **Dua `PATCH` bersamaan untuk lampiran yang sama** (dua tab). Hanya satu yang menulis, yang lain 409. → Task 4 (lock per lampiran).
3. **Isi note bersama berisi `::media[<client_id lampiran note lain>]`**, baik di halaman publik, ekspor DOCX, maupun `by-client`. Tidak ada URL, tidak ada nama file, cukup kartu `Media tidak tersedia`. → Task 4 (`by-client` dibatasi `note_id`), Task 8 (publik + DOCX).
4. **Note dibuang ke Sampah lalu dipulihkan saat media sedang `processing`.** Worker tidak boleh crash karena barisnya hilang, dan baris yang dipulihkan berstatus `processing` diantrekan lagi saat start. → Task 3 (`process` pada id hilang = no-op), Task 7.
5. **Nama file berbahaya** (`../../etc/passwd.mp4`, `"><script>.mp3`, nama 300 karakter, non-ASCII). Tidak pernah jadi path; di `Content-Disposition` disanitasi; di HTML publik di-escape. → Task 2 (kunci dari uuid), Task 5 (header), Task 8 (HTML).

---

### Task 1: Konfigurasi + migrasi kolom media

**Files:**
- Modify: `config.py` (blok baru setelah `# File attachments`)
- Modify: `webapp.py` (`from config import …` baris ~134; `migrate_db()` ~267; `startup()` ~1519)
- Modify: `tests/conftest.py` (env `MEDIA_ROOT` ke temp, `MEDIA_ACCEL=0`, sebelum `import webapp`)
- Test: `tests/test_note_media_schema.py`

**Interfaces:**
- Produces:
  - konstanta `webapp.MEDIA_ROOT`, `MEDIA_MAX_FILE_BYTES`, `MEDIA_CHUNK_BYTES`, `MEDIA_ACCEL` (bool), `MEDIA_URL_TTL_SEC`, `MEDIA_STUCK_HOURS`, `MEDIA_URL_SECRET_BYTES` (bytes, sudah diturunkan);
  - kolom §4.1 spec di `note_attachments`;
  - indeks unik `ux_note_attachments_client`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_note_attachments_media_columns():
    cols = {r["name"]: r for r in db().execute("PRAGMA table_info(note_attachments)")}
    for c in ["kind","client_id","storage","storage_key","status","media_type","duration_ms","video_codec",
              "audio_codec","width","height","poster_key","received_bytes","error","updated_at"]:
        assert c in cols
    assert cols["kind"]["dflt_value"] == "'file'" and cols["storage"]["dflt_value"] == "'nextcloud'"
    assert cols["status"]["dflt_value"] == "'ready'" and cols["received_bytes"]["dflt_value"] == "0"

def test_migrate_db_idempotent():
    webapp.migrate_db(); webapp.migrate_db()   # tidak melempar

def test_client_id_unique_per_user():
    # dua baris user sama + client_id sama → IntegrityError; client_id NULL boleh berulang
    ...

def test_media_secret_derived_when_unset():
    assert isinstance(webapp.MEDIA_URL_SECRET_BYTES, bytes) and len(webapp.MEDIA_URL_SECRET_BYTES) == 32
```

- [ ] **Step 2: Jalankan → FAIL**

`python -m pytest tests/test_note_media_schema.py -q` → FAIL (kolom tidak ada).

- [ ] **Step 3: Implementasi**
  - `config.py`: konstanta dari Global Constraints.
  - `webapp.py`:
    - impor konstanta;
    - `MEDIA_URL_SECRET_BYTES = cfg.encode() if cfg else hmac.new(SECRET_KEY.encode(), b"alurik-media-url", "sha256").digest()`;
    - di `migrate_db()`: `ALTER TABLE` per kolom yang belum ada (cek `PRAGMA table_info`, pola kolom `pinned`) + `CREATE UNIQUE INDEX IF NOT EXISTS ux_note_attachments_client ON note_attachments(user_id, client_id) WHERE client_id IS NOT NULL`;
    - `startup()`: `os.makedirs(MEDIA_ROOT/.tmp, exist_ok=True)` dalam `try` (gagal → `logger.warning`, app tetap jalan); peringatan bila `MEDIA_URL_SECRET` kosong.

- [ ] **Step 4: Jalankan → PASS**, lalu `python -m pytest tests/ -q` tetap hijau.

- [ ] **Step 5: Commit** `feat(media): konfigurasi dan kolom media di note_attachments`

---

### Task 2: Penyimpanan, sniff, dan token (modul murni)

**Files:**
- Create: `media_storage.py`, `media_probe.py` (bagian sniff), `media_serve.py`
- Test: `tests/test_media_primitives.py`

**Interfaces:**
- Produces (`media_storage.py`):
  - `new_key(ext: str, now: datetime) -> str`;
  - `poster_key_for(key: str) -> str`;
  - `is_valid_key(key: str) -> bool`;
  - `class LocalStorage(root: Path)` dengan:
    - `temp_path(att_id: int) -> Path`;
    - `commit(key: str, src: Path) -> None` (`os.replace`, buat folder);
    - `path(key: str) -> Path` (ValueError bila kunci tidak valid);
    - `delete(key: str | None) -> None` (diam bila tidak ada);
    - `accel_uri(key: str) -> str` = `"/_alurik_media/" + key`.
  - `get_storage(name: str, root: str) -> LocalStorage`; `"r2"` → `NotImplementedError`.
- Produces (`media_probe.py`):
  - `@dataclass Sniff(family: str, brand: str, ext: str, default_media_type: str)`;
  - `sniff_media(head: bytes) -> Sniff | None` (membaca ≤ 64 byte pertama);
  - `final_mime(s: Sniff, media_type: str, format_name: str = "") -> str` (tabel Global Constraints);
  - `ALLOWED_INIT_EXTS: frozenset[str]`.
- Produces (`media_serve.py`):
  - `sign_token(att_id: int, variant: str, exp: int, secret: bytes) -> str`;
  - `verify_token(token: str, secret: bytes, now: int) -> tuple[int, str, int] | None` (att_id, variant, exp);
  - `parse_range(header: str | None, size: int) -> tuple[int, int] | None | "invalid"` (byte range tunggal, inklusif; `None` = tanpa Range; `"invalid"` → 416);
  - `content_disposition(disposition: str, name: str) -> str`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
@pytest.mark.parametrize("head,family,ext", [
    (b"\x00\x00\x00\x20ftypM4A \x00", "isobmff", ".m4a"),
    (b"\x00\x00\x00\x14ftypqt  \x00", "isobmff", ".mov"),
    (b"\x00\x00\x00\x18ftypisom\x00", "isobmff", ".mp4"),
    (b"\x00\x00\x00\x18ftyp3gp5\x00", "isobmff", ".3gp"),
    (b"ID3\x04\x00", "mpeg_audio", ".mp3"), (b"\xff\xfb\x90\x00", "mpeg_audio", ".mp3"),
    (b"OggS\x00\x02", "ogg", ".ogg"), (b"RIFF\x24\x00\x00\x00WAVEfmt ", "wav", ".wav"),
    (b"\x1aE\xdf\xa3\x9fB\x86\x81\x01B\x82\x84webm", "matroska", ".webm"),
    (b"\x1aE\xdf\xa3\x9fB\x82\x88matroska", "matroska", ".mkv"),
    (b"fLaC\x00", "flac", ".flac"), (b"#!AMR\n", "amr", ".amr"),
])
def test_sniff_accepts(head, family, ext): ...

@pytest.mark.parametrize("head", [b"<!doctype html><script>", b"<svg xmlns", b"%PDF-1.7",
    b"\x00\x00\x00\x18ftypheic\x00", b"\x89PNG\r\n", b"", b"\x00\x00\x00\x18ftypavif"])
def test_sniff_rejects(head): assert sniff_media(head) is None

def test_final_mime_audio_only_mp4_is_audio_mp4(): ...
def test_final_mime_mpeg_audio_aac_format(): assert final_mime(s_mp3, "audio", "aac") == "audio/aac"

def test_keys_never_from_filename(tmp_path):
    st = LocalStorage(tmp_path); k = new_key(".mp4", datetime(2026, 10, 20))
    assert re.fullmatch(r"2026/10/[0-9a-f-]{36}\.mp4", k) and poster_key_for(k).endswith(".poster.jpg")
    for bad in ["../x.mp4", "2026/10/../../etc/passwd", "/abs.mp4", "2026/10/abc.mp4"]:
        with pytest.raises(ValueError): st.path(bad)

def test_token_roundtrip_and_tamper():
    t = sign_token(7, "play", 2000, b"k"*32)
    assert verify_token(t, b"k"*32, 1999) == (7, "play", 2000)
    assert verify_token(t, b"k"*32, 2001) is None              # kedaluwarsa
    assert verify_token(t, b"x"*32, 1999) is None              # secret lain
    assert verify_token(t.replace("play", "down"), b"k"*32, 1999) is None
    assert verify_token("a.b.c", b"k"*32, 0) is None and verify_token("", b"k"*32, 0) is None

@pytest.mark.parametrize("h,size,exp", [(None,100,None), ("bytes=0-",100,(0,99)), ("bytes=10-19",100,(10,19)),
    ("bytes=-10",100,(90,99)), ("bytes=90-200",100,(90,99)), ("bytes=100-",100,"invalid"),
    ("bytes=5-1",100,"invalid"), ("bytes=0-1,5-6",100,(0,1)), ("items=0-1",100,None)])
def test_parse_range(h, size, exp): assert parse_range(h, size) == exp

def test_content_disposition_sanitizes():
    v = content_disposition("attachment", 'a"b\r\nc é.mp3')
    assert '\r' not in v and '\n' not in v and 'filename="a_b__c _.mp3"' in v and "filename*=UTF-8''" in v
```

Range dengan banyak rentang: hanya rentang pertama yang dilayani (`(0,1)`). Unit selain `bytes`: Range diabaikan (`None`).

- [ ] **Step 2: Jalankan → FAIL** (`ModuleNotFoundError`).
- [ ] **Step 3: Implementasi tiga modul** sesuai Interfaces. Modul tidak boleh mengimpor `webapp`.
- [ ] **Step 4: Jalankan → PASS.**
- [ ] **Step 5: Commit** `feat(media): penyimpanan lokal, sniff format, token URL, parser Range`

---

### Task 3: Worker pemrosesan (ffprobe, faststart, poster)

**Files:**
- Modify: `media_probe.py` (bagian probe/ffmpeg)
- Create: `media_worker.py`
- Modify: `.github/workflows/test.yml` (langkah `sudo apt-get update && sudo apt-get install -y ffmpeg` sebelum `Run tests`)
- Test: `tests/test_media_worker.py`, `tests/fixtures/media/` (dibuat tes saat runtime dengan ffmpeg bila tersedia; tidak ada file biner di repo)

**Interfaces:**
- Consumes: `Sniff`, `sniff_media`, `final_mime`, `LocalStorage`, `poster_key_for` (Task 2).
- Produces (`media_probe.py`):
  - `@dataclass ProbeInfo(media_type, duration_ms, video_codec, audio_codec, width, height, format_name)`;
  - `parse_probe(data: dict) -> ProbeInfo | None` (None bila tidak ada stream audio/video). Stream video dengan `disposition.attached_pic == 1` tidak dihitung video;
  - `needs_faststart(path: Path) -> bool` (scan atom top-level: `True` bila `mdat` muncul sebelum `moov`; berhenti setelah keduanya ketemu; atom ukuran 1 = ukuran 64-bit; ukuran 0 = sampai akhir file);
  - `run_ffprobe(path, bin="ffprobe", timeout=60) -> dict | None`;
  - `remux_faststart(src, dst, bin="ffmpeg", timeout=600) -> bool`;
  - `make_poster(src, dst, at_sec: float, bin="ffmpeg", timeout=60) -> bool`.
  - Semua subprocess memakai list argumen, tanpa shell.
  - Perintah ffmpeg persis seperti spec §5.2: `-c copy -map 0 -movflags +faststart` dan `-ss <t> -i in -frames:v 1 -vf scale=640:-2`.
- Produces (`media_worker.py`):
  - `class MediaWorker(connect: Callable[[], sqlite3.Connection], storage: LocalStorage, ffmpeg: str | None, ffprobe: str | None)`;
  - `enqueue(att_id: int) -> None`;
  - `start() -> None` (thread daemon, satu file per waktu);
  - `process(att_id: int) -> None` (sinkron);
  - `run_pending() -> int` (proses antrean sinkron untuk tes; mengembalikan jumlah);
  - `requeue_processing() -> int`.
  - Di `webapp.py`: `media_worker = MediaWorker(...)` di tingkat modul, `shutil.which("ffmpeg")`/`which("ffprobe")`; `startup()` memanggil `requeue_processing()` lalu `start()`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_parse_probe_video_and_audio_only(): ...   # dict ffprobe tiruan: video h264 1280x720 + aac → video; mp3+cover → audio
def test_parse_probe_no_streams_returns_none(): ...
def test_needs_faststart_detects_moov_after_mdat(tmp_path): ...   # file tiruan: ftyp|mdat|moov → True; ftyp|moov|mdat → False

def test_process_ready_with_metadata(tmp_path, monkeypatch):
    # baris processing + file; run_ffprobe di-monkeypatch → status ready, duration_ms, codec, width/height,
    # mime_type dari final_mime, updated_at terisi
def test_process_probe_fail_marks_failed_and_deletes_file(...):
    # run_ffprobe → None → status failed, error == "File tidak bisa dibaca sebagai audio/video", file hilang
def test_process_faststart_only_when_needed(...)   # remux dipanggil hanya bila needs_faststart True; gagal remux → tetap ready
def test_process_poster_for_video_only(...)        # poster_key terisi untuk video; make_poster gagal → ready tanpa poster_key
def test_process_without_ffmpeg_marks_ready(...)   # ffprobe=None → ready tanpa metadata, media_type dari sniff
def test_process_missing_row_is_noop(...)          # id tidak ada / status bukan processing → tidak melempar
def test_requeue_processing_enqueues_rows(...)

@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg tidak terpasang")
def test_integration_real_ffmpeg(tmp_path):
    # buat video 2 dtk lavfi testsrc + sine → mp4 TANPA faststart; process → ready, duration_ms≈2000,
    # needs_faststart(file) False setelah proses, poster ada di disk
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi** sesuai Interfaces. Urutan `process`:
  1. baca baris (status harus `processing`);
  2. ffprobe;
  3. faststart (keluarga `isobmff` saja, tulis ke file sementara lalu `os.replace`);
  4. poster video pada `min(1.0, duration_s/10)`;
  5. `UPDATE … status='ready'`.

  Setiap `UPDATE` memakai `WHERE id=? AND status='processing'`, supaya baris yang dihapus atau dibuang ke Sampah selama proses tidak bangkit lagi. Bila `UPDATE` tidak mengenai baris (rowcount 0), hapus poster yang baru dibuat.

  Exception apa pun di `process` dicatat ke log dan ditelan, supaya thread tidak mati.
- [ ] **Step 4: Jalankan → PASS** (tes integrasi jalan di sandbox; ffmpeg ada di `/usr/bin`).
- [ ] **Step 5: Commit** `feat(media): worker ffprobe/faststart/poster + ffmpeg di CI`

---

### Task 4: Endpoint unggah bertahap

**Files:**
- Modify: `webapp.py` (blok baru setelah endpoint lampiran note, ~5780)
- Test: `tests/test_note_media_upload.py` (helper akun/workspace dari `tests/drawing_ws_helpers.py`)

**Interfaces:**
- Consumes: `LocalStorage`, `new_key`, `sniff_media`, `ALLOWED_INIT_EXTS` (Task 2); `media_worker.enqueue` (Task 3); `_note_access_clause` (ada).
- Produces:
  - `_accessible_note(conn, uid, note_id) -> sqlite3.Row | None`;
  - `_accessible_attachment(conn, uid, att_id) -> sqlite3.Row | None` (join `scratchpad_notes` + klausa akses; kolom tambahan `note_owner_id`);
  - `_media_quota_check(conn, uid: int, size: int) -> None` (v1 no-op; komentar: titik pasang sesi kuota);
  - `_media_payload(conn, row, now: int) -> dict` (bentuk respons §6.1 + `uploaded_by_name` dari `users.display_name`/`username`; URL `None` bila bukan `ready`; di Task 4 kunci URL selalu `None`, Task 5 mengisinya lewat `_media_urls`);
  - `media_storage` (instance `LocalStorage` tingkat modul).
- Endpoint:
  - `POST /api/scratchpad/{note_id}/media` body `{client_id, filename, size, mime}`;
  - `GET /api/media/{att_id}/upload`;
  - `PATCH /api/media/{att_id}/upload`;
  - `POST /api/media/{att_id}/complete`.
- Validasi `client_id`: `^[0-9a-zA-Z_-]{1,64}$` (sama dengan regex direktif).

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_init_owner_and_member_ok_outsider_404(client): ...
def test_init_rejects_size_over_limit_413_and_bad_ext_415(client, monkeypatch): ...  # monkeypatch MEDIA_MAX_FILE_BYTES kecil
def test_init_idempotent_same_client_id_returns_same_row_with_progress(client): ...
def test_init_client_id_used_on_other_note_409(client): ...
def test_init_invalid_client_id_400(client): ...
def test_patch_sequence_and_resume(client):
    # init size=12 → PATCH offset 0 (5 byte) → GET upload → received_bytes 5 → PATCH 5 (7 byte) → received 12
def test_patch_wrong_offset_409_returns_received(client): ...       # offset 3 → 409 {"received_bytes":5}; offset 0 lagi → 409
def test_patch_rewrite_same_offset_after_lost_response_keeps_file_identical(client): ...  # Review Focus 1
def test_patch_concurrent_same_attachment_one_wins(client): ...     # Review Focus 2: lock dipegang → 409
def test_patch_exceeds_size_413_and_body_over_chunk_413(client): ...
def test_patch_only_uploader_and_only_uploading(client): ...       # anggota lain 404; setelah complete → 409
def test_patch_missing_upload_offset_400(client): ...
def test_patch_disk_full_507(client, monkeypatch): ...             # tulis → OSError(errno.ENOSPC) → 507 "Penyimpanan server penuh"
def test_complete_incomplete_400(client): ...
def test_complete_html_disguised_as_mp4_415_failed_and_file_deleted(client): ...
def test_complete_valid_moves_file_sets_processing_and_enqueues(client, monkeypatch): ...
    # storage_key cocok regex, file ada di MEDIA_ROOT, .part hilang, mime_type dari sniff, enqueue dipanggil dengan id
def test_filename_never_used_as_path(client): ...                   # Review Focus 5: "../../x.mp4" → storage_key uuid
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi**
  - **Init:**
    - sisipkan baris `kind='media', storage='local', status='uploading', nextcloud_path='', original_name=filename[:255]` (nama kosong → `"media"`), `file_size=size`, `mime_type` `application/octet-stream` sampai complete, `updated_at`;
    - buat `.part` kosong.
  - **PATCH:**
    - `_media_upload_locks: dict[int, asyncio.Lock]`; lock sedang dipegang → 409 tanpa menunggu;
    - baca body dari `request.stream()` sambil menghitung, berhenti dengan 413 bila melebihi batas;
    - tulis dengan `seek(offset)` + `write` + `truncate()` di `run_in_threadpool`;
    - lalu `UPDATE received_bytes, updated_at`.
  - **Complete:**
    - baca 64 byte pertama → `sniff_media`;
    - gagal → hapus `.part`, `status='failed'`, 415;
    - sukses → `new_key(sniff.ext)`, `media_storage.commit`, `mime_type=final_mime(sniff, sniff.default_media_type)`, `media_type=sniff.default_media_type`, `status='processing'`, `media_worker.enqueue(id)`.
- [ ] **Step 4: Jalankan → PASS**, lalu seluruh `tests/` hijau.
- [ ] **Step 5: Commit** `feat(media): unggah bertahap init/patch/complete`

---

### Task 5: Penyajian — metadata, URL bertanda tangan, `/media/{token}`, nginx

**Files:**
- Modify: `webapp.py`
- Modify: `nginx-taskflow.conf` (blok spec §6.3 di server HTTP dan blok HTTPS yang dikomentari)
- Test: `tests/test_note_media_serve.py`

**Interfaces:**
- Consumes: `_accessible_attachment`, `_media_payload` (Task 4); `sign_token`, `verify_token`, `parse_range`, `content_disposition` (Task 2).
- Produces:
  - `_media_urls(att_id: int, has_poster: bool, now: int) -> dict` (`play_url`, `poster_url`, `download_url`, `expires_at`; path relatif `/media/<token>`). Dipakai Task 8;
  - `GET /api/media/{att_id}`;
  - `GET /api/scratchpad/{note_id}/media/by-client/{client_id}`;
  - `GET /media/{token}`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_meta_requires_note_access(client): ...          # pemilik/anggota 200, orang luar 404
def test_meta_urls_only_when_ready(client): ...          # uploading/processing/failed → play_url None, status + error terisi
def test_by_client_scoped_to_note(client): ...           # client_id lampiran note B dicari lewat note A → 404 (Review Focus 3)
def test_media_token_accel_headers(client, monkeypatch): # MEDIA_ACCEL=True → 200 body kosong, X-Accel-Redirect /_alurik_media/<key>,
    ...                                                  # Content-Type mime DB, nosniff, CSP sandbox, Accept-Ranges, Cache-Control private
def test_media_token_python_range(client):               # ACCEL=False: Range bytes=2-5 → 206, Content-Range bytes 2-5/N, isi tepat;
    ...                                                  # tanpa Range → 200 utuh; bytes=N- → 416 + Content-Range bytes */N
def test_media_token_poster_and_download_variants(client): ...  # poster → image/jpeg inline; download → attachment + nama sanitasi
def test_media_token_rejects_expired_tampered_deleted_or_not_ready(client): ...  # semua 404
def test_media_token_not_bound_to_user(client): ...      # token dipakai tanpa login → 200 (sesuai spec §8.3)
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi**
  - `/media/{token}`:
    1. `verify_token`;
    2. baris `ready`;
    3. kunci sesuai varian (`poster` tanpa `poster_key` → 404);
    4. header dari Global Constraints;
    5. ACCEL → `Response(status_code=200, headers={..., "X-Accel-Redirect": media_storage.accel_uri(key)}, media_type=mime)`, tanpa body;
    6. tanpa ACCEL → `StreamingResponse` generator baca blok 256 KiB dari offset `parse_range`, dengan `Content-Length`, `Content-Range`, dan status 206/200/416.
  - nginx, blok internal:

    ```nginx
    location /_alurik_media/ {
        internal;
        alias /var/lib/alurik/media/;
        add_header X-Content-Type-Options nosniff always;
        add_header Content-Security-Policy "sandbox; default-src 'none'" always;
    }
    ```

    nginx tidak meneruskan header kustom upstream pada internal redirect, jadi header itu dipasang ulang di sini.
  - Blok upload: `client_max_body_size 8m; proxy_request_buffering off;` + header proxy sama dengan `location /`.
  - Komentar di template: verifikasi deploy dengan `curl -sI -H 'Range: bytes=0-99' https://<host>/media/<token>` → `206`, `Content-Type` = mime media, `Content-Disposition` ada.
- [ ] **Step 4: Jalankan → PASS.**
- [ ] **Step 5: Commit** `feat(media): URL bertanda tangan, /media dengan X-Accel-Redirect/Range, template nginx`

---

### Task 6: Akses lampiran note bersama (D9) + hapus media

**Files:**
- Modify: `webapp.py`:
  - `upload_note_attachment` ~5675;
  - `list_note_attachments` ~5713;
  - `delete_note_attachment` ~5727;
  - `view_note_attachment` ~5744.
- Test: `tests/test_note_attachments_access.py`; perbarui tes lama yang mengharapkan 403/404 untuk anggota bila ada (`grep -rn "Bukan attachment milikmu\|attachments" tests/`).

**Interfaces:**
- Consumes: `_accessible_note`, `_accessible_attachment` (Task 4); `_media_urls` (Task 5).
- Produces: `_delete_media_files(row_or_dict) -> None` (hapus `storage_key`, `poster_key`, `temp_path(id)` lewat `media_storage`; diam bila tidak ada). Dipakai Task 7.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_member_can_list_upload_and_view_legacy_attachments(client, monkeypatch): ...
    # Nextcloud di-monkeypatch (requests.put/get tiruan); anggota W: list 200 berisi lampiran pemilik, upload 200, view 200
def test_outsider_gets_404_everywhere(client): ...
def test_delete_only_uploader_or_note_owner(client): ...   # pengunggah 200, pemilik note 200 (lampiran anggota), anggota lain 403
def test_delete_uploading_media_cancels_upload(client): ... # baris uploading dihapus, .part hilang, PATCH berikutnya 404
def test_delete_media_removes_files_and_row(client): ...   # file + poster + .part hilang dari MEDIA_ROOT
def test_view_media_row_redirects_to_signed_play(client): ...  # 302 Location /media/<token> varian play
def test_list_includes_media_fields(client): ...           # kind, status, media_type, duration_ms, client_id ada di item media
```

Aturan hapus:
- Anggota yang bisa melihat note tetapi bukan pengunggah atau pemilik note → **403** `"Bukan attachment milikmu"`. Pesan ini sama dengan perilaku lama, dan anggota itu memang sudah bisa melihat lampirannya.
- Orang luar → 404.

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi**
  - Ganti `WHERE id=? AND user_id=?` dengan `_accessible_note` / `_accessible_attachment`.
  - Hapus: izinkan bila `att.user_id == uid or note_owner_id == uid`.
    - Baris `storage='local'` → `_delete_media_files`.
    - Baris Nextcloud → jalur lama.
  - `view` untuk `kind='media'` → `RedirectResponse(_media_urls(...)["play_url"], 302)` bila `ready`, selain itu 404.
- [ ] **Step 4: Jalankan → PASS**, seluruh `tests/` hijau.
- [ ] **Step 5: Commit** `feat(attachments): lampiran note bisa diakses anggota workspace; hapus media`

---

### Task 7: Siklus hidup — purge Sampah, unggahan macet, antre ulang

**Files:**
- Modify: `webapp.py`:
  - `_purge_expired_trashed_notes` ~5178;
  - `purge_trashed_note` ~5454;
  - `empty_trashed_notes` ~5464;
  - `startup()`.
- Test: `tests/test_note_media_lifecycle.py`

**Interfaces:**
- Consumes: `_delete_media_files` (Task 6); `media_worker.requeue_processing` (Task 3).
- Produces:
  - `_purge_trashed_media(conn, note_ids: list[int]) -> None` (baca `snapshot_json` baris `trashed_notes` itu, hapus file setiap lampiran `storage='local'`);
  - `_cleanup_stuck_media_uploads(conn, now: datetime) -> int` (baris `uploading` dengan `updated_at` < now − `MEDIA_STUCK_HOURS` → hapus file + baris; berkas `.tmp/*.part` tanpa baris `uploading` dan `mtime` lebih tua dari batas → hapus).

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_trash_hides_media_and_restore_brings_it_back(client): ...
    # note+media ready → DELETE note → GET /api/media/{id} 404, token lama /media 404; restore → 200, file masih ada
def test_purge_single_deletes_media_files(client): ...       # DELETE /api/scratchpad/trash/{id} → file+poster hilang
def test_empty_trash_deletes_media_files(client): ...
def test_expired_purge_deletes_media_files(client): ...      # deleted_at diundur 31 hari lalu → GET /api/scratchpad/trash memicu purge
def test_purge_keeps_nextcloud_rows_untouched(client): ...  # baris storage='nextcloud' tidak memanggil media_storage.delete
def test_stuck_upload_cleanup(client): ...                    # updated_at 25 jam lalu → baris + .part hilang; 1 jam lalu → tetap
def test_orphan_part_older_than_limit_removed(tmp_path): ...
def test_restored_processing_row_requeued(client): ...       # Review Focus 4: trash saat processing → restore → requeue_processing() mengantre id
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi**
  - `_purge_trashed_media` dipanggil **sebelum** `DELETE FROM trashed_notes`, di ketiga jalur. Untuk `empty_trashed_notes`, ambil `note_id` + snapshot dulu dengan filter user yang sama, lalu hapus.
  - Kegagalan hapus file dicatat ke log dan tidak menggagalkan purge.
  - `_cleanup_stuck_media_uploads` dipanggil di `_purge_expired_trashed_notes` dan di `startup()`.
  - `startup()` memanggil `media_worker.requeue_processing()` lalu `media_worker.start()`.
- [ ] **Step 4: Jalankan → PASS.**
- [ ] **Step 5: Commit** `feat(media): file media ikut terhapus saat note dihapus permanen; bersihkan unggahan macet`

---

### Task 8: Halaman publik, ekspor DOCX, pratinjau Sampah, dokumentasi

**Files:**
- Modify: `webapp.py`:
  - `_render_published_content` (langkah baru sebelum 6.5 `::draw`);
  - `view_published_attachment` ~7388;
  - `_trash_preview`;
  - `export_scratchpad_docx` dan `export_scratchpad_docx_live`.
- Modify: `docx_exporter.py` (`markdown_to_docx(..., media_resolver=None)`, cabang baru di samping cabang `::draw` baris ~627)
- Modify: `.agents/DECISIONS.md` (ADR baru = nomor kosong berikutnya), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, `.agents/PROJECT_MAP.md` (modul baru)
- Test: `tests/test_note_media_public.py`, tambahan di `tests/test_docx_export.py`

**Interfaces:**
- Consumes: `_media_urls` (Task 5); `safehtml.escape_html`/`escape_attr`; pola placeholder `cards`/`card_fallback` + `ph_nonce` yang ada.
- Produces:
  - `MEDIA_DIRECTIVE_RE = re.compile(r'\\?::media\\?\[([0-9a-zA-Z_-]{1,64})\\?\](?:\s*\\?\{([^}]*)\\?\})?', re.IGNORECASE)` di `media_probe.py` (dipakai webapp + docx_exporter);
  - `_make_media_resolver(uid, note_id) -> Callable[[str], dict | None]`.

- [ ] **Step 1: Tulis tes yang gagal**

```python
def test_public_page_renders_player_for_own_media(client): ...
    # note publish berisi ::media[cid]{name="x"} → <video controls preload="metadata" playsinline src="/media/…"> atau <audio …>,
    # nama ter-escape, link unduh /media/… ; token di HTML valid (verify_token)
def test_public_page_password_locked_has_no_media_urls(client): ...  # tanpa cookie unlock: tidak ada "/media/" di HTML
def test_public_page_foreign_client_id_shows_unavailable(client): ... # Review Focus 3: client_id lampiran note lain → "Media tidak tersedia", tanpa nama file
def test_public_page_not_ready_shows_unavailable(client): ...
def test_public_page_escapes_name_and_ignores_unknown_attrs(client): ... # Review Focus 5: name="\"><script>" → ter-escape; {onerror=…} diabaikan
def test_typed_media_tags_stay_text(client): ...                      # "<video src=x>" di isi → &lt;video
def test_pub_attachment_media_redirects_to_download(client): ...      # /pub/attachments/{id} → 302 /media/<token download>; berpassword tanpa cookie → 404
def test_trash_preview_strips_media_directive(): ...
def test_docx_media_line_and_foreign_media_unavailable(client): ...   # "🎬 rapat.mp4 (1:02)" ; client_id note lain → "Media tidak tersedia"
```

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Implementasi**
  - **Kartu publik.** Resolve **hanya** `WHERE note_id = <note_id render> AND client_id = ? AND kind='media'`. Tanpa `note_id` → semua kartu tidak tersedia. Bentuk kartu:

    ```html
    <figure class="pub-media">
      <video controls preload="metadata" playsinline src="…" poster="…"></video>   <!-- atau <audio controls preload="metadata"> -->
      <figcaption>{nama} · {m:ss}</figcaption>
      <a href="…download…">Unduh</a>
    </figure>
    ```

    Gaya `.pub-media` ditambahkan di CSS halaman publik yang ada. Atribut kartu hanya `name`, dan nama hanya dipakai bila baris tidak punya `original_name`.
  - **`view_published_attachment`.** Baris `kind='media'` (setelah cek publish + password) → 302 ke `download_url`.
  - **DOCX.** Baris `🎵`/`🎬` + nama + durasi `m:ss` (`h:mm:ss` bila ≥ 1 jam), atau `Media tidak tersedia`.
  - **`_trash_preview`.** Buang `::media[...]` seperti `::draw`.
  - **ADR**: keputusan D2–D4, D8–D10 spec, ringkas.
  - **Handover di CURRENT_STATE**, berisi langkah deploy:
    - `sudo apt install ffmpeg`;
    - `sudo mkdir -p /var/lib/alurik/media && sudo chown <user service> …`, folder bisa dibaca user nginx;
    - set `MEDIA_URL_SECRET` (`openssl rand -hex 32`) di env service;
    - blok nginx, lalu `sudo nginx -t && sudo systemctl reload nginx`;
    - `sudo systemctl restart taskflow-web`;
    - verifikasi `curl -sI` dengan Range.
- [ ] **Step 4: Jalankan → PASS**, lalu verifikasi akhir:
  - `python -m pytest tests/ -q` → semua hijau;
  - `node --test tests/offline/` tidak berubah (pra-ada `draw_local_reactive` saja);
  - smoke `uvicorn webapp:app` lokal dengan `MEDIA_ACCEL=0`: init → patch → complete file mp4 hasil ffmpeg → worker → `GET /media/<token>` dengan `Range` → 206.
- [ ] **Step 5: Commit** `feat(media): pemutar di halaman publik, DOCX, ADR dan catatan deploy`
