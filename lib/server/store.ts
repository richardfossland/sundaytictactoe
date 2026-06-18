import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  generateHostCode,
  generatePin,
  generateResumeCode,
  generateUnique,
} from "@/lib/codes";
import type {
  Game,
  Player,
  Round,
  Tournament,
  TournamentConfig,
  TournamentStatus,
} from "@/lib/types";

// Default empty board: classic 3×3 (9 dots). Larger variants pass an explicit
// startFen (lib/ttt/variants.ts variantStartState) when creating games.
const START_FEN = ".........";

/** Postgres unique-constraint violation (concurrent PIN/resume-code/round
 * collisions surface as this and deserve a retry or a graceful response). */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

// Explicit ceiling on "list everything in a tournament" reads. PostgREST applies
// its own `max_rows` cap silently (the 1102-class gotcha: an unfiltered SELECT is
// quietly truncated, and pre-read uniqueness checks then break). One classroom is
// nowhere near this, so hitting it means something is wrong (or the table needs a
// tighter filter) — cap explicitly AND warn so the truncation is never silent.
const LIST_CAP = 1000;
function warnIfCapped(label: string, n: number): void {
  if (n >= LIST_CAP) {
    console.warn(`[store] ${label} returned ${n} rows (>= ${LIST_CAP} cap) — results may be truncated`);
  }
}

export const DEFAULT_CONFIG: TournamentConfig = {
  leagueRounds: 5,
  playoff: false,
  playoffSize: 0,
  roundTimerSec: null,
};

// ---------------- tournaments ----------------

export async function createTournament(
  title: string | null,
  config: TournamentConfig,
  hostUserId: string | null = null,
): Promise<Tournament> {
  const db = createServiceClient();

  // PIN uniqueness is enforced by the DB unique constraint; on a 23505 collision
  // we regenerate and retry. We deliberately do NOT pre-read existing pins:
  // PostgREST's max_rows caps that SELECT at 1000 rows, so once the tournaments
  // table grows (the casual 1v1 feature creates one per game) the pre-read both
  // wastes work AND samples an INCOMPLETE set → it stops preventing collisions
  // and starts causing them. Generate-and-retry against the constraint is correct
  // and O(1). 6-digit space (1e6) makes a collision rare; 8 retries make exhaustion
  // astronomically unlikely.
  const host_code = generateHostCode();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const join_pin = generatePin();
    const { data, error } = await db
      .from("tournaments")
      .insert({
        join_pin,
        host_code,
        host_user_id: hostUserId,
        title,
        status: "lobby",
        config,
        current_round: 0,
      })
      .select("*")
      .single();
    if (!error) return data as Tournament;
    lastError = error;
    if (!isUniqueViolation(error)) break; // only PIN races are retryable
  }
  throw lastError;
}

/** Summary row for the host's "my turnerings" dashboard. */
export interface TournamentSummary {
  id: string;
  title: string | null;
  status: TournamentStatus;
  join_pin: string;
  created_at: string;
  playerCount: number;
}

/** List the tournaments owned by a signed-in host (host_user_id = ownerId),
 * newest first, with a player count per row. Returns [] for an owner who has
 * never created anything while signed in. */
export async function listTournamentsByOwner(
  ownerId: string,
): Promise<TournamentSummary[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("tournaments")
    .select("id, title, status, join_pin, created_at")
    .eq("host_user_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(LIST_CAP);
  if (error) throw error;
  const rows = (data as Omit<TournamentSummary, "playerCount">[]) ?? [];
  warnIfCapped("listTournamentsByOwner", rows.length);

  // Player counts in one round-trip per tournament (a host's own list is small).
  const counts = await Promise.all(
    rows.map(async (t) => {
      const { count } = await db
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", t.id);
      return count ?? 0;
    }),
  );
  return rows.map((t, i) => ({ ...t, playerCount: counts[i] }));
}

/** Delete a tournament ONLY if it is owned by `ownerId`. Returns true when a row
 * was deleted, false when nothing matched (wrong owner, or already gone). The
 * owner filter is the authorization boundary; child rows (players/rounds/games)
 * cascade via the FK `on delete cascade` in the 0001 schema. */
export async function deleteTournamentOwned(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("tournaments")
    .delete()
    .eq("id", id)
    .eq("host_user_id", ownerId)
    .select("id");
  if (error) throw error;
  return ((data as { id: string }[]) ?? []).length > 0;
}

// A transient DB error (timeout / network / 5xx) must NOT look like "no row":
// swallowing it to null makes attemptResume 404 (→ client wipes the session and
// kicks the student) or a move 401. Throw instead, so the route's try/catch
// returns a structured 503 the client treats as transient (keep session, retry).
// `.maybeSingle()` returns {data:null,error:null} for a genuine miss, so this
// only fires on real errors.
export async function getTournament(id: string): Promise<Tournament | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("tournaments").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Tournament) ?? null;
}

