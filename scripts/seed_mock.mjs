// seed_mock.mjs — populate the platform with demo themes, games, teams & progress.
// Run: node scripts/seed_mock.mjs   (uses .env service role; bypasses RLS)
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
const asset = (f) => `${url}/storage/v1/object/public/game-assets/${encodeURIComponent(f)}`;
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

// ---- themes: the 5 curated presets from the design (verbatim tokens) ----
const THEMES = [
  { name: "Atlas", tokens: { id:"atlas", primary:"#0f766e", onPrimary:"#fff", secondary:"#5eead4",
      bg:"linear-gradient(175deg,#eef6f5 0%,#fbfdfd 100%)", ink:"#0c1f1d", inkSoft:"#3f5c58", muted:"#7c928f",
      card:"rgba(255,255,255,.88)", field:"rgba(255,255,255,.95)", line:"rgba(12,31,29,.12)",
      fontDisplay:"'Space Grotesk',sans-serif", fontBody:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      displayWeight:"600", displayTracking:"-.01em", rFrame:"26px", rCard:"16px", rBtn:"11px", rInput:"11px",
      desc:"Cool teal, grotesk type, soft 16px corners" } },
  { name: "Ember", tokens: { id:"ember", primary:"#9a3412", onPrimary:"#fff", secondary:"#d97706",
      bg:"linear-gradient(175deg,#f7f1e8 0%,#fdfaf5 100%)", ink:"#2a1508", inkSoft:"#6b4a33", muted:"#987f6c",
      card:"rgba(255,255,255,.85)", field:"rgba(255,255,255,.95)", line:"rgba(42,21,8,.14)",
      fontDisplay:"'Instrument Serif',serif", fontBody:"Georgia,'Times New Roman',serif",
      displayWeight:"400", displayTracking:"0", rFrame:"6px", rCard:"3px", rBtn:"2px", rInput:"2px",
      desc:"Warm editorial serif, sharp square corners" } },
  { name: "Verdant", tokens: { id:"verdant", primary:"#166534", onPrimary:"#fff", secondary:"#a3e635",
      bg:"linear-gradient(175deg,#eef4ec 0%,#f9fbf7 100%)", ink:"#122415", inkSoft:"#41573f", muted:"#7f9080",
      card:"rgba(255,255,255,.88)", field:"rgba(255,255,255,.95)", line:"rgba(18,36,21,.12)",
      fontDisplay:"'Space Grotesk',sans-serif", fontBody:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      displayWeight:"600", displayTracking:"-.01em", rFrame:"38px", rCard:"26px", rBtn:"999px", rInput:"16px",
      desc:"Deep green, generous rounded organic shapes" } },
  { name: "Noir", tokens: { id:"noir", primary:"#6366f1", onPrimary:"#fff", secondary:"#22d3ee",
      bg:"linear-gradient(175deg,#121215 0%,#1b1b22 100%)", ink:"#e7e7ea", inkSoft:"#a6a6b0", muted:"#77777f",
      card:"rgba(255,255,255,.055)", field:"rgba(255,255,255,.08)", line:"rgba(231,231,234,.14)",
      fontDisplay:"'Space Grotesk',sans-serif", fontBody:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      displayWeight:"600", displayTracking:"0", rFrame:"14px", rCard:"10px", rBtn:"8px", rInput:"8px",
      desc:"Dark mode, indigo accents, precise 8px geometry" } },
  { name: "Salon", tokens: { id:"salon", primary:"#701a75", onPrimary:"#fff", secondary:"#db2777",
      bg:"linear-gradient(175deg,#f6eff5 0%,#fcf9fc 100%)", ink:"#2b0e2d", inkSoft:"#614461", muted:"#937d92",
      card:"rgba(255,255,255,.88)", field:"rgba(255,255,255,.95)", line:"rgba(43,14,45,.12)",
      fontDisplay:"'Instrument Serif',serif", fontBody:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      displayWeight:"400", displayTracking:"0", rFrame:"30px", rCard:"20px", rBtn:"999px", rInput:"14px",
      desc:"Plum serif elegance, pill buttons, soft curves" } },
];

