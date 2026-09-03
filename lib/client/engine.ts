"use client";

// Client gateway to the tic-tac-toe bot. Prefers an off-thread Web Worker so the
// bot's think never freezes the tab; if the worker can't be created (old
// browser / SSR / bundling issue) or fails to answer, it falls back to the same
// synchronous search on the main thread. Either way the UI always gets a move.
//
// Ported from the chess app's lib/client/engine.ts — same demotion and timeout
// rules, so the two apps fail the same way.

import { chooseMove, type BotLevel } from "@/lib/ttt/bot";
import { isErrorResponse, type BotResponse } from "@/lib/ttt/botProtocol";
import type { MnkVariant } from "@/lib/ttt/variants";

/** How long to wait for the worker before giving up on it for good. The search
 * itself is single-digit milliseconds; anything near this means it is wedged. */
const WORKER_TIMEOUT_MS = 5000;

// undefined = not tried yet, null = unavailable (use the fallback).
let worker: Worker | null | undefined;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL("../ttt/bot.worker.ts", import.meta.url), {
      type: "module",
    });
    // If the worker module fails to load or errors, demote permanently to the
    // synchronous fallback — otherwise every later move would post to a dead
    // worker and eat the full timeout before falling back.
    w.onerror = () => {
      worker = null;
    };
    w.onmessageerror = () => {
      worker = null;
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Test seam: forget any worker decision made so far. */
export function resetEngineForTests(): void {
  worker = undefined;
}

let seq = 0;

/** The bot's move for a position. Always resolves (never rejects); null means
 * the board is already finished. */
export function requestBotMove(
  state: string,
  variant: MnkVariant,
  level: BotLevel,
): Promise<number | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(chooseMove(state, variant, level));

  return new Promise((resolve) => {
    const id = ++seq;
    let settled = false;
    const finish = (move: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener("message", onMsg);
      resolve(move);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as BotResponse | undefined;
      // Ignore replies to earlier requests — a superseded search that finishes
      // late must not answer the question we are asking now.
      if (!d || d.id !== id) return;
      if (isErrorResponse(d)) finish(chooseMove(state, variant, level));
      else finish(d.move ?? null);
    };
    // If the worker dies or never replies, demote it (so the NEXT move skips it
    // instead of waiting another 5s) and compute on the main thread now.
    const timer = setTimeout(() => {
      worker = null;
      finish(chooseMove(state, variant, level));
    }, WORKER_TIMEOUT_MS);
    w.addEventListener("message", onMsg);
    w.postMessage({ id, state, variantId: variant.id, level });
  });
}
