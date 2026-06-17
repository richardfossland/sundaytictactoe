"use client";

import { useMemo } from "react";
import type { BoardState, PublicGame, PublicPlayer } from "@/lib/dto";
import { sortBySlot } from "@/lib/tournament/bracket";
import { no } from "@/lib/locale/no";

function winnerId(g: PublicGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

/** Read-only knockout bracket: every playoff round as a column, winners ticked,
 * tiebreak rematches badged. Shared by the host control view (clickable via
 * `onPick`, e.g. to override a result), the players' waiting screen, and the
 * finished recap (both read-only). Renders nothing when there are no playoff
 * rounds yet. */
export function BracketBoard({
  games,
  rounds,
  players,
  onPick,
}: {
  games: PublicGame[];
  rounds: BoardState["rounds"];
  players: PublicPlayer[];
  onPick?: (g: PublicGame) => void;
}) {
  const playerById = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    return (id: string | null) => (id ? byId.get(id) ?? null : null);
  }, [players]);

  const columns = useMemo(() => {
    const pr = rounds
      .filter((r) => r.phase === "playoff")
      .sort((a, b) => a.number - b.number);
    return pr.map((r) => ({
      round: r,
      // slot order = bracket structure (fetch order shifts as games resolve)
      games: sortBySlot(games.filter((g) => g.roundId === r.id)),
    }));
  }, [rounds, games]);

  if (columns.length === 0) return null;

  const slot = (g: PublicGame, side: "white" | "black") => {
    const id = side === "white" ? g.whitePlayerId : g.blackPlayerId;
    const p = playerById(id);
    const won = winnerId(g) === id && id !== null;
    return (
      <div className={`bracket-slot ${won ? "win" : ""} ${p ? "" : "tbd"}`}>
        <span>
          {p?.seed != null && <span className="seed">{p.seed}</span>}{" "}
          {p?.displayName ?? "—"}
        </span>
        {won && <span>✓</span>}
      </div>
    );
  };

  return (
    <div className={`bracket ${onPick ? "" : "bracket-readonly"}`}>
      {columns.map((col) => {
        // Games sharing a slot = an original draw + its tiebreak rematch.
        const slotCounts = new Map<number, number>();
        for (const g of col.games) {
          const s = g.slot ?? 0;
          slotCounts.set(s, (slotCounts.get(s) ?? 0) + 1);
        }
        return (
          <div className="bracket-col" key={col.round.id}>
            <h3>
              {slotCounts.size === 1 ? "Finale" : `${no.host.round} ${col.round.number}`}
            </h3>
            {col.games.map((g) => {
              const isTiebreak = (slotCounts.get(g.slot ?? 0) ?? 0) > 1;
              const clickable = !!onPick && g.status !== "bye";
              return (
                <div
                  className="bracket-match"
                  key={g.id}
                  onClick={clickable ? () => onPick!(g) : undefined}
                >
                  {isTiebreak && (
                    <span className="badge" style={{ fontSize: 10 }}>
                      ⚔︎ {no.host.replay}
                    </span>
                  )}
                  {slot(g, "white")}
                  {slot(g, "black")}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
