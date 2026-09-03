import { describe, expect, it } from "vitest";
import {
  generatePin,
  generateResumeCode,
  generateUnique,
  isUuid,
  isValidPin,
  normalizeResumeCode,
  type Rng,
} from "@/lib/codes";

// Deterministic RNG: cycles through a fixed sequence.
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("generatePin", () => {
  it("is always 6 digits", () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateResumeCode", () => {
  it("matches the AAAA-XX shape", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateResumeCode()).toMatch(/^[A-Z]{4}-[A-Z0-9]{2}$/);
    }
  });

  it("never contains ambiguous characters I O 0 1", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateResumeCode();
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("is deterministic under a fixed RNG", () => {
    const a = generateResumeCode(seq([0]));
    const b = generateResumeCode(seq([0]));
    expect(a).toBe(b);
    expect(a).toBe("AAAA-AA");
  });
});

describe("normalizeResumeCode", () => {
  it("uppercases and inserts the dash", () => {
    expect(normalizeResumeCode("kole7f")).toBe("KOLE-7F");
    expect(normalizeResumeCode("kole-7f")).toBe("KOLE-7F");
    expect(normalizeResumeCode(" KOLE 7F ")).toBe("KOLE-7F");
  });
});

describe("isValidPin", () => {
  it("accepts 6 digits only", () => {
    expect(isValidPin("402815")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("abcdef")).toBe(false);
    expect(isValidPin(" 402815 ")).toBe(true);
  });
});

describe("isUuid", () => {
  it("accepts a well-formed v4 UUID, case-insensitively", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("11111111-1111-4111-8111-111111111111".toUpperCase())).toBe(true);
  });

  // Regression: GET /api/tournament/probe (bot scans, stale links) made the
  // store throw Postgres 22P02 for a non-UUID id — a client error the route
  // must catch itself, not let escape as a false 503 (R1b).
  it("rejects a bot-probe / non-UUID string", () => {
    expect(isUuid("probe")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("12345")).toBe(false);
  });

  it("rejects a near-miss shape (wrong segment length, missing dashes)", () => {
    expect(isUuid("11111111-1111-4111-8111-11111111111")).toBe(false); // 11 not 12
    expect(isUuid("111111111111411181111111111111111")).toBe(false); // no dashes
  });

  it("rejects non-string input", () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});

describe("generateUnique", () => {
  it("retries until it finds a free code", () => {
    // First two draws collide with taken set, third is free.
    const taken = new Set(["AAAA-AA", "BBBB-BB"]);
    const rng = seq([0, 0, 0, 0, 0, 0, /* AAAA-AA */ ...new Array(6).fill(0)]);
    // Simpler: provide a gen that returns from a list.
    const codes = ["AAAA-AA", "BBBB-BB", "CCCC-CC"];
    let n = 0;
    const gen = () => codes[n++];
    expect(generateUnique(gen, taken, rng)).toBe("CCCC-CC");
  });
});
