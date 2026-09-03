"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardState, DiagnosticsResult } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";

/** Teacher-only readout of the client beacon (T5, port of sundaychess#87).
 * Answers the question the app could not answer before: WHY was that student
 * thrown out, and WHY did that board freeze.
 *
 * The log itself carries no names — player display names are joined in HERE,
 * client-side, from the board state the host page already holds, so the roster
 * never travels with the telemetry. */
export function DiagnosticsModal({
  tournamentId,
  hostCode,
  state,
  onClose,
}: {
  tournamentId: string;
  hostCode: string;
  /** The host's current board state — used only to name player ids. */
  state: BoardState | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<DiagnosticsResult | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setData(null);
    api
      .diagnostics(tournamentId, hostCode)
      .then(setData)
      .catch(() => setError(true));
  }, [tournamentId, hostCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const nameById = useMemo(() => {
    const m = new Map((state?.players ?? []).map((p) => [p.id, p.displayName]));
    return (id: string | null) =>
      id ? (m.get(id) ?? `${no.diag.unknownPlayer} ${id.slice(0, 4)}`) : "–";
  }, [state]);

  const byKind = data?.counts && "byKind" in data.counts ? data.counts.byKind : {};
  const kindRows = Object.entries(byKind).sort((a, b) => b[1] - a[1]);

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
        style={{ width: "100%", maxWidth: 720, maxHeight: "84vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 20 }}>🩺 {no.diag.title}</h3>
        <p className="muted" style={{ fontSize: 13 }}>{no.diag.hint}</p>
        <hr className="thread" />

        {error ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="banner banner-error">{no.common.error}</div>
            <button className="btn btn-primary" onClick={load}>
              {no.common.retry}
            </button>
          </div>
        ) : !data ? (
          <span className="spin" />
        ) : data.unavailable ? (
          <div className="banner banner-wait">{no.diag.unavailable}</div>
        ) : data.events.length === 0 ? (
          <p className="muted">{no.diag.empty}</p>
        ) : (
          <div className="stack" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 6 }}>
              <p className="eyebrow" style={{ fontSize: 11 }}>{no.diag.countsTitle}</p>
              <table className="table">
                <tbody>
                  {kindRows.map(([kind, n]) => (
                    <tr key={kind}>
                      <td>{no.diag.kinds[kind] ?? kind}</td>
                      <td className="num mono" style={{ fontWeight: 700 }}>{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <p className="eyebrow" style={{ fontSize: 11 }}>{no.diag.eventsTitle}</p>
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>{no.diag.time}</th>
                    <th>{no.diag.what}</th>
                    <th>{no.diag.who}</th>
                    <th>{no.diag.detail}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td className="mono num" style={{ whiteSpace: "nowrap" }}>
                        {clock(e.at)}
                      </td>
                      <td>{no.diag.kinds[e.kind] ?? e.kind}</td>
                      <td>{nameById(e.playerId)}</td>
                      <td
                        className="mono muted"
                        style={{ fontSize: 12, wordBreak: "break-word" }}
                      >
                        {compactDetail(e.detail, e.uaClass)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button className="btn btn-ghost btn-block" onClick={onClose}>
          {no.common.close}
        </button>
      </div>
    </div>
  );
}

/** HH:MM:SS in the teacher's own timezone — the log is read the same day. */
function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 19);
  return d.toLocaleTimeString("nb-NO", { hour12: false });
}

/** `detail` is a flat bag of codes by construction (both ends clamp it), so one
 * line of `key=value` is the whole story. */
function compactDetail(
  detail: Record<string, unknown>,
  uaClass: string | null,
): string {
  const parts = Object.entries(detail ?? {})
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`);
  if (uaClass) parts.push(uaClass);
  return parts.join(" · ") || "–";
}
