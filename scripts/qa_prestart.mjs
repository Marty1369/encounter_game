// qa_prestart.mjs — a player who joins an ACTIVATED but NOT-YET-STARTED game (registration
// open, host hasn't pressed Start). Asserts: honest waiting screen, no fake 0:00 clock, no
// per-second request storm, and automatic entry the moment the host starts.
// Run: node scripts/qa_prestart.mjs <PIN>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("./../.npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core");
const BROWSER = path.join(process.cwd(), ".pw-browsers", "chromium-1232", "chrome-win64", "chrome.exe");
const URL = "http://localhost:5055/";
const PIN = process.argv[2];
const GAME_ID = process.argv[3];
let pass = 0, fail = 0;
const ok = (n, c, ev = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (ev ? "  — " + String(ev).replace(/\s+/g, " ").slice(0, 110) : "")); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  let stateCalls = 0;                       // count get_state hits — the storm indicator
  page.on("request", r => { if (/rpc\/get_state/.test(r.url())) stateCalls++; });

  await page.goto(`${URL}?pin=${PIN}&team=Laukiantys`);
  await page.waitForTimeout(1200);
  await page.fill("#pname", "Klaudijus");
  await page.click("#pEnterBtn");
  await page.waitForSelector("#newteam", { timeout: 15000 });
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });

  await sleep(1000);
  let t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  ok("Pre-start screen is honest (no fake 'Game starts in 0:00')", !/GAME STARTS IN/i.test(t) && !/0:00/.test(t), t.slice(0, 120));
  ok("Tells the player the game will start by itself", /Waiting for the host/i.test(t));
  ok("Invite card + game code still offered while waiting", /Invite teammates/i.test(t) && t.includes(PIN));

  stateCalls = 0;                            // measure the storm over a quiet 12s
  await sleep(12000);
  ok(`No per-second request storm while waiting (12s -> ${stateCalls} get_state calls)`,
     stateCalls <= 3, `${stateCalls} calls in 12s (was ~12 before the fix: one per second, per player)`);

  // host starts -> player must enter on their own
  console.log("\n>>> host presses START GAME\n");
  execFileSync("node", ["scripts/qa_ctl_start.mjs", GAME_ID], { cwd: process.cwd(), encoding: "utf8" });
  const t0 = Date.now();
  const entered = await page.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 25000 })
    .then(() => true).catch(() => false);
  ok("Player enters the challenge automatically after the host starts", entered,
     entered ? `entered after ${((Date.now() - t0) / 1000).toFixed(1)}s, no tap` : "still stuck");

  await browser.close();
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
