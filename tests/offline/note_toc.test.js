"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.resolve(__dirname, "../../static/app.css");
const appCss = fs.readFileSync(cssPath, "utf8");

test("Floating ToC CSS — tombol melayang ala Medium", async (t) => {
  await t.test("anchor fixed tersedia (satu sumber kebenaran)", () => {
    assert.ok(appCss.includes(".floating-toc-anchor"), "harus ada selector .floating-toc-anchor");
    // Satu definisi base + satu override desktop (769px) = konsolidasi tunggal.
    // Gaya pill lama (inline-flex / radius 20px) yang terduplikasi harus benar-benar hilang.
    const count = (appCss.match(/\.floating-toc-trigger \{/g) || []).length;
    assert.strictEqual(count, 2, "blok .floating-toc-trigger harus tepat 2 (base + override desktop; duplikat lama dihapus)");
    const triggerBodies = [...appCss.matchAll(/\.floating-toc-trigger \{([^}]*)\}/g)].map(m => m[1]);
    assert.ok(triggerBodies.length >= 2 && triggerBodies.every(b => !/inline-flex|border-radius:\s*20px/.test(b)), "gaya pill lama (inline-flex / radius 20px) tidak boleh tersisa");
    // Scoped ke braces blok: floating-toc tidak boleh ada DI DALAM @media (max-width: 767px) mana pun.
    const mediaDup = /@media \(max-width: 767px\)\s*\{[^}]*\.floating-toc/.exec(appCss);
    assert.strictEqual(mediaDup, null, "tidak boleh ada floating-toc di dalam blok @media (max-width: 767px) lama");
  });

  await t.test("mobile: FAB 44px di atas FAB Buat Baru (bottom 92px + safe-area)", () => {
    assert.ok(appCss.includes("bottom: calc(92px + env(safe-area-inset-bottom, 0px))"), "anchor mobile di 92px + safe-area");
    const m = /\.floating-toc-trigger \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .floating-toc-trigger ada");
    const body = m[1];
    assert.ok(/width:\s*44px/.test(body), "mobile: width 44px");
    assert.ok(/height:\s*44px/.test(body), "mobile: height 44px");
    assert.ok(/border-radius:\s*50%/.test(body), "bentuk lingkaran");
  });

  await t.test("desktop (min-width 769): kanan-tengah, 40px, popover ke kiri", () => {
    // Greedy: ambil kejadian TERAKHIR di file — override di dalam @media (min-width: 769px).
    // Blok konsolidasi menutup file, jadi kejadian terakhir = rule media-scoped, bukan base mobile.
    const desktop = /@media \(min-width: 769px\)[\s\S]*\.floating-toc-anchor \{([^}]*)\}/.exec(appCss);
    assert.ok(desktop, "harus ada @media (min-width: 769px) dengan .floating-toc-anchor");
    assert.ok(/top:\s*50%/.test(desktop[1]), "top 50%");
    assert.ok(/transform:\s*translateY\(-50%\)/.test(desktop[1]), "translateY(-50%)");
    const popover = /@media \(min-width: 769px\)[\s\S]*\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(popover, "popover desktop override ada");
    assert.ok(/right:\s*calc\(100% \+ 8px\)/.test(popover[1]), "popover membuka ke kiri tombol");
    const trigDesktop = /@media \(min-width: 769px\)[\s\S]*\.floating-toc-trigger \{([^}]*)\}/.exec(appCss);
    assert.ok(trigDesktop && /width:\s*40px/.test(trigDesktop[1]), "desktop: 40px");
  });

  await t.test("mobile: popover membuka ke atas", () => {
    const m = /\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .floating-toc-popover ada");
    assert.ok(/position:\s*absolute/.test(m[1]), "popover absolute terhadap anchor fixed");
    assert.ok(/bottom:\s*calc\(100% \+ 8px\)/.test(m[1]), "buka ke atas dari FAB");
  });

  await t.test("item aktif ter-highlight dengan tint accent", () => {
    const m = /\.note-toc-item\.active \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .note-toc-item.active unscoped ada");
    assert.ok(/rgba\(168,197,0,0\.12\)/.test(m[1]), "background tint accent");
    assert.ok(/color:\s*var\(--accent\)/.test(m[1]), "teks accent");
  });

  await t.test("animasi popover opacity-only (tidak bentrok transform)", () => {
    assert.ok(appCss.includes("@keyframes toc-pop-in"), "keyframes toc-pop-in ada");
    const m = /\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(/animation:\s*toc-pop-in/.test(m[1]), "popover pakai toc-pop-in");
  });

  await t.test("ToC statis lama benar-benar hilang", () => {
    assert.strictEqual(appCss.includes(".note-toc-sticky"), false, ".note-toc-sticky tidak boleh ada");
  });
});

