-- Lagturnering: players carry a team name (from tournaments.config.teams).
-- Assignment happens at join (auto-balanced, smallest team first); team
-- standings are computed, never stored.

alter table tictactoe.players add column if not exists team text;
