"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// Why this exists: supabase-js dedupes channels by topic (client.channel(topic)
// returns the SAME RealtimeChannel for a repeated topic) and removeChannel is
// ASYNC (phx_leave → phx_close). So a synchronous unmount→remount of the same
// topic — React StrictMode's dev double-invoke, or a fast route change — used to
// (a) add a SECOND broadcast binding to the shared channel (handlers fire twice)
// and (b) let the first cleanup's removeChannel tear down a channel the remount
// is relying on (broadcasts go silent until a poll heals). This registry shares
// ONE channel + ONE set of bindings per topic, ref-counted, and defers the
// teardown one microtask so a same-tick remount reuses the live channel.

type BroadcastHandler = (event: string, payload: Record<string, unknown>) => void;
type StatusHandler = (status: string) => void;
type PresenceHandler = (keys: Set<string>) => void;

export interface ChannelSub {
  onBroadcast?: BroadcastHandler;
  onStatus?: StatusHandler;
  onPresence?: PresenceHandler;
  /** Presence key to advertise (a player id). Broadcast-only/observer subs omit
   * it. Broadcast and presence never share a topic in this app, so the channel's
   * presence key is unambiguous per topic. */
  trackKey?: string;
}

interface Entry {
  channel: RealtimeChannel;
  subs: Set<ChannelSub>;
  /** True once the last consumer has released; a re-acquire before the deferred
   * teardown runs flips it back to false and reuses the channel. */
  teardown: boolean;
}

const entries = new Map<string, Entry>();

// --- test seam: inject a fake channel create/remove so the lifecycle can be
// unit-tested without a live Supabase socket. ---
export interface ChannelDriver {
  create: (topic: string, trackKey: string) => RealtimeChannel;
  remove: (channel: RealtimeChannel) => void;
}
let driver: ChannelDriver | null = null;
export function __setChannelDriver(d: ChannelDriver | null): void {
  driver = d;
  if (!d) entries.clear();
}

function createChannel(topic: string, trackKey: string): RealtimeChannel {
  if (driver) return driver.create(topic, trackKey);
  // Combined config: broadcast self:false (we never want our own echoes) plus a
  // presence key. The unused half is harmless on a single-purpose topic.
  return createClient().channel(topic, {
    config: { broadcast: { self: false }, presence: { key: trackKey } },
  });
}

function destroyChannel(channel: RealtimeChannel): void {
  if (driver) return driver.remove(channel);
  createClient().removeChannel(channel);
}

function presentKeys(channel: RealtimeChannel): Set<string> {
  const state = channel.presenceState();
  // Drop the empty observer key (host) — only real player ids count.
  return new Set(Object.keys(state).filter((k) => k !== ""));
}

/** Subscribe `sub` to `topic`, sharing one channel per topic. Returns a release
 * fn (call on cleanup). Safe to acquire the same topic from many consumers. */
export function acquireChannel(
  topic: string,
  sub: ChannelSub,
): { channel: RealtimeChannel; release: () => void } {
  const existing = entries.get(topic);
  if (existing) {
    existing.teardown = false; // cancel any pending release
    existing.subs.add(sub);
    // A late joiner gets the current presence immediately (broadcasts are
    // transient — nothing to replay).
    if (sub.onPresence) sub.onPresence(presentKeys(existing.channel));
    return { channel: existing.channel, release: () => releaseChannel(topic, sub) };
  }

  const trackKey = sub.trackKey ?? "";
  const channel = createChannel(topic, trackKey);
  const entry: Entry = { channel, subs: new Set([sub]), teardown: false };
  entries.set(topic, entry);

  channel.on("broadcast", { event: "*" }, (msg) => {
    const event = (msg.event as string) ?? "";
    const payload = (msg.payload as Record<string, unknown>) ?? {};
    for (const s of entry.subs) s.onBroadcast?.(event, payload);
  });

  const syncPresence = () => {
    const keys = presentKeys(channel);
    for (const s of entry.subs) s.onPresence?.(keys);
  };
  channel.on("presence", { event: "sync" }, syncPresence);
  channel.on("presence", { event: "join" }, syncPresence);
  channel.on("presence", { event: "leave" }, syncPresence);

  channel.subscribe((status) => {
    for (const s of entry.subs) s.onStatus?.(status);
    if (status === "SUBSCRIBED" && trackKey) void channel.track({ online: true });
  });

  return { channel, release: () => releaseChannel(topic, sub) };
}

function releaseChannel(topic: string, sub: ChannelSub): void {
  const entry = entries.get(topic);
  if (!entry) return;
  entry.subs.delete(sub);
  if (entry.subs.size > 0) return;
  // Last consumer left. Defer teardown one microtask so a synchronous
  // unmount→remount of the SAME topic reuses the channel instead of tearing it
  // down and racing a fresh subscribe against the still-leaving one.
  entry.teardown = true;
  queueMicrotask(() => {
    const cur = entries.get(topic);
    if (cur && cur.teardown && cur.subs.size === 0) {
      entries.delete(topic);
      destroyChannel(cur.channel);
    }
  });
}

/** Test-only: number of live topic entries. */
export function __entryCount(): number {
  return entries.size;
}
