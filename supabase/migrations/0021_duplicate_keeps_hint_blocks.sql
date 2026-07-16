-- 0021_duplicate_keeps_hint_blocks.sql — Duplicate silently dropped hint CONTENT.
--
-- Since 0014 a hint's content lives in hints.blocks (jsonb). admin_duplicate was never updated
-- and kept copying only the legacy text/media_type/media_url columns, which are empty for any
-- hint authored after 0014. The copy therefore came out with the right number of hints and the
-- right reveal times, but every hint was blank — easy to miss until a game is run.
-- Real damage: "Kosminis nuotykis real setup (copy)" lost all 71 hints this way (restored by
-- back-filling blocks from the source game, keeping the copy's own edited reveal times).
--
-- e2e now asserts duplicated hints keep their blocks (verified to fail against the old body).
create or replace function admin_duplicate(p_code text, p_game uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $function$
declare v_src games; v_new uuid; v_qid uuid; qr record;
begin
  if not admin_verify(p_code) then return jsonb_build_object('error','forbidden'); end if;
  select * into v_src from games where id = p_game;
  if not found then return jsonb_build_object('error','not_found'); end if;
  insert into games(pin, name, description, status, theme_id, theme, duration_min, max_teams)
    values (gen_pin(), v_src.name || ' (copy)', v_src.description, 'draft', v_src.theme_id, v_src.theme, v_src.duration_min, v_src.max_teams)
    returning id into v_new;
  for qr in select * from questions where game_id = p_game order by ord loop
    insert into questions(game_id, ord, title, intro, info, case_sensitive, location_name, lat, lng, blocks)
      values (v_new, qr.ord, qr.title, qr.intro, qr.info, qr.case_sensitive, qr.location_name, qr.lat, qr.lng, qr.blocks)
      returning id into v_qid;
    insert into question_secrets(question_id, answer, alt_answers)
      select v_qid, answer, alt_answers from question_secrets where question_id = qr.id;
    insert into hints(question_id, ord, reveal_after_min, text, media_type, media_url, blocks)
      select v_qid, ord, reveal_after_min, text, media_type, media_url, blocks from hints where question_id = qr.id;
  end loop;
  return jsonb_build_object('ok', true, 'id', v_new);
end $function$;
