-- 0008_game_controls.sql — scheduled start, registration, case-sensitivity, info block,
-- per-team hint overrides, and single-admin email+password login.

-- ---- schema ----
alter table games add column if not exists starts_at timestamptz;
alter table games add column if not exists registration_open boolean not null default true;
alter table questions add column if not exists case_sensitive boolean not null default false;
alter table questions add column if not exists info text;

create table if not exists team_hint_overrides (
  team_id uuid not null references teams(id) on delete cascade,
  hint_id uuid not null references hints(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, hint_id)
);
alter table team_hint_overrides enable row level security;
revoke all on team_hint_overrides from anon, authenticated;

-- case-sensitive normalizer (trim + drop spaces/hyphens, PRESERVE case & diacritics)
create or replace function normalize_cs(s text) returns text
language sql immutable set search_path = public, extensions as $$
  select regexp_replace(btrim(s), '[\s\-]', '', 'g')
$$;

-- ---- single-admin email + password login ----
create or replace function admin_login(p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_email text; v_hash text; v_token uuid; v_exp timestamptz;
begin
  select value into v_email from app_config where key = 'admin_email';
  select value into v_hash  from app_config where key = 'admin_pw_hash';
  if v_email is null or v_hash is null then return jsonb_build_object('error','not_configured'); end if;
  if lower(btrim(coalesce(p_email,''))) <> lower(v_email) or crypt(coalesce(p_password,''), v_hash) <> v_hash then
    return jsonb_build_object('error','bad_credentials');
  end if;
  v_token := gen_random_uuid(); v_exp := now() + interval '12 hours';
  insert into app_config(key,value) values ('admin_session_token', v_token::text)
    on conflict (key) do update set value = excluded.value;
  insert into app_config(key,value) values ('admin_session_exp', v_exp::text)
    on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('token', v_token, 'exp', v_exp);
end $$;
revoke all on function admin_login(text,text) from public;
grant execute on function admin_login(text,text) to anon;

-- admin_verify now checks the session token (issued by admin_login), not a raw passcode
create or replace function admin_verify(p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_tok text; v_exp text;
begin
  select value into v_tok from app_config where key = 'admin_session_token';
  select value into v_exp from app_config where key = 'admin_session_exp';
  if v_tok is null or v_exp is null then return false; end if;
  return p_code = v_tok and now() < v_exp::timestamptz;
end $$;
revoke all on function admin_verify(text) from public, anon, authenticated;

-- ---- lobby: expose schedule + registration ----
create or replace function get_game_by_pin(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  return jsonb_build_object(
    'name', v_game.name, 'description', v_game.description, 'status', v_game.status,
    'theme', v_game.theme, 'max_teams', v_game.max_teams,
    'starts_at', v_game.starts_at, 'registration_open', v_game.registration_open,
    'server_now', now(),
    'started', (v_game.status='live' and (v_game.starts_at is null or now() >= v_game.starts_at)),
    'expired', (v_game.expires_at is not null and now() >= v_game.expires_at),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name,
        'players', (select count(*) from players p where p.team_id = t.id)) order by t.name)
      from teams t where t.game_id = v_game.id and t.session_generation = v_game.session_generation), '[]'::jsonb)
  );
end $$;

-- ---- join: gated by registration; schedule-aware Q1 activation ----
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
      v_act := greatest(coalesce(v_game.starts_at, now()), now());  -- fair synchronized start
      if v_q1.id is not null then insert into team_progress(team_id, question_id, activated_at) values (v_team.id, v_q1.id, v_act) on conflict do nothing; end if;
    end if;
  end if;
  insert into players(team_id, name) values (v_team.id, v_pn) returning * into v_player;
  return jsonb_build_object('session_token', v_player.session_token, 'state', _state_json(v_team, v_game));
end $$;

