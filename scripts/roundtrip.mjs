// roundtrip.mjs — proves XLSX export → import is lossless, using the REAL functions
// lifted out of site/index.html and real games from the live backend.
// Run: node scripts/roundtrip.mjs
import "dotenv/config";
import fs from "fs";
import XLSX from "xlsx";

const SB_URL = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = "andrius.martinonis@gmail.com", PASS = "Qline-Merkine-2K7pX9";

// --- lift the real implementation out of the single-file app -------------------
const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
function grab(name) {
  const re = new RegExp("^(?:const |function )" + name + "\\b", "m");
  const m = re.exec(html);
  if (!m) throw new Error("could not find " + name + " in index.html");
  let i = html.indexOf("{", m.index), d = 0, j = i;
  for (; j < html.length; j++) { const c = html[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
  // const arrow helpers end at the newline, not a brace block
  if (/^const /.test(m[0])) { const nl = html.indexOf("\n", m.index); return html.slice(m.index, nl); }
  return html.slice(m.index, j);
}
const src = ["_mt", "_mtOut", "_packBlocks", "buildGameWb", "gameToWizQs", "parseGameWb"].map(grab).join("\n");
const { buildGameWb, gameToWizQs, parseGameWb } = new Function("XLSX", src + "\nreturn {buildGameWb,gameToWizQs,parseGameWb};")(XLSX);

// --- helpers ------------------------------------------------------------------
const rpc = async (fn, a) => {
  const r = await fetch(SB_URL + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  return r.json();
};
let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { console.log((c ? "  ✓ " : "  ✗ ") + n + (c ? "" : " — " + extra)); c ? pass++ : fail++; };

// What we care about surviving the trip. Import trims surrounding whitespace on every cell by
// design (spreadsheets are full of stray spaces, and it renders identically), so compare trimmed
// — internal newlines/indentation, e.g. the binary-matrix hints, are NOT touched by that trim.
const t = s => String(s == null ? "" : s).trim();
const norm = qs => qs.map(q => ({
  title: t(q.title), intro: t(q.intro), answer: t(q.answer), info: t(q.info),
  case_sensitive: !!q.case_sensitive,
  blocks: (q.blocks || []).map(b => ({ type: b.type, content: t(b.content) })),
  hints: (q.hints || []).map(h => ({
    reveal_after_min: Number(h.reveal_after_min) || 0,
    blocks: (h.blocks || []).map(b => ({ type: b.type, content: t(b.content) })),
  })),
}));

function roundTrip(name, description, maxTeams, qs) {
  const wb = buildGameWb(name, description, maxTeams, qs);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });   // through a real .xlsx file
  return parseGameWb(XLSX.read(buf, { type: "buffer" }));
}

async function main() {
  const token = (await rpc("admin_login", { p_email: EMAIL, p_password: PASS })).token;
  const A = (fn, a = {}) => rpc(fn, { p_code: token, ...a });
  const list = await A("admin_list");

  for (const g of list.games) {
    const full = await A("admin_get_game", { p_game: g.id });
    const qs = gameToWizQs(full);
    if (!qs.length) continue;
    console.log(`== ${full.name} (${qs.length} questions, ${qs.reduce((n, q) => n + q.hints.length, 0)} hints) ==`);
    const back = roundTrip(full.name, full.description, full.max_teams, qs);
    ok("game meta survives", back.meta.name === (full.name || "") && back.meta.description === (full.description || ""),
       JSON.stringify(back.meta));
    ok("question count", back.questions.length === qs.length, `${back.questions.length} vs ${qs.length}`);
    const a = JSON.stringify(norm(qs)), b = JSON.stringify(norm(back.questions));
    ok("questions/blocks/hints identical (order, answers, links)", a === b,
       a === b ? "" : firstDiff(norm(qs), norm(back.questions)));
  }

  // targeted edge cases the old single-row format could not represent
  console.log("== edge cases ==");
  const edge = [{
    title: "Multi", intro: "i", answer: "A", info: "note", case_sensitive: true,
    blocks: [ { type: "image", content: "https://x/1.png" }, { type: "image", content: "https://x/2.png" },
              { type: "text", content: "after two images" }, { type: "link", content: "https://x/l" } ],
    hints: [ { reveal_after_min: 0, blocks: [ { type: "image", content: "https://x/h.png" }, { type: "text", content: "caption after image" } ] },
             { reveal_after_min: 7, blocks: [ { type: "text", content: "t" }, { type: "video", content: "https://x/v.mp4" } ] },
             { reveal_after_min: 12, blocks: [] } ],
  }, { title: "NoBlocks", intro: "", answer: "B", info: "", case_sensitive: false, blocks: [], hints: [] }];
  const back = roundTrip("Edge", "d", 9, edge);
  ok("two images on one question survive in order",
     JSON.stringify(norm(back.questions)[0].blocks) === JSON.stringify(norm(edge)[0].blocks),
     JSON.stringify(norm(back.questions)[0].blocks));
  ok("image-then-caption hint keeps order",
     JSON.stringify(norm(back.questions)[0].hints[0].blocks) === JSON.stringify(norm(edge)[0].hints[0].blocks),
     JSON.stringify(norm(back.questions)[0].hints[0].blocks));
  ok("empty hint preserved (3 hints)", back.questions[0].hints.length === 3, String(back.questions[0].hints.length));
  ok("blockless question preserved", back.questions.length === 2 && back.questions[1].answer === "B");
  ok("case_sensitive + info survive", back.questions[0].case_sensitive === true && back.questions[0].info === "note");
  ok("edge deep-equal", JSON.stringify(norm(edge)) === JSON.stringify(norm(back.questions)),
     firstDiff(norm(edge), norm(back.questions)));

  // old sheets (no HintNo / no Game sheet) must still import
  console.log("== backward compatibility (old template) ==");
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Title", "Intro", "Answer", "Info", "CaseSensitive", "Text", "MediaType", "MediaURL"],
    ["Old", "in", "ANS", "nfo", "no", "body", "image", "https://x/o.png"]]), "Questions");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Question", "RevealAfterMin", "Text", "MediaType", "MediaURL"],
    ["Old", 5, "h1", "", ""], ["Old", 10, "h2", "image", "https://x/h.png"]]), "Hints");
  const old = parseGameWb(XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" }));
  ok("old sheet: 1 question, 2 hints (one per row)", old.questions.length === 1 && old.questions[0].hints.length === 2,
     JSON.stringify(old.questions.map(q => q.hints.length)));
  ok("old sheet: blocks read", old.questions[0].blocks.length === 2 && old.questions[0].answer === "ANS");
  ok("old sheet: no Game sheet -> meta null", old.meta === null);

  console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
  process.exit(fail === 0 ? 0 : 1);
}
function firstDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i]))
      return `q[${i}]\n  in : ${JSON.stringify(a[i])}\n  out: ${JSON.stringify(b[i])}`;
  return "";
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
