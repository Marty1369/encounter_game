// qa_dropoff.mjs — the player scenarios the first QA pass never reached:
// connection loss / drop-off / outbox flush / reload-restore / lost session / end+leaderboard,
// plus a clean re-test of the two disputed FAILs on a FRESH game.
// Run: node scripts/qa_dropoff.mjs
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("./../.npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core");
const ROOT = process.cwd();
const BROWSER = path.join(ROOT, ".pw-browsers", "chromium-1232", "chrome-win64", "chrome.exe");
const URL = "http://localhost:5055/";

const ctl = (...a) => execFileSync("node", ["scripts/qa_ctl.mjs", ...a], { cwd: ROOT, encoding: "utf8" }).trim();
const rows = [];
const add = (id, test, pri, status, ev) => {
  rows.push({ id, test, pri, status, ev: String(ev).replace(/\s+/g, " ").trim().slice(0, 300) });
  console.log(`${status.padEnd(12)} ${id}  ${rows.at(-1).ev.slice(0, 130)}`);
};
const txt = async p => (await p.locator("body").innerText()).replace(/\s+/g, " ").trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function join(page, pin, name, team) {
  await page.goto(URL);
  await page.fill("#pin", pin);
  await page.waitForTimeout(900);                 // debounced lookup
  await page.fill("#pname", name);
  await page.click("#pEnterBtn");
  await page.waitForSelector("#newteam", { timeout: 15000 });
  await page.fill("#newteam", team);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
}

