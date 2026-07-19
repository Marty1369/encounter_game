-- 0028_hint_tools_and_end_scene.sql — admino hintų valdymas + pabaigos scena + info laukimo ekranui.
-- 1) games.end_scene jsonb: {"blocks":[...], "show_leaderboard": bool} — ką žaidėjai mato pasibaigus.
-- 2) admin_roster: kiekvienai komandai dabartinė užduotis + kito hinto laikas (countdown Games meniu).
-- 3) admin_monitor: kiekvienai komandai pilnas dabartinės užduoties hintų grafikas (Live monitor).
-- 4) admin_update_hint: keisti dar NIEKAM nerodyto hinto laiką/turinį (veikia ir live žaidime).
-- 5) admin_set_end_scene: keisti pabaigos sceną bet kada (ir live, ir ended).
-- 6) _state_json / get_game_by_pin / admin_get_game / admin_save_game / admin_duplicate — end_scene
--    ir game_description pernešami iki žaidėjo.

alter table games add column if not exists end_scene jsonb;

-- ---- admin_roster: + stage, + kitas hintas -------------------------------------------------
-- next_hint_at skaičiuojamas nuo activated_at; pauzės metu klientas countdown'ą užšaldo pagal paused_at.
create or replace function admin_roster(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('server_now', now(), 'game_starts_at', v_game.starts_at, 'paused_at', v_game.paused_at,
    'team_count', (select count(*) from teams t where t.game_id = p_game and t.session_generation = v_game.session_generation),
    'player_count', (select count(*) from players p join teams t on t.id=p.team_id where t.game_id = p_game and t.session_generation = v_game.session_generation),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
        'starts_at', t.starts_at, 'eff_start', coalesce(t.starts_at, v_game.starts_at),
        'finished_at', t.finished_at,
        'stage_ord', ap.stage_ord, 'stage_title', ap.stage_title,
        'hints_total', ap.hints_total, 'hints_shown', ap.hints_shown,
        'next_hint_ord', ap.next_hint_ord, 'next_hint_at', ap.next_hint_at,
        'players', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name) order by pl.created_at)
                             from players pl where pl.team_id = t.id), '[]'::jsonb)
      ) order by t.created_at)
      from teams t
      left join lateral (
        select q.ord as stage_ord, q.title as stage_title,
          (select count(*) from hints h where h.question_id = q.id) as hints_total,
          (select count(*) from hints h where h.question_id = q.id
             and (coalesce(v_game.paused_at, now()) >= tp.activated_at + make_interval(mins => h.reveal_after_min)
                  or exists(select 1 from team_hint_overrides o where o.team_id = t.id and o.hint_id = h.id))) as hints_shown,
          nh.ord as next_hint_ord, tp.activated_at + make_interval(mins => nh.reveal_after_min) as next_hint_at
        from team_progress tp join questions q on q.id = tp.question_id
        left join lateral (select h.ord, h.reveal_after_min from hints h
            where h.question_id = q.id
              and coalesce(v_game.paused_at, now()) < tp.activated_at + make_interval(mins => h.reveal_after_min)
              and not exists(select 1 from team_hint_overrides o where o.team_id = t.id and o.hint_id = h.id)
            order by tp.activated_at + make_interval(mins => h.reveal_after_min) limit 1) nh on true
        where tp.team_id = t.id and tp.solved_at is null order by q.ord limit 1) ap on true
      where t.game_id = p_game and t.session_generation = v_game.session_generation), '[]'::jsonb));
end $$;

