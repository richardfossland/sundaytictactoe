import { requireHost, hostAuthFail } from "@/lib/server/auth";
import { listTournamentsByOwner } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";

// GET /api/host/tournaments — the signed-in host's own tournaments. Authorized
// by the verified session + allow-list (requireHost). The owner id comes ONLY
// from the session; the query is scoped to host_user_id = me.
export async function GET() {
  try {
    const host = await requireHost();
    const tournaments = await listTournamentsByOwner(host.id);
    return ok({ tournaments });
  } catch (err) {
    const authResponse = hostAuthFail(err);
    if (authResponse) return authResponse;
    console.error("[host/tournaments]", err);
    return fail(503, "server_error");
  }
}
