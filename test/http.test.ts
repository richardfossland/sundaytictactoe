import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit, __resetRateLimiter, __bucketCount } from "@/lib/server/http";

afterEach(() => {
  __resetRateLimiter();
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows up to the limit then blocks", () => {
    expect(rateLimit("k", 3, 60_000)).toBe(true);
    expect(rateLimit("k", 3, 60_000)).toBe(true);
    expect(rateLimit("k", 3, 60_000)).toBe(true);
    expect(rateLimit("k", 3, 60_000)).toBe(false);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    expect(rateLimit("k", 1, 1000)).toBe(true);
    expect(rateLimit("k", 1, 1000)).toBe(false);
    vi.setSystemTime(2000);
    expect(rateLimit("k", 1, 1000)).toBe(true);
  });

  it("self-bounds: a busy isolate's bucket map can't grow unbounded (sweeps expired)", () => {
    // Regression for Error 1102: high-cardinality keys (per-player) used to
    // accumulate forever. Seed > MAX_BUCKETS expiring keys, advance past their
    // window, then one more call must sweep them so the map stays bounded.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (let i = 0; i < 10_050; i++) rateLimit("leak:" + i, 1, 1000);
    expect(__bucketCount()).toBeGreaterThan(10_000);
    vi.setSystemTime(60_000); // everything has expired
    rateLimit("trigger", 1, 1000); // size > cap → sweep runs
    expect(__bucketCount()).toBeLessThanOrEqual(10_000);
  });
});
