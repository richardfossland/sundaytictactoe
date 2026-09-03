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
  /** Needed to recreate the channel in place (see recreateEntry below). */
  topic: string;
  trackKey: string;
  /** Pending `recreateEntry` timer, or null when the channel is healthy / no
   * consumers remain to serve. */
  recreateTimer: ReturnType<typeof setTimeout> | null;
  /** Index into RECREATE_BACKOFF_MS for the NEXT scheduled recreate; reset to 0
   * by a real SUBSCRIBED (the channel proved itself healthy again). */
  backoffStep: number;
}

const entries = new Map<string, Entry>();

// --- CLOSED/error recovery ---
//
// supabase-js forwards every subscribe status to us, including CLOSED
// (phx_close) — but nothing upstream of this registry ever retries. Left
// alone, a CLOSED socket (a laptop sleeping, a flaky wifi drop, the Realtime
// server bouncing the connection) means every broadcast on that topic goes
// silent forever, healed only by the next poll if the consumer happens to
// have one. This recreates the channel with a capped exponential backoff
// (1s, 2s, 5s, 10s, 30s) so broadcasts resume on their own within seconds of
// the socket coming back, instead of only on the next visible poll.
const RECREATE_BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10000, 30000];

function cancelRecreate(entry: Entry): void {
  if (entry.recreateTimer !== null) {
    clearTimeout(entry.recreateTimer);
    entry.recreateTimer = null;
  }
}

function scheduleRecreate(entry: Entry): void {
  // Nobody left to serve, or already scheduled — nothing to do. (Guards a
  // late/duplicate status callback as much as a real double-schedule.)
  if (entry.subs.size === 0 || entry.recreateTimer !== null) return;
  const step = Math.min(entry.backoffStep, RECREATE_BACKOFF_MS.length - 1);
  entry.backoffStep = Math.min(entry.backoffStep + 1, RECREATE_BACKOFF_MS.length - 1);
  entry.recreateTimer = setTimeout(() => {
    entry.recreateTimer = null;
    recreateEntry(entry);
  }, RECREATE_BACKOFF_MS[step]);
}

/** Destroy the dead channel and create+subscribe a fresh one on the SAME
 * topic, re-binding every current consumer's handlers and re-issuing
 * track() for any that carry a presence key. The Entry object itself is
 * never replaced — only its `channel` field — so release() (which looks the
 * entry up by topic, not by a captured reference) keeps working untouched. */
function recreateEntry(entry: Entry): void {
  if (entry.subs.size === 0) return; // released while the backoff was pending
  destroyChannel(entry.channel);
  entry.channel = createChannel(entry.topic, entry.trackKey);
  bindChannel(entry);
}

/** Wire up broadcast/presence/status handling for `entry.channel`, fanning
 * every event out to `entry.subs`. Shared by the initial acquire and by
 * recreateEntry so a recreated channel behaves identically to the first one.
 *
 * Captures `channel` (the specific RealtimeChannel this binding is for) and
 * checks it against the live `entry.channel` in every callback: once a
 * channel has been superseded by recreateEntry, its own late-arriving events
 * (e.g. the CLOSED that follows OUR OWN destroyChannel call on it) must be
 * ignored rather than mistaken for the new channel dying too. */
function bindChannel(entry: Entry): void {
  const channel = entry.channel;

  channel.on("broadcast", { event: "*" }, (msg) => {
    if (entry.channel !== channel) return;
    const event = (msg.event as string) ?? "";
    const payload = (msg.payload as Record<string, unknown>) ?? {};
    for (const s of entry.subs) s.onBroadcast?.(event, payload);
  });

  const syncPresence = () => {
    if (entry.channel !== channel) return;
    const keys = presentKeys(channel);
    for (const s of entry.subs) s.onPresence?.(keys);
  };
  channel.on("presence", { event: "sync" }, syncPresence);
  channel.on("presence", { event: "join" }, syncPresence);
  channel.on("presence", { event: "leave" }, syncPresence);

  channel.subscribe((status) => {
    if (entry.channel !== channel) return;
    for (const s of entry.subs) s.onStatus?.(status);
    if (status === "SUBSCRIBED") {
      // Proven healthy again — no reconnect pending, and the next failure
      // starts back at the shortest backoff step.
      cancelRecreate(entry);
      entry.backoffStep = 0;
      for (const s of entry.subs) if (s.trackKey) void channel.track({ online: true });
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      scheduleRecreate(entry);
    }
  });
}

// --- Socket-level recovery nudge ---
//
// The heartbeat (client.ts, R4) keeps the socket alive through a hidden tab,
// but a laptop sleep or a real network outage can still drop it, and
// realtime-js's own reconnect backoff can take a while to notice. There's
// only one socket for the whole tab, so ONE listener is enough for every
// topic: the moment the tab is foregrounded or the network returns, nudge it
// to reconnect immediately instead of waiting out whatever backoff it was
// already mid-way through. A no-op if it's already connected.
if (typeof window !== "undefined") {
  const nudgeSocket = () => {
    const rt = createClient().realtime;
    if (!rt.isConnected()) rt.connect();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") nudgeSocket();
  });
  window.addEventListener("online", nudgeSocket);
}

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
  const entry: Entry = {
    channel: createChannel(topic, trackKey),
    subs: new Set([sub]),
    teardown: false,
    topic,
    trackKey,
    recreateTimer: null,
    backoffStep: 0,
  };
  entries.set(topic, entry);
  bindChannel(entry);

  return { channel: entry.channel, release: () => releaseChannel(topic, sub) };
}

/** Send a broadcast on `topic`'s CURRENT shared channel, if one exists. Looked
 * up by topic on every call (rather than a channel object cached by the
 * caller) so a send right after recreateEntry swapped in a fresh channel
 * still lands on the live one instead of silently hitting a destroyed one. A
 * no-op before the first subscribe or after the last release. */
export function sendOnTopic(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  void entries.get(topic)?.channel.send({ type: "broadcast", event, payload });
}

function releaseChannel(topic: string, sub: ChannelSub): void {
  const entry = entries.get(topic);
  if (!entry) return;
  entry.subs.delete(sub);
  if (entry.subs.size > 0) return;
  // Last consumer left — nobody to serve a reconnect for, so cancel any
  // pending recreate rather than let it fire into an empty entry.
  cancelRecreate(entry);
  // Defer teardown one microtask so a synchronous unmount→remount of the SAME
  // topic reuses the channel instead of tearing it down and racing a fresh
  // subscribe against the still-leaving one.
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
