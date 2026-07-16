// qa_playthrough.mjs — play my demo game end to end in a real browser and assert every feature.
// Run: node scripts/qa_playthrough.mjs <PIN>
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("./../.npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core");
const BROWSER = path.join(process.cwd(), ".pw-browsers", "chromium-1232", "chrome-win64", "chrome.exe");
const URL = process.env.QA_URL || "http://localhost:5055/";
const PIN = process.argv[2];
if (!PIN) { console.error("usage: node scripts/qa_playthrough.mjs <PIN>"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, ev = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (ev ? "  — " + String(ev).replace(/\s+/g, " ").slice(0, 110) : "")); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const body = async p => (await p.locator("body").innerText());

async function submit(page, ans) {
  await page.waitForSelector("#answer", { timeout: 20000 });
  await page.fill("#answer", ans);
  await page.getByRole("button", { name: "Submit" }).click();
  await sleep(2200);
}

async function main() {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });   // phone-sized
  const page = await ctx.newPage();

  // --- join through the invite deep link (what a scanned QR does), phone viewport
  await page.goto(`${URL}?pin=${PIN}&team=Testuotojai`);
  await page.waitForTimeout(1500);
  const pinVal = await page.inputValue("#pin");
  ok("QR deep link pre-fills the PIN", pinVal.toUpperCase() === PIN, `#pin="${pinVal}"`);
  await page.fill("#pname", "Klaudijus");
  await page.click("#pEnterBtn");
  await page.waitForSelector("#newteam", { timeout: 15000 });
  ok("Team name pre-filled from the link", (await page.inputValue("#newteam")) === "Testuotojai");
  await page.getByRole("button", { name: "Create" }).click();
  // Joining a game that is ALREADY running lands on the lobby by design (the auto-enter is for
  // players who waited through the countdown). Step through it.
  const lobbyBtn = page.getByRole("button", { name: "Enter the game" });
  await Promise.race([
    page.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 25000 }).catch(() => {}),
    lobbyBtn.waitFor({ timeout: 25000 }).catch(() => {}),
  ]);
  if (!(await page.$("#answer"))) {
    ok("Late joiner gets the lobby with an 'Enter the game' button", await lobbyBtn.isVisible().catch(() => false));
    await lobbyBtn.click();
  }
  await page.waitForFunction(() => !!document.getElementById("answer"), null, { timeout: 20000 });
  ok("Reached the first challenge", true);

  // --- U1: video + multi-line riddle + Important callout + hint gating
  let t = await body(page);
  const u1 = await page.evaluate(() => ({
    video: !!document.querySelector("video"),
    fsBtn: [...document.querySelectorAll("button")].some(b => /PLAY VIDEO/i.test(b.textContent)),
    preLine: [...document.querySelectorAll("div")].some(d => getComputedStyle(d).whiteSpace === "pre-line" && d.innerText.includes("Kalbu be burnos")),
  }));
  ok("U1 renders the video inline", u1.video);
  ok("U1 offers the fullscreen PLAY VIDEO button", u1.fsBtn);
  ok("U1 multi-line riddle keeps its line breaks", u1.preLine);
  ok("U1 shows the Important callout", /IMPORTANT/i.test(t) && /diakritikais/i.test(t), t.match(/IMPORTANT[^\n]*/)?.[0]);
  ok("U1 hint 1 unlocked at 0 min", /Kalnuose ar tu/i.test(t));
  ok("U1 hint 2 still locked (2 min)", /unlocks in/i.test(t) && !/garso atspindys/i.test(t));

  // wrong answer, then the real one typed WITHOUT diacritics/case
  await submit(page, "sviesa");
  ok("Wrong answer rejected", /Not quite/i.test(await body(page)));
  await submit(page, "aidas");
  t = await body(page);
  ok("U1 accepts 'aidas' (lowercase, answer stored as AIDAS)", /Challenge 2 of 5/.test(t), t.match(/Challenge \d of \d/)?.[0]);

  // --- U2: multi-line sequence
  await submit(page, "17");
  t = await body(page);
  ok("U2 accepts 17", /Challenge 3 of 5/.test(t), t.match(/Challenge \d of \d/)?.[0]);

  // --- U3: image + Lithuanian diacritics (stored ŽIRGAS, typed zirgas)
  const hasImg = await page.evaluate(() => !!document.querySelector("img"));
  ok("U3 renders the image", hasImg);
  await submit(page, "zirgas");
  t = await body(page);
  ok("U3 accepts 'zirgas' for stored 'ŽIRGAS' (diacritics folded)", /Challenge 4 of 5/.test(t), t.match(/Challenge \d of \d/)?.[0]);

  // --- U4: case-sensitive
  await submit(page, "aitvaras");
  ok("U4 rejects wrong case 'aitvaras'", /Not quite/i.test(await body(page)));
  await submit(page, "AiTvArAs");
  t = await body(page);
  ok("U4 accepts exact case 'AiTvArAs'", /Challenge 5 of 5/.test(t), t.match(/Challenge \d of \d/)?.[0]);

  // --- U5: link block + morse
  const link = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")].find(x => /morsecode\.world/.test(x.href));
    return a ? { href: a.href, blank: a.target === "_blank", rel: a.rel } : null;
  });
  ok("U5 renders the link block (opens safely in a new tab)", !!link && link.blank && /noopener/.test(link.rel || ""), link?.href);
  await submit(page, "GALAS");

  // --- finish
  await page.waitForFunction(() => /Quest complete/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  t = await body(page);
  ok("Finished -> Quest complete", /Quest complete/i.test(t), t.replace(/\s+/g, " ").slice(0, 90));
  ok("Final rank + total time shown", /FINAL RANK/i.test(t) && /TOTAL TIME/i.test(t));
  ok("Leaderboard has Overall + Per question tabs", /Overall/.test(t) && /Per question/.test(t));
  await page.getByRole("button", { name: "Per question" }).click();
  await sleep(1200);
  const per = await body(page);
  ok("Per-question tab lists all 5 splits", (per.match(/Q[1-5]\b/g) || []).length >= 5, (per.match(/Q\d [^ ]+/g) || []).join(" "));

  await browser.close();
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
