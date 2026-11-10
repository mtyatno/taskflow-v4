#!/usr/bin/env python3
"""Verifikasi ekspor MSPDI Timeline (rencana 1d-2 Task 3 / T7) dengan MPXJ — BUKAN bagian CI.

1. Membangun XML contoh lewat Node (`node -e`: modul Timeline + fixture kecil yang mewakili workspace 2 kelompok,
   ringkasan, milestone, SNET, MFO, Manual, selesai/berjalan (aktual), tanpa jadwal, 4 tipe tautan + lag, libur + hari
   kerja pengganti, baseline, 2 resource) → temporary_files/mspdi_sample.xml, plus es/ef mesin (TLCpm.run).
2. Memeriksa urutan anak SETIAP elemen terhadap skema MSPDI MPXJ (propOrder JAXB org.mpxj.mspdi.schema.*, dibangkitkan
   dari XSD MSPDI Microsoft) — elemen tak dikenal / urutan terbalik / elemen tunggal ganda = gagal.
3. Membaca berkas dengan MPXJ (UniversalProjectReader + MSPDIReader) lalu mengasersi: jumlah task, nama, outline,
   start/finish (= es/ef mesin), durasi (juga dihitung ulang dari kalender MPXJ), milestone, % selesai, aktual, kendala
   (ASAP/SNET/MSO/MFO, HonorConstraints), mode Manual, perkiraan, tautan (tipe + lag), kalender (pola mingguan +
   pengecualian gaya 2007 tanpa ganda, nama libur SKB), baseline, resource, assignment (work, units).

Pasang (sekali, lokal): pip install --break-system-packages mpxj JPype1 ; Java sistem (/usr/bin/java).
Tanpa MPXJ → hanya pemeriksaan struktur xml.etree (dilaporkan sebagai FALLBACK, keluar kode 2).
Jalankan: python3 temporary_files/mspdi_check.py

Mode "periksa berkas X" (1d-2 Task 7, dipakai e2e_plugin_fase1_1d2.py atas berkas UNDUHAN nyata):
    python3 temporary_files/mspdi_check.py --file X.xml [--json hasil.json]
Tanpa membangun contoh: struktur generik (xml.etree), urutan elemen vs skema MSPDI MPXJ, lalu MPXJ membaca berkas dan
setiap field task/kalender/assignment yang dibaca MPXJ dibandingkan dengan XML (durasi juga dihitung ulang dari kalender
MPXJ). Apa yang dibaca MPXJ (properti project, kalender + pengecualian, task, tautan, baseline, resource, assignment)
ditulis ke --json agar pemanggil mengasersi isinya terhadap harapannya sendiri. Keluar 0 = semua cek generik lulus.
"""
import json
import os
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "temporary_files", "mspdi_sample.xml")
NS = "{http://schemas.microsoft.com/project}"

NODE_JS = r"""
const path = require("path");
const dir = path.join(process.cwd(), "static/plugins/timeline");
const C = require(path.join(dir, "calendar.js"));
const S = require(path.join(dir, "schedule.js"));
const M = require(path.join(dir, "cpm.js"));
const X = require(path.join(dir, "mspdi.js"));
const readExt = (t) => {
  const o = {};
  for (const k of Object.keys(t.ext || {})) if (k.indexOf("timeline.") === 0) o[k.slice(9)] = t.ext[k];
  return o;
};
function mk(o) {
  const ext = {};
  if (o.start !== undefined) ext["timeline.start"] = o.start;
  if (o.d !== undefined) ext["timeline.duration"] = o.d;
  if (o.deps) ext["timeline.deps"] = o.deps.map(([id, type, lag]) => ({ t: { $task: id }, type, lag }));
  if (o.constraint) ext["timeline.constraint"] = o.constraint;
  const t = {
    id: o.id, title: o.title, created_at: "2026-10-01T00:00:" + String(o.id).padStart(5, "0"), list_id: 7,
    project: o.project, gtd_status: o.done ? "done" : "next", completed_at: o.done ? "2026-11-04T10:00:00Z" : null,
    progress: o.progress || 0, pomodoros_done: 0, parent_id: o.parent === undefined ? null : o.parent,
    assigned_to: o.to === undefined ? null : o.to, ext,
  };
  if (o.est !== undefined) t.estimated_pomodoros = o.est;
  return t;
}
const tasks = [
  // Alpha = unit Otomatis
  mk({ id: 1, title: "Desain", project: "Alpha", start: "2026-11-02", d: 5, est: 4, to: 3, progress: 40 }),
  mk({ id: 2, title: "Bangun", project: "Alpha", start: "2026-11-09", d: 3, deps: [[1, "FS", 1]], est: 6, to: 5 }),
  mk({ id: 3, title: "Uji", project: "Alpha", start: "2026-11-12", d: 4, deps: [[2, "SS", 2]], est: 3, to: 3 }),
  mk({ id: 4, title: "Rilis", project: "Alpha", start: "2026-11-19", d: 0, deps: [[3, "FF", 0]], to: 3 }),
  mk({ id: 5, title: "Dokumentasi", project: "Alpha", start: "2026-11-16", d: 3, deps: [[2, "SF", -1]], constraint: { type: "SNET", date: "2026-11-16" }, est: 2, to: 5 }),
  mk({ id: 6, title: "Audit", project: "Alpha", start: "2026-11-23", d: 2, constraint: { type: "MFO", date: "2026-11-24" }, to: 3 }),
  mk({ id: 7, title: "Lembur Sabtu", project: "Alpha", start: "2026-11-20", d: 2, est: 2, to: 5 }),
  mk({ id: 8, title: "Survei", project: "Alpha", start: "2026-11-02", d: 2, est: 1, to: 5, done: true }),
  // review F5: task panjang — 70 🍅 = 1.750 menit dalam 260 hari kerja (Units 0,0140224… → 6 desimal ke atas 0.014023;
  // 4 desimal lama 0.014 × 124.800 = 1.747,2 menit ≠ Work → asersi kalender resource menolaknya).
  mk({ id: 9, title: "Arsip panjang", project: "Alpha", start: "2026-11-02", d: 260, est: 70, to: 3 }),
  // Beta = unit Manual (bawaan, tanpa record project)
  mk({ id: 10, title: "Fase Beta", project: "Beta" }),
  mk({ id: 11, title: "Riset", project: "Beta", parent: 10, start: "2026-11-03", d: 2, est: 2, to: 5, done: true }),
  mk({ id: 12, title: "Wawancara", project: "Beta", parent: 10, start: "2026-11-05", d: 1, to: 3, progress: 50 }),
  mk({ id: 13, title: "Belum dijadwalkan", project: "Beta", parent: 10, to: 3 }),
  mk({ id: 14, title: "Natal", project: "Beta", start: "2026-12-23", d: 3 }),
];
const units = new Map([[S.unitOf({ list_id: 7, project: "Alpha" }).recId, { auto: true }]]);
const cal = C.compile({ v: 1, weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true,
  off: [{ d: "2026-11-18", n: "Rapat kantor" }], work: [{ d: "2026-11-21", n: "Hari kerja pengganti" }] });
const result = M.run({ tasks, cal, units, readExt });
const D = C.dn("2026-11-10");
const row = (s, f, d, w) => ({ s: C.dn(s), f: C.dn(f), d, w });
const baseline = { n: 1, name: "Rencana awal", rows: new Map([
  ["1", row("2026-11-02", "2026-11-06", 5, 4)], ["2", row("2026-11-09", "2026-11-11", 3, 6)], ["4", row("2026-11-18", "2026-11-18", 0, 0)],
]) };
const people = new Map([[3, "Sari"], [5, "Budi"]]);
const title = "Tim Produk & Riset";
const fileName = X.fileNameOf(title, D);
const input = { tasks, cal, readExt, result, units, pageKind: "workspace", title, fileName, people, baseline, D };
const out = X.build(input);
const again = X.build(input);
const engine = {};
for (const t of tasks) {
  const n = result.nodes.get(String(t.id));
  if (n && Number.isInteger(n.es)) engine[t.title] = [C.iso(n.es), C.iso(n.ef), n.fixed || n.driver.kind];
}
process.stdout.write(JSON.stringify({ xml: out.xml, stats: out.stats, fileName, same: again.xml === out.xml, engine }));
"""

