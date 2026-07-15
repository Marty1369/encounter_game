-- 0004_hardening.sql — pin search_path on every function (fixes advisor
-- function_search_path_mutable) and explicitly lock internal helpers to the owner.
-- Includes 'extensions' because pgcrypto (crypt/gen_salt) lives there on Supabase.

alter function normalize_answer(text)                 set search_path = public, extensions;
alter function _resolve_session(uuid)                 set search_path = public, extensions;
alter function _state_json(teams, games)              set search_path = public, extensions;
alter function register_team(text)                    set search_path = public, extensions;
alter function get_state(uuid)                        set search_path = public, extensions;
alter function submit_answer(uuid, text, uuid)        set search_path = public, extensions;
alter function mark_hint_revealed(uuid, uuid)         set search_path = public, extensions;
alter function admin_verify(text)                     set search_path = public, extensions;
alter function admin_board(text)                      set search_path = public, extensions;
alter function admin_skip(text, uuid)                 set search_path = public, extensions;
alter function admin_reset(text, uuid)                set search_path = public, extensions;
alter function admin_extend(text, int)                set search_path = public, extensions;
alter function admin_new_game(text, int)              set search_path = public, extensions;

-- Belt-and-suspenders: internal helpers & the passcode oracle are never a public API.
revoke all on function _resolve_session(uuid)   from anon, authenticated;
revoke all on function _state_json(teams,games) from anon, authenticated;
revoke all on function admin_verify(text)       from anon, authenticated;
