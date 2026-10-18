#!/usr/bin/env python3
"""Penjadwal sesi migrasi mobile Alurik (Tauri -> Capacitor).

Menempatkan 62 sesi ke kalender berdasarkan: pemilik sesi, hari kerja pemilik,
dependensi antar sesi, jeda wajib (verifikasi akun, closed testing 14 hari),
hari pilihan (uji di Sabtu, gerbang/review di Selasa/Kamis = hari restart) dan libur.
Keluaran: plan.json (dipakai dokumen, papan sesi, dan seeding issue GitHub).
"""
import json
import sys
from datetime import date, timedelta

START = date(2026, 10, 19)  # Senin
HOLIDAYS = {date(2026, 12, 24), date(2026, 12, 25), date(2026, 12, 31), date(2027, 1, 1)}

# 0=Senin ... 6=Minggu. Satu sesi per orang per hari.
CAPACITY = {
    "Bapak": {0, 1, 3, 5},       # Senin (kickoff/admin), Selasa & Kamis (merge + restart), Sabtu (uji/admin)
    "Dev A": {0, 1, 2, 3},
    "Dev B": {0, 1, 2, 3},
}
PREFER = {"review": {1, 3}, "uji": {5}}  # gerbang di hari restart (Sel/Kam); uji perangkat di Sabtu

