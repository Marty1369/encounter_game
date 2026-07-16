// qa_probe_start.mjs — what does a player waiting on the countdown actually see when the
// host presses "Start game" EARLY? Logs the screen every 2s. Run: node scripts/qa_probe_start.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("./../.npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core");
const ROOT = process.cwd();
const BROWSER = path.join(ROOT, ".pw-browsers", "chromium-1232", "chrome-win64", "chrome.exe");
const URL = "http://localhost:5055/";
const ctl = (...a) => execFileSync("node", ["scripts/qa_ctl.mjs", ...a], { cwd: ROOT, encoding: "utf8" }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const screenOf = async page => page.evaluate(() => {
  const b = document.body.innerText.replace(/\s+/g, " ");
  return { answer: !!document.getElementById("answer"), cd: !!document.getElementById("pCd"),
    enterBtn: [...document.querySelectorAll("button")].some(x => x.textContent.trim() === "Enter the game"),
    name: /GAME STARTS IN/i.test(b) ? "COUNTDOWN" : (document.getElementById("answer") ? "GAME"
      : (/Game in progress/i.test(b) ? "LOBBY" : "other")),
    snippet: b.slice(0, 90) };
});

async function main() {
  const g = JSON.parse(ctl("setup"));
  console.log("PIN", g.pin);
  ctl("schedule", "90");                       // far-off start so we are definitely on the countdown
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto(URL);
  await page.fill("#pin", g.pin); await page.waitForTimeout(900);
  await page.fill("#pname", "Cap"); await page.click("#pEnterBtn");
  await page.waitForSelector("#newteam"); await page.fill("#newteam", "Alpha");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForFunction(() => !!localStorage.q_token);
  await sleep(2000);
  console.log("before start:", JSON.stringify(await screenOf(page)));

  console.log("\n>>> host presses START GAME (early)\n");
  ctl("start");
  for (let t = 2; t <= 30; t += 2) {
    await sleep(2000);
    const s = await screenOf(page);
    console.log(`t+${String(t).padStart(2)}s  ${s.name.padEnd(9)} answer=${s.answer} countdown=${s.cd} enterBtn=${s.enterBtn}  ${s.snippet}`);
    if (s.answer) { console.log("\n=> reached the challenge after ~" + t + "s"); break; }
  }
  await browser.close(); ctl("teardown");
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
