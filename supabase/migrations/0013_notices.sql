-- 0013_notices.sql — discard-task carries a cause; all players get a notification.
-- game_notices: players poll get_notices and toast any id they haven't shown.
create table if not exists game_notices (
  id bigint generated always as identity primary key,
  game_id uuid not null references games(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists game_notices_game_idx on game_notices (game_id, id);
alter table game_notices enable row level security;
revoke all on game_notices from anon, authenticated;
-- get_notices(uuid), admin_discard_task(text,uuid,int,text) — see applied migration.
-- (Body identical to what was applied via MCP on 2026-07-16.)
