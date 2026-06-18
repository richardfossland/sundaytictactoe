import type { CookieOptions } from "@supabase/ssr";

/**
 * Shared cookie options for every Sunday Account auth client (browser, server,
 * middleware) so the host's session cookie is written identically everywhere.
 *
 * Cross-subdomain SSO (Sunday Account): when `NEXT_PUBLIC_COOKIE_DOMAIN` is set
 * (`.sundaysuite.app` in production), the session cookie is scoped to the parent
 * domain so every Sunday web app shares one host login. Left unset in local dev
 * so cookies keep working on `localhost`.
 *
 * NB: this governs ONLY the host SSO session. Anonymous play/join/board never
 * touch a session cookie — the DATA anon client is session-less (see client.ts).
 */
export function sharedCookieOptions(): CookieOptions {
  const domain = process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim();
  if (!domain) return {};
  return {
    domain,
    path: "/",
    sameSite: "lax",
    secure: true,
  };
}
