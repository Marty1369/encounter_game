-- 0006_player_rpc.sql — player-facing RPCs (anon). Game-scoped, PIN-based join.
-- Security: answers via question_secrets only; hint text/media gated in SQL; idempotent
-- submit; session_generation invalidation; players share their team's progress.

-- resolve a player session -> player, team, game (null if stale generation / not found)
create or replace function _resolve_player(p_session uuid,
  out v_player players, out v_team teams, out v_game games)
language plpgsql security definer set search_path = public, extensions as $$
begin
  select * into v_player from players where session_token = p_session;
  if found then
    select * into v_team from teams where id = v_player.team_id;
    select * into v_game from games where id = v_team.game_id;
    if v_team.session_generation <> v_game.session_generation then
      v_player := null; v_team := null; v_game := null;
    end if;
  end if;
end $$;

-- full team state (active stage, gated hints, timing)
create or replace function _state_json(p_team teams, p_game games) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_q questions; v_prog team_progress; v_hints jsonb; v_total int; v_expired boolean;
begin
  v_expired := (p_game.expires_at is not null and now() >= p_game.expires_at);
  select count(*) into v_total from questions where game_id = p_game.id;

  if p_team.finished_at is not null then
    return jsonb_build_object('finished', true, 'team', jsonb_build_object('name', p_team.name),
      'finished_at', p_team.finished_at,
      'total_seconds', extract(epoch from (p_team.finished_at - p_team.created_at))::int,
      'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
  end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team.id and tp.solved_at is null order by q.ord limit 1;
  select * into v_q from questions where id = v_prog.question_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min,
      'unlocked', (now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)),
      'text', case when now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min) then h.text else null end,
      'media_type', case when now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min) then h.media_type else null end,
      'media_url', case when now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min) then h.media_url else null end
    ) order by h.ord), '[]'::jsonb)
  into v_hints from hints h where h.question_id = v_q.id;

  return jsonb_build_object('finished', false, 'team', jsonb_build_object('name', p_team.name),
    'question', jsonb_build_object('ord', v_q.ord, 'title', v_q.title, 'intro', v_q.intro,
      'location_name', v_q.location_name, 'lat', v_q.lat, 'lng', v_q.lng, 'blocks', v_q.blocks),
    'activated_at', v_prog.activated_at, 'hints_revealed', v_prog.hints_revealed, 'hints', v_hints,
    'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
    'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
end $$;

-- lobby: game meta + team list for a PIN
create or replace function get_game_by_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object(
    'name', v_game.name, 'description', v_game.description, 'status', v_game.status,
    'theme', v_game.theme, 'max_teams', v_game.max_teams,
    'expired', (v_game.expires_at is not null and now() >= v_game.expires_at),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name,
        'players', (select count(*) from players p where p.team_id = t.id)) order by t.name)
      from teams t where t.game_id = v_game.id and t.session_generation = v_game.session_generation), '[]'::jsonb)
  );
end $$;

