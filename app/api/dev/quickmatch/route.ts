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
  // Test seam. Open in dev; 404 in a production build UNLESS the process was
  // started with E2E_SEAM=1.
  //
  // WHY TWO VARIABLES. `process.env.NODE_ENV` is INLINED by the compiler, so a
  // production bundle has the literal `"production" === "production"` baked in
  // and no env var can reopen it. `E2E_SEAM` is an ordinary server env var —
  // Next only inlines `NEXT_PUBLIC_*` (node_modules/next/dist/docs/01-app/
  // 02-guides/environment-variables.md) — so it is read from the PROCESS at
  // request time. That is exactly what the e2e suite needs: the same production
  // build we ship, started locally with E2E_SEAM=1, opens the seam without a
  // separate build flavour.
  //
  // ⚠️ E2E_SEAM MUST NEVER BE SET ON THE WORKER. Setting it in production would
  // let anyone mint tournaments, players and games at will. It belongs only in
  // the local/CI `next start` process (`npm run e2e:server`). See docs/E2E.md.
  // Note the strict `!== "1"`: any other value (including "0", "true", "") keeps
  // the seam shut, so a half-set variable fails CLOSED.
  if (process.env.NODE_ENV === "production" && process.env.E2E_SEAM !== "1") {
    return fail(404, "not_found");
  }

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
