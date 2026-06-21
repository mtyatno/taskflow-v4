#!/usr/bin/env python3
"""Generate curated Goal habit/task templates -> habit_templates_curated.json.

Replaces the old mechanically-permuted habits_tasks_1000.json
("{verb} {subkategori} {N} menit {waktu}") with hand-written, specific,
natural-Indonesian suggestions: ~6 habits + ~6 tasks per (kategori, subkategori).

Each item tuple is (item, frequency, priority, difficulty):
  frequency  : daily | weekly | monthly
  priority   : low | medium | high
  difficulty : easy | medium | hard

Run:  python scripts/gen_habit_templates.py
"""
import json
import os
import re

# kategori -> tag used in the `tags` array (matches the old data convention)
KATEGORI_TAG = {
    "Karir": "karir",
    "Keuangan": "keuangan",
    "Pengembangan Diri": "pengembangan diri",
    "Produktivitas": "produktivitas",
    "Relasi & Keluarga": "relasi_keluarga",
    "Spiritual": "spiritual",
}

# (kategori, subkategori) -> {"habit": [...], "task": [...]}
DATA = {
    ("Karir", "Networking"): {
        "habit": [
            ("Sapa satu koneksi baru di LinkedIn", "weekly", "medium", "easy"),
            ("Balas pesan atau komentar dari rekan seprofesi", "daily", "low", "easy"),
            ("Bagikan satu wawasan industri di media sosial profesional", "weekly", "medium", "medium"),
            ("Ucapkan selamat ke kontak yang naik jabatan atau pindah kerja", "weekly", "low", "easy"),
            ("Luangkan 10 menit menjaga hubungan dengan mentor", "weekly", "medium", "easy"),
            ("Catat satu orang yang ingin kamu ajak ngobrol bulan ini", "weekly", "low", "easy"),
        ],
        "task": [
            ("Perbarui profil LinkedIn dengan pencapaian terbaru", "monthly", "medium", "medium"),
            ("Jadwalkan ngopi atau video call dengan satu kontak lama", "monthly", "medium", "medium"),
            ("Ikuti satu acara atau webinar industri", "monthly", "high", "medium"),
            ("Susun daftar 10 orang kunci di bidangmu untuk dihubungi", "monthly", "medium", "medium"),
            ("Minta perkenalan ke pihak ketiga yang ingin kamu kenal", "monthly", "medium", "hard"),
            ("Kirim pesan tindak lanjut setelah bertemu kontak baru", "weekly", "medium", "easy"),
        ],
    },
    ("Karir", "Produktivitas kerja"): {
        "habit": [
            ("Tentukan 3 tugas terpenting sebelum mulai kerja", "daily", "high", "easy"),
            ("Matikan notifikasi saat sesi kerja fokus", "daily", "medium", "easy"),
            ("Kerjakan tugas tersulit di jam paling produktifmu", "daily", "high", "medium"),
            ("Tutup hari kerja dengan menulis progres hari ini", "daily", "medium", "easy"),
            ("Bersihkan inbox email sampai kosong sekali sehari", "daily", "low", "easy"),
            ("Ambil jeda 5 menit tiap selesai satu blok kerja", "daily", "low", "easy"),
        ],
        "task": [
            ("Rapikan dan prioritaskan daftar tugas tiap Senin", "weekly", "high", "easy"),
            ("Evaluasi tugas mana yang bisa didelegasikan atau dihapus", "weekly", "medium", "medium"),
            ("Siapkan template untuk pekerjaan yang sering berulang", "monthly", "medium", "medium"),
            ("Blokir waktu fokus tanpa rapat di kalender minggu depan", "weekly", "medium", "easy"),
            ("Audit alat kerja yang justru menghambat", "monthly", "low", "medium"),
            ("Review beban kerja bulan ini dan sesuaikan target", "monthly", "medium", "medium"),
        ],
    },
    ("Karir", "Profesionalisme"): {
        "habit": [
            ("Mulai dan hadiri rapat tepat waktu", "daily", "medium", "easy"),
            ("Balas email penting dalam 24 jam", "daily", "medium", "easy"),
            ("Catat keputusan dan tindak lanjut setiap rapat", "daily", "medium", "easy"),
            ("Sampaikan kabar lebih awal saat ada keterlambatan", "weekly", "medium", "easy"),
            ("Ucapkan terima kasih ke rekan yang membantu", "daily", "low", "easy"),
        ],
        "task": [
            ("Minta umpan balik dari atasan tentang kinerjamu", "monthly", "high", "medium"),
            ("Perbarui CV dan portofolio dengan capaian terbaru", "monthly", "medium", "medium"),
            ("Pelajari SOP atau kode etik terbaru di tempat kerja", "monthly", "low", "easy"),
            ("Tetapkan batas jam kerja agar tidak kelelahan", "weekly", "medium", "medium"),
            ("Tulis ringkasan pencapaian kuartal ini", "monthly", "medium", "medium"),
        ],
    },
    ("Keuangan", "Investasi"): {
        "habit": [
            ("Baca satu artikel atau berita keuangan tepercaya", "daily", "low", "easy"),
            ("Pantau portofolio tanpa panik menjual", "weekly", "low", "easy"),
            ("Catat alasan setiap keputusan beli atau jual aset", "weekly", "medium", "easy"),
            ("Hindari cek harga aset lebih dari sekali sehari", "daily", "low", "easy"),
            ("Sisihkan dana investasi rutin", "monthly", "high", "medium"),
        ],
        "task": [
            ("Setel auto-invest ke reksa dana atau saham tiap gajian", "monthly", "high", "medium"),
            ("Diversifikasi portofolio agar tidak menumpuk di satu aset", "monthly", "high", "hard"),
            ("Pelajari satu instrumen investasi baru beserta risikonya", "monthly", "medium", "hard"),
            ("Hitung ulang profil risiko dan target investasimu", "monthly", "medium", "medium"),
            ("Bandingkan biaya dan fee platform investasi yang kamu pakai", "monthly", "low", "medium"),
            ("Tetapkan target dana untuk satu tujuan jangka panjang", "monthly", "medium", "medium"),
        ],
    },
    ("Keuangan", "Kontrol diri"): {
        "habit": [
            ("Tunggu 24 jam sebelum membeli barang di luar rencana", "weekly", "medium", "easy"),
            ("Tanyakan 'butuh atau ingin?' sebelum checkout", "daily", "medium", "easy"),
            ("Bawa uang tunai secukupnya saat belanja", "weekly", "low", "easy"),
            ("Catat setiap godaan belanja yang berhasil kamu tahan", "daily", "low", "easy"),
        ],
        "task": [
            ("Berhenti berlangganan layanan yang jarang dipakai", "monthly", "medium", "easy"),
            ("Tetapkan batas belanja bulanan untuk hiburan", "monthly", "medium", "medium"),
            ("Unsubscribe dari email promo yang memancing belanja", "monthly", "low", "easy"),
            ("Buat daftar belanja dan patuhi saat ke pasar", "weekly", "medium", "easy"),
            ("Sisihkan tabungan dulu sebelum belanja", "monthly", "high", "medium"),
            ("Evaluasi pembelian besar terakhir: perlu atau tidak", "monthly", "low", "easy"),
        ],
    },
    ("Keuangan", "Menabung"): {
        "habit": [
            ("Sisihkan Rp20.000 ke tabungan tiap pagi", "daily", "medium", "easy"),
            ("Masukkan uang receh atau kembalian ke celengan digital", "daily", "low", "easy"),
            ("Pindahkan sisa uang harian ke tabungan tiap malam", "daily", "low", "easy"),
            ("Cek saldo tabungan tiap akhir pekan", "weekly", "low", "easy"),
        ],
        "task": [
            ("Buka rekening terpisah khusus dana darurat", "monthly", "high", "medium"),
            ("Setel auto-debit tabungan tiap tanggal gajian", "monthly", "high", "easy"),
            ("Tetapkan target dana darurat 3-6 bulan pengeluaran", "monthly", "high", "medium"),
            ("Naikkan nominal tabungan otomatis 5% bulan ini", "monthly", "medium", "easy"),
            ("Pisahkan tabungan tujuan dari dana darurat", "monthly", "medium", "medium"),
            ("Tinjau ke mana uang tabungan bulan lalu mengalir", "monthly", "low", "easy"),
        ],
    },
    ("Keuangan", "Pengeluaran"): {
        "habit": [
            ("Catat semua pengeluaran hari ini", "daily", "medium", "easy"),
            ("Masak di rumah alih-alih jajan di luar", "daily", "medium", "medium"),
            ("Bandingkan harga sebelum membeli kebutuhan besar", "weekly", "low", "easy"),
            ("Cek total pengeluaran tiap akhir pekan", "weekly", "medium", "easy"),
        ],
        "task": [
            ("Susun anggaran bulanan dengan metode 50/30/20", "monthly", "high", "medium"),
            ("Identifikasi 3 pengeluaran terbesar dan cara menekannya", "monthly", "medium", "medium"),
            ("Negosiasi ulang tagihan internet, listrik, atau asuransi", "monthly", "medium", "hard"),
            ("Rekap pengeluaran bulan lalu per kategori", "monthly", "medium", "easy"),
            ("Tetapkan anggaran untuk kategori yang sering bocor", "monthly", "medium", "medium"),
        ],
    },
    ("Pengembangan Diri", "Belajar"): {
        "habit": [
            ("Baca minimal 10 halaman buku tiap hari", "daily", "medium", "easy"),
            ("Tulis satu hal baru yang kamu pelajari hari ini", "daily", "low", "easy"),
            ("Ulangi catatan belajar kemarin selama 5 menit", "daily", "medium", "easy"),
            ("Dengarkan satu materi edukatif saat perjalanan", "daily", "low", "easy"),
        ],
        "task": [
            ("Pilih satu kursus online dan selesaikan satu modul", "weekly", "high", "medium"),
            ("Buat ringkasan satu buku yang sudah selesai dibaca", "monthly", "medium", "medium"),
            ("Tetapkan satu topik untuk dikuasai bulan ini", "monthly", "medium", "medium"),
            ("Ajarkan apa yang kamu pelajari ke orang lain", "weekly", "medium", "medium"),
            ("Uji pemahamanmu dengan latihan soal atau proyek kecil", "weekly", "medium", "hard"),
            ("Susun daftar bacaan untuk 3 bulan ke depan", "monthly", "low", "easy"),
        ],
    },
    ("Pengembangan Diri", "Mindset"): {
        "habit": [
            ("Tulis 3 hal yang kamu syukuri hari ini", "daily", "medium", "easy"),
            ("Ganti satu pikiran negatif dengan sudut pandang positif", "daily", "medium", "medium"),
            ("Rayakan satu kemajuan kecil hari ini", "daily", "low", "easy"),
            ("Renungkan satu pelajaran dari kesalahan hari ini", "daily", "medium", "easy"),
        ],
        "task": [
            ("Tulis ulang satu keyakinan membatasi jadi memberdayakan", "monthly", "medium", "hard"),
            ("Baca satu buku tentang growth mindset", "monthly", "medium", "medium"),
            ("Buat papan visi untuk tahun ini", "monthly", "low", "easy"),
            ("Kurangi konsumsi konten yang bikin membandingkan diri", "weekly", "medium", "medium"),
            ("Identifikasi pemicu stres dan rencana menghadapinya", "monthly", "medium", "medium"),
        ],
    },
    ("Pengembangan Diri", "Skill"): {
        "habit": [
            ("Latih skill utamamu minimal 20 menit", "daily", "high", "medium"),
            ("Pelajari satu teknik baru di bidangmu", "daily", "medium", "easy"),
            ("Praktikkan langsung apa yang baru dipelajari", "daily", "medium", "medium"),
            ("Catat progres latihan skill hari ini", "daily", "low", "easy"),
        ],
        "task": [
            ("Kerjakan satu proyek kecil untuk mengasah skill", "weekly", "high", "hard"),
            ("Minta umpan balik atas karyamu dari yang lebih ahli", "weekly", "medium", "medium"),
            ("Tetapkan target tingkat keahlian bulan ini", "monthly", "medium", "medium"),
            ("Tiru satu studi kasus lengkap dari tutorial", "weekly", "medium", "medium"),
            ("Bangun portofolio dari hasil latihanmu", "monthly", "medium", "medium"),
            ("Ikuti tantangan atau kompetisi untuk menguji skill", "monthly", "medium", "hard"),
        ],
    },
    ("Produktivitas", "Disiplin"): {
        "habit": [
            ("Bangun di jam yang sama setiap hari", "daily", "high", "medium"),
            ("Kerjakan satu tugas penting sebelum buka media sosial", "daily", "high", "medium"),
            ("Tidur tepat waktu agar bangun segar", "daily", "high", "medium"),
            ("Tepati satu komitmen kecil untuk diri sendiri", "daily", "medium", "easy"),
            ("Siapkan perlengkapan esok hari pada malam sebelumnya", "daily", "low", "easy"),
        ],
        "task": [
            ("Buat rutinitas pagi dan tempel di tempat terlihat", "monthly", "medium", "easy"),
            ("Hapus satu distraksi terbesar dari lingkunganmu", "weekly", "medium", "medium"),
            ("Susun jadwal harian ideal dan uji coba seminggu", "weekly", "medium", "medium"),
            ("Tetapkan konsekuensi dan hadiah untuk targetmu", "monthly", "low", "medium"),
            ("Evaluasi kebiasaan yang merusak disiplinmu", "monthly", "medium", "medium"),
        ],
    },
    ("Produktivitas", "Fokus kerja"): {
        "habit": [
            ("Kerja dengan teknik Pomodoro 25 menit fokus", "daily", "medium", "easy"),
            ("Singkirkan ponsel dari meja saat bekerja", "daily", "medium", "easy"),
            ("Mulai sesi kerja dengan menulis satu tujuan jelas", "daily", "medium", "easy"),
            ("Catat ide pengganggu di kertas lalu lanjut bekerja", "daily", "low", "easy"),
        ],
        "task": [
            ("Atur lingkungan kerja bebas gangguan", "weekly", "medium", "medium"),
            ("Pasang pemblokir situs pengganggu saat jam kerja", "monthly", "low", "easy"),
            ("Kelompokkan tugas sejenis agar jarang ganti konteks", "weekly", "medium", "medium"),
            ("Tentukan jam 'deep work' tetap tiap hari", "weekly", "medium", "medium"),
            ("Matikan notifikasi non-darurat secara permanen", "monthly", "low", "easy"),
        ],
    },
    ("Produktivitas", "Manajemen waktu"): {
        "habit": [
            ("Rencanakan hari esok sebelum tidur", "daily", "high", "easy"),
            ("Cek kalender dan prioritas tiap pagi", "daily", "medium", "easy"),
            ("Tetapkan tenggat untuk tiap tugas hari ini", "daily", "medium", "easy"),
            ("Selesaikan satu per satu, hindari multitasking", "daily", "medium", "medium"),
        ],
        "task": [
            ("Time-block kalender untuk minggu depan", "weekly", "high", "medium"),
            ("Lacak ke mana waktumu habis selama 3 hari", "weekly", "medium", "medium"),
            ("Terapkan aturan 2 menit untuk tugas singkat", "weekly", "low", "easy"),
            ("Identifikasi dan kurangi pencuri waktu terbesar", "monthly", "medium", "medium"),
            ("Delegasikan atau hapus satu tugas tak bernilai", "weekly", "medium", "medium"),
        ],
    },
    ("Produktivitas", "Organisasi"): {
        "habit": [
            ("Rapikan meja kerja sebelum pulang", "daily", "low", "easy"),
            ("Simpan file ke folder yang benar saat itu juga", "daily", "low", "easy"),
            ("Kosongkan inbox tugas ke daftar terstruktur", "daily", "medium", "easy"),
            ("Letakkan barang kembali ke tempatnya", "daily", "low", "easy"),
        ],
        "task": [
            ("Buat sistem folder digital yang konsisten", "monthly", "medium", "medium"),
            ("Bereskan satu area berantakan di rumah atau kantor", "weekly", "medium", "medium"),
            ("Susun checklist untuk rutinitas yang berulang", "monthly", "medium", "easy"),
            ("Arsipkan atau hapus file dan email lama yang menumpuk", "monthly", "low", "easy"),
            ("Siapkan satu tempat khusus untuk dokumen penting", "monthly", "medium", "easy"),
            ("Rapikan daftar tugas tiap akhir pekan", "weekly", "medium", "easy"),
        ],
    },
    ("Relasi & Keluarga", "Kebersamaan"): {
        "habit": [
            ("Makan bersama keluarga tanpa gawai", "daily", "high", "easy"),
            ("Luangkan 15 menit bermain atau ngobrol dengan keluarga", "daily", "medium", "easy"),
            ("Tanyakan kabar dan dengarkan cerita pasangan", "daily", "medium", "easy"),
            ("Abadikan satu momen kebersamaan", "weekly", "low", "easy"),
        ],
        "task": [
            ("Rencanakan satu kegiatan akhir pekan bersama", "weekly", "high", "medium"),
            ("Jadwalkan kunjungan ke orang tua atau saudara", "monthly", "medium", "medium"),
            ("Buat tradisi keluarga rutin", "monthly", "medium", "easy"),
            ("Atur liburan singkat keluarga", "monthly", "medium", "hard"),
            ("Sisihkan satu malam khusus tanpa pekerjaan untuk keluarga", "weekly", "medium", "easy"),
        ],
    },
    ("Relasi & Keluarga", "Kepedulian"): {
        "habit": [
            ("Tanyakan apakah ada yang bisa kamu bantu", "daily", "medium", "easy"),
            ("Beri pujian tulus ke orang terdekat", "daily", "low", "easy"),
            ("Perhatikan perubahan suasana hati orang di sekitarmu", "daily", "medium", "easy"),
            ("Ucapkan terima kasih atas hal kecil", "daily", "low", "easy"),
        ],
        "task": [
            ("Hubungi teman yang sedang kesulitan", "weekly", "medium", "easy"),
            ("Beri kejutan kecil untuk seseorang yang kamu sayang", "monthly", "low", "easy"),
            ("Tawarkan bantuan konkret ke tetangga atau kerabat", "monthly", "medium", "medium"),
            ("Tulis pesan apresiasi untuk seseorang yang berjasa", "monthly", "low", "easy"),
            ("Ingat dan rayakan tanggal penting orang terdekat", "monthly", "medium", "easy"),
        ],
    },
    ("Relasi & Keluarga", "Komunikasi"): {
        "habit": [
            ("Dengarkan sampai selesai sebelum menanggapi", "daily", "medium", "medium"),
            ("Sampaikan perasaan dengan kalimat 'aku', bukan menyalahkan", "daily", "medium", "medium"),
            ("Hindari menatap layar saat orang bicara", "daily", "medium", "easy"),
            ("Tanyakan kabar dengan pertanyaan terbuka", "daily", "low", "easy"),
        ],
        "task": [
            ("Adakan obrolan jujur untuk menyelesaikan satu masalah lama", "monthly", "high", "hard"),
            ("Minta maaf untuk satu hal yang masih mengganjal", "weekly", "medium", "medium"),
            ("Pelajari satu teknik komunikasi tanpa kekerasan", "monthly", "medium", "medium"),
            ("Sepakati cara menyelesaikan konflik bersama", "monthly", "medium", "hard"),
            ("Jadwalkan ngobrol rutin tanpa membahas masalah", "weekly", "medium", "easy"),
        ],
    },
    ("Relasi & Keluarga", "Sosial"): {
        "habit": [
            ("Sapa dan tersenyum ke orang yang kamu temui", "daily", "low", "easy"),
            ("Balas pesan teman dengan perhatian", "daily", "low", "easy"),
            ("Mulai satu percakapan ringan dengan orang baru", "weekly", "medium", "medium"),
        ],
        "task": [
            ("Ajak satu teman bertemu atau ngopi", "weekly", "medium", "easy"),
            ("Hadiri satu acara komunitas atau kumpul teman", "monthly", "medium", "medium"),
            ("Hubungi kembali teman lama yang lama tak kontak", "monthly", "low", "easy"),
            ("Gabung satu komunitas sesuai minatmu", "monthly", "medium", "medium"),
            ("Rencanakan pertemuan rutin dengan lingkaran dekat", "monthly", "medium", "easy"),
        ],
    },
    ("Spiritual", "Ibadah"): {
        "habit": [
            ("Mulai hari dengan doa atau niat baik", "daily", "high", "easy"),
            ("Jalankan ibadah tepat waktu", "daily", "high", "medium"),
            ("Baca kitab suci atau renungan beberapa ayat", "daily", "medium", "easy"),
            ("Akhiri hari dengan doa syukur", "daily", "medium", "easy"),
            ("Lakukan dzikir atau doa singkat di sela kesibukan", "daily", "low", "easy"),
        ],
        "task": [
            ("Ikuti satu kajian atau ibadah komunitas pekan ini", "weekly", "medium", "medium"),
            ("Pelajari makna satu bagian kitab suci lebih dalam", "weekly", "medium", "medium"),
            ("Tetapkan target ibadah yang ingin dikonsistenkan bulan ini", "monthly", "medium", "medium"),
            ("Siapkan tempat ibadah yang nyaman di rumah", "monthly", "low", "easy"),
            ("Lakukan satu amal atau sedekah terencana", "monthly", "medium", "easy"),
        ],
    },
    ("Spiritual", "Refleksi"): {
        "habit": [
            ("Tulis jurnal singkat tentang hari ini", "daily", "medium", "easy"),
            ("Renungkan satu hal yang kamu syukuri", "daily", "low", "easy"),
            ("Evaluasi apa yang baik dan bisa diperbaiki hari ini", "daily", "medium", "easy"),
            ("Duduk hening 5 menit tanpa gawai", "daily", "medium", "easy"),
        ],
        "task": [
            ("Lakukan refleksi mingguan atas pencapaian dan perasaan", "weekly", "high", "easy"),
            ("Tinjau tujuan hidup dan nilai-nilai utamamu", "monthly", "medium", "hard"),
            ("Tulis surat untuk dirimu di masa depan", "monthly", "low", "easy"),
            ("Evaluasi keseimbangan hidup: kerja, relasi, diri", "monthly", "medium", "medium"),
            ("Identifikasi satu kebiasaan untuk dilepas bulan ini", "monthly", "medium", "medium"),
        ],
    },
    ("Spiritual", "Sosial"): {
        "habit": [
            ("Lakukan satu kebaikan kecil tanpa pamrih", "daily", "medium", "easy"),
            ("Doakan kebaikan untuk orang lain", "daily", "low", "easy"),
            ("Tahan diri dari berkata buruk tentang orang", "daily", "medium", "medium"),
        ],
        "task": [
            ("Ikut kegiatan sosial atau bakti komunitas", "monthly", "medium", "medium"),
            ("Sumbang waktu sebagai relawan satu kali", "monthly", "medium", "medium"),
            ("Beri sedekah atau donasi terencana bulan ini", "monthly", "medium", "easy"),
            ("Bantu seseorang yang sedang kesulitan secara nyata", "weekly", "medium", "medium"),
            ("Damaikan atau pererat hubungan yang renggang", "monthly", "medium", "hard"),
        ],
    },
}

