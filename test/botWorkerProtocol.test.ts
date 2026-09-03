// The Web Worker itself can't run under the plain Node test env, so the whole
// of its behaviour lives in botProtocol and is tested here: what counts as a
// request, what comes back, and that nothing thrown inside ever escapes.

import { describe, it, expect } from "vitest";
import {
  handleBotRequest,
  isBotRequest,
  isErrorResponse,
  type BotRequest,
} from "@/lib/ttt/botProtocol";
import { chooseMove } from "@/lib/ttt/bot";
import { variantById } from "@/lib/ttt/variants";

const req = (over: Partial<BotRequest> = {}): BotRequest => ({
  id: 1,
  state: ".........",
  variantId: "3x3",
  level: "impossible",
  ...over,
});

describe("isBotRequest", () => {
  it("accepts a well-formed request", () => {
    expect(isBotRequest(req())).toBe(true);
  });
  it("rejects non-objects and nulls", () => {
    for (const bad of [null, undefined, 7, "hi", true, []]) {
      expect(isBotRequest(bad)).toBe(false);
    }
  });
  it("rejects a missing or mistyped field", () => {
    expect(isBotRequest({ ...req(), id: "1" })).toBe(false);
    expect(isBotRequest({ ...req(), id: Number.NaN })).toBe(false);
    expect(isBotRequest({ ...req(), state: 3 })).toBe(false);
    expect(isBotRequest({ ...req(), variantId: null })).toBe(false);
    const { level: _drop, ...noLevel } = req();
    void _drop;
    expect(isBotRequest(noLevel)).toBe(false);
  });
  it("rejects an unknown difficulty level", () => {
    expect(isBotRequest({ ...req(), level: "godmode" })).toBe(false);
  });
});

describe("handleBotRequest", () => {
  it("echoes the request id so a stale reply can be told apart", () => {
    const res = handleBotRequest(req({ id: 42 }));
    expect(res.id).toBe(42);
  });

  it("returns exactly what chooseMove would return on the main thread", () => {
    for (const [variantId, state] of [
      ["3x3", "xx.oo...."],
      ["3x3", "xx..o...."],
      ["4x4", "....x.....o....."],
      ["5x5", "......x.....o............"],
    ] as const) {
      const v = variantById(variantId);
      const res = handleBotRequest(req({ state, variantId, level: "impossible" }));
      expect(isErrorResponse(res)).toBe(false);
      if (isErrorResponse(res)) return;
      expect(res.move).toBe(chooseMove(state, v, "impossible"));
    }
  });

  it("returns move null on a finished board rather than an error", () => {
    const res = handleBotRequest(req({ state: "xxxoo...." }));
    expect(res).toEqual({ id: 1, move: null });
  });

  it("reports a malformed payload as an error, keeping the id when it has one", () => {
    expect(handleBotRequest({ id: 9, nonsense: true })).toEqual({
      id: 9,
      error: "bad_request",
    });
    expect(handleBotRequest("not a request")).toEqual({ id: -1, error: "bad_request" });
    expect(handleBotRequest(null)).toEqual({ id: -1, error: "bad_request" });
  });

  it("degrades an unknown variant id to 3×3 instead of throwing", () => {
    const res = handleBotRequest(req({ variantId: "9x9" }));
    expect(isErrorResponse(res)).toBe(false);
    if (isErrorResponse(res)) return;
    expect(res.move).toBe(chooseMove(".........", variantById("9x9"), "impossible"));
  });

  it("never throws, whatever the state string is", () => {
    for (const state of ["", "..", "zzzzzzzzz", ".".repeat(200)]) {
      expect(() => handleBotRequest(req({ state }))).not.toThrow();
    }
  });
});
