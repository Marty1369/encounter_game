-- 0022_team_code_autojoin.sql — invite QRs auto-assign the scanner to the captain's team.
--
-- A team now exposes a short public `code`: the first 6 hex of its id ("game code + team id
-- fraction"). The full uuid is never exposed. get_game_by_pin returns it per team so the app can
-- resolve ?pin=<PIN>&t=<code> to exactly one team and skip the picker; _state_json returns the
-- player's own team.code so their invite QR can carry it.
-- Matching on the id fragment rather than the name avoids URL-encoding team names with spaces or
-- Lithuanian diacritics, and stays unambiguous when two teams pick similar names.
create or replace function _team_code(p_team uuid) returns text
language sql immutable set search_path = public as $$ select left(replace(p_team::text,'-',''), 6) $$;
-- get_game_by_pin: teams gain 'code'; _state_json: team object gains 'code'.
-- (Full bodies applied via MCP — see 0020 for the rest of _state_json.)
