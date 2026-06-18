import { afterEach, describe, expect, it, vi } from "vitest";

// Covers isAdminEmail — the ONE allow-list authz spot for the OPTIONAL Sunday
// Account host. It must be fail-closed. We use the REAL lib/server/auth, but stub
// its only side-effecting dependency (the issuer auth client) so importing it
// never pulls next/headers into the plain-Node test env. isAdminEmail itself is
// pure (reads process.env) and is exercised directly.
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: vi.fn(),
}));

import { isAdminEmail } from "@/lib/server/auth";

const saved = process.env.TICTACTOE_ADMIN_EMAILS;
afterEach(() => {
  if (saved === undefined) delete process.env.TICTACTOE_ADMIN_EMAILS;
  else process.env.TICTACTOE_ADMIN_EMAILS = saved;
});

describe("isAdminEmail (fail-closed allow-list)", () => {
  it("returns false when the allow-list is unset (nobody allowed)", () => {
    delete process.env.TICTACTOE_ADMIN_EMAILS;
    expect(isAdminEmail("a@b.no")).toBe(false);
  });

  it("returns false for null / empty email even with a list set", () => {
    process.env.TICTACTOE_ADMIN_EMAILS = "a@b.no";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("matches case-insensitively, trims, and supports comma/space/newline lists", () => {
    process.env.TICTACTOE_ADMIN_EMAILS = "Host@Menighet.no, other@x.no\nthird@x.no";
    expect(isAdminEmail(" host@menighet.no ")).toBe(true);
    expect(isAdminEmail("OTHER@X.NO")).toBe(true);
    expect(isAdminEmail("third@x.no")).toBe(true);
    expect(isAdminEmail("nobody@x.no")).toBe(false);
  });
});
