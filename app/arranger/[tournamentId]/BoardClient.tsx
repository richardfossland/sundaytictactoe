"use client";

import { useEffect, useState } from "react";
import { useBoardState } from "@/lib/client/useBoardState";
import { useWakeLock } from "@/lib/client/useWakeLock";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { DiagnosticsModal } from "./DiagnosticsModal";
import { LobbyView } from "./LobbyView";
import { LeagueView } from "./LeagueView";
import { BracketView } from "./BracketView";
import { FinishedView } from "./FinishedView";
import { LiveGamesView } from "./LiveGamesView";
import {
  effectiveHostCode,
  settPresentasjon,
  usePresentasjon,
} from "@/lib/client/storskjerm/usePresentasjon";
import { useHideCursor } from "@/lib/client/storskjerm/useHideCursor";
import { StorskjermButton } from "@/lib/client/storskjerm/StorskjermButton";
import { tekst as storskjermTekst } from "@/lib/client/storskjerm/tekst";
import "@/lib/client/storskjerm/storskjerm.css";

export function BoardClient({ tournamentId }: { tournamentId: string }) {
  const { state, error, failures, refresh } = useBoardState(tournamentId);
  // The host board runs on a projector/TV: never let it dim or sleep.
  useWakeLock();
  // `?visning=tavle`: ren tavle for projektor/TV/cast — ingen vertskontroller.
  const presentasjon = usePresentasjon();
  useHideCursor(presentasjon);
  const [mode, setMode] = useState<"board" | "live">("board");
  // T5 diagnostics: host-code-gated, so the button only appears on the device
  // that actually created this tournament (the code lives in its localStorage).
  const [storedHostCode, setHostCode] = useState<string | null>(null);
  const hostCode = effectiveHostCode(storedHostCode, presentasjon);
  const [showDiag, setShowDiag] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(identity.hostCode(tournamentId));
  }, [tournamentId]);

  // F = fullskjerm i tavlevisning (tastatur på PC/Chromebook koblet til skjermen).
  useEffect(() => {
    if (!presentasjon) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentasjon]);

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

  // I tavlevisning står skjermen uten tilsyn: vis «mistet kontakten» først
  // etter flere mislykkede runder på rad (~15 s), ikke ved hvert lille hikke.
  const visTilkobling = presentasjon ? failures >= 3 : error;

  return (
    <div className={presentasjon ? "presentasjon" : undefined}>
      {visTilkobling && (
        <div
          className="banner banner-wait"
          style={{ position: "fixed", top: 16, left: 20, zIndex: 40, padding: "6px 12px" }}
          role="status"
          aria-live="polite"
        >
          {presentasjon ? storskjermTekst.tavle.tilkobling : no.player.reconnecting}
        </div>
      )}
      {/* One fixed toolbar, not two — the live/board toggle only exists once a
          round is running, the diagnostics button only on the device that holds
          the host code, and neither must leave an empty fixed box behind. */}
      {(liveable || !presentasjon) && (
        <div
          className="row"
          style={{ position: "fixed", top: 16, right: 20, zIndex: 40, gap: 4 }}
        >
          {liveable && (
            <>
              <button
                className={`btn ${mode === "board" ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "8px 14px" }}
                aria-pressed={mode === "board"}
                onClick={() => setMode("board")}
              >
                {no.host.boardToggle}
              </button>
              <button
                className={`btn ${mode === "live" ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "8px 14px" }}
                aria-pressed={mode === "live"}
                onClick={() => setMode("live")}
              >
                ● {no.host.liveToggle}
              </button>
            </>
          )}
          {!presentasjon && <StorskjermButton />}
          {hostCode && (
            <button
              className="btn btn-ghost"
              style={{ padding: "8px 14px" }}
              onClick={() => setShowDiag(true)}
            >
              🩺 {no.diag.open}
            </button>
          )}
        </div>
      )}
      {presentasjon && (
        <button
          className="btn btn-ghost presentasjon-avslutt"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            settPresentasjon(false);
          }}
        >
          {storskjermTekst.tavle.avslutt}
        </button>
      )}
      {view}
      {showDiag && hostCode && (
        <DiagnosticsModal
          tournamentId={tournamentId}
          hostCode={hostCode}
          state={state}
          onClose={() => setShowDiag(false)}
        />
      )}
    </div>
  );
}
