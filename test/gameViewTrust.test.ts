import { describe, expect, it } from "vitest";
import { channels } from "@/lib/realtime";
import {
  createReactionGate,
  isBoardString,
  isGameStatus,
  isTurn,
  isValidDrawEvent,
  isValidPositionPayload,
  isValidResultPayload,
  isValidSpectatePosition,
  isValidSpectateResult,
  nextStamp,
  resolveAuthoritative,
} from "@/lib/realtimeTrust";
import { plyOf } from "@/lib/ttt/ply";
import { VARIANTS, variantById } from "@/lib/ttt/variants";

// The pure half of the Realtime trust model (lib/realtimeTrust.ts). What these
// lock down is the rule the broadcast handlers are built on: a payload is a
// hint, an authoritative fetch is the truth, and the ply guard only ever
// arbitrates between two authoritative sources.
//
// Port of sundaychess#101's test/gameViewTrust.test.ts, with FENs replaced by
// the m,n,k board string ('.'/'x'/'o', length m·n, X first).

/** classic 3×3 */
const CELLS = 9;
const EMPTY = ".........";
const AFTER_X_MID = "....x....";
const AFTER_XO = "o...x....";

describe("topic namespace", () => {
  it("prefixes every topic with the app, so the shared Supabase project can't cross apps", () => {
    // lib/realtime.ts used to be byte-identical in SundayChess, and Realtime
    // topics are one flat namespace per project — both apps were listening on
    // the same `game:<id>`.
    expect(channels.game("g1")).toBe("ttt:game:g1");
    expect(channels.lobby("t1")).toBe("ttt:lobby:t1");
    expect(channels.spectate("t1")).toBe("ttt:spectate:t1");
    expect(channels.presence("t1")).toBe("ttt:presence:t1");
  });
});

describe("isBoardString", () => {
  it("accepts the boards this app actually plays", () => {
    expect(isBoardString(EMPTY, CELLS)).toBe(true);
    expect(isBoardString(AFTER_X_MID, CELLS)).toBe(true);
    expect(isBoardString(AFTER_XO, CELLS)).toBe(true);
    expect(isBoardString("xoxoxoxox", CELLS)).toBe(true); // full board, X started
    // every shipped variant (lib/ttt/variants.ts)
    for (const v of VARIANTS) {
      expect(isBoardString(".".repeat(v.m * v.n), v.m * v.n)).toBe(true);
    }
  });

  it("rejects anything that isn't a real board", () => {
    expect(isBoardString(undefined, CELLS)).toBe(false);
    expect(isBoardString(42, CELLS)).toBe(false);
    expect(isBoardString({ fen: EMPTY }, CELLS)).toBe(false);
    expect(isBoardString("", CELLS)).toBe(false);
    // wrong size for THIS variant — the payload doesn't get to pick the board
    expect(isBoardString("................", CELLS)).toBe(false);
    expect(isBoardString("........", CELLS)).toBe(false);
    // a mark tic-tac-toe has never heard of
    expect(isBoardString("....q....", CELLS)).toBe(false);
    expect(isBoardString("....X....", CELLS)).toBe(false); // case matters
    // a cells argument that is not a board size at all
    expect(isBoardString(EMPTY, 0)).toBe(false);
    expect(isBoardString(EMPTY, -9)).toBe(false);
    expect(isBoardString(EMPTY, 9.5)).toBe(false);
  });

  it("rejects a mark count no alternating game could reach", () => {
    // X plays first, so xs - os is always 0 or 1. Five X's and no O is not a
    // position the server can ever have committed — the TTT analogue of a FEN
    // rank that doesn't add up to eight files.
    expect(isBoardString("xxxxx....", CELLS)).toBe(false);
    expect(isBoardString("ox.......", CELLS)).toBe(true); // 1–1
    expect(isBoardString("o........", CELLS)).toBe(false); // O moved first
    expect(isBoardString("oox......", CELLS)).toBe(false); // O ahead
  });
});

describe("isTurn / isGameStatus", () => {
  it("knows the two sides and the six statuses, and nothing else", () => {
    expect(isTurn("w")).toBe(true);
    expect(isTurn("b")).toBe(true);
    expect(isTurn("x")).toBe(false);
    expect(isTurn(null)).toBe(false);

    for (const s of ["live", "white_win", "black_win", "draw", "bye", "aborted"]) {
      expect(isGameStatus(s)).toBe(true);
    }
    expect(isGameStatus("won")).toBe(false);
    expect(isGameStatus(1)).toBe(false);
    expect(isGameStatus(null)).toBe(false);
  });
});

