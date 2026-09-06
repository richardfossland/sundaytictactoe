import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFY_STORAGE_KEY,
  cueActive,
  fireDeviceCues,
  initialGuardState,
  nextFlashTitle,
  notifyOptedIn,
  setNotifyOptIn,
  stepCueGuard,
  turnFlashTitle,
} from "@/lib/client/turnCue";
import { no } from "@/lib/locale/no";

// Node (21+) already defines a read-only, getter-backed global `navigator`
// (no `vibrate`) — a plain `globalThis.navigator = …` throws against that
// descriptor. `Object.defineProperty` replaces it cleanly (it's configurable)
// so each test can install its own stub.
function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

// vitest runs in the node environment (no jsdom/window). The pure step
// functions below take every input as a plain argument, so they need no
// stubbing at all; `fireDeviceCues` and the opt-in persistence touch
// `navigator`/`Notification`/`localStorage` directly and are stubbed on
// globalThis exactly like test/storage.test.ts does for `window`.

describe("turnFlashTitle", () => {
  it("is built from the locale copy, not hardcoded", () => {
    expect(turnFlashTitle()).toBe(`▶ ${no.player.turnTitle} – ${no.appName}`);
  });
});

describe("nextFlashTitle — alternation sequence", () => {
  const original = "SundayTicTacToe — tre-på-rad-turnering for hele gruppa";
  const flash = "▶ DIN TUR – SundayTicTacToe";

  it("alternates flash/original/flash/... starting from the original title", () => {
    let title = original;
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      title = nextFlashTitle(title, original, flash);
      seen.push(title);
    }
    expect(seen).toEqual([flash, original, flash, original, flash]);
  });

  it("treats anything other than the original as 'currently flashing' and collapses back to it", () => {
    // Guards against getting stuck out of sequence if something else nudged
    // document.title mid-cycle.
    expect(nextFlashTitle("something else entirely", original, flash)).toBe(original);
  });
});

describe("cueActive — no-op when the tab isn't hidden", () => {
  it("is active only when it's my turn, the game is live, AND the tab is hidden", () => {
    expect(cueActive(true, true, true)).toBe(true);
  });

  it("is a no-op on a visible tab even mid-turn", () => {
    expect(cueActive(true, true, false)).toBe(false);
  });

  it("is a no-op when it isn't my turn", () => {
    expect(cueActive(false, true, true)).toBe(false);
  });

  it("is a no-op once the game has ended", () => {
    expect(cueActive(true, false, true)).toBe(false);
  });
});

describe("stepCueGuard — fire once per turn change", () => {
  it("fires exactly once while hidden and my turn, then stays silent for the same turn", () => {
    const input = { isMyTurn: true, live: true, hidden: true };
    let state = initialGuardState;

    const first = stepCueGuard(state, input);
    expect(first.fire).toBe(true);
    state = first.state;

    const second = stepCueGuard(state, input);
    expect(second.fire).toBe(false);
    state = second.state;

    const third = stepCueGuard(state, input);
    expect(third.fire).toBe(false);
  });

  it("never fires while the tab is visible (no-op when not hidden)", () => {
    const { fire, state } = stepCueGuard(initialGuardState, {
      isMyTurn: true,
      live: true,
      hidden: false,
    });
    expect(fire).toBe(false);
    expect(state).toEqual(initialGuardState);
  });

  it("never fires when it isn't my turn", () => {
    expect(
      stepCueGuard(initialGuardState, { isMyTurn: false, live: true, hidden: true }).fire,
    ).toBe(false);
  });

  it("never fires once the game has ended", () => {
    expect(
      stepCueGuard(initialGuardState, { isMyTurn: true, live: false, hidden: true }).fire,
    ).toBe(false);
  });

  it("resets the guard once the turn passes, so the NEXT turn can fire again", () => {
    let state = stepCueGuard(initialGuardState, {
      isMyTurn: true,
      live: true,
      hidden: true,
    }).state; // fired once this turn
    state = stepCueGuard(state, { isMyTurn: false, live: true, hidden: true }).state; // turn passed

    const next = stepCueGuard(state, { isMyTurn: true, live: true, hidden: true });
    expect(next.fire).toBe(true);
  });

  it("a hidden → visible → hidden wobble mid-turn does not re-arm the guard", () => {
    let state = stepCueGuard(initialGuardState, {
      isMyTurn: true,
      live: true,
      hidden: true,
    }).state; // fired
    state = stepCueGuard(state, { isMyTurn: true, live: true, hidden: false }).state; // tab visible again, same turn
    const rehidden = stepCueGuard(state, { isMyTurn: true, live: true, hidden: true });
    expect(rehidden.fire).toBe(false);
  });
});