const indexPath = path.resolve(__dirname, "../../static/index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

test("Floating ToC JSX — markup NotePanel", async (t) => {
  const notePanelMatch = indexHtml.match(/function NotePanel\(\{[\s\S]*?^function /m);
  const notePanelCode = notePanelMatch ? notePanelMatch[0] : "";
  assert.ok(notePanelCode.length > 0, "NotePanel harus ada di static/index.html");

  await t.test("trigger jadi anchor fixed (tanpa inline relative)", () => {
    assert.ok(notePanelCode.includes('className: "floating-toc-anchor"'), "wrapper pakai class floating-toc-anchor");
    assert.strictEqual(/ref: tocRef,\s*style: \{ position: "relative", display: "inline-block" \}/.test(notePanelCode), false, "inline style relative di wrapper ToC harus dihapus (dropdown export lain tetap boleh inline)");
  });

  await t.test("tombol lingkaran ikon saja (label Isi (N) hilang)", () => {
    assert.ok(notePanelCode.includes('React.createElement("span", null, "📑")'), "ikon 📑 ada");
    assert.strictEqual(notePanelCode.includes("`Isi (${tocItems.length})`"), false, "label teks Isi (N) harus hilang");
    assert.strictEqual(notePanelCode.includes('"▲" : "▼"'), false, "indikator panah harus hilang");
  });

  await t.test("popover tanpa positioning inline (CSS yang pegang)", () => {
    assert.strictEqual(notePanelCode.includes('top: "calc(100% + 6px)"'), false, "inline top popover lama harus hilang");
    assert.strictEqual(notePanelCode.includes('zIndex: 200'), false, "inline zIndex 200 popover harus hilang");
    assert.ok(notePanelCode.includes('className: "floating-toc-popover"'), "popover hanya pakai class");
  });

  await t.test("state tocActiveIdx + ref tocSpyRef + observer wiring", () => {
    assert.match(notePanelCode, /const \[tocActiveIdx, setTocActiveIdx\] = React\.useState\(null\)/, "state tocActiveIdx ada");
    assert.match(notePanelCode, /const tocSpyRef = React\.useRef\(null\)/, "ref tocSpyRef ada");
    assert.match(notePanelCode, /typeof IntersectionObserver === "undefined"/, "guard IntersectionObserver ada");
    assert.match(notePanelCode, /querySelectorAll\('\[id\^="note-h-"\]'\)/, "scope observer ke heading dalam container");
    assert.match(notePanelCode, /rootMargin: "-15% 0px -60% 0px"/, "band scroll-spy 15%–60%");
    assert.match(notePanelCode, /setTocActiveIdx\(parseInt\(m\[1\], 10\)\)/, "parse idx dari id heading");
  });

  await t.test("effect observer SETELAH deklarasi tocItems (regresi TDZ)", () => {
    const tocItemsIdx = notePanelCode.indexOf('const tocItems = useMemo(() => extractHeadings(note.content || ""), [note.content]);');
    const observerIdx = notePanelCode.indexOf("new IntersectionObserver");
    assert.ok(tocItemsIdx > -1 && observerIdx > -1, "kedua penanda ada");
    assert.ok(observerIdx > tocItemsIdx, "observer WAJIB setelah deklarasi tocItems (TDZ)");
  });

  await t.test("tocSpyRef terpasang di .note-rendered milik panel", () => {
    assert.match(notePanelCode, /className: "note-rendered",\s*ref: tocSpyRef/, "ref tocSpyRef di div note-rendered");
  });

  await t.test("item aktif via template class + klik set aktif instan", () => {
    assert.match(notePanelCode, /className: `note-toc-item\$\{tocActiveIdx === item\.idx \? " active" : ""\}`/, "class active pada item yang cocok");
    assert.match(notePanelCode, /setTocOpen\(false\);\s*setTocActiveIdx\(item\.idx\)/, "klik item langsung set active idx");
  });
});
