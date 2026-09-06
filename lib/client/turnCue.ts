"use client";

// The "your turn" cue for a backgrounded tab (R11-adjacent, but a separate
// concern from the poll/channel resync work there).
//
// The problem: while the tab is hidden or the phone is locked, sound.play()
// is the ONLY signal that it's the student's turn — iOS suspends the
// AudioContext, Chrome throttles a background tab's timers, and the poll
// widens to 20s (see GameView's poll effect). A student who pockets the
// phone can miss the whole round. This module adds three more channels, all
// gated on the tab actually being hidden (a visible tab already has the turn
// banner — see `no.player.yourTurn` — so none of this should ever be visible
// while playing normally, and the e2e specs run with the tab visible):
//
//   1. an alternating document.title flash — visible in any tab strip/dock
//      even when the page itself isn't on screen
//   2. a short vibration (mobile)
//   3. an opt-in Notification, shown only once permission was explicitly
//      granted via the NotifyToggle button — this module never calls
//      Notification.requestPermission() itself
//
// Split into pure step functions (easily unit-tested without a DOM) plus one
// small effect hook that drives them — same shape as lib/client/activeTab.ts
// / useActiveTab.ts.

import { useEffect, useRef } from "react";
import { no } from "@/lib/locale/no";
import { safeGet, safeSet } from "@/lib/client/storage";
import { sound } from "@/lib/client/sound";

/** How often the tab title alternates between the flash and the original
 * while it's backgrounded and it's the student's turn. */
const FLASH_INTERVAL_MS = 1000;

/** A short, sharp double-buzz — enough to notice through a pocket, not so
 * long it reads as an incoming call. */
const VIBRATE_PATTERN: number[] = [200, 100, 200];

/** Groups every "your turn" notification under one slot, so a student who
 * missed several turns while away sees only the latest, not a stack. */
const NOTIFICATION_TAG = "ttt-turn";

/** Persisted opt-in flag for the "varsle meg" button (see NotifyToggle.tsx).
 * Every localStorage touch goes through lib/client/storage.ts's safe
 * wrapper — see there for why direct access is unsafe. */
export const NOTIFY_STORAGE_KEY = "ttt:notify";

export function notifyOptedIn(): boolean {
  return safeGet(NOTIFY_STORAGE_KEY) === "1";
}

export function setNotifyOptIn(on: boolean): void {
  safeSet(NOTIFY_STORAGE_KEY, on ? "1" : "0");
}

/** The alternate title shown while it's the student's turn and the tab is
 * backgrounded. Deliberately short (a browser tab has little room) and
 * distinct from every other title in the app so it reads as urgent even
 * clipped in a tab strip. */
export function turnFlashTitle(): string {
  return `▶ ${no.player.turnTitle} – ${no.appName}`;
}

/** Pure: one alternation tick. Flips between `original` and `flash`; treats
 * anything that ISN'T exactly `original` as "currently flashing", so a title
 * nudged by something else mid-cycle collapses back to the flash text rather
 * than getting stuck out of sequence. */
export function nextFlashTitle(current: string, original: string, flash: string): string {
  return current === original ? flash : original;
}

/** Pure: is the whole background cue active right now? All three channels
 * (title flash, vibrate, notification) share this one gate — a visible tab
 * is a flat no-op, on purpose: the in-page turn banner already covers that
 * case, and the e2e specs run with the tab visible. */
export function cueActive(isMyTurn: boolean, live: boolean, hidden: boolean): boolean {
  return isMyTurn && live && hidden;
}

/** State threaded through `stepCueGuard` across ticks — whether the one-shot
 * device cues (vibrate + notification) already fired for the CURRENT turn. */
export interface CueGuardState {
  hasFired: boolean;
}

export const initialGuardState: CueGuardState = { hasFired: false };

export interface CueGuardInput {
  isMyTurn: boolean;
  live: boolean;
  hidden: boolean;
}

