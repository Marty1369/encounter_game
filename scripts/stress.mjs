// stress.mjs — 50 concurrent users against the LIVE backend.
// Setup/verify/teardown via service role; the load itself uses the anon key + REST RPCs
// (the real client path). Run: node scripts/stress.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !SR || !ANON) { console.error("Missing env (need SUPABASE_URL, SERVICE_ROLE, VITE_SUPABASE_ANON_KEY)"); process.exit(1); }
const sb = createClient(URL, SR, { auth: { persistSession: false } });

const N = 50, PIN = "STRESS", QCOUNT = 5;
const ANSWERS = ["alpha", "bravo", "charlie", "delta", "echo"];
const pad = (n) => String(n).padStart(3, "0");

// ---- anon REST RPC with timing ----
const lat = [];
let errors = {};
async function rpc(fn, args) {
  const t0 = performance.now();
  try {
    const r = await fetch(URL + "/rest/v1/rpc/" + fn, { method: "POST",
      headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" },
      body: JSON.stringify(args) });
    lat.push(performance.now() - t0);
    if (!r.ok) { errors["http_" + r.status] = (errors["http_" + r.status] || 0) + 1; return { error: "http_" + r.status }; }
    return await r.json();
  } catch (e) { lat.push(performance.now() - t0); errors["fetch"] = (errors["fetch"] || 0) + 1; return { error: "fetch" }; }
}

async function setup() {
  await sb.from("games").delete().eq("pin", PIN);
  const { data: g, error } = await sb.from("games").insert({
    pin: PIN, name: "Stress Test", description: "load test", status: "live",
    theme: {}, duration_min: 60, expires_at: new Date(Date.now() + 60 * 60000).toISOString(), max_teams: N + 10,
  }).select().single();
  if (error) throw error;
  for (let i = 1; i <= QCOUNT; i++) {
    const { data: q } = await sb.from("questions").insert({ game_id: g.id, ord: i, title: "Q" + i, intro: "intro " + i,
      blocks: [{ type: "text", text: "Solve challenge " + i }] }).select().single();
    await sb.from("question_secrets").insert({ question_id: q.id, answer: ANSWERS[i - 1] });
    await sb.from("hints").insert({ question_id: q.id, ord: 1, reveal_after_min: 0, text: "hint for " + i });
  }
  return g.id;
}

// ---- one simulated user ----
const results = { joined: 0, finished: 0, correct: 0, wrong: 0, idempotentOK: 0, idempotentBad: 0, anomalies: [] };
async function user(i) {
  const team = "T" + pad(i), name = "P" + pad(i);
  const j = await rpc("join_game", { p_pin: PIN, p_team: team, p_name: name });
  if (j.error || !j.session_token) { results.anomalies.push("join failed " + team + " " + (j.error || "")); return; }
  results.joined++;
  const tok = j.session_token;

  for (let step = 0; step < QCOUNT; step++) {
    const st = await rpc("get_state", { p_session: tok });
    if (st.finished) break;
    if (!st.question) { results.anomalies.push(team + " no question at step " + step); break; }
    const ord = st.question.ord;
    // reveal the (reveal=0) hint
    if (st.hints && st.hints[0]) await rpc("mark_hint_revealed", { p_session: tok, p_hint_id: st.hints[0].id });
    // every 5th user submits one wrong answer first
    if (i % 5 === 0 && step === 0) {
      const w = await rpc("submit_answer", { p_session: tok, p_input: "nope-" + i, p_mutation_id: crypto.randomUUID() });
      if (w.correct === false) results.wrong++; else results.anomalies.push(team + " wrong answer accepted");
    }
    // correct submit (idempotent mutation id)
    const mid = crypto.randomUUID();
    const res = await rpc("submit_answer", { p_session: tok, p_input: ANSWERS[ord - 1], p_mutation_id: mid });
    if (res.correct) results.correct++;
    else { results.anomalies.push(team + " correct answer rejected at ord " + ord + " -> " + JSON.stringify(res)); break; }
    // idempotency: every 10th user replays the same mutation id, must return identical result (no double advance)
    if (i % 10 === 0) {
      const replay = await rpc("submit_answer", { p_session: tok, p_input: ANSWERS[ord - 1], p_mutation_id: mid });
      if (JSON.stringify(replay) === JSON.stringify(res)) results.idempotentOK++; else { results.idempotentBad++; results.anomalies.push(team + " idempotency mismatch"); }
    }
  }
  const fin = await rpc("get_state", { p_session: tok });
  if (fin.finished) results.finished++; else results.anomalies.push(team + " did not finish");
}

