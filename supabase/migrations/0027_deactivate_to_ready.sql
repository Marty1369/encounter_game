-- 0027_deactivate_to_ready.sql — un-activate a live game back to READY.
-- Allowed only BEFORE the game has started (a started game must be Ended, not reverted, or its
-- players would be stranded). Closes registration, clears starts_at/pause/expiry, and bumps
-- session_generation so the currently-joined teams drop out of the run — a clean slate that can
-- be edited (admin_save_game refuses 'live') and re-activated. Team rows remain but are excluded
-- from the active generation (the standard reset mechanism).
create or replace function admin_deactivate(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path to 'public','extensions' as $function$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_game.status <> 'live' then return jsonb_build_object('error','not_live'); end if;
  if v_game.starts_at is not null and now() >= v_game.starts_at then
    return jsonb_build_object('error','already_started');
  end if;
  update games set status='ready', registration_open=false, starts_at=null, paused_at=null,
       expires_at=null, session_generation = session_generation + 1
    where id = p_game returning * into v_game;
  return jsonb_build_object('ok', true, 'status', v_game.status);
end $function$;
grant execute on function admin_deactivate(text,uuid) to anon, authenticated;
