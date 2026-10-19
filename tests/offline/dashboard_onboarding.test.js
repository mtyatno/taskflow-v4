const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "../../static/index.html");
const cssPath = path.join(__dirname, "../../static/app.css");
const swPath = path.join(__dirname, "../../static/sw.js");

test("Service Worker and stylesheet versions are synchronized for v396", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const sw = fs.readFileSync(swPath, "utf8");

  assert.match(sw, /taskflow-v419-project-scope/);
  assert.match(html, /taskflow-v419-project-scope/);
  assert.match(html, /app\.css\?v=334/);
});

test("Dashboard contains conditional rendering logic for new users (hasTasks)", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  // State checks
  assert.match(html, /hasTasks\s*=\s*tasks\.length\s*>\s*0/);
  assert.match(html, /dismissedOnboarding/);
  assert.match(html, /tf_dismiss_onboarding/);

  // DashOnboardingCard component exists
  assert.match(html, /DashOnboardingCard/);
  assert.match(html, /Mulai Langkah Pertama/);

  // Guards on KPI and Matrix sections
  assert.match(html, /hasTasks\s*&&[\s\S]*?dash-kpis/);
  assert.match(html, /hasTasks\s*&&[\s\S]*?eisenhower/);
  assert.match(html, /hasTasks\s*&&[\s\S]*?gtd/);
  assert.match(html, /hasCompletedTasks\s*&&[\s\S]*?Analitik/);
});

test("DashOnboardingCard contains clarified instructions and adaptive input pre-fill", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  // Step 1 updated description
  assert.match(
    html,
    /Awali dengan kata tugas \(contoh: Tugas: beli buku besok\) lalu tekan Enter, atau klik tombol di samping\./
  );

  // Adaptive placeholder in .dash-capture input
  assert.match(
    html,
    /placeholder:\s*!hasTasks\s*\?\s*"Awali 'tugas: \.\.\.' untuk tugas, atau tulis apa saja untuk catatan\.\.\."\s*:\s*"Tulis apa saja\.\.\. \(tekan Enter untuk simpan\)"/
  );

  // onFocusInput pre-fills "Tugas: " and focuses input
  assert.match(html, /const prefix = "Tugas: ";/);
  assert.match(html, /setScratchInput\(prev => \(prev && prev\.trim\(\) \? prev : prefix\)\);/);
  assert.match(html, /input\.setSelectionRange\(len, len\);/);
});

test("app.css contains styling for DashOnboardingCard without border-left", () => {
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(css, /\.dash-onboarding-card/);
  assert.match(css, /\.onboarding-step-item/);
  assert.match(css, /\.onboarding-step-btn/);

  // Strict check: no border-left or borderLeft inside onboarding rules
  const onboardingSection = css.slice(css.indexOf(".dash-onboarding-card"));
  const relevantChunk = onboardingSection.slice(0, 2500);
  assert.strictEqual(/border-left\s*:/i.test(relevantChunk), false, "Must not use border-left styling");
});
