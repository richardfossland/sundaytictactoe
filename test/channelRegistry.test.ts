import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireChannel,
  __setChannelDriver,
  __entryCount,
} from "@/lib/supabase/channelRegistry";

// A minimal fake RealtimeChannel: records .on bindings, fires SUBSCRIBED on
// subscribe, and lets tests push broadcast/presence events.
function fakeChannel() {
  const broadcast: ((msg: { event: string; payload: unknown }) => void)[] = [];
  const presence: (() => void)[] = [];
  let state: Record<string, unknown[]> = {};
  const ch = {
    on(type: string, _filter: unknown, cb: (...a: unknown[]) => void) {
      if (type === "broadcast") broadcast.push(cb as never);
      else if (type === "presence") presence.push(cb as never);
      return ch;
    },
    subscribe(cb: (s: string) => void) {
      cb("SUBSCRIBED");
      return ch;
    },
    track: vi.fn(),
    presenceState: () => state,
    // test helpers
    __emit(event: string, payload: unknown) {
      for (const h of broadcast) h({ event, payload });
    },
    __presence(s: Record<string, unknown[]>) {
      state = s;
      for (const h of presence) h();
    },
  };
  return ch;
}

afterEach(() => __setChannelDriver(null)); // also clears entries

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
});
