import "server-only";

import {
  createGame,
  createRound,
  listGames,
  listGamesForRound,
  listPlayers,
  listRounds,
  setPlayerSeed,
  setRoundStatus,
  updateTournament,
} from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { computeStandings } from "@/lib/tournament/score";
import {
  buildFirstRound,
  cupBracketSize,
  effectivePlayoffSize,
  type SeededPlayer,
} from "@/lib/tournament/bracket";
import { variantById, variantStartState } from "@/lib/ttt/variants";
import type { Game, Tournament } from "@/lib/types";

/** Winner of a resolved game, or null if it has no decisive winner (draw /
 * aborted). A bye advances its player (cup first rounds when the field isn't a
 * power of two). Drawn playoff games are resolved by advancePlayoff (tiebreak
 * rematch, then draw-odds), not here. */
function winnerOf(g: Game): string | null {
  if (g.status === "white_win") return g.white_player_id;
  if (g.status === "black_win") return g.black_player_id;
  if (g.status === "bye") return g.white_player_id;
  return null;
}

function currentPlayoffRound(rounds: { number: number; phase: string; id: string }[], n: number) {
  return rounds.find((r) => r.phase === "playoff" && r.number === n);
}

/** Seed top N by (score, Buchholz), build the first single-elim round, create
 * its games. Returns true when a bracket was started. */
export async function maybeStartPlayoff(
  tournament: Tournament,
): Promise<boolean> {
  if (!tournament.config.playoff) return false;

  const [players, games] = await Promise.all([
    listPlayers(tournament.id),
    listGames(tournament.id),
  ]);
  const active = players.filter((p) => p.status === "active");
  const size = effectivePlayoffSize(tournament.config.playoffSize, active.length);
  if (size === 0) return false;

  const standings = computeStandings(active, games);
  const top = standings.slice(0, size);

  const seeded: SeededPlayer[] = top.map((s, i) => ({
    playerId: s.playerId,
    seed: i + 1,
  }));
  await Promise.all(seeded.map((s) => setPlayerSeed(s.playerId, s.seed)));

  const matches = buildFirstRound(seeded);
  const round = await createRound(tournament.id, 1, "playoff", "live");
  const startFen = variantStartState(variantById(tournament.config.variant));
  for (const m of matches) {
    if (!m.topPlayerId || !m.bottomPlayerId) continue;
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: m.topPlayerId,
      blackPlayerId: m.bottomPlayerId,
      startFen,
      slot: m.slot, // bracket position — advance pairs slot-adjacent winners
    });
  }

  await updateTournament(tournament.id, { status: "playoff", current_round: 1 });
  return true;
}

/** Cup mode: straight to the knockout — EVERY active player enters. Seeding is
 * shuffled (no standings exist yet); when the field isn't a power of two, the
 * top of the bracket gets first-round byes. */
export async function startCup(tournament: Tournament): Promise<void> {
  const players = await listPlayers(tournament.id);
  const active = players.filter((p) => p.status === "active");
  const size = cupBracketSize(active.length);
  if (size === 0) throw new Error("not_enough_players");

  // Fisher–Yates shuffle — fair, fun seeding for a fresh cup.
  const order = [...active];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const seeded: SeededPlayer[] = order
    .slice(0, size)
    .map((p, i) => ({ playerId: p.id, seed: i + 1 }));
  await Promise.all(seeded.map((s) => setPlayerSeed(s.playerId, s.seed)));

  const matches = buildFirstRound(seeded, size);
  const round = await createRound(tournament.id, 1, "playoff", "live");
  const startFen = variantStartState(variantById(tournament.config.variant));
  for (const m of matches) {
    if (!m.topPlayerId) continue; // can't happen (top seeds always present)
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: m.topPlayerId,
      blackPlayerId: m.bottomPlayerId, // null → bye, auto-advances
      startFen,
      slot: m.slot,
    });
  }

  await updateTournament(tournament.id, { status: "playoff", current_round: 1 });
  await broadcast(channels.lobby(tournament.id), events.tournament, {
    started: true,
    cup: true,
  });
}

/** Every game in the current playoff round is resolved (decisive or not). */
export async function playoffRoundResolved(
  tournament: Tournament,
): Promise<boolean> {
  const rounds = await listRounds(tournament.id);
  const cur = currentPlayoffRound(rounds, tournament.current_round);
  if (!cur) return false;
  const games = await listGamesForRound(cur.id);
  return games.length > 0 && games.every((g) => g.status !== "live");
}