// ---- games (mock) ----
const GAMES = [
  {
    pin: "STAR42", name: "Švytintys ganytojai", status: "live", themeIdx: 3,
    description: "Kosminis nuotykis laukuose — 13 stočių maršrutas.", duration_min: 240, expiresMin: 240,
    questions: [
      { title:"Nesuprantamas kvietimas", intro:"Viskas prasidėjo ne nuo sprogimo, o nuo keisto kvietimo.",
        location_name:"Sodyba / kiemas (startas)", lat:54.154812, lng:24.118170,
        blocks:[{type:"video",url:asset("Spaceship.mp4")},{type:"text",text:"Išspręskite rebusą ir raskite vardą."}],
        answer:"FA_KAZIMIERAS", hints:[
          {reveal:0, text:"Tai rebusas: kiekvienas paveikslėlis — žodžio dalis."},
          {reveal:2, text:"KAZI(NO) + MIE(G→R)AS."}]},
      { title:"Kelmų matrica", intro:"Raidės ant kelmų — perskaityk skaičių tvarka.",
        location_name:"Kelmų aikštelė", lat:54.158126, lng:24.103656,
        blocks:[{type:"image",url:asset("kelmu_tinklelis_skaiciai.png")},{type:"image",url:asset("kelmu_tinklelis_raides.png")}],
        answer:"FA_SATIBRO", hints:[
          {reveal:0, text:"Skaičiai nurodo raidžių eiliškumą."},
          {reveal:2, text:"Perskaitę atvirkščiai gausite atsakymą.", media_type:"image", media_url:asset("kelmu_tinklelis_raides.png")}]},
      { title:"Paleidimo seka", intro:"Sudoku su žaliais langeliais.",
        location_name:"Aikštė", lat:54.153769, lng:24.113039,
        blocks:[{type:"image",url:asset("sudoku.png")}],
        answer:"FA_RAKETA", hints:[{reveal:0, text:"Sudėkite žalių eilučių sumas."}]},
      { title:"Finišas", intro:"Paskutinis kodas ant plakato.", blocks:[{type:"text",text:"Įveskite kodą nuo plakato."}],
        answer:"FA_GAMEOVER", hints:[] },
    ],
    teams: [
      { name:"Žvaigždės", players:["Mira","Jonas"], stage:2, minsAgo:12 },  // active on Q2
      { name:"Kometos", players:["Rasa"], finishedMinsAgo:5, createdMinsAgo:33 }, // finished
    ],
  },
  {
    pin: "OLD777", name: "Senamiesčio paslaptis", status: "ready", themeIdx: 1,
    description: "Vakarinis miesto žaidimas — 5 mįslės senamiestyje.", duration_min: 120, expiresMin: null,
    questions: [
      { title:"Rotušės laikrodis", intro:"Kiek gargoilių saugo rotušę?", blocks:[{type:"text",text:"Suskaičiuok akmenines figūras."}], answer:"FA_KETURI", hints:[{reveal:5, text:"Pažiūrėk į kampus."}] },
      { title:"Upės vingis", intro:"Rask seniausią tiltą.", blocks:[{type:"text",text:"Metai iškalti akmenyje."}], answer:"FA_1738", hints:[] },
    ],
    teams: [],
  },
  {
    pin: "MUS100", name: "Muziejaus vagystė", status: "draft", themeIdx: 0,
    description: "Uždaras kambarys muziejuje (juodraštis).", duration_min: 90, expiresMin: null,
    questions: [], teams: [],
  },
];

async function main() {
  // wipe
  await sb.from("games").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await sb.from("themes").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // themes
  const themeIds = [];
  for (const t of THEMES) {
    const { data, error } = await sb.from("themes").insert(t).select().single();
    if (error) throw error; themeIds.push(data);
  }
  console.log("themes:", themeIds.length);

  for (const g of GAMES) {
    const theme = themeIds[g.themeIdx];
    const { data: game, error: ge } = await sb.from("games").insert({
      pin: g.pin, name: g.name, description: g.description, status: g.status,
      theme_id: theme.id, theme: theme.tokens, duration_min: g.duration_min,
      expires_at: g.expiresMin ? iso(-g.expiresMin) : null,
    }).select().single();
    if (ge) throw ge;

    const qIds = [];
    for (let i = 0; i < g.questions.length; i++) {
      const q = g.questions[i];
      const { data: qr, error: qe } = await sb.from("questions").insert({
        game_id: game.id, ord: i + 1, title: q.title, intro: q.intro,
        location_name: q.location_name ?? null, lat: q.lat ?? null, lng: q.lng ?? null, blocks: q.blocks ?? [],
      }).select().single();
      if (qe) throw qe; qIds.push(qr.id);
      await sb.from("question_secrets").insert({ question_id: qr.id, answer: q.answer, alt_answers: q.alt_answers ?? [] });
      if (q.hints?.length) {
        await sb.from("hints").insert(q.hints.map((h, j) => ({
          question_id: qr.id, ord: j + 1, reveal_after_min: h.reveal, text: h.text ?? null,
          media_type: h.media_type ?? null, media_url: h.media_url ?? null })));
      }
    }

    // teams / players / progress
    for (const tm of g.teams) {
      const { data: team } = await sb.from("teams").insert({
        game_id: game.id, name: tm.name, session_generation: 1,
        created_at: iso(tm.createdMinsAgo ?? tm.minsAgo ?? 10),
        finished_at: tm.finishedMinsAgo ? iso(tm.finishedMinsAgo) : null,
      }).select().single();
      await sb.from("players").insert(tm.players.map((n) => ({ team_id: team.id, name: n })));
      if (tm.finishedMinsAgo) {
        // all solved
        for (let i = 0; i < qIds.length; i++)
          await sb.from("team_progress").insert({ team_id: team.id, question_id: qIds[i],
            activated_at: iso(30 - i * 5), solved_at: iso(28 - i * 5) });
      } else {
        const stage = tm.stage ?? 1;
        for (let i = 0; i < stage - 1; i++)
          await sb.from("team_progress").insert({ team_id: team.id, question_id: qIds[i],
            activated_at: iso(tm.minsAgo - i * 3), solved_at: iso(tm.minsAgo - i * 3 - 1) });
        await sb.from("team_progress").insert({ team_id: team.id, question_id: qIds[stage - 1], activated_at: iso(tm.minsAgo - (stage - 1) * 3) });
      }
    }
    console.log(`game ${g.pin} (${g.status}) — ${g.questions.length}q, ${g.teams.length} teams`);
  }
  console.log("\n✅ mock seed complete.");
}
main().catch((e) => { console.error(e); process.exit(1); });