/** Pure step function for "fire the one-shot cues at most once per turn
 * change". Edge-triggered on the turn itself, not on hidden/visible — so a
 * tab that goes hidden → visible → hidden again mid-turn, or a routine 3s
 * poll re-confirming the same turn, never re-fires. The guard resets the
 * instant it stops being live/my turn, so the NEXT turn gets a fresh shot. */
export function stepCueGuard(
  state: CueGuardState,
  input: CueGuardInput,
): { fire: boolean; state: CueGuardState } {
  if (!input.isMyTurn || !input.live) return { fire: false, state: initialGuardState };
  if (!input.hidden) return { fire: false, state };
  if (state.hasFired) return { fire: false, state };
  return { fire: true, state: { hasFired: true } };
}

/** Fire the two device-level one-shot cues. Never throws: a browser that
 * blocks vibration, has no Notification API, or rejects the constructor at
 * runtime despite `permission === "granted"` must degrade to doing nothing,
 * never take the render path down with it. Returns the Notification it
 * opened (if any) so the caller can close it once the player looks back. */
export function fireDeviceCues(): Notification | null {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(VIBRATE_PATTERN);
    }
  } catch {
    // best effort only
  }
  try {
    // Never request permission here — only the NotifyToggle button's tap
    // gesture may do that. This is purely "were we already allowed to?".
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      return new Notification(no.player.turnTitle, {
        tag: NOTIFICATION_TAG,
        body: no.player.notifyBody,
        silent: false,
      });
    }
  } catch {
    // ignore — notification unsupported/blocked at runtime
  }
  return null;
}

/** Drives the whole background "your turn" cue for one GameView instance.
 * No-op (and safe) on the server, and never throws — a cue misfiring must
 * never disturb the game itself. */
export function useTurnCue({ isMyTurn, live }: { isMyTurn: boolean; live: boolean }): void {
  const originalTitleRef = useRef<string | null>(null);
  const guardRef = useRef<CueGuardState>(initialGuardState);
  const notifRef = useRef<Notification | null>(null);
  const prevHiddenRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const closeNotification = () => {
      try {
        notifRef.current?.close();
      } catch {
        // ignore
      } finally {
        notifRef.current = null;
      }
    };

    const evaluate = () => {
      try {
        const hidden = document.hidden;
        const active = cueActive(isMyTurn, live, hidden);

        if (active) {
          if (originalTitleRef.current === null) originalTitleRef.current = document.title;
          document.title = nextFlashTitle(
            document.title,
            originalTitleRef.current,
            turnFlashTitle(),
          );
        } else {
          if (originalTitleRef.current !== null) {
            document.title = originalTitleRef.current;
            originalTitleRef.current = null;
          }
          closeNotification();
          // Re-announce the turn the moment the tab becomes visible again —
          // the AudioContext may have been silently suspended while hidden
          // (sound.play() already resumes it; see sound.ts), so a broadcast
          // that arrived while backgrounded can otherwise go unheard even
          // though the position updated correctly underneath.
          if (prevHiddenRef.current === true && !hidden && isMyTurn && live) {
            sound.play("move");
          }
        }
        prevHiddenRef.current = hidden;

        const { fire, state } = stepCueGuard(guardRef.current, { isMyTurn, live, hidden });
        guardRef.current = state;
        if (fire) notifRef.current = fireDeviceCues();
      } catch {
        // A cue failing must never disturb the game itself.
      }
    };

    evaluate(); // covers mount / a prop change while ALREADY hidden
    const flashId = setInterval(evaluate, FLASH_INTERVAL_MS);
    document.addEventListener("visibilitychange", evaluate);
    if (typeof window !== "undefined") window.addEventListener("focus", closeNotification);

    return () => {
      clearInterval(flashId);
      document.removeEventListener("visibilitychange", evaluate);
      if (typeof window !== "undefined") window.removeEventListener("focus", closeNotification);
      closeNotification();
      if (originalTitleRef.current !== null) {
        try {
          document.title = originalTitleRef.current;
        } catch {
          // ignore
        }
        originalTitleRef.current = null;
      }
    };
  }, [isMyTurn, live]);
}
