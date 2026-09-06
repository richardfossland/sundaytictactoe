"use client";

import { useId, useState } from "react";
import { api } from "@/lib/client/api";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { Modal } from "@/lib/client/Modal";
import { no } from "@/lib/locale/no";
import type { GameStatus } from "@/lib/types";

interface Side {
  id: string;
  name: string;
}

/** One shared confirm-dialog slot: every destructive action in this modal
 * (setting a result, marking someone absent) asks before it runs, instead of
 * firing on the first tap — this is a teacher's board, often on a projector,
 * and a mis-tap here changes recorded results. */
interface PendingAction {
  message: string;
  danger: boolean;
  run: () => void;
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
  const [pending, setPending] = useState<PendingAction | null>(null);

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

  const askResult = (r: GameStatus, message: string, danger = false) =>
    setPending({ message, danger, run: () => setResult(r) });
  const askAbsent = (playerId: string, message: string) =>
    setPending({ message, danger: true, run: () => markAbsent(playerId) });

  const titleId = useId();

  return (
    <>
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      cardClassName="card stack scale-in card-narrow"
    >
        <h3 id={titleId} style={{ fontSize: 20 }}>{no.host.overrideTitle}</h3>
        <p className="muted">
          {white.name} {no.player.vs} {black?.name ?? no.host.bye}
        </p>

        <p className="eyebrow">{no.host.setResult}</p>
        <button
          className="btn btn-block"
          disabled={busy}
          onClick={() => askResult("white_win", no.host.overrideResultConfirm(white.name))}
        >
          {white.name} ✓
        </button>
        {black && (
          <button
            className="btn btn-block"
            disabled={busy}
            onClick={() => askResult("black_win", no.host.overrideResultConfirm(black.name))}
          >
            {black.name} ✓
          </button>
        )}
        <button
          className="btn btn-block"
          disabled={busy}
          onClick={() => askResult("draw", no.host.overrideDrawConfirm)}
        >
          {no.host.draw}
        </button>
        {allowAbort && (
          <button
            className="btn btn-danger btn-block"
            disabled={busy}
            onClick={() => askResult("aborted", no.host.overrideAbortConfirm, true)}
          >
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
            <button
              className="btn btn-block"
              disabled={busy}
              onClick={() => askAbsent(white.id, no.host.overrideAbsentConfirm(white.name, scope))}
            >
              {white.name} {no.host.absentSuffix}
            </button>
            <button
              className="btn btn-block"
              disabled={busy}
              onClick={() => askAbsent(black.id, no.host.overrideAbsentConfirm(black.name, scope))}
            >
              {black.name} {no.host.absentSuffix}
            </button>
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}
        <button className="btn btn-ghost btn-block" onClick={onClose}>
          {no.common.cancel}
        </button>
    </Modal>

    {/* Rendered as a SIBLING of Modal above, not nested inside it — the
        backdrop's onClick={onClose} would otherwise catch the bubbled click
        from ConfirmDialog's own backdrop and close this whole modal too when
        the teacher only meant to cancel the confirmation. */}
    {pending && (
      <ConfirmDialog
        message={pending.message}
        danger={pending.danger}
        onConfirm={() => {
          const { run: doRun } = pending;
          setPending(null);
          doRun();
        }}
        onCancel={() => setPending(null)}
      />
    )}
    </>
  );
}
