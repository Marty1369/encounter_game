-- 0012_autostop_all_finished.sql — the game ends automatically once every team in the
-- current run has finished (submit_answer sets status='ended' when no unfinished team remains).
-- (Full submit_answer redefined; only the finish branch changed vs 0010/0011.)
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
      if not exists (select 1 from teams tt where tt.game_id = v_game.id
                     and tt.session_generation = v_game.session_generation and tt.finished_at is null) then
        update games set status='ended', paused_at=null, registration_open=false, expires_at=now()
          where id = v_game.id and status <> 'ended';
      end if;
      v_result := jsonb_build_object('correct', true, 'finished', true);
    end if;
  end if;
  insert into submit_idempotency(mutation_id, team_id, result) values (p_mutation_id, v_team.id, v_result) on conflict (mutation_id) do nothing;
  return v_result;
end $$;
