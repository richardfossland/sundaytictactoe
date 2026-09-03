"use client";

import { useCallback, useEffect, useState } from "react";
import type { BoardState } from "@/lib/dto";
import { api, ApiError } from "@/lib/client/api";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import { useTabHidden } from "@/lib/client/useTabHidden";
import { sameJson } from "@/lib/client/equal";

/** Fetch authoritative board state on mount, keep it fresh by refetching on any
 * lobby-channel event, and expose a manual refresh. Used by both the host board
 * and the student client (reads are public — no secrets in board state). */
export function useBoardState(tournamentId: string | null) {
  const [state, setState] = useState<BoardState | null>(null);
  const [error, setError] = useState(false);
  // The HTTP status behind `error` (0 = network/timeout, i.e. never reached the
  // server). Callers need it to tell "this tournament is gone" (our own 404)
  // from a transient blip — a distinction `error: boolean` can't carry.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  // …and WHO said it. A status alone is not a verdict: an HTML 404 from the
  // edge arrives here as status 404 with the caller's fallback tag
  // ("board_failed"), never our own "not_found". Callers that act on a 404 must
  // check both. null when the failure wasn't an ApiError at all.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Consecutive failed refreshes in a row — reset to 0 the moment one succeeds.
  // Callers use this to escalate a "reconnecting" badge (R7) without needing
  // their own counter.
  const [failures, setFailures] = useState(0);

  const refresh = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const next = await api.board(tournamentId);
      // L5 (port of sundaychess#84): keep the PREVIOUS object when the board
      // is byte-identical. This poll fires every 5 s and used to hand every
      // consumer a new `state` reference each time — in the player app that
      // re-rendered WaitingRoom and, with it, the whole live board.
      // BoardState is a few KB of plain JSON straight off the wire, so
      // `JSON.stringify` equality is far cheaper than the render it prevents
      // (see lib/client/equal.ts). `error`/`errorStatus`/`errorCode`/
      // `failures` are untouched below: they already carry primitive values,
      // so React bails out on its own when they are reset to the same value.
      setState((prev) => (sameJson(prev, next) ? prev : next));
      setError(false);
      setErrorStatus(null);
      setErrorCode(null);
      setFailures(0);
    } catch (e) {
      // Keep the previous `state`: a failed poll must not blank a live board.
      setError(true);
      setErrorStatus(e instanceof ApiError ? e.status : 0);
      setErrorCode(e instanceof ApiError ? e.code : null);
      setFailures((n) => n + 1);
    }
  }, [tournamentId]);

  useEffect(() => {
    // Fetch-on-mount: setState happens asynchronously after the await, in the
    // fetch callback — the intended use of an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  useChannel(
    tournamentId ? channels.lobby(tournamentId) : null,
    () => {
      refresh();
    },
    (s) => {
      // Lobby broadcasts silently stopped → refetch the board immediately.
      // CLOSED included: channelRegistry recreates the channel itself in the
      // background (R11), but the broadcast that channel drop may have
      // swallowed still needs this immediate catch-up fetch.
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") refresh();
    },
  );

  // Reconnect hardening: re-sync when the tab regains focus or the network
  // comes back (a missed broadcast is recovered here).
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [refresh]);

  // Poll backstop for missed broadcasts (round started, game resolved, etc.).
  // Slower while the tab is hidden rather than skipped outright (R11): a
  // backgrounded tab whose channel silently died would otherwise only heal on
  // the immediate visibilitychange→visible refresh above, which itself relies
  // on the tab actually being reopened — this bounds the staleness even if it
  // never is (a projector tab left on another workspace, say).
  const hidden = useTabHidden();
  useEffect(() => {
    if (!tournamentId) return;
    const id = setInterval(refresh, hidden ? 30000 : 5000);
    return () => clearInterval(id);
  }, [tournamentId, refresh, hidden]);

  return { state, error, errorStatus, errorCode, failures, refresh };
}
