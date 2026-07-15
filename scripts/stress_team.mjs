// stress_team.mjs — worst-case concurrency: 30 players on ONE team, all joining and
// answering the same question simultaneously. Proves join-race + FOR UPDATE lock + no
// double-advance. Run: node scripts/stress_team.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const sb = createClient(URL, SR, { auth: { persistSession: false } });
const PIN = "BURST", M = 30, ANSWERS = ["alpha", "bravo", "charlie"];
async function rpc(fn, args) {
  const r = await fetch(URL + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  return r.ok ? r.json() : { error: "http_" + r.status };
}
async function main() {
  await sb.from("games").delete().eq("pin", PIN);
  const { data: g } = await sb.from("games").insert({ pin: PIN, name: "Burst", status: "live", theme: {},
    duration_min: 60, expires_at: new Date(Date.now() + 3600000).toISOString(), max_teams: 50 }).select().single();
  for (let i = 1; i <= ANSWERS.length; i++) {
    const { data: q } = await sb.from("questions").insert({ game_id: g.id, ord: i, title: "Q" + i, blocks: [] }).select().single();
    await sb.from("question_secrets").insert({ question_id: q.id, answer: ANSWERS[i - 1] });
  }
  // 30 players join the SAME team name concurrently (join-race on unique(game_id,name))
  const joins = await Promise.all(Array.from({ length: M }, (_, i) =>
    rpc("join_game", { p_pin: PIN, p_team: "SHARED", p_name: "P" + i })));
  const tokens = joins.filter(j => j.session_token).map(j => j.session_token);
  const { count: teams } = await sb.from("teams").select("*", { count: "exact", head: true }).eq("game_id", g.id);
  const { count: players } = await sb.from("players").select("*", { count: "exact", head: true })
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", g.id)).data.map(t => t.id));

  // ALL 30 submit the correct Q1 answer at the exact same time (distinct mutation ids)
  const subs = await Promise.all(tokens.map(t => rpc("submit_answer", { p_session: t, p_input: "alpha", p_mutation_id: crypto.randomUUID() })));
  const correctCount = subs.filter(s => s.correct).length;

  // team state after the burst
  const st = await rpc("get_state", { p_session: tokens[0] });
  const { data: prog } = await sb.from("team_progress").select("solved_at, question_id")
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", g.id)).data.map(t => t.id));
  const solved = prog.filter(p => p.solved_at).length;
  const activeRows = prog.filter(p => !p.solved_at).length;
  const { count: attempts } = await sb.from("answer_attempts").select("*", { count: "exact", head: true })
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", g.id)).data.map(t => t.id));

  console.log("===== SAME-TEAM BURST (30 players, 1 team) =====");
  console.log(`teams created (expect 1):        ${teams}`);
  console.log(`players (expect ${M}):              ${players}`);
  console.log(`correct=true among 30 submits:   ${correctCount}  (all count the shared solve — idempotent per player? no, distinct mids)`);
  console.log(`Q1 solved rows (expect 1):        ${solved}`);
  console.log(`active unsolved rows (expect 1, =Q2): ${activeRows}`);
  console.log(`team now on stage:                ${st.question ? "Q" + st.question.ord : (st.finished ? "finished" : "?")}`);
  console.log(`answer_attempts logged:           ${attempts}`);
  const ok = teams === 1 && solved === 1 && activeRows === 1 && st.question && st.question.ord === 2;
  console.log(ok ? "\n✅ exactly one advance — no double-advance, lock held" : "\n⚠ UNEXPECTED STATE");

  await sb.from("teams").delete().eq("game_id", g.id);
  await sb.from("games").delete().eq("id", g.id);
}
main().catch(e => { console.error(e); process.exit(1); });