# id, judul, fase, wbs, pemilik, jenis, jam, deps, kriteria selesai, opsi
# opsi: after=[(sid, hari)] jeda minimum setelah tanggal sesi lain; milestone="..."; prefer={...}
S = [
    ("S01", "Kickoff: setujui playbook, undang tim, proteksi main", "W", "W1", "Bapak", "admin", 2, [],
     "Tim punya akses GitHub dan Claude; GitHub App terpasang; main diproteksi; environment cloud bersama dibuat; PR #29 di-merge", {"prefer": {0}}),
    ("S02", "Repo siap tim: .claude/ dibagi, /mulai-sesi, /tutup-sesi, NOW.md", "W", "W2", "Dev A", "build", 3, ["S01"],
     "Perintah tim jalan di sesi cloud; .agents/NOW.md <= 80 baris; catatan per sesi di .agents/sessions/; setup environment di scripts/cloud-setup.sh", {}),
    ("S03", "Versi SW dicap saat deploy, bukan di tiap PR", "W", "W3", "Dev A", "build", 3, ["S02"],
     "deploy menulis static/version.json; PR frontend tidak menyentuh 19 file versi; CI menjalankan pytest dan npm test", {}),
    ("S04", "Bersihkan repo publik + buat milestone, label, issue per sesi", "W", "W4", "Dev B", "build", 2.5, ["S01"],
     "venv/ (dan aturan .gitignore-nya), uploads/, zip, gen-keystore.yml keluar dari repo; 62 issue dan 10 milestone terbuat", {}),
    ("S05", "Review dan merge paket kesiapan tim", "W", "W5", "Bapak", "review", 1, ["S02", "S03", "S04"],
     "S02-S04 di-merge dan ter-deploy; papan sesi dipakai tim", {}),
    ("S06", "Akun toko, verifikasi developer Android, kunci tanda tangan", "F0", "0.2, 0.3", "Bapak", "admin", 2, ["S01"],
     "Play Console + Apple Developer diajukan; nama paket terdaftar untuk verifikasi developer Android; asal keystore dipastikan; API key App Store Connect untuk CI", {}),
    ("S07", "ADR-008..013 dan skema versi mobile", "F0", "0.1, 0.7", "Dev A", "build", 2, ["S03"],
     "DECISIONS.md memuat 6 ADR baru dan disetujui Bapak", {}),
    ("S08", "Halaman privasi dan ketentuan + uji hapus akun", "F0", "0.5", "Dev B", "build", 2.5, ["S04"],
     "/privacy dan /terms tayang; tautan di Pengaturan; pytest hapus akun hijau", {}),
    ("S09", "Rilis terakhir APK Tauri dengan banner sinkronisasi", "F0", "0.6", "Dev A", "build", 2.5, ["S05", "S07", "S06"],
     "Pre-release terbit; banner muncul bila outbox berisi; catatan rilis menjelaskan cara pindah ke app baru", {}),
    ("S10", "Fastlane match di Mac: sertifikat dan profil iOS", "F0", "0.4", "Dev B", "ide", 2, ["S08"],
     "fastlane match development berhasil dari CI", {"after": [("S06", 10)]}),
    ("S11", "TF.native: antarmuka + implementasi web", "F1", "1.1", "Dev A", "build", 3, ["S05", "S07"],
     "tests/native/native_web.test.js hijau; PWA tidak berubah perilakunya", {}),
    ("S12", "Ganti cabang __TAURI__ dan API_BASE di index.html", "F1", "1.2a", "Dev A", "build", 3, ["S11"],
     "Tidak ada window.__TAURI__ di static/index.html; tes JS hijau", {}),
    ("S13", "Modul offline + adapter desktop Tauri", "F1", "1.2b", "Dev A", "build", 2.5, ["S12"],
     "Tidak ada __TAURI__ di static/offline/ (voicedictate, blobstore); desktop Windows diuji sekali", {}),
    ("S14", "resolveApiBase per platform + 3 fetch relatif", "F1", "1.3, 1.4", "Dev A", "build", 2.5, ["S13"],
     "Origin localhost/capacitor menghasilkan base server; tes URL absolut hijau", {}),
    ("S15", "GET /api/config + hapus injeksi flag AI", "F1", "1.6", "Dev B", "build", 2.5, ["S05"],
     "pytest endpoint; UI AI mengikuti server di PWA dan native", {}),
    ("S16", "Service worker hanya di web + ekspor lewat TF.native", "F1", "1.5, 1.7", "Dev A", "build", 3, ["S14"],
     "Tidak ada registrasi SW di native; semua ekspor lewat file.save", {}),
    ("S17", "tf_user_id native + regresi Playwright PWA", "F1", "1.8, 1.9", "Dev A", "build", 2, ["S16", "S15"],
     "Skenario storage direset lulus; Playwright login/offline/sync/konflik hijau", {}),
    ("S18", "Gerbang F1: review, merge dan deploy, cek PWA", "F1", "gerbang", "Bapak", "review", 1.5, ["S17"],
     "PR F1 di-merge; PWA di HP dan laptop berjalan seperti sebelumnya", {}),
    ("S19", "Refresh token di server + pytest", "F3", "3.1a", "Dev B", "build", 3, ["S15"],
     "pytest: refresh sukses, reuse ditolak, 401 setelah logout", {}),
    ("S20", "SSE ticket + /api/config lanjutan (server)", "F3", "3.2, 3.6", "Dev B", "build", 2.5, ["S19"],
     "Endpoint SSE menerima ?ticket=; min_supported_version tersedia", {}),
    ("S21", "assetlinks.json, AASA, tukar magic link (server)", "F3", "3.4a", "Dev B", "build", 2.5, ["S20", "S06"],
     "curl kedua file .well-known benar; endpoint exchange lulus pytest", {}),
    ("S22", "device_tokens + pengirim push FCM", "F3", "3.5", "Dev B", "build", 3, ["S21"],
     "Notifikasi uji terkirim lewat FCM ke token uji (skrip); uji di HP dilakukan di S60", {}),
    ("S23", "Klien: refresh otomatis, SSE ticket, lampiran tanpa token, deep link", "F3", "3.1b, 3.3, 3.4b", "Dev B", "build", 3, ["S22", "S18"],
     "Tidak ada ?token= di access log untuk klien baru; deep link membuka task", {}),
    ("S24", "Gerbang F3: merge dan deploy, restart, cek .well-known", "F3", "gerbang", "Bapak", "review", 1, ["S23"],
     "Server baru aktif setelah restart; web lama tetap jalan", {}),
    ("S25", "Scaffold mobile/ Capacitor + build-web-dist.js", "F2", "2.1", "Dev B", "build", 3, ["S14"],
     "npx cap sync android bersih; app membuka UI dan login ke produksi", {}),
    ("S26", "Signing, versi, CI AAB + APK", "F2", "2.7, 2.8", "Dev A", "build", 3, ["S25", "S06"],
     "Run CI < 15 menit; targetSdk 36; APK terpasang di HP uji (menimpa APK Tauri bila kuncinya sama)", {}),
    ("S27", "Adapter native-capacitor: token aman, file, tautan, tombol kembali", "F2", "2.2", "Dev A", "build", 3, ["S26"],
     "Tes unit adapter hijau; tombol kembali benar di 3 layar", {}),
    ("S28", "Terima share + dikte suara di Android", "F2", "2.3, 2.4", "Dev A", "build", 2.5, ["S27"],
     "Share dari Chrome jadi note bookmark (cold start juga); dikte jalan", {}),
    ("S29", "Lampiran, ekspor, splash, status bar, ikon", "F2", "2.5, 2.6", "Dev A", "build", 2.5, ["S28"],
     "Semua ekspor bisa dibuka di app lain; tema terang/gelap benar", {}),
    ("S30", "Uji paritas Android putaran 1 (3 HP)", "F2", "2.9a", "Bapak", "uji", 2, ["S29", "S24"],
     "Daftar periksa paritas terisi; bug dicatat sebagai issue", {}),
    ("S31", "Perbaikan bug paritas putaran 1", "F2", "2.9b", "Dev A", "build", 3, ["S30"],
     "Semua bug putaran 1 tertutup atau dijadwalkan", {}),
    ("S32", "Gerbang F2: uji paritas putaran 2", "F2", "gerbang", "Bapak", "uji", 1.5, ["S31"],
     "Paritas 100% di 3 HP; APK Capacitor menimpa APK Tauri", {}),
    ("S33", "widgetsnapshot.js + tes snapshot", "F4", "4.1", "Dev A", "build", 3, ["S17"],
     "Snapshot benar untuk task hari ini, terlambat, recurring, habit", {}),
    ("S34", "Plugin alurik-native Android: publish dan drain", "F4", "4.2", "Dev A", "build", 3, ["S33"],
     "Tes instrumentasi tulis/baca ulang hijau", {}),
    ("S35", "Widget Hari Ini (Glance, 3 ukuran)", "F4", "4.3", "Dev A", "ide", 3, ["S34"],
     "Tampil benar di Pixel, One UI, HyperOS; tangkapan layar 3 ukuran", {}),
    ("S36", "Interaksi widget: deep link, centang, antrean aksi", "F4", "4.4", "Dev A", "build", 3, ["S35", "S23"],
     "Aksi widget tiba di outbox tepat sekali, juga saat offline", {}),
    ("S37", "Tambah cepat + pembaruan tengah malam", "F4", "4.5, 4.6", "Dev A", "build", 2.5, ["S36"],
     "Task dari widget masuk Inbox P2; widget berganti hari tanpa membuka app", {}),
    ("S38", "Dokumentasi, tes, perbaikan widget Android", "F4", "4.7", "Dev A", "build", 2, ["S37"],
     "docs/mobile/widgets.md; tes unit Kotlin hijau", {}),
    ("S39", "Gerbang F4: uji widget di 3 launcher", "F4", "gerbang", "Bapak", "uji", 2, ["S38"],
     "Widget benar setelah edit offline, sync, ganti hari, reboot", {}),
    ("S40", "Aplikasi di Play Console, Play App Signing, listing", "F5", "5.1, 5.2", "Bapak", "admin", 2, ["S26", "S29"],
     "Play App Signing aktif; semua kolom listing terisi; 12+ penguji direkrut (Google Group)", {"after": [("S06", 7)]}),
    ("S41", "Data Safety, internal testing, mulai closed testing", "F5", "5.3, 5.4", "Bapak", "admin", 1.5, ["S40", "S31", "S08"],
     "12+ penguji opt-in; hitungan 14 hari dimulai", {}),
    ("S42", "In-app update + perbaikan dari pre-launch report", "F5", "5.5a", "Dev A", "build", 2.5, ["S41"],
     "Tidak ada temuan kritis di pre-launch report", {}),
    ("S43", "Ajukan rilis produksi Google Play (bertahap 20%)", "F5", "5.5b", "Bapak", "admin", 1, ["S42", "S39"],
     "Rilis produksi diajukan dengan widget Android", {"after": [("S41", 15)], "milestone": "Pengajuan Google Play"}),
    ("S44", "Tambah iOS, capabilities, jalan di iPhone", "F6", "6.1", "Dev B", "ide", 3, ["S25", "S10"],
     "Login, offline, sync lulus di iPhone fisik", {}),
    ("S45", "Keychain, safe area, keyboard, swipe", "F6", "6.2, 6.7", "Dev B", "ide", 2.5, ["S44", "S27"],
     "Token tidak bocor lintas instal; tidak ada konten tertutup notch", {}),
    ("S46", "Share Extension iOS", "F6", "6.3", "Dev B", "ide", 3, ["S45", "S28"],
     "Share dari Safari membuat note bookmark, termasuk saat app tertutup", {}),
    ("S47", "Dikte iOS, lampiran dan ekspor ke Files", "F6", "6.4, 6.8", "Dev B", "ide", 2.5, ["S46", "S29"],
     "Dikte dan semua ekspor setara Android", {}),
    ("S48", "Universal Links + APNs", "F6", "6.5, 6.6", "Dev B", "build", 2.5, ["S47", "S24"],
     "Magic link Telegram membuka app; notifikasi uji tiba di iPhone", {}),
    ("S49", "CI iOS: Fastlane ke TestFlight", "F6", "6.9", "Dev B", "build", 3, ["S48"],
     "Tag v* menghasilkan build TestFlight < 30 menit", {}),
    ("S50", "App Store Connect: metadata, akun demo, TestFlight eksternal", "F6", "6.10", "Bapak", "admin", 1.5, ["S49", "S08"],
     "TestFlight eksternal disetujui; App Privacy terisi", {}),
    ("S51", "Uji paritas iOS (2 iPhone)", "F6", "6.11", "Bapak", "uji", 2, ["S50"],
     "Daftar periksa paritas terisi; bug dicatat", {}),
    ("S52", "Perbaikan bug paritas iOS", "F6", "6.11b", "Dev B", "build", 3, ["S51"],
     "Paritas iOS 100%", {}),
    ("S53", "Plugin Swift + widget Hari Ini (WidgetKit)", "F7", "7.1, 7.2a", "Dev B", "ide", 3, ["S49", "S34"],
     "Widget small/medium tampil dari snapshot App Group", {}),
    ("S54", "Lock screen, timeline tengah malam, Tambah cepat", "F7", "7.2b, 7.4", "Dev B", "ide", 3, ["S53"],
     "Widget berganti hari tanpa membuka app; quick capture terbuka", {}),
    ("S55", "AppIntent: centang selesai dari widget", "F7", "7.3", "Dev B", "ide", 3, ["S54", "S36"],
     "Aksi tiba di outbox tepat sekali", {}),
    ("S56", "Live Activity Pomodoro (opsional) + tes widget iOS", "F7", "7.5, 7.6", "Dev B", "ide", 2.5, ["S55"],
     "Build TestFlight berisi widget; dokumentasi iOS di widgets.md", {}),
    ("S57", "Uji widget iOS + ajukan ke App Store", "F7", "gerbang", "Bapak", "admin", 2, ["S56", "S52"],
     "Build diajukan untuk review App Store (rilis bertahap)", {"milestone": "Pengajuan App Store"}),
    ("S58", "Server OTA + bundle di deploy.yml", "F8", "8.1a", "Dev A", "build", 3, ["S38", "S24"],
     "Bundle zip terbit di kanal beta setiap push ke main", {}),
    ("S59", "Klien OTA, rollback, aturan rilis", "F8", "8.1b, 8.2", "Dev A", "build", 3, ["S58", "S42"],
     "Perubahan UI tiba < 1 jam tanpa rilis toko; rollback teruji", {}),
    ("S60", "Push end-to-end: pengingat, grup, DM", "F8", "8.3", "Dev B", "build", 3, ["S56", "S22"],
     "Push tiba di Android dan iOS; opt-out bekerja", {}),
    ("S61", "Lepas Tauri mobile + runbook rilis mobile", "F8", "8.4, 8.5", "Dev A", "build", 2.5, ["S43", "S59"],
     "Rilis Play sudah disetujui; android.yml dan patch Tauri Android terhapus; docs/mobile-release.md dipakai", {"after": [("S43", 7)]}),
    ("S62", "Retrospektif dan penutupan migrasi", "F8", "gerbang", "Bapak", "review", 1.5, ["S61", "S57", "S60"],
     "Semua gerbang lulus; runbook dipakai untuk rilis berikutnya", {"milestone": "Migrasi selesai"}),
]