describe("isValidPositionPayload", () => {
  const good = {
    fen: AFTER_X_MID,
    turn: "b",
    status: "live",
    lastMove: { cell: 4 },
  };

  it("accepts what the server sends", () => {
    expect(isValidPositionPayload(good, CELLS)).toBe(true);
    expect(isValidPositionPayload({ fen: AFTER_X_MID, turn: "b", status: "live" }, CELLS)).toBe(
      true,
    );
    expect(
      isValidPositionPayload({ fen: EMPTY, turn: "w", status: "live", lastMove: null }, CELLS),
    ).toBe(true);
  });

  it("drops a payload whose `turn` contradicts the board's own ply parity", () => {
    // One mark placed ⇒ O (b) to move. A payload claiming "w" is not something
    // the server can produce.
    expect(isValidPositionPayload({ ...good, turn: "w" }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ fen: EMPTY, turn: "b", status: "live" }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ fen: AFTER_XO, turn: "w", status: "live" }, CELLS)).toBe(true);
  });

  it("drops malformed pieces rather than letting them reach the board", () => {
    expect(isValidPositionPayload(null, CELLS)).toBe(false);
    expect(isValidPositionPayload("position", CELLS)).toBe(false);
    expect(isValidPositionPayload({ ...good, fen: "not a board" }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ ...good, status: "hacked" }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ ...good, lastMove: { cell: 99 } }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ ...good, lastMove: { cell: -1 } }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ ...good, lastMove: { cell: 1.5 } }, CELLS)).toBe(false);
    expect(isValidPositionPayload({ ...good, lastMove: { cell: "4" } }, CELLS)).toBe(false);
  });

  it("is sized by OUR variant, not by anything the payload claims", () => {
    const big = variantById("5x5");
    const board25 = ".".repeat(25);
    // A 5×5 board is legitimate on a 5×5 tournament…
    expect(
      isValidPositionPayload({ fen: board25, turn: "w", status: "live" }, big.m * big.n),
    ).toBe(true);
    // …and dropped whole on a 3×3 one, however it dresses itself up.
    expect(
      isValidPositionPayload(
        { fen: board25, turn: "w", status: "live", variant: "5x5" },
        CELLS,
      ),
    ).toBe(false);
  });
});

describe("isValidResultPayload / spectate payloads / draw events", () => {
  it("validates a result's status", () => {
    expect(isValidResultPayload({ status: "black_win" })).toBe(true);
    expect(isValidResultPayload({ status: "nope" })).toBe(false);
    expect(isValidResultPayload({})).toBe(false);
    expect(isValidResultPayload(undefined)).toBe(false);
  });

  it("validates the tournament-wide spectate feed", () => {
    expect(isValidSpectatePosition({ gameId: "g1", fen: AFTER_X_MID }, CELLS)).toBe(true);
    expect(isValidSpectatePosition({ gameId: "", fen: AFTER_X_MID }, CELLS)).toBe(false);
    expect(isValidSpectatePosition({ fen: AFTER_X_MID }, CELLS)).toBe(false);
    expect(isValidSpectatePosition({ gameId: "g1", fen: "junk" }, CELLS)).toBe(false);
    expect(isValidSpectatePosition({ gameId: "g1", fen: ".".repeat(25) }, CELLS)).toBe(false);

    expect(isValidSpectateResult({ gameId: "g1", status: "draw" })).toBe(true);
    expect(isValidSpectateResult({ gameId: "g1", status: "draw?" })).toBe(false);
    expect(isValidSpectateResult({ status: "draw" })).toBe(false);
  });

  it("only lets a player in THIS game raise a draw banner", () => {
    const players = new Set(["white", "black"]);
    expect(isValidDrawEvent({ by: "white" }, players)).toBe(true);
    expect(isValidDrawEvent({ by: "someone-else" }, players)).toBe(false);
    expect(isValidDrawEvent({ by: 7 }, players)).toBe(false);
    expect(isValidDrawEvent({}, players)).toBe(false);
    // Before the first load() the roster is empty — drop, don't trust.
    expect(isValidDrawEvent({ by: "white" }, new Set())).toBe(false);
  });
});

