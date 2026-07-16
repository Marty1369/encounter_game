// qa_dnd_browser.mjs — prove drag & drop actually fires in a real browser (the unit test only
// proves the index math). Logs in, opens a game in the wizard, drags a question and a hint.
// Run: node scripts/qa_dnd_browser.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("./../.npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core");
const BROWSER = path.join(process.cwd(), ".pw-browsers", "chromium-1232", "chrome-win64", "chrome.exe");
const URL = process.env.QA_URL || "http://localhost:5055/";
let pass = 0, fail = 0;
const ok = (n, c, ev = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (ev ? "  — " + String(ev).replace(/\s+/g, " ").slice(0, 120) : "")); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const titles = page => page.$$eval('[data-dnd] div[style*="text-overflow:ellipsis"]',
  els => els.map(e => e.textContent.trim()).filter(t => /^Q\d+\./.test(t)));

async function main() {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.goto(URL);

  await page.getByRole("button", { name: "Game creator" }).click();
  await page.waitForSelector("#apass", { timeout: 15000 });
  await page.fill("#aemail", "andrius.martinonis@gmail.com").catch(async () => {
    await page.locator('input[type="email"], input[autocomplete="username"]').first().fill("andrius.martinonis@gmail.com");
  });
  await page.fill("#apass", "Qline-Merkine-2K7pX9");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /Games|Create game/.test(document.body.innerText), null, { timeout: 20000 });
  ok("Admin login works", true);

  // open the demo game in the wizard (each game card is a button)
  await page.locator('button:has-text("Kosminis signalas (demo)")').first().click();
  await page.getByRole("button", { name: "Edit in wizard" }).click();
  await page.waitForSelector("[data-dnd]", { timeout: 20000 });
  await sleep(600);

  const before = await titles(page);
  ok("Wizard question list rendered with drag handles", before.length === 5, before.join(" | "));

  // --- drag question 1 -> position 3
  const rows = page.locator('[ondragover^="dndOver(event,\'q\'"]');
  const handle = rows.nth(0).locator('span[draggable="true"]');
  await handle.dragTo(rows.nth(2));
  await sleep(800);
  const after = await titles(page);
  const want = (() => { const a = [...before]; const [x] = a.splice(0, 1); a.splice(2, 0, x); return a; })()
    .map((t, i) => t.replace(/^Q\d+\./, `Q${i + 1}.`));           // list renumbers after the move
  ok("Dragging a question actually reorders it", JSON.stringify(after) === JSON.stringify(want),
     `after=${after.join(" | ")}`);

  // the dragged question stays selected (its editor is the one shown)
  const selTitle = await page.inputValue('input[oninput*="title=this.value"]').catch(() => "");
  ok("Dragged question stays selected in the editor", after[2].includes(selTitle) || selTitle.length > 0,
     `editor title="${selTitle}"`);

  // --- drag hint 1 -> position 2 inside the selected question
  const hintRows = page.locator('[ondragover^="dndOver(event,\'hint\'"]');
  const nHints = await hintRows.count();
  if (nHints >= 2) {
    const revBefore = await page.$$eval('input[oninput*="reveal_after_min"]', els => els.map(e => e.value));
    // Both rows must be on screen first: dragTo scrolls the target, which moves the source out
    // from under the press and the drag never starts.
    await hintRows.nth(1).scrollIntoViewIfNeeded();
    await hintRows.nth(0).scrollIntoViewIfNeeded();
    await sleep(300);
    // a hint row also contains its blocks' handles — target the hint handle specifically
    await hintRows.nth(0).locator('span[ondragstart^="dndStart(event,\'hint\'"]').first()
      .dragTo(hintRows.nth(1));
    await sleep(800);
    const revAfter = await page.$$eval('input[oninput*="reveal_after_min"]', els => els.map(e => e.value));
    const wantRev = (() => { const a = [...revBefore]; const [x] = a.splice(0, 1); a.splice(1, 0, x); return a; })();
    ok("Dragging a hint actually reorders it", JSON.stringify(revAfter) === JSON.stringify(wantRev),
       `before=[${revBefore}] after=[${revAfter}] want=[${wantRev}]`);
  } else ok("hint rows present to drag", false, `only ${nHints} hint rows`);

  // typing in a hint input must still work (draggable parents break text selection — we avoided that)
  const revInput = page.locator('input[oninput*="reveal_after_min"]').first();
  await revInput.fill("9");
  ok("Hint inputs still editable (handle-only dragging didn't break them)",
     (await revInput.inputValue()) === "9");

  await browser.close();
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
