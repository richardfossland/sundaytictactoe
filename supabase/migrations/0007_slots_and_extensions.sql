-- 0007: bracket slot order + atomic round-timer extensions.
--
-- games.slot: the bracket/pairing position a game was created at. Without it,
-- advancePlayoff read games ordered by updated_at (which changes as games
-- resolve), so out-of-order finishes scrambled single-elimination pairing.
--
-- rounds.extended_ms + extend_round(): the organizer's "+1 min" used to shift
-- rounds.started_at forward — but started_at is also the chess clocks' t0, so
-- shifting it ERASED time the players had already used. The extension now
-- lives in its own column (round end = started_at + duration + extended_ms)
-- and the RPC increments it atomically (a double-click adds 2 minutes, not 1).

alter table tictactoe.games  add column if not exists slot int not null default 0;
alter table tictactoe.rounds add column if not exists extended_ms int not null default 0;

create or replace function tictactoe.extend_round(p_round_id uuid)
returns int
language sql
as $$
  update tictactoe.rounds
     set extended_ms = extended_ms + 60000
   where id = p_round_id
   returning extended_ms;
$$;

notify pgrst, 'reload schema';
