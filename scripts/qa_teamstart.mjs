// qa_teamstart.mjs — per-team staggered starts, end to end in a real browser:
// admin staggers 3 teams, each player gets a DIFFERENT countdown, "Start now" pulls one in.
// Run: node scripts/qa_teamstart.mjs
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

// seconds until a waiting player's screen says the game starts; -1 = already in the game; null = neither
const countdown = async pg => pg.evaluate(() => {
  const el = document.getElementById("pCd");
  if (el) { const m = el.textContent.trim().match(/(\d+):(\d+)/); return m ? (+m[1] * 60 + +m[2]) : 0; }
  return document.getElementById("answer") ? -1 : null;
});
const DEBUG = process.env.TSDEBUG === "1";

let PIN;
async function joinTeam(browser, team) {
  const pg = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pg.goto(APP);
  await pg.fill("#pin", PIN); await pg.waitForTimeout(1000);
  await pg.fill("#pname", team + "-cap"); await pg.click("#pEnterBtn");
  await pg.waitForSelector("#newteam", { timeout: 15000 });
  await pg.fill("#newteam", team);
  await pg.getByRole("button", { name: "Create" }).click();
  await pg.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
  return pg;
}

async function main() {
  PIN = JSON.parse(ctl("setup")).pin;
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });

  const alpha = await joinTeam(browser, "Alpha"); await sleep(400);
  const beta = await joinTeam(browser, "Beta"); await sleep(400);
  const gamma = await joinTeam(browser, "Gamma"); await sleep(400);

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

  const panel = await ad.locator("main").innerText();
  ok("controls show the Stagger card", /Stagger team starts/i.test(panel));
  ok("each team card has a Start now button", (await ad.locator('button:has-text("Start now")').count()) >= 3);

  // stagger from now, 0.5 min gap => Alpha now, Beta +30s, Gamma +60s
  await ad.fill("#stgGap", "0.5");
  await ad.waitForTimeout(200);
  await ad.getByRole("button", { name: "From now" }).click();
  await sleep(2800);
  const after = await ad.locator("main").innerText();
  if (DEBUG) {
    console.log("  [dbg] stgBase=", await ad.inputValue("#stgBase").catch(() => "?"), "gap=", await ad.inputValue("#stgGap").catch(() => "?"));
    console.log("  [dbg] admin cards:", (after.match(/(Started|starts in [^\n·]*|no start set)/g) || []).join(" | "));
  }
  ok("admin cards show a staggered 'starts in' after Apply", /starts in/i.test(after), (after.match(/starts in [^\n·]*/g) || []).join(", "));

  await Promise.all([alpha, beta, gamma].map(p => p.reload().then(() => p.waitForTimeout(2600))));
  if (DEBUG) for (const [n, pg] of [["Alpha", alpha], ["Beta", beta], ["Gamma", gamma]])
    console.log("  [dbg] " + n + ":", (await pg.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 90));
  const [ca, cb, cg] = await Promise.all([countdown(alpha), countdown(beta), countdown(gamma)]);
  console.log(`   countdowns: Alpha=${ca}  Beta=${cb}  Gamma=${cg}`);
  ok("Alpha in (or ~0), Beta waits, Gamma waits longest", (ca === -1 || ca <= 3) && cb > 5 && cg > cb, `A=${ca} B=${cb} G=${cg}`);
  ok("the countdowns are genuinely staggered (~30s apart)", cg - cb >= 12 && cb - Math.max(0, ca) >= 8, `gaps ${cb - Math.max(0, ca)} / ${cg - cb}`);

  // Start Gamma now from the admin — target the tightest card wrapping "Gamma" that has the button
  const gammaCard = ad.locator('div')
    .filter({ has: ad.locator('strong', { hasText: /^Gamma$/ }) })
    .filter({ has: ad.getByRole('button', { name: 'Start now' }) }).last();
  await gammaCard.getByRole('button', { name: 'Start now' }).click();
  await sleep(2500);
  await gamma.reload(); await sleep(2600);
  const gAfter = await countdown(gamma);
  ok("'Start now' pulls Gamma into the game", gAfter === -1, `Gamma countdown=${gAfter}`);   // -1 = in the game

  await browser.close();
  ctl("teardown");
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
