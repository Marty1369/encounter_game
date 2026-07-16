// qa_remove.mjs — admin removes players and teams. Checks the real consequences, not just the
// row count: the removed player is signed out, their team-mates keep playing, the team's answer
// history survives a player removal, and an emptied team cannot hold the game open.
// Run: node scripts/qa_remove.mjs
import "dotenv/config";
import { execFileSync } from "node:child_process";

const SB = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const rpc = async (fn, a) => {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  return r.json();
};
const ctl = (...a) => execFileSync("node", ["scripts/qa_ctl.mjs", ...a], { cwd: process.cwd(), encoding: "utf8" }).trim();
const uuid = () => crypto.randomUUID();
let pass = 0, fail = 0;
const ok = (n, c, ev = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (ev ? "  — " + String(ev).slice(0, 120) : "")); c ? pass++ : fail++; };

// There is ONE admin session server-side (app_config.admin_session_token), so every qa_ctl call
// logs in and invalidates ours. Re-auth on forbidden instead of fighting it.
let TOKEN;
const login = async () => { TOKEN = (await rpc("admin_login", { p_email: "andrius.martinonis@gmail.com", p_password: "Qline-Merkine-2K7pX9" })).token; };
const A = async (fn, a = {}) => {
  let r = await rpc(fn, { p_code: TOKEN, ...a });
  if (r && r.error === "forbidden") { await login(); r = await rpc(fn, { p_code: TOKEN, ...a }); }
  return r;
};

async function main() {
  const g = JSON.parse(ctl("setup"));
  await login();

  // Alpha: two players. Beta: one.
  const a1 = (await rpc("join_game", { p_pin: g.pin, p_team: "Alpha", p_name: "Ana" })).session_token;
  const a2 = (await rpc("join_game", { p_pin: g.pin, p_team: "Alpha", p_name: "Bo" })).session_token;
  const b1 = (await rpc("join_game", { p_pin: g.pin, p_team: "Beta", p_name: "Cy" })).session_token;
  ctl("start");
  await rpc("submit_answer", { p_session: a1, p_input: "alpha", p_mutation_id: uuid() });   // Alpha solves Q1

  let ros = await A("admin_roster", { p_game: g.id });
  ok("roster gives players as {id,name}", Array.isArray(ros.teams[0].players) && !!ros.teams[0].players[0].id,
     JSON.stringify(ros.teams[0].players));
  const alpha = ros.teams.find(t => t.name === "Alpha"), beta = ros.teams.find(t => t.name === "Beta");
  const ana = alpha.players.find(p => p.name === "Ana");

  // ---- remove a player
  const rp = await A("admin_delete_player", { p_player: ana.id });
  ok("admin_delete_player ok", rp.ok === true && rp.name === "Ana" && rp.players_left === 1, JSON.stringify(rp));
  ok("removed player is signed out", (await rpc("get_state", { p_session: a1 })).error === "bad_session");
  ok("their team-mate plays on", (await rpc("get_state", { p_session: a2 })).question.title === "Q2 Plain");
  const splits = (JSON.parse(ctl("teams")).find(t => t.name === "Alpha") || {}).splits || [];
  ok("team keeps the answer it already earned", splits.length === 1 && splits[0].ord === 1, JSON.stringify(splits));
  ros = await A("admin_roster", { p_game: g.id });
  ok("roster counts update (3 players -> 2)", ros.player_count === 2, "player_count=" + ros.player_count);

  // ---- remove a whole team
  const rt = await A("admin_delete_team", { p_team: beta.id });
  ok("admin_delete_team ok", rt.ok === true && rt.name === "Beta", JSON.stringify(rt));
  ok("everyone on the removed team is signed out", (await rpc("get_state", { p_session: b1 })).error === "bad_session");
  ros = await A("admin_roster", { p_game: g.id });
  ok("team is gone from the roster", ros.team_count === 1 && !ros.teams.some(t => t.name === "Beta"));
  ok("the other team is untouched", (await rpc("get_state", { p_session: a2 })).question.title === "Q2 Plain");

  // ---- an emptied team must not hold the game open
  const left = (await A("admin_roster", { p_game: g.id })).teams[0];
  await A("admin_delete_player", { p_player: left.players[0].id });          // Alpha now has 0 players
  let st = JSON.parse(ctl("status"));
  ok("emptying the last team does not silently end the game", st.status === "live", "status=" + st.status);
  const solo = (await rpc("join_game", { p_pin: g.pin, p_team: "Solo", p_name: "Dee" })).session_token;
  for (const ans of ["alpha", "bravo", "ChArLie", "delta"]) await rpc("submit_answer", { p_session: solo, p_input: ans, p_mutation_id: uuid() });
  st = JSON.parse(ctl("status"));
  ok("a player-less team no longer blocks auto-end (game ends when the real team finishes)",
     st.status === "ended", "status=" + st.status);

  // ---- guards
  ok("delete needs a valid admin code", (await rpc("admin_delete_team", { p_code: "nope", p_team: left.id })).error === "forbidden");
  ok("deleting an unknown team reports not_found", (await A("admin_delete_team", { p_team: uuid() })).error === "not_found");

  ctl("teardown");
  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
