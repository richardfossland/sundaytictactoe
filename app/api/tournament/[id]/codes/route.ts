import { authHost } from "@/lib/server/auth";
import { listPlayers } from "@/lib/server/store";
import { fail, ok, readJson, hostRateLimit } from "@/lib/server/http";

// POST /api/tournament/[id]/codes — teacher-only (host code). Returns each
// player's resume code so the teacher can read it back to a student who lost it.
// Codes are bearer tokens, so this is gated by the host code and never exposed
// in the public board state.
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePost(req, ctx);
  } catch (err) {
    console.error("[codes]", err);
    return fail(503, "server_error");
  }
}

async function handlePost(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const limited = hostRateLimit(req);
  if (limited) return limited;
  const { id } = await params;
  const body = await readJson<{ hostCode?: string }>(req);

  const t = await authHost(id, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  const players = await listPlayers(id);
  return ok({
    players: players
      .filter((p) => p.status === "active")
      .map((p) => ({
        playerId: p.id,
        name: p.display_name,
        resumeCode: p.resume_code,
      })),
  });
}
