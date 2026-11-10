// Plugin Timeline (Fase 1, PR 1d-2) — Task 3: pembangun XML MSPDI murni (TLMspdi) untuk "Ekspor ke Microsoft Project
// (.xml)" (spec 1d K53, §5.4, §8; rencana 1d-2 R5, R7–R10). XML diurai parser kecil di berkas ini (tanpa dependensi
// baru). Semua tanggal tetap (Oktober–Desember 2026); "hari ini" hanya argumen D.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "../../static/plugins/timeline");
const C = require(path.join(dir, "calendar.js"));
const S = require(path.join(dir, "schedule.js"));
const M = require(path.join(dir, "cpm.js"));
const LD = require(path.join(dir, "load.js"));
const X = require(path.join(dir, "mspdi.js"));

const D = (s) => C.dn(s);
const I = (n) => C.iso(n);
const std = () => C.compile(C.DEFAULT_CAL); // Sen–Jum, libur nasional + cuti bersama SKB ON
const D0 = D("2026-11-10"); // Selasa = "hari ini"

// ---- urutan elemen XSD MSPDI (subset yang dipakai) ----
// Sumber: propOrder JAXB skema MSPDI di MPXJ 16.10.0 (org.mpxj.mspdi.schema.Project, …$Tasks$Task, …$PredecessorLink,
// …$Task$Baseline, …$Calendars$Calendar, …$WeekDay, …$Exceptions$Exception, …$Resources$Resource, …$Assignments$Assignment),
// yang dibangkitkan
// dari XSD MSPDI Microsoft (Project 2010+: Manual SETELAH Name, SEBELUM Type; ActualStart/ActualFinish setelah
// PercentComplete, sebelum ConstraintType; HonorConstraints setelah WorkFormat). Urutan Project dicocokkan juga dengan
// learn.microsoft.com "Project elements and XML structure".
const PROJECT_ORDER = ["SaveVersion", "Name", "Title", "CreationDate", "ScheduleFromStart", "StartDate", "FinishDate", "CalendarUID", "DefaultStartTime", "DefaultFinishTime", "MinutesPerDay", "MinutesPerWeek", "DaysPerMonth", "DefaultTaskType", "DurationFormat", "WorkFormat", "HonorConstraints", "NewTasksEffortDriven", "WeekStartDay", "Calendars", "Tasks", "Resources", "Assignments"];
const TASK_ORDER = ["UID", "ID", "Name", "Manual", "Type", "IsNull", "CreateDate", "WBS", "OutlineNumber", "OutlineLevel", "Start", "Finish", "Duration", "DurationFormat", "Work", "EffortDriven", "Estimated", "Milestone", "Summary", "PercentComplete", "ActualStart", "ActualFinish", "ConstraintType", "CalendarUID", "ConstraintDate", "PredecessorLink", "Baseline", "ManualStart", "ManualFinish", "ManualDuration"];
const TASK_REQUIRED = ["UID", "ID", "Name", "Manual", "Type", "IsNull", "CreateDate", "WBS", "OutlineNumber", "OutlineLevel", "Start", "Finish", "Duration", "DurationFormat", "EffortDriven", "Estimated", "Milestone", "Summary", "PercentComplete", "ConstraintType", "CalendarUID"];
const LINK_ORDER = ["PredecessorUID", "Type", "CrossProject", "LinkLag", "LagFormat"];
const BASELINE_ORDER = ["Number", "Start", "Finish", "Duration", "Work"];
const CALENDAR_ORDER = ["UID", "Name", "IsBaseCalendar", "BaseCalendarUID", "WeekDays", "Exceptions"];
// propOrder Project$Calendars$Calendar$Exceptions$Exception (subset; Name opsional, WorkingTimes hanya hari kerja).
const EXCEPTION_ORDER = ["EnteredByOccurrences", "TimePeriod", "Occurrences", "Name", "Type", "DayWorking", "WorkingTimes"];
const WEEKDAY_ORDER = ["DayType", "DayWorking", "TimePeriod", "WorkingTimes"];
const RESOURCE_ORDER = ["UID", "ID", "Name", "Type", "IsNull", "MaxUnits"];
const ASSIGNMENT_ORDER = ["UID", "TaskUID", "ResourceUID", "Finish", "Start", "Units", "Work"];

// ---- parser XML kecil (cukup untuk keluaran TLMspdi): prolog tetap, elemen tanpa atribut kecuali xmlns di akar,
// teks dengan lima entitas bawaan. Galat struktur / entitas tak dikenal / `<` `&` mentah → lempar.
const PROLOG = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function parseXml(xml) {
  assert.ok(xml.startsWith(PROLOG), "prolog XML");
  const re = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z:]+="[^"<&]*")*)\s*(\/?)>|([^<]+)/y;
  re.lastIndex = PROLOG.length;
  const top = { name: "#doc", attrs: "", kids: [], text: "" };
  const stack = [top];
  while (re.lastIndex < xml.length) {
    const at = re.lastIndex;
    const m = re.exec(xml);
    if (!m) throw new Error("XML rusak di posisi " + at + ": " + JSON.stringify(xml.slice(at, at + 40)));
    const cur = stack[stack.length - 1];
    if (m[5] !== undefined) {
      if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(m[5]) || m[5].indexOf(">") >= 0) throw new Error("teks tidak di-escape: " + JSON.stringify(m[5]));
      cur.text += m[5].replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e]);
    } else if (m[1]) {
      if (cur.name !== m[2]) throw new Error("tag penutup " + m[2] + " ≠ " + cur.name);
      stack.pop();
    } else {
      const el = { name: m[2], attrs: m[3].trim(), kids: [], text: "" };
      cur.kids.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  assert.equal(stack.length, 1, "semua elemen ditutup");
  assert.equal(top.kids.length, 1, "satu elemen akar");
  assert.equal(top.text.trim(), "", "tanpa teks di luar akar");
  return top.kids[0];
}
const kids = (el, name) => el.kids.filter((k) => k.name === name);
const kid = (el, name) => el.kids.find((k) => k.name === name);
const val = (el, name) => {
  const k = kid(el, name);
  return k === undefined ? undefined : k.text;
};
const names = (el) => el.kids.map((k) => k.name);

// Anak `el` mengikuti urutan relatif `order` (elemen boleh absen; elemen berulang harus berurutan); semua nama dikenal.
function assertOrder(el, order, label) {
  let last = -1;
  for (const n of names(el)) {
    const i = order.indexOf(n);
    assert.ok(i >= 0, label + ": elemen tak dikenal " + n);
    assert.ok(i >= last, label + ": " + n + " setelah " + order[last] + " (urutan XSD dilanggar): " + names(el).join(","));
    if (i === last) assert.ok(n === "PredecessorLink" || n === "Baseline" || n === "WeekDay" || n === "WorkingTime", label + ": " + n + " ganda");
    last = i;
  }
}

// Palsu `api.taskExt.read` (bentuk runtime: kunci milik plugin tanpa prefiks).
const readExt = (task) => {
  const out = {};
  const ext = task && task.ext;
  if (!ext || typeof ext !== "object") return out;
  for (const k of Object.keys(ext)) if (k.indexOf("timeline.") === 0) out[k.slice(9)] = JSON.parse(JSON.stringify(ext[k]));
  return out;
};

const LIST = 7;
// Pembangun task (pola timeline_load.test.js). deps: [[id, type?, lag?], …] (id string = cid). title bawaan "T{id}".
function mk(o) {
  const ext = {};
  if (o.start !== undefined) ext["timeline.start"] = o.start;
  if (o.d !== undefined) ext["timeline.duration"] = o.d;
  if (o.deps) ext["timeline.deps"] = o.deps.map(([id, type, lag]) => Object.assign({ t: { $task: id }, lag: lag || 0 }, type ? { type } : {}));
  if (o.mode !== undefined) ext["timeline.mode"] = o.mode;
  if (o.constraint !== undefined) ext["timeline.constraint"] = o.constraint;
  if (o.actual !== undefined) ext["timeline.actual"] = o.actual;
  const t = {
    id: o.id,
    title: o.title === undefined ? "T" + o.id : o.title,
    created_at: "2026-10-01T00:00:" + String(o.id).padStart(5, "0"),
    list_id: o.list_id === undefined ? LIST : o.list_id,
    project: o.project === undefined ? "Alpha" : o.project,
    gtd_status: o.gtd_status || (o.done ? "done" : "next"),
    completed_at: o.completed_at !== undefined ? o.completed_at : o.done ? "2026-11-05T17:30:00Z" : null,
    progress: o.progress === undefined ? 0 : o.progress,
    pomodoros_done: o.pomo === undefined ? 0 : o.pomo,
    deadline: null,
    parent_id: o.parent === undefined ? null : o.parent,
    recurrence_type: o.recurrence_type || null,
    archived: !!o.archived,
    deleted: !!o.deleted,
    assigned_to: o.to === undefined ? null : o.to,
    ext,
  };
  if (o.cid !== undefined) t.cid = o.cid;
  if (o.est !== undefined) t.estimated_pomodoros = o.est;
  return t;
}
const unitKey = (project, list_id = LIST) => S.unitOf({ list_id, project }).recId;
const autoUnits = (...projects) => new Map(projects.map((p) => [unitKey(p), { auto: true }]));

// TLCpm.run lalu TLMspdi.build atas data yang sama (pola useEngine + R5), lalu urai XML-nya.
function exp(tasks, o = {}) {
  const cal = o.cal || std();
  const units = o.units || autoUnits("Alpha");
  const result = o.result === undefined ? M.run({ tasks, cal, units, readExt }) : o.result;
  const input = {
    tasks,
    cal,
    readExt,
    result,
    units,
    pageKind: o.pageKind || "workspace",
    title: o.title === undefined ? "Tim Uji" : o.title,
    fileName: o.fileName,
    people: o.people || new Map(),
    baseline: o.baseline === undefined ? null : o.baseline,
    D: o.D === undefined ? D0 : o.D,
  };
  if (o.ownerUid !== undefined) input.ownerUid = o.ownerUid;
  const out = X.build(input);
  return Object.assign({}, out, { doc: parseXml(out.xml) });
}
const taskEls = (doc) => kids(kid(doc, "Tasks"), "Task");
const byName = (doc, nm) => {
  const hit = taskEls(doc).filter((t) => val(t, "Name") === nm);
  assert.equal(hit.length, 1, "task bernama " + nm);
  return hit[0];
};
const linksOf = (t) => kids(t, "PredecessorLink").map((l) => ({ uid: val(l, "PredecessorUID"), type: val(l, "Type"), lag: val(l, "LinkLag"), fmt: val(l, "LagFormat"), cross: val(l, "CrossProject") }));

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- modul