-- ---- admin_monitor: + pilnas dabartinės užduoties hintų grafikas ---------------------------
create or replace function admin_monitor(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('server_now', now(), 'expires_at', v_game.expires_at, 'status', v_game.status,
    'game_starts_at', v_game.starts_at, 'paused_at', v_game.paused_at,
    'total_questions', (select count(*) from questions where game_id = p_game),
    'teams', coalesce((select jsonb_agg(row_to_json(b) order by b.name) from (
      select t.id, t.name, t.created_at, t.finished_at,
             t.starts_at, coalesce(t.starts_at, v_game.starts_at) as eff_start,
             (select count(*) from players p where p.team_id = t.id) as players,
             ap.stage_ord, ap.stage_title, ap.hints_revealed,
             extract(epoch from (now() - ap.activated_at))::int as seconds_on_stage,
             extract(epoch from (coalesce(t.finished_at, now()) - t.created_at))::int as total_seconds,
             coalesce((select jsonb_agg(jsonb_build_object(
                  'ord', q.ord, 'title', q.title,
                  'seconds', greatest(0, extract(epoch from (tp.solved_at - tp.activated_at))::int),
                  'hints', tp.hints_revealed) order by q.ord)
               from team_progress tp join questions q on q.id = tp.question_id
               where tp.team_id = t.id and tp.solved_at is not null), '[]'::jsonb) as splits,
             coalesce((select jsonb_agg(jsonb_build_object(
                  'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min,
                  'unlock_at', ap.activated_at + make_interval(mins => h.reveal_after_min),
                  'unlocked', (coalesce(v_game.paused_at, now()) >= ap.activated_at + make_interval(mins => h.reveal_after_min)
                               or exists(select 1 from team_hint_overrides o where o.team_id = t.id and o.hint_id = h.id))
                ) order by h.ord)
               from hints h where h.question_id = ap.question_id), '[]'::jsonb) as stage_hints
      from teams t
      left join lateral (select q.id as question_id, q.ord as stage_ord, q.title as stage_title, tp.activated_at, tp.hints_revealed
        from team_progress tp join questions q on q.id = tp.question_id
        where tp.team_id = t.id and tp.solved_at is null order by q.ord limit 1) ap on true
      where t.game_id = p_game and t.session_generation = v_game.session_generation) b), '[]'::jsonb));
end $$;

-- ---- admin_update_hint: redaguoti tik dar niekam nerodytą hintą ----------------------------
-- „Rodytas" = bent viena dabartinės kartos komanda jį atrakino: per override, pagal laiką
-- dabartinėje užduotyje, arba klausimą jau išsprendė praleidusi >= reveal laiko.
create or replace function admin_update_hint(p_code text, p_hint uuid, p_reveal_after_min int, p_blocks jsonb, p_text text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_h hints; v_game games; v_eff timestamptz;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select h.* into v_h from hints h where h.id = p_hint;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select g.* into v_game from games g join questions q on q.game_id = g.id where q.id = v_h.question_id;
  v_eff := coalesce(v_game.paused_at, now());
  if exists(select 1 from team_hint_overrides o join teams t on t.id = o.team_id
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

-- ---- admin_set_end_scene: veikia bet kokiam statusui (ir live, ir ended) -------------------
create or replace function admin_set_end_scene(p_code text, p_game uuid, p_scene jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set end_scene = p_scene where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---- _state_json: + game_description, + end_scene ------------------------------------------
create or replace function _state_json(p_team teams, p_game games) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_q questions; v_prog team_progress; v_hints jsonb; v_total int; v_expired boolean; v_started boolean; v_paused boolean; v_eff timestamptz; v_tstart timestamptz;
begin
  v_expired := (p_game.expires_at is not null and now() >= p_game.expires_at);
  v_tstart  := coalesce(p_team.starts_at, p_game.starts_at);        -- this team's start
  v_started := (v_tstart is not null and now() >= v_tstart);
  v_paused  := (p_game.paused_at is not null);
  v_eff     := coalesce(p_game.paused_at, now());
  select count(*) into v_total from questions where game_id = p_game.id;
  if p_team.finished_at is not null then
    return jsonb_build_object('finished', true, 'started', true, 'paused', false,
      'team', jsonb_build_object('name', p_team.name, 'code', _team_code(p_team.id)),
      'finished_at', p_team.finished_at, 'total_seconds', greatest(0, extract(epoch from (p_team.finished_at - p_team.created_at))::int - coalesce(p_team.time_credit_seconds,0)),
      'server_now', now(), 'starts_at', v_tstart, 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name,
      'game_description', p_game.description, 'game_status', p_game.status, 'end_scene', p_game.end_scene);
  end if;
  if not v_started then
    return jsonb_build_object('finished', false, 'started', false, 'paused', false,
      'team', jsonb_build_object('name', p_team.name, 'code', _team_code(p_team.id)),
      'starts_at', v_tstart, 'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name,
      'game_description', p_game.description, 'game_status', p_game.status);
  end if;
  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team.id and tp.solved_at is null order by q.ord limit 1;
  select * into v_q from questions where id = v_prog.question_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min, 'unlocked', u.unlocked,
      'text', case when u.unlocked then h.text else null end,
      'media_type', case when u.unlocked then h.media_type else null end,
      'media_url', case when u.unlocked then h.media_url else null end,
      'blocks', case when u.unlocked then h.blocks else '[]'::jsonb end
    ) order by h.ord), '[]'::jsonb)
  into v_hints from hints h
  cross join lateral (select (v_eff >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)
      or exists(select 1 from team_hint_overrides o where o.team_id = p_team.id and o.hint_id = h.id)) as unlocked) u
  where h.question_id = v_q.id;
  return jsonb_build_object('finished', false, 'started', true, 'paused', v_paused, 'pause_message', p_game.pause_message,
    'team', jsonb_build_object('name', p_team.name, 'code', _team_code(p_team.id)),
    'question', jsonb_build_object('ord', v_q.ord, 'title', v_q.title, 'intro', v_q.intro, 'info', v_q.info,
      'location_name', v_q.location_name, 'lat', v_q.lat, 'lng', v_q.lng, 'blocks', v_q.blocks),
    'activated_at', v_prog.activated_at, 'hints_revealed', v_prog.hints_revealed, 'hints', v_hints,
    'started_at', v_tstart, 'starts_at', v_tstart,
    'server_now', v_eff, 'expires_at', p_game.expires_at, 'expired', v_expired,
    'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name,
    'game_description', p_game.description, 'game_status', p_game.status, 'end_scene', p_game.end_scene);
