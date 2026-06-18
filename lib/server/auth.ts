import "server-only";

import { createAuthClient } from "@/lib/supabase/auth-server";
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

// ---------------------------------------------------------------------------
// OPTIONAL Sunday Account host login. This is layered ON TOP of the code-based
// host/player auth above — it never replaces it. Anonymous create/join/play and
// the host-code flow keep working with NO signed-in user. The signed-in host
// gets a personal "my turnerings" dashboard; ownership is best-effort.
// ---------------------------------------------------------------------------

export class HostAuthError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

export interface HostUser {
  id: string;
  email: string;
}

/**
 * The ONE authorization spot for the SSO host. Fail-closed: returns false unless
 * the email is explicitly listed in `TICTACTOE_ADMIN_EMAILS` (comma/space/
 * newline separated, case-insensitive). An unset/empty list means NOBODY is
 * allow-listed — the dashboard simply stays inaccessible (anonymous play is
 * unaffected).
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.TICTACTOE_ADMIN_EMAILS;
  if (!raw) return false;
  const allow = raw
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.trim().toLowerCase());
}

/**
 * Resolve the signed-in Sunday Account host from the session cookie and assert
 * they are allow-listed. Throws HostAuthError(401) when not signed in, or
 * HostAuthError(403) when signed in but not on the allow-list. The user identity
 * is taken ONLY from the verified session — never from a request body.
 */
export async function requireHost(): Promise<HostUser> {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new HostAuthError(401, "not_signed_in");
  const email = user.email ?? null;
  if (!isAdminEmail(email)) throw new HostAuthError(403, "not_allowlisted");
  return { id: user.id, email: email! };
}

/**
 * Best-effort, throw-free variant for the create path: returns the signed-in &
 * allow-listed host, or null. Anonymous create MUST keep working, so any auth
 * hiccup degrades to an anonymous (owner-less) tournament rather than failing.
 */
export async function optionalHost(): Promise<HostUser | null> {
  try {
    return await requireHost();
  } catch {
    return null;
  }
}

/** Uniform catch → Response for SSO host API routes. */
export function hostAuthFail(err: unknown): Response | null {
  if (err instanceof HostAuthError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
