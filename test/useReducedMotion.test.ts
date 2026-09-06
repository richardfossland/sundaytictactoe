import { describe, expect, it } from "vitest";
import { readReducedMotion } from "@/lib/client/useReducedMotion";

// The React hook itself needs a DOM (this suite runs under vitest's plain
// "node" environment — see vitest.config.ts), so only the pure matcher
// extracted from it is unit-tested here. It's the part carrying the actual
// logic: what the hook does with whatever `matchMedia` returns.
describe("readReducedMotion", () => {
  it("is false when matchMedia reports no preference", () => {
    expect(readReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it("is true when matchMedia reports the reduce-motion preference", () => {
    expect(readReducedMotion(() => ({ matches: true }))).toBe(true);
  });

  it("queries the exact prefers-reduced-motion media string", () => {
    let seen: string | null = null;
    readReducedMotion((q) => {
      seen = q;
      return { matches: false };
    });
    expect(seen).toBe("(prefers-reduced-motion: reduce)");
  });

  it("is false (motion stays on) when matchMedia isn't available — SSR or an unsupported browser", () => {
    expect(readReducedMotion(undefined)).toBe(false);
  });
});
