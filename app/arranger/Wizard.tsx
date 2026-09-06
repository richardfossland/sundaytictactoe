"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { no } from "@/lib/locale/no";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { VARIANTS } from "@/lib/ttt/variants";
import { MAX_ROUNDS, MIN_ROUNDS } from "@/lib/tournament/roundsAdvice";
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

export const TEAM_NAMES = ["Rød", "Blå", "Grønn", "Gul"] as const;

// How long after picking an option a single-select step auto-advances. Long
// enough to see the selection land, short enough not to feel like a delay.
const AUTO_ADVANCE_MS = 150;

// Steps where there's only one thing to pick, so a tap can just move on
// instead of waiting for an explicit "Neste". Title/rounds (free-input) and
// size/review are excluded — see the "Rounds step a11y" PR note for why
// `size` was left out too (out of scope for this pass).
const AUTO_ADVANCE_STEPS: ReadonlySet<StepKey> = new Set([
  "format",
  "variant",
  "playoff",
  "timer",
  "reactions",
  "teams",
]);

/** The wizard's out-of-the-box defaults — same values the "rounds" step's
 * useState initializers use below. Extracted so "Rask start" (page.tsx) can
 * create a tournament with these without walking the wizard at all. */
export function defaultConfig(title: string): { title: string; config: TournamentConfig } {
  return {
    title: title.trim(),
    config: {
      format: "league",
      leagueRounds: 5,
      playoff: false,
      playoffSize: 0,
      roundTimerSec: null,
      reactions: false,
      variant: "standard",
      teams: [],
    },
  };
}

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
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Mirrors `steps` for the auto-advance timeout below, whose callback runs
  // after a delay — by then `steps` may have been recomputed (e.g. toggling
  // playoff inserts/removes the "size" step), so the timeout must read the
  // latest value rather than the one captured when it was scheduled.
  const stepsRef = useRef(steps);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);
  const key = steps[Math.min(step, steps.length - 1)];
  const isLast = step >= steps.length - 1;
  const autoAdvancing = AUTO_ADVANCE_STEPS.has(key);

  function clearPendingAdvance() {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  // Cleanup on unmount (e.g. the host backs out to the chooser mid-step).
  useEffect(() => clearPendingAdvance, []);

  function next() {
    clearPendingAdvance();
    setError(null);
    if (isLast) void create();
    else setStep((s) => Math.min(s + 1, steps.length - 1));
  }
  function back() {
    clearPendingAdvance();
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }
  /** Review step's "Endre" links — jump straight to a given step. */
  function jumpTo(k: StepKey) {
    const idx = steps.indexOf(k);
    if (idx < 0) return;
    clearPendingAdvance();
    setError(null);
    setStep(idx);
  }
  /** Sets a single-select step's value, then advances after a short delay —
   * clicking the option IS the "confirm and move on" action, replacing the
   * step's "Neste" button (see AUTO_ADVANCE_STEPS). */
  function selectAndAdvance<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setError(null);
    clearPendingAdvance();
    advanceTimer.current = setTimeout(() => {
      advanceTimer.current = null;
      setStep((s) => Math.min(s + 1, stepsRef.current.length - 1));
    }, AUTO_ADVANCE_MS);
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
              aria-pressed={format === "league"}
              onClick={() => selectAndAdvance(setFormat, "league")}
            >
              <b>🏅 {no.wizard.formatLeague}</b>
              <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}>
                {no.wizard.formatLeagueSub}
              </span>
            </button>
            <button
              className={`btn btn-block ${format === "cup" ? "btn-primary" : "btn-ghost"}`}
              style={{ textAlign: "left", padding: "12px 16px" }}
              aria-pressed={format === "cup"}
              onClick={() => selectAndAdvance(setFormat, "cup")}
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
          <p className="field" id="rounds-label" style={{ gap: 4 }}>
            {no.wizard.roundsStep}
          </p>
          <div
            className="row"
            role="group"
            aria-labelledby="rounds-label"
            style={{ justifyContent: "center", gap: 18 }}
          >
            <button
              className="btn"
              onClick={() => setLeagueRounds((r) => Math.max(MIN_ROUNDS, r - 1))}
              aria-label={no.wizard.roundsFewer}
            >
              −
            </button>
            <span className="pin-hero" style={{ fontSize: 64 }} aria-live="polite">
              {leagueRounds}
            </span>
            <button
              className="btn"
              onClick={() => setLeagueRounds((r) => Math.min(MAX_ROUNDS, r + 1))}
              aria-label={no.wizard.roundsMore}
            >
              +
            </button>
          </div>
          <span className="muted text-center" style={{ fontSize: 13 }}>
            {no.wizard.roundsHint}
          </span>
          <span className="muted text-center" style={{ fontSize: 12 }}>
            {no.wizard.roundsRuleOfThumb}
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
                aria-pressed={variant === v.id}
                onClick={() => selectAndAdvance(setVariant, v.id)}
              >
                <b>{v.label}</b>
                <span style={{ display: "block", fontSize: 12, opacity: 0.75, fontWeight: 400 }}>
                  {no.wizard.variants[v.id]}
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
              aria-pressed={!playoff}
              onClick={() => selectAndAdvance(setPlayoff, false)}
            >
              {no.wizard.playoffOff}
            </button>
            <button
              className={`btn grow btn-lg ${playoff ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={playoff}
              onClick={() => selectAndAdvance(setPlayoff, true)}
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
                aria-pressed={playoffSize === n}
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
                aria-pressed={timerMin === m}
                onClick={() => selectAndAdvance(setTimerMin, m)}
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
                aria-pressed={teamCount === n}
                onClick={() => selectAndAdvance(setTeamCount, n)}
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
              aria-pressed={!reactions}
              onClick={() => selectAndAdvance(setReactions, false)}
            >
              {no.wizard.reactionsOff}
            </button>
            <button
              className={`btn grow btn-lg ${reactions ? "btn-primary" : "btn-ghost"}`}
              aria-pressed={reactions}
              onClick={() => selectAndAdvance(setReactions, true)}
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
            <ReviewRow label={no.wizard.titleStep} value={title.trim()} onEdit={() => jumpTo("title")} />
          )}
          <ReviewRow
            label={no.wizard.reviewFormat}
            value={format === "cup" ? `🏆 ${no.wizard.formatCup}` : `🏅 ${no.wizard.formatLeague}`}
            onEdit={() => jumpTo("format")}
          />
          {format === "league" && (
            <ReviewRow label={no.wizard.reviewRounds} value={leagueRounds} onEdit={() => jumpTo("rounds")} />
          )}
          <ReviewRow
            label={no.wizard.reviewVariant}
            value={VARIANTS.find((v) => v.id === variant)?.label ?? variant}
            onEdit={() => jumpTo("variant")}
          />
          {format === "league" && (
            <ReviewRow
              label={no.wizard.reviewPlayoff}
              value={playoff ? `${playoffSize}` : no.wizard.none}
              onEdit={() => jumpTo("playoff")}
            />
          )}
          <ReviewRow
            label={no.wizard.reviewTimer}
            value={timerMin === 0 ? no.wizard.none : `${timerMin} ${no.wizard.min}`}
            onEdit={() => jumpTo("timer")}
          />
          {teamCount > 0 && (
            <ReviewRow
              label={no.wizard.reviewTeams}
              value={TEAM_NAMES.slice(0, teamCount).join(", ")}
              onEdit={() => jumpTo("teams")}
            />
          )}
          <ReviewRow
            label={no.wizard.reviewReactions}
            value={reactions ? no.wizard.reactionsOn : no.wizard.reactionsOff}
            onEdit={() => jumpTo("reactions")}
          />
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      <div className="row" style={{ marginTop: 8 }}>
        {(step > 0 || onExit) && (
          <button className="btn btn-ghost" onClick={step > 0 ? back : onExit} disabled={busy}>
            ← {no.common.back}
          </button>
        )}
        {/* Single-select steps advance on tap (selectAndAdvance) — no "Neste"
            needed there; free-input steps (title, rounds), "size" and
            "review" keep it. */}
        {!autoAdvancing && (
          <button className="btn btn-primary grow" onClick={next} disabled={busy}>
            {busy ? <span className="spin" /> : isLast ? no.common.create : no.common.next}
          </button>
        )}
      </div>
    </div>
  );
}

/** One row in the review step: a label, its current value, and an "Endre"
 * link that jumps straight back to the step that set it. */
function ReviewRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: React.ReactNode;
  onEdit: () => void;
}) {
  return (
    <div className="spread">
      <span className="muted">{label}</span>
      <span className="row" style={{ gap: 10, alignItems: "center" }}>
        <b>{value}</b>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
          {no.wizard.edit}
        </button>
      </span>
    </div>
  );
}
