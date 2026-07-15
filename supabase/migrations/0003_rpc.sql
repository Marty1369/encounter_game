-- 0003_rpc.sql — all game logic as SECURITY DEFINER RPCs (anon calls only these).
-- Hardening applied: idempotent submits (mutation_id), FOR UPDATE locking + solved_at
-- guard, SQL-side hint gating (locked content never serialized), session_generation
-- token invalidation, admin gated by a hashed passcode (never in the repo).

create extension if not exists pgcrypto;

-- Private config (admin passcode hash). RLS on, no policy, grants revoked => unreachable by clients.
create table app_config (key text primary key, value text not null);
alter table app_config enable row level security;
revoke all on app_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- normalize: lowercase, strip LT diacritics, drop spaces/hyphens, strip fa_ prefix
create or replace function normalize_answer(s text) returns text
language sql immutable as $$
  select regexp_replace(
    regexp_replace(
      translate(lower(btrim(s)), 'ąčęėįšųūž', 'aceeisuuz'),
      '[\s\-]', '', 'g'),
    '^fa_?', '')
$$;

-- ---------------------------------------------------------------------------
-- Internal: resolve a valid session -> team + game. Raises nothing; returns nulls if bad.
create or replace function _resolve_session(p_session uuid,
  out v_team teams, out v_game games)
language plpgsql security definer as $$
begin
  select * into v_team from teams where session_token = p_session;
  if found then
    select * into v_game from games where id = v_team.game_id;
    -- stale generation (after new-game/reset) => treat as invalid
    if v_team.session_generation <> v_game.session_generation then
      v_team := null; v_game := null;
    end if;
  end if;
end $$;

-- Internal: build the full state jsonb for a team (active stage, hints, timing).
create or replace function _state_json(p_team teams, p_game games) returns jsonb
language plpgsql security definer as $$
declare v_q questions; v_prog team_progress; v_hints jsonb; v_total int; v_expired boolean;
begin
  v_expired := (p_game.expires_at is not null and now() >= p_game.expires_at);
  select count(*) into v_total from questions where game_id = p_game.id;

  if p_team.finished_at is not null then
    return jsonb_build_object(
      'finished', true,
      'team', jsonb_build_object('name', p_team.name),
      'finished_at', p_team.finished_at,
      'total_seconds', extract(epoch from (p_team.finished_at - p_team.created_at))::int,
      'server_now', now(),
      'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total
    );
  end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team.id and tp.solved_at is null order by q.ord limit 1;
  select * into v_q from questions where id = v_prog.question_id;

  -- Hints: content ONLY when its time gate has opened (projected in SQL, never after).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'ord', h.ord,
      'reveal_after_min', h.reveal_after_min, 'type', h.type,
      'unlocked', (now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)),
      'content', case when now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)
                      then h.content else null end
    ) order by h.ord), '[]'::jsonb)
  into v_hints from hints h where h.question_id = v_q.id;

  return jsonb_build_object(
    'finished', false,
    'team', jsonb_build_object('name', p_team.name),
    'question', jsonb_build_object(
      'code', v_q.code, 'ord', v_q.ord, 'title', v_q.title, 'intro', v_q.intro,
      'location_name', v_q.location_name, 'lat', v_q.lat, 'lng', v_q.lng, 'blocks', v_q.blocks),
    'activated_at', v_prog.activated_at,
    'hints_revealed', v_prog.hints_revealed,
    'hints', v_hints,
    'server_now', now(),
    'expires_at', p_game.expires_at, 'expired', v_expired,
    'total_questions', v_total
  );
end $$;

-- ---------------------------------------------------------------------------
-- register_team: create team (stamped with current generation), activate U1.
create or replace function register_team(p_name text) returns jsonb
language plpgsql security definer as $$
declare v_game games; v_team teams; v_q1 questions; v_count int; v_name text;
begin
  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) = 0 or length(v_name) > 40 then
    return jsonb_build_object('error', 'bad_name');
  end if;

  select * into v_game from games order by created_at limit 1 for update;
  if not found then return jsonb_build_object('error', 'no_game'); end if;
  if v_game.expires_at is null then return jsonb_build_object('error', 'not_started'); end if;
  if now() >= v_game.expires_at then return jsonb_build_object('error', 'expired'); end if;

  select count(*) into v_count from teams where game_id = v_game.id
    and session_generation = v_game.session_generation;
  if v_count >= v_game.max_teams then return jsonb_build_object('error', 'full'); end if;

  insert into teams(game_id, name, session_generation)
    values (v_game.id, v_name, v_game.session_generation) returning * into v_team;

  select * into v_q1 from questions where game_id = v_game.id order by ord limit 1;
  insert into team_progress(team_id, question_id) values (v_team.id, v_q1.id);

  return jsonb_build_object('session_token', v_team.session_token,
                            'state', _state_json(v_team, v_game));
