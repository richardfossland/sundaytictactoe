import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The client beacon's pure parts (T5): the rate cap, the dedupe window, the
// device classification, and the privacy rules about what may leave the browser.
// `navigator.sendBeacon` is stubbed, so nothing is sent anywhere — we assert on
// exactly what the module WOULD have posted.

const sendBeacon = vi.fn<(url: string, body?: BodyInit | null) => boolean>(() => true);
const store = new Map<string, string>();

/** The module is a browser module: it no-ops unless `window` exists. Build the
 * smallest environment that makes it run (and a localStorage so `identity`
 * behaves as it does in a real tab). */
function installBrowser(opts: { coarsePointer?: boolean; touchPoints?: number } = {}) {
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", {
    localStorage,
    matchMedia: (q: string) => ({ matches: !!opts.coarsePointer && q.includes("coarse") }),
  });
  vi.stubGlobal("navigator", {
    sendBeacon,
    maxTouchPoints: opts.touchPoints ?? 0,
  });
}

/** The payload of the Nth beacon, parsed. */
function sent(n = 0): Record<string, unknown> {
  return JSON.parse(rawBody(n));
}

/** The exact string handed to sendBeacon — sendBeacon(url, string) is what
 * makes the request text/plain, which is what the route accepts. */
function rawBody(n = 0): string {
  const body = sendBeacon.mock.calls[n]?.[1];
  expect(typeof body).toBe("string");
  return body as string;
}

import { report, uaClass, apiKind, errDetail, __resetTelemetry } from "@/lib/client/telemetry";
import { ApiError } from "@/lib/client/api";

const TID = "11111111-1111-4111-8111-111111111111";
const PID = "22222222-2222-4222-9222-222222222222";
const GID = "33333333-3333-4333-a333-333333333333";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T10:00:00Z"));
  sendBeacon.mockClear();
  sendBeacon.mockReturnValue(true);
  store.clear();
  store.set(
    "ttt:player",
    JSON.stringify({
      tournamentId: TID,
      playerId: PID,
      resumeCode: "KOLE-7F",
      displayName: "Ada",
    }),
  );
  __resetTelemetry();
  installBrowser();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("report()", () => {
  it("posts a text/plain beacon carrying only opaque ids", () => {
    report("watchdog", { gameId: GID, ms: 11000 });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/telemetry");

    const p = sent();
    expect(p.kind).toBe("watchdog");
    expect(p.tournamentId).toBe(TID);
    expect(p.playerId).toBe(PID);
    // gameId is lifted OUT of detail into its own field (its own DB column).
    expect(p.gameId).toBe(GID);
    expect(p.detail).toEqual({ ms: 11000 });
    expect(typeof p.sid).toBe("string");

    // The privacy contract, asserted on the wire: no name, no resume code.
    const raw = rawBody();
    expect(raw).not.toContain("Ada");
    expect(raw).not.toContain("KOLE-7F");
  });

  it("drops nested structures and truncates long strings before sending", () => {
    report("js_error", {
      message: "e".repeat(1000),
      nested: { a: 1 },
      list: [1, 2],
      ok: true,
    });
    const detail = sent().detail as Record<string, unknown>;
    expect((detail.message as string).length).toBe(200);
    expect(detail.ok).toBe(true);
    expect(detail).not.toHaveProperty("nested");
    expect(detail).not.toHaveProperty("list");
  });

  it("omits ids that are not UUIDs (a corrupt stored identity can't leak)", () => {
    store.set("ttt:player", JSON.stringify({ tournamentId: "abc", playerId: "" }));
    report("tab_passive", { gameId: "not-a-uuid" });
    const p = sent();
    expect(p.tournamentId).toBeUndefined();
    expect(p.playerId).toBeUndefined();
    expect(p.gameId).toBeUndefined();
  });

  it("dedupes identical (kind, detail) inside the 5 s window", () => {
    report("channel_error", { status: "TIMED_OUT" });
    report("channel_error", { status: "TIMED_OUT" });
    vi.advanceTimersByTime(4999);
    report("channel_error", { status: "TIMED_OUT" });
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    // A DIFFERENT detail is a different event, even inside the window.
    report("channel_error", { status: "CLOSED" });
    expect(sendBeacon).toHaveBeenCalledTimes(2);

    // …and the same one is allowed again once the window has passed.
    vi.advanceTimersByTime(5001);
    report("channel_error", { status: "TIMED_OUT" });
    expect(sendBeacon).toHaveBeenCalledTimes(3);
  });

  it("caps the tab at 30 events per minute, then lets the next minute through", () => {
    // 40 distinct events (distinct detail → dedupe never applies).
    for (let i = 0; i < 40; i++) report("js_error", { n: i });
    expect(sendBeacon).toHaveBeenCalledTimes(30);

    vi.advanceTimersByTime(60_001);
    report("js_error", { n: 999 });
    expect(sendBeacon).toHaveBeenCalledTimes(31);
  });

  it("falls back to keepalive fetch when sendBeacon refuses the payload", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    sendBeacon.mockReturnValue(false); // queue full — the documented refusal

    report("game_vanished", { gameId: GID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/telemetry");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
  });

  it("never throws, and never sends, on the server (no window)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => report("kick", { reason: "logout" })).not.toThrow();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("never throws when the environment is hostile", () => {
    vi.stubGlobal("navigator", {
      get sendBeacon(): never {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("fetch", () => {
      throw new Error("blocked too");
    });
    expect(() => report("kick", { reason: "logout" })).not.toThrow();
  });
});

describe("uaClass()", () => {
  it("is 'mobile' when the pointer is coarse", () => {
    installBrowser({ coarsePointer: true });
    expect(uaClass()).toBe("mobile");
  });

  it("is 'mobile' when the device reports touch points", () => {
    installBrowser({ coarsePointer: false, touchPoints: 5 });
    expect(uaClass()).toBe("mobile");
  });

  it("is 'desktop' otherwise — and is never the user-agent string", () => {
    installBrowser({ coarsePointer: false, touchPoints: 0 });
    expect(uaClass()).toBe("desktop");
  });

  it("falls back to 'desktop' when matchMedia throws", () => {
    vi.stubGlobal("window", {
      matchMedia: () => {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("navigator", { maxTouchPoints: 0 });
    expect(uaClass()).toBe("desktop");
  });
});

describe("apiKind() / errDetail()", () => {
  it("separates timeout, network and 5xx — the three api_* kinds", () => {
    expect(apiKind(new ApiError(0, "timeout", null))).toBe("api_timeout");
    expect(apiKind(new ApiError(0, "network", null))).toBe("api_network");
    expect(apiKind(new ApiError(503, "server_error", null))).toBe("api_5xx");
    expect(apiKind(new ApiError(404, "not_found", null))).toBe("api_network");
    expect(apiKind(new Error("plain"))).toBe("api_network");
  });

  it("reduces an error to a code + status pair, with no message text", () => {
    expect(errDetail(new ApiError(429, "rate_limited", null))).toEqual({
      code: "rate_limited",
      status: 429,
    });
    expect(errDetail(new Error("secret internals"))).toEqual({
      code: "unknown",
      status: 0,
    });
  });
});
