// The message contract between the solo page and the off-thread bot, kept in a
// pure module so it can be unit-tested in plain Node — a Web Worker itself
// cannot be. `handleBotRequest` is the whole worker; bot.worker.ts is just the
// three lines of postMessage plumbing around it.
//
// Only the VARIANT ID crosses the boundary, never a variant object: structured
// clone would happily copy one, but an id keeps both sides resolving through
// variantById, so an unknown id degrades to the classic 3×3 instead of throwing.

import { chooseMove, type BotLevel, type BotParams } from "@/lib/ttt/bot";
import { variantById } from "@/lib/ttt/variants";

export interface BotRequest {
  /** monotonic per-page id; echoed back so a stale reply can be dropped */
  id: number;
  /** board string, m*n chars of '.'/'x'/'o' */
  state: string;
  variantId: string;
  level: BotLevel;
  /** Continuous knobs for the adaptive level. When present they REPLACE
   * `level` in the search (see lib/ttt/bot.ts); `level` still has to be a
   * valid one so an old worker build cannot be handed something it would
   * refuse outright. */
  params?: BotParams;
}

export type BotResponse =
  | { id: number; move: number | null }
  | { id: number; error: string };

const LEVELS: BotLevel[] = ["easy", "medium", "hard", "impossible"];

/** Optional difficulty knobs: absent, or a fully-formed pair. A half-valid
 * object is rejected rather than repaired — a NaN depth would search forever
 * and a blunder rate above 1 would make the bot play at random for good. */
function isParams(v: unknown): boolean {
  if (v === undefined) return true;
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.maxDepth === "number" &&
    Number.isFinite(p.maxDepth) &&
    p.maxDepth >= 1 &&
    typeof p.randomMoveProb === "number" &&
    Number.isFinite(p.randomMoveProb) &&
    p.randomMoveProb >= 0 &&
    p.randomMoveProb <= 1
  );
}

/** Is this postMessage payload a request we can act on? Anything can land on a
 * worker's message port, so the worker validates rather than trusting. */
export function isBotRequest(data: unknown): data is BotRequest {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === "number" &&
    Number.isFinite(d.id) &&
    typeof d.state === "string" &&
    typeof d.variantId === "string" &&
    typeof d.level === "string" &&
    (LEVELS as string[]).includes(d.level) &&
    isParams(d.params)
  );
}

export function isErrorResponse(r: BotResponse): r is { id: number; error: string } {
  return "error" in r;
}

/** Run one request. Never throws — a thrown search is reported as an error
 * response so the page can fall back instead of waiting out the timeout. */
export function handleBotRequest(data: unknown): BotResponse {
  if (!isBotRequest(data)) {
    const id = typeof (data as { id?: unknown })?.id === "number"
      ? (data as { id: number }).id
      : -1;
    return { id, error: "bad_request" };
  }
  try {
    const move = chooseMove(
      data.state,
      variantById(data.variantId),
      data.level,
      Math.random,
      data.params,
    );
    return { id: data.id, move };
  } catch (e) {
    return { id: data.id, error: e instanceof Error ? e.message : "bot_failed" };
  }
}
