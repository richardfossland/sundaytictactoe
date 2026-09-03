import { describe, expect, it } from "vitest";

import * as catchAll from "@/app/api/[...missing]/route";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

describe("/api/[...missing] catch-all", () => {
  it("exports every HTTP method the App Router supports", () => {
    for (const m of METHODS) {
      expect(typeof (catchAll as Record<string, unknown>)[m]).toBe("function");
    }
  });

  it.each(METHODS)("%s answers 404 with a JSON not_found body", async (method) => {
    const handler = (catchAll as unknown as Record<string, () => Response>)[method];
    const res = handler();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    // The whole point: a JSON body, so lib/client/api.ts can read the failure
    // code instead of choking on an HTML not-found page.
    await expect(res.json()).resolves.toEqual({ error: "not_found" });
  });
});
