-- 0010_lifecycle.sql — full game lifecycle (activate/start/pause/resume/stop) + duplicate/rename.
-- Phases via (status, starts_at, paused_at):
--   draft: status='draft'
--   activated (registration, lobby): status='live', starts_at null (or future), not started
--   running: status='live', starts_at<=now, paused_at null
--   paused: status='live', paused_at not null (timers freeze at paused_at)
--   ended: status='ended'

alter table games add column if not exists paused_at timestamptz;
alter table games add column if not exists pause_message text;

-- ---- lobby meta ----
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
    'starts_at', v_game.starts_at, 'registration_open', v_game.registration_open, 'server_now', now(),
    'started', v_started, 'paused', (v_game.paused_at is not null),
    'expired', (v_game.expires_at is not null and now() >= v_game.expires_at),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name,
        'players', (select count(*) from players p where p.team_id = t.id)) order by t.name)
      from teams t where t.game_id = v_game.id and t.session_generation = v_game.session_generation), '[]'::jsonb)
  );
end $$;

create or replace function join_game(p_pin text, p_team text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_team teams; v_player players; v_q1 questions; v_tn text; v_pn text; v_count int; v_act timestamptz;
begin
  v_tn := btrim(coalesce(p_team, '')); v_pn := btrim(coalesce(p_name, ''));
  if length(v_tn) = 0 or length(v_tn) > 40 then return jsonb_build_object('error','bad_team'); end if;
  if length(v_pn) = 0 or length(v_pn) > 40 then return jsonb_build_object('error','bad_name'); end if;
  select * into v_game from games where upper(pin) = upper(btrim(p_pin)) for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_game.status <> 'live' then return jsonb_build_object('error','not_live'); end if;
  if not v_game.registration_open then return jsonb_build_object('error','registration_closed'); end if;
  if v_game.expires_at is not null and now() >= v_game.expires_at then return jsonb_build_object('error','expired'); end if;
  select * into v_team from teams where game_id = v_game.id and lower(name) = lower(v_tn);
  if not found then
    select count(*) into v_count from teams where game_id = v_game.id and session_generation = v_game.session_generation;
    if v_count >= v_game.max_teams then return jsonb_build_object('error','full'); end if;
    insert into teams(game_id, name, session_generation) values (v_game.id, v_tn, v_game.session_generation)
      on conflict (game_id, name) do nothing returning * into v_team;
    if v_team.id is null then select * into v_team from teams where game_id = v_game.id and lower(name) = lower(v_tn); end if;
    if not exists (select 1 from team_progress where team_id = v_team.id) then
      select * into v_q1 from questions where game_id = v_game.id order by ord limit 1;
      v_act := greatest(coalesce(v_game.starts_at, now()), now());
      if v_q1.id is not null then insert into team_progress(team_id, question_id, activated_at) values (v_team.id, v_q1.id, v_act) on conflict do nothing; end if;
    end if;
  end if;
  insert into players(team_id, name) values (v_team.id, v_pn) returning * into v_player;
  return jsonb_build_object('session_token', v_player.session_token, 'state', _state_json(v_team, v_game));
end $$;

-- ---- state: started / paused / countdown ----
create or replace function _state_json(p_team teams, p_game games) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_q questions; v_prog team_progress; v_hints jsonb; v_total int; v_expired boolean; v_started boolean; v_paused boolean; v_eff timestamptz;
begin
  v_expired := (p_game.expires_at is not null and now() >= p_game.expires_at);
  v_started := (p_game.starts_at is not null and now() >= p_game.starts_at);
  v_paused  := (p_game.paused_at is not null);
  v_eff     := coalesce(p_game.paused_at, now());   -- freeze timers while paused
  select count(*) into v_total from questions where game_id = p_game.id;

  if p_team.finished_at is not null then
    return jsonb_build_object('finished', true, 'started', true, 'paused', false, 'team', jsonb_build_object('name', p_team.name),
      'finished_at', p_team.finished_at, 'total_seconds', greatest(0, extract(epoch from (p_team.finished_at - p_team.created_at))::int - coalesce(p_team.time_credit_seconds,0)),
      'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
  end if;

  if not v_started then
    return jsonb_build_object('finished', false, 'started', false, 'paused', false, 'team', jsonb_build_object('name', p_team.name),
      'starts_at', p_game.starts_at, 'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
  end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team.id and tp.solved_at is null order by q.ord limit 1;
  select * into v_q from questions where id = v_prog.question_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min, 'unlocked', u.unlocked,
      'text', case when u.unlocked then h.text else null end,
      'media_type', case when u.unlocked then h.media_type else null end,
      'media_url', case when u.unlocked then h.media_url else null end
    ) order by h.ord), '[]'::jsonb)
  into v_hints from hints h
  cross join lateral (select (v_eff >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)
      or exists(select 1 from team_hint_overrides o where o.team_id = p_team.id and o.hint_id = h.id)) as unlocked) u
  where h.question_id = v_q.id;

  return jsonb_build_object('finished', false, 'started', true, 'paused', v_paused, 'pause_message', p_game.pause_message,
    'team', jsonb_build_object('name', p_team.name),
    'question', jsonb_build_object('ord', v_q.ord, 'title', v_q.title, 'intro', v_q.intro, 'info', v_q.info,
      'location_name', v_q.location_name, 'lat', v_q.lat, 'lng', v_q.lng, 'blocks', v_q.blocks),
    'activated_at', v_prog.activated_at, 'hints_revealed', v_prog.hints_revealed, 'hints', v_hints,
    'server_now', v_eff, 'expires_at', p_game.expires_at, 'expired', v_expired,
    'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
end $$;

create or replace function submit_answer(p_session uuid, p_input text, p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_player players; v_team teams; v_game games; v_q questions; v_prog team_progress;
        v_ok boolean; v_prior jsonb; v_result jsonb; v_next questions; v_ans text; v_alt text[]; v_cs boolean;
begin
  if p_mutation_id is null then return jsonb_build_object('error','no_mutation_id'); end if;
  select result into v_prior from submit_idempotency where mutation_id = p_mutation_id;
  if v_prior is not null then return v_prior; end if;
  select * into r from _resolve_player(p_session);
  v_player := r.v_player; v_team := r.v_team; v_game := r.v_game;
  if v_team.id is null then return jsonb_build_object('error','bad_session'); end if;
  if v_team.finished_at is not null then return jsonb_build_object('error','finished'); end if;
  if v_game.starts_at is null or now() < v_game.starts_at then return jsonb_build_object('error','not_started'); end if;
  if v_game.paused_at is not null then return jsonb_build_object('error','paused'); end if;
  if v_game.status = 'ended' or (v_game.expires_at is not null and now() >= v_game.expires_at) then return jsonb_build_object('error','expired'); end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = v_team.id and tp.solved_at is null order by q.ord limit 1 for update of tp;
  if not found then return jsonb_build_object('error','no_active'); end if;
  select * into v_q from questions where id = v_prog.question_id;
  select answer, alt_answers into v_ans, v_alt from question_secrets where question_id = v_q.id;
  v_cs := coalesce(v_q.case_sensitive, false);
  if v_cs then
    v_ok := normalize_cs(p_input) = normalize_cs(v_ans) or normalize_cs(p_input) = any (select normalize_cs(x) from unnest(v_alt) x);
  else
    v_ok := normalize_answer(p_input) = normalize_answer(v_ans) or normalize_answer(p_input) = any (select normalize_answer(x) from unnest(v_alt) x);
  end if;
  v_ok := coalesce(v_ok, false);
  insert into answer_attempts(team_id, question_id, player_id, raw_input, is_correct)
    values (v_team.id, v_q.id, v_player.id, left(coalesce(p_input,''), 200), v_ok);
  if not v_ok then v_result := jsonb_build_object('correct', false);
  else
    update team_progress set solved_at = now() where id = v_prog.id and solved_at is null;
    select * into v_next from questions where game_id = v_q.game_id and ord = v_q.ord + 1;
    if found then
      insert into team_progress(team_id, question_id) values (v_team.id, v_next.id) on conflict (team_id, question_id) do nothing;
      v_result := jsonb_build_object('correct', true, 'next_ord', v_next.ord, 'finished', false);
    else
      update teams set finished_at = now() where id = v_team.id and finished_at is null;
      v_result := jsonb_build_object('correct', true, 'finished', true);
    end if;
  end if;
  insert into submit_idempotency(mutation_id, team_id, result) values (p_mutation_id, v_team.id, v_result) on conflict (mutation_id) do nothing;
  return v_result;
end $$;

-- ---- lifecycle RPCs ----
create or replace function admin_activate(p_code text, p_game uuid) returns jsonb  -- Confirm & Activate: open registration
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set status='live', registration_open=true, paused_at=null where id=p_game returning * into v_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'status', v_game.status);
end $$;

create or replace function admin_start_now(p_code text, p_game uuid) returns jsonb  -- START GAME (override timer)
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  update team_progress tp set activated_at = now()
    from teams t where t.id = tp.team_id and t.game_id = p_game and tp.solved_at is null;
  update games set status='live', starts_at = now(), paused_at=null,
    expires_at = now() + make_interval(mins => duration_min)
    where id = p_game returning * into v_game;
  return jsonb_build_object('ok', true, 'starts_at', v_game.starts_at, 'expires_at', v_game.expires_at);
end $$;

create or replace function admin_pause(p_code text, p_game uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set paused_at = coalesce(paused_at, now()), pause_message = coalesce(nullif(p_message,''),'The game is paused.')
    where id = p_game returning * into v_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'paused_at', v_game.paused_at);
end $$;

create or replace function admin_resume(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_delta interval;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_game.paused_at is null then return jsonb_build_object('ok', true); end if;
  v_delta := now() - v_game.paused_at;
  -- shift everything forward by the pause duration so timers resume where they froze
  update team_progress tp set activated_at = tp.activated_at + v_delta
    from teams t where t.id = tp.team_id and t.game_id = p_game and tp.solved_at is null;
  update games set expires_at = expires_at + v_delta, paused_at = null, pause_message = null
    where id = p_game returning * into v_game;
  return jsonb_build_object('ok', true, 'expires_at', v_game.expires_at);
end $$;

create or replace function admin_stop(p_code text, p_game uuid) returns jsonb  -- Stop: freeze leaderboard, ended is permanent
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set status='ended', paused_at=null, registration_open=false where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'status', 'ended');
end $$;

create or replace function admin_rename(p_code text, p_game uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  if length(btrim(coalesce(p_name,'')))=0 then return jsonb_build_object('error','bad_name'); end if;
  update games set name = btrim(p_name) where id = p_game;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_duplicate(p_code text, p_game uuid) returns jsonb  -- deep copy -> new draft
language plpgsql security definer set search_path = public, extensions as $$
declare v_src games; v_new uuid; v_qid uuid; qr record;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_src from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  insert into games(pin, name, description, status, theme_id, theme, duration_min, max_teams)
    values (gen_pin(), v_src.name || ' (copy)', v_src.description, 'draft', v_src.theme_id, v_src.theme, v_src.duration_min, v_src.max_teams)
    returning id into v_new;
  for qr in select * from questions where game_id = p_game order by ord loop
    insert into questions(game_id, ord, title, intro, info, case_sensitive, location_name, lat, lng, blocks)
      values (v_new, qr.ord, qr.title, qr.intro, qr.info, qr.case_sensitive, qr.location_name, qr.lat, qr.lng, qr.blocks)
      returning id into v_qid;
    insert into question_secrets(question_id, answer, alt_answers)
      select v_qid, answer, alt_answers from question_secrets where question_id = qr.id;
    insert into hints(question_id, ord, reveal_after_min, text, media_type, media_url)
      select v_qid, ord, reveal_after_min, text, media_type, media_url from hints where question_id = qr.id;
  end loop;
  return jsonb_build_object('ok', true, 'id', v_new);
end $$;

grant execute on function
  admin_activate(text,uuid), admin_pause(text,uuid,text), admin_resume(text,uuid),
  admin_stop(text,uuid), admin_rename(text,uuid,text), admin_duplicate(text,uuid)
to anon;
