import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, timedJson } from "@/lib/client/api";

// Minimal Response-like stub; timedJson only reads .ok/.status/.json().
function stubFetch(
  impl: (url: string, init: RequestInit) => Promise<unknown>,
) {
  vi.stubGlobal("fetch", vi.fn(impl as unknown as typeof fetch));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("timedJson — the timeout must span the BODY read", () => {
  it("aborts a stalled response body and throws ApiError('timeout')", async () => {
    // Regression for the freeze bug: headers arrive, then the body stream
    // stalls. The single timeout must abort the in-flight res.json().
    vi.useFakeTimers();
    stubFetch((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            const fail = () => reject(new DOMException("aborted", "AbortError"));
            // Handle either ordering (abort before or after json() is called).
            if (init.signal?.aborted) fail();
            else init.signal?.addEventListener("abort", fail);
          }),
      }),
    );
    const p = timedJson("/api/move", { method: "POST" }, 8000);
    const expectation = expect(p).rejects.toMatchObject({ code: "timeout", status: 0 });
    await vi.advanceTimersByTimeAsync(8000);
    await expectation;
  });

  it("returns {ok,status,data} on success", async () => {
    stubFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ fen: "x" }) }),
    );
    await expect(timedJson("/api/x", {})).resolves.toEqual({
      ok: true,
      status: 200,
      data: { fen: "x" },
    });
  });

  it("maps a network failure to ApiError('network')", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(timedJson("/api/x", {})).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("tolerates a non-JSON body (parse error → empty object)", async () => {
    stubFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("not json")) }),
    );
    await expect(timedJson("/api/x", {})).resolves.toEqual({ ok: true, status: 200, data: {} });
  });
});

describe("api error mapping (via post/getJson)", () => {
  it("api.move maps a non-OK body to ApiError(status, body.error)", async () => {
    stubFetch(() =>
      Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: "stale" }) }),
    );
    const err = await api
      .move({ gameId: "g", cell: 4, playerId: "p", resumeCode: "C" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "stale" });
  });

  it("api.board maps a non-OK response to its caller code", async () => {
    stubFetch(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    await expect(api.board("t1")).rejects.toMatchObject({ status: 500, code: "board_failed" });
  });

  it("api.board returns parsed data on success", async () => {
    const board = { tournament: { id: "t1" }, games: [] };
    stubFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(board) }));
    await expect(api.board("t1")).resolves.toEqual(board);
  });
});
