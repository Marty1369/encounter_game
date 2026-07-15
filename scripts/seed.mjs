// seed.mjs — parse Game setup.xlsx and load content + media into Supabase.
// Run:  node scripts/seed.mjs --dry     (parse & print, no writes)
//       node scripts/seed.mjs           (seed DB + upload assets)
// Needs .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (service role bypasses RLS).
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const ROOT = "C:/Users/andri/Desktop/Claude projects/Encounter game";
const ASSETS = path.join(process.cwd(), "assets");
const BUCKET = "game-assets";
const GAME_SLUG = "svytintys-ganytojai";
const GAME_TITLE = "Švytintys ganytojai iš žvaigždžių";

// ---- media per stage (03_CONTENT_ASSETS §3), real filenames; missing => skipped ----
const MEDIA = {
  U1: [["video", "Spaceship.mp4"], ["image", "Intro task.png"]],
  U2: [["video", "2nd task video.mp4"]],
  U6: [["image", "sachmatu_diagrama.png"]],
  U7: [["image", "binarine_lentele.png"]],   // missing in assets -> skipped with warning
  U10: [["image", "kelmu_tinklelis_skaiciai.png"], ["image", "kelmu_tinklelis_raides.png"]],
  U12: [["image", "sudoku.png"]],
};
const ALT_ANSWERS = { U11: ["FA_FABIANAS"] };  // spec adds this; not in the sheet

// ---- xlsx helpers ----
const wb = xlsx.readFile(ROOT + "/Game setup.xlsx");
const rowsOf = (n) => xlsx.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false, defval: "" });
const codeOf = (s) => (String(s).trim().match(/^U\d+/) || [""])[0];
function table(name, headerKey) {
  const rows = rowsOf(name);
  const h = rows.findIndex((r) => r.some((c) => String(c).trim() === headerKey));
  const header = rows[h].map((c) => String(c).trim());
  return rows.slice(h + 1).map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])));
}

// Extract player-facing text blocks from the xlsx "Blocks" cell (drop media refs — those come
// from MEDIA map). Lines look like "text: …", "video: …", "image: …" or bare instructions.
function textBlocks(cell) {
  const out = [];
  for (let line of String(cell).split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    const m = line.match(/^([a-zA-Zžčšįė《]+)\s*:\s*(.*)$/);
    const label = m ? m[1].toLowerCase() : "";
    const body = m ? m[2] : line;
    if (/^(video|image|img|foto|paveiksl|vaizdas|nuotrauka)/.test(label)) continue; // labelled media -> skip
    const txt = ((label === "text" || label === "tekstas") ? body : line).trim();
    const lc = txt.toLowerCase();
    if (assetStems.has(lc) || assetNamesLc.has(lc) || /\.(png|jpe?g|mp4|pdf)$/i.test(txt)) continue; // bare media ref
    if (txt.replace(/[\s.,;:!?–—_-]/g, "").length < 2) continue; // punctuation-only placeholder
    out.push({ type: "text", text: txt });
  }
  return out;
}

const assetFiles = fs.existsSync(ASSETS) ? fs.readdirSync(ASSETS) : [];
const has = (f) => assetFiles.includes(f);
const assetStems = new Set(assetFiles.map((f) => f.replace(/\.[^.]+$/, "").toLowerCase()));
const assetNamesLc = new Set(assetFiles.map((f) => f.toLowerCase()));

// ---- build questions ----
const qRows = table("Questions", "Title").filter((r) => codeOf(r.Title));
const hRows = table("Hints", "Question").filter((r) => codeOf(r.Question));
const mRows = table("Marsrutas", "Taškas").filter((r) => codeOf(r["Užduotis"]));

const coords = {};
for (const r of mRows) {
  const c = codeOf(r["Užduotis"]);
  const m = String(r["Koordinatės"]).match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  coords[c] = { place: String(r.Vieta).trim(), lat: m ? +m[1] : null, lng: m ? +m[2] : null };
}
const hintsByCode = {};
for (const r of hRows) (hintsByCode[codeOf(r.Question)] ||= []).push(r);

