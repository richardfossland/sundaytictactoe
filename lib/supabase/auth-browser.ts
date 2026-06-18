"use client";

import { createBrowserClient } from "@supabase/ssr";

import { sharedCookieOptions } from "./cookies";

/**
 * Browser Sunday Account auth client. Used ONLY on the host login page to start
 * a magic-link / Google sign-in against the shared **issuer** Supabase project
 * (Sunday Account) — SEPARATE from this app's DATA/Realtime anon client
 * (lib/supabase/client.ts). Falls back to the DATA env when the dedicated auth
 * env is unset so local dev still works.
 */
export function createAuthClient() {
  const url =
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon =
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createBrowserClient(url, anon, {
    cookieOptions: sharedCookieOptions(),
  });
}
