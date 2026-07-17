-- 0024_question_prep_and_neon_cosmic.sql
--
-- 1) questions.prep — organiser-only field notes: what to print, build, chalk, hide or place
--    before a game can run, plus what to pack. Deliberately NOT added to _state_json, so a
--    player's app has no way to request it (asserted by scripts/qa_prep.mjs).
--    Carried by admin_save_game / admin_get_game / admin_duplicate and by the XLSX
--    export+import ("Preparation" column; sheets without the column still import).
--
-- 2) Neon + Cosmic themes, plus an optional `glow` token. Themes that omit `glow` resolve to
--    "none", so the five existing themes are untouched.
alter table questions add column if not exists prep text;
comment on column questions.prep is 'Organiser-only field prep notes. Never returned by _state_json.';

insert into themes (name, tokens) values
('Neon', jsonb_build_object(
  'id','neon','desc','Electric magenta on near-black, tight grotesk, glowing edges',
  'bg','linear-gradient(170deg,#0a0612 0%,#140a24 55%,#1b0d2e 100%)',
  'ink','#f6f0ff','inkSoft','#c3b3e6','muted','#a794d6',
  'card','rgba(35,16,60,.72)','field','rgba(12,6,22,.85)','line','rgba(244,114,255,.34)',
  'primary','#f472ff','onPrimary','#12021a','secondary','#22d3ee',
  'glow','0 0 22px rgba(244,114,255,.55), 0 0 4px rgba(244,114,255,.4)',
  'fontDisplay','''Space Grotesk'',sans-serif',
  'fontBody','-apple-system,BlinkMacSystemFont,''Segoe UI'',sans-serif',
  'displayWeight','700','displayTracking','-.02em',
  'rFrame','20px','rCard','14px','rBtn','10px','rInput','10px')),
('Cosmic', jsonb_build_object(
  'id','cosmic','desc','Deep space indigo, starlit violet, soft round corners',
  'bg','radial-gradient(120% 90% at 50% 0%,#1e1b4b 0%,#0b1026 55%,#05070f 100%)',
  'ink','#eef2ff','inkSoft','#b6c0ee','muted','#7782b8',
  'card','rgba(30,27,75,.66)','field','rgba(10,14,35,.8)','line','rgba(129,140,248,.3)',
  'primary','#818cf8','onPrimary','#070a18','secondary','#38bdf8',
  'glow','0 0 26px rgba(129,140,248,.5), 0 0 6px rgba(56,189,248,.28)',
  'fontDisplay','''Space Grotesk'',sans-serif',
  'fontBody','-apple-system,BlinkMacSystemFont,''Segoe UI'',sans-serif',
  'displayWeight','600','displayTracking','-.01em',
  'rFrame','28px','rCard','18px','rBtn','999px','rInput','14px'))
on conflict do nothing;

-- admin_save_game / admin_get_game / admin_duplicate now read+write questions.prep
-- (full bodies applied via MCP; see 0021 for the duplicate hint-blocks fix they build on).
