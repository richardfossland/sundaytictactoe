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
      realtime: {
        // Heartbeat from a Web Worker instead of a main-thread setInterval (R4).
        //
        // Realtime liveness is the Phoenix heartbeat every 25 s. On the main
        // thread that timer is throttled — and on a locked phone or a
        // backgrounded tab it stops altogether — so the server sees a dead
        // socket, drops it, and presence reports the student as GONE. In the
        // lobby that is not cosmetic: the host's ghost-sweep kicks anyone absent
        // past the grace window, so a student who locked their phone came back
        // to a tournament they were no longer in. A Worker's timers are not
        // throttled by the tab being hidden, so the heartbeat keeps going and
        // the socket survives.
        //
        // The default worker is a tiny inline script realtime-js turns into a
        // `blob:` object URL (setInterval → postMessage "keepAlive"); we ship no
        // CSP, so nothing blocks it. `heartbeatIntervalMs` is left at the 25 s
        // default — only WHERE the timer runs changes. If the Worker ever fails,
        // realtime-js terminates it and calls disconnect(), which lands on the
        // normal reconnect path (main-thread heartbeat, i.e. today's behaviour).
        // The feature test is belt-and-braces: realtime-js THROWS from the
        // constructor when `window.Worker` is missing, and a throw here would
        // take down every channel rather than just the heartbeat.
        worker: typeof Worker !== "undefined",
      },
      // SESSION-LESS: this is the DATA project's anon client (Realtime only). The
      // Sunday Account host login lives on a SEPARATE issuer project
      // (lib/supabase/auth-browser.ts). If this client persisted a session it
      // would write its own sb-* cookie and clobber the host's auth cookie — so
      // disable persistence entirely. Anonymous play never needs a session here.
      auth: { persistSession: false, autoRefreshToken: false },
      // @supabase/ssr memoises ONE browser client per module in a browser unless
      // told otherwise — so without this, whichever of the two clients was built
      // first would be handed to the other, and the auth client would end up
      // pointing at the data project (or at this session-less config). Opt out
      // here; `client` below is our own memo.
      isSingleton: false,
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
