"use client";

import { useCountdown, fmt } from "@/lib/client/useCountdown";
import { no } from "@/lib/locale/no";

/** Round countdown. On the board it's large; on a player's screen (`compact`)
 * it's a small chip. Counts down to `startedAt + durationSec + extendedMs`
 * (extendedMs = the organizer's accumulated "+1 min" extensions). */
export function RoundTimer({
  startedAt,
  durationSec,
  extendedMs = 0,
  compact = false,
}: {
  startedAt: string | null;
  durationSec: number;
  extendedMs?: number;
  compact?: boolean;
}) {
  const endMs = startedAt
    ? new Date(startedAt).getTime() + durationSec * 1000 + extendedMs
    : null;
  const { remainingMs, expired } = useCountdown(endMs);
  if (remainingMs == null) return null;

  const low = !expired && remainingMs < 60_000;
  const cls = `timer ${expired ? "up" : low ? "low" : ""}`;
  const text = expired ? no.host.timeUp : fmt(remainingMs);

  if (compact) {
    return (
      <span
        className={`badge ${expired ? "" : low ? "" : ""}`}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 15,
          fontWeight: 800,
          color: expired ? "var(--danger)" : low ? "var(--warn)" : "var(--txt)",
          borderColor: expired
            ? "color-mix(in srgb, var(--danger) 50%, transparent)"
            : low
              ? "color-mix(in srgb, var(--warn) 50%, transparent)"
              : "var(--ink-line)",
        }}
        role="timer"
        aria-live="off"
      >
        ⏱ {text}
      </span>
    );
  }

  return (
    <div
      className="stack text-center"
      style={{ gap: 2 }}
      role="timer"
      aria-live="polite"
      aria-label={no.host.timer}
    >
      <span className="eyebrow" style={{ color: "var(--txt-dim)" }}>
        {no.host.timer}
      </span>
      <span className={cls}>{text}</span>
    </div>
  );
}
