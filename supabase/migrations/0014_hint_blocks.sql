-- 0014_hint_blocks.sql — hints get blocks[] (text+image+…); _state_json returns gated
-- hint blocks; admin_save_game/get_game persist/return them. Applied via MCP 2026-07-16.
alter table hints add column if not exists blocks jsonb not null default '[]'::jsonb;
-- (function bodies for _state_json, admin_get_game, admin_save_game applied via MCP)
