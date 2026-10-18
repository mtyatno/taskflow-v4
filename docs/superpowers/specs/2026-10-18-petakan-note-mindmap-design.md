# Spec: Petakan — Catatan ↔ Mindmap Tertaut (cermin murni)

- **Tanggal:** 2026-10-18
- **Basis kode:** `main` @ `2bca256` (SW v415)
- **Status:** desain disetujui per bagian dalam sesi brainstorming 2026-10-18 (pemilik + Claude). Spec tertulis ini menunggu review pemilik sebelum rencana implementasi dibuat.
- **Nama:** *Petakan* (nama payung). Versi pertama: *Petakan Catatan*. Nama teknis: `note-to-mindmap`, modul `notemap.js`.
- **Istilah:**
  - *catatan* = baris `scratchpad_notes`;
  - *peta tertaut* = baris `mindmaps` dengan `source_note_id`;
  - *bagian* = satu heading beserta isi di bawahnya sampai heading berikutnya;
  - *sid* = penanda bagian dalam satu hasil urai catatan;
  - *pengaturan tampilan* = arah layout, Justify, cabang yang dilipat, ringkasan on/off.

---

## 1. Tujuan

User bisa membuat mindmap dari sebuah catatan. Struktur node mengikuti daftar isi (heading) catatan. Edit di catatan muncul di peta, dan edit di peta mengubah catatan. Semua logika berbasis aturan dan berjalan di perangkat. Tidak ada isi catatan yang dikirim ke LLM, karena sebagian user tidak ingin datanya dikonsumsi LLM.

**Kriteria berhasil**
1. Struktur peta sama dengan daftar isi catatan menurut aturan mode edit (§5.1).
2. Peta yang tidak diedit menyusun ulang catatan yang identik byte per byte.
3. Setiap aksi di §5.4 mengubah catatan sesuai tabelnya tanpa kehilangan isi, dan edit di catatan muncul di peta yang sedang terbuka.
4. Bisa dipakai offline; sinkron antarperangkat lewat mekanisme catatan yang sudah ada (ADR-006).
5. Dari sebuah node, user bisa membuka catatan tepat di heading-nya tanpa meninggalkan halaman Mindmap.

## 2. Keputusan

| # | Keputusan |
|---|---|
| D1 | Dua arah: catatan ↔ peta. |
| D2 | Cermin murni. Setiap node adalah heading; peta tertaut tidak punya isi sendiri. Catatan adalah satu-satunya sumber data. |
| D3 | Peta tertaut adalah "jendela" ke catatan: baris `mindmaps` dengan `source_note_id`, dan `data_json`-nya hanya berisi pengaturan tampilan. Pohon dibangun ulang dari catatan setiap kali dibutuhkan. |
| D4 | Ringkasan per node: kalimat pertama + paling banyak 3 butir daftar pertama + baris hitungan. Hanya tampilan, dihitung di perangkat, tidak pernah disimpan. |
| D5 | Ctrl/Cmd+Click, klik kanan, atau tombol Ops membuka editor catatan di atas peta, tepat di heading itu. User tetap di halaman Mindmap. Klik kanan juga menyediakan "Buka di halaman Notes". |
| D6 | Peta tertaut dimiliki pemilik catatan, dan `list_id`-nya selalu sama dengan catatan (dijaga server). Anggota workspace bisa membuat, melihat, dan mengedit lewat peta, tetapi tidak bisa menghapus petanya. |
| D7 | Edit peta yang bentrok dengan perubahan catatan dibatalkan dan peta dimuat ulang. Tidak ada penggabungan otomatis di v1. |
| D8 | Menghapus bagian yang berisi teks wajib konfirmasi. Ctrl+Z di peta tertaut memakai riwayat isi catatan selama sesi itu. |
| D9 | Pengaturan tampilan disimpan di baris mindmap, bukan di `meta_json` catatan, karena editor catatan (`persistEditor`) menimpa seluruh `meta_json` setiap kali menyimpan. |

## 3. Arsitektur

```
Catatan (markdown) ─parseNote─► bagian + ringkasan ─buildMindData─► peta (kanvas / outline)
        ▲                                                                   │ edit node
        └──── noterepo.applyMapEdit (transaksi atas isi terbaru) ◄─applyMindData─┘
```