def schedule():
    by_id = {}
    taken = {k: set() for k in CAPACITY}
    for sid, title, phase, wbs, owner, kind, hours, deps, exit_, opts in S:
        for d in deps:
            if d not in by_id:
                sys.exit(f"{sid} depends on {d} which is not scheduled yet")
        earliest = START
        for d in deps:
            earliest = max(earliest, by_id[d]["planned"] + timedelta(days=1))
        for d, gap in opts.get("after", []):
            earliest = max(earliest, by_id[d]["planned"] + timedelta(days=gap))
        prefer = opts.get("prefer") or PREFER.get(kind)

        def free(d, need_pref):
            return (d.weekday() in CAPACITY[owner] and d not in taken[owner] and d not in HOLIDAYS
                    and (not need_pref or prefer is None or d.weekday() in prefer))

        day = None
        if prefer:  # hari pilihan dalam 6 hari; bila penuh, hari kerja pemilik mana pun
            for i in range(7):
                if free(earliest + timedelta(days=i), True):
                    day = earliest + timedelta(days=i)
                    break
        if day is None:
            day = earliest
            while not free(day, False):
                day += timedelta(days=1)
                if day > date(2027, 6, 1):
                    sys.exit(f"cannot place {sid}")
        taken[owner].add(day)
        by_id[sid] = {
            "id": sid, "title": title, "phase": phase, "wbs": wbs, "owner": owner, "kind": kind,
            "hours": hours, "deps": deps, "exit": exit_, "planned": day,
            "milestone": opts.get("milestone"),
        }
    return by_id