export async function getTournamentByPin(pin: string): Promise<Tournament | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("tournaments")
    .select("*")
    .eq("join_pin", pin)
    .maybeSingle();
  if (error) throw error;
  return (data as Tournament) ?? null;
}

export async function openTournamentByHostCode(
  hostCode: string,
): Promise<Tournament | null> {
  const db = createServiceClient();
  // .limit(1): host_code is not unique in the DB, so a collision would make
  // .maybeSingle() error ("multiple rows") and the teacher couldn't reopen.
  // Newest-first + limit(1) returns their most recent tournament deterministically.
  const { data, error } = await db
    .from("tournaments")
    .select("*")
    .eq("host_code", hostCode)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Tournament) ?? null;
}

export async function updateTournament(
  id: string,
  patch: Partial<Pick<Tournament, "status" | "config" | "current_round" | "title">>,
): Promise<Tournament> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("tournaments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Tournament;
}

/** Atomically finish a tournament ONLY if it's still active. Returns the updated
 * row if THIS call did the transition, or null if it was already finished (a
 * concurrent writer won). Lets the auto-finish path collapse a whole class
 * resuming at once into a single effective write + broadcast. */
export async function finishIfActive(id: string): Promise<Tournament | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("tournaments")
    .update({ status: "finished" })
    .eq("id", id)
    .in("status", ["league", "playoff"])
    .select("*")
    .maybeSingle();
  return (data as Tournament) ?? null;
}

// ---------------- players ----------------

export async function listPlayers(tournamentId: string): Promise<Player[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("players")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("joined_at", { ascending: true })
    .limit(LIST_CAP);
  if (error) throw error;
  const rows = (data as Player[]) ?? [];
  warnIfCapped("listPlayers", rows.length);
  return rows;
}

/** The currently smallest team (ties → declared order). JS mirror of the SQL in
 * join_team_player, used as the fallback when migration 0008 isn't applied. */
function smallestTeam(existing: Player[], teams: string[]): string {
  const counts = new Map(teams.map((name) => [name, 0]));
  for (const p of existing) {
    if (p.team && counts.has(p.team)) counts.set(p.team, counts.get(p.team)! + 1);
  }
  return teams.reduce((min, name) =>
    counts.get(name)! < counts.get(min)! ? name : min,
  );
}

export async function addPlayer(
  tournamentId: string,
  displayName: string,
  teams: string[] = [],
): Promise<Player> {
  const db = createServiceClient();
  const existing = await listPlayers(tournamentId);
  const taken = new Set(existing.map((p) => p.resume_code));
  const name = displayName.slice(0, 40);
  const useTeams = teams.length >= 2;
  // Once the RPC proves unavailable (pre-0008), don't keep retrying it.
  let rpcAvailable = useTeams;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const resumeCode = generateUnique(generateResumeCode, taken);
    taken.add(resumeCode);

    // Preferred path for team tournaments: atomic, race-free balanced assignment.
    if (rpcAvailable) {
      const { data, error } = await db.rpc("join_team_player", {
        p_tournament_id: tournamentId,
        p_display_name: name,
        p_resume_code: resumeCode,
        p_teams: teams,
      });
      if (!error) return data as Player;
      lastError = error;
      if (isUniqueViolation(error)) continue; // code collision → new code
      rpcAvailable = false; // RPC missing/older DB → fall back to JS below
    }

    // Fallback (no teams, or RPC not yet migrated): JS balance + plain insert.
    const row: {
      tournament_id: string;
      display_name: string;
      resume_code: string;
      team?: string;
    } = { tournament_id: tournamentId, display_name: name, resume_code: resumeCode };
    if (useTeams) row.team = smallestTeam(existing, teams);

    const { data, error } = await db.from("players").insert(row).select("*").single();
    if (!error) return data as Player;
    lastError = error;
    if (isUniqueViolation(error)) continue; // new code next loop
    if (row.team) {
      // players.team not migrated (pre-0006) → drop team and retry once.
      delete row.team;
      const retry = await db.from("players").insert(row).select("*").single();
      if (!retry.error) return retry.data as Player;
      lastError = retry.error;
      if (isUniqueViolation(retry.error)) continue;
    }
    break; // non-retryable
  }
  throw lastError;
}

export async function getPlayerByResume(
  tournamentId: string,
  resumeCode: string,
): Promise<Player | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("players")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("resume_code", resumeCode)
    .maybeSingle();
  if (error) throw error; // transient → 503, never a false "invalid_code" kick
  return (data as Player) ?? null;
}