const warnings = [];
const questions = qRows.map((r, i) => {
  const code = codeOf(r.Title);
  const media = (MEDIA[code] || [])
    .filter(([, f]) => { const ok = has(f); if (!ok) warnings.push(`${code}: media file missing, skipped -> ${f}`); return ok; })
    .map(([type, src]) => ({ type, src }));
  const blocks = [...media, ...textBlocks(r.Blocks)];
  const hints = (hintsByCode[code] || []).map((h, j) => {
    const type = String(h.Type).trim();
    const content = String(h.Content).trim();
    if (type === "image") {
      const file = content.split(" — ")[0].split(" – ")[0].trim();
      if (!has(file)) warnings.push(`${code} hint ${j + 1}: image file missing -> ${file}`);
    }
    return { ord: j + 1, reveal_after_min: Math.round(Number(h.RevealAfterMin)), type, content };
  });
  return {
    code, ord: i + 1,
    title: String(r.Title).replace(/^U\d+\s*/, "").trim(),
    intro: String(r.Intro).trim(),
    answer: String(r.Answer).trim(),
    alt_answers: ALT_ANSWERS[code] || [],
    location_name: coords[code]?.place || null,
    lat: coords[code]?.lat ?? null, lng: coords[code]?.lng ?? null,
    blocks, hints,
  };
});

// ---- report ----
console.log(`Parsed ${questions.length} questions, ${questions.reduce((n, q) => n + q.hints.length, 0)} hints.`);
for (const q of questions) {
  console.log(`\n${q.code} "${q.title}"  ans=${q.answer}${q.alt_answers.length ? " alt=" + q.alt_answers : ""}  @${q.lat},${q.lng}`);
  console.log(`  blocks: ${q.blocks.map((b) => b.type === "text" ? `text(${b.text.slice(0, 30)}…)` : `${b.type}:${b.src}`).join(" | ") || "(none)"}`);
  console.log(`  hints:  ${q.hints.map((h) => `${h.reveal_after_min}m/${h.type}`).join(", ") || "(none)"}`);
}
console.log("\nWARNINGS:", warnings.length ? "\n  " + warnings.join("\n  ") : "none");

if (DRY) { console.log("\n[dry-run] no DB writes."); process.exit(0); }

// ---- seed DB ----
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env"); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // reset content (no teams expected on seed; clear if any so cascade is clean)
  const { data: g0 } = await sb.from("games").select("id").eq("slug", GAME_SLUG).maybeSingle();
  if (g0) {
    await sb.from("teams").delete().eq("game_id", g0.id);
    await sb.from("games").delete().eq("id", g0.id);
  }
  const { data: game, error: ge } = await sb.from("games")
    .insert({ slug: GAME_SLUG, title: GAME_TITLE }).select().single();
  if (ge) throw ge;
  console.log("game:", game.id);

  for (const q of questions) {
    const { data: qr, error: qe } = await sb.from("questions").insert({
      game_id: game.id, code: q.code, ord: q.ord, title: q.title, intro: q.intro,
      location_name: q.location_name, lat: q.lat, lng: q.lng, blocks: q.blocks,
    }).select().single();
    if (qe) throw qe;
    const { error: se } = await sb.from("question_secrets")
      .insert({ question_id: qr.id, answer: q.answer, alt_answers: q.alt_answers });
    if (se) throw se;
    if (q.hints.length) {
      const { error: he } = await sb.from("hints").insert(
        q.hints.map((h) => ({ question_id: qr.id, ord: h.ord, reveal_after_min: h.reveal_after_min, type: h.type, content: h.content }))
      );
      if (he) throw he;
    }
    process.stdout.write(`  ${q.code}(${q.hints.length}h) `);
  }
  console.log("\ncontent seeded.");

  // storage
  const buckets = (await sb.storage.listBuckets()).data || [];
  if (!buckets.find((b) => b.name === BUCKET)) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error) throw error;
    console.log("bucket created:", BUCKET);
  }
  let uploaded = 0;
  for (const f of assetFiles) {
    const body = fs.readFileSync(path.join(ASSETS, f));
    const ct = f.endsWith(".mp4") ? "video/mp4" : f.endsWith(".png") ? "image/png" : "application/octet-stream";
    const { error } = await sb.storage.from(BUCKET).upload(f, body, { contentType: ct, upsert: true });
    if (error) throw error;
    uploaded++;
  }
  console.log(`uploaded ${uploaded} assets.`);

  // verify every referenced file resolves in storage
  const refs = new Set();
  for (const q of questions) {
    for (const b of q.blocks) if (b.src) refs.add(b.src);
    for (const h of q.hints) if (h.type === "image") refs.add(h.content.split(" — ")[0].split(" – ")[0].trim());
  }
  const stored = new Set((await sb.storage.from(BUCKET).list("", { limit: 1000 })).data.map((o) => o.name));
  const missing = [...refs].filter((r) => !stored.has(r));
  console.log("referenced media files:", refs.size, "| missing in storage:", missing.length ? missing.join(", ") : "none");
  if (missing.length) { console.error("SEED FAILED: referenced files not in storage."); process.exit(1); }
  console.log("\n✅ seed complete.");
}
main().catch((e) => { console.error(e); process.exit(1); });
