# 🚀 TaskFlow V4

**Personal GTD + Eisenhower + Priority Todo System — Telegram Bot**

TaskFlow V4 adalah sistem manajemen task pribadi yang menggabungkan tiga metodologi produktivitas:

- **GTD (Getting Things Done)** — Workflow status: inbox → next/waiting/someday/project → done
- **Priority P1-P4** — User-defined importance level (static, set manual)
- **Eisenhower Matrix Q1-Q4** — Urgency × importance (dynamic, auto-calculated setiap 15 menit)

---

## 📦 Isi Package

```
taskflow-v4/
├── bot.py              # Main Telegram bot (semua commands)
├── models.py           # Data models (Task, GTDStatus, Priority, Quadrant)
├── repository.py       # SQLite database operations
├── eisenhower.py       # Eisenhower auto-calculator
├── datehelper.py        # Date parser (DD-MM-YYYY, bahasa Indonesia)
├── config.py           # Configuration loader
├── requirements.txt    # Python dependencies
├── .env.example        # Template konfigurasi
├── taskflow.service    # Systemd service template
├── install.sh          # One-click installer
└── README.md           # Dokumentasi ini
```

---

## 🔧 System Requirements

- **OS**: Ubuntu 20.04+ / Debian 11+ (atau Linux lain dengan systemd)
- **Python**: 3.10+
- **RAM**: ~50MB
- **Disk**: ~30MB (tanpa data)
- **Network**: Akses ke api.telegram.org

---

## 📥 Instalasi (3 Langkah)

### Langkah 1 — Persiapan Bot Telegram

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`
3. Ikuti instruksi, beri nama bot (misal: "TaskFlow V4")
4. Simpan **Bot Token** yang diberikan
5. Opsional: cari tahu Telegram User ID kamu via **@userinfobot**

### Langkah 2 — Upload & Extract

```bash
# Upload file taskflow-v4.zip ke server, lalu:
cd ~
unzip taskflow-v4.zip
cd taskflow-v4
```

### Langkah 3 — Jalankan Installer

```bash
chmod +x install.sh
./install.sh
```

Installer akan:
- ✅ Cek Python version
- ✅ Buat virtual environment
- ✅ Install semua dependencies
- ✅ Minta Bot Token & User ID
- ✅ Generate file `.env`
- ✅ Test semua module
- ✅ Setup systemd service (auto-start saat boot)

Setelah selesai:

```bash
sudo systemctl start taskflow
```

Buka Telegram → cari bot kamu → ketik `/start` 🎉

---

## 🛠️ Perintah Manual (tanpa installer)

Jika ingin setup manual:

```bash
cd ~/taskflow-v4

# Install Python venv (jika belum)
sudo apt install python3 python3-venv python3-pip

# Buat virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Setup config
cp .env.example .env
nano .env    # Edit: isi BOT_TOKEN dan USER_ID

# Jalankan
python bot.py
```

---

## 📱 Daftar Command Telegram

### ➕ Tambah Task
| Command | Fungsi |
|---------|--------|
| `/add` | Tambah task (guided, step-by-step) |
| `/quick <judul>` | Quick add dengan flags |

**Quick add flags:**
```
/quick Kirim invoice p1 @computer #freelance dl:besok
```
- `p1`-`p4` → priority
- `#nama` → project
- `@context` → GTD context
- `dl:tanggal` → deadline (format: `DD-MM-YYYY`, `besok`, `+3d`, `+1w`)

### 📋 Lihat & Edit
| Command | Fungsi |
|---------|--------|
| `/view <id>` | Detail + action buttons |
| `/edit <id>` | Edit field task |
| `/delete <id>` | Hapus task |

### 🔄 GTD Workflow
| Command | Fungsi |
|---------|--------|
| `/inbox` | Lihat inbox |
| `/next` | Next actions |
| `/waiting` | Waiting for |
| `/someday` | Someday/maybe |
| `/projects` | Daftar semua project |
| `/process` | Proses inbox satu-per-satu (interactive) |
| `/done <id>` | Tandai selesai (bisa multi: `/done 1 2 3`) |

