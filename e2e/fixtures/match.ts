import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

import type { StoredPlayer } from "@/lib/client/identity";

// Getting two students onto one live board, without a browser driving the
// teacher's lobby.
//
// Two roads in, on purpose:
//   * `createMatch` uses the /api/dev/quickmatch SEAM — one call, no lobby, no
//     PIN. Fast, and what almost every spec should use.
//   * `publicFlowMatch` uses only PUBLIC routes, exactly as scripts/
//     smoke-features.mjs does. Slower, but it is the one path that proves the
//     seam has not drifted away from the real join flow.

/** localStorage key that `lib/client/identity.ts` reads on mount. */
const PLAYER_KEY = "ttt:player";

export interface Match {
  tournamentId: string;
  gameId: string;
  /** Host bearer code — carried by both helpers for symmetry. */
  hostCode: string;
  /** The X side (server-side "white"), which moves first. */
  white: StoredPlayer;
  /** The O side (server-side "black"). */
  black: StoredPlayer;
}

async function postJson<T>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await request.post(path, { data: body });
  expect(res.status(), `POST ${path} → ${res.status()} ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

/**
 * One live 1v1 game via the test seam, with both bearer identities.
 *
 * Mirrors app/api/dev/quickmatch/route.ts exactly: the response carries
 * `tournamentId` / `gameId` / `hostCode` at the top level and only
 * `{ playerId, resumeCode }` per side — the display name is the one we posted,
 * and it is re-read from the server by `attemptResume` anyway.
 *
 * The seam posts DEFAULT_CONFIG, so the board is the classic 3×3 variant.
 *
 * A 404 here means the server was started WITHOUT `E2E_SEAM=1` (use
 * `npm run e2e:server`), so say so rather than failing on a JSON parse.
 */
export async function createMatch(
  request: APIRequestContext,
  names: { white?: string; black?: string } = {},
): Promise<Match> {
  const white = names.white ?? "Ada";
  const black = names.black ?? "Bo";

  const res = await request.post("/api/dev/quickmatch", { data: { white, black } });
  expect(
    res.status(),
    "POST /api/dev/quickmatch was refused. In a production build the seam only " +
      "opens with E2E_SEAM=1 in the server process — start it with " +
      "`npm run e2e:server`.",
  ).toBe(200);

  const body = (await res.json()) as {
    tournamentId: string;
    gameId: string;
    hostCode: string;
    white: { playerId: string; resumeCode: string };
    black: { playerId: string; resumeCode: string };
  };

  return {
    tournamentId: body.tournamentId,
    gameId: body.gameId,
    hostCode: body.hostCode,
    white: {
      tournamentId: body.tournamentId,
      playerId: body.white.playerId,
      resumeCode: body.white.resumeCode,
      displayName: white,
    },
    black: {
      tournamentId: body.tournamentId,
      playerId: body.black.playerId,
      resumeCode: body.black.resumeCode,
      displayName: black,
    },
  };
}

/**
 * The same end state reached through PUBLIC routes only — create a tournament,
 * two joins on the PIN, start round 1, then read the board back to learn who
 * the pairing made X. Deliberately mirrors scripts/smoke-features.mjs, so one
 * spec can prove the seam's shortcut lands a player in the same place the real
 * flow does.
 */
export async function publicFlowMatch(
  request: APIRequestContext,
  names: { white?: string; black?: string } = {},
): Promise<Match> {
  const nameA = names.white ?? "Ada";
  const nameB = names.black ?? "Bo";

  const t = await postJson<{ id: string; joinPin: string; hostCode: string }>(
    request,
    "/api/tournament",
    { title: "E2E" },
  );

  type Joined = {
    tournamentId: string;
    playerId: string;
    resumeCode: string;
    displayName: string;
  };
  const p1 = await postJson<Joined>(request, "/api/join", {
    pin: t.joinPin,
    displayName: nameA,
  });
  const p2 = await postJson<Joined>(request, "/api/join", {
    pin: t.joinPin,
    displayName: nameB,
  });

  await postJson(request, "/api/round/start", {
    tournamentId: t.id,
    hostCode: t.hostCode,
  });

  const boardRes = await request.get(`/api/tournament/${t.id}`);
  expect(boardRes.status()).toBe(200);
  const board = (await boardRes.json()) as {
    games: {
      id: string;
      status: string;
      whitePlayerId: string;
      blackPlayerId: string | null;
    }[];
  };
  const game = board.games.find((g) => g.status === "live" && g.blackPlayerId);
  expect(game, "round 1 produced no live game with two players").toBeTruthy();

  // The pairing decides who gets X, not the join order.
  const byId: Record<string, Joined> = { [p1.playerId]: p1, [p2.playerId]: p2 };
  const stored = (j: Joined): StoredPlayer => ({
    tournamentId: j.tournamentId,
    playerId: j.playerId,
    resumeCode: j.resumeCode,
    displayName: j.displayName,
  });

  return {
    tournamentId: t.id,
    gameId: game!.id,
    hostCode: t.hostCode,
    white: stored(byId[game!.whitePlayerId]),
    black: stored(byId[game!.blackPlayerId!]),
  };
}

/**
 * Seed one browser context with a player's bearer identity and open their
 * board.
 *
 * The identity goes in through `addInitScript`, so it is already in
 * localStorage before any app code runs — `/play` then walks its REAL path:
 * `attemptResume` → `WaitingRoom` latches the live game → `GameView` mounts.
 * Nothing here fakes a screen; if resume or the latch breaks, this hangs and
 * the spec fails, which is the point.
 *
 * Resolves once `board-shell` AND its cells are on screen — the board is the
 * only proof that all three steps completed.
 */
export async function openAs(
  context: BrowserContext,
  player: StoredPlayer,
): Promise<Page> {
  await context.addInitScript(
    ([key, value]: [string, string]) => {
      // Init scripts also run on the context's initial `about:blank`, where
      // localStorage is an opaque origin and every access throws SecurityError.
      // Unguarded, that throw lands in the trace as a pageError on every single
      // run — a red herring sitting on top of whatever really failed.
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // about:blank; the same script runs again on the real document.
      }
    },
    [PLAYER_KEY, JSON.stringify(player)] as [string, string],
  );

  const page = await context.newPage();
  await page.goto("/play");

  // Budget: one 8 s API timeout (lib/client/api.ts) for the resume call, plus a
  // 5 s board poll (lib/client/useBoardState.ts) to pick up the live game, plus
  // room for a cold first render of the production bundle.
  await expect(page.getByTestId("board-shell")).toBeVisible({ timeout: 25_000 });

  // …and then for a CELL inside it.
  //
  // MnkBoard is a plain CSS grid rendered in the same commit as its wrapper —
  // no `dynamic(..., { ssr: false })` the way the chess board was — so this is
  // a cheap guard rather than the load-bearing second wait it is over there.
  // Deliberately NOT an exact count: the cell count is the tournament's variant
  // (9 / 16 / 25), and a helper that hard-codes 9 would quietly stop working
  // the day a spec asks for a 4×4 board.
  await expect(
    page.getByTestId("board-shell").locator("[data-cell]").first(),
    "the board never mounted inside board-shell",
  ).toBeVisible({ timeout: 20_000 });

  return page;
}
