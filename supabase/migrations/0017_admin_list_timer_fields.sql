-- 0017_admin_list_timer_fields.sql — admin_list now returns server_now (top level) and
-- per-game starts_at/paused_at so the admin side-menu can show a live countdown/elapsed timer.
create or replace function admin_list(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object('server_now', now(),
    'games', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select g.id, g.pin, g.name, g.description, g.status, g.duration_min, g.expires_at, g.theme_id,
             g.starts_at, g.paused_at,
             (select name from themes th where th.id = g.theme_id) as theme_name,
             (select count(*) from questions q where q.game_id = g.id) as question_count,
             (select count(*) from teams t where t.game_id = g.id and t.session_generation = g.session_generation) as team_count,
             g.created_at
      from games g) x), '[]'::jsonb),
    'themes', coalesce((select jsonb_agg(row_to_json(t) order by t.name) from (select id, name, tokens from themes) t), '[]'::jsonb));
end $$;
