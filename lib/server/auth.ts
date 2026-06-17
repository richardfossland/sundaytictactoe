import "server-only";

import { getPlayer, getTournament } from "@/lib/server/store";
import { normalizeResumeCode } from "@/lib/codes";
import type { Player, Tournament } from "@/lib/types";

/** Authenticate a student by their (playerId, resumeCode) bearer pair.
 * Returns the player on success, null otherwise. */
export async function authPlayer(
  playerId: unknown,
  resumeCode: unknown,
): Promise<Player | null> {
  if (typeof playerId !== "string" || typeof resumeCode !== "string") return null;
  const player = await getPlayer(playerId);
  if (!player) return null;
  if (player.resume_code !== normalizeResumeCode(resumeCode)) return null;
  return player;
}

/** Authenticate the teacher for a tournament by its host code. */
export async function authHost(
  tournamentId: unknown,
  hostCode: unknown,
): Promise<Tournament | null> {
  if (typeof tournamentId !== "string" || typeof hostCode !== "string") return null;
  const t = await getTournament(tournamentId);
  if (!t) return null;
  if (t.host_code !== normalizeResumeCode(hostCode)) return null;
  return t;
}