test("modul: pola part UMD (seperti load.js), require fallback, ekspor beku, tanpa global", () => {
  const src = fs.readFileSync(path.join(dir, "mspdi.js"), "utf8");
  assert.match(src, /const TLMspdi = \(function \(CAL, SCHED, CPM, LAYOUT, LOAD, HOL\)/);
  assert.match(src, /typeof TLCal !== "undefined" \? TLCal : require\("\.\/calendar\.js"\)/);
  assert.match(src, /typeof TLSched !== "undefined" \? TLSched : require\("\.\/schedule\.js"\)/);
  assert.match(src, /typeof TLCpm !== "undefined" \? TLCpm : require\("\.\/cpm\.js"\)/);
  assert.match(src, /typeof TLLayout !== "undefined" \? TLLayout : require\("\.\/layout\.js"\)/);
  assert.match(src, /typeof TLLoad !== "undefined" \? TLLoad : require\("\.\/load\.js"\)/);
  assert.match(src, /typeof TLHolidays !== "undefined" \? TLHolidays : require\("\.\/holidays-id\.js"\)/);
  assert.match(src, /module\.exports = TLMspdi/);
  assert.doesNotMatch(src, /\bwindow\b|\bself\b|\bglobalThis\b|\bdocument\b/);
  assert.ok(Object.isFrozen(X));
  for (const f of ["build", "fileNameOf", "esc", "targetOf"]) assert.equal(typeof X[f], "function", f);
});

test("sumber mspdi.js tanpa kata Date utuh, localeCompare, Math.random, XMLHttpRequest — termasuk komentar", () => {
  const src = fs.readFileSync(path.join(dir, "mspdi.js"), "utf8");
  assert.doesNotMatch(src, /\bDate\b/);
  assert.doesNotMatch(src, /localeCompare/);
  assert.doesNotMatch(src, /Math\.random/);
  assert.doesNotMatch(src, /XMLHttpRequest|innerHTML|localStorage|fetch\s*\(/);
});

test("targetOf = target 🍅 TLLoad (tes silang lewat TLLoad.run: beban total = target × 1000 untuk pomodoros_done 0)", () => {
  const cases = [undefined, null, 0, 1, 2, 5, 99, 100, 150, 2.5, "3", -4, NaN];
  for (const est of cases) {
    const t = mk({ id: 1, start: "2026-11-02", d: 1, to: 3 });
    if (est !== undefined) t.estimated_pomodoros = est;
    const cal = std();
    const result = M.run({ tasks: [t], cal, units: autoUnits("Alpha"), readExt });
    const ld = LD.run({ tasks: [t], cal, readExt, result, units: autoUnits("Alpha"), people: [], byAssignee: true, D: D("2026-11-02") });
    assert.equal(ld.rows[0].total, X.targetOf(t) * 1000, "est " + String(est));
  }
  assert.equal(X.targetOf({ estimated_pomodoros: 150 }), 99);
  assert.equal(X.targetOf({ estimated_pomodoros: 2.5 }), 1);
  assert.equal(X.targetOf({}), 1);
});

// ---------------------------------------------------------------- esc

test("esc: lima entitas XML, C0 selain \\t \\n \\r dan U+007F dibuang, surrogate tunggal dibuang, emoji utuh, non-string → ''", () => {
  assert.equal(X.esc(`A & B <C> "D" 'E'`), "A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
  assert.equal(X.esc("a\u0000b\u0001c\u0008d\u000be\u000cf\u001fg\u007fh"), "abcdefgh");
  assert.equal(X.esc("tab\tlf\ncr\r"), "tab\tlf\ncr\r");
  assert.equal(X.esc("😀👨\u200d👩\u200d👧 漢字"), "😀👨\u200d👩\u200d👧 漢字");
  assert.equal(X.esc("x\uD800y\uDC00z\uD83D"), "xyz", "surrogate tinggi/rendah tunggal dibuang (termasuk di ujung)");
  assert.equal(X.esc("\uDC00\uD800"), "", "pasangan terbalik = dua surrogate tunggal");
  assert.equal(X.esc("a￾b￿c"), "abc", "U+FFFE/U+FFFF bukan karakter XML 1.0");
  for (const v of [undefined, null, 5, {}, ["a"]]) assert.equal(X.esc(v), "");
  assert.equal(X.esc(""), "");
});

// ---------------------------------------------------------------- struktur Project

test("prolog + namespace + urutan blok Project sesuai XSD (Project → Calendars → Tasks → Resources → Assignments)", () => {
  const tasks = [mk({ id: 1, start: "2026-11-02", d: 5 }), mk({ id: 2, start: "2026-11-09", d: 3, deps: [[1, "FS", 0]] })];
  const r = exp(tasks, { title: "Tim Pemasaran", fileName: "Tim-Pemasaran-2026-11-10.xml" });
  assert.ok(r.xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">'));
  assert.ok(r.xml.endsWith("</Project>\n"));
  const p = r.doc;
  assert.equal(p.name, "Project");
  assert.equal(p.attrs, 'xmlns="http://schemas.microsoft.com/project"');
  assert.deepEqual(names(p), PROJECT_ORDER, "semua blok Project, urutan XSD");
  assert.equal(val(p, "SaveVersion"), "14");
  assert.equal(val(p, "Name"), "Tim-Pemasaran-2026-11-10.xml");
  assert.equal(val(p, "Title"), "Tim Pemasaran");
  assert.equal(val(p, "CreationDate"), "2026-11-10T00:00:00");
  assert.equal(val(p, "ScheduleFromStart"), "1");
  assert.equal(val(p, "StartDate"), "2026-11-02T08:00:00");
  assert.equal(val(p, "FinishDate"), "2026-11-11T17:00:00");
  assert.equal(val(p, "CalendarUID"), "1");
  assert.equal(val(p, "DefaultStartTime"), "08:00:00");
  assert.equal(val(p, "DefaultFinishTime"), "17:00:00");
  assert.equal(val(p, "MinutesPerDay"), "480");
  assert.equal(val(p, "MinutesPerWeek"), "2400");
  assert.equal(val(p, "DaysPerMonth"), "20");
  assert.equal(val(p, "DefaultTaskType"), "1");
  assert.equal(val(p, "DurationFormat"), "7");
  assert.equal(val(p, "WorkFormat"), "2");
  assert.equal(val(p, "HonorConstraints"), "1", "I4 F2: MSO/MFO menang atas tautan");
  assert.equal(val(p, "NewTasksEffortDriven"), "0");
  assert.equal(val(p, "WeekStartDay"), "1");
  // fileName absen → fileNameOf(title, D)
  const r2 = exp(tasks, { title: "Tim Pemasaran" });
  assert.equal(val(r2.doc, "Name"), "Tim-Pemasaran-2026-11-10.xml");
});

test("urutan anak Task/PredecessorLink/Baseline/Calendar/WeekDay/Resource/Assignment mengikuti XSD; elemen wajib Task ada", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 5, est: 4, to: 3, mode: "manual" }),
    mk({ id: 2, start: "2026-11-09", d: 3, deps: [[1, "SS", 2]], to: 5, constraint: { type: "SNET", date: "2026-11-09" }, progress: 10 }),
    mk({ id: 3, project: "Beta" }),
    mk({ id: 4, project: "Beta", start: "2026-11-03", d: 0 }),
    mk({ id: 5, project: "Beta", parent: 4, start: "2026-11-04", d: 1 }),
  ];
  const bl = { rows: new Map([["1", { s: D("2026-11-02"), f: D("2026-11-06"), d: 5, w: 4 }]]) };
  const r = exp(tasks, { baseline: bl, people: new Map([[3, "Sari"]]), cal: C.compile({ weekdays: [1, 2, 3, 4, 5], off: [{ d: "2026-11-20" }], work: [{ d: "2026-11-21" }] }) });
  const all = taskEls(r.doc);
  assert.equal(all.length, 1 + 2 + 5, "UID 0 + 2 kelompok + 5 task");
  for (const t of all) {
    assertOrder(t, TASK_ORDER, "Task " + val(t, "UID"));
    for (const n of TASK_REQUIRED) assert.equal(kids(t, n).length, 1, "Task " + val(t, "UID") + " wajib " + n);
    for (const l of kids(t, "PredecessorLink")) assert.deepEqual(names(l), LINK_ORDER);
    for (const b of kids(t, "Baseline")) assert.deepEqual(names(b), BASELINE_ORDER);
  }
  assert.ok(all.some((t) => kids(t, "PredecessorLink").length), "fixture memuat tautan");
  assert.ok(all.some((t) => kids(t, "Baseline").length), "fixture memuat baseline");
  assert.ok(all.some((t) => kid(t, "ManualStart")), "fixture memuat ManualStart");
  assert.ok(all.some((t) => kid(t, "Work")), "fixture memuat Work task");
  assert.ok(all.some((t) => kid(t, "ConstraintDate")), "fixture memuat ConstraintDate");
  const cal = kid(kid(r.doc, "Calendars"), "Calendar");
  assert.deepEqual(names(kid(r.doc, "Calendars")), ["Calendar"]);
  assert.deepEqual(names(cal), CALENDAR_ORDER);
  for (const w of kids(kid(cal, "WeekDays"), "WeekDay")) {
    assertOrder(w, WEEKDAY_ORDER, "WeekDay");
    const tp = kid(w, "TimePeriod");
    if (tp) assert.deepEqual(names(tp), ["FromDate", "ToDate"]);
    const wt = kid(w, "WorkingTimes");
    if (wt) for (const x of kids(wt, "WorkingTime")) assert.deepEqual(names(x), ["FromTime", "ToTime"]);
  }
  const exs = kids(kid(cal, "Exceptions"), "Exception");
  assert.ok(exs.length >= 2, "fixture memuat pengecualian libur dan kerja");
  for (const x of exs) {
    assertOrder(x, EXCEPTION_ORDER, "Exception");
    assert.deepEqual(names(kid(x, "TimePeriod")), ["FromDate", "ToDate"]);
  }
  assert.ok(all.some((t) => kid(t, "ActualStart")), "fixture memuat ActualStart (task berjalan)");
  const res = kids(kid(r.doc, "Resources"), "Resource");
  assert.equal(res.length, 2);
  for (const x of res) assert.deepEqual(names(x), RESOURCE_ORDER);
  const asg = kids(kid(r.doc, "Assignments"), "Assignment");
  assert.equal(asg.length, 2);
  for (const x of asg) assert.deepEqual(names(x), ASSIGNMENT_ORDER);
});

// ---------------------------------------------------------------- kalender

test("kalender: satu kalender dasar UID 1, pola mingguan DayType 1–7 (1 = Minggu) + jam 08–12 dan 13–17", () => {
  const r = exp([mk({ id: 1, start: "2026-11-02", d: 1 })]);
  const cal = kid(kid(r.doc, "Calendars"), "Calendar");
  assert.equal(val(cal, "UID"), "1");
  assert.equal(val(cal, "Name"), "Standar");
  assert.equal(val(cal, "IsBaseCalendar"), "1");
  assert.equal(val(cal, "BaseCalendarUID"), "-1");
  const wd = kids(kid(cal, "WeekDays"), "WeekDay");
  const pattern = wd.filter((w) => val(w, "DayType") !== "0");
  assert.deepEqual(pattern.map((w) => [val(w, "DayType"), val(w, "DayWorking")]), [["1", "0"], ["2", "1"], ["3", "1"], ["4", "1"], ["5", "1"], ["6", "1"], ["7", "0"]]);
  for (const w of pattern) {
    const wt = kid(w, "WorkingTimes");
    if (val(w, "DayWorking") === "0") assert.equal(wt, undefined, "hari libur mingguan tanpa WorkingTimes");
    else assert.deepEqual(kids(wt, "WorkingTime").map((x) => [val(x, "FromTime"), val(x, "ToTime")]), [["08:00:00", "12:00:00"], ["13:00:00", "17:00:00"]]);
    assert.equal(kid(w, "TimePeriod"), undefined);
  }
  // Pola Senin–Sabtu → Sabtu (DayType 7) hari kerja; MinutesPerWeek = 480 × 6.
  const r6 = exp([mk({ id: 1, start: "2026-11-02", d: 1 })], { cal: C.compile({ weekdays: [1, 2, 3, 4, 5, 6], national: false, cutiBersama: false }) });
  const p6 = kids(kid(kid(kid(r6.doc, "Calendars"), "Calendar"), "WeekDays"), "WeekDay").filter((w) => val(w, "DayType") !== "0");
  assert.deepEqual(p6.map((w) => val(w, "DayWorking")), ["0", "1", "1", "1", "1", "1", "1"]);
  assert.equal(val(r6.doc, "MinutesPerWeek"), "2880");
});

function exceptions(doc) {
  const wd = kids(kid(kid(kid(doc, "Calendars"), "Calendar"), "WeekDays"), "WeekDay");
  return wd
    .filter((w) => val(w, "DayType") === "0")
    .map((w) => {
      const tp = kid(w, "TimePeriod");
      const wt = kid(w, "WorkingTimes");
      return {
        from: val(tp, "FromDate"),
        to: val(tp, "ToDate"),
        working: val(w, "DayWorking"),
        times: wt ? kids(wt, "WorkingTime").map((x) => val(x, "FromTime") + "-" + val(x, "ToTime")).join(",") : null,
      };
    });
}

test("kalender: pengecualian = libur di hari kerja (DayWorking 0) dan hari kerja pengganti di akhir pekan (DayWorking 1 + jam), hari berurutan sejenis digabung", () => {
  // Kalender halaman: Sen–Jum + SKB; libur tambahan Rab–Kam 18–19 Nov; hari kerja pengganti Sab–Min 21–22 Nov.
  const cal = C.compile({ weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [{ d: "2026-11-18", n: "Rapat" }, { d: "2026-11-19", n: "" }], work: [{ d: "2026-11-21" }, { d: "2026-11-22" }] });
  // Mulai Sen 16 Nov, 10 hari kerja: 16, 17, 20, 21, 22, 23, 24, 25, 26, 27 → selesai Jum 27 Nov.
  const r = exp([mk({ id: 1, start: "2026-11-16", d: 10 })], { cal });
  assert.equal(val(byName(r.doc, "T1"), "Finish"), "2026-11-27T17:00:00");
  // Rentang [16 Nov − 7, 27 Nov + 31] = [9 Nov, 28 Des]: SKB 24 Des (cuti, Kam) + 25 Des (libur, Jum) digabung.
  assert.deepEqual(exceptions(r.doc), [
    { from: "2026-11-18T00:00:00", to: "2026-11-19T23:59:00", working: "0", times: null },
    { from: "2026-11-21T00:00:00", to: "2026-11-22T23:59:00", working: "1", times: "08:00:00-12:00:00,13:00:00-17:00:00" },
    { from: "2026-12-24T00:00:00", to: "2026-12-25T23:59:00", working: "0", times: null },
  ]);
});

test("kalender: batas rentang pengecualian [mulai paling awal − 7, selesai paling akhir + 31] inklusif", () => {
  // A mulai Rab 11 Nov → batas bawah Rab 4 Nov; B selesai Sen 16 Nov → batas atas Kam 17 Des.
  const cal = C.compile({ weekdays: [1, 2, 3, 4, 5], national: false, cutiBersama: false, off: [{ d: "2026-11-03" }, { d: "2026-11-04" }, { d: "2026-12-17" }, { d: "2026-12-18" }] });
  const r = exp([mk({ id: 1, start: "2026-11-11", d: 1 }), mk({ id: 2, start: "2026-11-16", d: 1 })], { cal });
  assert.deepEqual(exceptions(r.doc).map((e) => e.from.slice(0, 10)), ["2026-11-04", "2026-12-17"]);
});

test("kalender: rentang > 3.660 hari dijepit ke 3.660 hari (bergeser ke jendela hari ini ± 1.830 bila perlu)", () => {
  // (a) rentang [9 Nov 2026, 2 Jul 2040] terlalu lebar → [lo, lo + 3659]; lo + 3659 = Sabtu, lo + 3660 = Minggu.
  const lo = D("2026-11-09");
  assert.equal(C.isoWeekday(lo + 3659), 6);
  const cal = C.compile({ weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, work: [{ d: I(lo + 3659) }, { d: I(lo + 3660) }] });
  const r = exp([mk({ id: 1, start: "2026-11-16", d: 1 }), mk({ id: 2, start: "2040-06-01", d: 1 })], { cal });
  const ex = exceptions(r.doc);
  assert.ok(ex.some((e) => e.from === I(lo + 3659) + "T00:00:00" && e.working === "1"), "hari ke-3660 masuk");
  assert.ok(!ex.some((e) => e.to >= I(lo + 3660)), "hari ke-3661 tidak masuk");
  assert.ok(ex.some((e) => e.from === "2026-12-24T00:00:00"), "libur Desember 2026 tetap ada");
  // (b) mulai paling awal 2010 jauh sebelum hari ini → rentang digeser: [hi − 3659, hi] (hi = 16 Nov 2026 + 31).
  const hi = D("2026-11-16") + 31;
  const r2 = exp([mk({ id: 1, start: "2010-01-04", d: 1 }), mk({ id: 2, start: "2026-11-16", d: 1 })]);
  const ex2 = exceptions(r2.doc);
  assert.ok(ex2.length > 0);
  assert.ok(ex2.every((e) => e.from >= I(hi - 3659) && e.to.slice(0, 10) <= I(hi)), "semua pengecualian di [hi − 3659, hi]");
  assert.ok(ex2.some((e) => e.from === "2026-08-17T00:00:00"), "17 Agustus 2026 (Senin) tetap libur");
});

