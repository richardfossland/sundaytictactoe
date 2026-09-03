import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeGet, safeRemove, safeSet } from "@/lib/client/storage";
import { sound } from "@/lib/client/sound";

// vitest runs in the node environment (no jsdom). storage.ts gates on
// `typeof window`, so both a `window` and a `localStorage` need stubbing —
// pointing `window` at globalThis itself (as it is in a real browser) makes
// `window.localStorage` resolve to whichever stub is installed below.

/** Rejects every call the way Safari's "Block All Cookies" setting (or a
 *  cross-site iframe under storage partitioning) makes real localStorage
 *  behave: any property access throws, it doesn't just fail quietly. */
class ThrowingStorage {
  getItem(): never {
    throw new DOMException("blocked", "SecurityError");
  }
  setItem(): never {
    throw new DOMException("blocked", "SecurityError");
  }
  removeItem(): never {
    throw new DOMException("blocked", "SecurityError");
  }
}

// Reused/adapted from test/identity.test.ts.
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
  clear(): void {
    this.m.clear();
  }
}

function installStorage(storage: ThrowingStorage | MemStorage) {
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
  (globalThis as unknown as { window: unknown }).window = globalThis;
}

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("storage guards — unavailable localStorage (SecurityError)", () => {
  beforeEach(() => installStorage(new ThrowingStorage()));

  it("safeGet returns null instead of throwing", () => {
    expect(() => safeGet("any-key")).not.toThrow();
    expect(safeGet("any-key")).toBeNull();
  });

  it("safeSet returns false instead of throwing", () => {
    expect(() => safeSet("any-key", "1")).not.toThrow();
    expect(safeSet("any-key", "1")).toBe(false);
  });

  it("safeRemove returns false instead of throwing", () => {
    expect(() => safeRemove("any-key")).not.toThrow();
    expect(safeRemove("any-key")).toBe(false);
  });

  it("sound.muted() falls back to false instead of throwing", () => {
    expect(() => sound.muted()).not.toThrow();
    expect(sound.muted()).toBe(false);
  });

  it("sound.setMuted() and toggle() don't throw", () => {
    expect(() => sound.setMuted(true)).not.toThrow();
    expect(() => sound.toggle()).not.toThrow();
  });
});

describe("storage guards — working localStorage", () => {
  beforeEach(() => installStorage(new MemStorage()));

  it("safeGet/safeSet/safeRemove round-trip", () => {
    expect(safeGet("k")).toBeNull();
    expect(safeSet("k", "v")).toBe(true);
    expect(safeGet("k")).toBe("v");
    expect(safeRemove("k")).toBe(true);
    expect(safeGet("k")).toBeNull();
  });

  it("sound mute state round-trips", () => {
    expect(sound.muted()).toBe(false);
    sound.setMuted(true);
    expect(sound.muted()).toBe(true);
    const next = sound.toggle();
    expect(next).toBe(false);
    expect(sound.muted()).toBe(false);
  });
});

describe("storage guards — no window (server)", () => {
  it("all helpers degrade without throwing when window is undefined", () => {
    expect(safeGet("k")).toBeNull();
    expect(safeSet("k", "v")).toBe(false);
    expect(safeRemove("k")).toBe(false);
  });
});
