// qa_prep_theme_ui.mjs — drive the real admin UI: Preparation tab, prep sheet, no leak into the
// player preview; then apply Neon to a game and check the player frame really renders it.
// Run: node scripts/qa_prep_theme_ui.mjs
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
const PREP = "PREPSECRET: chalk KMUO on the third stump";

async function main() {
  const g = JSON.parse(ctl("setup"));
  // A live game is deliberately NOT editable (admin_save_game -> game_live). Put it back to draft
  // BEFORE the browser logs in: there is only one admin session server-side, so any later ctl()
  // call would log in again and boot the browser out.
  ctl("draft");
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const p = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await p.goto(APP);
  await p.getByRole("button", { name: "Game creator" }).click();
  await p.waitForSelector("#apass");
  await p.fill("#aemail", "andrius.martinonis@gmail.com");
  await p.fill("#apass", "Qline-Merkine-2K7pX9");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => /Games/.test(document.body.innerText), null, { timeout: 20000 });

  // ---- new themes are offered
  await p.getByRole("button", { name: "Themes" }).click();
  await sleep(900);
  const themes = await p.locator("main").innerText();
  ok("Neon theme is offered", /Neon/.test(themes));
  ok("Cosmic theme is offered", /Cosmic/.test(themes));

  // ---- Preparation tab in the wizard
  await p.getByRole("button", { name: "Games" }).click(); await sleep(700);
  await p.locator(`button:has-text("ZZ QA Player Flows")`).first().click(); await sleep(800);
  await p.getByRole("button", { name: "Edit in wizard" }).click();
  await p.waitForSelector("[data-dnd]", { timeout: 20000 }); await sleep(600);

  ok("editor shows a Content | Preparation tab bar",
     await p.getByRole("button", { name: "Content", exact: true }).isVisible().catch(() => false));
  await p.getByRole("button", { name: /^Preparation/ }).first().click();
  await sleep(500);
  const prepPane = await p.locator("main").innerText();
  ok("Preparation pane says it is organiser-only", /Never shown to players|organiser-only/i.test(prepPane));
  const ta = p.locator('textarea[oninput*="prep=this.value"]');
  ok("Preparation textarea present", await ta.isVisible());
  await ta.fill(PREP);
  await sleep(400);

  // switching tabs keeps it
  await p.getByRole("button", { name: "Content", exact: true }).click(); await sleep(400);
  const contentPane = await p.locator("main").innerText();
  ok("Content tab does not show prep text", !contentPane.includes("PREPSECRET"));
  await p.getByRole("button", { name: /^Preparation/ }).first().click(); await sleep(400);
  ok("prep survives a tab switch", (await ta.inputValue()) === PREP);

  // ---- Review: prep sheet present, player preview clean
  await p.getByRole("button", { name: /04\s*Review/ }).click(); await sleep(900);
  const review = await p.locator("main").innerText();
  ok("Review shows the Preparation sheet", /Preparation sheet/i.test(review) && review.includes("PREPSECRET"), review.match(/Preparation sheet[^\n]*/)?.[0]);
  ok("Preparation sheet offers Print / save as PDF", /Print \/ save as PDF/i.test(review));
  const previewHasPrep = await p.evaluate(() => {
    const box = document.getElementById("wizPrevBody");
    const themed = [...document.querySelectorAll('div[style*="--th-bg"]')];
    return themed.some(d => d.innerText.includes("PREPSECRET")) || (box ? box.innerText.includes("PREPSECRET") : false);
  });
  ok("player preview does NOT contain prep", !previewHasPrep);

  // ---- save with Neon, then look at the player
  await p.getByRole("button", { name: /03\s*Theme/ }).click(); await sleep(700);
  await p.locator('button:has-text("Neon")').first().click(); await sleep(500);
  await p.getByRole("button", { name: "Save as draft" }).click(); await sleep(2500);

  const savedOk = await p.evaluate(() => !/Error:/.test(document.body.innerText));
  ok("save succeeded (no game_live refusal)", savedOk);

  const pl = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pl.goto(APP);
  await pl.fill("#pin", g.pin); await sleep(1400);
  const themeApplied = await pl.evaluate(() => {
    const f = getComputedStyle(document.getElementById("frame"));
    return { bg: f.getPropertyValue("--th-bg").trim(), primary: f.getPropertyValue("--th-primary").trim(), glow: f.getPropertyValue("--th-glow").trim() };
  });
  ok("player frame picks up the Neon background", /gradient/.test(themeApplied.bg), themeApplied.bg);
  ok("player frame picks up the Neon primary", themeApplied.primary.toLowerCase() === "#f472ff", themeApplied.primary);
  ok("Neon carries a glow", /rgba\(244,114,255/.test(themeApplied.glow), themeApplied.glow);
  const btnGlow = await pl.evaluate(() => {
    const b = document.getElementById("pEnterBtn");
    return b ? getComputedStyle(b).boxShadow : null;
  });
  ok("the CTA button actually renders the glow", !!btnGlow && btnGlow !== "none" && /rgba\(244, 114, 255/.test(btnGlow), btnGlow);

  await browser.close();
  ctl("teardown");
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
