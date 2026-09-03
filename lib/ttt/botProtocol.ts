// The message contract between the solo page and the off-thread bot, kept in a
// pure module so it can be unit-tested in plain Node — a Web Worker itself
// cannot be. `handleBotRequest` is the whole worker; bot.worker.ts is just the
// three lines of postMessage plumbing around it.
//
// Only the VARIANT ID crosses the boundary, never a variant object: structured
// clone would happily copy one, but an id keeps both sides resolving through
// variantById, so an unknown id degrades to the classic 3×3 instead of throwing.

import { chooseMove, type BotLevel } from "@/lib/ttt/bot";
import { variantById } from "@/lib/ttt/variants";

export interface BotRequest {
  /** monotonic per-page id; echoed back so a stale reply can be dropped */
  id: number;
  /** board string, m*n chars of '.'/'x'/'o' */
  state: string;
  variantId: string;
  level: BotLevel;
}

export type BotResponse =
  | { id: number; move: number | null }
  | { id: number; error: string };

const LEVELS: BotLevel[] = ["easy", "medium", "hard", "impossible"];

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
    (LEVELS as string[]).includes(d.level)
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
    const move = chooseMove(data.state, variantById(data.variantId), data.level);
    return { id: data.id, move };
  } catch (e) {
    return { id: data.id, error: e instanceof Error ? e.message : "bot_failed" };
  }
}
