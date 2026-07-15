-- 0011_no_duration.sql — games have no fixed duration: no auto-expiry.
-- A game ends only when the admin Stops it.
update games set expires_at = null where status <> 'ended';

create or replace function admin_start_now(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_game games;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_game from games where id = p_game for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  update team_progress tp set activated_at = now()
    from teams t where t.id = tp.team_id and t.game_id = p_game and tp.solved_at is null;
  update games set status='live', starts_at = now(), paused_at=null, expires_at=null
    where id = p_game returning * into v_game;
  return jsonb_build_object('ok', true, 'starts_at', v_game.starts_at);
end $$;

create or replace function admin_stop(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  update games set status='ended', paused_at=null, registration_open=false, expires_at=now() where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('ok', true, 'status', 'ended');
end $$;
