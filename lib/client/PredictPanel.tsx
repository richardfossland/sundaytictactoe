"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState } from "@/lib/dto";
import type { StoredPlayer } from "@/lib/client/identity";
import { api, ApiError } from "@/lib/client/api";
import { no } from "@/lib/locale/no";

type Pick = "white" | "black" | "draw";

/** Tipping panel for waiting players: predict live games you're not in.
 * Hides itself entirely if the predictions backend isn't available. */
export function PredictPanel({
  me,
  state,
}: {
  me: StoredPlayer;
  state: BoardState;
}) {
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [unavailable, setUnavailable] = useState(false);

  // games I can tip: live, real opponent, and not my own
  const tippable = useMemo(
    () =>
      state.games.filter(
        (g) =>
          g.status === "live" &&
          g.blackPlayerId &&
          g.whitePlayerId !== me.playerId &&
          g.blackPlayerId !== me.playerId,
      ),
    [state.games, me.playerId],
  );

  const nameById = useMemo(() => {
    const m = new Map(state.players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : "?");
  }, [state.players]);

  useEffect(() => {
    api
      .myPredictions(me.playerId, me.resumeCode)
      .then((r) => setPicks(r.predictions))
      .catch(() => {});
  }, [me.playerId, me.resumeCode]);

  const myPoints =
    state.tipping?.find((t) => t.playerId === me.playerId)?.points ?? 0;

  if (unavailable || tippable.length === 0) return null;

  function tip(gameId: string, pick: Pick) {
    setPicks((p) => ({ ...p, [gameId]: pick })); // optimistic
    api.predict(me.playerId, me.resumeCode, gameId, pick).catch((e) => {
      if (e instanceof ApiError && e.status === 503) setUnavailable(true);
      setPicks((p) => {
        const next = { ...p };
        delete next[gameId];
        return next;
      });
    });
  }

  return (
    <div className="card stack" style={{ padding: 18, width: "100%", maxWidth: 420, gap: 10 }}>
      <div className="spread">
        <p className="eyebrow" style={{ fontSize: 11 }}>🎯 {no.predict.title}</p>
        {myPoints > 0 && (
          <span className="badge">
            {myPoints} {no.predict.points}
          </span>
        )}
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{no.predict.hint}</p>

      {tippable.map((g) => {
        // Pick by PLAYER NAME, not colour — not every spectator knows who is
        // white/black. The stored value is still "white" | "draw" | "black".
        const options: { key: Pick; label: string; glyph?: string }[] = [
          { key: "white", label: nameById(g.whitePlayerId), glyph: "♔" },
          { key: "draw", label: no.predict.draw },
          { key: "black", label: nameById(g.blackPlayerId), glyph: "♚" },
        ];
        return (
          <div key={g.id} className="row" style={{ gap: 6 }}>
            {options.map(({ key, label, glyph }) => (
              <button
                key={key}
                className={`btn grow ${picks[g.id] === key ? "btn-primary" : "btn-ghost"}`}
                style={{ padding: "8px 6px", fontSize: 13 }}
                onClick={() => tip(g.id, key)}
              >
                {glyph && <span className="faint" style={{ marginRight: 4 }}>{glyph}</span>}
                {label}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