def main():
    plan = schedule()
    rows = []
    for s in plan.values():
        r = dict(s)
        r["planned"] = s["planned"].isoformat()
        rows.append(r)
    out = {
        "generated": date.today().isoformat(),
        "start": START.isoformat(),
        "assumption": "Bapak + 2 developer (Dev A tanpa Mac, Dev B dengan Mac); 1 sesi per orang per hari kerja",
        "capacity": {k: sorted(v) for k, v in CAPACITY.items()},
        "holidays": sorted(d.isoformat() for d in HOLIDAYS),
        "sessions": rows,
    }
    path = sys.argv[1] if len(sys.argv) > 1 else "docs/mobile/plan.json"
    with open(path, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # ringkasan
    names = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
    for r in rows:
        d = date.fromisoformat(r["planned"])
        print(f'{r["id"]} {d.isoformat()} {names[d.weekday()]} {r["owner"]:6} {r["kind"]:6} {r["hours"]:>4} {r["phase"]:3} {r["title"][:60]}'
              + (f'  <<{r["milestone"]}>>' if r["milestone"] else ""))
    tot = sum(r["hours"] for r in rows)
    print("total sessions", len(rows), "total hours", tot)
    for o in CAPACITY:
        mine = [r for r in rows if r["owner"] == o]
        print(o, len(mine), "sessions", sum(r["hours"] for r in mine), "h", "last", max(r["planned"] for r in mine))


if __name__ == "__main__":
    main()
