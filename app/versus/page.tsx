"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/client/api";
import type { StoredPlayer } from "@/lib/client/identity";
import { isValidPin } from "@/lib/codes";
import { LocalVersus } from "@/lib/client/LocalVersus";
import { GameView } from "@/app/play/GameView";
import { no } from "@/lib/locale/no";

type Screen = "choose" | "local" | "online" | "create" | "waiting" | "join" | "playing" | "done";

interface CasualBlob extends StoredPlayer {
  joinPin?: string;
}

const CASUAL_KEY = "ttt:casual";
function saveCasual(b: CasualBlob) {
  try {
    localStorage.setItem(CASUAL_KEY, JSON.stringify(b));
  } catch (e) {
    console.warn("[versus] localStorage write failed", e);
  }
}
function loadCasual(): CasualBlob | null {
  try {
    const r = localStorage.getItem(CASUAL_KEY);
    return r ? (JSON.parse(r) as CasualBlob) : null;
  } catch {
    return null;
  }
}
function clearCasual() {
  try {
    localStorage.removeItem(CASUAL_KEY);
  } catch (e) {
    console.warn("[versus] localStorage write failed", e);
  }
}

export default function Versus() {
  const [screen, setScreen] = useState<Screen>("choose");
  const [me, setMe] = useState<StoredPlayer | null>(null);
  const [shownPin, setShownPin] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [gameId, setGameId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refresh recovery: resume an in-progress casual game from localStorage.
  // Init-from-storage must run on the client (localStorage is unavailable during
  // SSR), so these are intentional set-states in a mount effect.
  useEffect(() => {
    const saved = loadCasual();
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setMe({
      tournamentId: saved.tournamentId,
      playerId: saved.playerId,
      resumeCode: saved.resumeCode,
      displayName: saved.displayName,
    });
    if (saved.joinPin) setShownPin(saved.joinPin);
    setScreen("waiting"); // the poll below jumps to "playing" once a game exists
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // While waiting (challenger or after a refresh), poll for my game and enter it.
  useEffect(() => {
    if (screen !== "waiting" || !me) return;
    let stop = false;
    const tick = async () => {
      try {
        const board = await api.board(me.tournamentId);
        const mine = board.games.filter(
          (g) => g.whitePlayerId === me.playerId || g.blackPlayerId === me.playerId,
        );
        const g = mine.find((x) => x.status === "live") ?? mine[mine.length - 1];
        if (g && !stop) {
          setGameId(g.id);
          setScreen("playing");
        }
      } catch {
        /* transient — keep polling */
      }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [screen, me]);

  // While sitting on the "done" screen, watch for a rematch the OTHER player may
  // have started (a fresh live game in this session) and jump straight into it.
  useEffect(() => {
    if (screen !== "done" || !me) return;
    let stop = false;
    const tick = async () => {
      try {
        const board = await api.board(me.tournamentId);
        const live = board.games.find(
          (g) =>
            (g.whitePlayerId === me.playerId || g.blackPlayerId === me.playerId) &&
            g.status === "live",
        );
        if (live && !stop) {
          saveCasual({ ...me });
          setGameId(live.id);
          setScreen("playing");
        }
      } catch {
        /* transient — keep polling */
      }
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [screen, me]);

  async function doCreate() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createCasual(name.trim());
      const blob: CasualBlob = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: r.resumeCode,
        displayName: r.displayName,
        joinPin: r.joinPin,
      };
      saveCasual(blob);
      setMe(blob);
      setShownPin(r.joinPin);
      setScreen("waiting");
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function doJoin() {
    const c = code.trim();
    if (!isValidPin(c)) {
      setError(no.player.invalidPin);
      return;
    }
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.joinCasual(c, name.trim());
      const blob: CasualBlob = {
        tournamentId: r.tournamentId,
        playerId: r.playerId,
        resumeCode: r.resumeCode,
        displayName: r.displayName,
      };
      saveCasual(blob);
      setMe(blob);
      setGameId(r.gameId);
      setScreen("playing");
    } catch (e) {
      const ec = e instanceof ApiError ? e.code : "";
      setError(
        ec === "full"
          ? no.versus.full
          : ec === "invalid_pin" || ec === "not_casual"
            ? no.versus.invalidCode
            : no.common.error,
      );
    } finally {
      setBusy(false);
    }
  }

  async function doRematch() {
    if (!me) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.rematchCasual(me.tournamentId, me.playerId, me.resumeCode);
      saveCasual({ ...me }); // re-arm refresh-recovery for the new game
      setGameId(r.gameId);
      setScreen("playing");
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  function leave(to: Screen) {
    clearCasual();
    setMe(null);
    setGameId(null);
    setShownPin("");
    setCode("");
    setError(null);
    setScreen(to);
  }

  // ---------- in-game ----------
  if (screen === "playing" && me && gameId) {
    return (
      <GameView
        me={me}
        gameId={gameId}
        timer={null}
        onFinished={() => {
          clearCasual();
          setScreen("done");
        }}
      />
    );
  }

  if (screen === "local") {
    return <LocalVersus onExit={() => setScreen("choose")} />;
  }

  // ---------- card-based screens ----------
  return (
    <main className="center-screen">
      <div className="card card-narrow stack scale-in" style={{ alignItems: "stretch" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>

        {screen === "choose" && (
          <>
            <div className="text-center stack" style={{ gap: 4 }}>
              <p className="eyebrow">{no.versus.title}</p>
              <p className="faint" style={{ fontSize: 13 }}>{no.versus.subtitle}</p>
            </div>
            <button
              className="card stack entrance"
              style={{ padding: 20, alignItems: "center", gap: 6, cursor: "pointer" }}
              onClick={() => setScreen("local")}
            >
              <span className="entrance-glyph">⚔︎</span>
              <b style={{ fontSize: 17 }}>{no.versus.sameScreen}</b>
              <span className="faint" style={{ fontSize: 13 }}>{no.versus.sameScreenSub}</span>
            </button>
            <button
              className="card stack entrance"
              style={{ padding: 20, alignItems: "center", gap: 6, cursor: "pointer" }}
              onClick={() => setScreen("online")}
            >
              <span className="entrance-glyph">⧉</span>
              <b style={{ fontSize: 17 }}>{no.versus.online}</b>
              <span className="faint" style={{ fontSize: 13 }}>{no.versus.onlineSub}</span>
            </button>
            <Link href="/" className="btn btn-ghost btn-block">{no.versus.back}</Link>
          </>
        )}

        {screen === "online" && (
          <>
            <p className="eyebrow text-center">{no.versus.online}</p>
            <button className="btn btn-primary btn-block btn-lg" onClick={() => { setError(null); setScreen("create"); }}>
              {no.versus.create}
            </button>
            <button className="btn btn-block" onClick={() => { setError(null); setScreen("join"); }}>
              {no.versus.join}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("choose")}>{no.versus.back}</button>
          </>
        )}

        {screen === "create" && (
          <>
            <p className="eyebrow">{no.versus.create}</p>
            <div className="field">
              <label htmlFor="cn">{no.versus.yourName}</label>
              <input
                id="cn"
                className="input"
                maxLength={40}
                autoFocus
                placeholder={no.versus.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && doCreate()}
              />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !name.trim()} onClick={doCreate}>
              {busy ? <span className="spin" /> : no.versus.create2}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("online")}>{no.versus.back}</button>
          </>
        )}

        {screen === "waiting" && (
          <>
            <div className="text-center stack" style={{ gap: 4 }}>
              <div style={{ fontSize: 32 }}>🔑</div>
              <p className="eyebrow">{no.versus.shareCode}</p>
            </div>
            {shownPin && (
              <div
                className="text-center"
                style={{
                  padding: "18px 0",
                  border: "1px dashed color-mix(in srgb, var(--gold) 40%, transparent)",
                  borderRadius: 14,
                  background: "rgba(235,184,75,0.05)",
                }}
              >
                <div className="big-code">{shownPin}</div>
              </div>
            )}
            <div className="banner banner-wait" style={{ width: "100%" }}>
              <span className="spin" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }} />
              {no.versus.waiting}
            </div>
            <button className="btn btn-ghost btn-block" onClick={() => leave("choose")}>{no.versus.back}</button>
          </>
        )}

        {screen === "join" && (
          <>
            <p className="eyebrow">{no.versus.join}</p>
            <div className="field">
              <label htmlFor="jc">{no.versus.opponentCode}</label>
              <input
                id="jc"
                className="input"
                inputMode="numeric"
                maxLength={6}
                placeholder="------"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <div className="field">
              <label htmlFor="jn">{no.versus.yourName}</label>
              <input
                id="jn"
                className="input"
                maxLength={40}
                placeholder={no.versus.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && code.trim() && name.trim() && doJoin()}
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !name.trim() || !isValidPin(code)}
              onClick={doJoin}
            >
              {busy ? <span className="spin" /> : no.versus.joinGame}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setScreen("online")}>{no.versus.back}</button>
          </>
        )}

        {screen === "done" && (
          <>
            <div className="text-center stack" style={{ gap: 6 }}>
              <div style={{ fontSize: 36 }}>🏁</div>
              <p className="eyebrow">{no.versus.done}</p>
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !me}
              onClick={doRematch}
            >
              {busy ? <span className="spin" /> : no.versus.rematch}
            </button>
            <button className="btn btn-block" onClick={() => leave("online")}>
              {no.versus.newGame}
            </button>
            <Link href="/" className="btn btn-ghost btn-block">{no.versus.back}</Link>
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}
      </div>
    </main>
  );
}
