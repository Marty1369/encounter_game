// qa_ctl.mjs — control rig for player-flow QA. Lets a QA agent drive the game
// (create/start/pause/discard/end/inspect) without touching the admin UI.
//
//   node scripts/qa_ctl.mjs setup            -> create + activate a fresh QA game, prints PIN
//   node scripts/qa_ctl.mjs status
//   node scripts/qa_ctl.mjs start            -> start now (overrides schedule)
//   node scripts/qa_ctl.mjs schedule <secs>  -> start in N seconds (for the countdown screen)
//   node scripts/qa_ctl.mjs pause "<msg>"
//   node scripts/qa_ctl.mjs resume
//   node scripts/qa_ctl.mjs discard <ord> "<reason>"
//   node scripts/qa_ctl.mjs end
//   node scripts/qa_ctl.mjs teams            -> roster + per-team progress
//   node scripts/qa_ctl.mjs results
//   node scripts/qa_ctl.mjs teardown         -> delete the QA game
import "dotenv/config";
import fs from "fs";
import path from "path";

const SB = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = "andrius.martinonis@gmail.com", PASS = "Qline-Merkine-2K7pX9";
const STATE = path.join(process.cwd(), "scripts", ".qa_game.json");
const NAME = "ZZ QA Player Flows";

const rpc = async (fn, a) => {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  if (!r.ok) throw new Error(fn + " http " + r.status);
  return r.json();
};
let TOKEN;
const A = async (fn, a = {}) => rpc(fn, { p_code: TOKEN, ...a });
const login = async () => { TOKEN = (await rpc("admin_login", { p_email: EMAIL, p_password: PASS })).token; if (!TOKEN) throw new Error("admin_login failed"); };
const save = o => fs.writeFileSync(STATE, JSON.stringify(o, null, 2));
const load = () => { if (!fs.existsSync(STATE)) throw new Error("no QA game — run: node scripts/qa_ctl.mjs setup"); return JSON.parse(fs.readFileSync(STATE, "utf8")); };

// A video that is a real file (so the player renders <video> and currentTime is readable)
const VIDEO = process.env.SUPABASE_URL + "/storage/v1/object/public/game-assets/Spaceship.mp4";
const IMAGE = process.env.SUPABASE_URL + "/storage/v1/object/public/game-assets/sudoku.png";

async function setup() {
  await login();
  const list = await A("admin_list");
  for (const g of (list.games || []).filter(g => g.name === NAME)) await A("admin_delete_game", { p_game: g.id });
  const payload = { id: "", name: NAME, description: "Automated player-flow QA.", max_teams: 20, duration_min: 120,
    questions: [
      { title: "Q1 Video", intro: "Intro story line one.", info: "Stay on the path.", case_sensitive: false,
        answer: "alpha", alt_answers: [],
        blocks: [ { type: "text", text: "Watch the clip, then answer." }, { type: "video", url: VIDEO }, { type: "image", url: IMAGE } ],
        hints: [ { reveal_after_min: 0, blocks: [ { type: "text", text: "HINT-ONE-NOW" } ] },
                 { reveal_after_min: 1, blocks: [ { type: "text", text: "HINT-TWO-LATER" } ] } ] },
      { title: "Q2 Plain", intro: "", info: "", case_sensitive: false, answer: "bravo", alt_answers: [],
        blocks: [ { type: "text", text: "Second challenge body." } ],
        hints: [ { reveal_after_min: 0, blocks: [ { type: "text", text: "HINT-Q2" } ] } ] },
      { title: "Q3 Case", intro: "", info: "", case_sensitive: true, answer: "ChArLie", alt_answers: [],
        blocks: [ { type: "text", text: "Exact case required." } ], hints: [] },
      { title: "Q4 Final", intro: "", info: "", case_sensitive: false, answer: "delta", alt_answers: [],
        blocks: [ { type: "text", text: "Last one." } ], hints: [] },
    ] };
  const s = await A("admin_save_game", { p_payload: payload });
  if (s.error) throw new Error("save: " + s.error);
  await A("admin_activate", { p_game: s.id });          // live + registration open, not started
  save({ id: s.id, pin: s.pin });
  console.log(JSON.stringify({ pin: s.pin, id: s.id, status: "live (registration open, NOT started)",
    answers: { Q1: "alpha", Q2: "bravo", Q3: "ChArLie (case-sensitive)", Q4: "delta" },
    hints: { Q1: ["HINT-ONE-NOW @0min", "HINT-TWO-LATER @1min"], Q2: ["HINT-Q2 @0min"] } }, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "setup") return setup();
  await login();
  const g = load();
  switch (cmd) {
    case "status": {
      const l = await A("admin_list");
      const me = (l.games || []).find(x => x.id === g.id) || {};
      console.log(JSON.stringify({ pin: g.pin, status: me.status, starts_at: me.starts_at, paused_at: me.paused_at,
        registration_open: me.registration_open, server_now: l.server_now }, null, 2));
      break; }
    case "draft":    console.log(JSON.stringify(await A("admin_set_status", { p_game: g.id, p_status: "draft" }))); break;
    case "start":    console.log(JSON.stringify(await A("admin_start_now", { p_game: g.id }))); break;
    case "schedule": {
      const at = new Date(Date.now() + (+args[0] || 60) * 1000).toISOString();
      console.log(JSON.stringify(await A("admin_set_schedule", { p_game: g.id, p_starts_at: at }))); break; }
    case "pause":    console.log(JSON.stringify(await A("admin_pause", { p_game: g.id, p_message: args[0] || "Back shortly" }))); break;
    case "resume":   console.log(JSON.stringify(await A("admin_resume", { p_game: g.id }))); break;
    case "discard":  console.log(JSON.stringify(await A("admin_discard_task", { p_game: g.id, p_ord: +args[0], p_reason: args[1] || "QA" }))); break;
    case "end":      console.log(JSON.stringify(await A("admin_stop", { p_game: g.id }))); break;
    case "reg":      console.log(JSON.stringify(await A("admin_set_registration", { p_game: g.id, p_open: args[0] !== "close" }))); break;
    case "teams": {
      const m = await A("admin_monitor", { p_game: g.id });
      console.log(JSON.stringify((m.teams || []).map(t => ({ name: t.name, players: t.players, stage: t.stage_ord,
        stage_title: t.stage_title, finished: !!t.finished_at, splits: t.splits })), null, 2));
      break; }
    case "results":  console.log(JSON.stringify(await rpc("results", { p_pin: g.pin }), null, 2)); break;
    case "standings":console.log(JSON.stringify(await rpc("standings", { p_pin: g.pin }), null, 2)); break;
    case "teardown": await A("admin_delete_game", { p_game: g.id }); fs.unlinkSync(STATE); console.log("deleted"); break;
    default: console.log("commands: setup status start schedule <s> pause <msg> resume discard <ord> <reason> end reg open|close teams results standings teardown");
  }
}
main().catch(e => { console.error("ERR", e.message); process.exit(1); });
