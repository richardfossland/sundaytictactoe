import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireChannel,
  sendOnTopic,
  __setChannelDriver,
  __entryCount,
} from "@/lib/supabase/channelRegistry";

// A minimal fake RealtimeChannel: records .on bindings, fires SUBSCRIBED on
// subscribe (unless autoSubscribe is turned off — see the backoff tests below,
// which need to keep a channel "down" across several recreates), and lets
// tests push broadcast/presence/status events.
function fakeChannel(opts: { autoSubscribe?: boolean } = {}) {
  const { autoSubscribe = true } = opts;
  const broadcast: ((msg: { event: string; payload: unknown }) => void)[] = [];
  const presence: (() => void)[] = [];
  let subscribeCb: ((s: string) => void) | null = null;
  let state: Record<string, unknown[]> = {};
  const ch = {
    on(type: string, _filter: unknown, cb: (...a: unknown[]) => void) {
      if (type === "broadcast") broadcast.push(cb as never);
      else if (type === "presence") presence.push(cb as never);
      return ch;
    },
    subscribe(cb: (s: string) => void) {
      subscribeCb = cb;
      if (autoSubscribe) cb("SUBSCRIBED");
      return ch;
    },
    track: vi.fn(),
    send: vi.fn(),
    presenceState: () => state,
    // test helpers
    __emit(event: string, payload: unknown) {
      for (const h of broadcast) h({ event, payload });
    },
    __presence(s: Record<string, unknown[]>) {
      state = s;
      for (const h of presence) h();
    },
    __status(s: string) {
      subscribeCb?.(s);
    },
  };
  return ch;
}

afterEach(() => {
  __setChannelDriver(null); // also clears entries
  vi.useRealTimers();
});

