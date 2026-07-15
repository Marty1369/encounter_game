// seed_aussie.mjs — upload an Australian-themed game (story + hints) to the platform.
// Additive & idempotent (replaces the game with the same PIN). Run: node scripts/seed_aussie.mjs
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, SR, { auth: { persistSession: false } });

const PIN = "AUSSIE";
const GAME = {
  name: "Down Under: The Outback Cipher",
  description:
    "You've landed in the sunburnt country with a cryptic postcard and a mission. Follow the trail across the wide brown land — from the Red Centre to the reef — and crack the outback cipher before sundown. Grab your hat, keep an eye out for drop bears, and away we go, mate.",
  theme: "Ember",
  status: "ready",       // organizer takes it live from the Game creator
  duration_min: 120,
  questions: [
    { title: "The Red Heart",
      intro: "Deep in the Red Centre a giant monolith glows crimson at dawn. Sacred to the Anangu people, its name is your first key.",
      answer: "ULURU", alt: [],
      hints: [
        { min: 5,  text: "It's a giant sandstone rock in the heart of the Northern Territory." },
        { min: 10, text: "Once known as Ayers Rock. Five letters, begins with U." } ] },
    { title: "Pouch and Punch",
      intro: "It hops across the plains, carries its young in a pouch, and stands proudly on the coat of arms. Name this national icon.",
      answer: "KANGAROO", alt: ["ROO"],
      hints: [
        { min: 4, text: "A marsupial that throws a punch when cornered." },
        { min: 8, text: "Its nickname is 'roo'. Eight letters." } ] },
    { title: "Sails by the Sea",
      intro: "On Bennelong Point, white shells rise beside the great steel bridge — a temple of music known the world over.",
      answer: "OPERAHOUSE", alt: ["SYDNEYOPERAHOUSE"],
      hints: [
        { min: 6,  text: "You'll find it on Sydney Harbour." },
        { min: 12, text: "Two words, no space. Designed by Danish architect Jørn Utzon." } ] },
    { title: "The Living Rainbow",
      intro: "Stretching over 2,300 km off the Queensland coast, this is the largest living structure on Earth — alive with colour, visible from space.",
      answer: "REEF", alt: ["GREATBARRIERREEF", "CORAL"],
      hints: [
        { min: 5,  text: "The Great Barrier ____." },
        { min: 10, text: "Four letters; it's built by tiny coral polyps." } ] },
    { title: "Fair Dinkum Finish",
      intro: "You've crossed the wide brown land and cracked the cipher. One last word — the true-blue Aussie greeting shouted across every barbie and beach.",
      answer: "GDAY", alt: ["GOODDAY", "GDAYMATE"],
      hints: [
        { min: 3, text: "A casual hello, mate." },
        { min: 6, text: "G'___ — just drop the apostrophe." } ] },
  ],
};

async function main() {
  // theme
  const { data: theme } = await sb.from("themes").select("id, tokens").eq("name", GAME.theme).maybeSingle();
  // idempotent replace
  const { data: existing } = await sb.from("games").select("id").eq("pin", PIN).maybeSingle();
  if (existing) { await sb.from("teams").delete().eq("game_id", existing.id); await sb.from("games").delete().eq("id", existing.id); }

  const { data: game, error } = await sb.from("games").insert({
    pin: PIN, name: GAME.name, description: GAME.description, status: GAME.status,
    duration_min: GAME.duration_min, theme_id: theme?.id || null, theme: theme?.tokens || {},
  }).select().single();
  if (error) throw error;

  for (let i = 0; i < GAME.questions.length; i++) {
    const q = GAME.questions[i];
    const { data: qr, error: qe } = await sb.from("questions").insert({
      game_id: game.id, ord: i + 1, title: q.title, intro: q.intro,
      blocks: [{ type: "text", text: q.intro }],
    }).select().single();
    if (qe) throw qe;
    await sb.from("question_secrets").insert({ question_id: qr.id, answer: q.answer, alt_answers: q.alt || [] });
    if (q.hints?.length)
      await sb.from("hints").insert(q.hints.map((h, j) => ({
        question_id: qr.id, ord: j + 1, reveal_after_min: h.min, text: h.text })));
  }
  const hc = GAME.questions.reduce((n, q) => n + q.hints.length, 0);
  console.log(`✅ Uploaded "${GAME.name}"`);
  console.log(`   PIN ${PIN} · ${GAME.questions.length} questions · ${hc} hints · theme ${GAME.theme} · status ${GAME.status}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
