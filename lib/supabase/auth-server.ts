import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { sharedCookieOptions } from "./cookies";

/**
 * Server-side Sunday Account auth client, bound to the request cookies.
 *
 * Points at the shared **issuer** Supabase project (Sunday Account), which is
 * SEPARATE from this app's DATA project (lib/supabase/service.ts). It is used
 * ONLY to resolve the signed-in host from the session cookie — authorization
 * (allow-list) happens in lib/server/auth.ts. Falls back to the DATA project
 * env when the dedicated auth env is unset so local dev still boots, but in
 * production the two MUST be distinct.
 */
export async function createAuthClient() {
  const url =
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon =
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookieOptions: sharedCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In Server Components cookie writes throw; the middleware refreshes the
        // session, so swallowing here is safe.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op in RSC render context
        }
      },
    },
  });
}