// ---------------------------------------------------------------- outline

test("outline workspace: kelompok = task ringkasan tingkat 1 (nama project / \"(Tanpa project)\"), task +1 tingkat, WBS berprefiks nomor kelompok", () => {
  const tasks = [
    mk({ id: 1, title: "Desain", start: "2026-11-02", d: 5 }),
    mk({ id: 2, title: "Bangun", start: "2026-11-09", d: 3, deps: [[1, "FS", 0]] }),
    mk({ id: 3, title: "Rapat", project: "Beta", start: "2026-11-03", d: 1 }),
    mk({ id: 4, title: "Induk", project: "Beta" }),
    mk({ id: 5, title: "Anak A", project: "Beta", parent: 4, start: "2026-11-04", d: 2 }),
    mk({ id: 6, title: "Anak B", project: "Beta", parent: 4, start: "2026-11-06", d: 0 }),
    mk({ id: 7, title: "Lepas", project: "", start: "2026-11-10", d: 1 }),
    mk({ id: 8, title: "Harian", recurrence_type: "daily", start: "2026-11-02", d: 1 }),
    mk({ id: 9, title: "Diarsip", gtd_status: "archived", start: "2026-11-02", d: 1 }),
    mk({ id: 10, title: "Dihapus", deleted: true, start: "2026-11-02", d: 1 }),
  ];
  const r = exp(tasks, { title: "Tim Uji" });
  const rows = taskEls(r.doc).map((t) => [val(t, "UID"), val(t, "ID"), val(t, "Name"), val(t, "OutlineLevel"), val(t, "OutlineNumber"), val(t, "WBS"), val(t, "Summary")]);
  assert.deepEqual(rows, [
    ["0", "0", "Tim Uji", "0", "0", "0", "1"],
    ["1", "1", "Alpha", "1", "1", "1", "1"],
    ["2", "2", "Desain", "2", "1.1", "1.1", "0"],
    ["3", "3", "Bangun", "2", "1.2", "1.2", "0"],
    ["4", "4", "Beta", "1", "2", "2", "1"],
    ["5", "5", "Rapat", "2", "2.1", "2.1", "0"],
    ["6", "6", "Induk", "2", "2.2", "2.2", "1"],
    ["7", "7", "Anak A", "3", "2.2.1", "2.2.1", "0"],
    ["8", "8", "Anak B", "3", "2.2.2", "2.2.2", "0"],
    ["9", "9", "(Tanpa project)", "1", "3", "3", "1"],
    ["10", "10", "Lepas", "2", "3.1", "3.1", "0"],
  ]);
  assert.equal(r.stats.tasks, 10, "UID 1…10 (kelompok + task; tanpa UID 0)");
  // Tautan Bangun → Desain memakai UID baris (2).
  assert.deepEqual(linksOf(byName(r.doc, "Bangun")), [{ uid: "2", type: "1", lag: "0", fmt: "7", cross: "0" }]);
  // Kelompok/ringkasan: Start/Finish = min/maks anak.
  assert.equal(val(byName(r.doc, "Alpha"), "Start"), "2026-11-02T08:00:00");
  assert.equal(val(byName(r.doc, "Alpha"), "Finish"), "2026-11-11T17:00:00");
  assert.equal(val(byName(r.doc, "Beta"), "Start"), "2026-11-03T08:00:00");
  assert.equal(val(byName(r.doc, "Beta"), "Finish"), "2026-11-06T08:00:00", "anak terakhir milestone 08:00");
  assert.equal(val(byName(r.doc, "Tim Uji"), "Start"), "2026-11-02T08:00:00");
  assert.equal(val(byName(r.doc, "Tim Uji"), "Finish"), "2026-11-11T17:00:00");
});

test("outline halaman project: tanpa kelompok — task tingkat 1, anak tingkat 2, WBS Timeline apa adanya", () => {
  const tasks = [
    mk({ id: 1, title: "Desain", start: "2026-11-02", d: 5 }),
    mk({ id: 2, title: "Bangun", start: "2026-11-09", d: 3 }),
    mk({ id: 4, title: "Induk" }),
    mk({ id: 5, title: "Anak A", parent: 4, start: "2026-11-04", d: 2 }),
    mk({ id: 6, title: "Cucu", parent: 5, start: "2026-11-05", d: 1 }),
  ];
  const r = exp(tasks, { pageKind: "project", title: "Alpha" });
  const rows = taskEls(r.doc).map((t) => [val(t, "UID"), val(t, "Name"), val(t, "OutlineLevel"), val(t, "OutlineNumber"), val(t, "Summary")]);
  assert.deepEqual(rows, [
    ["0", "Alpha", "0", "0", "1"],
    ["1", "Desain", "1", "1", "0"],
    ["2", "Bangun", "1", "2", "0"],
    ["3", "Induk", "1", "3", "1"],
    ["4", "Anak A", "2", "3.1", "1"],
    ["5", "Cucu", "3", "3.1.1", "0"],
  ]);
});

// ---------------------------------------------------------------- tanggal, durasi, % selesai

test("Start = es 08:00, Finish = ef 17:00 (mesin; F2), Duration PT{d×8}H0M0S (DurationFormat 7); milestone Start = Finish, Milestone 1; ringkasan min/maks anak", () => {
  const tasks = [
    mk({ id: 1, title: "A", start: "2026-11-02", d: 5, progress: 50 }),
    mk({ id: 2, title: "Sabtu", start: "2026-11-07", d: 2 }), // akar Otomatis mulai Sabtu → mesin: Senin 9 – Selasa 10 Nov
    mk({ id: 3, title: "M", start: "2026-11-12", d: 0 }),
    mk({ id: 4, title: "Tanpa durasi", start: "2026-11-13" }), // duration absen → 1
    mk({ id: 5, title: "Lintas Natal", start: "2026-12-23", d: 3 }), // 23 Des + 28 + 29 (24–25 SKB, 26–27 akhir pekan)
    mk({ id: 6, title: "Induk" }),
    mk({ id: 7, title: "Anak 1", parent: 6, start: "2026-11-02", d: 5 }),
    mk({ id: 8, title: "Anak M", parent: 6, start: "2026-11-12", d: 0 }),
  ];
  const r = exp(tasks, { pageKind: "project" });
  const f = (nm) => {
    const t = byName(r.doc, nm);
    return [val(t, "Start"), val(t, "Finish"), val(t, "Duration"), val(t, "DurationFormat"), val(t, "Milestone"), val(t, "Summary"), val(t, "Estimated"), val(t, "Type"), val(t, "EffortDriven"), val(t, "IsNull"), val(t, "CalendarUID"), val(t, "CreateDate")];
  };
  const tail = ["0", "1", "0", "0", "-1", "2026-11-10T00:00:00"];
  assert.deepEqual(f("A"), ["2026-11-02T08:00:00", "2026-11-06T17:00:00", "PT40H0M0S", "7", "0", "0", ...tail]);
  assert.deepEqual(f("Sabtu"), ["2026-11-09T08:00:00", "2026-11-10T17:00:00", "PT16H0M0S", "7", "0", "0", ...tail], "Start = es mesin (F2 I1)");
  assert.deepEqual(f("M"), ["2026-11-12T08:00:00", "2026-11-12T08:00:00", "PT0H0M0S", "7", "1", "0", ...tail]);
  assert.deepEqual(f("Tanpa durasi"), ["2026-11-13T08:00:00", "2026-11-13T17:00:00", "PT8H0M0S", "7", "0", "0", ...tail]);
  assert.deepEqual(f("Lintas Natal"), ["2026-12-23T08:00:00", "2026-12-29T17:00:00", "PT24H0M0S", "7", "0", "0", ...tail]);
  // Ringkasan: 2 Nov 08:00 … 12 Nov 08:00 = 8 hari kerja (2–6, 9–11 Nov) = 64 jam.
  assert.deepEqual(f("Induk"), ["2026-11-02T08:00:00", "2026-11-12T08:00:00", "PT64H0M0S", "7", "0", "1", ...tail]);
  // UID 0 = seluruh project: 2 Nov 08:00 … 29 Des 17:00 → hari kerja 2 Nov–29 Des minus 24–25 Des = 40 hari kerja.
  const p = byName(r.doc, "Tim Uji");
  assert.equal(val(p, "Start"), "2026-11-02T08:00:00");
  assert.equal(val(p, "Finish"), "2026-12-29T17:00:00");
  assert.equal(val(p, "Duration"), "PT" + C.workdays(std(), D("2026-11-02"), D("2026-12-29")) * 8 + "H0M0S");
  assert.equal(C.workdays(std(), D("2026-11-02"), D("2026-12-29")), 40);
  assert.equal(val(r.doc, "StartDate"), "2026-11-02T08:00:00");
  assert.equal(val(r.doc, "FinishDate"), "2026-12-29T17:00:00");
});

test("PercentComplete: selesai 100; progress dijepit 0–100 dan dibulatkan; bukan bilangan → 0; ringkasan 0", () => {
  const tasks = [
    mk({ id: 1, title: "p50", start: "2026-11-02", d: 1, progress: 50 }),
    mk({ id: 2, title: "selesai", start: "2026-11-02", d: 1, progress: 10, done: true }),
    mk({ id: 3, title: "p150", start: "2026-11-02", d: 1, progress: 150 }),
    mk({ id: 4, title: "negatif", start: "2026-11-02", d: 1, progress: -5 }),
    mk({ id: 5, title: "teks", start: "2026-11-02", d: 1, progress: "abc" }),
    mk({ id: 6, title: "pecahan", start: "2026-11-02", d: 1, progress: 33.6 }),
    mk({ id: 7, title: "null", start: "2026-11-02", d: 1, progress: null }),
    mk({ id: 8, title: "Induk", progress: 80 }),
    mk({ id: 9, title: "anak", parent: 8, start: "2026-11-02", d: 1, progress: 100 }),
  ];
  const r = exp(tasks, { pageKind: "project" });
  const pc = (nm) => val(byName(r.doc, nm), "PercentComplete");
  assert.deepEqual(["p50", "selesai", "p150", "negatif", "teks", "pecahan", "null", "Induk", "anak", "Tim Uji"].map(pc), ["50", "100", "100", "0", "0", "34", "0", "0", "100", "0"]);
});

// ---------------------------------------------------------------- kendala, mode

test("kendala: SNET 4 (08:00) / MFO 3 (17:00) / ASAP 0 tanpa ConstraintDate untuk task Otomatis berpendahulu", () => {
  const tasks = [
    mk({ id: 1, title: "Akar", start: "2026-11-02", d: 1 }),
    mk({ id: 2, title: "ASAP", start: "2026-11-03", d: 1, deps: [[1, "FS", 0]] }),
    mk({ id: 3, title: "SNET", start: "2026-11-20", d: 1, deps: [[1, "FS", 0]], constraint: { type: "SNET", date: "2026-11-20" } }),
    mk({ id: 4, title: "MFO", start: "2026-11-27", d: 1, constraint: { type: "MFO", date: "2026-11-27" } }),
    mk({ id: 5, title: "Rusak", start: "2026-11-03", d: 1, deps: [[1, "FS", 0]], constraint: { type: "FNLT", date: "2026-11-27" } }),
  ];
  const r = exp(tasks);
  const ct = (nm) => [val(byName(r.doc, nm), "ConstraintType"), val(byName(r.doc, nm), "ConstraintDate"), val(byName(r.doc, nm), "Manual")];
  assert.deepEqual(ct("ASAP"), ["0", undefined, "0"]);
  assert.deepEqual(ct("SNET"), ["4", "2026-11-20T08:00:00", "0"]);
  assert.deepEqual(ct("MFO"), ["3", "2026-11-27T17:00:00", "0"]);
  assert.deepEqual(ct("Rusak"), ["0", undefined, "0"], "kendala tak dikenal = ASAP (TLSched.readSched)");
});

test("Otomatis tanpa tautan pendahulu di berkas → SNET di mulai tersimpan (aturan akar mesin: ES = mulai tersimpan), termasuk bila pendahulunya dilewati", () => {
  const tasks = [
    mk({ id: 1, title: "Akar", start: "2026-11-04", d: 1 }),
    mk({ id: 2, title: "Pendahulu luar", start: "2026-11-05", d: 1, deps: [[999, "FS", 0]] }),
    mk({ id: 3, title: "Penerus", start: "2026-11-05", d: 1, deps: [[1, "FS", 0]] }),
    mk({ id: 4, title: "Milestone akar", start: "2026-11-07", d: 0 }),
  ];
  const r = exp(tasks);
  const ct = (nm) => [val(byName(r.doc, nm), "ConstraintType"), val(byName(r.doc, nm), "ConstraintDate")];
  assert.deepEqual(ct("Akar"), ["4", "2026-11-04T08:00:00"]);
  assert.deepEqual(ct("Pendahulu luar"), ["4", "2026-11-05T08:00:00"]);
  assert.deepEqual(ct("Penerus"), ["0", undefined]);
  assert.deepEqual(ct("Milestone akar"), ["4", "2026-11-07T08:00:00"]);
  // Mesin Timeline memang menjadwalkan akar di mulai tersimpannya.
  const res = M.run({ tasks, cal: std(), units: autoUnits("Alpha"), readExt });
  assert.equal(I(res.nodes.get("1").es), "2026-11-04");
  assert.equal(res.nodes.get("1").driver.kind, "root");
});