async function main() {
  const fresh = JSON.parse(ctl("setup"));
  const PIN = fresh.pin;
  console.log("fresh QA game PIN:", PIN, "\n");
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- disputed FAIL #1: JOIN-01 — the card must say "Registration open" BEFORE entering
  await page.goto(URL);
  await page.fill("#pin", PIN);
  await page.waitForTimeout(1200);
  const cardText = await txt(page);
  const enterEnabled = await page.evaluate(() => !document.getElementById("pEnterBtn").disabled);
  add("JOIN-01", "PIN lookup shows game card + 'Registration open' before entering", "P0",
      /Registration open/i.test(cardText) ? "PASS" : "FAIL",
      `card="${cardText.slice(0, 150)}" | enterEnabledWithoutName=${enterEnabled}`);

  await page.fill("#pname", "Captain");
  await page.click("#pEnterBtn");
  await page.waitForSelector("#newteam", { timeout: 15000 });
  add("JOIN-01b", "Name + Enter opens the team screen", "P0", "PASS", "team screen reached (#newteam present)");

  // ---- disputed FAIL #2: COUNT-01 — countdown + invite card + code
  ctl("schedule", "40");
  await page.fill("#newteam", "Alpha");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
  await sleep(1500);
  const cd = await txt(page);
  const qr = await page.evaluate(() => ({ svg: !!document.querySelector("#pQR svg"), pin: localStorage.q_pin }));
  const hasCode = cd.includes(PIN);
  add("COUNT-01", "Countdown screen shows invite card + game code + QR", "P0",
      (/GAME STARTS IN/i.test(cd) && /Invite teammates/i.test(cd) && hasCode && qr.svg) ? "PASS" : "FAIL",
      `countdown=${/GAME STARTS IN/i.test(cd)} invite=${/Invite teammates/i.test(cd)} codeShown=${hasCode} qrSvg=${qr.svg}`);

  // Early start: host hits "Start game" while players wait on the countdown. They must be taken
  // into the challenge automatically (one poll, <=10s) — not parked on a lobby needing a tap.
  ctl("start");
  const t0 = Date.now();
  const autoIn = await page.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 30000 })
    .then(() => true).catch(() => false);
  const landed = await txt(page);
  add("COUNT-02", "Early start takes waiting players into the challenge automatically", "P0",
      autoIn ? "PASS" : "FAIL",
      autoIn ? `#answer appeared after ${((Date.now() - t0) / 1000).toFixed(1)}s (no tap needed)`
             : `stuck: "${landed.slice(0, 120)}"`);
  if (!autoIn) {                                      // keep the run going so later cases still report
    await page.getByRole("button", { name: "Enter the game" }).click().catch(() => {});
    await page.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 20000 });
  }

  // ---- DROP-OFF: submit while offline
  await ctx.setOffline(true);
  await page.fill("#answer", "alpha");
  await page.getByRole("button", { name: "Submit" }).click();
  await sleep(2500);
  const offFb = await page.evaluate(() => (document.getElementById("pFb") || {}).innerText || "");
  const outbox = await page.evaluate(() => JSON.parse(localStorage.q_outbox || "[]"));
  add("DROP-01", "Answer submitted while OFFLINE is queued, not lost", "P0",
      (outbox.length === 1 && /saved|connection/i.test(offFb)) ? "PASS" : "FAIL",
      `feedback="${offFb.trim()}" outbox=${outbox.length} item=${JSON.stringify(outbox[0] || {}).slice(0, 90)}`);
  const stillQ1 = await txt(page);
  add("DROP-02", "Offline player is not advanced optimistically (no lying UI)", "P0",
      /Challenge 1 of/.test(stillQ1) ? "PASS" : "FAIL", `screen shows: ${stillQ1.match(/Challenge \d+ of \d+/)?.[0]}`);

  // ---- RECONNECT: outbox must flush exactly once
  await ctx.setOffline(false);
  await page.waitForFunction(() => JSON.parse(localStorage.q_outbox || "[]").length === 0, null, { timeout: 25000 })
    .catch(() => {});
  await page.waitForFunction(() => /Challenge 2 of/.test(document.body.innerText), null, { timeout: 25000 }).catch(() => {});
  const afterOnline = await txt(page);
  const ob2 = await page.evaluate(() => JSON.parse(localStorage.q_outbox || "[]").length);
  const teams = JSON.parse(ctl("teams"));
  const alpha = teams.find(t => t.name === "Alpha") || {};
  add("DROP-03", "Reconnect flushes the queued answer and it is accepted", "P0",
      (/Challenge 2 of/.test(afterOnline) && ob2 === 0) ? "PASS" : "FAIL",
      `screen=${afterOnline.match(/Challenge \d+ of \d+/)?.[0]} outboxAfter=${ob2}`);
  add("DROP-04", "Queued answer advances the team EXACTLY once (no double-advance)", "P0",
      alpha.stage === 2 ? "PASS" : "FAIL", `server-side team stage=${alpha.stage} (expected 2) splits=${JSON.stringify(alpha.splits)}`);

  // ---- RELOAD: session restore
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 20000 });
  const afterReload = await txt(page);
  add("DROP-05", "Reload mid-game restores the session and the same challenge", "P0",
      /Challenge 2 of/.test(afterReload) ? "PASS" : "FAIL", `after reload: ${afterReload.match(/Challenge \d+ of \d+/)?.[0]}`);

  // ---- background/idle
  await sleep(12000);
  const idle = await txt(page);
  add("DROP-06", "Idle ~12s (past the poll) keeps the player in the game, no crash", "P1",
      /Challenge 2 of/.test(idle) ? "PASS" : "FAIL", `still on ${idle.match(/Challenge \d+ of \d+/)?.[0]}`);

  // ---- lost session (own context: localStorage is shared per-context, wiping it here must not
  //      log our real player out mid-run)
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  await p2.evaluate(() => { localStorage.removeItem("q_token"); });
  await p2.reload();
  const backToPin = await p2.waitForSelector("#pin", { timeout: 15000 }).then(() => true).catch(() => false);
  add("DROP-07", "Lost session falls back to the PIN screen without crashing", "P0",
      backToPin ? "PASS" : "FAIL", "#pin screen restored after token wipe");
  await ctx2.close();

  // ---- finish -> done screen + tabs
  for (const ans of ["bravo", "ChArLie", "delta"]) {
    await page.waitForSelector("#answer", { timeout: 20000 });
    await page.fill("#answer", ans);
    await page.getByRole("button", { name: "Submit" }).click();
    await sleep(2500);
  }
  await page.waitForFunction(() => /Quest complete|Game over/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  const done = await txt(page);
  add("END-01", "Finishing all challenges reaches the done screen", "P0",
      /Quest complete/i.test(done) ? "PASS" : "FAIL", done.slice(0, 150));
  const hasTabs = /Overall/.test(done) && /Per question/.test(done);
  add("END-02", "Done screen offers Overall + Per question leaderboard tabs", "P0", hasTabs ? "PASS" : "FAIL",
      `Overall=${/Overall/.test(done)} PerQuestion=${/Per question/.test(done)}`);
  if (hasTabs) {
    await page.getByRole("button", { name: "Per question" }).click();
    await sleep(1200);
    const per = await txt(page);
    add("END-03", "Per-question tab lists per-challenge split times", "P0", /Q1/.test(per) ? "PASS" : "FAIL", per.slice(0, 160));
  }
  const ended = JSON.parse(ctl("status"));
  add("END-04", "Game auto-ends once every team has finished", "P0", ended.status === "ended" ? "PASS" : "FAIL",
      `server status=${ended.status}`);

  await browser.close();
  ctl("teardown");

  const c = s => rows.filter(r => r.status === s).length;
  console.log(`\n===== PASS ${c("PASS")} · FAIL ${c("FAIL")} · BLOCKER ${c("BLOCKER")} =====`);
  console.log(JSON.stringify(rows, null, 1));
  process.exit(c("FAIL") + c("BLOCKER") ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