export async function getPlayer(id: string): Promise<Player | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("players").select("*").eq("id", id).maybeSingle();
  if (error) throw error; // transient → 503, never a false 401 on a move
  return (data as Player) ?? null;
}

export async function setPlayerSeed(
  playerId: string,
  seed: number,
): Promise<void> {
  const db = createServiceClient();
  await db.from("players").update({ seed }).eq("id", playerId);
}

export async function setPlayerStatus(
  playerId: string,
  status: Player["status"],
): Promise<void> {
  const db = createServiceClient();
  await db.from("players").update({ status }).eq("id", playerId);
}

// ---------------- rounds / games (used from Phase 2/3) ----------------

export async function getRound(id: string): Promise<Round | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("rounds").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Round) ?? null;
}

export async function listRounds(tournamentId: string): Promise<Round[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("rounds")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("number", { ascending: true })
    .limit(LIST_CAP);
  if (error) throw error;
  const rows = (data as Round[]) ?? [];
  warnIfCapped("listRounds", rows.length);
  return rows;
}

export async function createRound(
  tournamentId: string,
  number: number,
  phase: Round["phase"],
  status: Round["status"] = "live",
): Promise<Round> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("rounds")
    .insert({
      tournament_id: tournamentId,
      number,
      phase,
      status,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Round;
}

export async function setRoundStatus(
  roundId: string,
  status: Round["status"],
): Promise<void> {
  const db = createServiceClient();
  await db.from("rounds").update({ status }).eq("id", roundId);
}

export async function setRoundStartedAt(
  roundId: string,
  startedAt: string,
): Promise<void> {
  const db = createServiceClient();
  await db.from("rounds").update({ started_at: startedAt }).eq("id", roundId);
}

/** Atomically add 60s to a round's timer extension (RPC from 0007).
 * Throws when the RPC isn't migrated yet — callers fall back. */
export async function extendRoundRpc(roundId: string): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("extend_round", { p_round_id: roundId });
  if (error) throw error;
  return data as number;
}

export async function listGamesForRound(roundId: string): Promise<Game[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("games")
    .select("*")
    .eq("round_id", roundId)
    .order("updated_at", { ascending: true });
  return (data as Game[]) ?? [];
}

interface NewGame {
  tournamentId: string;
  roundId: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  status?: Game["status"];
  resultSource?: Game["result_source"];
  /** Variant start position; defaults to the standard one. */
  startFen?: string;
  /** Bracket/pairing position within the round (0007). */
  slot?: number;
}

/** Create a game (or a bye when blackPlayerId is null). */
export async function createGame(g: NewGame): Promise<Game> {
  const db = createServiceClient();
  const isBye = g.blackPlayerId === null;
  const row: Record<string, unknown> = {
    tournament_id: g.tournamentId,
    round_id: g.roundId,
    white_player_id: g.whitePlayerId,
    black_player_id: g.blackPlayerId,
    fen: g.startFen ?? START_FEN,
    pgn: "",
    status: g.status ?? (isBye ? "bye" : "live"),
    result_source: g.resultSource ?? (isBye ? "bye" : null),
    turn: "w",
    slot: g.slot ?? 0,
  };
  const { data, error } = await db.from("games").insert(row).select("*").single();
  if (!error) return data as Game;

  // Idempotency hit (migration 0009: at most one live game per round+slot). A
  // double-fired playoff advance / tiebreak-rematch creation lost the race —
  // return the existing game at this slot instead of duplicating. Return the
  // NEWEST row at the slot (full idempotency): a slot can hold an old drawn game
  // plus its live rematch, and the caller wants the current one. Only throw if
  // there is genuinely no row there (i.e. the 23505 was something else).
  if (isUniqueViolation(error)) {
    const existing = await db
      .from("games")
      .select("*")
      .eq("round_id", g.roundId)
      .eq("slot", g.slot ?? 0)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return existing.data as Game;
    throw error;
  }

  // games.slot may not be migrated yet (0007) — retry without it
  delete row.slot;
  const retry = await db.from("games").insert(row).select("*").single();
  if (retry.error) throw error; // surface the ORIGINAL error
  return retry.data as Game;
}

// ---------------- atomic RPCs (migration 0002) ----------------

export interface ApplyMoveArgs {
  gameId: string;
  expectedFen: string;
  newFen: string;
  newPgn: string;
  san: string;
  newTurn: "w" | "b";
  newStatus: Game["status"];
  resultSource: NonNullable<Game["result_source"]>;
  byPlayerId: string;
}

export interface RpcResult {
  ok: boolean;
  conflict?: string;
  ply?: number;
  status?: string;
}

