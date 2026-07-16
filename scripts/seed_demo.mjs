// seed_demo.mjs — my own demo game "Kosminis signalas". Deliberately exercises every feature:
// video block, image block, link block, multi-line text, Important callout, a case-sensitive
// answer, Lithuanian diacritics, and hints that unlock over time.
// Solvable from a desk (no field walking), so it can actually be played through end to end.
// Run: node scripts/seed_demo.mjs   (creates + activates; prints the PIN)
import "dotenv/config";

const SB = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = "andrius.martinonis@gmail.com", PASS = "Qline-Merkine-2K7pX9";
const asset = f => process.env.SUPABASE_URL + "/storage/v1/object/public/game-assets/" + encodeURIComponent(f);
const NAME = "Kosminis signalas (demo)";

const rpc = async (fn, a) => {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  return r.json();
};

const questions = [
  { title: "U1 Signalas iš tamsos", case_sensitive: false, answer: "AIDAS", alt_answers: [],
    intro: "Naktį virš miško nuskriejo šviesa. Radijas įsijungė pats ir pakartojo tavo paties balsą.",
    info: "Atsakymą rašyk lietuviškai — su diakritikais ar be jų, abu tinka.",
    blocks: [
      { type: "video", url: asset("Spaceship.mp4") },
      { type: "text", text: "Įrašas baigiasi mįsle:\n\n„Kalbu be burnos ir girdžiu be ausų.\nKūno neturiu, bet atgyju nuo tavo balso.\nKas aš?“" },
    ],
    hints: [
      { reveal_after_min: 0, blocks: [{ type: "text", text: "Kalnuose ar tuščioje salėje aš visada atkartoju paskutinį tavo žodį." }] },
      { reveal_after_min: 2, blocks: [{ type: "text", text: "Tai garso atspindys. 5 raidės." }] },
    ] },

  { title: "U2 Skaičių seka", case_sensitive: false, answer: "17", alt_answers: [],
    intro: "Ant laivo korpuso išraižyta seka. Paskutinis skaičius nutrintas.",
    info: "",
    blocks: [
      { type: "text", text: "2   3   5   7   11   13   ?\n\nKiekvienas iš jų dalijasi tik iš savęs ir iš vieneto." },
    ],
    hints: [ { reveal_after_min: 0, blocks: [{ type: "text", text: "Tai pirminiai skaičiai. Koks eina po 13?" }] } ] },

  { title: "U3 Peršokantis", case_sensitive: false, answer: "ŽIRGAS", alt_answers: ["ZIRGAS"],
    intro: "Ateiviai mėgsta šachmatus — bet supranta tik vieną figūrą.",
    info: "",
    blocks: [
      { type: "image", url: asset("sachmatu_diagrama.png") },
      { type: "text", text: "Vienintelė figūra, kuri gali peršokti per kitas.\nJos ėjimas — raidė „L“.\nKaip ji vadinasi?" },
    ],
    hints: [ { reveal_after_min: 0, blocks: [{ type: "text", text: "Angliškai — knight. Lietuviškai — gyvūnas." }] } ] },

  { title: "U4 Tikslus kodas", case_sensitive: true, answer: "AiTvArAs", alt_answers: [],
    intro: "Laivo pavadinimas įrašytas keistai — didžiosios ir mažosios raidės kaitaliojasi.",
    info: "Šioje užduotyje raidžių dydis SVARBUS — perrašyk tiksliai taip, kaip matai.",
    blocks: [ { type: "text", text: "Perrašyk laivo vardą tiksliai:\n\nAiTvArAs" } ],
    hints: [ { reveal_after_min: 0, blocks: [{ type: "text", text: "Nekeisk nė vienos raidės dydžio. Nukopijuok, kaip parašyta." }] } ] },

  { title: "U5 Paskutinė žinutė", case_sensitive: false, answer: "GALAS", alt_answers: [],
    intro: "Prieš dingdamas laivas nusiuntė paskutinį signalą Morzės abėcėle.",
    info: "",
    blocks: [
      { type: "text", text: "--.   .-   .-..   .-   ...\n\nIššifruok ir įrašyk žodį." },
      { type: "link", url: "https://morsecode.world/international/translator.html" },
    ],
    hints: [ { reveal_after_min: 0, blocks: [{ type: "text", text: "Pirmoji raidė --. yra G. Žodis — 5 raidės, lietuviškas." }] } ] },
];

async function main() {
  const token = (await rpc("admin_login", { p_email: EMAIL, p_password: PASS })).token;
  if (!token) throw new Error("admin_login failed");
  const A = (fn, a = {}) => rpc(fn, { p_code: token, ...a });

  const list = await A("admin_list");
  for (const g of (list.games || []).filter(g => g.name === NAME)) await A("admin_delete_game", { p_game: g.id });
  const theme = (list.themes || []).find(t => /noir/i.test(t.name)) || (list.themes || [])[0];

  const res = await A("admin_save_game", { p_payload: {
    id: "", name: NAME, theme_id: theme?.id,
    description: "Trumpas demo žaidimas platformai patikrinti — 5 stotelės, žaidžiamos nuo stalo.",
    max_teams: 20, duration_min: 120, questions } });
  if (res.error) throw new Error("save: " + res.error);
  await A("admin_activate", { p_game: res.id });      // live + registration open

  console.log("✅ Sukurta ir aktyvuota:", NAME);
  console.log("   PIN:", res.pin, "| tema:", theme?.name, "|", questions.length, "stotelės,",
    questions.reduce((n, q) => n + q.hints.length, 0), "užuominos");
  console.log("   Atsakymai:", questions.map((q, i) => `U${i + 1}=${q.answer}`).join(", "));
  console.log("   id:", res.id);
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
