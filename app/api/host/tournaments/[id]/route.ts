import { requireHost, hostAuthFail } from "@/lib/server/auth";
import { deleteTournamentOwned } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";

// DELETE /api/host/tournaments/[id] — owner-gated delete. requireHost() enforces
// 401 (not signed in) / 403 (not allow-listed); deleteTournamentOwned() then
// only removes the row when host_user_id matches the signed-in host (404
// not_found otherwise — never leaks whether the id exists for another owner).
// Child rows (players/rounds/games) cascade via FK on delete.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const host = await requireHost();
    const { id } = await ctx.params;
    const deleted = await deleteTournamentOwned(id, host.id);
    if (!deleted) return fail(404, "not_found");
    return ok({ ok: true });
  } catch (err) {
    const authResponse = hostAuthFail(err);
    if (authResponse) return authResponse;
    console.error("[host/tournaments/[id] delete]", err);
    return fail(503, "server_error");
  }
}
