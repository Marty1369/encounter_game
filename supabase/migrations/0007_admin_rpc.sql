-- 0007_admin_rpc.sql — admin API (passcode-gated). The admin app calls these via anon;
-- each self-gates on the bcrypt passcode in app_config. Covers the four admin tabs:
-- Games list, Wizard (save/CSV), Themes, Live Monitor (+ status/run/extend/reset).

create or replace function admin_verify(p_code text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select value into v_hash from app_config where key = 'admin_code_hash';
  if v_hash is null then return false; end if;
  return crypt(coalesce(p_code,''), v_hash) = v_hash;
end $$;
revoke all on function admin_verify(text) from public, anon, authenticated;

-- ---- Games list ----
create or replace function admin_list(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object('games', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select g.id, g.pin, g.name, g.description, g.status, g.duration_min, g.expires_at, g.theme_id,
             (select name from themes th where th.id = g.theme_id) as theme_name,
             (select count(*) from questions q where q.game_id = g.id) as question_count,
             (select count(*) from teams t where t.game_id = g.id and t.session_generation = g.session_generation) as team_count,
             g.created_at
      from games g) x), '[]'::jsonb),
    'themes', coalesce((select jsonb_agg(row_to_json(t) order by t.name) from (select id, name, tokens from themes) t), '[]'::jsonb));
end $$;

-- ---- Full game for the wizard editor (includes answers — admin only) ----
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
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'ord', q.ord, 'title', q.title, 'intro', q.intro,
        'location_name', q.location_name, 'lat', q.lat, 'lng', q.lng, 'blocks', q.blocks,
        'answer', (select answer from question_secrets s where s.question_id = q.id),
        'alt_answers', (select alt_answers from question_secrets s where s.question_id = q.id),
        'hints', coalesce((select jsonb_agg(jsonb_build_object('ord', h.ord, 'reveal_after_min', h.reveal_after_min,
            'text', h.text, 'media_type', h.media_type, 'media_url', h.media_url) order by h.ord)
          from hints h where h.question_id = q.id), '[]'::jsonb)
      ) order by q.ord) from questions q where q.game_id = v_game.id), '[]'::jsonb));
end $$;

-- ---- Save game (create or replace content). Blocked while live. Also used by CSV import. ----
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
    insert into games(pin, name, description, duration_min, max_teams, theme_id, theme, status)
      values (gen_pin(), coalesce(p_payload->>'name','Be pavadinimo'), p_payload->>'description',
              coalesce((p_payload->>'duration_min')::int,240), coalesce((p_payload->>'max_teams')::int,20),
              nullif(p_payload->>'theme_id','')::uuid, v_tokens, 'draft')
      returning * into v_game;
    v_id := v_game.id;
  else
    select * into v_game from games where id = v_id;
    if not found then return jsonb_build_object('error','not_found'); end if;
    if v_game.status = 'live' then return jsonb_build_object('error','game_live'); end if;
    update games set name = coalesce(p_payload->>'name', name), description = p_payload->>'description',
      duration_min = coalesce((p_payload->>'duration_min')::int, duration_min),
      max_teams = coalesce((p_payload->>'max_teams')::int, max_teams),
      theme_id = nullif(p_payload->>'theme_id','')::uuid, theme = v_tokens
      where id = v_id;
    delete from questions where game_id = v_id;  -- cascade secrets + hints
  end if;

  v_ord := 0;
  for q in select value from jsonb_array_elements(coalesce(p_payload->'questions','[]'::jsonb)) loop
    v_ord := v_ord + 1;
    insert into questions(game_id, ord, title, intro, location_name, lat, lng, blocks)
      values (v_id, v_ord, coalesce(q->>'title','Užduotis '||v_ord), q->>'intro',
              q->>'location_name', nullif(q->>'lat','')::float8, nullif(q->>'lng','')::float8,
              coalesce(q->'blocks','[]'::jsonb))
      returning id into v_qid;
    insert into question_secrets(question_id, answer, alt_answers)
      values (v_qid, coalesce(q->>'answer',''),
              coalesce((select array_agg(value) from jsonb_array_elements_text(q->'alt_answers')), '{}'));
    v_hord := 0;
    for h in select value from jsonb_array_elements(coalesce(q->'hints','[]'::jsonb)) loop
      v_hord := v_hord + 1;
      insert into hints(question_id, ord, reveal_after_min, text, media_type, media_url)
        values (v_qid, v_hord, coalesce((h->>'reveal_after_min')::int,0),
                h->>'text', nullif(h->>'media_type',''), nullif(h->>'media_url',''));
    end loop;
  end loop;

  select * into v_game from games where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_game.id, 'pin', v_game.pin);
