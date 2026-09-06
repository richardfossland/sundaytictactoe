"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { maskCode } from "@/lib/codes";
import { no } from "@/lib/locale/no";
import { Modal } from "@/lib/client/Modal";

/** Teacher-only roster of resume codes, so a student who lost their code can be
 * read it back. Fetched with the host code; never in the public board state.
 *
 * Every code is masked by default (UX-3) — this list is opened from a button
 * that's always on screen, and the board itself can be a classroom projector.
 * A code gives full control of that student's session, so a classmate reading
 * it over someone's shoulder is a real takeover risk. Tapping a row reveals
 * it (tap again to hide); only one row is ever revealed at a time. */
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
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setError(false);
    setRows(null);
    setRevealedId(null);
    api
      .codes(tournamentId, hostCode)
      .then((r) => setRows(r.players))
      .catch(() => setError(true));
  }, [tournamentId, hostCode]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  function toggleReveal(playerId: string) {
    setRevealedId((cur) => (cur === playerId ? null : playerId));
  }

  async function copyCode(playerId: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(playerId);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard permission denied / unsupported — nothing else to fall
      // back to inside a modal; the teacher can still reveal + read it out.
    }
  }

  const titleId = useId();

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      cardClassName="card stack scale-in"
      cardStyle={{ width: "100%", maxWidth: 460, maxHeight: "80vh", overflow: "auto" }}
    >
      <h3 id={titleId} style={{ fontSize: 20 }}>{no.host.codesTitle}</h3>
      <p className="muted" style={{ fontSize: 13 }}>{no.host.codesHint}</p>
      <div className="banner banner-warn" style={{ fontSize: 13 }}>
        ⚠️ {no.host.codesWarning}
      </div>
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
            {rows.map((r) => {
              const revealed = revealedId === r.playerId;
              return (
                <tr key={r.playerId}>
                  <td>{r.name}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="mono"
                      title={revealed ? no.host.tapToHide : no.host.tapToReveal}
                      aria-label={`${r.name}: ${revealed ? r.resumeCode : no.host.tapToReveal}`}
                      onClick={() => toggleReveal(r.playerId)}
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                        color: "var(--gold)",
                        letterSpacing: "0.1em",
                        fontWeight: 700,
                        font: "inherit",
                      }}
                    >
                      {revealed ? r.resumeCode : maskCode(r.resumeCode)}
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: "6px 10px", fontSize: 12, minHeight: 0 }}
                      onClick={() => copyCode(r.playerId, r.resumeCode)}
                    >
                      {copiedId === r.playerId ? no.common.copied : no.common.copy}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <button className="btn btn-ghost btn-block" onClick={onClose}>
        {no.common.close}
      </button>
    </Modal>
  );
}