| Komponen | Tanggung jawab |
|---|---|
| `static/offline/notemap.js` (baru) | Fungsi murni tanpa DOM, format UMD seperti modul offline lain: urai catatan, bangun data peta + ringkasan, susun ulang markdown dari pohon yang diedit, kunci lipatan, cari heading, render teks heading dengan aturan catatan. |
| `webapp.py` | Kolom `source_note_id`, pembuatan idempoten per catatan, penyamaan `list_id`/judul/pemilik dari catatan, penolakan pohon untuk peta tertaut, penghapusan saat catatan dihapus permanen, penyaringan `?linked=1`. |
| `static/offline/mindmaprepo.js`, `mindmaproutes.js`, `syncpush.js`, `syncpull.js` | Field `source_note_cid`/`source_note_id`, create idempoten lokal, op create ditahan sampai catatan punya id server, pengaturan tampilan tanpa salinan konflik. |
| `static/offline/noterepo.js` | `applyMapEdit(cid, baseContent, next)`: menulis isi dan judul hasil peta di dalam `TFdb.mutate`, dan menolak bila isi catatan sudah berubah. |
| `static/index.html` | Mode tertaut di `MindmapTabInstance` dan `MindmapOutline`; "+ Dari Catatan" dan badge di `MindmapPage`; tombol "🧠 Petakan" di `NotePanel` dan `NoteModal`; `NoteModal` memakai prop `initialBlockTarget` yang sudah ada dengan `kind: "heading"`; prop `initialHeading` di `NotesPage`/`NotePanel`. |
| `static/vendor/mind-elixir/index.html` | Opsi mesin untuk mode tertaut, render ringkasan, menu klik kanan, Ctrl/Cmd+Click, tombol Ops "Buka di catatan", fitur yang dimatikan, penerusan Ctrl+Z ke parent. |

### 3.1 API `notemap.js`

```js
parseNote(markdown) → { intro, sections: [Section], eol }
//   Section = { sid, index, level, text, headingLine, body, parentSid, childSids }
buildMindData(parsed, { title, viewState }) → { nodeData }      // bentuk data mind-elixir; node membawa `nm`
summarizeSection(body) → { excerpt, items, more, counts } | null
applyMindData(markdown, parsed, editedNodeData) →
    { ok: true, markdown, title, removed: { count, hasContent } }
  | { ok: false, code: "LEVEL_OVERFLOW" }
verifyStructure(markdown, editedNodeData) → boolean            // susunan baru tetap terurai sama (§5.5)
pathKey(parsed, sid) → string                                  // kunci lipatan yang stabil (§4.2)
locateHeading(parsed, sid) → { index, text, occurrence }       // untuk "Buka di catatan" (§8.3)
matchHeading(list, target) → index | -1                        // pencocokan heading di editor/halaman Notes
renderTopicNoteInline(topic) → html                             // aturan format inline catatan (§5.2)
renderSummaryHtml(summary) → html                               // ringkasan ter-escape (§8.2)
```

Node hasil `buildMindData`:

```js
{ id: "s3", topic: "Kanal Organik", expanded: true, children: [ ... ],
  nm: { sid: "s3", level: 2, summary: { excerpt, items, more, counts } | null } }
```

Root: `{ id: "root", topic: <judul catatan>, root: true, nm: { sid: null, summary: <ringkasan pembuka> } }`.

Field `nm` hanya hidup di memori. Ia tidak pernah tersimpan, karena `data_json` peta tertaut tidak memuat pohon (§4.2).

## 4. Model data

### 4.1 Server

```sql
ALTER TABLE mindmaps ADD COLUMN source_note_id INTEGER DEFAULT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mindmaps_source_note
  ON mindmaps(source_note_id) WHERE source_note_id IS NOT NULL;
```

Kolom ini sengaja dibuat **tanpa** `REFERENCES … ON DELETE`. Menghapus catatan memindahkannya ke `trashed_notes` lalu men-`DELETE` baris `scratchpad_notes`; memulihkannya memasukkan baris lagi dengan id yang sama (ADR-004). Cascade akan memutus tautan begitu catatan masuk Sampah. Siklus hidup peta diatur kode (§6.3).

### 4.2 `data_json` peta tertaut

```json
{ "linked": 1, "direction": 2, "justify": false, "collapsed": ["Pemasaran\u001fKanal Organik"], "summary": true }
```

