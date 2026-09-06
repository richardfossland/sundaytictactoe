// Data-transfer shapes returned by the API. Deliberately omit secrets:
// resume_code is a bearer token and must NEVER appear in board/public payloads.

import type {
  Game,
  GameStatus,
  Player,
  ResultSource,
  Tournament,
  TournamentConfig,
  TournamentStatus,
  Turn,
} from "@/lib/types";
import type { StandingRow } from "@/lib/tournament/score";
import { no } from "@/lib/locale/no";

export type { StandingRow };

export interface PublicPlayer {
  id: string;
  displayName: string;
  score: number;
  tiebreak: number;
  status: "active" | "left";
  seed: number | null;
  team: string | null;
}

export interface PublicGame {
  id: string;
  roundId: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  fen: string;
  status: GameStatus;
  turn: Turn;
  /** Present only once the game is decided — feeds replay + awards without a
   * per-game fetch. Live games omit it (don't ship the full history each poll). */
  pgn?: string;
  /** Bracket/pairing position within the round (0 for pre-0007 rows). */
  slot?: number;
  /** Fair-play readout — present only for a DECIDED game (mirrors the same
   * `decided` gate as `pgn`), so the board poll can show a "non-standard
   * result" marker without a separate fetch. "play" means an ordinary
   * completed game; anything else (walkover, teacher_override, timeout_draw,
   * opponent_absent) is worth flagging. Absent/undefined for a live game. */
  resultSource?: ResultSource;
}

export interface BoardState {
  tournament: {
    id: string;
    title: string | null;
    joinPin: string;
    status: TournamentStatus;
    config: TournamentConfig;
    currentRound: number;
  };
  players: PublicPlayer[];
  games: PublicGame[];
  standings: StandingRow[];
  /** Rounds with their numbers/phase/status for the board. */
  rounds: {
    id: string;
    number: number;
    phase: string;
    status: string;
    startedAt: string | null;
    /** Accumulated "+1 min" extensions (ms); timer end = start + dur + this. */
    extendedMs: number;
  }[];
  /** Tipping leaderboard (1 point per correct prediction). Empty/absent until
   * the predictions migration is applied. */
  tipping?: { playerId: string; points: number }[];
}

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    displayName: p.display_name,
    score: Number(p.score),
    tiebreak: Number(p.tiebreak),
    status: p.status,
    seed: p.seed,
    team: p.team ?? null,
  };
}

export function toPublicGame(g: Game): PublicGame {
  const decided =
    g.status === "white_win" || g.status === "black_win" || g.status === "draw";
  return {
    id: g.id,
    roundId: g.round_id,
    whitePlayerId: g.white_player_id,
    blackPlayerId: g.black_player_id,
    fen: g.fen,
    status: g.status,
    turn: g.turn,
    slot: g.slot ?? 0,
    ...(decided && g.pgn ? { pgn: g.pgn } : {}),
    ...(decided && g.result_source ? { resultSource: g.result_source } : {}),
  };
}

/** Short marker text for a fair-play `resultSource` ("" for ordinary "play",
 * a live game's `undefined`/`null`, or an unmapped value). Pure — a lookup
 * into `no.host.resultSourceLabel`, kept here so it can't drift from the
 * `ResultSource` union and so both LeagueView and FinishedView share one
 * mapping. */
export function resultSourceLabel(source: ResultSource | null | undefined): string {
  if (!source || source === "play") return "";
  return no.host.resultSourceLabel[source] ?? "";
}

export interface GameDetail {
  id: string;
  tournamentId: string;
  roundId: string;
  fen: string;
  pgn: string;
  status: GameStatus;
  turn: Turn;
  white: { id: string; name: string };
  black: { id: string; name: string } | null;
  /** the cell index played last (for highlight), or null */
  lastMove: { cell: number } | null;
  /** Player id with a pending draw offer (null = none) — lets clients
   * self-heal stuck offer banners on poll/focus resync. */
  drawOfferedBy?: string | null;
}

/** One client-telemetry event as the host diagnostics modal sees it (T5, port
 * of sundaychess#87). Deliberately carries NO name — the modal joins `playerId`
 * against the board state it already has, so the roster never travels with the
 * log. */
export interface DiagnosticsEvent {
  id: number;
  /** ISO timestamp from the database. */
  at: string;
  kind: string;
  playerId: string | null;
  gameId: string | null;
  detail: Record<string, unknown>;
  /** Per-page-load correlation token (random, meaningless on its own). */
  sid: string | null;
  /** "mobile" | "desktop" — a class, never a user-agent string. */
  uaClass: string | null;
}

/** POST /api/tournament/[id]/diagnostics. `unavailable` means migration 0012
 * has not been run yet: an answer, not an error. */
export interface DiagnosticsResult {
  events: DiagnosticsEvent[];
  counts:
    | { byKind: Record<string, number>; byPlayer: Record<string, number> }
    | Record<string, never>;
  unavailable?: boolean;
}

export function toBoardTournament(t: Tournament) {
  // `notes` is the teacher's private note to self — this DTO backs the
  // UNAUTHENTICATED, 5s-polled GET /api/tournament/[id], read by every
  // student's device as well as the host projector. Strip it here (the one
  // seam every caller goes through) rather than trusting each call site to
  // remember not to show it. `config.notes` being optional means the object
  // without it still satisfies `TournamentConfig` below.
  const publicConfig: TournamentConfig = { ...t.config };
  delete publicConfig.notes;
  return {
    id: t.id,
    title: t.title,
    joinPin: t.join_pin,
    status: t.status,
    config: publicConfig,
    currentRound: t.current_round,
  };
}
