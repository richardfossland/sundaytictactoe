"use client";

import { useEffect, useRef, useState } from "react";
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

  // The visible timer ticks every second (aria-live="off" below, on both
  // variants) — a screen reader must NOT re-announce it that often. Instead,
  // a separate visually-hidden node announces exactly twice per round: once
  // crossing the 60s mark, once at 0. Keyed by `endMs` so a new round (a
  // fresh `startedAt`) can announce again.
  const [announcement, setAnnouncement] = useState("");
  const announcedRef = useRef<{ endMs: number | null; oneMin: boolean; up: boolean }>({
    endMs: null,
    oneMin: false,
    up: false,
  });
  useEffect(() => {
    if (announcedRef.current.endMs !== endMs) {
      announcedRef.current = { endMs, oneMin: false, up: false };
      setAnnouncement("");
    }
  }, [endMs]);
  useEffect(() => {
    if (remainingMs == null) return;
    if (expired) {
      if (!announcedRef.current.up) {
        announcedRef.current.up = true;
        setAnnouncement(no.host.timeUp);
      }
    } else if (remainingMs < 60_000 && !announcedRef.current.oneMin) {
      announcedRef.current.oneMin = true;
      setAnnouncement(no.host.timerOneMinuteLeft);
    }
  }, [remainingMs, expired]);

  if (remainingMs == null) return null;

  const low = !expired && remainingMs < 60_000;
  const cls = `timer ${expired ? "up" : low ? "low" : ""}`;
  const text = expired ? no.host.timeUp : fmt(remainingMs);

  if (compact) {
    return (
      <span
        className="badge"
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
        <span className="visually-hidden" role="status" aria-live="assertive">
          {announcement}
        </span>
      </span>
    );
  }

  return (
    <div
      className="stack text-center"
      style={{ gap: 2 }}
      role="timer"
      aria-live="off"
      aria-label={no.host.timer}
    >
      <span className="eyebrow" style={{ color: "var(--txt-dim)" }}>
        {no.host.timer}
      </span>
      <span className={cls}>{text}</span>
      <span className="visually-hidden" role="status" aria-live="assertive">
        {announcement}
      </span>
    </div>
  );
}
