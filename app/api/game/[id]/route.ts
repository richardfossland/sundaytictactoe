import { getGame, getPlayer } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";
import type { GameDetail } from "@/lib/dto";

/** Last move = the final cell in the space-separated move list (pgn). */
function lastCellFromPgn(pgn: string): { cell: number } | null {
  const parts = pgn.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const cell = Number(parts[parts.length - 1]);
  return Number.isInteger(cell) ? { cell } : null;
}

// GET /api/game/[id] — authoritative game state for reconnect/resume (spec §4).
// Public: contains no secrets (no resume codes).
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handleGet(req, ctx);
  } catch (err) {
    console.error("[game/[id]]", err);
    return fail(503, "server_error");
  }
}

async function handleGet(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const game = await getGame(id);
  if (!game) return fail(404, "no_game");

  const [white, black] = await Promise.all([
    getPlayer(game.white_player_id),
    game.black_player_id ? getPlayer(game.black_player_id) : Promise.resolve(null),
  ]);

  const detail: GameDetail = {
    id: game.id,
    tournamentId: game.tournament_id,
    roundId: game.round_id,
    fen: game.fen,
    pgn: game.pgn,
    status: game.status,
    turn: game.turn,
    white: { id: game.white_player_id, name: white?.display_name ?? "?" },
    black: black ? { id: black.id, name: black.display_name } : null,
    lastMove: lastCellFromPgn(game.pgn),
    drawOfferedBy: game.draw_offered_by ?? null,
  };
  return ok(detail);
}
