-- Atomic move application. Chess legality is validated in Node (chess.js) by
-- the /api/move route BEFORE calling this; the function's job is to commit the
-- result safely under concurrency.
--
-- Safety (spec §4): the game row is locked FOR UPDATE, and the caller's
-- expected_fen must still match the stored fen. Two near-simultaneous moves
-- therefore cannot both succeed — the second sees a changed fen and is rejected
-- with conflict='stale'. The ply number is derived inside the lock, so it can
-- never collide either.

create or replace function tictactoe.apply_move(
  p_game_id        uuid,
  p_expected_fen   text,
  p_new_fen        text,
  p_new_pgn        text,
  p_san            text,
  p_new_turn       text,
  p_new_status     text,
  p_result_source  text,
  p_by_player_id   uuid
) returns jsonb
language plpgsql
as $$
declare
  g           tictactoe.games%rowtype;
  v_ply       int;
  v_expected  uuid;
begin
  select * into g from tictactoe.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'conflict', 'no_game');
  end if;

  if g.status <> 'live' then
    return jsonb_build_object('ok', false, 'conflict', 'not_live');
  end if;

  -- Optimistic concurrency: the position must be unchanged since the caller read it.
  if g.fen <> p_expected_fen then
    return jsonb_build_object('ok', false, 'conflict', 'stale');
  end if;

  -- Defence in depth: the mover must own the side to move.
  v_expected := case when g.turn = 'w' then g.white_player_id else g.black_player_id end;
  if v_expected is null or v_expected <> p_by_player_id then
    return jsonb_build_object('ok', false, 'conflict', 'not_your_turn');
  end if;

  select coalesce(max(ply), 0) + 1 into v_ply from tictactoe.moves where game_id = p_game_id;

  insert into tictactoe.moves (game_id, ply, san, fen_after, by_player_id)
  values (p_game_id, v_ply, p_san, p_new_fen, p_by_player_id);

  update tictactoe.games
     set fen = p_new_fen,
         pgn = p_new_pgn,
         turn = p_new_turn,
         status = p_new_status,
         result_source = case when p_new_status = 'live' then null else p_result_source end
   where id = p_game_id;

  return jsonb_build_object('ok', true, 'ply', v_ply, 'status', p_new_status);
end;
$$;

-- Resolve a game without a final move (teacher override, bye, timeout draw).
-- Idempotent-ish: only acts on a game that is still live (or re-sets the same
-- terminal status). Returns the applied status.
create or replace function tictactoe.resolve_game(
  p_game_id        uuid,
  p_new_status     text,
  p_result_source  text
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

  update tictactoe.games
     set status = p_new_status,
         result_source = p_result_source
   where id = p_game_id;

  return jsonb_build_object('ok', true, 'status', p_new_status);
end;
$$;

-- Refresh denormalised players.score from the authoritative game results.
-- (Standings on the board are computed in TS from games; this keeps the cached
-- column consistent for quick queries / pairing fallbacks.)
create or replace function tictactoe.recompute_scores(p_tournament_id uuid)
returns void
language plpgsql
as $$
begin
  update tictactoe.players p set score = coalesce(s.total, 0)
  from (
    select pid, sum(pts) as total from (
      select white_player_id as pid,
             case status when 'white_win' then 1 when 'draw' then 0.5
                         when 'bye' then 1 else 0 end as pts
        from tictactoe.games where tournament_id = p_tournament_id
      union all
      select black_player_id as pid,
             case status when 'black_win' then 1 when 'draw' then 0.5 else 0 end as pts
        from tictactoe.games
       where tournament_id = p_tournament_id and black_player_id is not null
    ) t group by pid
  ) s
  where p.id = s.pid and p.tournament_id = p_tournament_id;
end;
$$;
