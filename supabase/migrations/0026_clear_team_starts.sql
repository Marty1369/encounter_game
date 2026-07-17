-- 0026_clear_team_starts.sql — "Everyone together" (default) vs "Staggered starts" is a UI toggle;
-- switching back to together must actually clear the per-team overrides or teams that still hold
-- one would not start with the rest. Only clears teams that HAVEN'T started yet (a mid-game team
-- keeps its override so it isn't yanked back to a countdown).
create or replace function admin_clear_team_starts(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare v_game games; v_new timestamptz; v_n int;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  v_new := coalesce(v_game.starts_at, now());
  update teams t set starts_at = null
   where t.game_id = p_game and t.finished_at is null
     and (coalesce(t.starts_at, v_game.starts_at) is null or now() < coalesce(t.starts_at, v_game.starts_at));
  get diagnostics v_n = row_count;
  update team_progress tp set activated_at = v_new
    from teams t where t.id = tp.team_id and t.game_id = p_game and t.starts_at is null and tp.solved_at is null;
  return jsonb_build_object('ok', true, 'cleared', v_n);
end $function$;
grant execute on function admin_clear_team_starts(text,uuid) to anon, authenticated;
