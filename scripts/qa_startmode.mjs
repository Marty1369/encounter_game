// qa_startmode.mjs — the Everyone-together / Staggered toggle.
// Default is together (no per-team UI). Switching to staggered reveals it; switching back
// clears every override so the whole field starts together again.
// Run: node scripts/qa_startmode.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("./../.npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core");
const BROWSER = path.join(process.cwd(), ".pw-browsers", "chromium-1232", "chrome-win64", "chrome.exe");
const APP = process.env.QA_URL || "http://localhost:5055/";
const ctl = (...a) => execFileSync("node", ["scripts/qa_ctl.mjs", ...a], { cwd: process.cwd(), encoding: "utf8" }).trim();
let pass = 0, fail = 0;
const ok = (n, c, ev = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (ev ? "  — " + String(ev).replace(/\s+/g, " ").slice(0, 120) : "")); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let PIN;
async function joinTeam(browser, team) {
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pg.goto(APP);
  await pg.fill("#pin", PIN); await pg.waitForTimeout(1000);
  await pg.fill("#pname", team); await pg.click("#pEnterBtn");
  await pg.waitForSelector("#newteam", { timeout: 15000 });
  await pg.fill("#newteam", team);
  await pg.getByRole("button", { name: "Create" }).click();
  await pg.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
  return pg;
}
// count per-team datetime inputs (present only in staggered mode)
const tsInputs = pg => pg.locator('input[id^="ts_"]').count();
const hasStaggerCard = async pg => /Stagger team starts/i.test(await pg.locator("main").innerText());
const activeSeg = async pg => {   // which segment is dark (selected)
  const t = await pg.locator("main").innerText();
  return t; // we assert via button styles below
};

async function main() {
  PIN = JSON.parse(ctl("setup")).pin;
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const a1 = await joinTeam(browser, "Alpha"); await sleep(300);
  const a2 = await joinTeam(browser, "Beta"); await sleep(300);
  const a3 = await joinTeam(browser, "Gamma"); await sleep(300);

  const ad = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await ad.goto(APP);
  await ad.getByRole("button", { name: "Game creator" }).click();
  await ad.waitForSelector("#apass");
  await ad.fill("#aemail", "andrius.martinonis@gmail.com");
  await ad.fill("#apass", "Qline-Merkine-2K7pX9");
  await ad.keyboard.press("Enter");
  await ad.waitForFunction(() => /Games/.test(document.body.innerText), null, { timeout: 20000 });
  await ad.locator('button:has-text("ZZ QA Player Flows")').first().click();
  await sleep(1500);

  // ---- default: everyone together
  ok("Start-mode toggle is shown", /Start mode/i.test(await ad.locator("main").innerText()));
  ok("default mode is 'Everyone together' (no stagger card)", !(await hasStaggerCard(ad)));
  ok("default has no per-team start inputs", (await tsInputs(ad)) === 0);
  const togGap = await ad.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(x => /Everyone together/.test(x.textContent));
    return b ? getComputedStyle(b).backgroundColor : null;
  });
  ok("'Everyone together' segment is the active one", /24, 24, 27|rgb\(24/.test(togGap || ""), togGap);

  // ---- switch to staggered
  await ad.getByRole("button", { name: /Staggered starts/ }).click();
  await sleep(1500);
  ok("staggered mode shows the Stagger card", await hasStaggerCard(ad));
  ok("staggered mode shows a per-team start input for each team", (await tsInputs(ad)) === 3, "inputs=" + (await tsInputs(ad)));

  // apply a stagger with a FUTURE base (the realistic case: schedule before anyone starts, so
  // switching back to Together can clear every override)
  const base = await ad.evaluate(() => {
    const d = new Date(Date.now() + 3 * 60000);   // +3 min
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  await ad.fill("#stgBase", base);
  await ad.fill("#stgGap", "0.5"); await ad.waitForTimeout(200);
  await ad.getByRole("button", { name: "Apply stagger" }).click(); await sleep(2500);
  const staggered = JSON.parse(ctl("starts"));   // NOTE: this re-auths; do UI reads before more admin actions
  ok("overrides written for all teams", staggered.teams.every(t => t.starts_at), JSON.stringify(staggered.teams.map(t => t.name + ":" + !!t.starts_at)));
  const effs = staggered.teams.map(t => Date.parse(t.eff)).sort((a, b) => a - b);
  ok("the overrides are actually staggered", (effs[1] - effs[0]) >= 20000 && (effs[2] - effs[1]) >= 20000, effs.map(e => new Date(e).toISOString().slice(14, 19)).join(" "));

  // the ctl call invalidated the admin browser session — log back in and reselect
  await ad.reload(); await sleep(800);
  await ad.getByRole("button", { name: "Game creator" }).click();
  await ad.waitForSelector("#apass", { timeout: 8000 }).catch(() => {});
  if (await ad.$("#apass")) { await ad.fill("#aemail", "andrius.martinonis@gmail.com"); await ad.fill("#apass", "Qline-Merkine-2K7pX9"); await ad.keyboard.press("Enter"); }
  await ad.waitForFunction(() => /Games/.test(document.body.innerText), null, { timeout: 20000 });
  await ad.locator('button:has-text("ZZ QA Player Flows")').first().click(); await sleep(1500);

  // ---- switch back to together -> overrides cleared
  await ad.getByRole("button", { name: /Everyone together/ }).click();
  await sleep(2500);
  ok("back to together hides the stagger card", !(await hasStaggerCard(ad)));
  ok("back to together removes per-team inputs", (await tsInputs(ad)) === 0);

  const cleared = JSON.parse(ctl("starts"));
  ok("every team override is cleared", cleared.teams.every(t => t.starts_at === null),
     JSON.stringify(cleared.teams.map(t => t.name + ":" + t.starts_at)));

  await browser.close();
  ctl("teardown");
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