test("R8: mode efektif Manual → Manual 1 + SNET di mulai tersimpan bila tanpa kendala; ManualStart/Finish/Duration = Start/Finish/Duration; Otomatis → Manual 0 tanpa Manual*", () => {
  const tasks = [
    mk({ id: 1, title: "Manual unit", project: "Beta", start: "2026-11-03", d: 2 }), // Beta tanpa record project = Manual (bawaan)
    mk({ id: 2, title: "Manual MFO", project: "Beta", start: "2026-11-09", d: 1, constraint: { type: "MFO", date: "2026-11-09" } }),
    mk({ id: 3, title: "Manual eksplisit", start: "2026-11-04", d: 1, mode: "manual", deps: [[4, "FS", 0]] }), // di unit Otomatis
    mk({ id: 4, title: "Otomatis", start: "2026-11-02", d: 1 }),
    mk({ id: 5, title: "Otomatis eksplisit", project: "Beta", start: "2026-11-05", d: 1, mode: "auto", deps: [[1, "FS", 0]] }),
  ];
  const r = exp(tasks);
  const g = (nm) => {
    const t = byName(r.doc, nm);
    return [val(t, "Manual"), val(t, "ConstraintType"), val(t, "ConstraintDate"), val(t, "ManualStart"), val(t, "ManualFinish"), val(t, "ManualDuration")];
  };
  assert.deepEqual(g("Manual unit"), ["1", "4", "2026-11-03T08:00:00", "2026-11-03T08:00:00", "2026-11-04T17:00:00", "PT16H0M0S"]);
  assert.deepEqual(g("Manual MFO"), ["1", "3", "2026-11-09T17:00:00", "2026-11-09T08:00:00", "2026-11-09T17:00:00", "PT8H0M0S"]);
  assert.deepEqual(g("Manual eksplisit"), ["1", "4", "2026-11-04T08:00:00", "2026-11-04T08:00:00", "2026-11-04T17:00:00", "PT8H0M0S"]);
  assert.deepEqual(g("Otomatis"), ["0", "4", "2026-11-02T08:00:00", undefined, undefined, undefined]);
  assert.deepEqual(g("Otomatis eksplisit"), ["0", "0", undefined, undefined, undefined, undefined]);
  // Kelompok, ringkasan, dan UID 0 selalu Otomatis tanpa kendala.
  for (const nm of ["Alpha", "Beta", "Tim Uji"]) assert.deepEqual(g(nm), ["0", "0", undefined, undefined, undefined, undefined], nm);
});

test("tanpa jadwal → placeholder hari kerja pertama ≥ D (08:00–17:00), PT8H0M0S, Estimated 1, Manual 1 + SNET (M1 F2); penerus Otomatis yang dihitung mesin → tanggal mesin, Estimated 1; ringkasan ikut", () => {
  const tasks = [
    mk({ id: 1, title: "Terjadwal", start: "2026-11-02", d: 1 }),
    mk({ id: 2, title: "Kosong", deps: [[1, "FS", 0]] }), // Otomatis tanpa Mulai, simpul mesin (es = 3 Nov dari FS)
    mk({ id: 3, title: "Kosong MFO", constraint: { type: "MFO", date: "2026-11-20" } }),
    mk({ id: 4, title: "Induk" }),
    mk({ id: 5, title: "Anak kosong", parent: 4 }),
  ];
  const r = exp(tasks, { pageKind: "project" });
  const g = (nm) => {
    const t = byName(r.doc, nm);
    return [val(t, "Start"), val(t, "Finish"), val(t, "Duration"), val(t, "Estimated"), val(t, "Manual"), val(t, "ConstraintType"), val(t, "ConstraintDate"), val(t, "Milestone")];
  };
  assert.deepEqual(g("Kosong"), ["2026-11-03T08:00:00", "2026-11-03T17:00:00", "PT8H0M0S", "1", "0", "0", undefined, "0"], "simpul mesin: Otomatis di es/ef mesin, tetap perkiraan");
  assert.deepEqual(g("Kosong MFO"), ["2026-11-10T08:00:00", "2026-11-10T17:00:00", "PT8H0M0S", "1", "1", "3", "2026-11-20T17:00:00", "0"]);
  assert.deepEqual(g("Anak kosong"), ["2026-11-10T08:00:00", "2026-11-10T17:00:00", "PT8H0M0S", "1", "1", "4", "2026-11-10T08:00:00", "0"]);
  assert.deepEqual(g("Induk").slice(0, 5), ["2026-11-10T08:00:00", "2026-11-10T17:00:00", "PT8H0M0S", "0", "0"]);
  assert.equal(val(byName(r.doc, "Anak kosong"), "ManualStart"), "2026-11-10T08:00:00");
  assert.equal(val(byName(r.doc, "Kosong"), "ManualStart"), undefined);
  assert.equal(r.stats.unscheduled, 3);
  // D = Sabtu 14 Nov → placeholder Senin 16 Nov (hari kerja pertama ≥ D) + SNET di sana.
  const rs = exp(tasks, { pageKind: "project", D: D("2026-11-14") });
  assert.deepEqual([val(byName(rs.doc, "Anak kosong"), "Start"), val(byName(rs.doc, "Anak kosong"), "Finish"), val(byName(rs.doc, "Anak kosong"), "ConstraintDate")], ["2026-11-16T08:00:00", "2026-11-16T17:00:00", "2026-11-16T08:00:00"]);
  assert.equal(val(r.doc, "FinishDate"), "2026-11-10T17:00:00");
  // Tautan ke task tanpa jadwal tetap diekspor (MS Project menjaga task Manual di tempatnya).
  assert.deepEqual(linksOf(byName(r.doc, "Kosong")), [{ uid: "1", type: "1", lag: "0", fmt: "7", cross: "0" }]);
});

// ---------------------------------------------------------------- tautan

test("tautan: empat tipe FF 0 / FS 1 / SF 2 / SS 3, LinkLag = lag × 4800 (termasuk negatif), LagFormat 7, CrossProject 0", () => {
  const tasks = [
    mk({ id: 1, title: "P", start: "2026-11-02", d: 2 }),
    mk({ id: 2, title: "FF", start: "2026-11-03", d: 1, deps: [[1, "FF", 0]] }),
    mk({ id: 3, title: "FS", start: "2026-11-09", d: 1, deps: [[1, "FS", 2]] }),
    mk({ id: 4, title: "SF", start: "2026-11-02", d: 1, deps: [[1, "SF", -1]] }),
    mk({ id: 5, title: "SS", start: "2026-11-05", d: 1, deps: [[1, "SS", 3]] }),
    mk({ id: 6, title: "Tanpa tipe", start: "2026-11-05", d: 1, deps: [[1, undefined, -99]] }),
    mk({ id: 7, title: "Dua", start: "2026-11-12", d: 1, deps: [[3, "FS", 999], [1, "SS", 0]] }),
  ];
  const r = exp(tasks, { pageKind: "project" });
  const L = (nm) => linksOf(byName(r.doc, nm)).map((l) => [l.uid, l.type, l.lag, l.fmt, l.cross]);
  assert.deepEqual(L("FF"), [["1", "0", "0", "7", "0"]]);
  assert.deepEqual(L("FS"), [["1", "1", "9600", "7", "0"]]);
  assert.deepEqual(L("SF"), [["1", "2", "-4800", "7", "0"]]);
  assert.deepEqual(L("SS"), [["1", "3", "14400", "7", "0"]]);
  assert.deepEqual(L("Tanpa tipe"), [["1", "1", "-475200", "7", "0"]]);
  assert.deepEqual(L("Dua"), [["1", "3", "0", "7", "0"], ["3", "1", "4795200", "7", "0"]], "urut UID pendahulu");
  assert.equal(r.stats.links, 7);
  assert.equal(r.stats.skippedLinks, 0);
});

test("tautan dilewati (stats.skippedLinks): ke luar berkas / task tak diekspor, antaranggota lingkaran, ke diri sendiri, dan yang menyentuh ringkasan", () => {
  const tasks = [
    mk({ id: 1, title: "P", cid: "c-1", start: "2026-11-02", d: 2 }),
    mk({ id: 6, title: "Luar", start: "2026-11-03", d: 1, deps: [[999, "FS", 0]] }),
    mk({ id: 7, title: "Ke arsip", start: "2026-11-03", d: 1, deps: [[8, "FS", 0]] }),
    mk({ id: 8, title: "Arsip", gtd_status: "archived", start: "2026-11-02", d: 1 }),
    mk({ id: 9, title: "Ling A", start: "2026-11-03", d: 1, deps: [[10, "FS", 0]] }),
    mk({ id: 10, title: "Ling B", start: "2026-11-04", d: 1, deps: [[9, "FS", 0]] }),
    mk({ id: 11, title: "Diri", start: "2026-11-03", d: 1, deps: [[11, "FS", 0]] }),
    mk({ id: 12, title: "Induk" }),
    mk({ id: 13, title: "Anak", parent: 12, start: "2026-11-03", d: 1, deps: [[12, "FS", 0]] }),
    mk({ id: 14, title: "Ke induk", start: "2026-11-05", d: 1, deps: [[12, "FS", 0]] }),
    mk({ id: 15, title: "Ganda", start: "2026-11-05", d: 1, deps: [["c-1", "FS", 0], [1, "SS", 0]] }),
    mk({ id: 16, title: "Berulang", recurrence_type: "daily", start: "2026-11-02", d: 1 }),
    mk({ id: 17, title: "Ke berulang", start: "2026-11-05", d: 1, deps: [[16, "FS", 0]] }),
  ];
  const res = M.run({ tasks, cal: std(), units: autoUnits("Alpha"), readExt });
  assert.deepEqual(res.cycles, [["10", "9"], ["11"]], "fixture: lingkaran mesin");
  const r = exp(tasks, { pageKind: "project", result: res });
  for (const nm of ["Luar", "Ke arsip", "Ling A", "Ling B", "Diri", "Anak", "Ke induk", "Ke berulang"]) assert.deepEqual(linksOf(byName(r.doc, nm)), [], nm);
  // cid dan id task yang sama → satu tautan (yang pertama tersimpan: FS), tidak dihitung dilewati.
  assert.deepEqual(linksOf(byName(r.doc, "Ganda")).map((l) => [l.uid, l.type]), [["1", "1"]]);
  assert.equal(r.stats.skippedLinks, 8, "999, arsip, 2 lingkaran, diri, anak→induk, ke induk, berulang");
  assert.equal(r.stats.links, 1);
  // result null (mesin belum siap) → lingkaran tidak dikenali, tetapi tautan diri tetap dilewati.
  const r0 = exp(tasks, { pageKind: "project", result: null });
  assert.equal(r0.stats.skippedLinks, 6);
  assert.equal(r0.stats.links, 3);
});

// ---------------------------------------------------------------- baseline

test("baseline aktif → <Baseline> Number 0 (Start/Finish/Duration/Work = w × 25 menit) untuk task non-ringkasan yang dipetakan; tanpa baseline → tanpa elemen", () => {
  const tasks = [
    mk({ id: 1, title: "A", cid: "c-1", start: "2026-11-02", d: 5 }),
    mk({ id: 2, title: "M", start: "2026-11-09", d: 0 }),
    mk({ id: 3, title: "Tanpa baseline", start: "2026-11-09", d: 1 }),
    mk({ id: 4, title: "Induk" }),
    mk({ id: 5, title: "Anak", parent: 4, start: "2026-11-10", d: 1 }),
  ];
  const row = (s, f, d, w) => ({ s: D(s), f: D(f), d, w });
  const bl = {
    n: 1,
    name: "Rencana awal",
    rows: new Map([
      ["c-1", row("2026-10-26", "2026-10-30", 5, 9)], // kalah: "1" < "c-1" (cmpKey) memetakan task yang sama
      ["1", row("2026-11-02", "2026-11-06", 5, 4)],
      ["2", row("2026-11-09", "2026-11-09", 0, 0)],
      ["4", row("2026-11-02", "2026-11-02", 1, 3)], // ringkasan → diabaikan
      ["999", row("2026-11-02", "2026-11-02", 1, 3)], // task tak ada → diabaikan
      ["5", { s: D("2026-11-10"), f: D("2026-11-09"), d: 1, w: 2 }], // rusak (f < s) → diabaikan
    ]),
  };
  const before = [...bl.rows.entries()].map(([k, v]) => [k, Object.assign({}, v)]);
  const r = exp(tasks, { pageKind: "project", baseline: bl });
  const B = (nm) => kids(byName(r.doc, nm), "Baseline").map((b) => names(b).map((n) => val(b, n)));
  assert.deepEqual(B("A"), [["0", "2026-11-02T08:00:00", "2026-11-06T17:00:00", "PT40H0M0S", "PT1H40M0S"]]);
  assert.deepEqual(B("M"), [["0", "2026-11-09T08:00:00", "2026-11-09T08:00:00", "PT0H0M0S", "PT0H0M0S"]]);
  assert.deepEqual(B("Tanpa baseline"), []);
  assert.deepEqual(B("Induk"), []);
  assert.deepEqual(B("Anak"), []);
  assert.deepEqual([...bl.rows.entries()].map(([k, v]) => [k, Object.assign({}, v)]), before, "baseline tidak diubah");
  const r0 = exp(tasks, { pageKind: "project", baseline: null });
  assert.ok(!/<Baseline>/.test(r0.xml));
});

// ---------------------------------------------------------------- resource dan assignment

test("resource workspace: tiap penanggung jawab task di berkas, urut nama (cmpKey) lalu uid; nama dari people, selain itu \"Anggota #uid\"; Type 1, MaxUnits 1", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 5, est: 4, to: 3 }),
    mk({ id: 2, start: "2026-11-09", d: 1, est: 3, to: 5 }),
    mk({ id: 3, project: "Beta", start: "2026-11-02", d: 1, to: "3" }),
    mk({ id: 4, title: "Induk", to: 9 }),
    mk({ id: 5, parent: 4, start: "2026-11-02", d: 1, to: 11 }),
    mk({ id: 6, start: "2026-11-02", d: 1, to: 12, recurrence_type: "daily" }), // tidak diekspor → bukan resource
    mk({ id: 7, start: "2026-11-02", d: 1, to: "x" }), // uid tak sah
  ];
  const people = new Map([[3, "Sari"], [5, "Budi"], [11, "budi"], [12, "Rudi"]]);
  const r = exp(tasks, { people });
  const res = kids(kid(r.doc, "Resources"), "Resource").map((x) => names(x).map((n) => val(x, n)));
  assert.deepEqual(res, [
    ["1", "1", "Anggota #9", "1", "0", "1"],
    ["2", "2", "Budi", "1", "0", "1"],
    ["3", "3", "Sari", "1", "0", "1"],
    ["4", "4", "budi", "1", "0", "1"],
  ]);
  assert.equal(r.stats.resources, 4);
});

