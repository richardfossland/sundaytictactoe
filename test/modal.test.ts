import { describe, expect, it } from "vitest";
import { nextFocusable } from "@/lib/client/Modal";

// The Tab/Shift+Tab focus trap in Modal.tsx delegates ALL of its cycling logic
// to this pure helper — the only DOM-touching part left in the component is
// building `list` (querySelectorAll) and reading/setting `document.activeElement`,
// neither of which needs a real DOM to exercise this rule.
describe("nextFocusable", () => {
  it("returns null for an empty list", () => {
    expect(nextFocusable([], null, false)).toBeNull();
    expect(nextFocusable([], "a", true)).toBeNull();
  });

  it("moves forward through the list on Tab", () => {
    const list = ["a", "b", "c"];
    expect(nextFocusable(list, "a", false)).toBe("b");
    expect(nextFocusable(list, "b", false)).toBe("c");
  });

  it("wraps from the last back to the first on Tab", () => {
    const list = ["a", "b", "c"];
    expect(nextFocusable(list, "c", false)).toBe("a");
  });

  it("moves backward through the list on Shift+Tab", () => {
    const list = ["a", "b", "c"];
    expect(nextFocusable(list, "c", true)).toBe("b");
    expect(nextFocusable(list, "b", true)).toBe("a");
  });

  it("wraps from the first back to the last on Shift+Tab", () => {
    const list = ["a", "b", "c"];
    expect(nextFocusable(list, "a", true)).toBe("c");
  });

  it("lands on the first element for Tab when nothing is focused yet", () => {
    expect(nextFocusable(["a", "b", "c"], null, false)).toBe("a");
  });

  it("lands on the last element for Shift+Tab when nothing is focused yet", () => {
    expect(nextFocusable(["a", "b", "c"], null, true)).toBe("c");
  });

  it("treats a `current` outside the list the same as nothing focused (focus escaped the trap)", () => {
    const list = ["a", "b", "c"];
    expect(nextFocusable(list, "z", false)).toBe("a");
    expect(nextFocusable(list, "z", true)).toBe("c");
  });

  it("is a no-op cycle of one: a single-item dialog always returns to itself", () => {
    expect(nextFocusable(["only"], "only", false)).toBe("only");
    expect(nextFocusable(["only"], "only", true)).toBe("only");
  });
});
