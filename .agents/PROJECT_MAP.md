# Project Map — Domain ↔ Codebase

> **SINGLE SOURCE OF TRUTH** untuk memetakan proyek/domain yang disebut user ke lokasi codebase-nya. Wajib dibaca saat pre-flight (lihat `.agents/PROTOCOL.md`). Semua agent (Claude, Gemini, OpenAI, dll.) menggunakan file ini — versi repo ini yang berlaku, bukan catatan pribadi agent mana pun.

**Workspace ini (Z:\Todolist Manager V5.0) HANYA berisi Alurik (dulu TaskFlow).**

| Proyek / domain                  | Apa                                                                              | Lokasi codebase                                   | Catatan                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alurik — dulu TaskFlow (Todolist Manager V5.0) | Todolist + notes + bot Telegram, rencana SaaS                                    | Z:\Todolist Manager V5.0 (repo ini)               | Belum punya forgot password; tabel users TANPA kolom email (terverifikasi 2026-08-13)                                                                   |
| jatahku.com                      | Proyek TERPISAH dari TaskFlow (muncul sebagai folder task "Jatahku" di TaskFlow) | **BELUM DIKETAHUI — tanya user sebelum analisis** | Catatan 2026-07-04: user sempat salah sebut "jatahku" padahal maksudnya TaskFlow — kalau nama proyek terasa tidak cocok dengan konteks, konfirmasi dulu |

## Modul media note (audio/video di note)

| Modul | Peran |
| --- | --- |
| `media_storage.py` | Antarmuka penyimpanan media (`local`, nanti `r2`); kunci uuid divalidasi regex sebelum menyentuh disk |
| `media_probe.py` | Sniff format dari byte awal, parser ffprobe, faststart/poster, `MEDIA_DIRECTIVE_RE`, `format_duration` |
| `media_worker.py` | Antrean latar: ffprobe, remux faststart, poster, status `processing` → `ready`/`failed` |
| `media_serve.py` | Token HMAC URL media, parser Range, respons `/media/{token}` (`X-Accel-Redirect`) |

## Aturan

1. Kalau user menyebut proyek/domain yang **tidak ada** di tabel ini, JANGAN asumsikan itu repo ini. Tanya dulu proyek apa dan di mana kodenya, lalu **tambahkan barisnya ke tabel ini**.
2. Kalau kamu menemukan perubahan (lokasi codebase pindah, proyek baru, proyek ditutup), **update tabel ini** — jangan simpan di catatan pribadi agent.