/** Advance the bracket. A drawn game never stalls it. By default the first draw
 * at a bracket slot spawns ONE tiebreak rematch (colours swapped) in the same
 * round and slot; if that rematch is also drawn, the higher seed advances
 * (draw-odds). With `resolveDrawsBySeed`, a first draw skips the rematch and the
 * higher seed advances immediately (the teacher's "send høyest rangert videre"
 * choice). Returns "tiebreak" when it created rematches (the round keeps playing
 * — advance again once they finish), else "playoff"/"finished". The teacher can
 * still override any game manually as an escape hatch. */
export async function advancePlayoff(
  tournament: Tournament,
  opts: { resolveDrawsBySeed?: boolean } = {},
): Promise<"playoff" | "finished" | "tiebreak"> {
  const rounds = await listRounds(tournament.id);
  const cur = currentPlayoffRound(rounds, tournament.current_round);
  if (!cur) throw new Error("no_playoff_round");

  const [roundGames, players] = await Promise.all([
    listGamesForRound(cur.id),
    listPlayers(tournament.id),
  ]);
  const seedOf = (id: string) =>
    players.find((p) => p.id === id)?.seed ?? Number.MAX_SAFE_INTEGER;

  // Group games by bracket slot. A slot holds the original game and, if it was
  // drawn, one tiebreak rematch (both carry the same slot).
  const bySlot = new Map<number, Game[]>();
  for (const g of roundGames) {
    const s = g.slot ?? 0;
    const list = bySlot.get(s);
    if (list) list.push(g);
    else bySlot.set(s, [g]);
  }
  const slots = [...bySlot.keys()].sort((a, b) => a - b); // slot order = bracket

  const winners: string[] = [];
  const tiebreaks: { slot: number; white: string; black: string }[] = [];

  for (const s of slots) {
    const slotGames = bySlot.get(s)!;
    const decisive = slotGames.find((g) => winnerOf(g) !== null);
    if (decisive) {
      winners.push(winnerOf(decisive)!);
      continue;
    }
    // No winner at this slot — every game here drew (or aborted).
    const orig = slotGames[0];
    const white = orig.white_player_id;
    const black = orig.black_player_id;
    if (!black) {
      winners.push(white); // a bye is decisive; guard defensively
    } else if (slotGames.length >= 2 || opts.resolveDrawsBySeed) {
      // Either the rematch ALSO drew, or the teacher chose to skip the rematch →
      // draw-odds: the higher seed (lower number) advances.
      winners.push(seedOf(white) <= seedOf(black) ? white : black);
    } else {
      tiebreaks.push({ slot: s, white: black, black: white }); // swap colours
    }
  }

  // Matchups still to be settled → spawn the rematches and keep the round live;
  // the bracket advances on the next pass once they finish.
  if (tiebreaks.length > 0) {
    const tieFen = variantStartState(variantById(tournament.config.variant));
    for (const tb of tiebreaks) {
      await createGame({
        tournamentId: tournament.id,
        roundId: cur.id,
        whitePlayerId: tb.white,
        blackPlayerId: tb.black,
        startFen: tieFen,
        slot: tb.slot,
      });
    }
    await broadcast(channels.lobby(tournament.id), events.tournament, {
      tiebreak: true,
      playoffRound: tournament.current_round,
    });
    return "tiebreak";
  }

  await setRoundStatus(cur.id, "done");

  // Final decided → champion is the lone winner.
  if (winners.length === 1) {
    await updateTournament(tournament.id, { status: "finished" });
    await broadcast(channels.lobby(tournament.id), events.tournament, {
      finished: true,
      champion: winners[0],
    });
    return "finished";
  }

  // Pair adjacent winners (preserves bracket structure from seedOrder).
  const nextNumber = tournament.current_round + 1;
  const round = await createRound(tournament.id, nextNumber, "playoff", "live");
  const startFen = variantStartState(variantById(tournament.config.variant));
  for (let i = 0; i < winners.length; i += 2) {
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: winners[i],
      blackPlayerId: winners[i + 1],
      startFen,
      slot: i / 2,
    });
  }
  await updateTournament(tournament.id, { current_round: nextNumber });
  await broadcast(channels.lobby(tournament.id), events.tournament, {
    playoffRound: nextNumber,
  });
  return "playoff";
}
