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
    check(str(props.getStartDate())[:16] == "2026-11-02T08:00" and str(props.getFinishDate())[:16] == "2026-12-29T17:00", f"StartDate/FinishDate project ({props.getStartDate()} … {props.getFinishDate()})")
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
    check(bool(by["Rilis"].getMilestone()) and dt(by["Rilis"].getStart()) == dt(by["Rilis"].getFinish()) == rk[0] + "T08:00" and str(by["Rilis"].getConstraintType().name()) == "MUST_START_ON", f"milestone Rilis (FF) di es mesin {rk[0]}, MSO")
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
    check(bool(u.getEstimated()) and str(u.getTaskMode().name()) == "MANUALLY_SCHEDULED" and dt(u.getStart()) == "2026-11-10T08:00" and days(u.getDuration()) == 1, "tanpa jadwal: perkiraan, Manual, mulai D, 1 hari")
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
    check(len(asg) == len(xa) == data["stats"]["assignments"] == 9, f"jumlah assignment MPXJ = XML = stats ({len(asg)})")
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
    jpype.shutdownJVM()


def main():
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