### 📊 Eisenhower Matrix
| Command | Fungsi |
|---------|--------|
| `/q1` | 🔥 Do — Urgent + Important |
| `/q2` | 📅 Schedule — Important |
| `/q3` | 👋 Delegate — Urgent |
| `/q4` | 🗑️ Eliminate — Neither |

### 🔍 Filter & View
| Command | Fungsi |
|---------|--------|
| `/list` | Semua task aktif |
| `/list p1` | Filter by priority |
| `/list q2` | Filter by quadrant |
| `/list next` | Filter by GTD status |
| `/list #project` | Filter by project |
| `/list @computer` | Filter by context |
| `/list p1 next #work` | Kombinasi filter |
| `/overdue` | Task yang melewati deadline |
| `/today` | Fokus hari ini (Q1 + overdue) |

### 📈 Review
| Command | Fungsi |
|---------|--------|
| `/summary` | Dashboard angka |
| `/review` | Weekly review helper |

---

## 🧠 Cara Kerja Eisenhower Auto-Calc

Setiap 15 menit (configurable), TaskFlow menghitung ulang quadrant semua task aktif:

**Importance** (dari Priority):
- P1 Critical → skor 10 → **Important**
- P2 High → skor 7 → **Important**
- P3 Medium → skor 4 → Not important
- P4 Low → skor 1 → Not important

**Urgency** (dari deadline proximity):
- Overdue → skor 10 → **Urgent**
- Hari ini → skor 10 → **Urgent**
- 1 hari → skor 9 → **Urgent**
- 3 hari → skor 7 → **Urgent**
- 7 hari → skor 5 → **Urgent** (threshold)
- 14 hari → skor 3 → Not urgent
- 30 hari → skor 2 → Not urgent
- Tanpa deadline → skor 2 → Not urgent

**Hasil:**
- Urgent + Important → **Q1 Do**
- Important + Not Urgent → **Q2 Schedule**
- Urgent + Not Important → **Q3 Delegate**
- Not Urgent + Not Important → **Q4 Eliminate**

---

## ⚙️ Konfigurasi (.env)

| Variable | Default | Keterangan |
|----------|---------|------------|
| `TELEGRAM_BOT_TOKEN` | — | Token dari @BotFather (wajib) |
| `ALLOWED_USER_IDS` | (kosong) | Comma-separated Telegram user IDs. Kosong = semua boleh |
| `DB_PATH` | `./taskflow.db` | Path file database SQLite |
| `EISENHOWER_INTERVAL_MINUTES` | `15` | Interval recalc Eisenhower (menit) |
| `TIMEZONE` | `Asia/Jakarta` | Timezone |

---

## 🔧 Maintenance

```bash
# Lihat status
sudo systemctl status taskflow

# Lihat log real-time
sudo journalctl -u taskflow -f

# Restart setelah edit .env
sudo systemctl restart taskflow

# Stop
sudo systemctl stop taskflow

# Backup database
cp ~/taskflow-v4/taskflow.db ~/taskflow-v4/taskflow.db.bak

# Update (setelah upload file baru)
sudo systemctl stop taskflow
# ... replace files ...
sudo systemctl start taskflow
```

---

## 📋 Workflow yang Disarankan

### Harian
1. `/today` — Lihat fokus hari ini
2. Kerjakan task Q1 & overdue
3. `/quick` untuk capture task baru yang muncul
4. `/done` untuk task yang selesai

### Mingguan
1. `/review` — Jalankan weekly review
2. `/process` — Proses semua item di inbox
3. `/waiting` — Cek progress waiting-for items
4. `/someday` — Review someday/maybe, pindahkan yang relevan ke next
5. `/summary` — Lihat keseluruhan dashboard

---

**TaskFlow V4** — Built with ❤️ for productivity
