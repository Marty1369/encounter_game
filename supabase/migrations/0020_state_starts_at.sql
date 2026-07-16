-- 0020_state_starts_at.sql — the playing state now carries the game's starts_at.
-- The player's clock was based on team_progress.activated_at, which resets on every new
-- challenge, so it kept dropping back to 00:00 mid-game. With starts_at the player can show
-- total elapsed time (hints still unlock off activated_at, which is what they're relative to).
-- (Full _state_json redefined; only the returned keys changed vs the previous body.)
create or replace function _state_json(p_team teams, p_game games) returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare v_q questions; v_prog team_progress; v_hints jsonb; v_total int; v_expired boolean; v_started boolean; v_paused boolean; v_eff timestamptz;
begin
  v_expired := (p_game.expires_at is not null and now() >= p_game.expires_at);
  v_started := (p_game.starts_at is not null and now() >= p_game.starts_at);
  v_paused  := (p_game.paused_at is not null);
  v_eff     := coalesce(p_game.paused_at, now());
  select count(*) into v_total from questions where game_id = p_game.id;
  if p_team.finished_at is not null then
    return jsonb_build_object('finished', true, 'started', true, 'paused', false, 'team', jsonb_build_object('name', p_team.name),
      'finished_at', p_team.finished_at, 'total_seconds', greatest(0, extract(epoch from (p_team.finished_at - p_team.created_at))::int - coalesce(p_team.time_credit_seconds,0)),
      'server_now', now(), 'starts_at', p_game.starts_at, 'expires_at', p_game.expires_at, 'expired', v_expired,
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
      'media_url', case when u.unlocked then h.media_url else null end,
      'blocks', case when u.unlocked then h.blocks else '[]'::jsonb end
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
    'started_at', p_game.starts_at, 'starts_at', p_game.starts_at,
    'server_now', v_eff, 'expires_at', p_game.expires_at, 'expired', v_expired,
    'total_questions', v_total, 'theme', p_game.theme, 'game_name', p_game.name);
end $function$;
