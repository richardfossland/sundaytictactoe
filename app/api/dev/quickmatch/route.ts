import {
  addPlayer,
  createGame,
  createRound,
  createTournament,
  DEFAULT_CONFIG,
  updateTournament,
} from "@/lib/server/store";
import { fail, ok, readJson } from "@/lib/server/http";

// POST /api/dev/quickmatch — spin up one 1v1 game with two players, bypassing
// the lobby. This is the Phase 2 test seam (spec §9: "ignore tournaments; just
// get two named players into one game"). Returns both players' bearer
// identities so two browser tabs can play the §4 flow end-to-end.
export async function POST(req: Request) {
  // Test seam only — available in dev, always 404 in a production build.
  if (process.env.NODE_ENV === "production") return fail(404, "not_found");

  const body = await readJson<{ white?: string; black?: string }>(req);
  const whiteName = (body?.white ?? "Hvit").toString().slice(0, 40);
  const blackName = (body?.black ?? "Svart").toString().slice(0, 40);

  try {
    const t = await createTournament("Hurtigparti", DEFAULT_CONFIG);
    await updateTournament(t.id, { status: "league", current_round: 1 });
    const white = await addPlayer(t.id, whiteName);
    const black = await addPlayer(t.id, blackName);
    const round = await createRound(t.id, 1, "league", "live");
    const game = await createGame({
      tournamentId: t.id,
      roundId: round.id,
      whitePlayerId: white.id,
      blackPlayerId: black.id,
    });

    return ok({
      tournamentId: t.id,
      gameId: game.id,
      hostCode: t.host_code,
      white: { playerId: white.id, resumeCode: white.resume_code },
      black: { playerId: black.id, resumeCode: black.resume_code },
    });
  } catch (err) {
    console.error("[quickmatch]", err);
    return fail(500, "quickmatch_failed");
  }
}
