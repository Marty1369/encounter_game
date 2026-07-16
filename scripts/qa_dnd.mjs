// qa_dnd.mjs — exercise the REAL dndStart/dndDrop lifted out of site/index.html against every
// from→to permutation, for each list. Index math on reorder is where these bugs live
// (dragging down shifts everything after the removal).
// Run: node scripts/qa_dnd.mjs
import fs from "fs";

const html = fs.readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
function grab(name) {
  const re = new RegExp("^(?:const |function )" + name + "\\b", "m");
  const m = re.exec(html); if (!m) throw new Error("missing " + name);
  if (/^const /.test(m[0])) return html.slice(m.index, html.indexOf("\n", m.index));
  let i = html.indexOf("{", m.index), d = 0, j = i;
  for (; j < html.length; j++) { const c = html[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
  return html.slice(m.index, j);
}
const src = ["dndStart", "dndEnd", "_dndOk", "dndOver", "dndLeave", "dndDrop"].map(grab).join("\n");

// minimal host: the real code only needs wiz, drawAdmin, wizSyncPreview, document, a drag event
function makeHost() {
  const host = {
    wiz: null,
    drawAdmin() { host.drew++; }, wizSyncPreview() {}, drew: 0,
    document: { querySelectorAll: () => [] },
  };
  const fn = new Function("host", `
    let _dnd=null;
    const wizRef=()=>host.wiz;
    Object.defineProperty(globalThis,'wiz',{configurable:true,get:wizRef});
    const drawAdmin=host.drawAdmin, wizSyncPreview=host.wizSyncPreview, document=host.document;
    ${src}
    return {dndStart,dndDrop,get _dnd(){return _dnd;}};
  `);
  return { host, api: fn(host) };
}
const ev = () => ({ dataTransfer: { setData() {}, effectAllowed: "", dropEffect: "" },
  preventDefault() {}, currentTarget: { style: {}, closest: () => null } });

let pass = 0, fail = 0;
const ok = (n, c, ex = "") => { if (!c) { console.log("  ✗ " + n + (ex ? " — " + ex : "")); fail++; } else pass++; };

// what a human means by "drag item i and drop it on row j"
const expected = (arr, i, j) => { const a = [...arr]; const [x] = a.splice(i, 1); a.splice(j, 0, x); return a; };

function runList(kind, build, read, scope) {
  const n = 5;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const { host, api } = makeHost();
    host.wiz = build();
    const before = read(host.wiz);
    api.dndStart(ev(), kind, i, scope);
    api.dndDrop(ev(), kind, j, scope);
    const after = read(host.wiz);
    const want = expected(before, i, j);
    ok(`${kind}: drag ${i} -> ${j}`, JSON.stringify(after) === JSON.stringify(want),
       `got ${JSON.stringify(after)} want ${JSON.stringify(want)}`);
  }
}

const qs = () => ({ sel: 0, questions: [0, 1, 2, 3, 4].map(k => ({ title: "Q" + k, blocks: [], hints: [] })) });
console.log("== questions ==");
runList("q", qs, w => w.questions.map(q => q.title));

console.log("== question blocks ==");
runList("qblock", () => ({ sel: 0, questions: [{ blocks: [0, 1, 2, 3, 4].map(k => ({ content: "B" + k })), hints: [] }] }),
        w => w.questions[0].blocks.map(b => b.content));

console.log("== hints ==");
runList("hint", () => ({ sel: 0, questions: [{ blocks: [], hints: [0, 1, 2, 3, 4].map(k => ({ reveal_after_min: k, blocks: [] })) }] }),
        w => w.questions[0].hints.map(h => h.reveal_after_min));

console.log("== hint blocks (scoped to hint 1) ==");
runList("hblock", () => ({ sel: 0, questions: [{ blocks: [], hints: [
  { blocks: [{ content: "other" }] },
  { blocks: [0, 1, 2, 3, 4].map(k => ({ content: "H" + k })) }] }] }),
        w => w.questions[0].hints[1].blocks.map(b => b.content), 1);

// selection must follow the dragged question
console.log("== selection follows the dragged question ==");
{
  const { host, api } = makeHost(); host.wiz = qs(); host.wiz.sel = 0;
  api.dndStart(ev(), "q", 0); api.dndDrop(ev(), "q", 4);
  ok("dragging the selected question keeps it selected", host.wiz.questions[host.wiz.sel].title === "Q0",
     `sel=${host.wiz.sel} -> ${host.wiz.questions[host.wiz.sel].title}`);
  const h2 = makeHost(); h2.host.wiz = qs(); h2.host.wiz.sel = 3;
  h2.api.dndStart(ev(), "q", 0); h2.api.dndDrop(ev(), "q", 4);
  ok("dragging another question keeps YOUR selection", h2.host.wiz.questions[h2.host.wiz.sel].title === "Q3",
     `sel=${h2.host.wiz.sel} -> ${h2.host.wiz.questions[h2.host.wiz.sel].title}`);
}

// a drag must not leak across scopes/lists
console.log("== scope isolation ==");
{
  const { host, api } = makeHost();
  host.wiz = { sel: 0, questions: [{ blocks: [], hints: [{ blocks: [{ content: "A0" }, { content: "A1" }] }, { blocks: [{ content: "B0" }] }] }] };
  api.dndStart(ev(), "hblock", 0, 0);          // grabbed from hint 0
  api.dndDrop(ev(), "hblock", 0, 1);           // dropped on hint 1 -> must be ignored
  ok("hint block cannot jump into another hint",
     host.wiz.questions[0].hints[0].blocks.length === 2 && host.wiz.questions[0].hints[1].blocks.length === 1);
  const h3 = makeHost(); h3.host.wiz = qs();
  h3.api.dndStart(ev(), "q", 0);
  h3.api.dndDrop(ev(), "hint", 2);             // different list -> ignored
  ok("a question drag cannot drop into the hint list",
     h3.host.wiz.questions.map(q => q.title).join() === "Q0,Q1,Q2,Q3,Q4");
}

console.log(`\n===== ${fail === 0 ? "✅ ALL PASS" : "⚠ FAILURES"} : ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