-- ---- state: started/countdown, info block, override-aware hints ----
create or replace function _state_json(p_team teams, p_game games) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_q questions; v_prog team_progress; v_hints jsonb; v_total int; v_expired boolean; v_started boolean;
begin
  v_expired := (p_game.expires_at is not null and now() >= p_game.expires_at);
  v_started := (p_game.starts_at is null or now() >= p_game.starts_at);
  select count(*) into v_total from questions where game_id = p_game.id;

  if p_team.finished_at is not null then
    return jsonb_build_object('finished', true, 'started', true, 'team', jsonb_build_object('name', p_team.name),
      'finished_at', p_team.finished_at, 'total_seconds', extract(epoch from (p_team.finished_at - p_team.created_at))::int,
      'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
  end if;

  if not v_started then
    return jsonb_build_object('finished', false, 'started', false, 'team', jsonb_build_object('name', p_team.name),
      'starts_at', p_game.starts_at, 'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
      'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
  end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team.id and tp.solved_at is null order by q.ord limit 1;
  select * into v_q from questions where id = v_prog.question_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min,
      'unlocked', u.unlocked,
      'text', case when u.unlocked then h.text else null end,
      'media_type', case when u.unlocked then h.media_type else null end,
      'media_url', case when u.unlocked then h.media_url else null end
    ) order by h.ord), '[]'::jsonb)
  into v_hints from hints h
  cross join lateral (select (now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)
      or exists(select 1 from team_hint_overrides o where o.team_id = p_team.id and o.hint_id = h.id)) as unlocked) u
  where h.question_id = v_q.id;

  return jsonb_build_object('finished', false, 'started', true, 'team', jsonb_build_object('name', p_team.name),
    'question', jsonb_build_object('ord', v_q.ord, 'title', v_q.title, 'intro', v_q.intro, 'info', v_q.info,
      'location_name', v_q.location_name, 'lat', v_q.lat, 'lng', v_q.lng, 'blocks', v_q.blocks),
    'activated_at', v_prog.activated_at, 'hints_revealed', v_prog.hints_revealed, 'hints', v_hints,
    'server_now', now(), 'expires_at', p_game.expires_at, 'expired', v_expired,
    'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
end $$;

-- ---- submit: block before start; per-question case sensitivity ----
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
  if v_game.starts_at is not null and now() < v_game.starts_at then return jsonb_build_object('error','not_started'); end if;
  if v_game.expires_at is not null and now() >= v_game.expires_at then return jsonb_build_object('error','expired'); end if;

  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = v_team.id and tp.solved_at is null order by q.ord limit 1 for update of tp;
  if not found then return jsonb_build_object('error','no_active'); end if;
  select * into v_q from questions where id = v_prog.question_id;
  select answer, alt_answers into v_ans, v_alt from question_secrets where question_id = v_q.id;
  v_cs := coalesce(v_q.case_sensitive, false);

  if v_cs then
    v_ok := normalize_cs(p_input) = normalize_cs(v_ans)
         or normalize_cs(p_input) = any (select normalize_cs(x) from unnest(v_alt) x);
  else
    v_ok := normalize_answer(p_input) = normalize_answer(v_ans)
         or normalize_answer(p_input) = any (select normalize_answer(x) from unnest(v_alt) x);
  end if;
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

-- ---- game control RPCs (admin) ----
create or replace function admin_set_schedule(p_code text, p_game uuid, p_starts_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set starts_at = p_starts_at where id = p_game returning * into v_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'starts_at', v_game.starts_at);
end $$;

create or replace function admin_start_now(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  -- start immediately: pull activation of not-yet-started teams to now, set live + expiry window
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  update team_progress tp set activated_at = now()
    from teams t where t.id = tp.team_id and t.game_id = p_game and tp.solved_at is null and tp.activated_at > now();
  update games set status='live', starts_at = now(),
    expires_at = greatest(coalesce(expires_at, now()), now()) + make_interval(mins => duration_min)
    where id = p_game returning * into v_game;
  return jsonb_build_object('ok', true, 'starts_at', v_game.starts_at, 'expires_at', v_game.expires_at);
end $$;

create or replace function admin_set_registration(p_code text, p_game uuid, p_open boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set registration_open = p_open where id = p_game returning * into v_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'registration_open', v_game.registration_open);
end $$;

-- teams + players roster for a game
create or replace function admin_roster(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object(
    'team_count', (select count(*) from teams t where t.game_id = p_game and t.session_generation = v_game.session_generation),
    'player_count', (select count(*) from players p join teams t on t.id=p.team_id where t.game_id = p_game and t.session_generation = v_game.session_generation),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
        'players', coalesce((select jsonb_agg(pl.name order by pl.created_at) from players pl where pl.team_id = t.id), '[]'::jsonb)
      ) order by t.name) from teams t where t.game_id = p_game and t.session_generation = v_game.session_generation), '[]'::jsonb));
end $$;

-- force-unlock a specific hint for a specific team
create or replace function admin_show_hint(p_code text, p_team uuid, p_hint uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  insert into team_hint_overrides(team_id, hint_id) values (p_team, p_hint) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- current-stage hint list for a team (so admin can pick which hint to reveal)
create or replace function admin_team_hints(p_code text, p_team uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_prog team_progress;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select tp.* into v_prog from team_progress tp join questions q on q.id = tp.question_id
    where tp.team_id = p_team and tp.solved_at is null order by q.ord limit 1;
  if not found then return jsonb_build_object('hints','[]'::jsonb); end if;
  return jsonb_build_object('hints', coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'ord', h.ord, 'reveal_after_min', h.reveal_after_min,
      'shown', (now() >= v_prog.activated_at + make_interval(mins => h.reveal_after_min)
                or exists(select 1 from team_hint_overrides o where o.team_id=p_team and o.hint_id=h.id))
    ) order by h.ord) from hints h where h.question_id = v_prog.question_id), '[]'::jsonb));
end $$;

grant execute on function
  admin_set_schedule(text,uuid,timestamptz), admin_start_now(text,uuid), admin_set_registration(text,uuid,boolean),
  admin_roster(text,uuid), admin_show_hint(text,uuid,uuid), admin_team_hints(text,uuid)
to anon;