FAIL = []


def check(cond, msg):
    print(("  ok   " if cond else "  GAGAL ") + msg)
    if not cond:
        FAIL.append(msg)


def local(tag):
    return tag[len(NS):] if tag.startswith(NS) else tag


def build_sample():
    r = subprocess.run(["node", "-e", NODE_JS], cwd=ROOT, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        sys.exit("node gagal:\n" + r.stderr)
    data = json.loads(r.stdout)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(data["xml"])
    return data


def xml_tasks(root):
    return [t for t in root.find(NS + "Tasks") if local(t.tag) == "Task"]


def tv(el, name):
    x = el.find(NS + name)
    return None if x is None else x.text


def hours(iso_dur):  # "PT40H0M0S" → jam
    h, rest = iso_dur[2:].split("H")
    m = rest.split("M")[0]
    return int(h) + int(m) / 60


def structure_checks(root, data):
    print("\n[1] Struktur (xml.etree)")
    check(root.tag == NS + "Project", "akar <Project> dengan namespace http://schemas.microsoft.com/project")
    blocks = [local(c.tag) for c in root]
    check(blocks[-4:] == ["Calendars", "Tasks", "Resources", "Assignments"], "blok terakhir Calendars → Tasks → Resources → Assignments")
    check(data["same"], "dua build identik (determinis)")
    check(tv(root, "Name") == data["fileName"] and tv(root, "Title") == "Tim Produk & Riset", "Name = nama berkas, Title = judul (escape &)")
    tasks = xml_tasks(root)
    check(len(tasks) == data["stats"]["tasks"] + 1, f"jumlah <Task> = stats.tasks + UID 0 ({len(tasks)})")


def xsd_order_checks(root):
    """Urutan anak setiap elemen vs propOrder JAXB skema MSPDI MPXJ (turunan XSD Microsoft)."""
    from java.lang import Class

    XE = Class.forName("jakarta.xml.bind.annotation.XmlElement")
    XT = Class.forName("jakarta.xml.bind.annotation.XmlType")
    cache = {}

    def schema(cls):
        key = str(cls.getName())
        if key not in cache:
            order = [str(x) for x in cls.getAnnotation(XT).propOrder()]
            fields = {}
            for f in cls.getDeclaredFields():
                ann = f.getAnnotation(XE)
                name = str(ann.name()) if ann is not None and str(ann.name()) != "##default" else str(f.getName())
                t = f.getType()
                is_list = str(t.getName()) == "java.util.List"
                if is_list:
                    t = f.getGenericType().getActualTypeArguments()[0]
                fields[name] = (str(f.getName()), t, is_list)
            cache[key] = (order, fields)
        return cache[key]

    errors = []
    counted = [0]

    def walk(el, cls, path):
        order, fields = schema(cls)
        last, last_name = -1, None
        for ch in el:
            n = local(ch.tag)
            counted[0] += 1
            if n not in fields:
                errors.append(f"{path}/{n}: elemen tidak dikenal skema")
                continue
            fname, ctype, is_list = fields[n]
            i = order.index(fname)
            if i < last:
                errors.append(f"{path}/{n}: urutan XSD dilanggar (setelah {last_name})")
            if i == last and not is_list:
                errors.append(f"{path}/{n}: elemen tunggal muncul dua kali")
            last, last_name = i, n
            cname = str(ctype.getName())
            if cname.startswith("org.mpxj.mspdi.schema."):
                walk(ch, ctype, path + "/" + n)

    print("\n[2] Urutan elemen vs skema MSPDI MPXJ (propOrder JAXB)")
    walk(root, Class.forName("org.mpxj.mspdi.schema.Project"), "Project")
    for e in errors[:20]:
        print("    " + e)
    check(not errors, f"{counted[0]} elemen diperiksa, {len(errors)} pelanggaran urutan/nama")


def resource_calendar_checks(project, root, label=""):
    """Uji pemilik F4 A: setiap resource memakai kalender resource (turunan kalender UID 1) dan, untuk setiap assignment,
    Units × waktu kerja kalender RESOURCE antara Start dan Finish ≈ Work (±1 menit). Resource tanpa kalender dinilai
    seperti MS Project: kalender turunan "Standard" bawaannya (Sen–Jum 08–12/13–17 tanpa libur berkas) — itu yang
    memicu dialog "resource is assigned outside the original dates" (Units diturunkan). Juga: 24/12 libur di kalender
    resource bila kalender UID 1 meliburkannya (dan setiap hari pengecualian UID 1 sama di kalender resource). Mengembalikan
    daftar pelanggaran."""
    from java.time import LocalDate
    from org.mpxj import ProjectFile, TimeUnit

    std = ProjectFile().addDefaultBaseCalendar()  # "Standard" MS Project: Sen–Jum, tanpa pengecualian
    props = project.getProjectProperties()
    base = project.getDefaultCalendar()
    bad, rows = [], []
    for r in project.getResources():
        if r.getUniqueID() is None or int(r.getUniqueID()) == 0:
            continue
        rc = r.getCalendar()
        if rc is None:
            bad.append((str(r.getName()), "tanpa kalender resource"))
        elif rc.getParent() is None or int(rc.getParent().getUniqueID()) != int(base.getUniqueID()):
            bad.append((str(r.getName()), "kalender resource bukan turunan kalender UID 1"))
        else:
            # Setiap hari pengecualian kalender UID 1 (libur SKB, libur tambahan, hari kerja pengganti) berlaku sama di kalender
            # resource (turunan) — termasuk 24/12 bila ada di rentang berkas.
            for ex in base.getCalendarExceptions():
                d = ex.getFromDate()
                while not d.isAfter(ex.getToDate()):
                    if bool(rc.isWorkingDate(d)) != bool(base.isWorkingDate(d)):
                        bad.append((str(r.getName()), f"kalender resource ≠ kalender UID 1 pada {d}"))
                    d = d.plusDays(1)
            if not bool(base.isWorkingDate(LocalDate.of(2026, 12, 24))) and bool(rc.isWorkingDate(LocalDate.of(2026, 12, 24))):
                bad.append((str(r.getName()), "kalender resource: 24/12 hari kerja"))
    for a in project.getResourceAssignments():
        res = a.getResource()
        rc = res.getCalendar() if res is not None and res.getCalendar() is not None else std
        mins = float(rc.getWork(a.getStart(), a.getFinish(), TimeUnit.MINUTES).getDuration())
        work = float(a.getWork().convertUnits(TimeUnit.MINUTES, props).getDuration())
        units = float(a.getUnits()) / 100.0
        rows.append((str(a.getTask().getName()), str(res.getName()), round(units, 4), mins, work))
        if abs(units * mins - work) > 1:
            bad.append((str(a.getTask().getName()), str(res.getName()), f"Units {units:.4f} × {mins:.0f} menit = {units * mins:.1f} ≠ Work {work:.0f}"))
    for row in rows:
        print(f"    {label}{row[0]:<22} {row[1]:<8} units {row[2]:<7} × kerja kalender resource {row[3]:>6.0f} menit ≈ Work {row[4]:>5.0f}")
    check(not bad, f"F4 A: {len(rows)} assignment — Units × waktu kerja kalender resource (Start..Finish) ≈ Work ±1 menit; kalender resource turunan UID 1 dengan pengecualian sama (24/12 libur) {bad[:4]}")
    return bad


def mpxj_checks(root, data):
    import jpype

    from java.time import DayOfWeek, LocalDate
    from org.mpxj import TimeUnit
    from org.mpxj.mspdi import MSPDIReader
    from org.mpxj.reader import UniversalProjectReader

    uni = UniversalProjectReader().read(OUT)
    project = MSPDIReader().read(OUT)
    props = project.getProjectProperties()
    print("\n[3] MPXJ membaca berkas")
    check(uni is not None and int(uni.getTasks().size()) == int(project.getTasks().size()), "UniversalProjectReader mengenali dan membaca berkas (task sama dengan MSPDIReader)")
    print(f"    tipe berkas MPXJ: {props.getFileType()}, judul: {props.getProjectTitle()}, nama: {props.getName()}")
    check(str(props.getProjectTitle()) == "Tim Produk & Riset", "ProjectTitle")
    last = max(ef for _es, ef, _k in data["engine"].values())
    check(str(props.getStartDate())[:16] == "2026-11-02T08:00" and str(props.getFinishDate())[:16] == last + "T17:00", f"StartDate/FinishDate project ({props.getStartDate()} … {props.getFinishDate()}; ef mesin terakhir {last})")
    check(int(props.getMinutesPerDay()) == 480 and int(props.getMinutesPerWeek()) == 2400, "MinutesPerDay 480 / MinutesPerWeek 2400")
    check(bool(props.getHonorConstraints()), "HonorConstraints = true (MSO/MFO menang atas tautan)")

    def days(dur):
        return None if dur is None else round(float(dur.convertUnits(TimeUnit.DAYS, props).getDuration()), 4)

    def minutes(dur):
        return None if dur is None else round(float(dur.convertUnits(TimeUnit.MINUTES, props).getDuration()), 2)

    def dt(v):
        return None if v is None else str(v)[:16]

    # ---- kalender
    cal = project.getDefaultCalendar()
    print("\n[4] Kalender")
    check(cal is not None and int(cal.getUniqueID()) == 1, f"kalender default UID 1 ({cal.getName() if cal else None})")
    week = [bool(cal.isWorkingDay(d)) for d in (DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY)]
    check(week == [True] * 5 + [False] * 2, f"pola mingguan Sen–Jum kerja, Sab–Min libur ({week})")
    exc = [(str(e.getFromDate()), str(e.getToDate()), bool(e.getWorking())) for e in cal.getCalendarExceptions()]
    for e in exc:
        print("    pengecualian", e)
    xml_exc = []
    for w in root.find(NS + "Calendars").find(NS + "Calendar").find(NS + "WeekDays"):
        if tv(w, "DayType") == "0":
            tp = w.find(NS + "TimePeriod")
            xml_exc.append((tv(tp, "FromDate")[:10], tv(tp, "ToDate")[:10], tv(w, "DayWorking") == "1"))
    check(sorted(exc) == sorted(xml_exc), f"{len(exc)} pengecualian MPXJ = WeekDay DayType 0 XML")
    xml_ex2 = root.find(NS + "Calendars").find(NS + "Calendar").find(NS + "Exceptions")
    ex2 = [(tv(x.find(NS + "TimePeriod"), "FromDate")[:10], tv(x.find(NS + "TimePeriod"), "ToDate")[:10], tv(x, "DayWorking") == "1") for x in xml_ex2]
    check(len(exc) == len(ex2) == len(xml_exc) and sorted(ex2) == sorted(exc), f"blok <Exceptions> 2007 ({len(ex2)}) dibaca tanpa ganda (MPXJ {len(exc)})")
    names = {(str(e.getFromDate()), str(e.getToDate())): (None if e.getName() is None else str(e.getName())) for e in cal.getCalendarExceptions()}
    check(names.get(("2026-12-24", "2026-12-25")) == "Kelahiran Yesus Kristus" and not names.get(("2026-11-18", "2026-11-18")), f"nama pengecualian SKB terbaca ({names.get(('2026-12-24', '2026-12-25'))})")
    check(("2026-11-18", "2026-11-18", False) in exc, "libur tambahan 18 Nov (Rabu) = pengecualian libur")
    check(("2026-11-21", "2026-11-21", True) in exc, "hari kerja pengganti 21 Nov (Sabtu) = pengecualian kerja")
    check(("2026-12-24", "2026-12-25", False) in exc, "SKB 24–25 Des digabung jadi satu pengecualian")
    for d, want in (("2026-11-17", True), ("2026-11-18", False), ("2026-11-21", True), ("2026-11-22", False), ("2026-12-24", False), ("2026-12-25", False), ("2026-12-28", True)):
        y, m, dd = map(int, d.split("-"))
        check(bool(cal.isWorkingDate(LocalDate.of(y, m, dd))) == want, f"isWorkingDate {d} = {want}")
    sat = minutes(cal.getWork(LocalDate.of(2026, 11, 21), TimeUnit.MINUTES))
    check(sat == 480.0, f"jam kerja hari pengganti 21 Nov = 480 menit ({sat})")

    # ---- task
    print("\n[5] Task")
    xt = {tv(t, "UID"): t for t in xml_tasks(root)}
    mt = {str(t.getUniqueID()): t for t in project.getTasks()}
    check(sorted(xt, key=int) == sorted(mt, key=int), f"UID task MPXJ = XML ({len(mt)} task termasuk UID 0)")
    ct_map = {"0": "AS_SOON_AS_POSSIBLE", "2": "MUST_START_ON", "3": "MUST_FINISH_ON", "4": "START_NO_EARLIER_THAN"}
    link_map = {"0": "FINISH_FINISH", "1": "FINISH_START", "2": "START_FINISH", "3": "START_START"}
    print("    UID lvl outline  nama                     start            finish           dur  ms  %   kendala                    mode   est  pendahulu")
    bad = []
    for uid in sorted(xt, key=int):
        x, t = xt[uid], mt[uid]
        mode = str(t.getTaskMode().name()) if t.getTaskMode() is not None else None
        ctype = str(t.getConstraintType().name()) if t.getConstraintType() is not None else None
        preds = sorted((str(r.getPredecessorTask().getUniqueID()), str(r.getType().name()), days(r.getLag())) for r in t.getPredecessors())
        xpreds = sorted((tv(l, "PredecessorUID"), link_map[tv(l, "Type")], int(tv(l, "LinkLag")) / 4800) for l in x.findall(NS + "PredecessorLink"))
        got = {
            "name": str(t.getName()), "level": int(t.getOutlineLevel()), "outline": str(t.getOutlineNumber()), "wbs": str(t.getWBS()),
            "start": dt(t.getStart()), "finish": dt(t.getFinish()), "dur": days(t.getDuration()), "milestone": bool(t.getMilestone()),
            "summary": bool(t.getSummary()), "pct": float(t.getPercentageComplete()), "ctype": ctype, "cdate": dt(t.getConstraintDate()),
            "manual": mode == "MANUALLY_SCHEDULED", "est": bool(t.getEstimated()), "preds": preds,
            "astart": dt(t.getActualStart()), "afinish": dt(t.getActualFinish()),
        }
        want = {
            "name": tv(x, "Name"), "level": int(tv(x, "OutlineLevel")), "outline": tv(x, "OutlineNumber"), "wbs": tv(x, "WBS"),
            "start": tv(x, "Start")[:16], "finish": tv(x, "Finish")[:16], "dur": round(hours(tv(x, "Duration")) / 8, 4),
            "milestone": tv(x, "Milestone") == "1", "summary": tv(x, "Summary") == "1", "pct": float(tv(x, "PercentComplete")),
            "ctype": ct_map[tv(x, "ConstraintType")], "cdate": tv(x, "ConstraintDate")[:16] if tv(x, "ConstraintDate") else None,
            "manual": tv(x, "Manual") == "1", "est": tv(x, "Estimated") == "1", "preds": xpreds,
            "astart": tv(x, "ActualStart")[:16] if tv(x, "ActualStart") else None, "afinish": tv(x, "ActualFinish")[:16] if tv(x, "ActualFinish") else None,
        }
        diff = {k: (got[k], want[k]) for k in want if got[k] != want[k]}
        if diff:
            bad.append((uid, diff))
        # durasi = waktu kerja kalender MPXJ antara start dan finish (konsistensi tanggal ↔ durasi ↔ kalender)
        if t.getStart() is not None and t.getFinish() is not None and not got["est"]:
            w = days(cal.getWork(t.getStart(), t.getFinish(), TimeUnit.DAYS))
            if w != got["dur"]:
                bad.append((uid, {"kalender(start..finish)": (w, got["dur"])}))
        print(f"    {uid:>3} {got['level']:>3} {got['outline']:<8} {got['name'][:24]:<24} {got['start']} {got['finish']} {got['dur']:>4} {int(got['milestone'])}  {got['pct']:>5.0f} {str(got['ctype'])[:13]:<13} {str(got['cdate']):<16} {'man' if got['manual'] else 'oto'}    {int(got['est'])}   {preds}")
    for b in bad:
        print("    BEDA", b)
    check(not bad, "semua field task MPXJ = XML; durasi = waktu kerja kalender MPXJ antara start dan finish")
    by = {str(t.getName()): t for t in project.getTasks()}
    check([str(by[n].getOutlineNumber()) for n in ("Alpha", "Desain", "Beta", "Fase Beta", "Riset", "Natal")] == ["1", "1.1", "2", "2.1", "2.1.1", "2.2"], "kelompok = ringkasan tingkat 1, WBS berprefiks")
    check(int(by["Alpha"].getOutlineLevel()) == 1 and bool(by["Alpha"].getSummary()) and int(by["Riset"].getOutlineLevel()) == 3, "OutlineLevel kelompok 1, cucu 3")
    check(dt(by["Dokumentasi"].getStart()) == "2026-11-16T08:00" and dt(by["Dokumentasi"].getFinish()) == "2026-11-19T17:00" and days(by["Dokumentasi"].getDuration()) == 3, "Dokumentasi 16–19 Nov melompati libur 18 Nov, 3 hari")
    check(dt(by["Lembur Sabtu"].getFinish()) == "2026-11-21T17:00", "Lembur Sabtu selesai di hari pengganti 21 Nov")
    check(dt(by["Natal"].getFinish()) == "2026-12-29T17:00" and days(by["Natal"].getDuration()) == 3, "Natal 23–29 Des melompati SKB + akhir pekan")
    eng_bad = []
    for name, (es, ef, kind) in sorted(data["engine"].items()):
        t = by[name]
        got = (dt(t.getStart())[:10], (dt(t.getStart()) if bool(t.getMilestone()) else dt(t.getFinish()))[:10])
        if got != (es, ef):
            eng_bad.append((name, kind, got, (es, ef)))
    check(not eng_bad, f"start/finish MPXJ = es/ef mesin untuk {len(data['engine'])} simpul {eng_bad}")
    rk = data["engine"]["Rilis"]
    check(bool(by["Rilis"].getMilestone()) and dt(by["Rilis"].getStart()) == dt(by["Rilis"].getFinish()) == rk[0] + "T17:00" and str(by["Rilis"].getConstraintType().name()) == "AS_SOON_AS_POSSIBLE", f"milestone Rilis (FF 0) di es mesin {rk[0]} jam 17:00 (hitungan MS Project), tanpa kendala (F4 B)")
    check(not [t for t in project.getTasks() if t.getConstraintType() is not None and str(t.getConstraintType().name()) == "MUST_START_ON"], "tanpa MSO (F4 B: tanpa konflik kendala)")
    check(dt(by["Desain"].getActualStart()) == "2026-11-02T08:00" and by["Desain"].getActualFinish() is None and str(by["Desain"].getConstraintType().name()) == "START_NO_EARLIER_THAN", "berjalan (progress 40): ActualStart, tanpa ActualFinish")
    check(dt(by["Survei"].getActualStart()) == "2026-11-02T08:00" and dt(by["Survei"].getActualFinish()) == "2026-11-04T17:00" and days(by["Survei"].getDuration()) == 3, "selesai: ActualStart/ActualFinish = es/ef mesin (completed_at 4 Nov 10:00Z = 4 Nov WIB), durasi 3 hari")
    check(str(by["Lembur Sabtu"].getConstraintType().name()) == "START_NO_EARLIER_THAN" and dt(by["Lembur Sabtu"].getConstraintDate()) == "2026-11-20T08:00", "akar Otomatis: SNET di es mesin")
    check(float(by["Riset"].getPercentageComplete()) == 100 and float(by["Desain"].getPercentageComplete()) == 40 and float(by["Wawancara"].getPercentageComplete()) == 50, "% selesai: selesai 100, progress 40/50")
    check(str(by["Dokumentasi"].getConstraintType().name()) == "START_NO_EARLIER_THAN" and dt(by["Dokumentasi"].getConstraintDate()) == "2026-11-16T08:00", "SNET eksplisit")
    check(str(by["Audit"].getConstraintType().name()) == "MUST_FINISH_ON" and dt(by["Audit"].getConstraintDate()) == "2026-11-24T17:00", "MFO")
    check(str(by["Bangun"].getConstraintType().name()) == "AS_SOON_AS_POSSIBLE", "ASAP (Otomatis berpendahulu)")
    check(str(by["Riset"].getTaskMode().name()) == "MANUALLY_SCHEDULED" and str(by["Riset"].getConstraintType().name()) == "START_NO_EARLIER_THAN" and dt(by["Riset"].getConstraintDate()) == "2026-11-03T08:00", "R8: Manual + SNET di mulai tersimpan")
    check(str(by["Bangun"].getTaskMode().name()) == "AUTO_SCHEDULED", "task Otomatis = AUTO_SCHEDULED")
    u = by["Belum dijadwalkan"]
    xu = next(t for t in xml_tasks(root) if tv(t, "Name") == "Belum dijadwalkan")
    check(bool(u.getEstimated()) and str(u.getTaskMode().name()) == "AUTO_SCHEDULED" and dt(u.getStart()) == "2026-11-10T08:00" and days(u.getDuration()) == 1
          and tv(xu, "DurationFormat") == "39" and str(u.getConstraintType().name()) == "START_NO_EARLIER_THAN", "tanpa jadwal: Otomatis + perkiraan (DurationFormat 39 \"1 hari?\"), mulai D, 1 hari, SNET (F4 C)")
    rel = {str(t.getName()): [(str(r.getPredecessorTask().getName()), str(r.getType().name()), days(r.getLag())) for r in t.getPredecessors()] for t in project.getTasks()}
    check(rel["Bangun"] == [("Desain", "FINISH_START", 1.0)], f"FS lag 1 hari ({rel['Bangun']})")
    check(rel["Uji"] == [("Bangun", "START_START", 2.0)], f"SS lag 2 hari ({rel['Uji']})")
    check(rel["Rilis"] == [("Uji", "FINISH_FINISH", 0.0)], f"FF lag 0 ({rel['Rilis']})")
    check(rel["Dokumentasi"] == [("Bangun", "START_FINISH", -1.0)], f"SF lag −1 hari ({rel['Dokumentasi']})")
    check(sum(len(v) for v in rel.values()) == data["stats"]["links"] == 4, "jumlah tautan = stats.links = 4")

    # ---- baseline
    print("\n[6] Baseline")
    for n, s, f, d, w in (("Desain", "2026-11-02T08:00", "2026-11-06T17:00", 5.0, 100.0), ("Bangun", "2026-11-09T08:00", "2026-11-11T17:00", 3.0, 150.0), ("Rilis", "2026-11-18T08:00", "2026-11-18T08:00", 0.0, 0.0)):
        t = by[n]
        got = (dt(t.getBaselineStart()), dt(t.getBaselineFinish()), days(t.getBaselineDuration()), minutes(t.getBaselineWork()))
        check(got == (s, f, d, w), f"baseline {n} = {got}")
    check(by["Uji"].getBaselineStart() is None and by["Natal"].getBaselineStart() is None, "task tanpa baris baseline → tanpa baseline")

    # ---- resource + assignment
    print("\n[7] Resource dan assignment")
    res = [(int(r.getUniqueID()), str(r.getName()), str(r.getType().name())) for r in project.getResources() if r.getUniqueID() is not None and int(r.getUniqueID()) > 0]
    print("    resource", res)
    check(res == [(1, "Budi", "WORK"), (2, "Sari", "WORK")], "2 resource kerja, urut nama")
    xa = {tv(a, "UID"): a for a in root.find(NS + "Assignments")}
    asg = list(project.getResourceAssignments())
    check(len(asg) == len(xa) == data["stats"]["assignments"] == 10, f"jumlah assignment MPXJ = XML = stats ({len(asg)})")
    abad = []
    for a in asg:
        tuid, ruid = str(a.getTask().getUniqueID()), str(a.getResource().getUniqueID())
        x = next(v for v in xa.values() if tv(v, "TaskUID") == tuid and tv(v, "ResourceUID") == ruid)
        got = (minutes(a.getWork()), round(float(a.getUnits()), 2))
        want = (round(hours(tv(x, "Work")) * 60, 2), round(float(tv(x, "Units")) * 100, 2))
        print(f"    {str(a.getTask().getName()):<14} {str(a.getResource().getName()):<5} work {got[0]:>6} menit units {got[1]:>5} %  (XML {tv(x, 'Work')} / {tv(x, 'Units')})")
        if got != want:
            abad.append((tuid, got, want))
    check(not abad, f"work/units assignment MPXJ = XML {abad}")
    ad = {str(a.getTask().getName()): (str(a.getResource().getName()), minutes(a.getWork()), round(float(a.getUnits()), 2)) for a in asg}
    check(ad["Desain"] == ("Sari", 100.0, 4.17), f"Desain: Sari 4 🍅 = 100 menit, units 4,17 % ({ad['Desain']})")
    check(ad["Bangun"] == ("Budi", 150.0, 10.42), f"Bangun: Budi 6 🍅 = 150 menit / 3 hari ({ad['Bangun']})")
    check("Rilis" not in ad and "Belum dijadwalkan" not in ad and "Natal" not in ad, "milestone / tanpa jadwal / tanpa penanggung jawab → tanpa assignment")
    xp = next(v for v in xa.values() if tv(v, "TaskUID") == str(by["Arsip panjang"].getUniqueID()))
    check(days(by["Arsip panjang"].getDuration()) == 260 and ad["Arsip panjang"][:2] == ("Sari", 1750.0) and tv(xp, "Units") == "0.014023",
          f"Arsip panjang: 70 🍅 = 1.750 menit / 260 hari, Units 6 desimal dibulatkan ke atas ({tv(xp, 'Units')}, review F5)")
    xbad = []
    for v in xa.values():
        t = next(t for t in xml_tasks(root) if tv(t, "UID") == tv(v, "TaskUID"))
        over = float(tv(v, "Units")) * hours(tv(t, "Duration")) * 60 - hours(tv(v, "Work")) * 60
        if not (-1e-6 <= over < 1) or "e" in tv(v, "Units").lower() or len(tv(v, "Units").partition(".")[2]) > 6:
            xbad.append((tv(t, "Name"), tv(v, "Units"), round(over, 4)))
    check(not xbad, f"Units ≤ 6 desimal tanpa notasi ilmiah; Units × durasi (menit) − Work ∈ [0, 1) (review F5) {xbad}")
    resource_calendar_checks(project, root)
    jpype.shutdownJVM()


# ── mode "periksa berkas X" (1d-2 Task 7) ─────────────────────────────────────

def file_structure_checks(root):
    """Struktur generik berkas ekspor apa pun (tanpa data contoh)."""
    print("\n[1] Struktur (xml.etree)")
    check(root.tag == NS + "Project", "akar <Project> dengan namespace http://schemas.microsoft.com/project")
    blocks = [local(c.tag) for c in root]
    check(blocks[-4:] == ["Calendars", "Tasks", "Resources", "Assignments"], "blok terakhir Calendars → Tasks → Resources → Assignments")
    check(bool(tv(root, "Name")) and bool(tv(root, "Title")), f"Name ({tv(root, 'Name')}) dan Title ({tv(root, 'Title')}) terisi")
    tasks = xml_tasks(root)
    check(len(tasks) >= 1 and tv(tasks[0], "UID") == "0" and tv(tasks[0], "OutlineLevel") == "0", f"task UID 0 = ringkasan project tingkat 0 ({len(tasks)} <Task>)")


def file_mpxj_dump(path, root):
    """MPXJ membaca `path`: cek generik MPXJ = XML (pola mpxj_checks) dan kembalikan apa yang dibaca MPXJ (untuk --json)."""
    from org.mpxj import TimeUnit
    from org.mpxj.mspdi import MSPDIReader
    from org.mpxj.reader import UniversalProjectReader

    uni = UniversalProjectReader().read(path)
    project = MSPDIReader().read(path)
    props = project.getProjectProperties()
    print("\n[3] MPXJ membaca berkas")
    check(uni is not None and int(uni.getTasks().size()) == int(project.getTasks().size()), "UniversalProjectReader mengenali dan membaca berkas (task sama dengan MSPDIReader)")

    def days(dur):
        return None if dur is None else round(float(dur.convertUnits(TimeUnit.DAYS, props).getDuration()), 4)

    def minutes(dur):
        return None if dur is None else round(float(dur.convertUnits(TimeUnit.MINUTES, props).getDuration()), 2)

    def dt(v):
        return None if v is None else str(v)[:16]

    out = {"props": {"title": None if props.getProjectTitle() is None else str(props.getProjectTitle()),
                     "name": None if props.getName() is None else str(props.getName()),
                     "start": dt(props.getStartDate()), "finish": dt(props.getFinishDate()),
                     "minutesPerDay": int(props.getMinutesPerDay()), "minutesPerWeek": int(props.getMinutesPerWeek()),
                     "honorConstraints": bool(props.getHonorConstraints()), "fileType": str(props.getFileType())}}

    # ---- kalender: MPXJ = <WeekDays> DayType 0 = <Exceptions> 2007 (tanpa ganda)
    print("\n[4] Kalender")
    cal = project.getDefaultCalendar()
    check(cal is not None and int(cal.getUniqueID()) == 1, f"kalender default UID 1 ({cal.getName() if cal else None})")
    from java.time import DayOfWeek
    week = [bool(cal.isWorkingDay(d)) for d in (DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY, DayOfWeek.THURSDAY,
                                                DayOfWeek.FRIDAY, DayOfWeek.SATURDAY, DayOfWeek.SUNDAY)]
    exc = sorted((str(e.getFromDate()), str(e.getToDate()), bool(e.getWorking()), None if e.getName() is None else str(e.getName()))
                 for e in cal.getCalendarExceptions())
    xcal = root.find(NS + "Calendars").find(NS + "Calendar")
    xml_old = []
    for wd in xcal.find(NS + "WeekDays"):
        if tv(wd, "DayType") == "0":
            tp = wd.find(NS + "TimePeriod")
            xml_old.append((tv(tp, "FromDate")[:10], tv(tp, "ToDate")[:10], tv(wd, "DayWorking") == "1"))
    xe = xcal.find(NS + "Exceptions")
    xml_new = [] if xe is None else [(tv(x.find(NS + "TimePeriod"), "FromDate")[:10], tv(x.find(NS + "TimePeriod"), "ToDate")[:10],
                                      tv(x, "DayWorking") == "1") for x in xe]
    plain = sorted(e[:3] for e in exc)
    check(plain == sorted(xml_new), f"{len(exc)} pengecualian MPXJ = blok <Exceptions> 2007 ({len(xml_new)}), tanpa ganda")
    check(sorted(xml_old) == sorted(xml_new), f"WeekDay DayType 0 gaya 2003 ({len(xml_old)}) = <Exceptions> 2007 ({len(xml_new)})")
    out["calendar"] = {"week": week, "exceptions": [list(e) for e in exc]}

    # ---- task: setiap field MPXJ = XML; durasi = waktu kerja kalender MPXJ antara start dan finish
    print("\n[5] Task")
    xt = {tv(t, "UID"): t for t in xml_tasks(root)}
    mt = {str(t.getUniqueID()): t for t in project.getTasks()}
    check(sorted(xt, key=int) == sorted(mt, key=int), f"UID task MPXJ = XML ({len(mt)} task termasuk UID 0)")
    ct_map = {"0": "AS_SOON_AS_POSSIBLE", "2": "MUST_START_ON", "3": "MUST_FINISH_ON", "4": "START_NO_EARLIER_THAN"}
    link_map = {"0": "FINISH_FINISH", "1": "FINISH_START", "2": "START_FINISH", "3": "START_START"}
    bad, rows = [], []
    for uid in sorted(set(xt) & set(mt), key=int):
        x, t = xt[uid], mt[uid]
        mode = str(t.getTaskMode().name()) if t.getTaskMode() is not None else None
        ctype = str(t.getConstraintType().name()) if t.getConstraintType() is not None else None
        preds = sorted((str(r.getPredecessorTask().getUniqueID()), str(r.getType().name()), days(r.getLag())) for r in t.getPredecessors())
        xpreds = sorted((tv(lk, "PredecessorUID"), link_map.get(tv(lk, "Type")), int(tv(lk, "LinkLag")) / 4800) for lk in x.findall(NS + "PredecessorLink"))
        got = {
            "name": str(t.getName()), "level": int(t.getOutlineLevel()), "outline": str(t.getOutlineNumber()), "wbs": str(t.getWBS()),
            "start": dt(t.getStart()), "finish": dt(t.getFinish()), "dur": days(t.getDuration()), "milestone": bool(t.getMilestone()),
            "summary": bool(t.getSummary()), "pct": float(t.getPercentageComplete()), "ctype": ctype, "cdate": dt(t.getConstraintDate()),
            "manual": mode == "MANUALLY_SCHEDULED", "est": bool(t.getEstimated()), "preds": preds,
            "astart": dt(t.getActualStart()), "afinish": dt(t.getActualFinish()),
        }
        want = {
            "name": tv(x, "Name"), "level": int(tv(x, "OutlineLevel")), "outline": tv(x, "OutlineNumber"), "wbs": tv(x, "WBS"),
            "start": tv(x, "Start")[:16], "finish": tv(x, "Finish")[:16], "dur": round(hours(tv(x, "Duration")) / 8, 4),
            "milestone": tv(x, "Milestone") == "1", "summary": tv(x, "Summary") == "1", "pct": float(tv(x, "PercentComplete")),
            "ctype": ct_map.get(tv(x, "ConstraintType")), "cdate": tv(x, "ConstraintDate")[:16] if tv(x, "ConstraintDate") else None,
            "manual": tv(x, "Manual") == "1", "est": tv(x, "Estimated") == "1", "preds": xpreds,
            "astart": tv(x, "ActualStart")[:16] if tv(x, "ActualStart") else None, "afinish": tv(x, "ActualFinish")[:16] if tv(x, "ActualFinish") else None,
        }
        diff = {k: (got[k], want[k]) for k in want if got[k] != want[k]}
        if diff:
            bad.append((uid, diff))
        if t.getStart() is not None and t.getFinish() is not None and not got["est"]:
            wk = days(cal.getWork(t.getStart(), t.getFinish(), TimeUnit.DAYS))
            if wk != got["dur"]:
                bad.append((uid, {"kalender(start..finish)": (wk, got["dur"])}))
        row = dict(got, uid=int(uid), preds=[[p[0], str(mt[p[0]].getName()), p[1], p[2]] for p in preds],
                   bstart=dt(t.getBaselineStart()), bfinish=dt(t.getBaselineFinish()), bdur=days(t.getBaselineDuration()),
                   bwork=minutes(t.getBaselineWork()))
        rows.append(row)
    for b in bad[:20]:
        print("    BEDA", b)
    check(not bad, f"semua field {len(rows)} task MPXJ = XML; durasi = waktu kerja kalender MPXJ antara start dan finish")
    out["tasks"] = rows
    out["links"] = sum(len(r["preds"]) for r in rows)

    # ---- resource + assignment
    print("\n[6] Resource dan assignment")
    out["resources"] = [[int(r.getUniqueID()), str(r.getName()), str(r.getType().name())] for r in project.getResources()
                        if r.getUniqueID() is not None and int(r.getUniqueID()) > 0]
    xa = list(root.find(NS + "Assignments"))
    asg = list(project.getResourceAssignments())
    check(len(asg) == len(xa), f"jumlah assignment MPXJ = XML ({len(asg)})")
    abad, arows = [], []
    for a in asg:
        tuid, ruid = str(a.getTask().getUniqueID()), str(a.getResource().getUniqueID())
        x = next((v for v in xa if tv(v, "TaskUID") == tuid and tv(v, "ResourceUID") == ruid), None)
        got = (minutes(a.getWork()), round(float(a.getUnits()), 2))
        want = None if x is None else (round(hours(tv(x, "Work")) * 60, 2), round(float(tv(x, "Units")) * 100, 2))
        if got != want:
            abad.append((tuid, ruid, got, want))
        arows.append([str(a.getTask().getName()), int(tuid), str(a.getResource().getName()), got[0], got[1]])
    check(not abad, f"work/units assignment MPXJ = XML {abad[:5]}")
    out["assignments"] = sorted(arows)
    out["resourceCalendarBad"] = [list(map(str, b)) for b in resource_calendar_checks(project, root)]
    out["mso"] = [str(t.getName()) for t in project.getTasks() if t.getConstraintType() is not None and str(t.getConstraintType().name()) == "MUST_START_ON"]
    check(not out["mso"], f"tanpa MSO (F4 B) {out['mso']}")
    return out


def check_file(path, json_out):
    print(f"Periksa berkas: {path}")
    root = ET.parse(path).getroot()
    file_structure_checks(root)
    try:
        import jpype
        import jpype.imports  # noqa: F401
        import mpxj  # noqa: F401  (menambahkan jar MPXJ ke classpath JPype)
    except ImportError as e:
        print(f"\nFALLBACK: MPXJ/JPype tidak terpasang ({e}); hanya pemeriksaan struktur xml.etree di atas.")
        sys.exit(2 if not FAIL else 1)
    jpype.startJVM()
    from java.lang import Class

    print("MPXJ jar:", Class.forName("org.mpxj.ProjectFile").getProtectionDomain().getCodeSource().getLocation())
    xsd_order_checks(root)
    dump = file_mpxj_dump(path, root)
    dump["fail"] = list(FAIL)
    if json_out:
        with open(json_out, "w", encoding="utf-8") as fh:
            json.dump(dump, fh, ensure_ascii=False, indent=1)
    jpype.shutdownJVM()
    print(f"\n{'SEMUA CEK GENERIK LULUS' if not FAIL else str(len(FAIL)) + ' CEK GAGAL'}")
    sys.exit(1 if FAIL else 0)


def main():
    if "--file" in sys.argv:
        i = sys.argv.index("--file")
        j = sys.argv.index("--json") if "--json" in sys.argv else -1
        check_file(sys.argv[i + 1], sys.argv[j + 1] if j > 0 else None)
        return
    data = build_sample()
    print(f"XML contoh: {os.path.relpath(OUT, ROOT)} ({len(data['xml'])} karakter), stats {data['stats']}")
    root = ET.parse(OUT).getroot()
    structure_checks(root, data)
    try:
        import jpype
        import jpype.imports  # noqa: F401
        import mpxj  # noqa: F401  (menambahkan jar MPXJ ke classpath JPype)
    except ImportError as e:
        print(f"\nFALLBACK: MPXJ/JPype tidak terpasang ({e}); hanya pemeriksaan struktur xml.etree di atas.")
        sys.exit(2 if not FAIL else 1)
    jpype.startJVM()
    from java.lang import Class

    print("MPXJ jar:", Class.forName("org.mpxj.ProjectFile").getProtectionDomain().getCodeSource().getLocation())
    xsd_order_checks(root)
    mpxj_checks(root, data)
    print(f"\n{'SEMUA ASERSI LULUS' if not FAIL else str(len(FAIL)) + ' ASERSI GAGAL'}")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
