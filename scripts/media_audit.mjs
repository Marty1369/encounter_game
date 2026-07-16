// media_audit.mjs — fetch every media URL a player would actually load, using the SAME
// normalisation the app uses (lifted from site/index.html), and report what really comes back.
// Catches the classic pre-game blocker: a Drive file that isn't shared publicly -> players see
// an HTML consent page instead of the image, and you only find out mid-game.
// Run: node scripts/media_audit.mjs
import "dotenv/config";
import fs from "fs";

const SB = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = "andrius.martinonis@gmail.com", PASS = "Qline-Merkine-2K7pX9";

// --- use the real app helpers, so this audits what players get, not what I think they get
const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
function grab(name) {
  const re = new RegExp("^(?:const |function )" + name + "\\b", "m");
  const m = re.exec(html); if (!m) throw new Error("missing " + name);
  if (/^const /.test(m[0])) return html.slice(m.index, html.indexOf("\n", m.index));
  let i = html.indexOf("{", m.index), d = 0, j = i;
  for (; j < html.length; j++) { const c = html[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
  return html.slice(m.index, j);
}
const src = ["isDrive", "driveId", "ytId", "safeUrl", "imgSrc", "videoEmbed", "isFile"].map(grab).join("\n");
const { imgSrc, videoEmbed, isFile } = new Function("location",
  src + "\nreturn {imgSrc,videoEmbed,isFile};")({ origin: "https://example.com" });

const rpc = async (fn, a) => {
  const r = await fetch(SB + "/rest/v1/rpc/" + fn, { method: "POST",
    headers: { apikey: ANON, Authorization: "Bearer " + ANON, "Content-Type": "application/json" }, body: JSON.stringify(a) });
  return r.json();
};

async function probe(url) {
  try {
    const r = await fetch(url, { redirect: "follow" });
    const ct = (r.headers.get("content-type") || "").split(";")[0];
    const len = r.headers.get("content-length");
    r.body?.cancel?.();
    return { status: r.status, ct, kb: len ? Math.round(+len / 1024) : null };
  } catch (e) { return { status: 0, ct: "(fetch failed: " + e.message + ")", kb: null }; }
}

const verdict = (type, p) => {
  if (p.status !== 200) return { ok: false, why: `HTTP ${p.status}` };
  if (type === "image") return /^image\//.test(p.ct)
    ? { ok: true, why: p.ct } : { ok: false, why: `serves ${p.ct} — not an image (private Drive file? wrong link?)` };
  if (type === "video") return (/^video\//.test(p.ct) || /^text\/html$/.test(p.ct))
    ? { ok: true, why: p.ct === "text/html" ? "embed page (Drive/YouTube player)" : p.ct }
    : { ok: false, why: `serves ${p.ct}` };
  return { ok: true, why: p.ct };
};

async function main() {
  const token = (await rpc("admin_login", { p_email: EMAIL, p_password: PASS })).token;
  const A = (fn, a = {}) => rpc(fn, { p_code: token, ...a });
  const list = await A("admin_list");
  const only = process.argv[2];                       // optional: filter by name substring
  let bad = 0, total = 0;

  for (const g of list.games) {
    if (only && !g.name.toLowerCase().includes(only.toLowerCase())) continue;
    const full = await A("admin_get_game", { p_game: g.id });
    const items = [];
    (full.questions || []).forEach((q, qi) => {
      (q.blocks || []).forEach(b => { if (b.type !== "text") items.push({ where: `Q${qi + 1} "${q.title}"`, type: b.type, url: b.url }); });
      (q.hints || []).forEach((h, hi) => (h.blocks || []).forEach(b => {
        if (b.type !== "text") items.push({ where: `Q${qi + 1} hint ${hi + 1}`, type: b.type, url: b.url });
      }));
    });
    if (!items.length) continue;
    console.log(`\n=== ${full.name} — ${items.length} media ===`);
    for (const it of items) {
      const eff = it.type === "image" ? imgSrc(it.url)
        : it.type === "video" ? (videoEmbed(it.url) || it.url) : it.url;
      const p = await probe(eff);
      const v = verdict(it.type, p);
      total++; if (!v.ok) bad++;
      console.log(`${v.ok ? " ok " : "FAIL"}  ${it.where.padEnd(34)} ${it.type.padEnd(5)} ${v.why}${p.kb ? " " + p.kb + "kB" : ""}`);
      if (!v.ok) console.log(`        stored: ${it.url}\n        loaded: ${eff}`);
    }
  }
  console.log(`\n===== ${bad ? "⚠ " + bad + " BROKEN" : "✅ all media load"} : ${total - bad}/${total} ok =====`);
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