describe("fireDeviceCues — vibration", () => {
  afterEach(() => {
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  });

  it("vibrates with the guard pattern when navigator.vibrate exists", () => {
    const vibrate = vi.fn();
    setNavigator({ vibrate });
    fireDeviceCues();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate.mock.calls[0][0]).toEqual([200, 100, 200]);
  });

  it("never throws when navigator.vibrate is missing", () => {
    setNavigator({});
    expect(() => fireDeviceCues()).not.toThrow();
  });

  it("never throws when navigator.vibrate itself throws", () => {
    setNavigator({
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    expect(() => fireDeviceCues()).not.toThrow();
  });

  it("never calls a navigator.vibrate that isn't a function", () => {
    setNavigator({ vibrate: "nope" });
    expect(() => fireDeviceCues()).not.toThrow();
  });
});

describe("fireDeviceCues — notification, opt-in only", () => {
  afterEach(() => {
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  });

  beforeEach(() => {
    setNavigator({});
  });

  it("shows a tagged, non-silent notification once permission is granted", () => {
    const instances: Array<{ title: string; options: NotificationOptions }> = [];
    class FakeNotification {
      static permission = "granted";
      constructor(title: string, options: NotificationOptions) {
        instances.push({ title, options });
      }
      close() {}
    }
    (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;

    const result = fireDeviceCues();
    expect(instances).toHaveLength(1);
    expect(instances[0].title).toBe(no.player.turnTitle);
    expect(instances[0].options).toMatchObject({ tag: "ttt-turn", silent: false });
    expect(result).not.toBeNull();
  });

  it("never constructs a Notification without prior permission — no automatic prompting", () => {
    class FakeNotification {
      static permission = "default";
      constructor() {
        throw new Error("must not be constructed without permission");
      }
    }
    (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;

    expect(() => fireDeviceCues()).not.toThrow();
    expect(fireDeviceCues()).toBeNull();
  });

  it("never throws when the Notification constructor itself throws", () => {
    class FakeNotification {
      static permission = "granted";
      constructor() {
        throw new Error("blocked by policy");
      }
    }
    (globalThis as unknown as { Notification: unknown }).Notification = FakeNotification;
    expect(() => fireDeviceCues()).not.toThrow();
    expect(fireDeviceCues()).toBeNull();
  });

  it("is a no-op when the Notification API doesn't exist at all", () => {
    expect(() => fireDeviceCues()).not.toThrow();
    expect(fireDeviceCues()).toBeNull();
  });
});

describe("notify opt-in persistence — ttt:notify", () => {
  class MemStorage {
    private m = new Map<string, string>();
    getItem(k: string): string | null {
      return this.m.has(k) ? this.m.get(k)! : null;
    }
    setItem(k: string, v: string): void {
      this.m.set(k, String(v));
    }
    removeItem(k: string): void {
      this.m.delete(k);
    }
  }

  beforeEach(() => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = new MemStorage();
    (globalThis as unknown as { window: unknown }).window = globalThis;
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("uses the documented key", () => {
    expect(NOTIFY_STORAGE_KEY).toBe("ttt:notify");
  });

  it("round-trips the opt-in flag", () => {
    expect(notifyOptedIn()).toBe(false);
    setNotifyOptIn(true);
    expect(notifyOptedIn()).toBe(true);
    setNotifyOptIn(false);
    expect(notifyOptedIn()).toBe(false);
  });

  it("defaults to false without throwing when storage is unavailable (server / blocked)", () => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(() => notifyOptedIn()).not.toThrow();
    expect(notifyOptedIn()).toBe(false);
  });
});