end $$;

-- ---- get_game_by_pin: + question_count (join ekranui / laukimo info) -----------------------
create or replace function get_game_by_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_started boolean;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_started := (v_game.starts_at is not null and now() >= v_game.starts_at);
  return jsonb_build_object(
    'name', v_game.name, 'description', v_game.description, 'status', v_game.status,
    'theme', v_game.theme, 'max_teams', v_game.max_teams,
    'question_count', (select count(*) from questions q where q.game_id = v_game.id),
    'starts_at', v_game.starts_at, 'registration_open', v_game.registration_open, 'server_now', now(),
    'started', v_started, 'paused', (v_game.paused_at is not null),
    'expired', (v_game.expires_at is not null and now() >= v_game.expires_at),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name,
        'code', left(replace(t.id::text,'-',''), 6),
        'players', (select count(*) from players p where p.team_id = t.id)) order by t.name)
      from teams t where t.game_id = v_game.id and t.session_generation = v_game.session_generation), '[]'::jsonb)
  );
end $$;

-- ---- admin_get_game: + end_scene, + hintų id (live redagavimui reikia tikro id) ------------
create or replace function admin_get_game(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object(
    'id', v_game.id, 'pin', v_game.pin, 'name', v_game.name, 'description', v_game.description,
    'status', v_game.status, 'duration_min', v_game.duration_min, 'max_teams', v_game.max_teams, 'theme_id', v_game.theme_id,
    'starts_at', v_game.starts_at, 'registration_open', v_game.registration_open,
    'paused_at', v_game.paused_at, 'pause_message', v_game.pause_message,
    'end_scene', v_game.end_scene,
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'ord', q.ord, 'title', q.title, 'intro', q.intro, 'info', q.info, 'prep', q.prep,
        'case_sensitive', q.case_sensitive,
        'location_name', q.location_name, 'lat', q.lat, 'lng', q.lng, 'blocks', q.blocks,
        'answer', (select answer from question_secrets s where s.question_id = q.id),
        'alt_answers', (select alt_answers from question_secrets s where s.question_id = q.id),
        'hints', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min,
            'text', h.text, 'media_type', h.media_type, 'media_url', h.media_url, 'blocks', h.blocks) order by h.ord)
          from hints h where h.question_id = q.id), '[]'::jsonb)
      ) order by q.ord) from questions q where q.game_id = v_game.id), '[]'::jsonb));
end $$;

-- ---- admin_save_game: + end_scene ----------------------------------------------------------
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
      end_scene = p_payload->'end_scene'
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

-- ---- admin_duplicate: + end_scene ----------------------------------------------------------
create or replace function admin_duplicate(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_src games; v_new uuid; v_qid uuid; qr record;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_src from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  insert into games(pin, name, description, status, theme_id, theme, duration_min, max_teams, end_scene)
    values (gen_pin(), v_src.name || ' (copy)', v_src.description, 'draft', v_src.theme_id, v_src.theme, v_src.duration_min, v_src.max_teams, v_src.end_scene)
    returning id into v_new;
  for qr in select * from questions where game_id = p_game order by ord loop
    insert into questions(game_id, ord, title, intro, info, prep, case_sensitive, location_name, lat, lng, blocks)
      values (v_new, qr.ord, qr.title, qr.intro, qr.info, qr.prep, qr.case_sensitive, qr.location_name, qr.lat, qr.lng, qr.blocks)
      returning id into v_qid;
    insert into question_secrets(question_id, answer, alt_answers)
      select v_qid, answer, alt_answers from question_secrets where question_id = qr.id;
    insert into hints(question_id, ord, reveal_after_min, text, media_type, media_url, blocks)
      select v_qid, ord, reveal_after_min, text, media_type, media_url, blocks from hints where question_id = qr.id;
  end loop;
  return jsonb_build_object('ok', true, 'id', v_new);
end $$;

grant execute on function
  admin_update_hint(text,uuid,int,jsonb,text), admin_set_end_scene(text,uuid,jsonb)
to anon;