test("assignment: task non-ringkasan, terjadwal, d > 0, berpenanggung jawab → Work = target × 25 menit, Units = Work ÷ (d × 480) dibulatkan 4 desimal; Work task sama", () => {
  const tasks = [
    mk({ id: 1, title: "a", start: "2026-11-02", d: 5, est: 4, to: 3 }), // 100 menit / 2400 = 0,041666… → 0.0417
    mk({ id: 2, title: "b", start: "2026-11-09", d: 1, est: 3, to: 5 }), // 75 / 480 = 0,15625 → 0.1563 (setengah ke atas)
    mk({ id: 3, title: "c", start: "2026-11-10", d: 1, est: 99, to: "3" }), // 2475 / 480 = 5,15625 → 5.1563
    mk({ id: 4, title: "d", start: "2026-11-11", d: 999, to: 5 }), // target bawaan 1: 25 / 479520 → 0.0001
    mk({ id: 5, title: "e", start: "2026-11-12", d: 2, est: 150, to: 3 }), // dijepit 99: 2475 / 960 = 2,578125 → 2.5781
    mk({ id: 6, title: "f", start: "2026-11-12", d: 2, est: 24, to: 3 }), // 600 / 960 = 0,625 → 0.625
    mk({ id: 7, title: "g", start: "2026-11-12", d: 1, est: 96, to: 3 }), // 2400 / 480 = 5 → 5
    mk({ id: 8, title: "milestone", start: "2026-11-12", d: 0, est: 2, to: 3 }),
    mk({ id: 9, title: "tanpa pj", start: "2026-11-12", d: 1, est: 2 }),
    mk({ id: 10, title: "tanpa jadwal", est: 2, to: 3 }),
    mk({ id: 11, title: "Induk", est: 5, to: 3 }),
    mk({ id: 12, title: "anak", parent: 11, start: "2026-11-16", d: 2, est: 2, to: 5 }), // 50 / 960 → 0.0521
  ];
  const r = exp(tasks, { people: new Map([[3, "Sari"], [5, "Budi"]]) });
  const uidOf = (nm) => val(byName(r.doc, nm), "UID");
  const resUid = { Sari: "2", Budi: "1" };
  const asg = kids(kid(r.doc, "Assignments"), "Assignment").map((x) => names(x).map((n) => val(x, n)));
  const exp1 = [
    ["a", "Sari", "2026-11-06T17:00:00", "2026-11-02T08:00:00", "0.0417", "PT1H40M0S"],
    ["b", "Budi", "2026-11-09T17:00:00", "2026-11-09T08:00:00", "0.1563", "PT1H15M0S"],
    ["c", "Sari", "2026-11-10T17:00:00", "2026-11-10T08:00:00", "5.1563", "PT41H15M0S"],
    ["d", "Budi", val(byName(r.doc, "d"), "Finish"), "2026-11-11T08:00:00", "0.0001", "PT0H25M0S"],
    ["e", "Sari", "2026-11-13T17:00:00", "2026-11-12T08:00:00", "2.5781", "PT41H15M0S"],
    ["f", "Sari", "2026-11-13T17:00:00", "2026-11-12T08:00:00", "0.625", "PT10H0M0S"],
    ["g", "Sari", "2026-11-12T17:00:00", "2026-11-12T08:00:00", "5", "PT40H0M0S"],
    ["anak", "Budi", "2026-11-17T17:00:00", "2026-11-16T08:00:00", "0.0521", "PT0H50M0S"],
  ].sort((x, y) => Number(uidOf(x[0])) - Number(uidOf(y[0])));
  assert.deepEqual(asg, exp1.map((e, i) => [String(i + 1), uidOf(e[0]), resUid[e[1]], e[2], e[3], e[4], e[5]]));
  for (const e of exp1) assert.equal(val(byName(r.doc, e[0]), "Work"), e[5], "Work task " + e[0]);
  for (const nm of ["milestone", "tanpa pj", "tanpa jadwal", "Induk"]) assert.equal(val(byName(r.doc, nm), "Work"), undefined, nm);
  assert.equal(r.stats.assignments, 8);
  assert.equal(r.stats.resources, 2);
});

test("resource pribadi: satu resource pemilik (ownerUid, nama dari people) memikul semua assignment; tanpa ownerUid sah → tanpa resource", () => {
  const tasks = [
    mk({ id: 1, title: "a", start: "2026-11-02", d: 2, est: 4, to: 99 }),
    mk({ id: 2, title: "b", start: "2026-11-04", d: 1, est: 1 }),
  ];
  const r = exp(tasks, { pageKind: "project", ownerUid: "7", people: new Map([[7, "Budi"], [99, "Lain"]]) });
  assert.deepEqual(kids(kid(r.doc, "Resources"), "Resource").map((x) => [val(x, "UID"), val(x, "Name")]), [["1", "Budi"]]);
  assert.deepEqual(kids(kid(r.doc, "Assignments"), "Assignment").map((x) => [val(x, "TaskUID"), val(x, "ResourceUID"), val(x, "Work"), val(x, "Units")]), [["1", "1", "PT1H40M0S", "0.1042"], ["2", "1", "PT0H25M0S", "0.0521"]]);
  const r2 = exp(tasks, { pageKind: "project", ownerUid: 8, people: new Map() });
  assert.deepEqual(kids(kid(r2.doc, "Resources"), "Resource").map((x) => val(x, "Name")), ["Anggota #8"]);
  const r3 = exp(tasks, { pageKind: "project", people: new Map([[7, "Budi"]]) });
  assert.deepEqual(kids(kid(r3.doc, "Resources"), "Resource"), []);
  assert.deepEqual(kids(kid(r3.doc, "Assignments"), "Assignment"), []);
  assert.equal(r3.stats.resources + r3.stats.assignments, 0);
  // people boleh objek biasa {uid: nama}.
  const r4 = exp(tasks, { pageKind: "project", ownerUid: 7, people: { 7: "Budi" } });
  assert.equal(val(kid(kid(r4.doc, "Resources"), "Resource"), "Name"), "Budi");
});

// ---------------------------------------------------------------- escape

