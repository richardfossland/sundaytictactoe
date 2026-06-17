"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";

/** Teacher-only roster of resume codes, so a student who lost their code can be
 * read it back. Fetched with the host code; never in the public board state. */
export function CodesModal({
  tournamentId,
  hostCode,
  onClose,
}: {
  tournamentId: string;
  hostCode: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ playerId: string; name: string; resumeCode: string }[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setRows(null);
    api
      .codes(tournamentId, hostCode)
      .then((r) => setRows(r.players))
      .catch(() => setError(true));
  }, [tournamentId, hostCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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
        className="card stack scale-in"
        style={{ width: "100%", maxWidth: 460, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 20 }}>{no.host.codesTitle}</h3>
        <p className="muted" style={{ fontSize: 13 }}>{no.host.codesHint}</p>
        <hr className="thread" />
        {error ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="banner banner-error">{no.common.error}</div>
            <button className="btn btn-primary" onClick={load}>
              {no.common.retry}
            </button>
          </div>
        ) : !rows ? (
          <span className="spin" />
        ) : (
          <table className="table">
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId}>
                  <td>{r.name}</td>
                  <td className="num mono" style={{ color: "var(--gold)", letterSpacing: "0.1em", fontWeight: 700 }}>
                    {r.resumeCode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          {no.common.close}
        </button>
      </div>
    </div>
  );
}
