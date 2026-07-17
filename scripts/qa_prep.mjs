// qa_prep.mjs — preparation notes: survive save/load/duplicate/XLSX, and NEVER reach a player.
// Run: node scripts/qa_prep.mjs
import "dotenv/config";
import fs from "fs";
import XLSX from "xlsx";

const SB = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const rpc = async (fn, a) => {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  return r.json();
};
let TOKEN;
const login = async () => { TOKEN = (await rpc("admin_login", { p_email: "andrius.martinonis@gmail.com", p_password: "Qline-Merkine-2K7pX9" })).token; };
const A = async (fn, a = {}) => {
  let r = await rpc(fn, { p_code: TOKEN, ...a });
  if (r && r.error === "forbidden") { await login(); r = await rpc(fn, { p_code: TOKEN, ...a }); }
  return r;
};
let pass = 0, fail = 0;
const ok = (n, c, ev = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (ev ? "  — " + String(ev).replace(/\s+/g, " ").slice(0, 130) : "")); c ? pass++ : fail++; };

// the real export/import functions out of the app
const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
function grab(name) {
  const re = new RegExp("^(?:const |function )" + name + "\\b", "m");
  const m = re.exec(html); if (!m) throw new Error("missing " + name);
  if (/^const /.test(m[0])) return html.slice(m.index, html.indexOf("\n", m.index));
  let i = html.indexOf("{", m.index), d = 0, j = i;
  for (; j < html.length; j++) { const c = html[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
  return html.slice(m.index, j);
}
const src = ["_mt", "_mtOut", "_packBlocks", "buildGameWb", "gameToWizQs", "parseGameWb"].map(grab).join("\n");
const { buildGameWb, gameToWizQs, parseGameWb } = new Function("XLSX", src + "\nreturn {buildGameWb,gameToWizQs,parseGameWb};")(XLSX);

const PREP = "Print binary table (A4, laminated).\nCable-tie to fence post by the road.\nChalk KMUO on 3rd stump, ~1m up.\nTake: chalk, 2 ties, spare printout.";
const NAME = "ZZ QA Prep";

async function main() {
  await login();
  for (const g of ((await A("admin_list")).games || []).filter(g => g.name === NAME)) await A("admin_delete_game", { p_game: g.id });

  const saved = await A("admin_save_game", { p_payload: { id: "", name: NAME, max_teams: 5, duration_min: 60, questions: [
    { title: "Q1 prepped", intro: "story", info: "callout", prep: PREP, answer: "alpha", case_sensitive: false,
      blocks: [{ type: "text", text: "body" }], hints: [{ reveal_after_min: 0, blocks: [{ type: "text", text: "h" }] }] },
    { title: "Q2 no prep", answer: "bravo", case_sensitive: false, blocks: [{ type: "text", text: "b" }], hints: [] },
  ] } });
  ok("save accepts prep", saved.ok === true, JSON.stringify(saved));

  const full = await A("admin_get_game", { p_game: saved.id });
  ok("admin_get_game returns prep verbatim (newlines intact)", full.questions[0].prep === PREP, JSON.stringify(full.questions[0].prep));
  ok("a question without prep stays empty", !full.questions[1].prep, JSON.stringify(full.questions[1].prep));

  // ---- the important one: a player must never receive it
  await A("admin_activate", { p_game: saved.id });
  const tok = (await rpc("join_game", { p_pin: saved.pin, p_team: "T", p_name: "n" })).session_token;
  await A("admin_start_now", { p_game: saved.id });
  const st = await rpc("get_state", { p_session: tok });
  const blob = JSON.stringify(st);
  ok("player state does NOT contain the prep text", !blob.includes("Cable-tie") && !blob.includes("KMUO"), blob.slice(0, 90));
  ok("player state has no prep field at all", !("prep" in (st.question || {})), JSON.stringify(Object.keys(st.question || {})));
  ok("...while the player still gets the fields meant for them", st.question.intro === "story" && st.question.info === "callout");

  // ---- duplicate carries it
  const dup = await A("admin_duplicate", { p_game: saved.id });
  const dupGame = await A("admin_get_game", { p_game: dup.id });
  ok("duplicate keeps prep", dupGame.questions[0].prep === PREP, JSON.stringify(dupGame.questions[0].prep));
  await A("admin_delete_game", { p_game: dup.id });

  // ---- XLSX round-trip
  const qs = gameToWizQs(full);
  ok("export shape carries prep", qs[0].prep === PREP);
  const wb = buildGameWb(full.name, full.description, full.max_teams, qs);
  const back = parseGameWb(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" }));
  ok("prep survives export -> .xlsx -> import", back.questions[0].prep === PREP, JSON.stringify(back.questions[0].prep));
  ok("blank prep stays blank through the trip", !back.questions[1].prep);
  const hdr = XLSX.utils.sheet_to_json(wb.Sheets.Questions, { header: 1 })[0];
  ok("Questions sheet has a Preparation column", hdr.includes("Preparation"), hdr.join(","));

  // ---- old sheets without the column must still import
  const old = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(old, XLSX.utils.aoa_to_sheet([
    ["Title", "Intro", "Answer", "Info", "CaseSensitive", "Text", "MediaType", "MediaURL"],
    ["Old", "in", "ANS", "nfo", "no", "body", "", ""]]), "Questions");
  const oldBack = parseGameWb(XLSX.read(XLSX.write(old, { type: "buffer", bookType: "xlsx" }), { type: "buffer" }));
  ok("sheets without a Preparation column still import", oldBack.questions.length === 1 && !oldBack.questions[0].prep);

  await A("admin_delete_game", { p_game: saved.id });
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
