"""
TaskFlow V4 — Natural Language Parser

Mendeteksi task dari teks bebas Bahasa Indonesia/Inggris.
Menggunakan scoring dua sumbu Eisenhower: Urgency + Importance.
Case-insensitive, hyphen-insensitive.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional


# ── Normalisasi ────────────────────────────────────────────────────────────────
def _norm(text: str) -> str:
    """Lowercase + ganti tanda hubung/underscore jadi spasi."""
    return re.sub(r'[-_]', ' ', text.lower())


def _score(text_norm: str, keywords: set) -> int:
    """Hitung berapa keyword dari set yang muncul di teks."""
    count = 0
    for kw in keywords:
        if kw in text_norm:
            count += 1
    return count


# ── Urgency — Tinggi (mendesak, waktu mepet) ──────────────────────────────────
URGENCY_HIGH: set[str] = {
    "segera", "mendesak", "deadline", "hari ini", "besok", "darurat",
    "urgent", "sekarang", "asap", "detik ini", "malam ini", "sore ini",
    "pagi ini", "siang ini", "lusa", "limit", "mepet", "terburu", "gas",
    "gaspol", "langsung", "saat ini", "fast", "cepat", "kilat", "instan",
    "prioritas", "utama", "penentu", "krusial", "kritis", "fatal", "bahaya",
    "waspada", "awas", "peringatan", "limitasi", "terikat", "jadwal",
    "kalender", "agenda", "janji", "temu", "meeting", "zoom", "call",
    "telpon", "wa", "chat", "balas", "respon", "submit", "kirim", "upload",
    "cetak", "bayar", "lunas", "tagihan", "denda", "jatuh tempo", "expired",
    "running", "on air", "live", "rilis", "deploy", "reboot", "restart",
    "down", "error", "crash", "fix", "perbaiki", "tambal", "patching",
    "ganti", "ban bocor", "oli kering", "rem blong", "korslet", "trip",
    "mcb", "genset", "bbm", "bensin", "habis", "kosong", "antre", "tiket",
    "booking", "check in", "boarding", "berangkat", "jalan", "mulai",
    "kick off", "deadline dekat", "sisa jam", "sisa menit", "hitung mundur",
    "stopwatch", "on time", "telat", "terlambat", "susulan", "susul",
    "kejar", "tayang", "tayangkan", "publikasi", "posting", "broadcast",
    "sebar", "umumkan", "instruksi", "perintah", "titah", "mandat", "paksa",
    "dorong", "percepat", "akselerasi", "sprint", "h 1", "h 2", "h 3",
    "pekan ini", "penutupan", "tutup", "buka", "launching", "peresmian",
    "kunjungan", "sidak", "audit", "cek fisik", "ukur", "sampling", "tes",
    "uji", "coba", "running test", "komisioning", "serah terima", "bast",
    "invoicing", "billing", "transfer", "wd", "withdraw", "cairkan", "tarik",
    "gajian", "belanja", "dapur", "beras", "air galon", "gas elpiji",
    "susu anak", "jemput", "sekolah", "les", "dokter", "rumah sakit",
    "obat", "dosis", "terapi", "jadwal sholat", "buka puasa", "imsak",
    "sahur", "sholat jumat", "mudik", "tiket pulang", "packing",
    "berangkat sekarang",
}

# ── Urgency — Rendah (santai, tidak mendesak) ──────────────────────────────────
URGENCY_LOW: set[str] = {
    "nanti", "kapan kapan", "kalau sempat", "santai", "besok besok",
    "minggu depan", "bulan depan", "tahun depan", "kapan saja", "fleksibel",
    "longgar", "luang", "waktu luang", "libur", "cuti", "weekend", "minggu",
    "istirahat", "jeda", "tunda", "pending", "daftar tunggu", "wishlist",
    "impian", "rencana", "ide", "draf", "konsep", "coretan", "iseng",
    "coba coba", "testing", "riset", "baca", "nonton", "dengerin", "koleksi",
    "arsip", "simpan", "gudang", "opsional", "tambahan", "pelengkap", "hobi",
    "hiburan", "main", "game", "rileks", "slow", "tenang", "damai", "aman",
    "terkendali", "stabil", "rutin", "harian", "berkala", "bulanan",
    "tahunan", "siklus", "sirkulasi", "cadangan", "stok", "inventaris",
    "dokumentasi", "log", "history", "riwayat", "catatan", "memo",
    "reminder", "pengingat", "nabung", "kumpulkan", "tumpuk", "sortir",
    "rapikan", "bereskan", "cuci", "gosok", "semir", "pajangan", "dekorasi",
    "hiasan", "taman", "siram", "pupuk", "longan", "pohon", "tanaman",
    "berkebun", "gali", "tanah", "pot", "bibit", "benih", "istirahat siang",
    "ngopi", "nongkrong", "ngobrol", "diskusi", "wacana", "rumor", "gosip",
    "kabar", "info", "tips", "trik", "tutorial", "belajar", "kursus",
    "modul", "ebook", "pdf", "bacaan", "artikel", "blog", "podcast", "video",
    "film", "series", "anime", "youtube", "netflix", "musik", "lagu",
    "playlist", "instrumen", "meditasi", "tidur", "rebahan", "malas",
    "santai sore", "jalan jalan", "healing", "liburan", "wisata", "piknik",
    "camping", "touring", "motoran", "modifikasi", "cat", "poles",
    "cuci motor", "servis rutin", "ganti oli bulanan", "cek tekanan ban",
    "cek rantai", "busi cadangan", "filter udara", "filter oli", "spion",
    "klakson", "lampu variasi", "stiker", "jaket", "helm", "sarung tangan",
    "sepatu santai", "sandal", "kaos", "kemeja", "celana", "cuci baju",
    "jemur", "lipat", "setrika", "sapu", "pel", "vakum", "bersih bersih",
    "bongkar lemari", "tata ulang", "dekor kamar", "cat tembok",
    "ganti lampu", "cek kran", "kuras toren",
}

# ── Importance — Tinggi (berdampak besar) ──────────────────────────────────────
IMPORTANCE_HIGH: set[str] = {
    "penting", "krusial", "wajib", "harus", "critical", "strategis",
    "utama", "vital", "esensial", "fundamental", "dasar", "pondasi", "inti",
    "target", "goal", "objektif", "misi", "visi", "profit", "uang", "cuan",
    "investasi", "tabungan", "jatah", "aset", "modal", "kerja", "kantor",
    "bos", "atasan", "klien", "vendor", "kontrak", "mou", "legal", "hukum",
    "pajak", "ijin", "sertifikat", "qc", "inspeksi", "standar", "mutu",
    "kualitas", "baut", "torsi", "mesh", "grounding", "switchyard", "vps",
    "server", "domain", "ssl", "database", "coding", "deploy", "produksi",
    "live", "rilis", "keluarga", "kesehatan", "anak", "istri", "orang tua",
    "rumah", "cicilan", "hutang", "piutang", "saldo", "budgeting", "envelope",
    "laporan", "evaluasi", "audit", "temuan", "koreksi", "nc",
    "non conformity", "iso", "k3", "safety", "helm proyek", "rompi",
    "sepatu safety", "boots", "sarung tangan listrik", "multimeter",
    "tang ampere", "megger", "grounding test", "tahanan tanah", "busbar",
    "isolator", "trafo", "panel", "kubikel", "ct", "pt", "relay", "proteksi",
    "setting", "kalkulasi", "perhitungan", "rumus", "data", "valid", "akurat",
    "presisi", "toleransi", "spesifikasi", "drawing", "blueprint", "skematik",
    "wiring", "kabel", "lug", "terminasi", "skun", "torque wrench",
    "kunci momen", "kalibrasi", "alat ukur", "jangka sorong", "mikrometer",
    "ketebalan", "coating", "painting", "welding", "las", "ndt", "rontgen",
    "penetrant", "visual check", "defect", "reject", "rework", "approve",
    "sign", "ttd", "stempel", "dokumen", "arsip negara", "rahasia", "privat",
    "password", "token", "apikey", "env", "config", "backup", "recovery",
    "migrasi", "update", "security", "firewall", "antivirus", "maldet",
    "imunify", "hestiacp", "wordpress", "python", "script", "bot",
    "otomatisasi", "scraping", "konten", "ide bisnis", "strategi marketing",
    "konversi", "traffic", "member", "subscriber", "growth",
}

# ── Importance — Rendah (dampak kecil) ────────────────────────────────────────
IMPORTANCE_LOW: set[str] = {
    # Override phrases — user sendiri yang bilang ini tidak kritis
    "kalau sempat", "kapan kapan", "iseng", "coba coba", "santai aja",
    "nanti aja", "kapan saja", "kalau bisa", "kalau ada waktu",
    # Low-impact items
    "sepele", "kecil", "receh", "tidak terlalu penting", "ringan", "remeh",
    "pelengkap", "aksesoris", "hiasan", "dekorasi", "interupsi", "gangguan",
    "spam", "iklan", "promo", "diskon", "kupon", "voucher", "poin", "hadiah",
    "giveaway", "sosmed", "scroll", "like", "komen", "share", "viral",
    "tren", "berita", "gosip", "gaya", "penampilan", "outfit", "baju",
    "sepatu", "tas", "dompet", "mainan", "pajangan", "debu", "kotor",
    "warna", "bentuk", "suara", "musik", "film", "hiburan", "game", "avatar",
    "skin", "diamond", "top up", "belanja online", "keranjang", "checkout",
    "paket", "unboxing", "ulasan", "review", "rating", "bintang", "komentar",
    "thread", "dm", "mention", "tag", "story", "reels", "fyp", "algoritma",
    "trending", "clickbait", "sensasi", "skandal", "artis", "selebgram",
    "influencer", "giveaway slot", "kuota", "wifi", "tethering", "baterai",
    "charge", "powerbank", "casing", "pelindung layar", "stiker motor",
    "gantungan kunci", "parfum", "pengharum ruangan", "tanaman hias",
    "pot bunga", "benih sayur", "pupuk cair", "semprotan", "gunting rumput",
    "sapu lidi", "kemoceng", "kanebo", "kit motor", "shampo motor",
    "poles body", "semir ban", "jok motor", "baut variasi", "tutup pentil",
    "warna kabel", "isolasi hitam", "lakban", "gunting", "cutter",
    "penggaris", "penghapus", "pensil", "pulpen warna", "stabilo",
    "buku catatan", "kertas scrap", "amplop", "perangko", "materai bekas",
    "brosur", "pamflet", "katalog", "menu", "harga", "perbandingan",
    "spek hp", "spek pc", "gaming gear", "rgb", "wallpaper", "font", "icon",
    "kursor", "tema", "dark mode", "widget", "shortcut", "folder",
    "recycle bin", "sampah", "cache", "cookies", "history browser",
    "bookmark", "aplikasi iseng", "bot lucu", "stiker wa", "meme",
    "candaan", "jokes", "tawa", "lucu", "unik", "aneh", "misteri", "mitos",
    "ramalan", "horoskop", "zodiak", "keberuntungan",
}

# ── Date phrase patterns ───────────────────────────────────────────────────────
_DATE_PHRASES = [
    r'minggu\s+depan', r'pekan\s+depan', r'bulan\s+depan', r'tahun\s+depan',
    r'hari\s+ini', r'besok\s+lusa', r'lusa', r'besok',
    r'(?:senin|selasa|rabu|kamis|jumat|jum.at|sabtu|ahad|minggu)(?:\s+depan)?',
    r'\+\d+[dw]',
    r'\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?',
    r'\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+\d{4})?',
    r'\d{1,2}\s+(?:jan|feb|mar|apr|jun|jul|agu|sep|okt|nov|des)(?:\s+\d{4})?',
]


def _extract_deadline(text_norm: str, original: str) -> tuple[Optional[date], Optional[tuple[int, int]]]:
    """Cari dan parse deadline dari teks. Return (date, span) atau (None, None)."""
    from datehelper import parse_date
    for pattern in _DATE_PHRASES:
        m = re.search(pattern, text_norm, re.IGNORECASE)
        if m:
            parsed = parse_date(m.group(0).strip())
            if parsed:
                return parsed, m.span()
    return None, None


def _deadline_urgency_bonus(deadline: Optional[date]) -> int:
    """Deadline dekat menambah skor urgency."""
    if not deadline:
        return 0
    days = (deadline - date.today()).days
    if days <= 0:
        return 3   # overdue
    elif days <= 1:
        return 2   # besok
    elif days <= 3:
        return 1   # 3 hari ke depan
    return 0


def _map_priority(urgent: bool, important: bool) -> str:
    if urgent and important:
        return "P1"
    elif not urgent and important:
        return "P2"
    elif urgent and not important:
        return "P3"
    else:
        return "P4"


_QUADRANT_INFO = {
    "P1": ("Q1", "🔥 Kerjakan Sekarang"),
    "P2": ("Q2", "📅 Jadwalkan"),
    "P3": ("Q3", "👋 Delegasikan"),
    "P4": ("Q4", "🗑 Pertimbangkan Drop"),
}


def parse_task(text: str) -> dict:
    """
    Parse teks bebas → field task.

    Return dict:
      title, priority, gtd_status, project, context, deadline,
      quadrant, quadrant_label, confidence, original
    """
    original = text
    text_norm = _norm(text.strip())
    removed_spans: list[tuple[int, int]] = []

    # ── #project ──────────────────────────────────────────────────────────────
    project = ""
    m = re.search(r'#(\w+)', text_norm)
    if m:
        project = m.group(1)
        removed_spans.append(m.span())

    # ── @context ──────────────────────────────────────────────────────────────
    context_tag = ""
    m = re.search(r'@(\w+)', text_norm)
    if m:
        context_tag = "@" + m.group(1)
        removed_spans.append(m.span())

    # ── Deadline ──────────────────────────────────────────────────────────────
    deadline, dl_span = _extract_deadline(text_norm, text)
    if dl_span:
        removed_spans.append(dl_span)

    # ── Scoring ───────────────────────────────────────────────────────────────
    uh = _score(text_norm, URGENCY_HIGH)
    ul = _score(text_norm, URGENCY_LOW)
    ih = _score(text_norm, IMPORTANCE_HIGH)
    il = _score(text_norm, IMPORTANCE_LOW)

    # Deadline proximity menambah urgency
    uh += _deadline_urgency_bonus(deadline)

    urgent = uh > ul
    important = ih > il

    # Default: jika tidak ada sinyal sama sekali → inbox P3
    priority = _map_priority(urgent, important)
    quadrant, quadrant_label = _QUADRANT_INFO[priority]

    # ── GTD status dari urgency/importance ────────────────────────────────────
    gtd_status = "inbox"
    if ul > uh and il > ih:
        gtd_status = "someday"
    elif _score(text_norm, {"tunggu", "menunggu", "nunggu", "waiting", "wait for", "masih nunggu"}) > 0:
        gtd_status = "waiting"
    elif priority in ("P1", "P2"):
        gtd_status = "next"

    # ── Bangun title ──────────────────────────────────────────────────────────
    removed_spans.sort(key=lambda x: x[0])
    parts = []
    prev_end = 0
    for start, end in removed_spans:
        if start > prev_end:
            parts.append(text_norm[prev_end:start])
        prev_end = max(prev_end, end)
    parts.append(text_norm[prev_end:])
    title = re.sub(r'\s+', ' ', "".join(parts)).strip()
    title = re.sub(r'^[\s,.\-:;]+|[\s,.\-:;]+$', '', title).strip()

    # Gunakan kapitalisasi dari teks asli untuk title
    if title and title in _norm(text):
        idx = _norm(text).find(title)
        title = text[idx: idx + len(title)].strip()

    confidence = 1.0 if title else 0.0

    return {
        "title": title,
        "priority": priority,
        "gtd_status": gtd_status,
        "project": project,
        "context": context_tag,
        "deadline": deadline,
        "quadrant": quadrant,
        "quadrant_label": quadrant_label,
        "urgent": urgent,
        "important": important,
        "confidence": confidence,
        "original": original,
    }


def format_confirmation(parsed: dict) -> str:
    """Pesan konfirmasi yang ditampilkan ke user."""
    from datehelper import format_date

    title = parsed["title"] or "?"
    gtd_icons = {
        "inbox": "📥 Inbox", "next": "▶️ Next",
        "waiting": "⏳ Waiting", "someday": "💭 Someday",
    }

    urgency_label = "⚡ Mendesak" if parsed["urgent"] else "🕐 Tidak Mendesak"
    importance_label = "⭐ Penting" if parsed["important"] else "📎 Biasa"

    lines = [
        "📋 <b>Task terdeteksi:</b>",
        "",
        f"📝 <b>{title}</b>",
        f"{parsed['quadrant_label']}",
        f"└ {urgency_label}  ·  {importance_label}",
        f"🔄 {gtd_icons.get(parsed['gtd_status'], parsed['gtd_status'])}",
    ]
    if parsed["deadline"]:
        lines.append(f"📅 Deadline: {format_date(parsed['deadline'])}")
    if parsed["project"]:
        lines.append(f"📁 Project: {parsed['project']}")
    if parsed["context"]:
        lines.append(f"🏷️ Context: {parsed['context']}")

    lines += ["", "<i>Simpan task ini?</i>"]
    return "\n".join(lines)