test("escape: judul/nama task/nama orang dengan & < > \" ', emoji, karakter kontrol, dan surrogate tunggal → XML sah dan teks bersih", () => {
  const dirty = `A & B <C> "D" 'E' 😀\u0001\u0007\t\uD800x\uDC00y\u007F`;
  const clean = `A & B <C> "D" 'E' 😀 xy`; // \t → spasi (M2 F2), kontrol/surrogate tunggal dibuang
  const tasks = [mk({ id: 1, title: dirty, start: "2026-11-02", d: 1, to: 3 }), mk({ id: 2, title: "</Name><Name>", project: dirty, start: "2026-11-02", d: 1 })];
  const r = exp(tasks, { title: dirty, fileName: "x.xml", people: new Map([[3, dirty]]) });
  assert.equal(val(r.doc, "Title"), clean);
  assert.equal(taskEls(r.doc).filter((t) => val(t, "Name") === clean).length, 3, "UID 0, task 1, dan kelompok project kotor");
  assert.equal(val(kid(kid(r.doc, "Resources"), "Resource"), "Name"), clean);
  assert.ok(taskEls(r.doc).some((t) => val(t, "Name") === "</Name><Name>"));
  assert.ok(r.xml.includes("A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos; 😀 xy"));
  assert.doesNotMatch(r.xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/);
  assert.doesNotMatch(r.xml, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
});

// ---------------------------------------------------------------- fileNameOf

// Disalin dari static/plugin-runtime.js saveFileInvalid (api.ui.saveFile, rencana 1d-2 R4 dikoreksi review F1):
// string; > 240 unit UTF-16 (SAVE_NAME_MAX_UNITS = SAVE_NAME_MAX × 2) ditolak sebelum Array.from; panjang 1–120 code
// point (Array.from); tanpa / \ : * ? " < > | dan karakter kontrol C0/DEL (SAVE_NAME_BAD_RE); tidak diawali titik.
// Tes berikutnya memastikan salinan ini sama dengan sumber runtime.
const SAVE_NAME_MAX = 120;
const SAVE_NAME_MAX_UNITS = SAVE_NAME_MAX * 2;
const SAVE_NAME_BAD_RE = /[\/\\:*?"<>|\u0000-\u001f\u007f]/;
const saveNameOk = (name) => typeof name === "string" && name.length <= SAVE_NAME_MAX_UNITS && Array.from(name).length >= 1 && Array.from(name).length <= SAVE_NAME_MAX && !SAVE_NAME_BAD_RE.test(name) && name.charAt(0) !== ".";

test("salinan aturan nama saveFile di tes = sumber plugin-runtime.js", () => {
  const src = fs.readFileSync(path.join(__dirname, "../../static/plugin-runtime.js"), "utf8");
  assert.ok(src.includes("const SAVE_NAME_MAX = 120;"));
  assert.ok(src.includes('const SAVE_NAME_BAD_RE = /[\\/\\\\:*?"<>|\\u0000-\\u001f\\u007f]/;'));
  assert.ok(src.includes('if (SAVE_NAME_BAD_RE.test(name) || name.charAt(0) === ".")'));
  assert.ok(src.includes("const len = Array.from(name).length;"));
  assert.ok(src.includes("const SAVE_NAME_MAX_UNITS = SAVE_NAME_MAX * 2;"));
  assert.ok(src.includes("if (name.length > SAVE_NAME_MAX_UNITS) return"));
});

test("fileNameOf: karakter tak aman/kontrol/spasi → satu \"-\", titik/\"-\" di ujung dibuang, potong 80 code point (sadar surrogate), + \"-YYYY-MM-DD.xml\"", () => {
  const d = D("2026-11-10");
  assert.equal(X.fileNameOf("Tim Pemasaran", d), "Tim-Pemasaran-2026-11-10.xml");
  assert.equal(X.fileNameOf('a/b\\c:d*e?f"g<h>i|j', d), "a-b-c-d-e-f-g-h-i-j-2026-11-10.xml");
  assert.equal(X.fileNameOf("  ..Rahasia..  ", d), "Rahasia-2026-11-10.xml");
  assert.equal(X.fileNameOf("A  -  B\t\nC", d), "A-B-C-2026-11-10.xml");
  assert.equal(X.fileNameOf("x\u0001\u007f\u0085y", d), "x-y-2026-11-10.xml");
  assert.equal(X.fileNameOf("a\uD800b\uDC00c", d), "a-b-c-2026-11-10.xml", "surrogate tunggal → -");
  assert.equal(X.fileNameOf("Proyek 😀 Baru", d), "Proyek-😀-Baru-2026-11-10.xml");
  assert.equal(X.fileNameOf("evil\u202elmx.exe", d), "evil-lmx.exe-2026-11-10.xml", "kontrol arah teks → -");
  assert.equal(X.fileNameOf("a\u061cb\u200bc\u2066d\ufeffe", d), "a-b-c-d-e-2026-11-10.xml", "U+061C, ZWSP, isolat, BOM → -");
  for (const t of ["", "   ", "...", "-.-", "\u0000", undefined, null, 42]) assert.equal(X.fileNameOf(t, d), "Timeline-2026-11-10.xml", JSON.stringify(t));
  assert.equal(X.fileNameOf("x".repeat(500), d), "x".repeat(80) + "-2026-11-10.xml");
  // potong 80 code point: emoji ke-80 utuh, emoji ke-81 dibuang (tidak pernah setengah pasangan surrogate)
  assert.equal(X.fileNameOf("a".repeat(79) + "😀😀", d), "a".repeat(79) + "😀-2026-11-10.xml");
  // potongan yang berakhir dengan "-"/"." dibersihkan lagi
  assert.equal(X.fileNameOf("a".repeat(79) + " b", d), "a".repeat(79) + "-2026-11-10.xml");
  assert.equal(X.fileNameOf("Tim", "bukan"), "Tim.xml", "D tak sah → tanpa tanggal");
  assert.equal(X.fileNameOf("Tim", D("2027-01-05")), "Tim-2027-01-05.xml");
});

test("fileNameOf properti: 200 judul acak (LCG berbenih: emoji, kontrol, surrogate tunggal, titik, kosong, ≤ 500 karakter) → semua lolos validasi saveFile", () => {
  const pool = ["a", "Z", "5", " ", "  ", ".", "..", "-", "/", "\\", ":", "*", "?", '"', "<", ">", "|", "\t", "\n", "\r", "\u0000", "\u0001", "\u001f", "\u007f", "\u0085", "\u00a0", "\u2028", "\u202e", "\ufeff", "\u061c", "\u200b", "\u2067", "😀", "👨\u200d👩\u200d👧", "\ud800", "\udc00", "漢", "é", "é", "&", "'", "%", "~"];
  const rnd = lcg(20261110);
  const titles = ["", ".", "...", " . ", "\u0000", "😀".repeat(500), ".hidden", "-", "\ud83d"];
  while (titles.length < 200) {
    const n = Math.floor(rnd() * 501);
    let s = "";
    for (let i = 0; i < n && s.length < 500; i++) s += pool[Math.floor(rnd() * pool.length)];
    titles.push(s.slice(0, 500));
  }
  const days = [D("2026-11-10"), D("1999-12-31"), D("2199-12-31")];
  for (let i = 0; i < titles.length; i++) {
    const nm = X.fileNameOf(titles[i], days[i % 3]);
    assert.ok(saveNameOk(nm), "judul #" + i + " " + JSON.stringify(titles[i].slice(0, 40)) + " → " + JSON.stringify(nm));
    assert.ok(nm.endsWith(".xml"));
    assert.doesNotMatch(nm, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/, "tanpa surrogate tunggal");
    assert.doesNotMatch(nm, /\s/, "tanpa spasi");
    assert.ok(Array.from(nm).length <= 80 + 15);
  }
});

// ---------------------------------------------------------------- determinisme, kemurnian, masukan

function sample() {
  return [
    mk({ id: 1, title: "Desain", start: "2026-11-02", d: 5, est: 4, to: 3, progress: 40 }),
    mk({ id: 2, title: "Bangun", start: "2026-11-09", d: 3, deps: [[1, "FS", 1]], est: 6, to: 5 }),
    mk({ id: 3, title: "Rilis", start: "2026-11-13", d: 0, deps: [[2, "FF", 0]], to: 3 }),
    mk({ id: 4, title: "Rapat", project: "Beta", start: "2026-11-03", d: 1, constraint: { type: "MFO", date: "2026-11-03" }, to: 7 }),
    mk({ id: 5, title: "Induk", project: "Beta" }),
    mk({ id: 6, title: "Anak", project: "Beta", parent: 5, start: "2026-11-04", d: 2, est: 2, to: 5 }),
    mk({ id: 7, title: "Kosong", project: "Beta", to: 3 }),
    mk({ id: 8, title: "Ling A", start: "2026-11-03", d: 1, deps: [[9, "SS", 0]] }),
    mk({ id: 9, title: "Ling B", start: "2026-11-04", d: 1, deps: [[8, "SF", -2]] }),
    mk({ id: 10, title: "Lepas", project: "", start: "2026-11-24", d: 2, deps: [[4, "SS", 1]], to: 11 }),
  ];
}
const sampleBl = () => ({ rows: new Map([["1", { s: D("2026-11-02"), f: D("2026-11-06"), d: 5, w: 4 }], ["6", { s: D("2026-11-04"), f: D("2026-11-05"), d: 2, w: 2 }]]) });
const samplePeople = () => new Map([[3, "Sari"], [5, "Budi"], [7, "Andi"]]);

test("determinisme: dua build identik; 50 permutasi tasks dan urutan people → XML identik", () => {
  const tasks = sample();
  const ref = exp(tasks, { baseline: sampleBl(), people: samplePeople() });
  assert.equal(exp(tasks, { baseline: sampleBl(), people: samplePeople() }).xml, ref.xml);
  assert.deepEqual(ref.stats, { tasks: 13, links: 3, skippedLinks: 2, unscheduled: 1, resources: 4, assignments: 5 });
  const rnd = lcg(777);
  for (let p = 0; p < 50; p++) {
    const arr = tasks.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const ppl = [...samplePeople().entries()];
    if (p % 2) ppl.reverse();
    assert.equal(exp(arr, { baseline: sampleBl(), people: new Map(ppl) }).xml, ref.xml, "permutasi " + p);
  }
});

test("murni: masukan tidak diubah; D tak sah → TypeError; masukan kosong → XML sah dengan UID 0 saja", () => {
  const tasks = sample();
  const before = JSON.stringify(tasks);
  const people = samplePeople();
  exp(tasks, { baseline: sampleBl(), people });
  assert.equal(JSON.stringify(tasks), before);
  assert.deepEqual([...people.entries()], [...samplePeople().entries()]);
  assert.throws(() => X.build({ tasks, cal: std(), readExt, D: null }), TypeError);
  assert.throws(() => X.build({ tasks, cal: std(), readExt, D: 1.5 }), TypeError);
  const r = exp([], { title: "" });
  assert.deepEqual(taskEls(r.doc).map((t) => [val(t, "UID"), val(t, "Name"), val(t, "Start"), val(t, "Finish")]), [["0", "Timeline", "2026-11-10T08:00:00", "2026-11-10T17:00:00"]]);
  assert.equal(val(r.doc, "Title"), "Timeline");
  assert.deepEqual(r.stats, { tasks: 0, links: 0, skippedLinks: 0, unscheduled: 0, resources: 0, assignments: 0 });
  // readExt yang melempar → task dianggap tanpa ext (tanpa jadwal), build tidak melempar.
  const bad = X.build({ tasks: [mk({ id: 1, start: "2026-11-02", d: 1 })], cal: std(), readExt: () => { throw new Error("x"); }, pageKind: "project", title: "t", D: D0 });
  assert.equal(bad.stats.unscheduled, 1);
});

// ---------------------------------------------------------------- review F2: kalender, tautan, jangkar, milestone, nama

test("C1 F2: blok <Exceptions> gaya 2007 setelah </WeekDays> = pengecualian DayType 0 yang sama (bentuk MSPDIWriter MPXJ), nama SKB bila ada", () => {
  const cal = C.compile({ weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [{ d: "2026-11-18", n: "Rapat" }], work: [{ d: "2026-11-21" }] });
  const r = exp([mk({ id: 1, start: "2026-11-16", d: 10 })], { cal });
  const c = kid(kid(r.doc, "Calendars"), "Calendar");
  assert.deepEqual(names(c), CALENDAR_ORDER);
  const ex = kids(kid(c, "Exceptions"), "Exception");
  const got = ex.map((x) => {
    const tp = kid(x, "TimePeriod");
    const wt = kid(x, "WorkingTimes");
    return { from: val(tp, "FromDate"), to: val(tp, "ToDate"), working: val(x, "DayWorking"), times: wt ? kids(wt, "WorkingTime").map((y) => val(y, "FromTime") + "-" + val(y, "ToTime")).join(",") : null };
  });
  assert.deepEqual(got, exceptions(r.doc), "Exceptions = WeekDay DayType 0 (rentang, jenis, jam)");
  assert.deepEqual(got.map((x) => x.from.slice(0, 10) + ".." + x.to.slice(0, 10) + ":" + x.working), ["2026-11-18..2026-11-18:0", "2026-11-21..2026-11-21:1", "2026-12-24..2026-12-25:0"]);
  for (const x of ex) {
    assertOrder(x, EXCEPTION_ORDER, "Exception");
    assert.deepEqual([val(x, "EnteredByOccurrences"), val(x, "Occurrences"), val(x, "Type")], ["0", "1", "1"]);
    assert.ok(val(kid(x, "TimePeriod"), "ToDate").endsWith("T23:59:00"));
  }
  assert.deepEqual(ex.map((x) => val(x, "Name")), [undefined, undefined, "Kelahiran Yesus Kristus"], "libur tambahan/hari pengganti tanpa nama; SKB bernama");
  // Nama unik digabung " / " (Nyepi cuti 18 + libur 19 + Idulfitri cuti 20 Maret 2026 berurutan).
  const r2 = exp([mk({ id: 1, start: "2026-03-16", d: 3 })]);
  const ex2 = kids(kid(kid(kid(r2.doc, "Calendars"), "Calendar"), "Exceptions"), "Exception").map((x) => [val(kid(x, "TimePeriod"), "FromDate").slice(0, 10), val(kid(x, "TimePeriod"), "ToDate").slice(0, 10), val(x, "Name")]);
  assert.deepEqual(ex2, [
    ["2026-03-18", "2026-03-20", "Hari Suci Nyepi (Tahun Baru Saka 1948) / Idulfitri 1447 H"],
    ["2026-03-23", "2026-03-24", "Idulfitri 1447 H"],
    ["2026-04-03", "2026-04-03", "Wafat Yesus Kristus"],
  ]);
  // Tanpa pengecualian → tanpa blok <Exceptions>.
  const r3 = exp([mk({ id: 1, start: "2026-11-02", d: 1 })], { cal: C.compile({ weekdays: [1, 2, 3, 4, 5], national: false, cutiBersama: false }) });
  assert.deepEqual(names(kid(kid(r3.doc, "Calendars"), "Calendar")), ["UID", "Name", "IsBaseCalendar", "BaseCalendarUID", "WeekDays"]);
});

test("I1 F2: tautan = sisi result.pred saja — pendahulu tanpa jadwal (notNode) dan lintas scope dihitung skippedLinks; penerusnya akar → SNET di es", () => {
  // Halaman project pribadi (list_id null): project Alpha dan Beta = scope berbeda (TLSched.scopeKeyOf "p:<lipatan>").
  const units = new Map([[S.unitOf({ list_id: null, project: "Alpha" }).recId, { auto: true }]]);
  const tasks = [
    mk({ id: 1, list_id: null }), // tanpa Mulai, tanpa pendahulu → bukan simpul
    mk({ id: 2, list_id: null, start: "2026-11-16", d: 2, deps: [[1, "FS", 0]] }), // E2
    mk({ id: 3, list_id: null, project: "Beta", start: "2026-11-02", d: 1 }),
    mk({ id: 4, list_id: null, start: "2026-11-04", d: 1, deps: [[3, "FS", 0]] }), // lintas scope
    mk({ id: 5, list_id: null, start: "2026-11-05", d: 1, deps: [[4, "FS", 0]] }),
  ];
  const res = M.run({ tasks, cal: std(), units, readExt });
  assert.deepEqual(res.ignored.map((x) => [x.from, x.to, x.reason]), [["1", "2", "notNode"], ["3", "4", "scope"]], "fixture: alasan mesin");
  const r = exp(tasks, { pageKind: "project", units, result: res });
  const g = (nm) => [linksOf(byName(r.doc, nm)).length, val(byName(r.doc, nm), "ConstraintType"), val(byName(r.doc, nm), "ConstraintDate")];
  assert.deepEqual(g("T2"), [0, "4", "2026-11-16T08:00:00"]);
  assert.deepEqual(g("T4"), [0, "4", "2026-11-04T08:00:00"]);
  assert.deepEqual(g("T5"), [1, "0", undefined]);
  assert.deepEqual([r.stats.links, r.stats.skippedLinks], [1, 2]);
});

test("I1 F2 (E1): akar Otomatis dengan SNET eksplisit lebih awal dari mulai tersimpan → SNET di es mesin (mulai tersimpan)", () => {
  const tasks = [mk({ id: 1, start: "2026-11-16", d: 2, constraint: { type: "SNET", date: "2026-11-02" } }), mk({ id: 2, start: "2026-11-02", d: 1, constraint: { type: "SNET", date: "2026-11-07" } })];
  const r = exp(tasks, { pageKind: "project" });
  assert.deepEqual([val(byName(r.doc, "T1"), "ConstraintType"), val(byName(r.doc, "T1"), "ConstraintDate"), val(byName(r.doc, "T1"), "Start")], ["4", "2026-11-16T08:00:00", "2026-11-16T08:00:00"]);
  // SNET eksplisit lebih lambat (Sabtu 7 Nov) → es mesin = hari kerja berikut (Senin 9 Nov).
  assert.deepEqual([val(byName(r.doc, "T2"), "ConstraintDate"), val(byName(r.doc, "T2"), "Start")], ["2026-11-09T08:00:00", "2026-11-09T08:00:00"]);
});

test("I2 F2: task tetap mesin — selesai: Start/ActualStart = es, Finish/ActualFinish = ef; berjalan es ≤ D: ActualStart + Finish = ef; berjalan es > D: SNET/MSO tanpa aktual; lingkaran: SNET, MSO bila bertautan masuk", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-09", d: 5 }),
    mk({ id: 2, start: "2026-11-04", d: 2, deps: [[1, "FS", 0]], done: true, completed_at: "2026-11-06T03:00:00Z" }), // E3: selesai molor
    mk({ id: 3, start: "2026-11-05", d: 3, deps: [[1, "FS", 0]], progress: 30 }), // E3: berjalan, es ≤ D
    mk({ id: 4, start: "2026-11-10", d: 1, deps: [[2, "FS", 0]] }), // E3: penerus task selesai
    mk({ id: 5, start: "2026-11-12", d: 2, deps: [[1, "FS", 0]], actual: { start: "2026-11-12" } }), // berjalan es > D, bertautan
    mk({ id: 6, start: "2026-11-13", d: 1, progress: 10 }), // berjalan es > D, tanpa tautan
    mk({ id: 7, start: "2026-11-02", d: 5 }), // E5
    mk({ id: 8, start: "2026-11-03", d: 1, deps: [[9, "FS", 0], [7, "FS", 0]] }),
    mk({ id: 9, start: "2026-11-04", d: 1, deps: [[8, "FS", 0]] }),
  ];
  const res = M.run({ tasks, cal: std(), units: autoUnits("Alpha"), readExt });
  assert.deepEqual(["2", "3", "5", "6", "8", "9"].map((k) => res.nodes.get(k).fixed), ["done", "started", "started", "started", "cycle", "cycle"]);
  const r = exp(tasks, { pageKind: "project", result: res });
  const F = ["Start", "Finish", "Duration", "ActualStart", "ActualFinish", "ConstraintType", "ConstraintDate", "Manual"];
  const g = (nm) => F.map((k) => val(byName(r.doc, nm), k));
  assert.deepEqual(g("T2"), ["2026-11-04T08:00:00", "2026-11-06T17:00:00", "PT24H0M0S", "2026-11-04T08:00:00", "2026-11-06T17:00:00", "4", "2026-11-04T08:00:00", "0"]);
  assert.deepEqual(g("T3"), ["2026-11-05T08:00:00", "2026-11-09T17:00:00", "PT24H0M0S", "2026-11-05T08:00:00", undefined, "4", "2026-11-05T08:00:00", "0"]);
  assert.deepEqual(g("T4"), ["2026-11-09T08:00:00", "2026-11-09T17:00:00", "PT8H0M0S", undefined, undefined, "0", undefined, "0"]);
  assert.deepEqual(g("T5"), ["2026-11-12T08:00:00", "2026-11-13T17:00:00", "PT16H0M0S", undefined, undefined, "2", "2026-11-12T08:00:00", "0"]);
  assert.deepEqual(g("T6"), ["2026-11-13T08:00:00", "2026-11-13T17:00:00", "PT8H0M0S", undefined, undefined, "4", "2026-11-13T08:00:00", "0"]);
  assert.deepEqual(g("T8"), ["2026-11-03T08:00:00", "2026-11-03T17:00:00", "PT8H0M0S", undefined, undefined, "2", "2026-11-03T08:00:00", "0"]);
  assert.deepEqual(g("T9"), ["2026-11-04T08:00:00", "2026-11-04T17:00:00", "PT8H0M0S", undefined, undefined, "4", "2026-11-04T08:00:00", "0"]);
  assert.deepEqual(linksOf(byName(r.doc, "T8")).map((l) => l.uid), [val(byName(r.doc, "T7"), "UID")], "tautan dalam lingkaran dilewati, dari luar diekspor");
  assert.equal(val(byName(r.doc, "T2"), "PercentComplete"), "100");
});

