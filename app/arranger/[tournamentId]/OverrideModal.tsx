"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import type { GameStatus } from "@/lib/types";

interface Side {
  id: string;
  name: string;
}

/** Teacher result-override + "player absent → walkover" dialog, shared by the
 * league grid and the bracket. */
export function OverrideModal({
  gameId,
  hostCode,
  white,
  black,
  onClose,
  onDone,
  allowAbort = true,
}: {
  gameId: string;
  hostCode: string;
  white: Side;
  black: Side | null;
  onClose: () => void;
  onDone: () => void;
  allowAbort?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"round" | "tournament">("round");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch {
      setError(no.common.error);
      setBusy(false);
    }
  }

  const setResult = (r: GameStatus) => run(() => api.override(gameId, hostCode, r));
  const markAbsent = (playerId: string) =>
    run(() => api.absent(gameId, hostCode, playerId, scope));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 50,
      }}
    >
      <div
        className="card stack scale-in card-narrow"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 20 }}>{no.host.overrideTitle}</h3>
        <p className="muted">
          {white.name} {no.player.vs} {black?.name ?? no.host.bye}
        </p>

        <p className="eyebrow">{no.host.setResult}</p>
        <button className="btn btn-block" disabled={busy} onClick={() => setResult("white_win")}>
          {white.name} ✓
        </button>
        {black && (
          <button className="btn btn-block" disabled={busy} onClick={() => setResult("black_win")}>
            {black.name} ✓
          </button>
        )}
        <button className="btn btn-block" disabled={busy} onClick={() => setResult("draw")}>
          {no.host.draw}
        </button>
        {allowAbort && (
          <button className="btn btn-danger btn-block" disabled={busy} onClick={() => setResult("aborted")}>
            {no.host.abort}
          </button>
        )}

        {black && (
          <>
            <hr className="thread" />
            <p className="eyebrow">{no.host.absentTitle}</p>
            <div className="row" style={{ gap: 6 }}>
              <button
                className={`btn grow ${scope === "round" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setScope("round")}
              >
                {no.host.absentRound}
              </button>
              <button
                className={`btn grow ${scope === "tournament" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setScope("tournament")}
              >
                {no.host.absentTournament}
              </button>
            </div>
            <button className="btn btn-block" disabled={busy} onClick={() => markAbsent(white.id)}>
              {white.name} {no.host.absentSuffix}
            </button>
            <button className="btn btn-block" disabled={busy} onClick={() => markAbsent(black.id)}>
              {black.name} {no.host.absentSuffix}
            </button>
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          {no.common.cancel}
        </button>
      </div>
    </div>
  );
}