describe("resolveAuthoritative", () => {
  it("between two AUTHORITATIVE sources, the monotonic ply guard still rules", () => {
    // A slow in-flight GET resolving after a fresher move must not roll back.
    expect(resolveAuthoritative({ ply: 5 }, { ply: 4, issuedStamp: nextStamp() }, null)).toBe(
      false,
    );
    expect(resolveAuthoritative({ ply: 5 }, { ply: 5, issuedStamp: nextStamp() }, null)).toBe(
      true,
    );
    expect(resolveAuthoritative({ ply: 5 }, { ply: 6, issuedStamp: nextStamp() }, null)).toBe(
      true,
    );
  });

  it("a fetch issued AFTER a provisional wins outright — this is what heals a forged position", () => {
    // The attack: a `position` broadcast claiming ply 400. The old guard
    // accepted it (higher ply) and then blocked every real load for good.
    const provisional = { stamp: nextStamp() };
    const issuedStamp = nextStamp(); // the refetch the broadcast scheduled
    expect(resolveAuthoritative({ ply: 400 }, { ply: 3, issuedStamp }, provisional)).toBe(true);
  });

  it("a fetch already in flight when the broadcast landed proves nothing, so the guard holds", () => {
    // Otherwise a legitimate move would be rolled back off the board by a GET
    // that was sent before the server even had it.
    const issuedStamp = nextStamp();
    const provisional = { stamp: nextStamp() };
    expect(resolveAuthoritative({ ply: 3 }, { ply: 2, issuedStamp }, provisional)).toBe(false);
    // …but it is still adopted when it is not a rollback.
    expect(resolveAuthoritative({ ply: 3 }, { ply: 3, issuedStamp }, provisional)).toBe(true);
  });

  it("stamps are strictly increasing, so the comparison is an order and not a guess", () => {
    const a = nextStamp();
    const b = nextStamp();
    expect(b).toBeGreaterThan(a);
  });

  it("models the whole forged-position episode end to end", () => {
    // Real state: one mark on the board. Forged broadcast: ply 400 — a board a
    // 3×3 game cannot even hold, but the OLD guard only compared plies.
    let shownPly = plyOf(AFTER_X_MID);
    expect(shownPly).toBe(1);
    const provisional = { stamp: nextStamp() };
    shownPly = 400;
    // The refetch the handler scheduled comes back with the truth.
    const issuedStamp = nextStamp();
    const adopt = resolveAuthoritative({ ply: shownPly }, { ply: 1, issuedStamp }, provisional);
    expect(adopt).toBe(true);
    // …and once adopted, nothing provisional is left to override the guard.
    expect(resolveAuthoritative({ ply: 1 }, { ply: 0, issuedStamp: nextStamp() }, null)).toBe(
      false,
    );
  });
});

describe("createReactionGate", () => {
  const ALLOWED = ["👍", "👏", "😄"] as const;
  const senders = new Set(["p1", "p2"]);

  it("passes an allowlisted emoji from a player in the game", () => {
    const gate = createReactionGate(ALLOWED);
    expect(gate({ emoji: "👍", by: "p1" }, senders)).toBe("👍");
  });

  it("drops anything outside the allowlist — including arbitrary strings", () => {
    const gate = createReactionGate(ALLOWED);
    expect(gate({ emoji: "🔥", by: "p1" }, senders)).toBeNull();
    expect(gate({ emoji: "look behind you", by: "p1" }, senders)).toBeNull();
    expect(gate({ emoji: 3, by: "p1" }, senders)).toBeNull();
    expect(gate({ by: "p1" }, senders)).toBeNull();
    expect(gate(null, senders)).toBeNull();
    expect(gate("👍", senders)).toBeNull();
  });

  it("drops a sender who is not one of this game's players", () => {
    const gate = createReactionGate(ALLOWED);
    expect(gate({ emoji: "👍", by: "stranger" }, senders)).toBeNull();
    expect(gate({ emoji: "👍" }, senders)).toBeNull();
    expect(gate({ emoji: "👍", by: "p1" }, new Set())).toBeNull();
  });

  it("caps the overlay at 5 a second and lets it refill", () => {
    let t = 1_000_000;
    const gate = createReactionGate(ALLOWED, 5, () => t);
    for (let i = 0; i < 5; i++) {
      expect(gate({ emoji: "👍", by: "p1" }, senders)).toBe("👍");
    }
    // Sixth inside the same second: dropped, however it is dressed up.
    expect(gate({ emoji: "👏", by: "p2" }, senders)).toBeNull();
    t += 999;
    expect(gate({ emoji: "👏", by: "p2" }, senders)).toBeNull();
    // The window is a full second wide, not a bucket that resets on the hour.
    t += 1;
    expect(gate({ emoji: "👏", by: "p2" }, senders)).toBe("👏");
  });

  it("counts the OVERLAY, not the sender — five spoofed ids fill it just as fast", () => {
    const t = 0;
    const gate = createReactionGate(ALLOWED, 2, () => t);
    expect(gate({ emoji: "👍", by: "p1" }, senders)).toBe("👍");
    expect(gate({ emoji: "👍", by: "p2" }, senders)).toBe("👍");
    expect(gate({ emoji: "👍", by: "p1" }, senders)).toBeNull();
  });
});
