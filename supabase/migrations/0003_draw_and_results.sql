-- Draw correctness + walkover result sources.
--
-- (1) Move the pending draw offer into the DB so it is consistent across
--     Cloudflare Worker isolates (the old in-memory store was per-isolate).
-- (2) Guard resolve_game so player-initiated results (draw accept, resign,
--     walkover) only apply while the game is still live — preventing a draw
--     from overwriting an already-decided game.
-- (3) Allow 'walkover' / 'opponent_absent' result sources.

alter table tictactoe.games add column if not exists draw_offered_by uuid;

-- Widen the result_source CHECK.
alter table tictactoe.games drop constraint if exists games_result_source_check;
alter table tictactoe.games
  add constraint games_result_source_check
  check (
    result_source in (
      'play', 'teacher_override', 'bye', 'timeout_draw', 'walkover', 'opponent_absent'
    )
  );

-- resolve_game gains p_require_live (DEFAULT false → backward compatible with
-- any 3-arg callers still deployed). Also clears any pending draw offer.
drop function if exists tictactoe.resolve_game(uuid, text, text);

create or replace function tictactoe.resolve_game(
  p_game_id        uuid,
  p_new_status     text,
  p_result_source  text,
  p_require_live    boolean default false
) returns jsonb
language plpgsql
as $$
declare
  g tictactoe.games%rowtype;
begin
  select * into g from tictactoe.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'no_game');
  end if;

  -- Player-initiated resolutions must not overwrite a finished game.
  if p_require_live and g.status <> 'live' then
    return jsonb_build_object('ok', false, 'conflict', 'not_live');
  end if;

  update tictactoe.games
     set status = p_new_status,
         result_source = p_result_source,
         draw_offered_by = null
   where id = p_game_id;

  return jsonb_build_object('ok', true, 'status', p_new_status);
end;
$$;
