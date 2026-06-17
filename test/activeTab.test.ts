import { describe, expect, it } from "vitest";
import { moreSenior, type Claim } from "@/lib/client/useActiveTab";

const c = (tabId: string, ts: number): Claim => ({ tabId, ts });

describe("moreSenior", () => {
  it("the newer timestamp wins", () => {
    expect(moreSenior(c("a", 2000), c("b", 1000))).toBe(true);
    expect(moreSenior(c("a", 1000), c("b", 2000))).toBe(false);
  });

  it("breaks same-ms ties deterministically by tabId (so two tabs never both go passive)", () => {
    // For the SAME ts, exactly one ordering is senior — never both, never neither.
    expect(moreSenior(c("b", 1000), c("a", 1000))).toBe(true);
    expect(moreSenior(c("a", 1000), c("b", 1000))).toBe(false);
  });

  it("a claim is not more senior than itself", () => {
    expect(moreSenior(c("a", 1000), c("a", 1000))).toBe(false);
  });
});
