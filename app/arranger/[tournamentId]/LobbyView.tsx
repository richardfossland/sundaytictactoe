"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BoardState } from "@/lib/dto";
import { QRCode } from "@/lib/client/QRCode";
import { identity } from "@/lib/client/identity";
import { api } from "@/lib/client/api";
import { usePresence } from "@/lib/client/usePresence";
import { recordPresence, sweepCandidates } from "@/lib/client/lobbyKick";
import { channels } from "@/lib/realtime";
import { initials } from "@/lib/client/Confetti";
import { teamColor } from "@/lib/tournament/teams";
import { no } from "@/lib/locale/no";

/** A player who has been continuously disconnected for this long while still in
 * the lobby is auto-removed (they left the app). Conservative so a brief wifi
 * blip on a Chromebook never evicts a real student. */
const AUTO_KICK_MS = 3 * 60 * 1000;

export function LobbyView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players } = state;
  const [joinUrl, setJoinUrl] = useState("");
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    /* eslint-disable react-hooks/set-state-in-effect */
    setJoinUrl(`${base.replace(/\/$/, "")}/play`);
    setHostCode(identity.hostCode(tournament.id));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [tournament.id]);

  async function startLeague() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setStarting(true);
    setError(null);
    try {
      await api.startRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
      setStarting(false);
    }
  }

  const active = players.filter((p) => p.status === "active");

  // Presence bookkeeping for the conservative auto-kick: a player must have
  // CONNECTED at least once and then been gone continuously past the grace
  // window. Refs (not state) so the stable interval below reads the latest.
  // The rules themselves live in lib/client/lobbyKick.ts, under test.
  const seenRef = useRef<Set<string>>(new Set());
  const leftAtRef = useRef<Map<string, number>>(new Map());
  const kickedRef = useRef<Set<string>>(new Set());
  // Is the HOST's own presence channel healthy, and have we seen a fresh sync
  // since it last (re)subscribed? Both gate the sweep: on a re-join Realtime can
  // hand us an EMPTY presence_state before the class re-announces itself, and
  // stamping that as "everyone left" mass-kicks the room three minutes later.
  const subscribedRef = useRef(false);
  const needsSyncRef = useRef(true);

  // Who's connected right now (students advertise presence keyed by playerId).
  const present = usePresence(
    channels.presence(tournament.id),
    undefined,
    (status) => {
      if (status === "SUBSCRIBED") {
        subscribedRef.current = true;
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED: everything we think we know about
      // who is offline came from a socket that is no longer trustworthy. Throw
      // the absence clock away and wait for a fresh sync before starting it.
      subscribedRef.current = false;
      needsSyncRef.current = true;
      leftAtRef.current.clear();
    },
  );

  const latest = useRef({ active, present, hostCode });
  useEffect(() => {
    latest.current = { active, present, hostCode };
  });

  useEffect(() => {
    recordPresence(
      {
        seen: seenRef.current,
        leftAt: leftAtRef.current,
        kicked: kickedRef.current,
      },
      present,
      Date.now(),
      // The first snapshot after a (re)subscribe is the sync we were waiting
      // for: absorb it, but never stamp anyone absent from it.
      !needsSyncRef.current,
    );
    needsSyncRef.current = false;
    // L5 note (port of sundaychess#84): `present` now keeps its reference when
    // MEMBERSHIP is unchanged, so this effect no longer runs on every presence
    // sync in the class — only when someone actually joins or leaves.
    // `recordPresence` was already idempotent for a repeated identical
    // snapshot (it stamps `leftAt` once, and seen/kicked are sets), so the
    // books are unaffected. The one visible consequence is the `needsSync`
    // handshake above: after a resubscribe whose membership is byte-identical
    // there is nothing to absorb, so the latch stays armed until the next
    // snapshot that actually differs — i.e. R4's "don't stamp what our socket
    // may simply not know yet" rule now applies to the first INFORMATIVE
    // snapshot rather than the first snapshot full stop. Strictly more
    // conservative: it can only delay a ghost sweep, never kick someone it
    // wouldn't have.
  }, [present]);

  function kick(playerId: string) {
    if (!hostCode) return;
    api.kick(tournament.id, hostCode, playerId).then(onChanged).catch(() => {});
  }

  // Stable 30s sweep: drop ghosts who connected then left for > the grace window.
  useEffect(() => {
    const iv = setInterval(() => {
      const cur = latest.current;
      const code = cur.hostCode;
      if (!code) return;
      const ids = sweepCandidates({
        active: cur.active,
        present: cur.present,
        seen: seenRef.current,
        leftAt: leftAtRef.current,
        kicked: kickedRef.current,
        hostSubscribed: subscribedRef.current,
        // A hidden host tab is throttled: its presence view is stale by
        // construction, so it must not evict anyone.
        visible: document.visibilityState === "visible",
        now: Date.now(),
        windowMs: AUTO_KICK_MS,
      });
      for (const id of ids) {
        kickedRef.current.add(id);
        api
          .kick(tournament.id, code, id)
          .then(onChanged)
          .catch(() => kickedRef.current.delete(id)); // allow a later retry
      }
    }, 30_000);
    return () => clearInterval(iv);
  }, [tournament.id, onChanged]);

  return (
    <main className="wrap" style={{ padding: "34px 24px 64px" }}>
      <header className="spread reveal" style={{ marginBottom: 30 }}>
        <span className="brandmark">
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </span>
        <div className="row" style={{ gap: 12 }}>
          {tournament.title && <span className="muted">{tournament.title}</span>}
          {hostCode && (
            <span className="badge">
              Vertskode <span className="mono" style={{ color: "var(--gold)" }}>{hostCode}</span>
            </span>
          )}
        </div>
      </header>

      <div className="board-grid split-lobby">
        {/* Join panel */}
        <section
          className="card stack text-center reveal"
          style={{ alignItems: "center", padding: "40px 32px", ["--i" as string]: 1 } as CSSProperties}
        >
          <p className="eyebrow">{no.host.pinLabel}</p>
          <div className="pin-hero">{tournament.joinPin}</div>
          <div className="row" style={{ gap: 8, color: "var(--txt-dim)", fontSize: 15 }}>
            <span>Gå til</span>
            <b style={{ color: "var(--txt)" }}>{joinUrl.replace(/^https?:\/\//, "")}</b>
          </div>
          {joinUrl && (
            <div
              className="scale-in"
              style={{ padding: 12, background: "var(--paper)", borderRadius: 16, boxShadow: "var(--shadow-2)" }}
            >
              <QRCode value={joinUrl} size={172} />
            </div>
          )}
          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: 6, minWidth: 220 }}
            disabled={starting || active.length < 2}
            onClick={startLeague}
          >
            {starting ? (
              <span className="spin" />
            ) : tournament.config.format === "cup" ? (
              `🏆 ${no.host.startCup} →`
            ) : (
              `${no.host.startLeague} →`
            )}
          </button>
          {active.length < 2 && (
            <p className="faint" style={{ fontSize: 13 }}>Minst 2 spillere må bli med.</p>
          )}
          {error && <div className="banner banner-error">{error}</div>}
        </section>

        {/* Roster */}
        <section className="card stack reveal" style={{ ["--i" as string]: 2 } as CSSProperties}>
          <div className="spread">
            <h2 style={{ fontSize: 26 }}>{no.host.players}</h2>
            <span className="badge badge-live">{active.length}</span>
          </div>
          <hr className="thread" />
          {active.length === 0 ? (
            <p className="muted" style={{ padding: "28px 0", textAlign: "center" }}>
              {no.host.noPlayers}
            </p>
          ) : (
            <div className="chips">
              {active.map((p) => {
                const online = present.has(p.id);
                return (
                  <span className="chip" key={p.id}>
                    <span
                      title={online ? no.host.online : no.host.offline}
                      aria-label={online ? no.host.online : no.host.offline}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: online ? "var(--turn, #56c06a)" : "var(--txt-faint)",
                        boxShadow: online ? "0 0 6px color-mix(in srgb, var(--turn) 60%, transparent)" : "none",
                      }}
                    />
                    <span className="avatar">{initials(p.displayName)}</span>
                    {p.displayName}
                    {p.team && (
                      <span
                        className="team-dot"
                        title={p.team}
                        style={{ background: teamColor(p.team), marginLeft: 2 }}
                      />
                    )}
                    <button
                      className="chip-kick"
                      title={no.host.kick}
                      aria-label={`${no.host.kick} ${p.displayName}`}
                      onClick={() => {
                        if (confirm(no.host.kickConfirm)) kick(p.id);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