test("I3 F2: milestone di rantai — milestone Otomatis berpendahulu SNET di es (MSO bila tautan masuk FF/SF), penerus langsung milestone SNET di es, MFO milestone 08:00", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 3 }),
    mk({ id: 2, start: "2026-11-05", d: 0, deps: [[1, "FS", 0]] }), // E4
    mk({ id: 3, start: "2026-11-06", d: 1, deps: [[2, "FS", 0]] }), // E4
    mk({ id: 4, start: "2026-11-04", d: 0, deps: [[1, "FF", 0]] }),
    mk({ id: 5, start: "2026-11-27", d: 0, constraint: { type: "MFO", date: "2026-11-27" } }),
    mk({ id: 6, start: "2026-11-09", d: 1, deps: [[3, "FS", 0]] }), // bukan penerus milestone → ASAP
  ];
  const r = exp(tasks, { pageKind: "project" });
  const g = (nm) => [val(byName(r.doc, nm), "Start"), val(byName(r.doc, nm), "ConstraintType"), val(byName(r.doc, nm), "ConstraintDate")];
  assert.deepEqual(g("T2"), ["2026-11-05T08:00:00", "4", "2026-11-05T08:00:00"]);
  assert.deepEqual(g("T3"), ["2026-11-06T08:00:00", "4", "2026-11-06T08:00:00"]);
  assert.deepEqual(g("T4"), ["2026-11-04T08:00:00", "2", "2026-11-04T08:00:00"]);
  assert.deepEqual(g("T5"), ["2026-11-27T08:00:00", "3", "2026-11-27T08:00:00"]);
  assert.deepEqual(g("T6"), ["2026-11-09T08:00:00", "0", undefined]);
});

test("M2 F2: nama task/resource/judul/kelompok — \\t \\r \\n → spasi, dipotong 255 code point (pasangan surrogate utuh)", () => {
  const long = "a".repeat(254) + "😀😀";
  const tasks = [mk({ id: 1, title: "Baris\nkedua\r\tketiga", start: "2026-11-02", d: 1, to: 3 }), mk({ id: 2, title: "b".repeat(300), project: "Proyek\nBaru", start: "2026-11-02", d: 1 }), mk({ id: 3, title: long, start: "2026-11-02", d: 1 })];
  const r = exp(tasks, { title: "Judul\tsatu", people: new Map([[3, "Sari\nWulan"]]) });
  assert.equal(val(r.doc, "Title"), "Judul satu");
  assert.equal(val(byName(r.doc, "Judul satu"), "UID"), "0");
  assert.ok(taskEls(r.doc).some((t) => val(t, "Name") === "Baris kedua  ketiga"));
  assert.ok(taskEls(r.doc).some((t) => val(t, "Name") === "b".repeat(255)));
  assert.ok(taskEls(r.doc).some((t) => val(t, "Name") === "a".repeat(254) + "😀"));
  assert.ok(taskEls(r.doc).some((t) => val(t, "Name") === "Proyek Baru"), "kelompok");
  assert.equal(val(kid(kid(r.doc, "Resources"), "Resource"), "Name"), "Sari Wulan");
});

test("I5 F2: sumber mspdi.js dan berkas tes ini tanpa karakter bidi/format mentah (U+061C, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF)", () => {
  const BAD = /[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
  for (const f of [path.join(dir, "mspdi.js"), __filename]) assert.doesNotMatch(fs.readFileSync(f, "utf8"), BAD, f);
});

// ---------------------------------------------------------------- paritas mesin ↔ "MS Project sederhana" (review F2)
// Simulator ini PENDEKATAN aturan penjadwalan maju MS Project, BUKAN MS Project. Kalender = <WeekDays> + <Exceptions>
// berkas dengan jam 08:00–12:00 + 13:00–17:00; waktu = menit absolut (tanggal × 1440 + menit). Aturan yang ditiru:
//  - Manual 1 → Start/Finish berkas apa adanya; ActualStart → mulai tetap, selesai = ActualFinish atau mulai + durasi;
//  - HonorConstraints 1: MSO → mulai = tanggal kendala; MFO → selesai = jam kerja terakhir ≤ tanggal kendala;
//  - selain itu ES = maks(syarat tautan, SNET); tanpa keduanya = StartDate project. FS: selesai P + lag; SS: mulai P +
//    lag; FF: (selesai P + lag) − durasi; SF: (mulai P + lag) − durasi; lag = LinkLag ÷ 10 menit kerja;
//  - task berdurasi mulai di saat kerja berikutnya (17:00 → 08:00 hari kerja berikut); milestone tetap di jamnya;
//    selesai = mulai + durasi menit kerja.
// Tanggal hasil (tanggal kalender instan mulai/selesai) dibandingkan dengan es/ef TLCpm.run.
function simMsp(doc) {
  const calEl = kid(kid(doc, "Calendars"), "Calendar");
  const week = new Map();
  for (const w of kids(kid(calEl, "WeekDays"), "WeekDay")) if (val(w, "DayType") !== "0") week.set(Number(val(w, "DayType")), val(w, "DayWorking") === "1");
  const exc = new Map();
  const exEl = kid(calEl, "Exceptions");
  for (const x of exEl ? kids(exEl, "Exception") : []) {
    const tp = kid(x, "TimePeriod");
    for (let d = D(val(tp, "FromDate").slice(0, 10)), e = D(val(tp, "ToDate").slice(0, 10)); d <= e; d++) exc.set(d, val(x, "DayWorking") === "1");
  }
  const working = (d) => (exc.has(d) ? exc.get(d) : week.get(C.isoWeekday(d) === 7 ? 1 : C.isoWeekday(d) + 1) === true);
  const PER = [
    [480, 720],
    [780, 1020],
  ];
  // Saat paling awal ketika m menit kerja (bertanda) selesai dihitung dari t.
  function add(t, m) {
    if (m === 0) return t;
    let d = Math.floor(t / 1440);
    let cur = t - d * 1440;
    if (m > 0) {
      for (let i = 0; i < 5000; i++, d++, cur = 0) {
        if (!working(d)) continue;
        for (const [a, b] of PER) {
          if (b <= cur) continue;
          const s0 = Math.max(a, cur);
          if (m <= b - s0) return d * 1440 + s0 + m;
          m -= b - s0;
        }
      }
    } else {
      m = -m;
      for (let i = 0; i < 5000; i++, d--, cur = 1440) {
        if (!working(d)) continue;
        for (let j = PER.length - 1; j >= 0; j--) {
          const [a, b] = PER[j];
          if (a >= cur) continue;
          const e0 = Math.min(b, cur);
          if (m <= e0 - a) return d * 1440 + e0 - m;
          m -= e0 - a;
        }
      }
    }
    throw new Error("simulator: kalender buntu");
  }
  const ns = (t) => add(t, 1) - 1; // saat kerja berikutnya ≥ t
  const pe = (t) => add(t, -1) + 1; // akhir kerja terakhir ≤ t
  const at = (s) => D(s.slice(0, 10)) * 1440 + Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  const minutes = (pt) => {
    const m = /^PT(\d+)H(\d+)M0S$/.exec(pt);
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const honor = val(doc, "HonorConstraints") === "1";
  const projStart = at(val(doc, "StartDate"));
  const els = taskEls(doc).filter((t) => val(t, "Summary") === "0");
  const byUid = new Map(els.map((t) => [val(t, "UID"), t]));
  const memo = new Map();
  function sch(t) {
    const uid = val(t, "UID");
    if (memo.has(uid)) {
      const m = memo.get(uid);
      if (m === null) throw new Error("simulator: lingkaran tautan di berkas (UID " + uid + ")");
      return m;
    }
    memo.set(uid, null);
    const dur = minutes(val(t, "Duration"));
    const ms = val(t, "Milestone") === "1";
    let s;
    let f;
    let raw = false;
    if (val(t, "Manual") === "1") {
      s = at(val(t, "Start"));
      f = at(val(t, "Finish"));
      raw = true;
    } else if (kid(t, "ActualStart")) {
      s = at(val(t, "ActualStart"));
      f = kid(t, "ActualFinish") ? at(val(t, "ActualFinish")) : add(s, dur);
      raw = true;
    } else {
      const ct = val(t, "ConstraintType");
      const cd = kid(t, "ConstraintDate") ? at(val(t, "ConstraintDate")) : null;
      if (honor && ct === "2") s = ms ? cd : ns(cd);
      else if (honor && ct === "3") {
        f = ms ? cd : pe(cd);
        s = add(f, -dur);
      } else {
        let es = null;
        for (const l of kids(t, "PredecessorLink")) {
          const pt = byUid.get(val(l, "PredecessorUID"));
          assert.ok(pt, "pendahulu UID " + val(l, "PredecessorUID") + " ada dan bukan ringkasan");
          const p = sch(pt);
          const lag = Number(val(l, "LinkLag")) / 10;
          const ty = val(l, "Type");
          const req = ty === "1" ? add(p.f, lag) : ty === "3" ? add(p.s, lag) : ty === "0" ? add(add(p.f, lag), -dur) : add(add(p.s, lag), -dur);
          if (es === null || req > es) es = req;
        }
        if (ct === "4" && (es === null || cd > es)) es = cd;
        if (es === null) es = projStart;
        s = ms ? es : ns(es);
      }
      if (f === undefined) f = add(s, dur);
    }
    const out = { s, f, raw, start: I(Math.floor(s / 1440)), finish: I(Math.floor(f / 1440)) };
    memo.set(uid, out);
    return out;
  }
  const res = new Map();
  for (const t of els) res.set(val(t, "UID"), sch(t));
  return res;
}

// Bangun + simulasikan; baris = task non-ringkasan yang simpul mesin terhitung. Mulai non-milestone tanpa aktual/Manual
// dibandingkan setelah dijepret ke hari kerja (MS Project tidak memulai task berdurasi Otomatis di hari libur, mesin
// menyimpan mulai task tetap — lingkaran/berjalan — apa adanya).
function parity(tasks, o = {}) {
  const cal = o.cal || std();
  const units = o.units || autoUnits("Alpha");
  const result = M.run({ tasks, cal, units, readExt });
  const out = X.build({ tasks, cal, readExt, result, units, pageKind: o.pageKind || "project", title: "Paritas", people: new Map(), baseline: null, D: o.D === undefined ? D0 : o.D });
  const doc = parseXml(out.xml);
  const sim = simMsp(doc);
  const keyOf = new Map(tasks.map((t) => [t.title, String(t.id)]));
  const rows = [];
  for (const t of taskEls(doc)) {
    if (val(t, "Summary") === "1") continue;
    const key = keyOf.get(val(t, "Name"));
    const n = key === undefined ? undefined : result.nodes.get(key);
    if (!n || !Number.isInteger(n.es) || !Number.isInteger(n.ef)) continue;
    const s = sim.get(val(t, "UID"));
    const ms = val(t, "Milestone") === "1";
    const es = ms || s.raw ? n.es : C.nextWork(cal, n.es);
    rows.push({ key, ms, kind: n.fixed || n.driver.kind, sim: s.start + ".." + s.finish, eng: I(es) + ".." + I(n.ef) });
  }
  return { rows, result, doc, out, sim, bad: rows.filter((r) => r.sim !== r.eng) };
}

test("paritas E1–E5 (kasus review): tanggal simulator MS Project = es/ef mesin", () => {
  const cases = {
    E1: [mk({ id: 1, start: "2026-11-16", d: 2, constraint: { type: "SNET", date: "2026-11-02" } })],
    E2: [mk({ id: 1 }), mk({ id: 2, start: "2026-11-16", d: 2, deps: [[1, "FS", 0]] })],
    E3: [
      mk({ id: 1, start: "2026-11-09", d: 5 }),
      mk({ id: 2, start: "2026-11-04", d: 2, deps: [[1, "FS", 0]], done: true, completed_at: "2026-11-06T03:00:00Z" }),
      mk({ id: 3, start: "2026-11-05", d: 3, deps: [[1, "FS", 0]], progress: 30 }),
      mk({ id: 4, start: "2026-11-10", d: 1, deps: [[2, "FS", 0]] }),
    ],
    E4: [mk({ id: 1, start: "2026-11-02", d: 3 }), mk({ id: 2, start: "2026-11-05", d: 0, deps: [[1, "FS", 0]] }), mk({ id: 3, start: "2026-11-06", d: 1, deps: [[2, "FS", 0]] })],
    E5: [mk({ id: 1, start: "2026-11-02", d: 5 }), mk({ id: 2, start: "2026-11-03", d: 1, deps: [[3, "FS", 0], [1, "FS", 0]] }), mk({ id: 3, start: "2026-11-04", d: 1, deps: [[2, "FS", 0]] })],
  };
  const want = { E1: 1, E2: 1, E3: 4, E4: 3, E5: 3 };
  for (const [k, tasks] of Object.entries(cases)) {
    const p = parity(tasks);
    assert.equal(p.rows.length, want[k], k + " jumlah baris dibandingkan");
    assert.deepEqual(p.bad, [], k);
  }
  // Simulator bukan tautologi: tanpa SNET jangkar milestone (E4, ekspor sebelum F2) tanggalnya berbeda dari mesin.
  const p4 = parity(cases.E4);
  for (const t of taskEls(p4.doc)) {
    if (val(t, "Summary") === "1" || !kids(t, "PredecessorLink").length) continue;
    kid(t, "ConstraintType").text = "0";
    t.kids = t.kids.filter((x) => x.name !== "ConstraintDate");
  }
  const s4 = simMsp(p4.doc);
  const sim4 = (nm) => s4.get(val(byName(p4.doc, nm), "UID"));
  assert.deepEqual([sim4("T2").start, sim4("T3").start], ["2026-11-04", "2026-11-05"], "MS Project tanpa jangkar: milestone di 17:00 pendahulu, penerus hari yang sama");
});

test("paritas milestone di tengah rantai: keluar FS/SS/FF/SF (+ lag), masuk FS/SS/FF/SF, MFO milestone, milestone akhir pekan", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-02", d: 3 }),
    mk({ id: 2, start: "2026-11-05", d: 0, deps: [[1, "FS", 0]] }),
    mk({ id: 3, start: "2026-11-06", d: 2, deps: [[2, "FS", 1]] }),
    mk({ id: 4, start: "2026-11-06", d: 2, deps: [[2, "SS", 1]] }),
    mk({ id: 5, start: "2026-11-04", d: 2, deps: [[2, "FF", 0]] }),
    mk({ id: 6, start: "2026-11-03", d: 2, deps: [[2, "SF", 0]] }),
    mk({ id: 7, start: "2026-11-04", d: 0, deps: [[1, "FF", 0]] }),
    mk({ id: 8, start: "2026-11-04", d: 1, deps: [[7, "SS", 0]] }),
    mk({ id: 9, start: "2026-11-02", d: 0, deps: [[1, "SF", 0]] }),
    mk({ id: 10, start: "2026-11-02", d: 0, deps: [[1, "SS", 2]] }),
    mk({ id: 11, start: "2026-11-09", d: 1, deps: [[10, "FS", -1]] }),
    mk({ id: 12, start: "2026-11-14", d: 0, constraint: { type: "MFO", date: "2026-11-13" } }),
    mk({ id: 13, start: "2026-11-13", d: 2, deps: [[12, "SS", 0]] }),
    mk({ id: 14, start: "2026-11-13", d: 2, deps: [[12, "FS", 0]] }),
    mk({ id: 15, start: "2026-11-21", d: 0 }), // milestone akar Sabtu
    mk({ id: 16, start: "2026-11-23", d: 1, deps: [[15, "FS", 0]] }),
    mk({ id: 17, start: "2026-11-23", d: 2, deps: [[15, "FF", 1]] }),
    mk({ id: 18, start: "2026-11-24", d: 0, deps: [[16, "FS", 0], [17, "SS", 0]] }),
    mk({ id: 19, start: "2026-11-25", d: 3, deps: [[18, "SF", 2]] }),
  ];
  const p = parity(tasks);
  assert.equal(p.rows.length, 19);
  assert.deepEqual(p.bad, []);
  assert.deepEqual(["T7", "T9"].map((nm) => val(byName(p.doc, nm), "ConstraintType")), ["2", "2"], "milestone bertautan masuk FF/SF → MSO");
});

