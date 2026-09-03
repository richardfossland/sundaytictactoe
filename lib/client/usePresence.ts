"use client";

import { useEffect, useRef, useState } from "react";
import { acquireChannel } from "@/lib/supabase/channelRegistry";

/** Track and/or observe Supabase Realtime presence on `topic`.
 *
 * - Pass `trackKey` (a player id) to advertise this client as online under that
 *   key — students do this so the host knows they're connected.
 * - The host passes no `trackKey` and just reads the returned set of online keys.
 *
 * `onStatus` (optional) receives the subscribe lifecycle status, kept in a ref
 * so callers don't need to memoise it (same pattern as useChannel). It matters
 * for presence specifically: an absence only means "that student left" while OUR
 * OWN socket is healthy. A host whose channel errored or re-joined sees an empty
 * presence set that says nothing about the class, and acting on it evicts
 * everyone (see LobbyView).
 *
 * Returns the set of presence keys currently online (recomputed on every
 * sync/join/leave). Shares the one memoised browser client / socket. */
export function usePresence(
  topic: string | null,
  trackKey?: string,
  onStatus?: (status: string) => void,
): Set<string> {
  const [present, setPresent] = useState<Set<string>>(() => new Set());
  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  });

  useEffect(() => {
    if (!topic) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    // Shared, ref-counted channel per topic (see channelRegistry). The registry
    // owns track()/presenceState() and fans the present-key set out to us.
    const { release } = acquireChannel(topic, {
      trackKey,
      onPresence: (keys) => setPresent(keys),
      onStatus: (status) => statusRef.current?.(status),
    });
    return release;
    // trackKey in deps: a key change re-subscribes (so it's never silently
    // ignored). In practice the player id is stable, so no churn.
  }, [topic, trackKey]);

  return present;
}
