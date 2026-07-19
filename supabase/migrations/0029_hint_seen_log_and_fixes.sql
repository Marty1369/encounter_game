-- 0029_hint_seen_log_and_fixes.sql — QA b26 radinių pataisos (CX-2, MON-5, CX-3, ES-6).
-- 1) team_hint_seen: append-only įrodymas "komanda šitą hintą matė". Pildomas kai hintas
--    atrakinamas (žaidėjo mark_hint_revealed, admino admin_show_hint) ir materializuojamas
--    komandos reset'o metu — todėl admin_update_hint apsauga išgyvena team_progress trynimą.
-- 2) admin_reset_team: prieš trindamas progresą įrašo matytus hintus į seen-log ir išvalo
--    team_hint_overrides (kad po reset'o priverstinai parodyti hintai vėl būtų užrakinti).
-- 3) admin_update_hint: papildomai tikrina seen-log.
-- 4) admin_monitor: laikmačiai (seconds_on_stage/total_seconds) pauzės metu užšąla —
--    skaičiuojami nuo coalesce(paused_at, now()), kaip ir hintų atrakinimas.
-- 5) admin_save_game: end_scene UPDATE per coalesce — senas (pre-b26) klientas be end_scene
--    lauko nebeištrina esamos pabaigos scenos.
-- 6) mark_hint_revealed: pripažįsta ir override'u atrakintą hintą (anksčiau grąžindavo
--    'locked' ir skaitiklis likdavo nepakeltas).

