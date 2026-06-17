import { createTournament, DEFAULT_CONFIG } from "@/lib/server/store";
import { fail, ok, readJson, rateLimit, clientIp } from "@/lib/server/http";
import { isVariant, DEFAULT_VARIANT } from "@/lib/ttt/variants";
import type { TournamentConfig } from "@/lib/types";

// POST /api/tournament — create a tournament. In Phase 1 the config is the
// default; the Phase 4 wizard posts a full config here.
export async function POST(req: Request) {
  if (!rateLimit(`create:${clientIp(req)}`, 10, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ title?: string; config?: Partial<TournamentConfig> }>(req);

  const config: TournamentConfig = { ...DEFAULT_CONFIG, ...(body?.config ?? {}) };
  // Clamp to allowed ranges (defence against a hand-crafted request).
  if (config.format !== "cup") config.format = "league";
  config.leagueRounds = Math.min(7, Math.max(3, Math.round(config.leagueRounds)));
  if (![0, 4, 8, 16].includes(config.playoffSize)) config.playoffSize = 0;
  if (!config.playoff) config.playoffSize = 0;
  if (config.playoff && config.playoffSize === 0) config.playoffSize = 8;
  if (
    config.roundTimerSec !== null &&
    ![300, 600, 900].includes(config.roundTimerSec)
  ) {
    config.roundTimerSec = null;
  }
  config.reactions = config.reactions === true;
  if (!isVariant(config.variant)) config.variant = DEFAULT_VARIANT.id;
  // teams: 2-4 trimmed, unique, non-empty names — else individual tournament
  if (Array.isArray(config.teams)) {
    const names = config.teams
      .map((n) => String(n).trim().slice(0, 20))
      .filter(Boolean);
    config.teams =
      names.length >= 2 && names.length <= 4 && new Set(names).size === names.length
        ? names
        : [];
  } else {
    config.teams = [];
  }

  const title = body?.title?.toString().slice(0, 80).trim() || null;

  try {
    const t = await createTournament(title, config);
    return ok({ id: t.id, joinPin: t.join_pin, hostCode: t.host_code });
  } catch (err) {
    console.error("[create tournament]", err);
    return fail(500, "create_failed");
  }
}