- `collapsed` berisi kunci dari `pathKey`: teks heading dari anak root sampai node itu, dipisah `\u001f`. Heading kembar di bawah induk yang sama diberi akhiran `#2`, `#3`, dan seterusnya. Mengganti teks heading membuat lipatan node itu kembali ke default (terbuka).
- Tidak ada `nodeData`, `arrows`, atau `summaries`.

### 4.3 Record lokal (`mindmaps` di IndexedDB)

Tambahan: `source_note_cid` (cid catatan lokal) dan `source_note_id` (id server catatan; boleh null sampai catatan di-push). Field lain mengikuti record mindmap biasa.

## 5. Aturan konversi dan edit

### 5.1 Heading yang dihitung

Catatan diurai per baris (pemisah `\n`; `\r` di akhir baris dipertahankan supaya identitas tetap terjaga).

- **Heading:** baris yang cocok dengan `^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$` dan teksnya tidak kosong. Harus mulai di kolom 0, sama dengan daftar isi yang ada.
- **Bukan heading (masuk isi bagian):**
  - baris di dalam blok kode berpagar (``` atau ~~~; penutup memakai karakter yang sama dengan panjang ≥ pembuka);
  - baris kutipan atau callout (`^ {0,3}>`);
  - baris di dalam `<details>…</details>` (toggle; kedalaman bersarang dihitung);
  - heading kosong (`## ` tanpa teks), heading setext (`===` / `---`), dan `#tag` tanpa spasi.
- Hasilnya sama dengan daftar isi mode edit (`extractDocHeadings`, heading top-level ProseMirror). Daftar isi mode baca (`extractHeadings`) masih menghitung baris `#` di dalam blok kode; itu dicatat sebagai temuan terpisah dan tidak diikuti.

### 5.2 Pohon dan isi bagian

- `intro` = semua baris sebelum heading pertama. `headingLine` = baris heading lengkap dengan pemisah barisnya. `body` = baris setelah heading sampai sebelum heading berikutnya (level berapa pun) atau akhir catatan.
- Induk sebuah bagian adalah bagian terdekat di atasnya yang levelnya lebih kecil; bila tidak ada, induknya root. Level yang melompat (H2 lalu H4) tidak menghasilkan node kosong di antaranya.
- `sid` = `"s" + urutan kemunculan` di dokumen. Hanya berlaku untuk satu hasil urai.
- Teks node = teks heading tanpa `#` pembuka dan penutup. Format inline dipertahankan dan dirender oleh `renderTopicNoteInline` dengan aturan catatan: `==x==` sorotan, `**x**` dan `__x__` tebal, `*x*` dan `_x_` miring, `~~x~~` coret, `` `x` `` kode, `[t](u)` link, `[[Judul]]` tampil sebagai "Judul". (Peta biasa memakai `__x__` untuk sorotan; aturan itu tidak berlaku di peta tertaut.)
- **Lipatan awal:** bila belum ada `collapsed` tersimpan dan jumlah node (tanpa root) ≤ 30, semua cabang terbuka. Bila lebih dari 30, node di kedalaman ≥ 2 (root = kedalaman 0) dilipat sehingga hanya 2 tingkat pertama yang terlihat. Setelah itu dipakai `collapsed` tersimpan; node baru default terbuka.

### 5.3 Ringkasan (`summarizeSection`)

Masukan: `body` bagian itu saja (sub-bagian tidak ikut). Untuk root, masukannya `intro`.

1. **Bersihkan.** Buang blok kode berpagar, blok `$$…$$`, tag HTML (teks di dalam `<summary>` dipertahankan), gambar `![…](…)`, `::draw[…]{…}`, dan token `[tasklink:…]`. Ubah `[[X]]` → `X` dan `[t](u)` → `t`. Buang penanda format inline dan penanda callout `> [!TYPE]`.
2. **Baris 1 (`excerpt`).** Paragraf pertama yang bukan daftar dan bukan tabel. Kalimat pertama berakhir di `.`, `!`, atau `?` yang diikuti spasi atau akhir teks, sehingga "1.000" tidak terpotong. Bila kalimat itu kurang dari 20 karakter, sambung kalimat berikutnya. Potong maksimal 120 karakter di batas kata, lalu tambah "…".
3. **Baris 2 (`items`).** Daftar pertama di isi bagian (`-`, `*`, `+`, `1.`, `- [ ]`, `- [x]`): paling banyak 3 butir tingkat teratas, masing-masing maksimal 40 karakter (dipotong di batas kata + "…"). `more` = jumlah butir sisanya, tampil sebagai "+N".
4. **Baris 3 (`counts`).** `checkDone/checkTotal` dari semua checklist di isi bagian (termasuk yang bersarang), `images` = gambar markdown + `::draw`, `tables` = tabel GFM. Hanya nilai di atas 0 yang tampil, misalnya "☑ 1/3 · 🖼 2 · ⊞ 1".
5. Baris yang kosong tidak tampil. Bila ketiganya kosong, hasilnya `null` dan node tampil tanpa ringkasan.

### 5.4 Edit peta → catatan (`applyMindData`)

**Identitas.** Setiap node hasil turunan membawa `nm.sid`. Yang dihormati hanya sid yang ada di hasil urai saat ini; sid asing (misalnya node yang ditempel dari peta lain) dianggap node baru.

| Aksi di peta | Hasil di catatan |
|---|---|
| Ganti teks node | Teks heading diganti. Baris baru diubah jadi spasi, `#` + spasi di awal dibuang, dan teks kosong diabaikan (teks lama tetap). |
| Ganti teks root | Judul catatan diganti. |
| Tambah child / sibling | Heading baru tanpa isi di posisi itu, dengan teks default "Node baru". |
| Tambah parent | Heading baru di atasnya; node itu dan turunannya turun satu level. |
| Pindah, drag, Promote, Move up/down, indent/outdent | Seluruh bagian (heading, isi, sub-bagian) ikut pindah. |
| Hapus | Seluruh bagian dan sub-bagiannya dihapus. Konfirmasi bila ada isi (§5.5). |
| Duplikat / salin-tempel cabang | Seluruh bagian disalin, termasuk isinya. Sid yang muncul untuk kedua kalinya diperlakukan sebagai salinan. |
| Lipat/buka cabang, arah, Justify, Ringkasan | Hanya pengaturan tampilan; catatan tidak ditulis. |

**Susun ulang.** Hasil = `intro` + untuk tiap node dalam urutan pre-order (root tidak ditulis): baris heading + isi.
- Node lama yang level dan teksnya tidak berubah memakai `headingLine` aslinya apa adanya. Selain itu ditulis `"#".repeat(level) + " " + teks` + pemisah baris catatan.
- Isi: node lama memakai `body` aslinya; salinan memakai `body` bagian asalnya; node baru tanpa isi.
- Sambungan: bila keluaran belum diakhiri pemisah baris, tambahkan pemisah baris sebelum heading. Sebelum heading **baru**, pastikan ada satu baris kosong (gaya Milkdown).
- Sid yang tidak muncul lagi berarti bagian itu dihapus.
- Tanpa edit, keluaran sama persis dengan masukan. Ini diuji sebagai sifat (§10).

**Level heading.**
- `T0` = level terkecil di antara anak root pada catatan asli; default 1 bila catatan belum punya heading.
- Δ(induk) = level baru induk − level aslinya (0 untuk root).
- Node lama yang induknya tetap: level asli + Δ(induk).
- Node baru, salinan, atau node lama yang pindah induk: memakai level saudara pertama di bawah induk yang sama yang merupakan node lama dengan induk tetap. Bila tidak ada saudara seperti itu: `T0` untuk anak root, atau level induk + 1.
- Turunan node lama yang pindah dan turunan salinan: level asli + (level baru leluhur yang dipindah/disalin − level aslinya). Turunan node baru mengikuti aturan node baru.
- Bila ada level di atas 6, hasilnya `{ ok: false, code: "LEVEL_OVERFLOW" }`; peta dimuat ulang dengan pesan "Maksimal 6 tingkat heading".

### 5.5 Alur tulis, konfirmasi, dan undo

1. Setiap event `change` dari kanvas atau outline menjadwalkan simpan dengan jeda sekitar 800 ms; yang dipakai adalah pohon terakhir.
2. Tab memegang `baseContent` (isi catatan saat peta dibangun) beserta hasil urainya. `applyMindData` menghasilkan `next`. Bila `next.markdown === baseContent` dan judulnya sama, tidak ada yang ditulis. Bila susunan baru terurai berbeda dari pohon yang diedit (`verifyStructure` gagal, misalnya blok kode atau toggle yang tidak ditutup ikut dipindah dan menelan bagian sesudahnya), edit ditolak dengan toast "Perubahan ini akan merusak struktur catatan (ada blok kode/toggle yang tidak ditutup) — ubah lewat catatan" dan peta dimuat ulang. Setelah tulisan berhasil, `sid` node di peta disegarkan sesuai urutan baru (pesan `remapSids`, §8.4).
3. Bila `removed.hasContent` (ada teks selain spasi di bagian yang hilang), muncul dialog "Hapus bagian «X» beserta isinya dari catatan?" yang menyebut jumlah sub-bagiannya. Batal → peta dimuat ulang dari catatan.
4. `noterepo.applyMapEdit(cid, baseContent, next)`: di dalam `TFdb.mutate`, bila `cur.content !== baseContent` → batal dan kembalikan `{ stale: true }`; bila sama → tulis `content`, `title`, `updated_at`, `dirty: 1`, dan `rev + 1`. Setelah itu gabungkan op update di outbox (`coalesceUpdateOp`), hitung ulang tautan wikilink seperti di `updateNote`, lalu kirim event `noteSaved { source: "notemap", cids }`.
5. Bila `stale`, peta dibangun ulang dari isi terbaru dan muncul toast "Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu".
6. **Undo.** Tab menyimpan riwayat `{ before, after }` (maksimal 20) untuk setiap tulisan dari peta. Ctrl+Z (diteruskan iframe ke parent) menulis `before` lewat jalur yang sama bila isi catatan masih `after`; bila tidak, muncul toast "Tidak bisa diurungkan: catatan sudah berubah". Ctrl+Shift+Z dan Ctrl+Y untuk redo dengan aturan yang sama. Undo bawaan mesin dimatikan (`allowUndo: false`) karena mesin tidak tahu isi bagian. Di mode Outline dipakai riwayat yang sama; undo outline bawaan tidak dipakai untuk peta tertaut.
7. Editor catatan yang sedang terbuka memuat ulang bila tidak ada ketikan, atau menampilkan banner yang sudah ada (`checkLocalRevision`).
8. **Pengaturan tampilan** (lipatan, arah, Justify, Ringkasan) disimpan ke baris mindmap lewat `PUT /api/mindmaps/{id}` dengan jeda yang sama, terpisah dari tulisan ke catatan, dan hanya bila nilainya berubah.

### 5.6 Dimatikan di peta tertaut

- Panah antar node: opsi `contextMenu.link: false`, dan tombol Ops Link/Bidirectional Link disembunyikan.
- Kurung Summary: item menu dan tombol Ops disembunyikan.
- Tab 🔗 Links, serta chip dan pemilih link node di outline.
- Tombol format blok (daftar, tabel, heading, garis) dan perataan di tab Font. Yang tersisa: B, I, S, kode, link.

## 6. Server

### 6.1 Migrasi

`migrate_db()` menambah kolom dan index di §4.1 secara idempoten (cek `PRAGMA table_info`). `schema-db.md` diperbarui.

### 6.2 Endpoint

- `POST /api/mindmaps` dengan `source_note_id` (opsional):
  - Catatan harus bisa diakses pemanggil (`_note_access_clause`); bila tidak ada atau tidak bisa diakses → 404.
  - Bila peta tertaut untuk catatan itu sudah ada, peta itu dikembalikan (idempoten).
  - Bila belum ada: INSERT dengan `user_id = note.user_id`, `list_id = note.list_id`, `title = note.title`, `data_json` = pengaturan default (pohon dari klien diabaikan), dan `client_id` dari klien. `IntegrityError` pada index unik → kembalikan yang sudah ada.
- `GET /api/mindmaps` dan `GET /api/lists/{id}/mindmaps`: tanpa `linked=1` → `WHERE source_note_id IS NULL`, supaya APK dan cache lama tidak melihat peta tertaut. Dengan `linked=1` → semua peta, beserta field `source_note_id`. `GET /api/mindmaps/{id}` selalu menyertakan `source_note_id`.
- `PUT /api/mindmaps/{id}` untuk peta tertaut: `data_json` yang mengandung `nodeData` → 400 `{"detail":{"code":"LINKED_TREE_REJECTED"}}`; `title` diabaikan (judul mengikuti catatan); `base_rev` diabaikan (pengaturan tampilan memakai "yang terakhir menang").
- `PATCH /api/mindmaps/{id}/share` untuk peta tertaut → 409 "Peta tertaut mengikuti catatan".
- `DELETE /api/mindmaps/{id}`: tetap hanya pemilik (= pemilik catatan).
- Pencarian global tidak berubah: peta tertaut tidak memuat isi, sedangkan catatannya tetap bisa dicari.

### 6.3 Penyamaan dari catatan dan siklus hidup

Helper `_sync_linked_mindmap(conn, note_id)`: bila ada peta dengan `source_note_id = note_id`, samakan `list_id`, `title`, dan `user_id` dengan catatan; `updated_at` di-bump hanya bila ada yang berubah. Dipanggil setelah `POST /api/scratchpad`, `PUT /api/scratchpad/{id}`, `PATCH /api/scratchpad/{id}/share`, dan `POST /api/scratchpad/trash/{note_id}/restore`. Prinsipnya sama dengan sinkron note → drawing di spec workspace (doc project `claude/spec-workspace-drawing-project-2026-10-18.md`, §4.4): status berbagi hanya mengalir dari catatan ke item yang tertaut padanya.

Hapus permanen catatan → `DELETE FROM mindmaps WHERE source_note_id IN (…)`. Berlaku di `_purge_expired_trashed_notes`, `DELETE /api/scratchpad/trash/{note_id}`, dan `DELETE /api/scratchpad/trash`.

| Kejadian | Peta tertaut |
|---|---|
| Catatan di-share, dipindah workspace, atau dibatalkan share-nya | Ikut otomatis |
| Catatan masuk Sampah | Pesan "Catatan sumber ada di Sampah" + tombol ke Sampah |
| Catatan dipulihkan | Normal lagi |
| Catatan dihapus permanen | Peta ikut dihapus |
| Peta dihapus (oleh pemilik catatan) | Catatan tidak berubah |
| "Petakan" lagi pada catatan yang sama | Peta yang sudah ada dibuka |
| Akses ke workspace hilang | Peta hilang dari daftar (alur `access_lost` yang sudah ada) |

## 7. Offline & sinkron

- **Route lokal `POST /api/mindmaps`** dengan `source_note_ref` (cid atau id server catatan): bila sudah ada peta lokal (tidak terhapus) untuk catatan itu, peta itu dikembalikan. Bila belum, peta dibuat dengan `list_id`, `user_id`, dan `title` dari catatan lokal, serta pengaturan default.
- **Push create:** bila catatan belum punya id server, op ditahan (tetap di outbox dan dicoba lagi pada drain berikutnya; pola T10). Payload menyertakan `source_note_id`. Bila server mengembalikan peta yang sudah ada (dibuat perangkat lain), record lokal mengadopsi id server itu. Bila sudah ada record lain dengan id server yang sama, keduanya digabung dan pengaturan tampilan yang lebih baru dipakai.
- **Push update:** hanya pengaturan tampilan, tanpa `base_rev`. Respons 400 `LINKED_TREE_REJECTED` → `sync_error` (seharusnya tidak pernah terjadi).
- **Pull:** memakai `?linked=1`. `source_note_id` dipetakan ke cid catatan lokal lewat idmap; di `sync()`, pull catatan memang sudah berjalan sebelum pull mindmap. Peta tertaut tidak pernah melewati `adoptServerWithConflictCopy`; data server diadopsi bila record lokal tidak dirty.
- **Isi peta = isi catatan:** sinkron dan konflik antarperangkat mengikuti catatan (ADR-006). Bila catatan mendapat salinan konflik, peta tetap tertaut ke catatan aslinya.
- **Catatan terhapus lokal** saat op create peta masih antre → op dibuang dan record peta lokal dihapus.

## 8. UI & interaksi

### 8.1 Titik masuk

- **`NotePanel` (mode baca) dan `NoteModal` (editor):** tombol "🧠 Petakan" di bar aksi; berubah jadi "🧠 Buka peta" bila petanya sudah ada. Klik → App pindah ke halaman Mindmap lewat `initialMindmapId` (mekanisme `pendingMindmapId` yang sudah ada), dan peta terbuka di tab.
- **`MindmapPage`:** "+ Dari Catatan" di bawah "+ Mindmap Baru" → pencarian judul catatan (`GET /api/scratchpad/titles`, dilayani router lokal sehingga bisa offline) → peta dibuat atau dibuka.

### 8.2 Tampilan

- **Sidebar:** ikon 📄 di samping judul, dengan tooltip "Tertaut ke catatan".
- **Header tab tertaut:**
  - "📄 Tertaut ke: <judul catatan> ↗" (klik = buka catatan dari atas);
  - tombol Share disembunyikan, diganti badge workspace bila catatannya milik workspace;
  - Rename mengganti judul catatan lewat jalur tulis catatan (sama dengan mengganti teks root), bukan lewat `PUT` mindmap;
  - Hapus menghapus petanya saja, dan hanya untuk pemilik catatan;
  - tombol baru "Ringkasan";
  - status simpan "Tersimpan ke catatan".
- **Ringkasan di node:** di bawah teks heading, huruf kecil dengan warna redup dari variabel tema, lebar maksimal sekitar 260 px. Baris 1 maksimal 2 baris tampilan, baris 2 maksimal 1 baris, baris 3 satu baris kecil. Dirender lewat hook `markdown(topic, node)` mesin sehingga ikut terukur saat tata letak; kotak edit tetap berisi `node.topic` saja.
- **Outline:** ringkasan tampil sebagai baris kedua yang redup, ikut tombol Ringkasan.

### 8.3 Buka di catatan

- **Ctrl+Click / Cmd+Click** pada node (kanvas) atau baris (outline) → `NoteModal` terbuka di atas peta dengan `initialHeading`. Editor bergulir ke heading itu dan menyorotnya sekitar 1,5 detik. Menutup modal mengembalikan user ke peta yang sama.
- **Klik kanan:** "📄 Buka di catatan" (modal yang sama) dan "↗ Buka di halaman Notes" (pindah ke halaman Notes; catatan terbuka di mode baca pada heading itu).
- **Ops (HP/tablet):** tombol "📄 Buka di catatan" paling atas saat sebuah node dipilih.
- **Outline:** juga lewat menu konteks dan tombol ↗ kecil yang muncul saat baris disorot.
- **Root:** membuka catatan dari atas.
- **Mencari heading:** `locateHeading` menghasilkan `{ index, text, occurrence }`. `NoteModal` memakai `extractDocHeadings(doc)`: pakai heading ke-`index` bila teksnya cocok; bila tidak, heading ke-`occurrence` dengan teks yang sama; bila tidak ada, posisi atas. Halaman Notes mencocokkan teks (tanpa format) di antara elemen `note-h-*` dengan aturan kemunculan yang sama.

### 8.4 Protokol iframe (tambahan)

- **parent → iframe:**
  - `load` membawa `linked: true` dan `showSummary`. Mesin untuk tab itu dibuat dengan `allowUndo: false`, `newTopicName: "Node baru"`, hook `markdown` = teks heading (aturan catatan) + blok ringkasan, dan
    `contextMenu: { focus: true, link: false, extend: [ { name: "📄 Buka di catatan", key: "Ctrl+Click", onclick }, { name: "↗ Buka di halaman Notes", onclick } ] }`.
  - `setSummary { show }`.
  - `remapSids { pairs: [[nodeId, sid], …] }` — setelah tulisan berhasil, menyegarkan `nm.sid` tiap node tanpa render ulang.
- **iframe → parent:** `openNoteAt { sid, target: "modal" | "page" }`, `undoRequest`, `redoRequest`. Event `change` tetap membawa pohon penuh.

## 9. Penanganan error

| Kondisi | Perilaku |
|---|---|
| Catatan tanpa heading | Peta berisi root (judul + ringkasan pembuka) dan petunjuk "Tambah node di sini atau heading di catatan" |
| Catatan ada di Sampah | Pesan + tombol ke Sampah |
| Tidak punya akses ke catatan | "Catatan sumber tidak tersedia untukmu" |
| Catatan belum ada di perangkat (offline, belum tersinkron) | "Catatan belum tersedia di perangkat ini — sambungkan internet" |
| Catatan dihapus permanen | Peta dihapus server; bila masih tampil dari cache: pesan + tombol "Hapus peta" |
| Catatan berubah di tengah edit peta | Edit dibatalkan, peta dimuat ulang + toast (§5.5) |
| Level di atas H6 | Edit ditolak, peta dimuat ulang + toast |
| Blok kode/toggle tidak ditutup ikut dipindah | Edit ditolak (`verifyStructure`), peta dimuat ulang + toast (§5.5) |
| Konfirmasi hapus dibatalkan | Peta dimuat ulang dari catatan |
| Node ditempel dari peta lain | Sid asing → heading baru tanpa isi |
| Pohon dikirim ke server untuk peta tertaut | 400 `LINKED_TREE_REJECTED` |
| Catatan besar | Target ≤ 50 ms untuk sekitar 2.000 baris atau 200 heading (urai + bangun peta); aturan lipatan awal tetap berlaku |

## 10. Pengujian

**Node (`tests/offline/notemap.test.js` dan berkas terkait)**
- Identitas: `applyMindData(md, parseNote(md), buildMindData(...).nodeData)` menghasilkan `md` yang sama persis. Diuji dengan kumpulan contoh (blok kode berisi `#`, kutipan/callout, toggle, heading kosong, level melompat, heading dengan `#` penutup, CRLF, tanpa pemisah baris di akhir, `::draw`, tasklink, tabel, math, unicode) dan dokumen acak dari generator.
- Deteksi heading (§5.1) dan pohon (§5.2), termasuk kesetaraan dengan `extractDocHeadings` untuk contoh yang sama.
- Setiap aksi §5.4: aturan level (Δ, `T0`, saudara, turunan), `LEVEL_OVERFLOW`, sid asing, salinan, root → judul, sanitasi teks.
- Ringkasan (§5.3): pemisahan kalimat ("1.000", singkatan umum), kalimat pendek, potongan di batas kata, "+N", hitungan checklist/gambar/tabel, pembersihan.
- `pathKey`, `locateHeading`, lipatan awal (≤ 30 dan > 30 node).
- Repo, route, dan sync: `applyMapEdit` (tolak saat stale, op outbox tergabung), create idempoten lokal, op ditahan sampai catatan punya id server, adopsi peta yang sudah ada dari server, pull `?linked=1` + pemetaan catatan, tanpa salinan konflik untuk peta tertaut.

**pytest (`tests/test_petakan.py`)**
Migrasi idempoten; POST idempoten per catatan; 404 untuk catatan yang tidak terjangkau; pemilik peta = pemilik catatan; `list_id` dan judul dari catatan; penyamaan saat share/unshare/PUT/restore; purge, hapus selamanya, dan kosongkan Sampah ikut menghapus peta; PUT menolak `nodeData` serta mengabaikan `title` dan `base_rev`; share peta tertaut → 409; `GET` tanpa `linked=1` menyaring peta tertaut.

**Browser (Playwright, sebelum merge)**
Buat peta dari catatan (mode baca dan editor) dan dari "+ Dari Catatan"; edit catatan → peta berubah; setiap aksi peta → catatan berubah; konfirmasi hapus + Ctrl+Z; Ctrl/Cmd+Click, klik kanan, dan tombol Ops; ringkasan on/off; catatan bersama → anggota melihat dan mengedit; offline lalu online; klien tanpa `linked=1` tidak melihat peta tertaut.

## 11. Rilis

Tiga PR. Masing-masing mengikuti aturan repo: `npm test` + `pytest`, perbarui `.agents/`, dan naikkan versi SW serta `?v=` iframe bila menyentuh frontend.

1. **`notemap.js` + tes.** Tanpa UI, tanpa backend, dan tanpa perubahan SW (modul belum dimuat halaman).
2. **Backend:** migrasi, endpoint, penyamaan dari catatan, penghapusan saat purge, pytest. Deploy wajib `sudo systemctl restart taskflow-web`.
3. **Frontend + offline:** mode tertaut di tab/outline/iframe, titik masuk, Buka di catatan, ringkasan, repo/route/sync, `notemap.js` masuk precache SW.

Keputusan arsitektur dicatat sebagai **ADR-008** di `.agents/DECISIONS.md` bersama spec ini (nomor bisa bergeser bila PR lain mengambil 008 lebih dulu).

## 12. Di luar cakupan v1 (kandidat pengembangan berikutnya)

- Node atau isi khusus peta pada peta tertaut (bertentangan dengan D2).
- Penggabungan otomatis edit yang bentrok (D7).
- "Salin jadi peta biasa" (snapshot ke mindmap yang tidak tertaut).
- Mode peta di dalam catatan (pendekatan 2), memakai `notemap.js` yang sama.
- Mengubah peta biasa menjadi catatan ("Petakan ke Catatan").
- Satu peta dari beberapa catatan; butir daftar sebagai node; mengedit isi bagian dari peta.
- Mode AI opsional, hanya dengan persetujuan eksplisit per user.
- Dukungan peta tertaut di APK/Tauri versi lama (disaring dengan `linked=1`).
