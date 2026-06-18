"use client";

import { createBrowserClient } from "@supabase/ssr";

// Derive the client type from an actual call so the typed Realtime `.on`
// overloads survive (ReturnType<typeof createBrowserClient> would collapse them).
function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Only used for Realtime (schema-agnostic), but set for consistency with the
      // service client in case a direct read is ever added.
      db: { schema: "tictactoe" },
      // SESSION-LESS: this is the DATA project's anon client (Realtime only). The
      // Sunday Account host login lives on a SEPARATE issuer project
      // (lib/supabase/auth-browser.ts). If this client persisted a session it
      // would write its own sb-* cookie and clobber the host's auth cookie — so
      // disable persistence entirely. Anonymous play never needs a session here.
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

/** Memoised across the whole tab so every `useChannel` shares ONE RealtimeClient
 * / WebSocket. Without this, a long projector session that mounts hundreds of
 * game channels would spin up a fresh client (and socket) per subscription. */
let client: ReturnType<typeof makeClient> | null = null;

/** Browser Supabase client (anon key). Used ONLY for Realtime broadcast +
 * presence subscriptions. All authoritative reads/writes go through the
 * server API routes (RLS denies direct table access to anon — see §8). */
export function createClient() {
  if (!client) client = makeClient();
  return client;
}