test("paritas pendahulu yang selesai di hari non-kerja (task selesai Sabtu): penerus FF lag 0/−2, FS −1, SS, SF → SNET di es bila perlu, tanggal = mesin", () => {
  const tasks = [
    mk({ id: 1, start: "2026-11-14", d: 5, done: true }), // selesai: mulai tersimpan Sabtu, completed_at lebih awal → es = ef = Sabtu 14 Nov
    mk({ id: 2, start: "2026-11-20", d: 3, deps: [[1, "FF", -2]] }),
    mk({ id: 3, start: "2026-11-20", d: 2, deps: [[1, "FF", 0]] }),
    mk({ id: 4, start: "2026-11-20", d: 2, deps: [[1, "FS", -1]] }),
    mk({ id: 5, start: "2026-11-20", d: 2, deps: [[1, "SS", 0]] }),
    mk({ id: 6, start: "2026-11-20", d: 2, deps: [[1, "SF", 1]] }),
    mk({ id: 7, start: "2026-11-20", d: 1, actual: { start: "2026-11-07", finish: "2026-11-08" }, done: true }), // aktual Sab–Min
    mk({ id: 8, start: "2026-11-20", d: 2, deps: [[7, "FF", -1]] }),
  ];
  const p = parity(tasks);
  assert.equal(I(p.result.nodes.get("1").ef), "2026-11-14");
  assert.equal(p.rows.length, 8);
  assert.deepEqual(p.bad, []);
  assert.deepEqual(["T2", "T3", "T8"].map((nm) => val(byName(p.doc, nm), "ConstraintType")), ["4", "4", "4"]);
});

test("paritas sapuan kecil: 12 benih × halaman workspace/project, fixture campuran → nol selisih", () => {
  let rows = 0;
  for (let k = 1; k <= 12; k++) {
    for (const pageKind of ["workspace", "project"]) {
      const p = parity(genMix(120, 160, k * 7919), { pageKind, cal: mixCal() });
      rows += p.rows.length;
      assert.deepEqual(p.bad, [], "benih " + k + " " + pageKind);
    }
  }
  assert.ok(rows > 2500, "baris " + rows);
});

// Fixture campuran representatif (LCG berbenih): Alpha Otomatis + Beta Manual, kalender SKB + libur tambahan + hari
// kerja pengganti, durasi 0–6 (milestone), tanpa Mulai, selesai (+ aktual), berjalan (progress / actual.start), SNET,
// MFO, Manual eksplisit, induk, lingkaran, ke diri sendiri, empat tipe tautan dengan lag −2…3.
function genMix(n, nDeps, seed) {
  const rnd = lcg(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const base = D("2026-11-02");
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = { id: 7000 + i, project: rnd() < 0.75 ? "Alpha" : "Beta", deps: [] };
    if (rnd() >= 0.08) o.start = I(base + ri(0, 45));
    const dr = rnd();
    if (dr < 0.14) o.d = 0;
    else if (dr > 0.04 + 0.14) o.d = ri(1, 6);
    const x = rnd();
    if (x < 0.06) o.mode = "manual";
    else if (x < 0.13) {
      o.done = true;
      if (rnd() < 0.4 && o.start) o.actual = { start: o.start, finish: I(D(o.start) + ri(0, 6)) };
    } else if (x < 0.18) o.progress = 30;
    else if (x < 0.22) o.actual = { start: I(base + ri(0, 20)) };
    else if (x < 0.29) o.constraint = { type: "SNET", date: I(base + ri(0, 40)) };
    else if (x < 0.33) o.constraint = { type: "MFO", date: I(base + ri(5, 60)) };
    if (i > 10 && rnd() < 0.06) o.parent = 7000 + ri(0, i - 1);
    out.push(o);
  }
  for (let k = 0; k < nDeps; k++) {
    const a = ri(0, n - 1);
    const b = rnd() < 0.85 ? Math.min(n - 1, a + ri(1, 12)) : ri(0, n - 1); // sebagian besar maju, sisanya acak (lingkaran)
    const succ = out[b];
    if (succ.deps.some((y) => y[0] === 7000 + a) || succ.deps.length >= 6) continue;
    succ.deps.push([7000 + a, S.TYPES[ri(0, 3)], ri(-2, 3)]);
  }
  // lingkaran pasti: 4 pasang task bertetangga saling bergantung (ditambah ke dependensi acak di atas)
  for (let k = 0; k < 4; k++) {
    const a = 20 + k * 30;
    if (!out[a].deps.some((y) => y[0] === 7001 + a)) out[a].deps.push([7001 + a, "FS", 0]);
    if (!out[a + 1].deps.some((y) => y[0] === 7000 + a)) out[a + 1].deps.push([7000 + a, "SS", 1]);
  }
  return out.map((o) => {
    const t = mk(o);
    if (o.parent !== undefined) t.project = out[o.parent - 7000].project;
    return t;
  });
}
const mixCal = () => C.compile({ weekdays: [1, 2, 3, 4, 5], national: true, cutiBersama: true, off: [{ d: "2026-11-18" }, { d: "2026-12-07" }], work: [{ d: "2026-11-21" }, { d: "2026-12-12" }] });

test("paritas fixture campuran 160 task / 200 dependensi (workspace, kalender SKB + pengecualian): tanggal simulator = es/ef mesin untuk semua simpul terhitung", () => {
  const tasks = genMix(160, 200, 20261110);
  const p = parity(tasks, { pageKind: "workspace", cal: mixCal() });
  const kinds = {};
  for (const r of p.rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  const lt = new Set(taskEls(p.doc).flatMap((t) => kids(t, "PredecessorLink").map((l) => val(l, "Type"))));
  const ct = new Set(taskEls(p.doc).map((t) => val(t, "ConstraintType")));
  console.log("paritas campuran: " + p.rows.length + " baris, jenis " + JSON.stringify(kinds) + ", milestone " + p.rows.filter((r) => r.ms).length + ", tautan " + p.out.stats.links + " (dilewati " + p.out.stats.skippedLinks + "), lingkaran " + p.result.cycles.length);
  // cakupan fixture
  assert.ok(p.rows.length >= 120, "baris " + p.rows.length);
  for (const k of ["done", "started", "cycle", "mfo", "manual", "pred", "root"]) assert.ok(kinds[k] > 0, "jenis " + k);
  assert.ok(p.rows.filter((r) => r.ms).length >= 10, "milestone");
  assert.deepEqual([...lt].sort(), ["0", "1", "2", "3"], "empat tipe tautan");
  assert.deepEqual([...ct].sort(), ["0", "2", "3", "4"], "ASAP/MSO/MFO/SNET");
  assert.ok(p.result.cycles.length >= 1, "lingkaran");
  assert.deepEqual(p.bad, [], JSON.stringify(p.bad, null, 1));
});

test("properti F2 (fixture campuran): task Otomatis non-ringkasan ber-ConstraintType 0 punya ≥ 1 PredecessorLink; setiap tautan yang diekspor ada di result.pred dengan tipe dan lag yang sama", () => {
  const tasks = genMix(160, 200, 20261110);
  const p = parity(tasks, { pageKind: "workspace", cal: mixCal() });
  const keyOfUid = new Map();
  const byTitle = new Map(tasks.map((t) => [t.title, String(t.id)]));
  for (const t of taskEls(p.doc)) keyOfUid.set(val(t, "UID"), byTitle.get(val(t, "Name")));
  const TY = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };
  let n = 0;
  for (const t of taskEls(p.doc)) {
    if (val(t, "Summary") === "1") continue;
    const links = kids(t, "PredecessorLink");
    if (val(t, "Manual") === "0" && val(t, "ConstraintType") === "0") assert.ok(links.length >= 1, "ASAP tanpa tautan: " + val(t, "Name"));
    const pl = p.result.pred.get(keyOfUid.get(val(t, "UID"))) || [];
    for (const l of links) {
      const pk = keyOfUid.get(val(l, "PredecessorUID"));
      const hit = pl.find((x) => x.key === pk);
      assert.ok(hit, "tautan " + pk + " → " + val(t, "Name") + " ada di result.pred");
      assert.deepEqual([TY[val(l, "Type")], Number(val(l, "LinkLag")) / 4800], [hit.type, hit.lag]);
      n++;
    }
  }
  let total = 0;
  for (const l of p.result.pred.values()) total += l.length;
  assert.equal(n, p.out.stats.links);
  assert.equal(n, total, "semua sisi result.pred diekspor (simpul selalu task yang diekspor)");
});

// ---------------------------------------------------------------- kinerja

function genBig(n, nDeps, seed) {
  const rnd = lcg(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const base = D("2026-11-02");
  const uids = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21];
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = { id: 5000 + i, start: rnd() < 0.08 ? undefined : I(base + ri(0, 120)), d: rnd() < 0.05 ? undefined : ri(0, 8), project: ["Alpha", "Beta", "Gamma"][ri(0, 2)], deps: [], est: ri(1, 30), to: uids[i % 10], progress: ri(0, 100) };
    const x = rnd();
    if (x < 0.05) o.mode = "manual";
    else if (x < 0.1) o.done = true;
    else if (x < 0.16) o.constraint = { type: "SNET", date: I(base + ri(0, 60)) };
    else if (x < 0.18) o.constraint = { type: "MFO", date: I(base + ri(10, 90)) };
    if (i > 10 && rnd() < 0.1) o.parent = 5000 + ri(0, i - 1);
    out.push(o);
  }
  for (let k = 0; k < nDeps; k++) {
    let a = ri(0, n - 1);
    let b = ri(0, n - 1);
    if (a === b) continue;
    if (a > b) [a, b] = [b, a];
    const succ = out[b];
    if (succ.deps.some((x) => x[0] === 5000 + a) || succ.deps.length >= 20) continue;
    succ.deps.push([5000 + a, S.TYPES[ri(0, 3)], ri(-2, 3)]);
  }
  return out.map((o) => {
    const t = mk(o);
    if (o.parent !== undefined) t.project = out[o.parent - 5000].project; // anak satu project dengan induk
    return t;
  });
}

test("kinerja: 1.000 task / 800 dependensi / 10 orang + baseline → median 5 putaran TLMspdi.build ≤ 300 ms (dicatat)", () => {
  const tasks = genBig(1000, 800, 4242);
  const cal = std();
  const units = autoUnits("Alpha", "Gamma");
  const result = M.run({ tasks, cal, units, readExt });
  const rows = new Map();
  for (const t of tasks.slice(0, 900)) rows.set(String(t.id), { s: D("2026-11-02"), f: D("2026-11-06"), d: 5, w: 3 });
  const people = new Map([3, 5, 7, 9, 11, 13, 15, 17, 19, 21].map((u, i) => [u, "Orang " + i]));
  const input = { tasks, cal, readExt, result, units, pageKind: "workspace", title: "Besar", people, baseline: { rows }, D: D0 };
  const first = X.build(input);
  assert.equal(first.stats.tasks, 1000 + 3);
  assert.ok(first.stats.links > 500, "tautan " + first.stats.links);
  assert.equal(first.stats.resources, 10);
  parseXml(first.xml);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const s = process.hrtime.bigint();
    const again = X.build(input);
    times.push(Number(process.hrtime.bigint() - s) / 1e6);
    assert.equal(again.xml, first.xml);
  }
  times.sort((a, b) => a - b);
  console.log(`TLMspdi.build 1000 task / ${first.stats.links} tautan / 10 orang: median ${times[2].toFixed(2)} ms (${times.map((t) => t.toFixed(1)).join(", ")}); XML ${(first.xml.length / 1024).toFixed(0)} KiB`);
  assert.ok(times[2] <= 300, "median " + times[2]);
});