export async function applyMoveRpc(a: ApplyMoveArgs): Promise<RpcResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("apply_move", {
    p_game_id: a.gameId,
    p_expected_fen: a.expectedFen,
    p_new_fen: a.newFen,
    p_new_pgn: a.newPgn,
    p_san: a.san,
    p_new_turn: a.newTurn,
    p_new_status: a.newStatus,
    p_result_source: a.resultSource,
    p_by_player_id: a.byPlayerId,
  });
  if (error) throw error;
  return data as RpcResult;
}

export async function resolveGameRpc(
  gameId: string,
  status: Game["status"],
  resultSource: NonNullable<Game["result_source"]>,
  requireLive = false,
): Promise<RpcResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("resolve_game", {
    p_game_id: gameId,
    p_new_status: status,
    p_result_source: resultSource,
    p_require_live: requireLive,
  });
  if (error) throw error;
  return data as RpcResult;
}

/** Set or clear the pending draw offer on a game (DB-backed, isolate-safe). */
export async function setDrawOffer(
  gameId: string,
  byPlayerId: string | null,
): Promise<void> {
  const db = createServiceClient();
  await db.from("games").update({ draw_offered_by: byPlayerId }).eq("id", gameId);
}

export async function recomputeScores(tournamentId: string): Promise<void> {
  const db = createServiceClient();
  await db.rpc("recompute_scores", { p_tournament_id: tournamentId });
}

export async function listGames(tournamentId: string): Promise<Game[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("games")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("updated_at", { ascending: true })
    .limit(LIST_CAP);
  if (error) throw error;
  const rows = (data as Game[]) ?? [];
  warnIfCapped("listGames", rows.length);
  return rows;
}

export async function getGame(id: string): Promise<Game | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("games").select("*").eq("id", id).maybeSingle();
  if (error) throw error; // transient → 503 on /api/move, not a false "no_game"
  return (data as Game) ?? null;
}


// ---------------- predictions (tippemodus, migration 0005) ----------------
// All prediction helpers degrade gracefully (return/skip) if the predictions
// table hasn't been migrated yet, so the rest of the app never breaks on it.

export type PredictedResult = "white" | "black" | "draw";

export async function upsertPrediction(
  tournamentId: string,
  gameId: string,
  playerId: string,
  predicted: PredictedResult,
): Promise<boolean> {
  const db = createServiceClient();
  const { error } = await db.from("predictions").upsert(
    {
      tournament_id: tournamentId,
      game_id: gameId,
      player_id: playerId,
      predicted,
      correct: null,
    },
    { onConflict: "game_id,player_id" },
  );
  return !error;
}

/** Mark every prediction on a resolved game right/wrong. Draw counts too. */
export async function scorePredictions(
  gameId: string,
  status: Game["status"],
): Promise<void> {
  const map: Partial<Record<Game["status"], PredictedResult>> = {
    white_win: "white",
    black_win: "black",
    draw: "draw",
  };
  const actual = map[status];
  if (!actual) return; // aborted/bye → predictions stay void
  const db = createServiceClient();
  await db
    .from("predictions")
    .update({ correct: false })
    .eq("game_id", gameId)
    .neq("predicted", actual);
  await db
    .from("predictions")
    .update({ correct: true })
    .eq("game_id", gameId)
    .eq("predicted", actual);
}

/** Points per player (1 per correct prediction). Empty if unmigrated. */
export async function predictionPoints(
  tournamentId: string,
): Promise<{ playerId: string; points: number }[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("predictions")
    .select("player_id, correct")
    .eq("tournament_id", tournamentId)
    .eq("correct", true);
  if (error || !data) return [];
  const tally = new Map<string, number>();
  for (const row of data as { player_id: string }[]) {
    tally.set(row.player_id, (tally.get(row.player_id) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([playerId, points]) => ({ playerId, points }))
    .sort((a, b) => b.points - a.points);
}

/** A player's own predictions in a tournament (gameId → predicted). */
export async function listPredictionsForPlayer(
  tournamentId: string,
  playerId: string,
): Promise<Record<string, PredictedResult>> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("predictions")
    .select("game_id, predicted")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId);
  if (error || !data) return {};
  return Object.fromEntries(
    (data as { game_id: string; predicted: PredictedResult }[]).map((r) => [
      r.game_id,
      r.predicted,
    ]),
  );
}

/** The current live (or most recent) game for a player, for resume/waiting. */
export async function currentGameForPlayer(
  tournamentId: string,
  playerId: string,
): Promise<Game | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("games")
    .select("*")
    .eq("tournament_id", tournamentId)
    .or(`white_player_id.eq.${playerId},black_player_id.eq.${playerId}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Game) ?? null;
}

export { START_FEN };
