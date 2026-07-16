// qa_tabs_autojoin.mjs — captain creates a team, teammate scans the captain's QR:
// must be AUTO-ASSIGNED to that team (no picker). Also checks the topbar tabs swap to
// Game | Leaderboard while playing, and stay Player | Game creator before joining.
// Run: node scripts/qa_tabs_autojoin.mjs
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
const tabs = p => p.$$eval("#roleTabs button", b => b.map(x => x.textContent.trim()));

async function main() {
  const g = JSON.parse(ctl("setup"));
  const PIN = g.pin;
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });

  // ---------- captain ----------
  const cap = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await cap.goto(APP);
  ok("Before joining: tabs are Player | Game creator", JSON.stringify(await tabs(cap)) === '["Player","Game creator"]',
     (await tabs(cap)).join(" | "));
  await cap.fill("#pin", PIN); await cap.waitForTimeout(1000);
  await cap.fill("#pname", "Kapitonas"); await cap.click("#pEnterBtn");
  await cap.waitForSelector("#newteam", { timeout: 15000 });
  await cap.fill("#newteam", "Vilkai");
  await cap.getByRole("button", { name: "Create" }).click();
  await cap.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
  await sleep(1200);

  // the captain's invite link must carry the game code + this team's fragment
  const invite = await cap.evaluate(() => inviteURL());
  const u = new URL(invite);
  ok("Captain's QR link = game code + team fragment",
     u.searchParams.get("pin") === PIN && /^[0-9a-f]{6}$/.test(u.searchParams.get("t") || ""), invite);

  // ---------- a second captain, so auto-assign has to pick the RIGHT team ----------
  const cap2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await cap2.goto(APP);
  await cap2.fill("#pin", PIN); await cap2.waitForTimeout(1000);
  await cap2.fill("#pname", "Kapitonas2"); await cap2.click("#pEnterBtn");
  await cap2.waitForSelector("#newteam", { timeout: 15000 });
  await cap2.fill("#newteam", "Lapes");
  await cap2.getByRole("button", { name: "Create" }).click();
  await cap2.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });

  // ---------- teammate scans captain 1's QR ----------
  const mate = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await mate.goto(invite);
  await mate.waitForTimeout(1500);
  const card = (await mate.locator("body").innerText()).replace(/\s+/g, " ");
  ok("Scanned QR shows which team you're joining", /Joining team Vilkai/i.test(card), card.slice(0, 140));
  await mate.fill("#pname", "Bendrazygis");
  await mate.click("#pEnterBtn");
  // must NOT see the team picker
  const sawPicker = await mate.waitForSelector("#newteam", { timeout: 4000 }).then(() => true).catch(() => false);
  ok("No team picker after scanning a team QR (auto-assigned)", !sawPicker);
  await mate.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
  await sleep(1200);

  const teams = JSON.parse(ctl("teams"));
  const vilkai = teams.find(t => t.name === "Vilkai") || {}, lapes = teams.find(t => t.name === "Lapes") || {};
  ok("Teammate landed in the captain's team (Vilkai=2 players)", vilkai.players === 2,
     JSON.stringify(teams.map(t => ({ n: t.name, p: t.players }))));
  ok("The other captain's team is untouched (Lapes=1)", lapes.players === 1);
  ok("No stray team was created", teams.length === 2, `${teams.length} teams`);

  // ---------- the two QRs must NOT be the same thing ----------
  const gameQR = APP + "?pin=" + PIN;                 // what the admin shows captains
  ok("Game QR (admin) and team QR (captain) are different links",
     invite !== gameQR && /[?&]t=[0-9a-f]{6}/.test(invite) && !/[?&]t=/.test(gameQR),
     `game=${gameQR}  team=${invite}`);
  const capt3 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await capt3.goto(gameQR);                            // scanning the GAME qr must still ask to create
  await capt3.waitForTimeout(1200);
  await capt3.fill("#pname", "Kapitonas3"); await capt3.click("#pEnterBtn");
  const gotPicker = await capt3.waitForSelector("#newteam", { timeout: 6000 }).then(() => true).catch(() => false);
  ok("Game QR still leads to team creation (picker), not auto-join", gotPicker);
  await capt3.close();

  // ---------- typed joining code (read aloud / handed over) ----------
  const teamsNow = JSON.parse(ctl("teams"));
  const typed = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await typed.goto(APP);
  const frag = new URL(invite).searchParams.get("t");
  await typed.fill("#pin", `${PIN}-${frag}`);          // typed, not scanned
  await typed.waitForTimeout(1200);
  const typedCard = (await typed.locator("body").innerText()).replace(/\s+/g, " ");
  ok("Typing 'PIN-fragment' resolves the team", /Joining team Vilkai/i.test(typedCard), typedCard.slice(0, 120));
  await typed.fill("#pname", "Pavelavo");
  await typed.click("#pEnterBtn");
  const typedPicker = await typed.waitForSelector("#newteam", { timeout: 4000 }).then(() => true).catch(() => false);
  ok("Typed code auto-joins too (no picker)", !typedPicker);
  await typed.waitForFunction(() => !!localStorage.q_token, null, { timeout: 15000 });
  await sleep(1200);
  const after = JSON.parse(ctl("teams"));
  ok("Typed code put them in Vilkai (now 3), no new team",
     (after.find(t => t.name === "Vilkai") || {}).players === 3 && after.length === teamsNow.length,
     JSON.stringify(after.map(t => ({ n: t.name, p: t.players }))));
  await typed.close();

  // ---------- tabs while in a game ----------
  ctl("start");
  await mate.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 25000 });
  ok("In a game: tabs become Game | Leaderboard", JSON.stringify(await tabs(mate)) === '["Game","Leaderboard"]',
     (await tabs(mate)).join(" | "));
  const gameTxt = (await mate.locator("body").innerText());
  ok("Standings no longer sit at the bottom of the game screen", !/Standings/i.test(gameTxt));

  await mate.getByRole("button", { name: "Leaderboard" }).click();
  await sleep(1200);
  const lb = (await mate.locator("body").innerText()).replace(/\s+/g, " ");
  ok("Leaderboard tab shows the live standings", /Leaderboard/.test(lb) && /Vilkai/.test(lb) && /Lapes/.test(lb), lb.slice(0, 130));
  // The captain's team QR must survive the game starting — before this it only existed on the
  // countdown/lobby, which are unreachable once you enter the game, leaving only the admin's
  // basic game QR.
  const lbInvite = await mate.evaluate(() => ({
    hasCard: /Invite teammates/i.test(document.body.innerText),
    qr: (document.getElementById("pQR") || {}).dataset?.qr || null,
    svg: !!document.querySelector("#pQR svg"),
  }));
  ok("Team QR is still reachable mid-game (Leaderboard tab)",
     lbInvite.hasCard && lbInvite.svg && /[?&]t=[0-9a-f]{6}/.test(lbInvite.qr || ""), JSON.stringify(lbInvite));
  ok("...and it is the TEAM QR, not the basic game QR", !!lbInvite.qr && lbInvite.qr !== `${APP}?pin=${PIN}`, lbInvite.qr);

  await mate.getByRole("button", { name: "Back to the game" }).click();
  await sleep(800);
  ok("Back to the game returns to the challenge", !!(await mate.$("#answer")));

  // a pause must still win over the leaderboard tab
  await mate.getByRole("button", { name: "Leaderboard" }).click();
  await sleep(600);
  ctl("pause", "QA pause");
  await mate.waitForFunction(() => /Game paused/i.test(document.body.innerText), null, { timeout: 20000 })
    .then(() => ok("Pause still reaches a player sitting on the Leaderboard tab", true))
    .catch(() => ok("Pause still reaches a player sitting on the Leaderboard tab", false));
  ctl("resume");

  await browser.close();
  ctl("teardown");
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
