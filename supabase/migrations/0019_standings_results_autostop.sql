-- 0019_standings_results_autostop.sql
--  * _maybe_autostop(game): end a game once every team of the current run has finished (>=1 team).
--    Wired into submit_answer (finish branch) AND admin_discard_task (discarding the last task can
--    finish every team — previously that path left the game 'live').
--  * standings(pin)  [anon]  — live table for players: team + current question (or finished).
--  * results(pin)    [anon]  — final leaderboard: per-team splits[] + overall = sum(splits) − credits.
--  * admin_monitor: each team now carries splits[] (solved question, seconds, hints) for the expand view.
-- Bodies were applied via MCP; this file mirrors them for the migration history.

create or replace function _maybe_autostop(p_game uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update games g set status='ended', paused_at=null, registration_open=false, expires_at=now()
   where g.id = p_game and g.status <> 'ended'
     and exists (select 1 from teams t where t.game_id=g.id and t.session_generation=g.session_generation)
     and not exists (select 1 from teams t where t.game_id=g.id and t.session_generation=g.session_generation and t.finished_at is null);
end $$;

-- submit_answer finish branch now does:  perform _maybe_autostop(v_game.id);   (see applied body)
-- admin_discard_task now calls          perform _maybe_autostop(p_game);       after re-homing teams.

create or replace function standings(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error','not_found'); end if;
  return coalesce((select jsonb_agg(row_to_json(x)
      order by x.finished desc,
               (case when x.finished then x.total_seconds else 0 end) asc,
               x.stage_ord desc nulls last, x.name)
    from (
      select t.name, t.finished_at is not null as finished,
             greatest(0, extract(epoch from (t.finished_at - t.created_at))::int - t.time_credit_seconds) as total_seconds,
             ap.stage_ord, ap.stage_title
      from teams t
      left join lateral (select q.ord as stage_ord, q.title as stage_title
        from team_progress tp join questions q on q.id = tp.question_id
        where tp.team_id = t.id and tp.solved_at is null order by q.ord limit 1) ap on true
      where t.game_id = v_game.id and t.session_generation = v_game.session_generation
    ) x), '[]'::jsonb);
end $$;

create or replace function results(p_pin text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  select * into v_game from games where upper(pin) = upper(btrim(p_pin));
  if not found then return jsonb_build_object('error','not_found'); end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.finished desc, x.overall_seconds asc, x.name)
    from (
      select t.name, t.finished_at is not null as finished,
        greatest(0, coalesce((select sum(extract(epoch from (tp.solved_at - tp.activated_at))::int)
             from team_progress tp where tp.team_id = t.id and tp.solved_at is not null),0) - t.time_credit_seconds) as overall_seconds,
        coalesce((select jsonb_agg(jsonb_build_object(
             'ord', q.ord, 'title', q.title,
             'seconds', greatest(0, extract(epoch from (tp.solved_at - tp.activated_at))::int)) order by q.ord)
          from team_progress tp join questions q on q.id = tp.question_id
          where tp.team_id = t.id and tp.solved_at is not null), '[]'::jsonb) as splits
      from teams t
      where t.game_id = v_game.id and t.session_generation = v_game.session_generation
    ) x), '[]'::jsonb);
end $$;

grant execute on function standings(text) to anon, authenticated;
grant execute on function results(text) to anon, authenticated;
-- admin_monitor redefined with per-team splits[] — see applied body.