create table if not exists team_hint_seen (
  team_id uuid not null references teams(id) on delete cascade,
  hint_id uuid not null references hints(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (team_id, hint_id)
);
alter table team_hint_seen enable row level security;   -- prieiga tik per security definer RPC

-- Backfill: esamų žaidimų įrodymai (override'ai + pagal laiką atrakinti dabartinės/išspręstų užduočių hintai)
insert into team_hint_seen(team_id, hint_id, seen_at)
select o.team_id, o.hint_id, o.created_at from team_hint_overrides o
on conflict do nothing;
insert into team_hint_seen(team_id, hint_id)
select tp.team_id, h.id
from team_progress tp
join hints h on h.question_id = tp.question_id
join teams t on t.id = tp.team_id
join games g on g.id = t.game_id
where (tp.solved_at is null and coalesce(g.paused_at, now()) >= tp.activated_at + make_interval(mins => h.reveal_after_min))
   or (tp.solved_at is not null and tp.solved_at >= tp.activated_at + make_interval(mins => h.reveal_after_min))
on conflict do nothing;

-- ---- admin_show_hint: + seen-log --------------------------------------------------------------
create or replace function admin_show_hint(p_code text, p_team uuid, p_hint uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  insert into team_hint_overrides(team_id, hint_id) values (p_team, p_hint) on conflict do nothing;
  insert into team_hint_seen(team_id, hint_id) values (p_team, p_hint) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- ---- mark_hint_revealed: + seen-log, + override pripažinimas ---------------------------------
create or replace function mark_hint_revealed(p_session uuid, p_hint_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_team teams; v_prog team_progress; v_h hints; v_unlocked boolean;
begin
  select * into r from _resolve_player(p_session);
  v_team := r.v_team;
  if v_team.id is null then return jsonb_build_object('error','bad_session'); end if;
  select * into v_h from hints where id = p_hint_id;
  if not found then return jsonb_build_object('error','bad_hint'); end if;
  select tp.* into v_prog from team_progress tp
    where tp.team_id = v_team.id and tp.question_id = v_h.question_id and tp.solved_at is null;
  if not found then return jsonb_build_object('error','not_active'); end if;
  v_unlocked := (now() >= v_prog.activated_at + make_interval(mins => v_h.reveal_after_min))
    or exists(select 1 from team_hint_overrides o where o.team_id = v_team.id and o.hint_id = p_hint_id);
  if not v_unlocked then return jsonb_build_object('error','locked'); end if;
  update team_progress set hints_revealed = greatest(hints_revealed, v_h.ord) where id = v_prog.id;
  insert into team_hint_seen(team_id, hint_id) values (v_team.id, p_hint_id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin_reset_team: materializuoja seen-log, valo override'us ------------------------------
create or replace function admin_reset_team(p_code text, p_team uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_team teams; v_game games; v_q1 questions;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_team from teams where id = p_team;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into v_game from games where id = v_team.game_id;
  -- įrodymai prieš trynimą: pagal laiką atrakinti hintai (dabartinė + išspręstos užduotys)
  insert into team_hint_seen(team_id, hint_id)
  select tp.team_id, h.id
  from team_progress tp join hints h on h.question_id = tp.question_id
  where tp.team_id = p_team
    and ((tp.solved_at is null and coalesce(v_game.paused_at, now()) >= tp.activated_at + make_interval(mins => h.reveal_after_min))
         or (tp.solved_at is not null and tp.solved_at >= tp.activated_at + make_interval(mins => h.reveal_after_min)))
  on conflict do nothing;
  delete from team_hint_overrides where team_id = p_team;   -- naujame bandyme hintai vėl užrakinti
  delete from answer_attempts where team_id = p_team;
  delete from submit_idempotency where team_id = p_team;
  delete from team_progress where team_id = p_team;
  update teams set finished_at = null where id = p_team;
  select * into v_q1 from questions where game_id = v_team.game_id order by ord limit 1;
  if v_q1.id is not null then insert into team_progress(team_id, question_id) values (p_team, v_q1.id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin_update_hint: + seen-log patikra ----------------------------------------------------
create or replace function admin_update_hint(p_code text, p_hint uuid, p_reveal_after_min int, p_blocks jsonb, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_h hints; v_game games; v_eff timestamptz;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select h.* into v_h from hints h where h.id = p_hint;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select g.* into v_game from games g join questions q on q.game_id = g.id where q.id = v_h.question_id;
  v_eff := coalesce(v_game.paused_at, now());
  if exists(select 1 from team_hint_seen s join teams t on t.id = s.team_id
            where s.hint_id = p_hint and t.session_generation = v_game.session_generation)
     or exists(select 1 from team_hint_overrides o join teams t on t.id = o.team_id
            where o.hint_id = p_hint and t.session_generation = v_game.session_generation)
     or exists(select 1 from team_progress tp join teams t on t.id = tp.team_id
            where tp.question_id = v_h.question_id and t.session_generation = v_game.session_generation
              and ((tp.solved_at is null and v_eff >= tp.activated_at + make_interval(mins => v_h.reveal_after_min))
                   or (tp.solved_at is not null and tp.solved_at >= tp.activated_at + make_interval(mins => v_h.reveal_after_min))))
  then return jsonb_build_object('error','already_shown'); end if;
  update hints set
    reveal_after_min = coalesce(p_reveal_after_min, reveal_after_min),
    blocks = coalesce(p_blocks, blocks),
    text = coalesce(p_text, text)
    where id = p_hint;
  return jsonb_build_object('ok', true);
end $$;

-- ---- admin_monitor: laikmačiai užšąla pauzės metu --------------------------------------------
create or replace function admin_monitor(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_eff timestamptz;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  v_eff := coalesce(v_game.paused_at, now());
  return jsonb_build_object('server_now', now(), 'expires_at', v_game.expires_at, 'status', v_game.status,
    'game_starts_at', v_game.starts_at, 'paused_at', v_game.paused_at,
    'total_questions', (select count(*) from questions where game_id = p_game),
    'teams', coalesce((select jsonb_agg(row_to_json(b) order by b.name) from (
      select t.id, t.name, t.created_at, t.finished_at,
             t.starts_at, coalesce(t.starts_at, v_game.starts_at) as eff_start,
             (select count(*) from players p where p.team_id = t.id) as players,
             ap.stage_ord, ap.stage_title, ap.hints_revealed,
             extract(epoch from (v_eff - ap.activated_at))::int as seconds_on_stage,
             extract(epoch from (coalesce(t.finished_at, v_eff) - t.created_at))::int as total_seconds,
             coalesce((select jsonb_agg(jsonb_build_object(
                  'ord', q.ord, 'title', q.title,
                  'seconds', greatest(0, extract(epoch from (tp.solved_at - tp.activated_at))::int),
                  'hints', tp.hints_revealed) order by q.ord)
               from team_progress tp join questions q on q.id = tp.question_id
               where tp.team_id = t.id and tp.solved_at is not null), '[]'::jsonb) as splits,
             coalesce((select jsonb_agg(jsonb_build_object(
                  'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min,
                  'unlock_at', ap.activated_at + make_interval(mins => h.reveal_after_min),
                  'unlocked', (v_eff >= ap.activated_at + make_interval(mins => h.reveal_after_min)
                               or exists(select 1 from team_hint_overrides o where o.team_id = t.id and o.hint_id = h.id))
                ) order by h.ord)
               from hints h where h.question_id = ap.question_id), '[]'::jsonb) as stage_hints
      from teams t
      left join lateral (select q.id as question_id, q.ord as stage_ord, q.title as stage_title, tp.activated_at, tp.hints_revealed
        from team_progress tp join questions q on q.id = tp.question_id
        where tp.team_id = t.id and tp.solved_at is null order by q.ord limit 1) ap on true
      where t.game_id = p_game and t.session_generation = v_game.session_generation) b), '[]'::jsonb));
end $$;

-- ---- admin_save_game: end_scene nebenulinamas, kai payload'e lauko nėra ----------------------
create or replace function admin_save_game(p_code text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_id uuid; v_theme themes; v_tokens jsonb := '{}'::jsonb;
        q jsonb; h jsonb; v_qid uuid; v_ord int; v_hord int;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  v_id := nullif(p_payload->>'id','')::uuid;
  if p_payload->>'theme_id' is not null and p_payload->>'theme_id' <> '' then
    select * into v_theme from themes where id = (p_payload->>'theme_id')::uuid;
    if found then v_tokens := v_theme.tokens; end if;
  end if;
  if v_id is null then
    insert into games(pin, name, description, duration_min, max_teams, theme_id, theme, status, end_scene)
      values (gen_pin(), coalesce(p_payload->>'name','Untitled'), p_payload->>'description',
              coalesce((p_payload->>'duration_min')::int,240), coalesce((p_payload->>'max_teams')::int,20),
              nullif(p_payload->>'theme_id','')::uuid, v_tokens, 'draft', p_payload->'end_scene')
      returning * into v_game;
    v_id := v_game.id;
  else
    select * into v_game from games where id = v_id;
    if not found then return jsonb_build_object('error','not_found'); end if;
    if v_game.status = 'live' then return jsonb_build_object('error','game_live'); end if;
    update games set name = coalesce(p_payload->>'name', name), description = p_payload->>'description',
      duration_min = coalesce((p_payload->>'duration_min')::int, duration_min),
      max_teams = coalesce((p_payload->>'max_teams')::int, max_teams),
      theme_id = nullif(p_payload->>'theme_id','')::uuid, theme = v_tokens,
      end_scene = coalesce(p_payload->'end_scene', end_scene)
      where id = v_id;
    delete from questions where game_id = v_id;
  end if;
  v_ord := 0;
  for q in select value from jsonb_array_elements(coalesce(p_payload->'questions','[]'::jsonb)) loop
    v_ord := v_ord + 1;
    insert into questions(game_id, ord, title, intro, info, prep, case_sensitive, location_name, lat, lng, blocks)
      values (v_id, v_ord, coalesce(q->>'title','Question '||v_ord), q->>'intro', q->>'info', q->>'prep',
              coalesce((q->>'case_sensitive')::boolean, false),
              q->>'location_name', nullif(q->>'lat','')::float8, nullif(q->>'lng','')::float8,
              coalesce(q->'blocks','[]'::jsonb))
      returning id into v_qid;
    insert into question_secrets(question_id, answer, alt_answers)
      values (v_qid, coalesce(q->>'answer',''),
              coalesce((select array_agg(value) from jsonb_array_elements_text(q->'alt_answers')), '{}'));
    v_hord := 0;
    for h in select value from jsonb_array_elements(coalesce(q->'hints','[]'::jsonb)) loop
      v_hord := v_hord + 1;
      insert into hints(question_id, ord, reveal_after_min, text, media_type, media_url, blocks)
        values (v_qid, v_hord, coalesce((h->>'reveal_after_min')::int,0),
                h->>'text', nullif(h->>'media_type',''), nullif(h->>'media_url',''),
                coalesce(h->'blocks','[]'::jsonb));
    end loop;
  end loop;
  select * into v_game from games where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_game.id, 'pin', v_game.pin);
end $$;