describe("channelRegistry", () => {
  it("shares ONE channel per topic and fans broadcasts to every sub", () => {
    const created: ReturnType<typeof fakeChannel>[] = [];
    __setChannelDriver({
      create: () => {
        const c = fakeChannel();
        created.push(c);
        return c as never;
      },
      remove: vi.fn(),
    });

    const a: string[] = [];
    const b: string[] = [];
    const s1 = acquireChannel("game:1", { onBroadcast: (e) => a.push(e) });
    const s2 = acquireChannel("game:1", { onBroadcast: (e) => b.push(e) });

    expect(created).toHaveLength(1); // deduped to one channel
    expect(__entryCount()).toBe(1);

    created[0].__emit("position", {});
    expect(a).toEqual(["position"]);
    expect(b).toEqual(["position"]); // both subs received it

    s1.release();
    s2.release();
  });

  it("ref-counts: removeChannel fires only after the LAST release", async () => {
    const remove = vi.fn();
    __setChannelDriver({ create: () => fakeChannel() as never, remove });

    const s1 = acquireChannel("t", {});
    const s2 = acquireChannel("t", {});

    s1.release();
    await Promise.resolve(); // flush teardown microtask
    expect(remove).not.toHaveBeenCalled(); // s2 still holds it

    s2.release();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(__entryCount()).toBe(0);
  });

  it("reuses the channel on a same-tick release→reacquire (StrictMode/fast nav)", async () => {
    const created: ReturnType<typeof fakeChannel>[] = [];
    const remove = vi.fn();
    __setChannelDriver({
      create: () => {
        const c = fakeChannel();
        created.push(c);
        return c as never;
      },
      remove,
    });

    const s1 = acquireChannel("x", {});
    s1.release(); // last consumer → schedules deferred teardown
    const s2 = acquireChannel("x", {}); // re-acquire before the microtask runs
    await Promise.resolve();

    expect(created).toHaveLength(1); // SAME channel reused, not torn down + recreated
    expect(remove).not.toHaveBeenCalled();

    s2.release();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("tracks presence with a trackKey and drops the empty observer key", () => {
    __setChannelDriver({ create: () => fakeChannel() as never, remove: vi.fn() });
    let present = new Set<string>();
    const sub = acquireChannel("presence:1", {
      trackKey: "player-1",
      onPresence: (keys) => {
        present = keys;
      },
    });
    const ch = sub.channel as unknown as ReturnType<typeof fakeChannel>;
    expect(ch.track).toHaveBeenCalled(); // SUBSCRIBED + trackKey → track()
    ch.__presence({ "player-1": [{}], "": [{}] });
    expect(present).toEqual(new Set(["player-1"])); // "" observer key dropped
    sub.release();
  });

  describe("presence for LATE subscribers (M5)", () => {
    // track() lives in the SUBSCRIBED callback, so anyone who joins an entry
    // that is already subscribed has missed it. Nothing polls presence, so a
    // student who missed it is simply invisible to the host — forever.
    function trackingDriver() {
      const created: { topic: string; trackKey: string; ch: ReturnType<typeof fakeChannel> }[] = [];
      const remove = vi.fn();
      __setChannelDriver({
        create: (topic, trackKey) => {
          const ch = fakeChannel();
          created.push({ topic, trackKey, ch });
          return ch as never;
        },
        remove,
      });
      return { created, remove };
    }

    it("tracks a sub that joins an already-SUBSCRIBED entry with the SAME key", () => {
      const { created } = trackingDriver();
      const s1 = acquireChannel("presence:same", { trackKey: "p1" });
      expect(created).toHaveLength(1);
      expect(created[0].ch.track).toHaveBeenCalledTimes(1);

      const s2 = acquireChannel("presence:same", { trackKey: "p1" });
      expect(created).toHaveLength(1); // same key → no rebuild needed
      expect(created[0].ch.track).toHaveBeenCalledTimes(2); // …but it DID track

      s1.release();
      s2.release();
    });

    it("rebuilds the channel around the key when a keyed sub joins an OBSERVER's entry", () => {
      const { created } = trackingDriver();
      // The host (or any broadcast-only consumer) got here first, so the channel
      // was constructed with the empty observer key — which supabase-js will not
      // let us change on a live channel.
      const observer = acquireChannel("presence:obs", {});
      expect(created[0].trackKey).toBe("");

      const student = acquireChannel("presence:obs", { trackKey: "p9" });
      expect(created).toHaveLength(2);
      expect(created[1].trackKey).toBe("p9"); // …created with the right key
      expect(created[1].ch.track).toHaveBeenCalled();
      // Both consumers are on the NEW channel; the old one was torn down.
      expect(student.channel).toBe(created[1].ch as never);
      const seen: string[] = [];
      const late = acquireChannel("presence:obs", { onBroadcast: (e) => seen.push(e) });
      created[1].ch.__emit("roster", {});
      expect(seen).toEqual(["roster"]);

      observer.release();
      student.release();
      late.release();
    });

    it("a recreate re-tracks EVERY sub that carries a key, not the one frozen at creation", () => {
      vi.useFakeTimers();
      const { created } = trackingDriver();

      // Observer first, so the entry's key would have been frozen at "".
      const observer = acquireChannel("presence:flap", {});
      const a = acquireChannel("presence:flap", { trackKey: "p1" });
      const b = acquireChannel("presence:flap", { trackKey: "p1" });
      const liveIndex = created.length - 1;
      expect(created[liveIndex].trackKey).toBe("p1");

      // The socket drops; the registry recreates on its own backoff.
      created[liveIndex].ch.__status("CLOSED");
      vi.advanceTimersByTime(1000);
      expect(created).toHaveLength(liveIndex + 2);
      const fresh = created[liveIndex + 1];
      expect(fresh.trackKey).toBe("p1"); // re-derived from the subs, not frozen
      expect(fresh.ch.track).toHaveBeenCalledTimes(2); // once per keyed sub

      observer.release();
      a.release();
      b.release();
    });
  });

  it("sendOnTopic sends on the current channel and no-ops for an unknown topic", () => {
    __setChannelDriver({ create: () => fakeChannel() as never, remove: vi.fn() });
    const sub = acquireChannel("game:send", {});
    const ch = sub.channel as unknown as ReturnType<typeof fakeChannel>;

    sendOnTopic("game:send", "reaction", { emoji: "🎉" });
    expect(ch.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "reaction",
      payload: { emoji: "🎉" },
    });

    // No entry for this topic — must not throw.
    expect(() => sendOnTopic("no:such:topic", "x", {})).not.toThrow();

    sub.release();
  });

  describe("CLOSED recovery", () => {
    it("recreates a CLOSED channel after a backoff, and broadcasts resume on the new one", () => {
      vi.useFakeTimers();
      const created: ReturnType<typeof fakeChannel>[] = [];
      __setChannelDriver({
        create: () => {
          const c = fakeChannel();
          created.push(c);
          return c as never;
        },
        remove: vi.fn(),
      });

      const received: string[] = [];
      const sub = acquireChannel("game:closed", {
        onBroadcast: (e) => received.push(e),
      });
      expect(created).toHaveLength(1);

      created[0].__status("CLOSED");
      expect(created).toHaveLength(1); // not yet — waiting out the 1s backoff

      vi.advanceTimersByTime(999);
      expect(created).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(created).toHaveLength(2); // recreated after 1s

      created[1].__emit("position", { fen: "x" });
      expect(received).toEqual(["position"]); // fans out on the NEW channel

      sub.release();
    });

    it("also recreates on CHANNEL_ERROR and on TIMED_OUT, not only CLOSED", () => {
      vi.useFakeTimers();
      const created: ReturnType<typeof fakeChannel>[] = [];
      __setChannelDriver({
        create: () => {
          const c = fakeChannel();
          created.push(c);
          return c as never;
        },
        remove: vi.fn(),
      });

      const sub1 = acquireChannel("game:err", {});
      created[0].__status("CHANNEL_ERROR");
      vi.advanceTimersByTime(1000);
      expect(created).toHaveLength(2); // CHANNEL_ERROR triggers a recreate

      const sub2 = acquireChannel("game:timeout", {});
      created[2].__status("TIMED_OUT");
      vi.advanceTimersByTime(1000);
      expect(created).toHaveLength(4); // TIMED_OUT triggers a recreate too

      sub1.release();
      sub2.release();
    });

    it("cancels a pending recreate once the last consumer releases", async () => {
      vi.useFakeTimers();
      const created: ReturnType<typeof fakeChannel>[] = [];
      const remove = vi.fn();
      __setChannelDriver({
        create: () => {
          const c = fakeChannel();
          created.push(c);
          return c as never;
        },
        remove,
      });

      const sub = acquireChannel("game:gone", {});
      created[0].__status("CLOSED"); // schedules a recreate in 1s

      sub.release();
      await Promise.resolve(); // flush the deferred-teardown microtask
      expect(remove).toHaveBeenCalledTimes(1); // normal teardown ran

      vi.advanceTimersByTime(10000); // well past the 1s backoff
      expect(created).toHaveLength(1); // never recreated — nobody left to serve it
    });

    it("grows the backoff on repeated CLOSED, and a real SUBSCRIBED resets it", () => {
      vi.useFakeTimers();
      const created: ReturnType<typeof fakeChannel>[] = [];
      __setChannelDriver({
        create: () => {
          // Stays "down" until the test explicitly says otherwise, so the
          // channel can fail again immediately after a recreate — the only
          // way to observe the backoff growing across repeated failures.
          const c = fakeChannel({ autoSubscribe: false });
          created.push(c);
          return c as never;
        },
        remove: vi.fn(),
      });

      const sub = acquireChannel("game:flaky", {});
      created[0].__status("CLOSED"); // 1st failure → 1s step

      vi.advanceTimersByTime(1000);
      expect(created).toHaveLength(2);
      created[1].__status("CLOSED"); // still down → 2s step (backoff grew)

      vi.advanceTimersByTime(1999);
      expect(created).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(created).toHaveLength(3); // recreated after the GROWN 2s wait

      created[2].__status("SUBSCRIBED"); // recovers — resets the backoff
      created[2].__status("CLOSED"); // fails again right away

      vi.advanceTimersByTime(999);
      expect(created).toHaveLength(3); // reset backoff means 1s again, not 5s
      vi.advanceTimersByTime(1);
      expect(created).toHaveLength(4);

      sub.release();
    });
  });
});
