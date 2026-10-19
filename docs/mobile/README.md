# Rencana sesi migrasi mobile (Tauri → Capacitor)

Jadwal kerja tim untuk migrasi shell mobile Alurik ke Capacitor, dipecah per sesi 2–3 jam.
Dokumen acuannya ada di proyek Claude "alurik": Roadmap & WBS Migrasi Mobile, Playbook
Pengembangan Alurik Mobile, dan Papan Sesi Alurik (pemantauan progres).

| File | Isi |
| --- | --- |
| `plan.json` | 62 sesi: `id`, `title`, `phase`, `wbs`, `owner`, `kind`, `hours`, `deps`, `exit` (kriteria selesai), `planned` (tanggal), `milestone`. Sumber untuk Papan Sesi, issue GitHub (S04), dan tabel mingguan di playbook. |
| `../../scripts/mobile_schedule.py` | Penjadwal yang menulis `plan.json` dan mencetak kalender. |

## Asumsi saat ini

- Mulai Senin 19 Oktober 2026; Bapak + 2 developer (Dev A tanpa Mac, Dev B dengan Mac).
- Satu sesi per orang per hari. Bapak: Sen, Sel, Kam, Sab. Dev A dan Dev B: Sen–Kam.
- Gerbang/review diutamakan Selasa atau Kamis (hari merge + restart server); uji perangkat diutamakan Sabtu.
- Jeda wajib: closed testing Google Play 14 hari (S41 → S43) dan review produksi Play sampai 7 hari (S43 → S61).
- Hasil: 153 jam sesi, App Store diajukan 26 Nov (S57), Google Play 3 Des (S43), migrasi selesai 15 Des (S62).

## Mengubah jadwal

1. Ubah `START`, `HOLIDAYS`, `CAPACITY`, `PREFER`, atau daftar sesi `S` di `scripts/mobile_schedule.py`.
2. Jalankan `python3 scripts/mobile_schedule.py` (tanpa dependensi tambahan).
3. Commit `plan.json` bersama perubahan skrip dalam satu PR.
4. Setelah di-merge, perbarui Papan Sesi untuk sesi yang berubah. Hanya kolom rencana yang
   disalin (`title`, `phase`, `wbs`, `owner`, `kind`, `hours`, `deps`, `exit`, `planned`,
   `milestone`); `status`, `pr`, `note`, `actual_hours`, dan `history` milik tim, jangan ditimpa.
   Perbarui juga tabel mingguan di playbook.

Aturan penempatan: sesi diletakkan pada hari kerja pemiliknya yang paling awal, setelah semua
dependensinya (minimal hari berikutnya) dan setelah jeda `after` yang disebut. Hari pilihan dicoba
dalam 7 hari pertama; bila penuh, hari kerja lain pemilik dipakai.
