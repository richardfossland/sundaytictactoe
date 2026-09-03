import "server-only";

import { after } from "next/server";

/**
 * Run `task` AFTER the response has been flushed, never on the response path.
 *
 * Why this exists (R8): the move path used to `await` broadcastPosition →
 * broadcastSpectate → afterGameResolved (which itself awaits recomputeScores,
 * scorePredictions and three more broadcasts) BEFORE returning the move result.
 * Every broadcast is capped at 5 s and every DB call at 12 s, while the client
 * aborts at 8 s — so under load the game-ENDING move (the most memorable one)
 * timed out client-side, rolled the board back to `confirmedFen` and flashed
 * "connection", even though the server had already committed it.
 *
 * None of that work is part of the move's correctness: the `apply_move` RPC has
 * already committed the position atomically. Broadcasts are a hint layer (clients
 * recover on their next poll/reconnect) and score recomputation is derived state.
 * So: respond first, do the side-effects after.
 *
 * On Cloudflare, `after()` is backed by `ctx.waitUntil` — OpenNext's
 * cloudflare-node wrapper passes `waitUntil: ctx.waitUntil.bind(ctx)` into
 * `runWithOpenNextRequestContext`, which installs Next's
 * `Symbol.for("@next/request-context")` provider. The isolate is therefore kept
 * alive until the deferred work settles (Workers allow ~30 s of post-response
 * work; our worst case is ~3 broadcasts × 5 s + DB ≈ 20 s).
 *
 * The catch fallback covers callers OUTSIDE a Next request scope — vitest, the
 * scripts in `scripts/` — where `after()` throws synchronously ("`after` was
 * called outside a request scope"). There we simply fire the task and let it
 * run; nothing is awaiting it either way.
 *
 * Rejections are always swallowed and logged: a failed broadcast must never
 * surface as an unhandled rejection, and by the time it runs the player already
 * has their 200.
 */
export function defer(task: () => Promise<void>, label: string): void {
  const run = () =>
    task().catch((err) => console.error(`[defer:${label}]`, err));
  try {
    after(run);
  } catch {
    // Outside a request scope (tests, scripts): just run it, unawaited.
    void run();
  }
}
