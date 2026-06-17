import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// A stalled DB call must never pin a Cloudflare Worker request until the platform
// kills it (wasted CPU → Error 1102). Bound every PostgREST fetch with a hard
// timeout so a hung query aborts → the route's try/catch returns a clean 503.
const DB_TIMEOUT_MS = 12_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DB_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** Service-role Supabase client — SERVER ONLY. Bypasses RLS, so it must never
 * be imported into client code (the `server-only` guard enforces this at build
 * time). Every state-changing API route uses this. */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  // All tables/functions live in the dedicated `tictactoe` schema (the shared
  // Supabase project also hosts SundayChess on `public`). Setting the schema at
  // the client level routes EVERY .from()/.rpc() here — no per-call .schema().
  // NB: `tictactoe` must be in the project's Exposed schemas (Dashboard → API),
  // or PostgREST returns PGRST106.
  return createSupabaseClient(url, key, {
    db: { schema: "tictactoe" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timedFetch },
  });
}
