"use client";

// Thin typed fetch wrappers around the server API. All mutations go through
// these; the browser never touches the database directly.

import type { BoardState, GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public payload: unknown,
  ) {
    super(code);
  }
}

const DEFAULT_TIMEOUT = 8000;

/** fetch + JSON parse under ONE hard timeout — a hung request must never freeze
 * the UI. CRUCIAL: the timeout spans BOTH the fetch AND reading the response
 * body, because a flaky/slow network can deliver headers and then stall the body
 * stream — leaving `await res.json()` hung forever (which previously wedged the
 * optimistic-move `pending` flag and froze the board). On timeout/abort or a
 * network failure this throws ApiError(0, "timeout"|"network") so every caller
 * settles. Exported for tests. */
export async function timedJson(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    // Body read is still covered by `ctrl`: aborting cancels an in-flight
    // res.json() too. Tolerate an empty/non-JSON body (→ {}), but a timeout/abort
    // during the body read MUST propagate so it surfaces as ApiError("timeout")
    // rather than a fake-empty success.
    const data = await res.json().catch((e) => {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      return {};
    });
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(0, aborted ? "timeout" : "network", null);
  } finally {
    clearTimeout(t); // only after the body is read (or aborted) — never earlier
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const { ok, status, data } = await timedJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!ok) {
    const code = (data as { error?: string } | null)?.error ?? "error";
    throw new ApiError(status, code, data);
  }
  return data as T;
}

async function getJson<T>(url: string, code: string): Promise<T> {
  const { ok, status, data } = await timedJson(url, { cache: "no-store" });
  if (!ok) throw new ApiError(status, code, null);
  return data as T;
}

export interface CreatedTournament {
  id: string;
  joinPin: string;
  hostCode: string;
}

export interface JoinResult {
  tournamentId: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
}

export interface ResumeResult {
  tournamentId: string;
  playerId: string;
  displayName: string;
  tournamentStatus: string;
}

export interface CasualCreated {
  tournamentId: string;
  joinPin: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
}

export interface CasualJoined {
  tournamentId: string;
  playerId: string;
  resumeCode: string;
  displayName: string;
  gameId: string;
}

export const api = {
  createTournament: (body: { title?: string; config?: unknown }) =>
    post<CreatedTournament>("/api/tournament", body),

  openHost: (hostCode: string) =>
    post<{ id: string }>("/api/tournament/open", { hostCode }),

  join: (pin: string, displayName: string) =>
    post<JoinResult>("/api/join", { pin, displayName }),

  createCasual: (name: string) =>
    post<CasualCreated>("/api/casual", { name }),

  joinCasual: (pin: string, name: string) =>
    post<CasualJoined>("/api/casual/join", { pin, name }),

  rematchCasual: (tournamentId: string, playerId: string, resumeCode: string) =>
    post<{ gameId: string }>("/api/casual/rematch", {
      tournamentId,
      playerId,
      resumeCode,
    }),

  resume: (resumeCode: string, ref: { pin?: string; tournamentId?: string }) =>
    post<ResumeResult>("/api/resume", { resumeCode, ...ref }),

  board: (id: string) =>
    getJson<BoardState>(`/api/tournament/${id}`, "board_failed"),

  game: (id: string) => getJson<GameDetail>(`/api/game/${id}`, "game_failed"),

  move: (args: {
    gameId: string;
    cell: number;
    playerId: string;
    resumeCode: string;
  }) =>
    post<{
      fen: string;
      turn: Turn;
      status: GameStatus;
      san: string;
    }>("/api/move", args),

  resign: (gameId: string, playerId: string, resumeCode: string) =>
    post<{ status: GameStatus }>("/api/game/resign", {
      gameId,
      playerId,
      resumeCode,
    }),

  draw: (
    gameId: string,
    playerId: string,
    resumeCode: string,
    action: "offer" | "accept" | "decline",
  ) => post<unknown>("/api/game/draw", { gameId, playerId, resumeCode, action }),

  predict: (
    playerId: string,
    resumeCode: string,
    gameId: string,
    predicted: "white" | "black" | "draw",
  ) =>
    post<{ predicted: string }>("/api/predict", {
      playerId,
      resumeCode,
      gameId,
      predicted,
      action: "tip",
    }),

  myPredictions: (playerId: string, resumeCode: string) =>
    post<{ predictions: Record<string, "white" | "black" | "draw"> }>(
      "/api/predict",
      { playerId, resumeCode, action: "list" },
    ),

  // ---- teacher actions (authenticated by host code) ----
  startRound: (tournamentId: string, hostCode: string) =>
    post<{ status: string }>("/api/round/start", { tournamentId, hostCode }),

  advanceRound: (
    tournamentId: string,
    hostCode: string,
    tiebreak?: "rematch" | "ranking",
  ) =>
    post<{ status: string }>("/api/round/advance", {
      tournamentId,
      hostCode,
      ...(tiebreak ? { tiebreak } : {}),
    }),

  forceResolve: (tournamentId: string, hostCode: string) =>
    post<{ ok: boolean }>("/api/round/force", { tournamentId, hostCode }),

  extendRound: (tournamentId: string, hostCode: string) =>
    post<{ extendedMs: number | null }>("/api/round/extend", { tournamentId, hostCode }),

  override: (gameId: string, hostCode: string, result: GameStatus) =>
    post<{ status: GameStatus }>("/api/game/override", {
      gameId,
      hostCode,
      result,
    }),

  absent: (
    gameId: string,
    hostCode: string,
    absentPlayerId: string,
    scope: "round" | "tournament",
  ) =>
    post<{ status: GameStatus }>("/api/game/absent", {
      gameId,
      hostCode,
      absentPlayerId,
      scope,
    }),

  codes: (tournamentId: string, hostCode: string) =>
    post<{ players: { playerId: string; name: string; resumeCode: string }[] }>(
      `/api/tournament/${tournamentId}/codes`,
      { hostCode },
    ),

  kick: (tournamentId: string, hostCode: string, playerId: string) =>
    post<{ ok: boolean }>("/api/lobby/kick", { tournamentId, hostCode, playerId }),
};
