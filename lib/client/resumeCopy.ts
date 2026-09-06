// Shared copy for "the resume/board fetch failed, but the session is fine" —
// used by app/play/page.tsx (resuming a stored session) and WaitingRoom's
// initial-load error card (a poll that never got its first board). Both are
// the SAME family of failure — a blip, a rate-limit, a 5xx, an edge error
// page — so they say the same thing rather than drifting into two different
// vague "noe gikk galt"s.

import { ApiError } from "@/lib/client/api";
import { no } from "@/lib/locale/no";

/** Say WHY, given the status/code an ApiError carries. Shared by both
 * `resumeTrouble` (raw exception) and `resumeTroubleFromStatus` (a caller
 * that only kept the status/code pair, not the exception itself). */
function copyForStatusCode(status: number, code: string | null): string {
  if (status === 0) {
    return code === "timeout" ? no.player.resumeTimeout : no.player.resumeOffline;
  }
  if (status === 429) return no.player.resumeBusy;
  // 5xx, or anything that wasn't our API talking (edge page / WAF / proxy).
  if (status >= 500 || code === "non_json") return no.player.resumeServer;
  return no.player.connection;
}

/** Say WHY the resume failed, for the failures that keep the session. The
 * student can act on "no connection" but not on "noe gikk galt". */
export function resumeTrouble(e: unknown): string {
  if (e instanceof ApiError) return copyForStatusCode(e.status, e.code);
  return no.player.connection;
}

/** Same mapping for a caller that only has the status/code pair — e.g.
 * useBoardState, which never exposes the raw exception, only
 * `errorStatus`/`errorCode` (both null when the failure wasn't an ApiError at
 * all, or nothing has failed). */
export function resumeTroubleFromStatus(
  status: number | null,
  code: string | null,
): string {
  if (status === null) return no.player.connection;
  return copyForStatusCode(status, code);
}