end $$;

-- ---- Status transitions ----
create or replace function admin_set_status(p_code text, p_game uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  if p_status not in ('draft','ready','live','ended') then return jsonb_build_object('error','bad_status'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if p_status = 'live' then
    update games set status='live', expires_at = now() + make_interval(mins => duration_min) where id = p_game returning * into v_game;
  elsif p_status = 'ended' then
    update games set status='ended' where id = p_game returning * into v_game;
  else
    update games set status=p_status, expires_at = null where id = p_game returning * into v_game;
  end if;
  return jsonb_build_object('ok', true, 'status', v_game.status, 'expires_at', v_game.expires_at);
end $$;

-- ---- New run: keep content, wipe teams, fresh session ----
create or replace function admin_new_run(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  delete from teams where game_id = p_game;
  update games set session_generation = session_generation + 1, status='live',
    expires_at = now() + make_interval(mins => duration_min) where id = p_game returning * into v_game;
  return jsonb_build_object('ok', true, 'session_generation', v_game.session_generation, 'expires_at', v_game.expires_at);
end $$;

create or replace function admin_extend(p_code text, p_game uuid, p_minutes int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set expires_at = greatest(coalesce(expires_at, now()), now()) + make_interval(mins => p_minutes)
    where id = p_game returning * into v_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'expires_at', v_game.expires_at);
end $$;

create or replace function admin_delete_game(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  delete from games where id = p_game;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_reset_team(p_code text, p_team uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_team teams; v_q1 questions;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_team from teams where id = p_team;
  if not found then return jsonb_build_object('error','not_found'); end if;
  delete from answer_attempts where team_id = p_team;
  delete from submit_idempotency where team_id = p_team;
  delete from team_progress where team_id = p_team;
  update teams set finished_at = null where id = p_team;
  select * into v_q1 from questions where game_id = v_team.game_id order by ord limit 1;
  if v_q1.id is not null then insert into team_progress(team_id, question_id) values (p_team, v_q1.id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---- Live monitor ----
create or replace function admin_monitor(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('server_now', now(), 'expires_at', v_game.expires_at, 'status', v_game.status,
    'total_questions', (select count(*) from questions where game_id = p_game),
    'teams', coalesce((select jsonb_agg(row_to_json(b) order by b.name) from (
      select t.id, t.name, t.created_at, t.finished_at,
             (select count(*) from players p where p.team_id = t.id) as players,
             ap.stage_ord, ap.stage_title, ap.hints_revealed,
             extract(epoch from (now() - ap.activated_at))::int as seconds_on_stage,
             extract(epoch from (coalesce(t.finished_at, now()) - t.created_at))::int as total_seconds
      from teams t
      left join lateral (select q.ord as stage_ord, q.title as stage_title, tp.activated_at, tp.hints_revealed
        from team_progress tp join questions q on q.id = tp.question_id
        where tp.team_id = t.id and tp.solved_at is null order by q.ord limit 1) ap on true
      where t.game_id = p_game and t.session_generation = v_game.session_generation) b), '[]'::jsonb));
end $$;

-- ---- Themes ----
create or replace function admin_save_theme(p_code text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_theme themes;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  v_id := nullif(p_payload->>'id','')::uuid;
  if v_id is null then
    insert into themes(name, tokens) values (coalesce(p_payload->>'name','Tema'), coalesce(p_payload->'tokens','{}'::jsonb)) returning * into v_theme;
  else
    update themes set name = coalesce(p_payload->>'name', name), tokens = coalesce(p_payload->'tokens', tokens) where id = v_id returning * into v_theme;
  end if;
  return jsonb_build_object('ok', true, 'id', v_theme.id);
end $$;

create or replace function admin_delete_theme(p_code text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  delete from themes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function
  admin_list(text), admin_get_game(text,uuid), admin_save_game(text,jsonb),
  admin_set_status(text,uuid,text), admin_new_run(text,uuid), admin_extend(text,uuid,int),
  admin_delete_game(text,uuid), admin_reset_team(text,uuid), admin_monitor(text,uuid),
  admin_save_theme(text,jsonb), admin_delete_theme(text,uuid)
to anon;
