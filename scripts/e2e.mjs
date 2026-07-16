// e2e.mjs — full lifecycle playthrough against the LIVE backend via the real RPC path.
// Player RPCs use the anon key; admin RPCs use an admin_login session token.
// Run: node scripts/e2e.mjs
import "dotenv/config";
const URL = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = "andrius.martinonis@gmail.com", PASS = "Qline-Merkine-2K7pX9";
if (!URL || !ANON) { console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY"); process.exit(1); }

async function rpc(fn, args) {
  const r = await fetch(URL + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(fn + " http " + r.status);
  return r.json();
}
let TOKEN; const A = (fn, args = {}) => rpc(fn, { p_code: TOKEN, ...args });
const mid = () => crypto.randomUUID();

let pass = 0, fail = 0;
const ok = (name, cond, extra="") => { console.log((cond ? "  ✓ " : "  ✗ ") + name + (cond?"":" — "+extra)); cond ? pass++ : fail++; };

async function main() {
  console.log("== login ==");
  TOKEN = (await rpc("admin_login", { p_email: EMAIL, p_password: PASS })).token;
  ok("admin_login returns token", !!TOKEN);

  console.log("== create game ==");
  const payload = { id:"", name:"E2E Test", description:"end-to-end", max_teams:20, duration_min:120,
    questions: [
      { title:"Q1", intro:"first", info:"Read carefully", case_sensitive:false, answer:"alpha", alt_answers:[],
        blocks:[{type:"text",text:"Solve Q1"}], hints:[{reveal_after_min:0, blocks:[{type:"text",text:"it's alpha"}]}] },
      { title:"Q2-discard", answer:"bravo", case_sensitive:false, blocks:[{type:"text",text:"Q2"}], hints:[] },
      { title:"Q3-cs", answer:"AbC", case_sensitive:true, blocks:[{type:"text",text:"Q3 exact case"}], hints:[] },
      { title:"Finish", answer:"done", case_sensitive:false, blocks:[{type:"text",text:"last"}], hints:[] },
    ] };
  const saved = await A("admin_save_game", { p_payload: payload });
  ok("admin_save_game ok", saved.ok === true, JSON.stringify(saved));
  const GID = saved.id, PIN = saved.pin;
  console.log("  game id", GID, "PIN", PIN);

  const full = await A("admin_get_game", { p_game: GID });
  ok("get_game: 4 questions", full.questions.length === 4);
  ok("get_game: Q1 hint has blocks", (full.questions[0].hints[0].blocks||[]).length === 1);
  ok("get_game: Q3 case_sensitive", full.questions[2].case_sensitive === true);
  ok("get_game: Q1 info persisted", full.questions[0].info === "Read carefully");

  console.log("== activate (open registration) ==");
  await A("admin_activate", { p_game: GID });
  let lobby = await rpc("get_game_by_pin", { p_pin: PIN });
  ok("lobby: status live", lobby.status === "live");
  ok("lobby: registration open", lobby.registration_open === true);
  ok("lobby: not started yet", lobby.started === false);

  console.log("== join ==");
  const A1 = (await rpc("join_game", { p_pin: PIN, p_team: "Alpha", p_name: "p1" })).session_token;
  const A2 = (await rpc("join_game", { p_pin: PIN, p_team: "Alpha", p_name: "p2" })).session_token; // same team, 2nd player
  const B1 = (await rpc("join_game", { p_pin: PIN, p_team: "Beta", p_name: "p3" })).session_token;
  ok("three player tokens issued", !!A1 && !!A2 && !!B1);
  let s = await rpc("get_state", { p_session: A1 });
  ok("player pre-start: started=false", s.started === false);

  console.log("== start game ==");
  await A("admin_start_now", { p_game: GID });
  s = await rpc("get_state", { p_session: A1 });
  ok("player: started true", s.started === true);
  ok("player: on Q1", s.question && s.question.title === "Q1");
  ok("player: Q1 info present", s.question.info === "Read carefully");
  ok("player: Q1 hint unlocked (reveal 0)", s.hints[0] && s.hints[0].unlocked === true);
  ok("player: unlocked hint has blocks", (s.hints[0].blocks||[]).length === 1);

  console.log("== live standings ==");
  const stand = await rpc("standings", { p_pin: PIN });
  ok("standings lists 2 teams", Array.isArray(stand) && stand.length === 2, JSON.stringify(stand));
  ok("standings shows current stage (Q1, not finished)", stand.every(s2 => s2.stage_ord === 1 && s2.finished === false));

  console.log("== play Q1 (wrong then right) ==");
  ok("wrong answer rejected", (await rpc("submit_answer", { p_session: A1, p_input:"nope", p_mutation_id: mid() })).correct === false);
  ok("correct answer accepted", (await rpc("submit_answer", { p_session: A1, p_input:"ALPHA", p_mutation_id: mid() })).correct === true); // case-insensitive
  s = await rpc("get_state", { p_session: A2 }); // teammate sees advanced state (shared)
  ok("teammate sees Q2 (shared progress)", s.question.title === "Q2-discard");

  console.log("== pause / resume ==");
  await A("admin_pause", { p_game: GID, p_message: "Back in 5" });
  s = await rpc("get_state", { p_session: A1 });
  ok("player: paused true", s.paused === true);
  ok("player: pause_message shown", s.pause_message === "Back in 5");
  ok("submit blocked while paused", (await rpc("submit_answer", { p_session: A1, p_input:"bravo", p_mutation_id: mid() })).error === "paused");
  await A("admin_resume", { p_game: GID });
  s = await rpc("get_state", { p_session: A1 });
  ok("player: resumed (not paused)", !s.paused);

  console.log("== discard Q2 with cause ==");
  const disc = await A("admin_discard_task", { p_game: GID, p_ord: 2, p_reason: "bad clue" });
  ok("discard ok", disc.ok === true);
  const notices = await rpc("get_notices", { p_session: A1 });
  ok("player gets discard notice (number + name + reason + time note)",
     Array.isArray(notices) && notices.some(n =>
       /Question 2 "Q2-discard" was cancelled by the host/.test(n.message)
       && /Reason: bad clue/.test(n.message)
       && /deducted from your total/.test(n.message)), JSON.stringify(notices));
  s = await rpc("get_state", { p_session: A1 });
  ok("Alpha moved to Q3 after discard", s.question.title === "Q3-cs");

  console.log("== case-sensitive answer ==");
  ok("wrong case rejected", (await rpc("submit_answer", { p_session: A1, p_input:"abc", p_mutation_id: mid() })).correct === false);
  ok("exact case accepted", (await rpc("submit_answer", { p_session: A1, p_input:"AbC", p_mutation_id: mid() })).correct === true);
  s = await rpc("get_state", { p_session: A1 });
  ok("Alpha on Finish", s.question.title === "Finish");
  const fin = await rpc("submit_answer", { p_session: A1, p_input:"done", p_mutation_id: mid() });
  ok("Alpha finishes", fin.finished === true);

  console.log("== Beta finishes -> auto-stop ==");
  await rpc("submit_answer", { p_session: B1, p_input:"alpha", p_mutation_id: mid() });  // Q1
  await rpc("submit_answer", { p_session: B1, p_input:"AbC", p_mutation_id: mid() });    // Q3 (ord2 now)
  const bfin = await rpc("submit_answer", { p_session: B1, p_input:"done", p_mutation_id: mid() }); // Finish
  ok("Beta finishes", bfin.finished === true);
  lobby = await rpc("get_game_by_pin", { p_pin: PIN });
  ok("game auto-stopped (all finished)", lobby.status === "ended" || lobby.expired === true, JSON.stringify({status:lobby.status,expired:lobby.expired}));

  console.log("== leaderboard / monitor / roster ==");
  const lb = await rpc("leaderboard", { p_pin: PIN });
  ok("leaderboard has 2 finished teams", lb.length === 2, JSON.stringify(lb));
  ok("leaderboard sorted by time", lb.length===2 && lb[0].total_seconds <= lb[1].total_seconds);
  const mon = await A("admin_monitor", { p_game: GID });
  ok("monitor lists 2 teams", mon.teams.length === 2);
  ok("monitor: team carries splits[]", Array.isArray(mon.teams[0].splits) && mon.teams[0].splits.length >= 1, JSON.stringify(mon.teams[0].splits));
  const ros = await A("admin_roster", { p_game: GID });
  ok("roster: 2 teams, 3 players", ros.team_count === 2 && ros.player_count === 3);

  console.log("== results (per-question splits + overall) ==");
  const res = await rpc("results", { p_pin: PIN });
  ok("results lists 2 teams", Array.isArray(res) && res.length === 2, JSON.stringify(res));
  const alpha = res.find(r => r.name === "Alpha");
  ok("results: Alpha finished with splits", alpha && alpha.finished === true && Array.isArray(alpha.splits) && alpha.splits.length === 3, JSON.stringify(alpha));
  ok("results: overall = sum of splits (no credit for Alpha)", alpha && alpha.overall_seconds === alpha.splits.reduce((n,s)=>n+s.seconds,0));

  console.log("== duplicate / rename ==");
  const dup = await A("admin_duplicate", { p_game: GID });
  ok("duplicate ok", dup.ok === true && !!dup.id);
  const dupGame = await A("admin_get_game", { p_game: dup.id });
  ok("duplicate is draft with same #questions", dupGame.status === "draft" && dupGame.questions.length === 3); // Q2 was discarded => 3
  // Regression: duplicate used to copy only the legacy text/media_type/media_url columns, so
  // hints came back with reveal times but NO content. Content lives in blocks.
  const dupHint = (dupGame.questions[0].hints || [])[0] || {};
  ok("duplicate keeps hint CONTENT (blocks), not just reveal times",
     (dupHint.blocks || []).length === 1 && dupHint.blocks[0].text === "it's alpha", JSON.stringify(dupHint));
  ok("duplicate keeps hint reveal time", dupHint.reveal_after_min === 0, JSON.stringify(dupHint.reveal_after_min));
  ok("duplicate keeps the question's answer + info", dupGame.questions[0].answer === "alpha" && dupGame.questions[0].info === "Read carefully");
  await A("admin_rename", { p_game: dup.id, p_name: "E2E Copy Renamed" });
  ok("rename applied", (await A("admin_get_game", { p_game: dup.id })).name === "E2E Copy Renamed");

  console.log("== discarding the LAST question auto-stops ==");
  const p2 = { id:"", name:"Autostop", max_teams:5, duration_min:60,
    questions:[ { title:"Only", answer:"x", blocks:[{type:"text",text:"only"}], hints:[] } ] };
  const s2 = await A("admin_save_game", { p_payload: p2 });
  await A("admin_activate", { p_game: s2.id });
  await rpc("join_game", { p_pin: s2.pin, p_team: "Solo", p_name: "z" });
  await A("admin_start_now", { p_game: s2.id });
  await A("admin_discard_task", { p_game: s2.id, p_ord: 1, p_reason: "nuke" });
  const lob2 = await rpc("get_game_by_pin", { p_pin: s2.pin });
  ok("discarding last question auto-ends game", lob2.status === "ended" || lob2.expired === true, JSON.stringify({status:lob2.status,expired:lob2.expired}));
  await A("admin_delete_game", { p_game: s2.id });

  console.log("== cleanup ==");
  await A("admin_delete_game", { p_game: dup.id });
  await A("admin_delete_game", { p_game: GID });
  const list = await A("admin_list");
  ok("test games deleted", !list.games.some(g => g.id === GID || g.id === dup.id));

  console.log(`\n===== ${fail===0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
