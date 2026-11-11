#!/usr/bin/env python3
"""Berkas UJI PROGRES untuk pemilik (uji pemilik #4, PR 1d-2) — BUKAN keluaran produk.

Latar: di uji pemilik #3 garis progres Microsoft Project hanya tampak pada task Manual 100 %; task Otomatis
(100/80/50/40 %) dan task Manual 50 % tampil tanpa garis walau XML-nya sebentuk. Penyebab belum diketahui, dan
perilaku impor MS Project tidak bisa diuji dari sini. Berkas ini menaruh SEMBILAN bentuk penulisan progres
berdampingan sebagai task terpisah (masing-masing 100 % dan 50 %), sehingga satu tangkapan dengan kolom
"% Complete" menunjukkan bentuk mana yang dibaca MS Project.

Dasar setiap baris = keluaran `TLMspdi.build` yang sebenarnya (Node, modul plugin Timeline), lalu varian diterapkan
per task dengan menyunting XML:

  S   bentuk sekarang (keluaran produk): assignment nyata (Sari, 4 🍅 → Units pecahan), Type 1, SNET, aktual/sisa
      di task dan assignment
  T   S + <Stop>/<Resume>/<ResumeValid> di task dan <Stop>/<Resume> di assignment
  P   S + <TimephasedData> per hari kerja di assignment (Type 2 = kerja aktual, Type 1 = kerja sisa)
  TP  S + Stop/Resume + TimephasedData (paling dekat dengan berkas tulisan MS Project sendiri)
  M   bentuk minimal MPXJ: task hanya PercentComplete + ActualStart/ActualFinish + RemainingDuration (tanpa Work,
      PercentWorkComplete, ActualDuration, ActualWork, RemainingWork); assignment tanpa PercentWorkComplete/Finish
  U   S dengan assignment penuh waktu (Units 1, Work = durasi)
  K   S tanpa batasan (ConstraintType 0, tanpa ConstraintDate)
  N   tanpa assignment sama sekali (progres hanya di task; Type 0)
  D   assignment semu ResourceUID -65535 (keluaran produk untuk task tanpa penanggung jawab; Type 0)
  XS  task Manual, bentuk sekarang (50 %)
  XT  task Manual + Stop/Resume (50 %)

Dua berkas ditulis ke temporary_files/e2e_plugin_fase1_1d2/:
  uji-progres-P2.xml             kepala Project keluaran kode (F8: ProjectExternallyEdited 0 dkk.)
  uji-progres-P3-kepala-lama.xml sama, tetapi sembilan bendera kepala F8 dibuang (kepala seperti berkas uji #3)

Pakai:  python3 temporary_files/mspdi_uji_progres.py
Lalu:   python3 temporary_files/mspdi_check.py --file <berkas>   (urutan XSD + MPXJ membaca; asersi bentuk produk
        "tanpa turunan MPXJ"/konsistensi boleh gagal pada baris varian — memang disengaja)
"""
import datetime as dt
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "temporary_files", "e2e_plugin_fase1_1d2")
NSU = "http://schemas.microsoft.com/project"
NS = "{%s}" % NSU
ET.register_namespace("", NSU)

VARIAN = ["S", "T", "P", "TP", "M", "U", "K", "N", "D"]
KET = {"S": "sekarang", "T": "+Stop", "P": "+Timephased", "TP": "+Stop+Timephased", "M": "minimal", "U": "penuh waktu",
       "K": "tanpa batasan", "N": "tanpa assignment", "D": "assignment semu", "XS": "manual sekarang", "XT": "manual +Stop"}
HEAD_F8 = ["SpreadActualCost", "SpreadPercentComplete", "TaskUpdatesResource", "MoveCompletedEndsBack",
           "MoveRemainingStartsBack", "MoveRemainingStartsForward", "MoveCompletedEndsForward", "ProjectExternallyEdited",
           "ActualsInSync"]

