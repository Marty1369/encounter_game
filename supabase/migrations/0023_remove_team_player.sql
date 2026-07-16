-- 0023_remove_team_player.sql — the host can remove a team or a single player.
--
-- Cascades already do the right thing: deleting a team removes its players/progress/attempts/
-- overrides; deleting a player leaves answer_attempts.player_id NULL, so the team KEEPS the
-- answers it already earned.
-- admin_roster now returns players as {id,name} (was names only) so a single player can be
-- targeted. _maybe_autostop now ignores teams with no players: such a team can never finish, so
-- it must not hold the game open forever after its last player is removed.
create or replace function admin_delete_team(p_code text, p_team uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game uuid; v_name text;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select t.game_id, t.name into v_game, v_name from teams t where t.id = p_team;
  if not found then return jsonb_build_object('error','not_found'); end if;
  delete from teams where id = p_team;
  perform _maybe_autostop(v_game);
  return jsonb_build_object('ok', true, 'name', v_name);
end $$;

create or replace function admin_delete_player(p_code text, p_player uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_team uuid; v_game uuid; v_name text; v_left int;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select p.team_id, p.name into v_team, v_name from players p where p.id = p_player;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select t.game_id into v_game from teams t where t.id = v_team;
  delete from players where id = p_player;
  select count(*) into v_left from players where team_id = v_team;
  perform _maybe_autostop(v_game);
  return jsonb_build_object('ok', true, 'name', v_name, 'players_left', v_left);
end $$;

grant execute on function admin_delete_team(text,uuid) to anon, authenticated;
grant execute on function admin_delete_player(text,uuid) to anon, authenticated;
-- admin_roster + _maybe_autostop redefined via MCP (see comment above).
