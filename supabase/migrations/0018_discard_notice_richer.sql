-- 0018_discard_notice_richer.sql — the cancel-task notice now carries the question NUMBER,
-- the name, the reason (if any), and a line telling players their time on it will be deducted.
-- (Full admin_discard_task redefined; only the v_msg text changed vs 0013/0009.)
create or replace function admin_discard_task(p_code text, p_game uuid, p_ord integer, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $function$
declare v_game games; v_q questions; v_next questions; r record; v_msg text;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into v_q from questions where game_id = p_game and ord = p_ord;
  if not found then return jsonb_build_object('error','no_such_task'); end if;
  select * into v_next from questions where game_id = p_game and ord = p_ord + 1;

  update teams t set time_credit_seconds = time_credit_seconds
      + greatest(0, (select extract(epoch from (tp.solved_at - tp.activated_at))::int
                     from team_progress tp where tp.team_id = t.id and tp.question_id = v_q.id and tp.solved_at is not null))
    where t.game_id = p_game
      and exists (select 1 from team_progress tp where tp.team_id = t.id and tp.question_id = v_q.id and tp.solved_at is not null);

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

  v_msg := 'Question ' || p_ord || ' "' || coalesce(v_q.title,'') || '" was cancelled by the host.';
  if nullif(btrim(coalesce(p_reason,'')),'') is not null then
    v_msg := v_msg || E'\nReason: ' || btrim(p_reason);
  end if;
  v_msg := v_msg || E'\nThe time you spent on this task will be deducted from your total.';
  insert into game_notices(game_id, message) values (p_game, v_msg);

  delete from questions where id = v_q.id;
  update questions set ord = ord - 1 where game_id = p_game and ord > p_ord;
  return jsonb_build_object('ok', true, 'discarded_ord', p_ord, 'notice', v_msg);
end $function$;
