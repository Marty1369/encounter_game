// seed_furry.mjs — build "Furry Cosmic Mistery" from Game setup.xlsx (13 stages, LT content,
// media from the game-assets Storage bucket). Idempotent (replaces PIN FURRY1).
// Run: node scripts/seed_furry.mjs
import "dotenv/config";
import xlsx from "xlsx";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(URL, SR, { auth: { persistSession: false } });
const ROOT = "C:/Users/andri/Desktop/Claude projects/Encounter game";
const asset = (f) => `${URL}/storage/v1/object/public/game-assets/${encodeURIComponent(f)}`;

const NAME = "Furry Cosmic Mistery";
const DESC = "Kosminė paslaptis — sekite švytinčių ganytojų iš žvaigždžių pėdsakais per 13 stočių. Kiekvienoje stotelėje jūsų laukia mįslė; įminkite ją ir judėkite toliau.";
const PIN = "FURRY1", THEME = "Noir";

// media per stage (real filenames already in the bucket); U7 image is missing -> skipped
const MEDIA = {
  U1: [["video", "Spaceship.mp4"], ["image", "Intro task.png"]],
  U2: [["video", "2nd task video.mp4"]],
  U6: [["image", "sachmatu_diagrama.png"]],
  U10: [["image", "kelmu_tinklelis_skaiciai.png"], ["image", "kelmu_tinklelis_raides.png"]],
  U12: [["image", "sudoku.png"]],
};
const ALT = { U11: ["FABIANAS"] };   // spec alt (after FA_ prefix stripped)
const MEDIA_FILES = new Set(Object.values(MEDIA).flat().map(([, f]) => f.toLowerCase().replace(/\.[^.]+$/, "")));

const wb = xlsx.readFile(ROOT + "/Game setup.xlsx");
const rowsOf = (n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: "" });
const codeOf = (s) => (String(s).trim().match(/^U\d+/) || [""])[0];
function table(name, key) {
  const rows = rowsOf(name);
  const h = rows.findIndex((r) => r.some((c) => String(c).trim() === key));
  const hd = rows[h].map((c) => String(c).trim());
  return rows.slice(h + 1).map((r) => Object.fromEntries(hd.map((k, i) => [k, r[i] ?? ""])));
}
const stripFA = (s) => String(s).trim().replace(/^FA_?/i, "");

// text blocks from the xlsx "Blocks" cell (drop media-ref lines, keep instruction text)
function textBlocks(cell) {
  const out = [];
  for (let line of String(cell).split(/\r?\n/)) {
    line = line.trim(); if (!line) continue;
    const m = line.match(/^([a-zA-Zžčšįė]+)\s*:\s*(.*)$/);
    const label = m ? m[1].toLowerCase() : "";
    if (/^(video|image|img|foto|paveiksl|vaizdas|nuotrauka)/.test(label)) continue;
    const txt = ((label === "text" || label === "tekstas") ? m[2] : line).trim();
    const lc = txt.toLowerCase();
    if (MEDIA_FILES.has(lc) || /\.(png|jpe?g|mp4|pdf)$/i.test(txt)) continue;
    if (txt.replace(/[\s.,;:!?–—_-]/g, "").length < 2) continue;
    out.push({ type: "text", text: txt });
  }
  return out;
}

const qRows = table("Questions", "Title").filter((r) => codeOf(r.Title));
const hRows = table("Hints", "Question").filter((r) => codeOf(r.Question));
const mRows = table("Marsrutas", "Taškas").filter((r) => codeOf(r["Užduotis"]));

const coords = {};
for (const r of mRows) {
  const c = codeOf(r["Užduotis"]);
  const mm = String(r["Koordinatės"]).match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  coords[c] = { place: String(r.Vieta).trim(), lat: mm ? +mm[1] : null, lng: mm ? +mm[2] : null };
}
const hintsByCode = {};
for (const r of hRows) (hintsByCode[codeOf(r.Question)] ||= []).push(r);

const questions = qRows.map((r) => {
  const code = codeOf(r.Title);
  const media = (MEDIA[code] || []).map(([type, f]) => ({ type, url: asset(f) }));
  const blocks = [...media, ...textBlocks(r.Blocks)];
  const hints = (hintsByCode[code] || []).map((h) => {
    const type = String(h.Type).trim(), content = String(h.Content).trim();
    let blk;
    if (type === "image") {
      const [file, ...rest] = content.split(" — ");
      blk = [{ type: "image", url: asset(file.trim()) }];
      const cap = rest.join(" — ").trim(); if (cap) blk.push({ type: "text", text: cap });
    } else blk = content ? [{ type: "text", text: content }] : [];
    return { reveal_after_min: Math.round(Number(h.RevealAfterMin)) || 0, blocks: blk };
  });
  return {
    code,
    title: String(r.Title).replace(/^U\d+\s*/, "").trim(),
    intro: String(r.Intro).trim(),
    answer: stripFA(r.Answer),
    alt: (ALT[code] || []),
    location: coords[code] || {},
    blocks, hints,
  };
});

async function main() {
  const { data: theme } = await sb.from("themes").select("id, tokens").eq("name", THEME).maybeSingle();
  const { data: ex } = await sb.from("games").select("id").eq("pin", PIN).maybeSingle();
  if (ex) { await sb.from("teams").delete().eq("game_id", ex.id); await sb.from("games").delete().eq("id", ex.id); }

  const { data: game, error } = await sb.from("games").insert({
    pin: PIN, name: NAME, description: DESC, status: "draft",
    theme_id: theme?.id || null, theme: theme?.tokens || {}, max_teams: 20,
  }).select().single();
  if (error) throw error;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { data: qr, error: qe } = await sb.from("questions").insert({
      game_id: game.id, ord: i + 1, title: q.title, intro: q.intro,
      location_name: q.location.place || null, lat: q.location.lat ?? null, lng: q.location.lng ?? null,
      blocks: q.blocks,
    }).select().single();
    if (qe) throw qe;
    await sb.from("question_secrets").insert({ question_id: qr.id, answer: q.answer, alt_answers: q.alt });
    if (q.hints.length)
      await sb.from("hints").insert(q.hints.map((h, j) => ({
        question_id: qr.id, ord: j + 1, reveal_after_min: h.reveal_after_min, blocks: h.blocks })));
  }
  const hc = questions.reduce((n, q) => n + q.hints.length, 0);
  console.log(`✅ Built "${NAME}" (PIN ${PIN}, theme ${THEME}, status draft)`);
  console.log(`   ${questions.length} stages, ${hc} hints`);
  console.log("   answers:", questions.map((q) => q.code + "=" + q.answer + (q.alt.length ? "/" + q.alt : "")).join(", "));
  const media = questions.reduce((n, q) => n + q.blocks.filter((b) => b.type !== "text").length + q.hints.reduce((m, h) => m + h.blocks.filter((b) => b.type !== "text").length, 0), 0);
  console.log("   media blocks:", media);
}
main().catch((e) => { console.error(e); process.exit(1); });