function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] | 0; }

async function verify(gameId) {
  const { count: teams } = await sb.from("teams").select("*", { count: "exact", head: true }).eq("game_id", gameId);
  const { count: players } = await sb.from("players").select("*", { count: "exact", head: true })
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", gameId)).data.map(t => t.id));
  const { data: finishedTeams } = await sb.from("teams").select("id").eq("game_id", gameId).not("finished_at", "is", null);
  // per-team solved count must equal QCOUNT for finished teams
  const { data: prog } = await sb.from("team_progress").select("team_id, solved_at")
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", gameId)).data.map(t => t.id));
  const solvedByTeam = {};
  for (const p of prog) if (p.solved_at) solvedByTeam[p.team_id] = (solvedByTeam[p.team_id] || 0) + 1;
  const badSolve = Object.entries(solvedByTeam).filter(([, c]) => c !== QCOUNT).length;
  const overSolve = Object.values(solvedByTeam).filter(c => c > QCOUNT).length; // double-advance detector
  const { count: attempts } = await sb.from("answer_attempts").select("*", { count: "exact", head: true })
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", gameId)).data.map(t => t.id));
  const { count: idem } = await sb.from("submit_idempotency").select("*", { count: "exact", head: true })
    .in("team_id", (await sb.from("teams").select("id").eq("game_id", gameId)).data.map(t => t.id));
  return { teams, players, finishedTeams: finishedTeams.length, teamsWithWrongSolveCount: badSolve, teamsOverSolved: overSolve, attempts, idempotencyRows: idem };
}

async function main() {
  console.log("Setting up STRESS game…");
  const gameId = await setup();

  console.log(`Launching ${N} concurrent users…`);
  const wall0 = performance.now();
  // thundering-herd lobby load
  await Promise.all(Array.from({ length: N }, () => rpc("get_game_by_pin", { p_pin: PIN })));
  // full play, all users concurrent
  await Promise.all(Array.from({ length: N }, (_, i) => user(i + 1)));
  const wallMs = performance.now() - wall0;

  const db = await verify(gameId);
  console.log("\n===== RESULTS =====");
  console.log(`wall clock:        ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`rpc calls:         ${lat.length}`);
  console.log(`throughput:        ${(lat.length / (wallMs / 1000)).toFixed(0)} rpc/s`);
  console.log(`latency ms:        p50=${pct(lat, .5)}  p95=${pct(lat, .95)}  p99=${pct(lat, .99)}  max=${Math.max(...lat) | 0}`);
  console.log(`errors:            ${JSON.stringify(errors)}`);
  console.log("\n--- client-side ---");
  console.log(`joined:            ${results.joined}/${N}`);
  console.log(`finished:          ${results.finished}/${N}`);
  console.log(`correct submits:   ${results.correct}   wrong (expected):  ${results.wrong}`);
  console.log(`idempotency OK:    ${results.idempotentOK}   mismatched: ${results.idempotentBad}`);
  console.log("\n--- DB integrity ---");
  console.log(`teams:             ${db.teams}`);
  console.log(`players:           ${db.players}`);
  console.log(`finished teams:    ${db.finishedTeams}`);
  console.log(`teams solved != ${QCOUNT}: ${db.teamsWithWrongSolveCount}   OVER-solved (double advance): ${db.teamsOverSolved}`);
  console.log(`answer_attempts:   ${db.attempts}`);
  console.log(`idempotency rows:  ${db.idempotencyRows}`);
  if (results.anomalies.length) { console.log("\n⚠ ANOMALIES:"); results.anomalies.slice(0, 20).forEach(a => console.log("  - " + a)); }
  else console.log("\n✅ no anomalies");

  console.log("\nTearing down STRESS game…");
  await sb.from("teams").delete().eq("game_id", gameId);
  await sb.from("games").delete().eq("id", gameId);
  console.log("done.");
}
main().catch((e) => { console.error(e); process.exit(1); });
