// qa_ctl_start.mjs — start a game by id (helper for the pre-start QA probe).
// Run: node scripts/qa_ctl_start.mjs <gameId>
import "dotenv/config";
const SB = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const rpc = async (fn, a) => {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  return r.json();
};
const token = (await rpc("admin_login", { p_email: "andrius.martinonis@gmail.com", p_password: "Qline-Merkine-2K7pX9" })).token;
console.log(JSON.stringify(await rpc("admin_start_now", { p_code: token, p_game: process.argv[2] })));
