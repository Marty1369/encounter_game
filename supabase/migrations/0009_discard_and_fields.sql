-- 0009_discard_and_fields.sql — wizard persists case_sensitive + info; discard-task
-- with time credit-back; totals subtract the credit.

alter table teams add column if not exists time_credit_seconds int not null default 0;

-- admin_get_game: expose case_sensitive + info
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
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'ord', q.ord, 'title', q.title, 'intro', q.intro, 'info', q.info, 'case_sensitive', q.case_sensitive,
        'location_name', q.location_name, 'lat', q.lat, 'lng', q.lng, 'blocks', q.blocks,
        'answer', (select answer from question_secrets s where s.question_id = q.id),
        'alt_answers', (select alt_answers from question_secrets s where s.question_id = q.id),
        'hints', coalesce((select jsonb_agg(jsonb_build_object('ord', h.ord, 'reveal_after_min', h.reveal_after_min,
            'text', h.text, 'media_type', h.media_type, 'media_url', h.media_url) order by h.ord)
          from hints h where h.question_id = q.id), '[]'::jsonb)
      ) order by q.ord) from questions q where q.game_id = v_game.id), '[]'::jsonb));
end $$;

-- admin_save_game: persist case_sensitive + info (+ hint media, already supported)
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
      values (gen_pin(), coalesce(p_payload->>'name','Untitled'), p_payload->>'description',
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
    delete from questions where game_id = v_id;
  end if;
  v_ord := 0;
  for q in select value from jsonb_array_elements(coalesce(p_payload->'questions','[]'::jsonb)) loop
    v_ord := v_ord + 1;
    insert into questions(game_id, ord, title, intro, info, case_sensitive, location_name, lat, lng, blocks)
      values (v_id, v_ord, coalesce(q->>'title','Question '||v_ord), q->>'intro', q->>'info',
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
      insert into hints(question_id, ord, reveal_after_min, text, media_type, media_url)
        values (v_qid, v_hord, coalesce((h->>'reveal_after_min')::int,0),
                h->>'text', nullif(h->>'media_type',''), nullif(h->>'media_url',''));
    end loop;
  end loop;
  select * into v_game from games where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_game.id, 'pin', v_game.pin);
end $$;

-- discard a question mid-game: credit back time to teams that solved it, move active
-- teams onto the next task, renumber remaining questions.
create or replace function admin_discard_task(p_code text, p_game uuid, p_ord int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games; v_q questions; v_next questions; r record;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into v_q from questions where game_id = p_game and ord = p_ord;
  if not found then return jsonb_build_object('error','no_such_task'); end if;
  select * into v_next from questions where game_id = p_game and ord = p_ord + 1;

  -- credit teams that already solved this task
  update teams t set time_credit_seconds = time_credit_seconds
      + greatest(0, (select extract(epoch from (tp.solved_at - tp.activated_at))::int
                     from team_progress tp where tp.team_id = t.id and tp.question_id = v_q.id and tp.solved_at is not null))
    where t.game_id = p_game
      and exists (select 1 from team_progress tp where tp.team_id = t.id and tp.question_id = v_q.id and tp.solved_at is not null);

  -- teams currently ON this task -> move them forward (or finish if it was last)
  for r in select t.id as team_id from teams t
           join team_progress tp on tp.team_id = t.id
           where t.game_id = p_game and tp.question_id = v_q.id and tp.solved_at is null loop
    if v_next.id is not null then
      insert into team_progress(team_id, question_id, activated_at) values (r.team_id, v_next.id, now())
        on conflict (team_id, question_id) do update set activated_at = now(), solved_at = null;
    else
      update teams set finished_at = now() where id = r.team_id and finished_at is null;
    end if;
  end loop;

  delete from questions where id = v_q.id;                          -- cascades its progress/attempts/hints/secret
  update questions set ord = ord - 1 where game_id = p_game and ord > p_ord;  -- keep ords contiguous
  return jsonb_build_object('ok', true, 'discarded_ord', p_ord);
end $$;

-- totals subtract the credit
create or replace function leaderboard(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error','not_found'); end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.total_seconds)
    from (select t.name,
                 greatest(0, extract(epoch from (t.finished_at - t.created_at))::int - t.time_credit_seconds) as total_seconds,
                 (select coalesce(sum(hints_revealed),0) from team_progress tp where tp.team_id = t.id) as hints
          from teams t
          where t.game_id = v_game.id and t.session_generation = v_game.session_generation and t.finished_at is not null
    ) x), '[]'::jsonb);
end $$;

grant execute on function admin_discard_task(text,uuid,int) to anon;
