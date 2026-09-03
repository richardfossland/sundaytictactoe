import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { createMatch, openAs, waitForBoard } from "./fixtures/match";
import { readIdentity, seedPlayer } from "./helpers/identity";
import { blockRoute, hangRoute } from "./helpers/net";
import { BoardPage } from "./pages/board";

// What the app does when the thing answering is NOT our API.
//
// Everything stubbed below is HTML with a status code: a Cloudflare error page,
// a WAF challenge, a proxy 4xx. The R1/R3 rule is that such a response is
// evidence about the edge and never about the student's session — so it may make
// the app say "trying again", and it may never end the session, blame the
// student for an illegal move, or throw the board away.
//
// The one response that IS allowed to end a session is our own JSON envelope
// saying the code cannot exist: `{"error":"invalid_code"}`. The last case proves
// the rule still bites, so "never clear" has not quietly become the rule.

test.describe.configure({ mode: "serial" });

const GAME_ROUTE = "**/api/game/*";
const MOVE_ROUTE = "**/api/move";
const RESUME_ROUTE = "**/api/resume";
const EDGE_HTML = "<html><body>edge</body></html>";

test("a 503 edge page on every game poll: the board stays, and it heals", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Ada", black: "Bo" });
  const contexts: BrowserContext[] = [];
  try {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await openAs(ctx, match.white);
    const board = new BoardPage(page);

    // One real move BEFORE the edge goes bad, so "the board stays" is a claim
    // about a position the student actually reached rather than about an empty
    // grid that would look the same after a reset. `/api/move` is not under
    // `/api/game/`, so the stub below leaves it alone.
    await board.clickCell(0);
    await expect.poll(() => board.markAt(0), { timeout: 10_000 }).toBe("x");

    const box = await board.boardBox();
    const restore = await blockRoute(page, GAME_ROUTE, {
      status: 503,
      body: EDGE_HTML,
    });

    // Fifteen seconds is five 3 s poll cycles: `syncFailures` climbs past the
    // >=3 threshold that adds the explicit retry button, so this is the badge in
    // its loudest state — and STILL the board is there.
    const start = Date.now();
    await expect(
      page.getByText(no.player.reconnecting),
      "a run of failed polls never showed the reconnecting badge",
    ).toBeVisible({ timeout: 8_000 });

    while (Date.now() - start < 15_000) {
      await page.waitForTimeout(2_000);
      await expect(board.shell()).toBeVisible();
      expect(await board.markAt(0)).toBe("x");
      await expect(page.getByTestId("join-screen")).toHaveCount(0);
      await expect(page.getByTestId("load-error")).toHaveCount(0);
    }
    expect(await board.boardBox()).toEqual(box);
    expect(
      (await readIdentity(page))?.resumeCode,
      "an edge 503 cleared the student's resume code",
    ).toBe(match.white.resumeCode);

    // ---- the edge comes back ----
    await restore();
    // Budget: two 3 s poll cycles. One success resets `syncFailures` to 0.
    await expect(
      page.getByText(no.player.reconnecting),
      "the badge never cleared after the server came back",
    ).toHaveCount(0, { timeout: 6_000 });
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("a move POST that never answers rolls back inside the fetch deadline", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Cam", black: "Dee" });
  const contexts: BrowserContext[] = [];
  try {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await openAs(ctx, match.white);
    const board = new BoardPage(page);

    const release = await hangRoute(page, MOVE_ROUTE);
    try {
      await board.clickCell(0);
      await expect.poll(() => board.markAt(0), { timeout: 3_000 }).toBe("x");

      // The 8 s deadline in lib/client/api.ts is what settles this, not the
      // server: the response never comes at all. 11 s of budget covers the
      // deadline plus one render.
      await expect(
        board.toast(),
        "a hung move POST produced no toast within the 8 s fetch deadline",
      ).toBeVisible({ timeout: 11_000 });
      await expect(board.toast()).toContainText(no.player.connection);

      // Rolled back to the confirmed position — and the board is still MOUNTED,
      // which is the failure mode a frozen `pending` flag used to produce.
      await expect.poll(() => board.markAt(0), { timeout: 11_000 }).toBeNull();
      await expect(board.shell()).toBeVisible();
      await expect(board.resignButton()).toBeEnabled({ timeout: 11_000 });
    } finally {
      await release();
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("resume behind an edge error keeps the session; only our own verdict ends it", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Eli", black: "Fay" });
  const contexts: BrowserContext[] = [];

  /** Open /play with the identity already on the device, behind a stubbed resume. */
  async function openBehind(stub: {
    status: number;
    body: string;
    contentType?: string;
  }) {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    await seedPlayer(ctx, match.white);
    const page = await ctx.newPage();
    await blockRoute(page, RESUME_ROUTE, stub);
    await page.goto("/play");
    return page;
  }

  try {
    // ---- 503 + HTML: not our API talking. Keep the session, offer a retry. ----
    const onFiveOhThree = await openBehind({ status: 503, body: EDGE_HTML });
    await expect(onFiveOhThree.getByTestId("resume-retry")).toBeVisible({
      timeout: 15_000,
    });
    await expect(onFiveOhThree.getByTestId("join-screen")).toHaveCount(0);
    expect(
      (await readIdentity(onFiveOhThree))?.resumeCode,
      "a 503 edge page ended the student's session",
    ).toBe(match.white.resumeCode);

    // ---- 403 + HTML: a WAF challenge. Same rule — a 4xx is not a verdict
    // unless it came in OUR envelope (`non_json` never kicks). ----
    const onForbidden = await openBehind({ status: 403, body: EDGE_HTML });
    await expect(onForbidden.getByTestId("resume-retry")).toBeVisible({
      timeout: 15_000,
    });
    await expect(onForbidden.getByTestId("join-screen")).toHaveCount(0);
    expect(
      (await readIdentity(onForbidden))?.resumeCode,
      "a WAF 403 ended the student's session",
    ).toBe(match.white.resumeCode);

    // ---- 404 + OUR envelope: this code really is not a player. End it. ----
    const onInvalidCode = await openBehind({
      status: 404,
      body: JSON.stringify({ error: "invalid_code" }),
      contentType: "application/json",
    });
    await expect(onInvalidCode.getByTestId("join-screen")).toBeVisible({
      timeout: 15_000,
    });
    await expect(onInvalidCode.getByText(no.player.sessionExpired)).toBeVisible();
    expect(
      await readIdentity(onInvalidCode),
      "our own invalid_code did NOT clear the stored identity",
    ).toBeNull();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("the board still opens once the edge stops answering for it", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  // The counterpart to the three cases above: after the retry, the real resume
  // runs and the student lands on the live board they never left.
  const match = await createMatch(request, { white: "Gil", black: "Hex" });
  const contexts: BrowserContext[] = [];
  try {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    await seedPlayer(ctx, match.white);
    const page = await ctx.newPage();
    const restore = await blockRoute(page, RESUME_ROUTE, {
      status: 503,
      body: EDGE_HTML,
    });
    await page.goto("/play");
    await expect(page.getByTestId("resume-retry")).toBeVisible({ timeout: 15_000 });

    await restore();
    await page.getByTestId("resume-retry").click();
    await waitForBoard(page);

    // A live board, not merely a mounted shell: the seam's DEFAULT_CONFIG is the
    // classic 3×3, nothing has been played, and ✕ (this student) is to move.
    const board = new BoardPage(page);
    expect(await board.marks()).toEqual(Array(9).fill(null));
    await expect(board.turnBanner()).toContainText(no.player.yourTurn);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