FREQ = {"daily", "weekly", "monthly"}
PRI = {"low", "medium", "high"}
DIFF = {"easy", "medium", "hard"}
OLD_PATTERN = re.compile(r"\d+\s*menit\s*(pagi|siang|malam)", re.IGNORECASE)


def build():
    rows = []
    for (kategori, subkategori), groups in DATA.items():
        tag = KATEGORI_TAG[kategori]
        for typ in ("habit", "task"):
            for item, freq, pri, diff in groups[typ]:
                assert freq in FREQ and pri in PRI and diff in DIFF, item
                assert not OLD_PATTERN.search(item), f"old pattern leaked: {item}"
                rows.append({
                    "kategori": kategori,
                    "subkategori": subkategori,
                    "type": typ,
                    "item": item,
                    "frequency": freq,
                    "priority": pri,
                    "difficulty": diff,
                    "tags": [subkategori.lower(), tag],
                })
    return rows


def main():
    rows = build()
    # sanity: every pair has >=1 habit and >=1 task
    for (kategori, subkategori), groups in DATA.items():
        assert groups["habit"], f"no habits for {kategori}/{subkategori}"
        assert groups["task"], f"no tasks for {kategori}/{subkategori}"
    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "habit_templates_curated.json",
    )
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(rows)} items to {out_path}")
    print(f"Pairs: {len(DATA)}")


if __name__ == "__main__":
    main()
