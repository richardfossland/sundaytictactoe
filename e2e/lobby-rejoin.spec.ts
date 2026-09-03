import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { no } from "@/lib/locale/no";
import type { StoredPlayer } from "@/lib/client/identity";
import { countRequests } from "./helpers/net";
import { seedHostCode, seedPlayer } from "./helpers/identity";

// The lobby ghost-sweep (R4), from both ends.
//
// The sweep exists because a student who closes the app sits in the roster
// forever and blocks the pairing. It is also the single most dangerous automatic
// action in the product: it removes a real child from a real tournament, on
// evidence (a missing presence key) that a locked phone produces just as readily
// as a departure. So it is gated three ways — the player must have CONNECTED
// once, the host's own socket must be healthy and visible, and the absence must
// have lasted AUTO_KICK_MS (3 minutes, LobbyView).
//
// Three minutes is longer than any spec should hold a runner, so the two halves
// are asserted separately:
//
//   * the GATE: a student who vanishes is NOT kicked in the first 45 seconds,
//     even though the sweep ticks every 30 s and the host can plainly see they
//     are gone. Not one POST /api/lobby/kick — and the host is fully armed
//     (host code on the device), so a green result is not an accident of
//     missing credentials.
//   * the WAY BACK: a student who HAS been removed puts themselves back with a
//     reload. That is the readmit path the sweep's safety depends on, driven
//     here by an explicit host kick instead of a three-minute wait.
//
// On severing the socket: Playwright's `page.route` does not see WebSocket
// traffic at all (that is `routeWebSocket`), so "the phone went away" is done
// the way it actually happens — the context goes offline and the tab is gone.
// Either half alone can leave the Realtime connection half-open, which the
// server only reaps on its own heartbeat timeout, well past this spec's budget.

const SWEEP_GRACE_WINDOW = 45_000; // > one 30 s sweep tick, << the 3 min window

interface Lobby {
  tournamentId: string;
  hostCode: string;
  players: StoredPlayer[];
}

/** A tournament with two students in the LOBBY — no round started. */
async function openLobby(request: APIRequestContext, names: string[]): Promise<Lobby> {
  const created = await request.post("/api/tournament", { data: { title: "E2E lobby" } });
  expect(created.status(), await created.text()).toBe(200);
  const t = (await created.json()) as { id: string; joinPin: string; hostCode: string };

  const players: StoredPlayer[] = [];
  for (const displayName of names) {
    const res = await request.post("/api/join", {
      data: { pin: t.joinPin, displayName },
    });
    expect(res.status(), await res.text()).toBe(200);
    const p = (await res.json()) as StoredPlayer;
    players.push({ ...p, displayName });
  }
  return { tournamentId: t.id, hostCode: t.hostCode, players };
}

/** One player's row on the teacher's board, by the only hook that is theirs
 *  alone: the kick button LobbyView labels with their name. */
const inRoster = (page: Page, displayName: string) =>
  page.getByRole("button", { name: `${no.host.kick} ${displayName}` });

test.describe.configure({ mode: "serial" });

test("a student who vanishes is not swept out of the lobby minutes early", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const lobby = await openLobby(request, ["Ada", "Bo"]);
  const [ada] = lobby.players;

  const contexts: BrowserContext[] = [];
  try {
    // ---- the teacher's board, armed: host code on the device ----
    const hostCtx = await browser.newContext();
    contexts.push(hostCtx);
    await seedHostCode(hostCtx, lobby.tournamentId, lobby.hostCode);
    const hostPage = await hostCtx.newPage();
    const kicks = countRequests(hostPage, "/api/lobby/kick");
    await hostPage.goto(`/arranger/${lobby.tournamentId}`);
    // Addressed by the kick button's aria-label ("Kast ut Ada"): the roster chip
    // itself reads "AD Ada ✕" — avatar initials, name, kick — so a name is never
    // an element's whole text, and only the label is one player's alone.
    await expect(inRoster(hostPage, "Ada")).toBeVisible({ timeout: 20_000 });
    await expect(inRoster(hostPage, "Bo")).toBeVisible();

    // ---- one student on a phone ----
    const studentCtx = await browser.newContext();
    contexts.push(studentCtx);
    await seedPlayer(studentCtx, ada);
    const studentPage = await studentCtx.newPage();
    await studentPage.goto("/play");
    await expect(studentPage.getByTestId("waiting-room")).toBeVisible({
      timeout: 25_000,
    });

    // The host sees exactly one connected student (Bo never opened a browser).
    await expect(
      hostPage.getByLabel(no.host.online),
      "the host never saw the student connect — nothing below would mean anything",
    ).toHaveCount(1, { timeout: 25_000 });

    // ---- the phone goes away ----
    await studentCtx.setOffline(true);
    await studentPage.close();
    const severedAt = Date.now();

    await expect(
      hostPage.getByLabel(no.host.online),
      "the host's presence set never dropped the student",
    ).toHaveCount(0, { timeout: 25_000 });

    // …and for the next 45 seconds — at least one full sweep tick — the host
    // does nothing about it. AUTO_KICK_MS is three minutes; anything sooner is
    // a child removed from a tournament for a wifi blip.
    while (Date.now() - severedAt < SWEEP_GRACE_WINDOW) {
      await hostPage.waitForTimeout(2_000);
      expect(
        kicks.count(),
        `the lobby sweep fired ${Math.round((Date.now() - severedAt) / 1000)} s after the student went offline: ${kicks.urls().join(", ")}`,
      ).toBe(0);
    }
    kicks.stop();

    // Still in the roster, still shown — just marked offline.
    await expect(inRoster(hostPage, "Ada")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("a removed student is told, and a reload puts them back in the lobby", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const lobby = await openLobby(request, ["Cam", "Dee"]);
  const [cam] = lobby.players;

  const contexts: BrowserContext[] = [];
  try {
    const studentCtx = await browser.newContext();
    contexts.push(studentCtx);
    await seedPlayer(studentCtx, cam);
    const studentPage = await studentCtx.newPage();
    const rejoins = countRequests(studentPage, "/api/lobby/rejoin");
    await studentPage.goto("/play");
    await expect(studentPage.getByTestId("waiting-room")).toBeVisible({
      timeout: 25_000,
    });

    // ---- the host removes them (what the sweep would do after 3 minutes) ----
    const kicked = await request.post("/api/lobby/kick", {
      data: {
        tournamentId: lobby.tournamentId,
        hostCode: lobby.hostCode,
        playerId: cam.playerId,
      },
    });
    expect(kicked.status(), await kicked.text()).toBe(200);

    // R4's first half: say it happened. The old behaviour kept telling a student
    // who was no longer in the tournament to wait for the organiser.
    await expect(
      studentPage.getByText(no.player.removedLobbyTitle),
      "the removed student was never told",
    ).toBeVisible({ timeout: 20_000 });

    // ---- R4's second half: a reload is enough to be back in ----
    await studentPage.reload();
    await expect
      .poll(() => rejoins.count(), {
        timeout: 25_000,
        message: "the student's resume never triggered an automatic rejoin",
      })
      .toBeGreaterThan(0);
    rejoins.stop();

    await expect(studentPage.getByTestId("waiting-room")).toBeVisible({
      timeout: 25_000,
    });

    // …and the server agrees: back in the roster, active.
    const board = await request.get(`/api/tournament/${lobby.tournamentId}`);
    expect(board.status()).toBe(200);
    const state = (await board.json()) as {
      players: { id: string; status: string }[];
    };
    expect(
      state.players.find((p) => p.id === cam.playerId)?.status,
      "the rejoined student is not active in the roster",
    ).toBe("active");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
