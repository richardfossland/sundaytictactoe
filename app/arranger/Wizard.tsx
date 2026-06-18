"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { no } from "@/lib/locale/no";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { VARIANTS } from "@/lib/ttt/variants";
import type { TournamentConfig } from "@/lib/types";

type StepKey =
  | "title"
  | "format"
  | "rounds"
  | "variant"
  | "playoff"
  | "size"
  | "timer"
  | "reactions"
  | "teams"
  | "review";

const VARIANT_SUB: Record<string, string> = {
  "3x3": "Klassisk – tre på rad på 3×3",
  "4x4": "Større brett – fire på rad på 4×4",
  "5x5": "Stort brett – fire på rad på 5×5, sjelden uavgjort",
};

export const TEAM_NAMES = ["Rød", "Blå", "Grønn", "Gul"] as const;

export function Wizard({ onExit }: { onExit?: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"league" | "cup">("league");
  const [leagueRounds, setLeagueRounds] = useState(5);
  const [variant, setVariant] = useState<string>(VARIANTS[0].id);
  const [playoff, setPlayoff] = useState(false);
  const [playoffSize, setPlayoffSize] = useState<4 | 8 | 16>(8);
  const [timerMin, setTimerMin] = useState<0 | 5 | 10 | 15>(0);
  const [reactions, setReactions] = useState(false);
  const [teamCount, setTeamCount] = useState<0 | 2 | 3 | 4>(0);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cup skips rounds/playoff config (everyone goes straight into the bracket);
  // the 'size' step only exists when a league playoff is enabled.
  const steps = useMemo<StepKey[]>(() => {
    if (format === "cup") {
      return ["title", "format", "variant", "timer", "reactions", "teams", "review"];
    }
    return playoff
      ? ["title", "format", "rounds", "variant", "playoff", "size", "timer", "reactions", "teams", "review"]
      : ["title", "format", "rounds", "variant", "playoff", "timer", "reactions", "teams", "review"];
  }, [playoff, format]);
  const key = steps[Math.min(step, steps.length - 1)];
  const isLast = step >= steps.length - 1;

  function next() {
    setError(null);
    if (isLast) void create();
    else setStep((s) => Math.min(s + 1, steps.length - 1));
  }
  function back() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  async function create() {
    setBusy(true);
    setError(null);
    const cup = format === "cup";
    const config: TournamentConfig = {
      format,
      leagueRounds,
      playoff: cup ? true : playoff,
      playoffSize: cup ? 16 : playoff ? playoffSize : 0,
      roundTimerSec: timerMin === 0 ? null : timerMin * 60,
      reactions,
      variant,
      teams: teamCount === 0 ? [] : (TEAM_NAMES.slice(0, teamCount) as unknown as string[]),
    };
    try {
      const t = await api.createTournament({ title: title.trim(), config });
      identity.saveHostCode(t.id, t.hostCode);
      router.push(`/arranger/${t.id}`);
    } catch {
      setError(no.common.error);
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="spread">
        <p className="eyebrow">
          {no.wizard.step} {step + 1} {no.wizard.of} {steps.length}
        </p>
        <div className="row" style={{ gap: 6 }}>
          {steps.map((s, i) => (
            <span
              key={s}
              style={{
                width: 22,
                height: 4,
                borderRadius: 4,
                background: i <= step ? "var(--gold)" : "var(--ink-soft)",
              }}
            />
          ))}
        </div>
      </div>

      {key === "title" && (
        <div className="field">
          <label htmlFor="wt">{no.wizard.titleStep}</label>
          <input
            id="wt"
            className="input"
            autoFocus
            placeholder={no.wizard.titlePlaceholder}
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 12 }}>
            {no.wizard.titleHint}
          </span>
        </div>
      )}

      {key === "format" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.formatStep}
          </p>
          <div className="stack" style={{ gap: 8 }}>
            <button
              className={`btn btn-block ${format === "league" ? "btn-primary" : "btn-ghost"}`}
              style={{ textAlign: "left", padding: "12px 16px" }}
              onClick={() => setFormat("league")}
            >
              <b>🏅 {no.wizard.formatLeague}</b>
              <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}>
                {no.wizard.formatLeagueSub}
              </span>
            </button>
            <button
              className={`btn btn-block ${format === "cup" ? "btn-primary" : "btn-ghost"}`}
              style={{ textAlign: "left", padding: "12px 16px" }}
              onClick={() => setFormat("cup")}
            >
              <b>🏆 {no.wizard.formatCup}</b>
              <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}>
                {no.wizard.formatCupSub}
              </span>
            </button>
          </div>
        </div>
      )}

      {key === "rounds" && (
        <div className="stack">
          <label className="field" style={{ gap: 4 }}>
            {no.wizard.roundsStep}
          </label>
          <div className="row" style={{ justifyContent: "center", gap: 18 }}>
            <button className="btn" onClick={() => setLeagueRounds((r) => Math.max(3, r - 1))} aria-label="færre">
              −
            </button>
            <span className="pin-hero" style={{ fontSize: 64 }}>
              {leagueRounds}
            </span>
            <button className="btn" onClick={() => setLeagueRounds((r) => Math.min(7, r + 1))} aria-label="flere">
              +
            </button>
          </div>
          <input
            type="range"
            min={3}
            max={7}
            value={leagueRounds}
            onChange={(e) => setLeagueRounds(Number(e.target.value))}
          />
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.roundsHint}
          </span>
        </div>
      )}

      {key === "variant" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.variantStep}
          </p>
          <div className="stack" style={{ gap: 8 }}>
            {VARIANTS.map((v) => (
              <button
                key={v.id}
                className={`btn btn-block ${variant === v.id ? "btn-primary" : "btn-ghost"}`}
                style={{ textAlign: "left", padding: "12px 16px" }}
                onClick={() => setVariant(v.id)}
              >
                <b>{v.label}</b>
                <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}>
                  {VARIANT_SUB[v.id]}
                </span>
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.variantHint}
          </span>
        </div>
      )}

      {key === "playoff" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.playoffStep}
          </p>
          <div className="row">
            <button
              className={`btn grow btn-lg ${!playoff ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setPlayoff(false)}
            >
              {no.wizard.playoffOff}
            </button>
            <button
              className={`btn grow btn-lg ${playoff ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setPlayoff(true)}
            >
              {no.wizard.playoffOn}
            </button>
          </div>
        </div>
      )}

      {key === "size" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.playoffSizeStep}
          </p>
          <div className="row">
            {([4, 8, 16] as const).map((n) => (
              <button
                key={n}
                className={`btn grow btn-lg ${playoffSize === n ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPlayoffSize(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.playoffSizeHint}
          </span>
        </div>
      )}

      {key === "timer" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.timerStep}
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {([0, 5, 10, 15] as const).map((m) => (
              <button
                key={m}
                className={`btn grow btn-lg ${timerMin === m ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTimerMin(m)}
              >
                {m === 0 ? no.wizard.timerOff : `${m} ${no.wizard.min}`}
              </button>
            ))}
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.timerHint}
          </span>
        </div>
      )}

      {key === "teams" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.teamsStep}
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {([0, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                className={`btn grow btn-lg ${teamCount === n ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTeamCount(n)}
              >
                {n === 0 ? no.wizard.teamsOff : `${n} lag`}
              </button>
            ))}
          </div>
          {teamCount > 0 && (
            <p className="text-center" style={{ fontSize: 14 }}>
              {TEAM_NAMES.slice(0, teamCount).join(" · ")}
            </p>
          )}
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.teamsHint}
          </span>
        </div>
      )}

      {key === "reactions" && (
        <div className="stack">
          <p className="field" style={{ gap: 4 }}>
            {no.wizard.reactionsStep}
          </p>
          <div className="row">
            <button
              className={`btn grow btn-lg ${!reactions ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setReactions(false)}
            >
              {no.wizard.reactionsOff}
            </button>
            <button
              className={`btn grow btn-lg ${reactions ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setReactions(true)}
            >
              👍😄🔥 {no.wizard.reactionsOn}
            </button>
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.reactionsHint}
          </span>
        </div>
      )}

      {key === "review" && (
        <div className="stack">
          <p className="eyebrow">{no.wizard.reviewStep}</p>
          {title.trim() && (
            <div className="spread">
              <span className="muted">{no.wizard.titleStep}</span>
              <b>{title.trim()}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewFormat}</span>
            <b>{format === "cup" ? `🏆 ${no.wizard.formatCup}` : `🏅 ${no.wizard.formatLeague}`}</b>
          </div>
          {format === "league" && (
            <div className="spread">
              <span className="muted">{no.wizard.reviewRounds}</span>
              <b>{leagueRounds}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewVariant}</span>
            <b>{VARIANTS.find((v) => v.id === variant)?.label ?? variant}</b>
          </div>
          {format === "league" && (
            <div className="spread">
              <span className="muted">{no.wizard.reviewPlayoff}</span>
              <b>{playoff ? `${playoffSize}` : no.wizard.none}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewTimer}</span>
            <b>{timerMin === 0 ? no.wizard.none : `${timerMin} ${no.wizard.min}`}</b>
          </div>
          {teamCount > 0 && (
            <div className="spread">
              <span className="muted">{no.wizard.reviewTeams}</span>
              <b>{TEAM_NAMES.slice(0, teamCount).join(", ")}</b>
            </div>
          )}
          <div className="spread">
            <span className="muted">{no.wizard.reviewReactions}</span>
            <b>{reactions ? no.wizard.reactionsOn : no.wizard.reactionsOff}</b>
          </div>
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      <div className="row" style={{ marginTop: 8 }}>
        {(step > 0 || onExit) && (
          <button className="btn btn-ghost" onClick={step > 0 ? back : onExit} disabled={busy}>
            ← {no.common.back}
          </button>
        )}
        <button className="btn btn-primary grow" onClick={next} disabled={busy}>
          {busy ? <span className="spin" /> : isLast ? no.common.create : no.common.next}
        </button>
      </div>
    </div>
  );
}
