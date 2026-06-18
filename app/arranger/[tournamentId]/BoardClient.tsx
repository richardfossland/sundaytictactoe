"use client";

import { useState } from "react";
import { useBoardState } from "@/lib/client/useBoardState";
import { no } from "@/lib/locale/no";
import { LobbyView } from "./LobbyView";
import { LeagueView } from "./LeagueView";
import { BracketView } from "./BracketView";
import { FinishedView } from "./FinishedView";
import { LiveGamesView } from "./LiveGamesView";

export function BoardClient({ tournamentId }: { tournamentId: string }) {
  const { state, error, refresh } = useBoardState(tournamentId);
  const [mode, setMode] = useState<"board" | "live">("board");

  // Only blank the projector when we have NOTHING to show. A transient fetch
  // error after we already have state must not wipe the live board — keep the
  // last-good view (the 5 s poll + reconnect resync self-heal); a subtle badge
  // signals the hiccup.
  if (error && !state) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack text-center">
          <h2>{no.common.error}</h2>
          <button className="btn btn-primary btn-lg" onClick={() => refresh()}>
            {no.common.retry}
          </button>
        </div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  const status = state.tournament.status;
  const liveable = status === "league" || status === "playoff";

  const view =
    liveable && mode === "live" ? (
      <LiveGamesView
        state={state}
        onStale={refresh}
        onExitLive={() => setMode("board")}
      />
    ) : status === "league" ? (
      <LeagueView state={state} onChanged={refresh} />
    ) : status === "playoff" ? (
      <BracketView state={state} onChanged={refresh} />
    ) : status === "finished" ? (
      <FinishedView state={state} />
    ) : (
      <LobbyView state={state} onChanged={refresh} />
    );

  return (
    <>
      {error && (
        <div
          className="banner banner-wait"
          style={{ position: "fixed", top: 16, left: 20, zIndex: 40, padding: "6px 12px" }}
          role="status"
          aria-live="polite"
        >
          {no.common.loading}
        </div>
      )}
      {liveable && (
        <div
          className="row"
          style={{ position: "fixed", top: 16, right: 20, zIndex: 40, gap: 4 }}
        >
          <button
            className={`btn ${mode === "board" ? "btn-primary" : "btn-ghost"}`}
            style={{ padding: "8px 14px" }}
            onClick={() => setMode("board")}
          >
            {no.host.boardToggle}
          </button>
          <button
            className={`btn ${mode === "live" ? "btn-primary" : "btn-ghost"}`}
            style={{ padding: "8px 14px" }}
            onClick={() => setMode("live")}
          >
            ● {no.host.liveToggle}
          </button>
        </div>
      )}
      {view}
    </>
  );
}