# Fixture: project "Uji progres" (Otomatis) + project "Manual" (Manual bawaan). 100 % = 3–6 Nov (selesai 6 Nov);
# 50 % = 9–12 Nov. Hari ini (D) = 2026-11-11. Semua task berdiri sendiri (tanpa tautan).
NODE_JS = r"""
const path = require("path");
const dir = path.join(process.cwd(), "static/plugins/timeline");
const C = require(path.join(dir, "calendar.js"));
const S = require(path.join(dir, "schedule.js"));
const M = require(path.join(dir, "cpm.js"));
const X = require(path.join(dir, "mspdi.js"));
const rows = JSON.parse(process.argv[1]);
const readExt = (t) => {
  const o = {};
  for (const k of Object.keys(t.ext || {})) if (k.indexOf("timeline.") === 0) o[k.slice(9)] = t.ext[k];
  return o;
};
const tasks = rows.map((r, i) => ({
  id: i + 1, title: r.title, created_at: "2026-10-01T00:00:" + String(i + 1).padStart(5, "0"), list_id: 7,
  project: r.project, gtd_status: r.pct === 100 ? "done" : "next",
  completed_at: r.pct === 100 ? "2026-11-06T09:00:00Z" : null, progress: r.pct, pomodoros_done: 0, parent_id: null,
  assigned_to: r.to ? 3 : null, estimated_pomodoros: r.to ? 4 : 1,
  ext: { "timeline.start": r.pct === 100 ? "2026-11-03" : "2026-11-09", "timeline.duration": 4 },
}));
const units = new Map([[S.unitOf({ list_id: 7, project: "Uji progres" }).recId, { auto: true }]]);
const cal = C.compile({ v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [], work: [] });
const result = M.run({ tasks, cal, units, readExt });
const D = C.dn("2026-11-11");
const title = "Uji progres";
const input = { tasks, cal, readExt, result, units, pageKind: "workspace", title, fileName: X.fileNameOf(title, D),
  people: new Map([[3, "Sari"]]), baseline: null, D };
process.stdout.write(JSON.stringify({ xml: X.build(input).xml }));
"""


def g(e, t):
    x = e.find(NS + t)
    return None if x is None else x.text


def setv(e, t, v):
    e.find(NS + t).text = v


def drop(e, *tags):
    for t in tags:
        x = e.find(NS + t)
        if x is not None:
            e.remove(x)


def add_after(e, after, tag, text):
    """Sisipkan <tag>text</tag> tepat setelah anak `after` (urutan XSD dijaga pemanggil)."""
    kids = list(e)
    i = next(k for k, c in enumerate(kids) if c.tag == NS + after)
    x = ET.Element(NS + tag)
    x.text = text
    x.tail = kids[i].tail
    e.insert(i + 1, x)
    return x


