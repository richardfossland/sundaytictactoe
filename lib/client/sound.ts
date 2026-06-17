"use client";

// Tiny synthesized sound effects via Web Audio — no audio files, nothing to
// download or license. Each cue is a short envelope-shaped oscillator phrase.
// Muting persists in localStorage. The AudioContext is created lazily on the
// first play() (which in practice happens inside a user gesture — a tap/move —
// so autoplay policies are satisfied).

export type SoundName =
  | "move"
  | "capture"
  | "check"
  | "win"
  | "lose"
  | "draw"
  | "start"
  | "tick";

const MUTE_KEY = "tictactoe:muted";

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** One enveloped tone. Times are relative to "now" in seconds. */
function tone(
  ac: AudioContext,
  freq: number,
  at: number,
  dur: number,
  type: OscillatorType = "triangle",
  peak = 0.18,
  glideTo?: number,
) {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const cues: Record<SoundName, (ac: AudioContext) => void> = {
  // soft wooden "tock"
  move: (ac) => tone(ac, 240, 0, 0.09, "square", 0.1, 160),
  // heavier double thud
  capture: (ac) => {
    tone(ac, 300, 0, 0.07, "square", 0.14, 200);
    tone(ac, 150, 0.05, 0.16, "triangle", 0.2, 90);
  },
  // two-tone alert
  check: (ac) => {
    tone(ac, 660, 0, 0.1, "sine", 0.14);
    tone(ac, 880, 0.11, 0.16, "sine", 0.14);
  },
  // ascending fanfare arpeggio
  win: (ac) => {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => tone(ac, f, i * 0.12, 0.28, "triangle", 0.16));
    tone(ac, 1046.5, 0.52, 0.55, "triangle", 0.14); // held top note
  },
  // gentle descending minor — sad but kind
  lose: (ac) => {
    const notes = [392, 311.13, 261.63]; // G4 Eb4 C4
    notes.forEach((f, i) => tone(ac, f, i * 0.16, 0.3, "sine", 0.12));
  },
  // neutral handshake
  draw: (ac) => {
    tone(ac, 440, 0, 0.14, "sine", 0.12);
    tone(ac, 440, 0.18, 0.22, "sine", 0.12);
  },
  // rising sweep — a round begins
  start: (ac) => tone(ac, 300, 0, 0.4, "sine", 0.14, 640),
  // tiny spectator blip
  tick: (ac) => tone(ac, 950, 0, 0.04, "sine", 0.05),
};

export const sound = {
  muted(): boolean {
    if (typeof window === "undefined") return true;
    return localStorage.getItem(MUTE_KEY) === "1";
  },
  setMuted(m: boolean) {
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      // private mode etc. — sounds just stay session-local
    }
  },
  /** Flip mute; returns the NEW muted state. */
  toggle(): boolean {
    const next = !sound.muted();
    sound.setMuted(next);
    return next;
  },
  play(name: SoundName) {
    if (sound.muted()) return;
    try {
      const ac = audioCtx();
      if (!ac) return;
      if (ac.state === "suspended") {
        // iOS suspends the context on screen lock — play AFTER resume settles,
        // otherwise the tone is scheduled into a dead context and lost.
        ac.resume()
          .then(() => cues[name](ac))
          .catch(() => {});
      } else {
        cues[name](ac);
      }
    } catch {
      // never let a sound failure disturb the game
    }
  },
};
