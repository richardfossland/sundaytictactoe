-- Atomic, balanced team assignment at join.
--
-- addPlayer() previously read team counts in one statement and inserted the
-- player in another, so two concurrent joins could read identical counts and
-- pick the SAME team — skewing balance (e.g. 6–4 instead of 5–5) whenever a
-- class taps "join" together. join_team_player() chooses the smallest team and
-- inserts in a single call, serialised per-tournament by a transaction-scoped
-- advisory lock, so concurrent joins can no longer collide on team selection.
--
-- Resume-code uniqueness (tournament_id, resume_code) is still enforced by the
-- table constraint; the caller regenerates + retries on 23505. The app keeps a
-- JS fallback for when this migration has not been applied yet, so deploy order
-- between code and DB does not matter.

create or replace function tictactoe.join_team_player(
  p_tournament_id uuid,
  p_display_name  text,
  p_resume_code   text,
  p_teams         text[]
) returns tictactoe.players
language plpgsql
as $$
declare
  chosen text := null;
  rec tictactoe.players%rowtype;
begin
  -- Serialise team-balance decisions for THIS tournament. The lock is released
  -- at commit, so the next concurrent join sees this player's committed row when
  -- it recomputes the counts. Different tournaments never block each other.
  perform pg_advisory_xact_lock(hashtextextended(p_tournament_id::text, 0));

  if coalesce(array_length(p_teams, 1), 0) >= 2 then
    select t.name into chosen
    from unnest(p_teams) with ordinality as t(name, ord)
    left join tictactoe.players p
      on p.tournament_id = p_tournament_id
     and p.team = t.name
    group by t.name, t.ord
    order by count(p.id) asc, t.ord asc   -- smallest team; ties → declared order
    limit 1;
  end if;

  insert into tictactoe.players (tournament_id, display_name, resume_code, team)
  values (p_tournament_id, left(p_display_name, 40), p_resume_code, chosen)
  returning * into rec;

  return rec;
end;
$$;
