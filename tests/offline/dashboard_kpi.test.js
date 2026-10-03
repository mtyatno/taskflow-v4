"use strict";

// Kartu angka (KPI) Dashboard — ikon modern + mini visualisasi:
//   Aktif → sparkline jumlah task aktif 14 hari, Selesai 7 hari → kolom per hari (8 hari, sama
//   dengan aturan summary), Q1/Terlambat/Inbox → meter porsi. Semua angka dihitung oleh fungsi
//   murni level modul `dashKpiStats(tasks, todayISO)` di static/index.html (tanpa React/Date.now;
//   "hari ini" dikirim sebagai YYYY-MM-DD lokal).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");
const appCss = fs.readFileSync(path.resolve(__dirname, "../../static/app.css"), "utf8").replace(/\r\n/g, "\n");
const uiComponents = fs.readFileSync(path.resolve(__dirname, "../../static/ui-components.js"), "utf8");

// Ambil sumber fungsi `(<params>) => { ... }`, `x => { ... }` atau `function name(<params>) { ... }`
// yang dimulai setelah `marker`. Scanner: hitung kurung, lewati isi string/template literal dan
// komentar // & /* */. (Salinan helper di note_toc.test.js.)
function extractArrowFn(code, marker) {
  const at = code.indexOf(marker);
  if (at < 0) return null;
  const skip = (j) => {
    const c = code[j], n = code[j + 1];
    if (c === "/" && n === "/") { const e = code.indexOf("\n", j); return e < 0 ? code.length : e; }
    if (c === "/" && n === "*") { const e = code.indexOf("*/", j + 2); return e < 0 ? code.length : e + 1; }
    if (c === "'" || c === '"' || c === "`") {
      j++;
      while (j < code.length && code[j] !== c) { if (code[j] === "\\") j++; j++; }
      return j;
    }
    return -1;
  };
  const matchPair = (j, open, close) => {
    let depth = 0;
    for (; j < code.length; j++) {
      const k = skip(j);
      if (k >= 0) { j = k; continue; }
      const c = code[j];
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return j; }
    }
    return -1;
  };
  // Arrow satu parameter tanpa kurung (gaya hasil compile: `item => { ... }`)
  const bare = code.slice(at + marker.length).match(/^\s*([A-Za-z_$][\w$]*)\s*=>\s*\{/);
  if (bare) {
    const from = at + marker.length + bare[0].indexOf(bare[1]);
    const bodyEnd = matchPair(at + marker.length + bare[0].length - 1, "{", "}");
    return bodyEnd < 0 ? null : code.slice(from, bodyEnd + 1);
  }
  const start = code.indexOf("(", at + marker.length);
  const paramsEnd = matchPair(start, "(", ")");
  if (paramsEnd < 0) return null;
  const rest = code.slice(paramsEnd + 1).match(/^\s*(?:=>\s*)?\{/);
  if (!rest) return null;
  const i = paramsEnd + rest[0].length;
  const bodyEnd = matchPair(i, "{", "}");
  if (bodyEnd < 0) return null;
  return code.slice(start, bodyEnd + 1);
}

const statsSrc = extractArrowFn(indexHtml, "function dashKpiStats");
const loadStats = () => {
  assert.ok(statsSrc, "function dashKpiStats harus ada di level modul static/index.html");
  return new Function("return function dashKpiStats" + statsSrc)();
};

const TODAY = "2026-10-03"; // Sabtu
// Task aktif "lama" (dibuat jauh sebelum jendela 14 hari).
const mk = (o) => ({ gtd_status: "next", quadrant: "Q2", created_at: "2026-08-01T08:00:00", ...o });
// Aturan done_last_7_days server (webapp.py get_summary) & offline (taskquery.js getSummary):
// gtd_status === "done" && completed_at >= (today − 7 hari) sebagai string "YYYY-MM-DD".
const summaryDone7 = (tasks, cutoff) => tasks.filter(t => t.gtd_status === "done" && t.completed_at && t.completed_at >= cutoff).length;

test("dashKpiStats — fungsi murni level modul", async (t) => {
  await t.test("tidak memakai jam sistem (hari ini dikirim sebagai argumen)", () => {
    assert.ok(statsSrc, "function dashKpiStats harus ada");
    assert.doesNotMatch(statsSrc, /Date\.now|new Date\(\s*\)/, "tidak boleh membaca jam sistem");
    assert.doesNotMatch(statsSrc, /React\.|useState|useMemo/, "tidak boleh memakai React");
  });

  await t.test("panjang deret: days14 = today−13..today, doneDays = today−7..today (lintas bulan)", () => {
    const s = loadStats()([], TODAY);
    assert.equal(s.days14.length, 14);
    assert.equal(s.activeSeries.length, 14);
    assert.equal(s.days14[0], "2026-09-20");
    assert.equal(s.days14[10], "2026-09-30");
    assert.equal(s.days14[11], "2026-10-01");
    assert.equal(s.days14[13], TODAY);
    assert.equal(s.doneDays.length, 8);
    assert.equal(s.doneSeries.length, 8);
    assert.deepEqual(s.doneDays, ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  await t.test("tanpa task: semua nol, porsi 0 (penyebut nol tidak menghasilkan NaN)", () => {
    const s = loadStats()([], TODAY);
    assert.deepEqual(s.activeSeries, Array(14).fill(0));
    assert.deepEqual(s.doneSeries, Array(8).fill(0));
    for (const k of ["activeCount", "q1Count", "overdueCount", "inboxCount", "withDeadline", "doneSum", "donePrev", "activeDelta", "activeWeekAgo"]) {
      assert.equal(s[k], 0, k);
    }
    assert.equal(s.q1Share, 0);
    assert.equal(s.overdueShare, 0);
    assert.equal(s.inboxShare, 0);
  });
});

test("dashKpiStats — angka KPI sama persis dengan definisi Dashboard sebelumnya", () => {
  const tasks = [
    mk({ id: 1, quadrant: "Q1", deadline: "2026-09-30", is_overdue: true }),
    mk({ id: 2, quadrant: "Q1", gtd_status: "inbox", deadline: "2026-10-09" }),
    mk({ id: 3, gtd_status: "inbox" }),
    mk({ id: 4, gtd_status: "waiting", deadline: "2026-10-20" }),
    mk({ id: 5, gtd_status: "someday" }),
    mk({ id: 6, quadrant: "Q1", gtd_status: "done", completed_at: "2026-10-02T09:00:00", is_overdue: true }),
    mk({ id: 7, quadrant: "Q1", gtd_status: "archived", is_overdue: true }),
  ];
  const s = loadStats()(tasks, TODAY);
  const active = tasks.filter(t => t.gtd_status !== "done" && t.gtd_status !== "archived");
  assert.equal(s.activeCount, active.length);
  assert.equal(s.activeCount, 5);
  assert.equal(s.q1Count, active.filter(t => t.quadrant === "Q1").length);
  assert.equal(s.q1Count, 2);
  assert.equal(s.overdueCount, active.filter(t => t.is_overdue).length);
  assert.equal(s.overdueCount, 1);
  assert.equal(s.inboxCount, active.filter(t => t.gtd_status === "inbox").length);
  assert.equal(s.inboxCount, 2);
  assert.equal(s.withDeadline, 3);
});

test("dashKpiStats — activeSeries (task aktif di akhir tiap hari, 14 hari)", async (t) => {
  await t.test("titik terakhir selalu = activeCount (meski created_at 'besok' karena zona waktu)", () => {
    const tasks = [mk({ id: 1 }), mk({ id: 2, created_at: "2026-10-04T01:30:00Z" }), mk({ id: 3, gtd_status: "inbox", created_at: TODAY + "T07:00:00" })];
    const s = loadStats()(tasks, TODAY);
    assert.equal(s.activeCount, 3);
    assert.equal(s.activeSeries[13], s.activeCount);
  });

  await t.test("task yang dibuat 3 hari lalu tidak muncul di hari-hari sebelumnya", () => {
    const tasks = [mk({ id: 1 }), mk({ id: 2, created_at: "2026-09-30T10:00:00" })];
    const s = loadStats()(tasks, TODAY);
    assert.deepEqual(s.activeSeries.slice(0, 10), Array(10).fill(1), "sebelum 30 Sep hanya task lama");
    assert.deepEqual(s.activeSeries.slice(10), [2, 2, 2, 2], "mulai 30 Sep keduanya aktif");
  });

  await t.test("task selesai 2 hari lalu aktif sebelum hari itu, tidak lagi sejak hari selesainya", () => {
    const tasks = [mk({ id: 1, gtd_status: "done", completed_at: "2026-10-01T15:00:00" })];
    const s = loadStats()(tasks, TODAY);
    assert.deepEqual(s.activeSeries.slice(0, 11), Array(11).fill(1), "20–30 Sep masih aktif");
    assert.deepEqual(s.activeSeries.slice(11), [0, 0, 0], "1–3 Okt sudah selesai");
    assert.equal(s.activeCount, 0);
  });

  await t.test("archived tidak pernah dihitung; done tanpa completed_at tidak pernah aktif", () => {
    const tasks = [
      mk({ id: 1, gtd_status: "archived" }),
      mk({ id: 2, gtd_status: "archived", created_at: "2026-09-25T10:00:00" }),
      mk({ id: 3, gtd_status: "done" }),
      mk({ id: 4, gtd_status: "done", completed_at: null }),
    ];
    const s = loadStats()(tasks, TODAY);
    assert.deepEqual(s.activeSeries, Array(14).fill(0));
  });

  await t.test("created_at kosong dianggap dibuat lama (aktif di seluruh 14 hari)", () => {
    const s = loadStats()([{ id: 1, gtd_status: "next" }, { id: 2, gtd_status: "inbox", created_at: "" }], TODAY);
    assert.deepEqual(s.activeSeries, Array(14).fill(2));
  });

  await t.test("activeDelta = hari ini − 7 hari lalu; activeWeekAgo = titik ke-7", () => {
    const tasks = [
      mk({ id: 1 }),
      mk({ id: 2, created_at: "2026-09-30T10:00:00" }),
      mk({ id: 3, created_at: "2026-10-02T10:00:00" }),
      mk({ id: 4, gtd_status: "done", completed_at: "2026-09-28T10:00:00" }),
    ];
    const s = loadStats()(tasks, TODAY);
    assert.equal(s.days14[6], "2026-09-26");
    assert.equal(s.activeWeekAgo, s.activeSeries[6]);
    assert.equal(s.activeWeekAgo, 2, "26 Sep: task lama + task yang baru selesai 28 Sep");
    assert.equal(s.activeSeries[13], 3);
    assert.equal(s.activeDelta, 1);
  });
});

test("dashKpiStats — Selesai 7 hari (kolom per hari) mengikuti aturan summary", async (t) => {
  const tasks = [
    mk({ id: 1, gtd_status: "done", completed_at: "2026-09-25T23:59:59" }),   // today−8 → minggu sebelumnya
    mk({ id: 2, gtd_status: "done", completed_at: "2026-09-26T00:00:00" }),   // today−7 → kolom 0
    mk({ id: 3, gtd_status: "done", completed_at: "2026-09-26" }),            // tanggal saja → kolom 0
    mk({ id: 4, gtd_status: "done", completed_at: "2026-10-02T12:00:00Z" }),  // kolom 6
    mk({ id: 5, gtd_status: "done", completed_at: "2026-10-03T08:00:00" }),   // hari ini → kolom 7
    mk({ id: 6, gtd_status: "done", completed_at: "2026-10-03T21:10:00" }),   // hari ini → kolom 7
    mk({ id: 7, gtd_status: "done", completed_at: "2026-10-04T01:00:00" }),   // "besok" (zona waktu) → tetap dihitung summary → kolom hari ini
    mk({ id: 8, gtd_status: "done" }),                                       // tanpa completed_at → tidak dihitung
    mk({ id: 9, gtd_status: "next", completed_at: "2026-10-01T10:00:00" }),   // dibuka lagi → bukan selesai
    mk({ id: 10, gtd_status: "done", completed_at: "2026-09-18T06:00:00" }),  // today−15 → minggu sebelumnya
    mk({ id: 11, gtd_status: "done", completed_at: "2026-09-17T23:59:00" }),  // today−16 → di luar kedua jendela
    mk({ id: 12, gtd_status: "archived", completed_at: "2026-10-01T10:00:00" }),
  ];

  await t.test("jumlah kolom = hitungan done_last_7_days (completed_at >= today−7)", () => {
    const s = loadStats()(tasks, TODAY);
    assert.equal(s.doneSum, s.doneSeries.reduce((a, b) => a + b, 0));
    assert.equal(s.doneSum, summaryDone7(tasks, "2026-09-26"));
    assert.equal(s.doneSum, 6);
  });

  await t.test("kolom per tanggal completed_at (yang 'besok' masuk kolom hari ini)", () => {
    const s = loadStats()(tasks, TODAY);
    assert.deepEqual(s.doneSeries, [2, 0, 0, 0, 0, 0, 1, 3]);
  });

  await t.test("donePrev = selesai di 8 hari sebelumnya (today−15..today−8)", () => {
    const s = loadStats()(tasks, TODAY);
    assert.equal(s.donePrev, 2);
  });
});

test("dashKpiStats — porsi meter (Q1, Terlambat, Inbox)", async (t) => {
  await t.test("q1Share & inboxShare dari task aktif; overdueShare dari task aktif ber-deadline", () => {
    const tasks = [
      mk({ id: 1, quadrant: "Q1", deadline: "2026-09-30", is_overdue: true }),
      mk({ id: 2, quadrant: "Q1", gtd_status: "inbox", deadline: "2026-10-09" }),
      mk({ id: 3, deadline: "2026-11-01" }),
      mk({ id: 4 }),
      mk({ id: 5, gtd_status: "done", completed_at: "2026-10-01T10:00:00", deadline: "2026-09-01" }),
    ];
    const s = loadStats()(tasks, TODAY);
    assert.equal(s.activeCount, 4);
    assert.equal(s.withDeadline, 3, "task selesai tidak dihitung sebagai ber-deadline");
    assert.equal(s.q1Share, 0.5);
    assert.equal(s.inboxShare, 0.25);
    assert.ok(Math.abs(s.overdueShare - 1 / 3) < 1e-9);
  });

  await t.test("penyebut nol → 0: tidak ada task ber-deadline", () => {
    const s = loadStats()([mk({ id: 1, quadrant: "Q1" }), mk({ id: 2, gtd_status: "inbox" })], TODAY);
    assert.equal(s.withDeadline, 0);
    assert.equal(s.overdueShare, 0);
    assert.equal(s.q1Share, 0.5);
    assert.equal(s.inboxShare, 0.5);
  });

  await t.test("porsi tidak pernah melebihi 1 (is_overdue basi tanpa deadline)", () => {
    const s = loadStats()([mk({ id: 1, is_overdue: true }), mk({ id: 2, is_overdue: true, deadline: "2026-09-01" })], TODAY);
    assert.equal(s.overdueCount, 2);
    assert.equal(s.withDeadline, 1);
    assert.equal(s.overdueShare, 1);
  });
});

test("dashDayLabel — tooltip tanggal berbahasa Indonesia", () => {
  const src = extractArrowFn(indexHtml, "const dashDayLabel = ");
  assert.ok(src, "const dashDayLabel harus ada di level modul");
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dashDayLabel = new Function("DASH_MONTHS", "return " + src)(months);
  assert.equal(dashDayLabel("2026-10-03"), "Sab, 3 Okt");
  assert.equal(dashDayLabel("2026-09-27"), "Min, 27 Sep");
  assert.equal(dashDayLabel("2026-09-28"), "Sen, 28 Sep");
});

test("Dashboard memakai statistik KPI + tampilan baru", async (t) => {
  const dashMatch = indexHtml.match(/^function Dashboard\(\{[\s\S]*?^}\n/m);
  const dashCode = dashMatch ? dashMatch[0] : "";

  await t.test("statistik di-memo per [tasks] dengan tanggal lokal", () => {
    assert.ok(dashCode, "function Dashboard ditemukan");
    assert.match(dashCode, /useMemo\(\(\) => \{[\s\S]*?dashKpiStats\(tasks, [\s\S]*?\}, \[tasks\]\)/);
    assert.match(dashCode, /getFullYear\(\)/, "hari ini memakai tanggal lokal, bukan toISOString (UTC)");
  });

  await t.test("nilai Selesai 7 hari tetap dari summary.done_last_7_days", () => {
    assert.match(dashCode, /summary\.done_last_7_days \?\? 0/);
  });

  await t.test("ikon baru activity & alarm terdaftar di ICONS", () => {
    assert.match(uiComponents, /\n\s*activity: '<path d="M22 12h-2\.48/);
    assert.match(uiComponents, /\n\s*alarm: '<circle cx="12" cy="13" r="8"\/>/);
  });

  await t.test("garis warna kartu Eisenhower/GTD dihapus", () => {
    assert.doesNotMatch(appCss, /\.dash-qcard::before/);
    assert.doesNotMatch(indexHtml, /"--dash-q"/);
  });

  await t.test("angka KPI memakai angka proporsional (tanpa tabular-nums)", () => {
    const m = appCss.match(/\.dash-kpi-num \{([^}]*)\}/);
    assert.ok(m, ".dash-kpi-num ada");
    assert.doesNotMatch(m[1], /tabular-nums/);
  });

  await t.test("kartu ganjil terakhir di mobile tidak lagi memakai tata letak horizontal", () => {
    assert.doesNotMatch(appCss, /\.dash-kpis > :last-child:nth-child\(odd\) \.dash-kpi-top/);
    assert.doesNotMatch(appCss, /\.dash-kpis > :last-child:nth-child\(odd\) \{[^}]*display: flex/);
  });
});
