import { authHost } from "@/lib/server/auth";
import { extendRoundRpc, listRounds, setRoundStartedAt } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";

// POST /api/round/extend — the organizer adds +1 minute to the round timer.
// Atomic increment of rounds.extended_ms (RPC, 0007): a double-click adds two
// minutes, and started_at — which is also the chess clocks' t0 — stays fixed
// so extensions never erase time the players already used.
export async function POST(req: Request) {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  const phase = t.status === "playoff" ? "playoff" : "league";
  const rounds = await listRounds(t.id);
  const cur = rounds.find((r) => r.number === t.current_round && r.phase === phase);
  if (!cur || !cur.started_at) return fail(409, "no_round");

  let extendedMs: number | null = null;
  try {
    extendedMs = await extendRoundRpc(cur.id);
  } catch {
    // 0007 not migrated yet — legacy behavior: shift started_at forward.
    // (Known quirk: with chess clocks this also resets used think time.)
    const next = new Date(new Date(cur.started_at).getTime() + 60_000).toISOString();
    await setRoundStartedAt(cur.id, next);
  }
  await broadcast(channels.lobby(t.id), events.tournament, { timerExtended: cur.id });

  return ok({ extendedMs });
}
