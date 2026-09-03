"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";
import { api, ApiError, shouldClearSession } from "@/lib/client/api";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { isValidPin } from "@/lib/codes";
import { WaitingRoom } from "./WaitingRoom";

type Screen =
  | "init"
  | "join"
  | "name"
  | "showCode"
  | "resume"
  | "playing"
  /** Removed from a tournament that has already started — see attemptResume. */
  | "removed";

/** Say WHY the resume failed, for the failures that keep the session. The
 * student can act on "no connection" but not on "noe gikk galt". */
function resumeTrouble(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) {
      return e.code === "timeout" ? no.player.resumeTimeout : no.player.resumeOffline;
    }
    if (e.status === 429) return no.player.resumeBusy;
    // 5xx, or anything that wasn't our API talking (edge page / WAF / proxy).
    if (e.status >= 500 || e.code === "non_json") return no.player.resumeServer;
  }
  return no.player.connection;
}

export default function Play() {
  const [screen, setScreen] = useState<Screen>("init");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [me, setMe] = useState<StoredPlayer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string>(no.player.connection);

  // Restore a stored session. ONLY our own API saying invalid_code/not_found
  // ends it (shouldClearSession). Everything else — 5xx/503, a Cloudflare 1102
  // or any other HTML edge page (`non_json`), a WAF 403, network, rate-limit —
  // keeps the session and offers a retry: a blip must never kick a student back
  // to the join screen with "økten er utløpt".
  const attemptResume = useCallback(() => {
    const stored = identity.player();
    if (!stored) {
      setScreen("join");
      return;
    }
    setResumeError(false);
    setScreen("init");
    api
      .resume(stored.resumeCode, { tournamentId: stored.tournamentId })
      .then(async (r) => {
        const next: StoredPlayer = {
          tournamentId: r.tournamentId,
          playerId: r.playerId,
          resumeCode: stored.resumeCode,
          displayName: r.displayName,
        };
        identity.savePlayer(next);
        setMe(next);
        // R4: we were removed. In the LOBBY that is almost always the host's
        // ghost-sweep firing while the phone was locked, so put ourselves
        // straight back in — the student did nothing wrong and has nothing to
        // do. (A failed rejoin is not fatal: the waiting room shows the same
        // offer as a button.) Once the tournament has STARTED the pairings are
        // set, so we say it out loud instead of waiting in silence forever.
        if (r.playerStatus === "left") {
          if (r.tournamentStatus !== "lobby") {
            setScreen("removed");
            return;
          }
          await api
            .rejoin(next.tournamentId, next.playerId, next.resumeCode)
            .catch(() => {});
        }
        setScreen("playing");
      })
      .catch((e) => {
        if (shouldClearSession(e)) {
          identity.clearPlayer();
          setError(no.player.sessionExpired);
          setScreen("join");
          return;
        }
        setResumeMessage(resumeTrouble(e)); // keep session; show retry + why
        setResumeError(true);
      });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    attemptResume();
  }, [attemptResume]);

  function goName() {
    setError(null);
    if (!isValidPin(pin)) {
      setError(no.player.invalidPin);
      return;
    }
    setScreen("name");
  }

  async function doJoin() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.join(pin, name.trim());
      const stored: StoredPlayer = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: r.resumeCode,
        displayName: r.displayName,
      };
      identity.savePlayer(stored);
      setMe(stored);
      setScreen("showCode");
    } catch (e) {
      const errCode = e instanceof ApiError ? e.code : "";
      setError(
        errCode === "invalid_pin"
          ? no.player.invalidPin
          : errCode === "already_started"
            ? "Turneringen har allerede startet."
            : no.common.error,
      );
      setBusy(false);
      if (errCode === "invalid_pin") setScreen("join");
    } finally {
      setBusy(false);
    }
  }

  async function doResume() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.resume(code, { pin });
      const stored: StoredPlayer = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: code.toUpperCase(),
        displayName: r.displayName,
      };
      identity.savePlayer(stored);
      setMe(stored);
      setScreen("playing");
    } catch (e) {
      // Same rule as attemptResume: only our own invalid_code/not_found means
      // "wrong code". A blip, a rate-limit or an edge error page must not read
      // as a dead end — that sends the student hunting for a code that works.
      setError(shouldClearSession(e) ? no.player.invalidCode : resumeTrouble(e));
      setBusy(false);
    }
  }

  if (screen === "init") {
    return (
      <main className="center-screen">
        {resumeError ? (
          <div className="card card-narrow stack text-center">
            <h2>{no.common.error}</h2>
            <p className="muted">{resumeMessage}</p>
            <button className="btn btn-primary btn-lg" onClick={attemptResume}>
              {no.common.retry}
            </button>
          </div>
        ) : (
          <span className="spin" />
        )}
      </main>
    );
  }

  if (screen === "removed") {
    return (
      <main className="center-screen">
        <div
          className="card card-narrow stack text-center scale-in"
          style={{ alignItems: "center" }}
        >
          <div className="brandmark" style={{ justifyContent: "center" }}>
            <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
          </div>
          <div style={{ fontSize: 40 }}>👋</div>
          <h2 style={{ fontSize: 22 }}>{no.player.removedTitle}</h2>
          <p className="muted">{no.player.removedBody}</p>
          <button
            className="btn btn-primary btn-lg"
            style={{ marginTop: 6 }}
            onClick={() => {
              identity.clearPlayer();
              setMe(null);
              setError(null);
              setPin("");
              setScreen("join");
            }}
          >
            {no.player.rejoinNew}
          </button>
        </div>
      </main>
    );
  }

  if (screen === "playing" && me) {
    return (
      <WaitingRoom
        me={me}
        onLeave={() => {
          identity.clearPlayer();
          setMe(null);
          setScreen("join");
        }}
      />
    );
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack">
        <div className="brandmark" style={{ justifyContent: "center", marginBottom: 2 }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>

        <div key={screen} className="stack scale-in" style={{ gap: 16 }}>
        {screen === "join" && (
          <>
            <div className="text-center stack" style={{ gap: 4 }}>
              <p className="eyebrow">{no.player.joinTitle}</p>
              <p className="faint" style={{ fontSize: 13 }}>Skriv inn PIN-en fra tavla</p>
            </div>
            <div className="field">
              <input
                id="pin"
                className="input input-pin"
                inputMode="numeric"
                maxLength={6}
                placeholder="------"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && goName()}
              />
            </div>
            <button className="btn btn-primary btn-block btn-lg" onClick={goName}>
              {no.player.join} →
            </button>
            <button
              className="btn btn-ghost btn-block"
              onClick={() => {
                setScreen("resume");
                setError(null);
              }}
            >
              {no.player.haveCode}
            </button>
            <div className="row" style={{ gap: 12, margin: "2px 0" }}>
              <hr className="thread grow" />
              <span className="faint" style={{ fontSize: 12 }}>eller</span>
              <hr className="thread grow" />
            </div>
            <Link href="/solo" className="btn btn-block">
              ♟ {no.solo.cta}
            </Link>
          </>
        )}

        {screen === "name" && (
          <>
            <p className="eyebrow">{no.player.nameTitle}</p>
            <div className="field">
              <label htmlFor="nm">{no.player.namePlaceholder}</label>
              <input
                id="nm"
                className="input"
                maxLength={40}
                autoFocus
                placeholder={no.player.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && doJoin()}
              />
              <span className="muted" style={{ fontSize: 12 }}>
                {no.player.nameHint}
              </span>
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !name.trim()}
              onClick={doJoin}
            >
              {busy ? <span className="spin" /> : no.player.join}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("join")}>
              {no.common.back}
            </button>
          </>
        )}

        {screen === "showCode" && me && (
          <>
            <div className="text-center stack" style={{ gap: 4 }}>
              <div style={{ fontSize: 36 }}>🔑</div>
              <p className="eyebrow">{no.player.resumeTitle}</p>
            </div>
            <div
              className="text-center"
              style={{
                padding: "18px 0",
                border: "1px dashed color-mix(in srgb, var(--gold) 40%, transparent)",
                borderRadius: 14,
                background: "rgba(235,184,75,0.05)",
              }}
            >
              <div className="big-code">{me.resumeCode}</div>
            </div>
            <div className="banner banner-wait">{no.player.resumeHint}</div>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => setScreen("playing")}
            >
              {no.player.resumeAck}
            </button>
          </>
        )}

        {screen === "resume" && (
          <>
            <p className="eyebrow">{no.player.resume}</p>
            <div className="field">
              <label htmlFor="rpin">{no.host.pinLabel}</label>
              <input
                id="rpin"
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="6-sifret PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <div className="field">
              <label htmlFor="rc">{no.player.resumePlaceholder}</label>
              <input
                id="rc"
                className="input"
                placeholder={no.player.resumePlaceholder}
                value={code}
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !code.trim() || !isValidPin(pin)}
              onClick={doResume}
            >
              {busy ? <span className="spin" /> : no.player.resume}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("join")}>
              {no.common.back}
            </button>
          </>
        )}
        </div>

        {error && <div className="banner banner-error">{error}</div>}
      </div>
    </main>
  );
}
