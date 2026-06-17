import { describe, expect, it } from "vitest";
import { sansFromPgn } from "@/lib/client/MoveList";

describe("sansFromPgn", () => {
  it("splits a TTT pgn (space-separated cells) into a move list", () => {
    expect(sansFromPgn("4 0 8 2")).toEqual(["4", "0", "8", "2"]);
  });

  it("returns [] for an empty or whitespace pgn", () => {
    expect(sansFromPgn("")).toEqual([]);
    expect(sansFromPgn("   ")).toEqual([]);
  });

  it("collapses extra whitespace", () => {
    expect(sansFromPgn("  4   0 ")).toEqual(["4", "0"]);
  });
});