-- join: pick/create a team, add player, return session
create or replace function join_game(p_pin text, p_team text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_team teams; v_player players; v_q1 questions; v_tn text; v_pn text; v_count int;
begin
  v_tn := btrim(coalesce(p_team, '')); v_pn := btrim(coalesce(p_name, ''));
  if length(v_tn) = 0 or length(v_tn) > 40 then return jsonb_build_object('error','bad_team'); end if;
  if length(v_pn) = 0 or length(v_pn) > 40 then return jsonb_build_object('error','bad_name'); end if;

  select * into v_game from games where upper(pin) = upper(btrim(p_pin)) for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_game.status <> 'live' then return jsonb_build_object('error','not_live'); end if;
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
      if v_q1.id is not null then insert into team_progress(team_id, question_id) values (v_team.id, v_q1.id) on conflict do nothing; end if;
    end if;
  end if;

  insert into players(team_id, name) values (v_team.id, v_pn) returning * into v_player;
  return jsonb_build_object('session_token', v_player.session_token, 'state', _state_json(v_team, v_game));
end $$;

create or replace function get_state(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_team teams; v_game games;
begin
  select * into r from _resolve_player(p_session);
  v_team := r.v_team; v_game := r.v_game;
  if v_team.id is null then return jsonb_build_object('error','bad_session'); end if;
  return _state_json(v_team, v_game);
end $$;

create or replace function submit_answer(p_session uuid, p_input text, p_mutation_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_player players; v_team teams; v_game games; v_q questions; v_prog team_progress;
        v_ok boolean; v_prior jsonb; v_result jsonb; v_next questions;
begin
  if p_mutation_id is null then return jsonb_build_object('error','no_mutation_id'); end if;
  select result into v_prior from submit_idempotency where mutation_id = p_mutation_id;
  if v_prior is not null then return v_prior; end if;

  select * into r from _resolve_player(p_session);
  v_player := r.v_player; v_team := r.v_team; v_game := r.v_game;
  if v_team.id is null then return jsonb_build_object('error','bad_session'); end if;
  if v_team.finished_at is not null then return jsonb_build_object('error','finished'); end if;
  if v_game.expires_at is not null and now() >= v_game.expires_at then return jsonb_build_object('error','expired'); end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = v_team.id and tp.solved_at is null order by q.ord limit 1 for update of tp;
  if not found then return jsonb_build_object('error','no_active'); end if;
  select * into v_q from questions where id = v_prog.question_id;

  select (normalize_answer(p_input) = normalize_answer(qs.answer)
       or normalize_answer(p_input) = any (select normalize_answer(a) from unnest(qs.alt_answers) a))
    into v_ok from question_secrets qs where qs.question_id = v_q.id;
  v_ok := coalesce(v_ok, false);

  insert into answer_attempts(team_id, question_id, player_id, raw_input, is_correct)
    values (v_team.id, v_q.id, v_player.id, left(coalesce(p_input,''), 200), v_ok);

  if not v_ok then
    v_result := jsonb_build_object('correct', false);
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
  insert into submit_idempotency(mutation_id, team_id, result) values (p_mutation_id, v_team.id, v_result)
    on conflict (mutation_id) do nothing;
  return v_result;
end $$;

create or replace function mark_hint_revealed(p_session uuid, p_hint_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_team teams; v_prog team_progress; v_h hints;
begin
  select * into r from _resolve_player(p_session);
  v_team := r.v_team;
  if v_team.id is null then return jsonb_build_object('error','bad_session'); end if;
  select * into v_h from hints where id = p_hint_id;
  if not found then return jsonb_build_object('error','bad_hint'); end if;
  select tp.* into v_prog from team_progress tp
    where tp.team_id = v_team.id and tp.question_id = v_h.question_id and tp.solved_at is null;
  if not found then return jsonb_build_object('error','not_active'); end if;
  if now() < v_prog.activated_at + make_interval(mins => v_h.reveal_after_min) then return jsonb_build_object('error','locked'); end if;
  update team_progress set hints_revealed = greatest(hints_revealed, v_h.ord) where id = v_prog.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function leaderboard(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error','not_found'); end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.total_seconds)
    from (select t.name,
                 extract(epoch from (t.finished_at - t.created_at))::int as total_seconds,
                 (select coalesce(sum(hints_revealed),0) from team_progress tp where tp.team_id = t.id) as hints
          from teams t
          where t.game_id = v_game.id and t.session_generation = v_game.session_generation and t.finished_at is not null
    ) x), '[]'::jsonb);
end $$;

revoke all on function _resolve_player(uuid) from public, anon, authenticated;
revoke all on function _state_json(teams, games) from public, anon, authenticated;
grant execute on function
  get_game_by_pin(text), join_game(text,text,text), get_state(uuid),
  submit_answer(uuid,text,uuid), mark_hint_revealed(uuid,uuid), leaderboard(text)
to anon;