end $$;

-- ---------------------------------------------------------------------------
-- get_state: read-only; works even after expiry (grace) so nobody is bricked.
create or replace function get_state(p_session uuid) returns jsonb
language plpgsql security definer as $$
declare v_team teams; v_game games; r record;
begin
  select * into r from _resolve_session(p_session);
  v_team := r.v_team; v_game := r.v_game;
  if v_team.id is null then return jsonb_build_object('error', 'bad_session'); end if;
  return _state_json(v_team, v_game);
end $$;

-- ---------------------------------------------------------------------------
-- submit_answer: idempotent by mutation_id; locks active progress; guards double-advance.
create or replace function submit_answer(p_session uuid, p_input text, p_mutation_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_team teams; v_game games; v_q questions; v_prog team_progress;
        v_ok boolean; v_prior jsonb; v_result jsonb; v_next questions; r record;
begin
  if p_mutation_id is null then return jsonb_build_object('error', 'no_mutation_id'); end if;

  -- Replay: same mutation_id => return the stored result, never re-apply.
  select result into v_prior from submit_idempotency where mutation_id = p_mutation_id;
  if v_prior is not null then return v_prior; end if;

  select * into r from _resolve_session(p_session);
  v_team := r.v_team; v_game := r.v_game;
  if v_team.id is null then return jsonb_build_object('error', 'bad_session'); end if;
  if v_team.finished_at is not null then return jsonb_build_object('error', 'finished'); end if;
  if v_game.expires_at is not null and now() >= v_game.expires_at then
    return jsonb_build_object('error', 'expired');
  end if;

  -- Lock the active progress row so concurrent submits serialize.
  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = v_team.id and tp.solved_at is null order by q.ord limit 1
    for update of tp;
  if not found then return jsonb_build_object('error', 'no_active'); end if;
  select * into v_q from questions where id = v_prog.question_id;

  select (normalize_answer(p_input) = normalize_answer(qs.answer)
          or normalize_answer(p_input) = any (select normalize_answer(a) from unnest(qs.alt_answers) a))
    into v_ok from question_secrets qs where qs.question_id = v_q.id;
  v_ok := coalesce(v_ok, false);

  insert into answer_attempts(team_id, question_id, raw_input, is_correct)
    values (v_team.id, v_q.id, left(coalesce(p_input,''), 200), v_ok);

  if not v_ok then
    v_result := jsonb_build_object('correct', false);
  else
    update team_progress set solved_at = now()
      where id = v_prog.id and solved_at is null;

    select * into v_next from questions
      where game_id = v_q.game_id and ord = v_q.ord + 1;
    if found then
      insert into team_progress(team_id, question_id) values (v_team.id, v_next.id)
        on conflict (team_id, question_id) do nothing;
      v_result := jsonb_build_object('correct', true, 'next_ord', v_next.ord, 'finished', false);
    else
      update teams set finished_at = now() where id = v_team.id and finished_at is null;
      v_result := jsonb_build_object('correct', true, 'finished', true);
    end if;
  end if;

  insert into submit_idempotency(mutation_id, team_id, result)
    values (p_mutation_id, v_team.id, v_result) on conflict (mutation_id) do nothing;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- mark_hint_revealed: idempotent; only counts a hint whose gate is actually open.
create or replace function mark_hint_revealed(p_session uuid, p_hint_id uuid) returns jsonb
language plpgsql security definer as $$
declare v_team teams; v_game games; v_prog team_progress; v_h hints; r record;
begin
  select * into r from _resolve_session(p_session);
  v_team := r.v_team; v_game := r.v_game;
  if v_team.id is null then return jsonb_build_object('error', 'bad_session'); end if;

  select * into v_h from hints where id = p_hint_id;
  if not found then return jsonb_build_object('error', 'bad_hint'); end if;

  select tp.* into v_prog from team_progress tp
    where tp.team_id = v_team.id and tp.question_id = v_h.question_id and tp.solved_at is null;
  if not found then return jsonb_build_object('error', 'not_active'); end if;

  if now() < v_prog.activated_at + make_interval(mins => v_h.reveal_after_min) then
    return jsonb_build_object('error', 'locked');
  end if;

  update team_progress set hints_revealed = greatest(hints_revealed, v_h.ord)
    where id = v_prog.id;
  return jsonb_build_object('ok', true);
end $$;

-- ===========================================================================
-- ADMIN — gated by hashed passcode in app_config. (Phase 4 adds an Edge Function
-- that rate-limits and verifies the passcode, then calls these.)
create or replace function admin_verify(p_code text) returns boolean
language plpgsql security definer as $$
declare v_hash text;
begin
  select value into v_hash from app_config where key = 'admin_code_hash';
  if v_hash is null then return false; end if;
  return crypt(coalesce(p_code,''), v_hash) = v_hash;
end $$;

create or replace function admin_board(p_code text) returns jsonb
language plpgsql security definer as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games order by created_at limit 1;
  return jsonb_build_object(
    'expires_at', v_game.expires_at, 'server_now', now(),
    'session_generation', v_game.session_generation,
    'teams', coalesce((
      select jsonb_agg(row_to_json(b) order by b.name)
      from (
        select t.id, t.name, t.created_at, t.finished_at,
               q.code as stage_code, q.ord as stage_ord,
               ap.activated_at, ap.hints_revealed, ap.skipped,
               extract(epoch from (now() - ap.activated_at))::int as seconds_on_stage,
               extract(epoch from (coalesce(t.finished_at, now()) - t.created_at))::int as total_seconds
        from teams t
        left join lateral (
          select tp.* from team_progress tp join questions q2 on q2.id = tp.question_id
          where tp.team_id = t.id and tp.solved_at is null order by q2.ord limit 1
        ) ap on true
        left join questions q on q.id = ap.question_id
        where t.game_id = v_game.id and t.session_generation = v_game.session_generation
      ) b
    ), '[]'::jsonb)
  );
end $$;

create or replace function admin_skip(p_code text, p_team uuid) returns jsonb
language plpgsql security definer as $$
declare v_q questions; v_prog team_progress; v_next questions; v_team teams;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_team from teams where id = p_team;
  if not found then return jsonb_build_object('error','no_team'); end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team and tp.solved_at is null order by q.ord limit 1 for update of tp;
  if not found then return jsonb_build_object('error','no_active'); end if;
  select * into v_q from questions where id = v_prog.question_id;

  update team_progress set solved_at = now(), skipped = true where id = v_prog.id;
  select * into v_next from questions where game_id = v_q.game_id and ord = v_q.ord + 1;
  if found then
    insert into team_progress(team_id, question_id) values (p_team, v_next.id)
      on conflict (team_id, question_id) do nothing;
  else
    update teams set finished_at = now() where id = p_team and finished_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_reset(p_code text, p_team uuid) returns jsonb
language plpgsql security definer as $$
declare v_team teams; v_q1 questions;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_team from teams where id = p_team;
  if not found then return jsonb_build_object('error','no_team'); end if;

  delete from answer_attempts where team_id = p_team;
  delete from team_progress where team_id = p_team;
  delete from submit_idempotency where team_id = p_team;
  update teams set finished_at = null where id = p_team;
  select * into v_q1 from questions where game_id = v_team.game_id order by ord limit 1;
  insert into team_progress(team_id, question_id) values (p_team, v_q1.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_extend(p_code text, p_minutes int) returns jsonb
language plpgsql security definer as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set expires_at = greatest(coalesce(expires_at, now()), now()) + make_interval(mins => p_minutes)
    where id = (select id from games order by created_at limit 1)
    returning * into v_game;
  return jsonb_build_object('ok', true, 'expires_at', v_game.expires_at);
end $$;

-- New game / re-run: keep content, wipe runtime, bump generation (invalidates old tokens),
-- set a fresh expiry window.
create or replace function admin_new_game(p_code text, p_duration_min int) returns jsonb
language plpgsql security definer as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games order by created_at limit 1 for update;
  delete from teams where game_id = v_game.id;  -- cascades progress/attempts/idempotency
  update games set session_generation = session_generation + 1,
                   expires_at = now() + make_interval(mins => p_duration_min)
    where id = v_game.id returning * into v_game;
  return jsonb_build_object('ok', true, 'session_generation', v_game.session_generation,
                            'expires_at', v_game.expires_at);
end $$;

-- Lock down internals & the passcode oracle: only the definer (owner) may call these.
revoke all on function _resolve_session(uuid) from public;
revoke all on function _state_json(teams, games) from public;
revoke all on function admin_verify(text) from public;

-- Anon may execute the RPCs (they are the only game API). Admin ones self-gate on the passcode.
grant execute on function
  register_team(text), get_state(uuid), submit_answer(uuid,text,uuid),
  mark_hint_revealed(uuid,uuid), admin_board(text), admin_skip(text,uuid),
  admin_reset(text,uuid), admin_extend(text,int), admin_new_game(text,int)
to anon;
