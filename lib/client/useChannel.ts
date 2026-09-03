"use client";

import { useCallback, useEffect, useRef } from "react";
import { acquireChannel, sendOnTopic } from "@/lib/supabase/channelRegistry";

type Handler = (event: string, payload: Record<string, unknown>) => void;

/** Subscribe to a Supabase Realtime channel and invoke `onEvent` for every
 * broadcast event on it. Resubscribes when the topic changes. Handlers are kept
 * in refs so consumers don't need to memoise them.
 *
 * `onStatus` (optional) receives the subscribe lifecycle status. Without it, a
 * silently-failed (re)join after a socket blip would stop broadcasts with no
 * signal at all; consumers use it to refetch authoritative state on
 * CHANNEL_ERROR / TIMED_OUT / CLOSED (the poll backstops then keep state fresh
 * while channelRegistry recreates the channel itself in the background, R11).
 *
 * Returns a stable `send(event, payload)` for ephemeral client broadcasts
 * (e.g. emoji reactions) on the same channel — a no-op until subscribed. Sends
 * are routed through the registry BY TOPIC rather than a cached channel
 * object, so a send right after a CLOSED-triggered recreate still lands on
 * the live channel instead of silently hitting the one that got torn down. */
export function useChannel(
  topic: string | null,
  onEvent: Handler,
  onStatus?: (status: string) => void,
): (event: string, payload: Record<string, unknown>) => void {
  const handlerRef = useRef(onEvent);
  const statusRef = useRef(onStatus);
  useEffect(() => {
    handlerRef.current = onEvent;
    statusRef.current = onStatus;
  });

  useEffect(() => {
    if (!topic) return;
    // Guard against missing env in local/dev so the UI still renders.
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    // Shared, ref-counted channel per topic (see channelRegistry). The handlers
    // read the refs so they always see the latest closures.
    const { release } = acquireChannel(topic, {
      onBroadcast: (event, payload) => handlerRef.current(event, payload),
      onStatus: (status) => statusRef.current?.(status),
    });

    return release;
  }, [topic]);

  return useCallback(
    (event: string, payload: Record<string, unknown>) => {
      if (topic) sendOnTopic(topic, event, payload);
    },
    [topic],
  );
}
