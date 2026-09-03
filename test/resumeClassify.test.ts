import { describe, expect, it } from "vitest";
import { ApiError, shouldClearSession } from "@/lib/client/api";

// The rule that decides whether a student stays logged in. Getting this wrong
// throws a class out of a live tournament, so it is spelled out as a truth
// table: ONLY our own API, in its own JSON envelope, saying the session cannot
// exist may end it.

describe("shouldClearSession — only our own invalid_code/not_found ends a session", () => {
  it("clears on our JSON 400 invalid_code (resume code too short / unknown)", () => {
    expect(shouldClearSession(new ApiError(400, "invalid_code", { error: "invalid_code" }))).toBe(
      true,
    );
  });

  it("clears on our JSON 404 invalid_code (not a player in this tournament)", () => {
    expect(shouldClearSession(new ApiError(404, "invalid_code", { error: "invalid_code" }))).toBe(
      true,
    );
  });

  it("clears on our JSON 404 not_found (the tournament is gone)", () => {
    expect(shouldClearSession(new ApiError(404, "not_found", { error: "not_found" }))).toBe(true);
  });

  it("KEEPS the session on a non-JSON 403 (WAF challenge / edge page)", () => {
    expect(shouldClearSession(new ApiError(403, "non_json", null))).toBe(false);
  });

  it("KEEPS the session on a non-JSON 404 (Cloudflare HTML 404, not our API)", () => {
    expect(shouldClearSession(new ApiError(404, "non_json", null))).toBe(false);
  });

  it("KEEPS the session on a non-JSON 400 (proxy rejected the request)", () => {
    expect(shouldClearSession(new ApiError(400, "non_json", null))).toBe(false);
  });

  it("KEEPS the session on 429 (a whole class resuming at once)", () => {
    expect(shouldClearSession(new ApiError(429, "rate_limited", { error: "rate_limited" }))).toBe(
      false,
    );
  });

  it("KEEPS the session on 0 timeout and 0 network (never reached us)", () => {
    expect(shouldClearSession(new ApiError(0, "timeout", null))).toBe(false);
    expect(shouldClearSession(new ApiError(0, "network", null))).toBe(false);
  });

  it("KEEPS the session on 503 server_error and other 5xx", () => {
    expect(shouldClearSession(new ApiError(503, "server_error", { error: "server_error" }))).toBe(
      false,
    );
    expect(shouldClearSession(new ApiError(500, "non_json", null))).toBe(false);
  });

  it("KEEPS the session on 401 (an edge that never reached our route)", () => {
    expect(shouldClearSession(new ApiError(401, "unauthorized", { error: "unauthorized" }))).toBe(
      false,
    );
  });

  it("KEEPS the session on a generic code at a session-ending status", () => {
    // Right status, wrong code: 400 "error" is not a verdict about the session.
    expect(shouldClearSession(new ApiError(400, "error", null))).toBe(false);
    expect(shouldClearSession(new ApiError(404, "board_failed", null))).toBe(false);
  });

  it("KEEPS the session on the right code at a transient status", () => {
    // Right code, wrong status: only 400/404 carry that verdict.
    expect(shouldClearSession(new ApiError(500, "not_found", null))).toBe(false);
    expect(shouldClearSession(new ApiError(0, "invalid_code", null))).toBe(false);
  });

  it("KEEPS the session for non-ApiError values", () => {
    expect(shouldClearSession(new Error("boom"))).toBe(false);
    expect(shouldClearSession(new TypeError("Failed to fetch"))).toBe(false);
    expect(shouldClearSession("invalid_code")).toBe(false);
    expect(shouldClearSession({ status: 404, code: "not_found" })).toBe(false);
    expect(shouldClearSession(null)).toBe(false);
    expect(shouldClearSession(undefined)).toBe(false);
  });
});