def dur_s(s):
    m = re.fullmatch(r"PT(\d+)H(\d+)M(\d+(?:\.\d+)?)S", s)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def fmt(sec):
    sec = int(round(sec))
    return "PT%dH%dM%dS" % (sec // 3600, sec % 3600 // 60, sec % 60)


def d(s):
    return dt.datetime.strptime(s, "%Y-%m-%dT%H:%M:%S")


def iso(x):
    return x.strftime("%Y-%m-%dT%H:%M:%S")


def stop_resume(t, a, pct):
    """Stop = akhir bagian aktual; Resume = saat kerja berikutnya (hanya bila belum selesai)."""
    s, f = d(g(t, "Start")), d(g(t, "Finish"))
    if pct == 100:
        stop, resume = f, None
    else:
        # 50 % dari 4 hari kerja Sen–Kam: aktual = 2 hari → berhenti Sel 17:00, lanjut Rab 08:00
        stop = dt.datetime.combine((s + dt.timedelta(days=1)).date(), dt.time(17, 0))
        resume = dt.datetime.combine((s + dt.timedelta(days=2)).date(), dt.time(8, 0))
    x = add_after(t, "Work", "Stop", iso(stop))
    if resume is not None:
        add_after(t, "Stop", "Resume", iso(resume))
        add_after(t, "Resume", "ResumeValid", "0")
    else:
        add_after(t, "Stop", "ResumeValid", "0")
    if a is not None:
        add_after(a, "Start", "Stop", iso(stop))
        if resume is not None:
            add_after(a, "Stop", "Resume", iso(resume))
    return x


def timephased(a):
    """TimephasedData per hari kerja (Sen–Jum; rentang uji tanpa libur): bentuk item MPXJ — 08:00–17:00, Unit 1 (jam)."""
    uid = g(a, "UID")
    s, f = d(g(a, "Start")), d(g(a, "Finish"))
    days, day = [], s.date()
    while day <= f.date():
        if day.weekday() < 5:
            days.append(day)
        day += dt.timedelta(days=1)
    work, act = dur_s(g(a, "Work")), dur_s(g(a, "ActualWork"))
    per, left = work / len(days), act
    for day in days:
        a0 = min(per, left)
        left -= a0
        typ = "2" if a0 >= per - 1e-9 else "1"  # uji ini hanya 100 % dan 50 % dari 4 hari → tak ada hari terbelah
        tp = ET.SubElement(a, NS + "TimephasedData")
        for k, v in (("Type", typ), ("UID", uid), ("Start", iso(dt.datetime.combine(day, dt.time(8, 0)))),
                     ("Finish", iso(dt.datetime.combine(day, dt.time(17, 0)))), ("Unit", "1"), ("Value", fmt(per))):
            ET.SubElement(tp, NS + k).text = v


def terapkan(kode, t, a, asg_parent, pct):
    if kode in ("T", "TP", "XT"):
        stop_resume(t, a, pct)
    if kode in ("P", "TP"):
        timephased(a)
    if kode == "M":
        drop(t, "Work", "PercentWorkComplete", "ActualDuration", "ActualWork", "RemainingWork")
        drop(a, "PercentWorkComplete", "Finish")
    if kode == "U":
        dur = dur_s(g(t, "Duration"))
        act = round(dur * pct / 100)
        for e in (t, a):
            setv(e, "Work", fmt(dur))
            setv(e, "ActualWork", fmt(act))
            setv(e, "RemainingWork", fmt(dur - act))
        setv(a, "Units", "1")
    if kode == "K":
        setv(t, "ConstraintType", "0")
        drop(t, "ConstraintDate")
    if kode == "N":
        asg_parent.remove(a)
        for tag in ("Work", "ActualWork", "RemainingWork"):
            setv(t, tag, "PT0H0M0S")
        setv(t, "PercentWorkComplete", "0")


def main():
    rows = []
    for pct in (100, 50):
        for k in VARIAN:
            rows.append({"kode": k, "pct": pct, "title": "%d %s %s" % (pct, k, KET[k]), "project": "Uji progres",
                         "to": k not in ("N", "D")})
    for k in ("XS", "XT"):
        rows.append({"kode": k, "pct": 50, "title": "50 %s %s" % (k, KET[k]), "project": "Manual", "to": True})
    r = subprocess.run(["node", "-e", NODE_JS, json.dumps(rows)], cwd=ROOT, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        sys.exit("node gagal:\n" + r.stderr)
    xml = json.loads(r.stdout)["xml"]

    root = ET.fromstring(xml)
    tasks = {g(t, "Name"): t for t in root.find(NS + "Tasks")}
    asg_parent = root.find(NS + "Assignments")
    asg = {g(a, "TaskUID"): a for a in asg_parent}
    ringkas = []
    for row in rows:
        t = tasks[row["title"]]
        a = asg.get(g(t, "UID"))
        # dasar harus bentuk produk yang diharapkan sebelum varian diterapkan
        assert g(t, "PercentComplete") == str(row["pct"]), (row, g(t, "PercentComplete"))
        assert (g(t, "Manual") == "1") == (row["project"] == "Manual"), row
        assert a is not None and (g(a, "ResourceUID") == "-65535") == (not row["to"]), row
        terapkan(row["kode"], t, a, asg_parent, row["pct"])
        ringkas.append((g(t, "ID"), row["title"], g(t, "Start")[:10], g(t, "Finish")[:10], g(t, "Manual"), g(t, "Type")))

    os.makedirs(OUT_DIR, exist_ok=True)
    p2 = os.path.join(OUT_DIR, "uji-progres-P2.xml")
    ET.ElementTree(root).write(p2, encoding="UTF-8", xml_declaration=True)
    assert all(root.find(NS + h) is not None for h in HEAD_F8), "kepala F8 tidak lengkap di keluaran kode"
    for h in HEAD_F8:
        drop(root, h)
    p3 = os.path.join(OUT_DIR, "uji-progres-P3-kepala-lama.xml")
    ET.ElementTree(root).write(p3, encoding="UTF-8", xml_declaration=True)
    for x in ringkas:
        print(*x)
    print("ditulis:", p2, p3)


if __name__ == "__main__":
    main()
