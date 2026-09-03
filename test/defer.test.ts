import { afterEach, describe, expect, it, vi } from "vitest";

import { defer } from "@/lib/server/defer";

// These tests run OUTSIDE a Next request scope, which is exactly the fallback
// path defer() must survive: `after()` from next/server throws synchronously
// ("`after` was called outside a request scope") there, so defer must catch it
// and run the task itself. Route handlers on Cloudflare take the other branch,
// where OpenNext supplies ctx.waitUntil and the task runs after the response.
describe("defer (outside a request scope)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw, and still runs the task", async () => {
    let ran = false;
    expect(() =>
      defer(async () => {
        ran = true;
      }, "test"),
    ).not.toThrow();
    // Fire-and-forget: it is scheduled, not awaited by the caller.
    await Promise.resolve();
    expect(ran).toBe(true);
  });

  it("swallows a rejection and logs it with the label", async () => {
    const err = new Error("broadcast blew up");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      defer(() => Promise.reject(err), "boom"),
    ).not.toThrow();

    // Let the rejection settle; an unhandled rejection here would fail the run.
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledWith("[defer:boom]", err);
  });

  it("returns before the task finishes (never on the response path)", async () => {
    const order: string[] = [];
    defer(async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("task");
    }, "ordering");
    order.push("caller");

    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(["caller", "task"]);
  });
});
