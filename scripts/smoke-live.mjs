// Production smoke test against the live Worker + cloud Supabase, via the
// PUBLIC flow only: create → join ×2 → round/start → find the live game →
// moves. `/api/dev/quickmatch` is a dev-only test seam that 404s in a
// production build, so it cannot be used here (see scripts/smoke.mjs, which
// runs against a local dev server and can use it).
//
//   node scripts/smoke-live.mjs

import { BASE, fetchJson } from "./lib/live.mjs";

let pass = 0,
  fail = 0;
const check = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

const move = (gameId, player, cell) =>
  fetchJson("/api/move", {
    method: "POST",
    body: JSON.stringify({ gameId, cell, playerId: player.playerId, resumeCode: player.resumeCode }),
  });

async function main() {
  console.log(`SundayTicTacToe LIVE smoke — ${BASE}\n`);

  const created = await fetchJson("/api/tournament", {
    method: "POST",
    body: JSON.stringify({ title: "LiveSmoke" }),
  });
  check("tournament created", created.status === 200 && !!created.json.id, JSON.stringify(created.json));
  if (!created.json.id) return done();
  const { id, joinPin, hostCode } = created.json;

  const j1 = await fetchJson("/api/join", { method: "POST", body: JSON.stringify({ pin: joinPin, displayName: "Ada" }) });
  const j2 = await fetchJson("/api/join", { method: "POST", body: JSON.stringify({ pin: joinPin, displayName: "Bo" }) });
  check(
    "both players joined",
    !!j1.json.playerId && !!j2.json.playerId,
    JSON.stringify({ j1: j1.json, j2: j2.json }),
  );
  if (!j1.json.playerId || !j2.json.playerId) return done();

  const started = await fetchJson("/api/round/start", {
    method: "POST",
    body: JSON.stringify({ tournamentId: id, hostCode }),
  });
  check("round started", started.status === 200 && started.json.status === "league", JSON.stringify(started.json));

  const board1 = await fetchJson(`/api/tournament/${id}`);
  const g = board1.json.games?.find((x) => x.status === "live" && x.blackPlayerId);
  check("live game found on the board", Boolean(g), JSON.stringify(board1.json.games));
  if (!g) return done();

  const byId = { [j1.json.playerId]: j1.json, [j2.json.playerId]: j2.json };
  const white = byId[g.whitePlayerId];
  const black = byId[g.blackPlayerId];

  // Row 0 (cells 0,1,2) for X: white takes 0, 1, 2; black takes 3, 4 in between.
  const m1 = await move(g.id, white, 0);
  check("white plays cell 0, turn→black", m1.status === 200 && m1.json.turn === "b", JSON.stringify(m1.json));
  const m2 = await move(g.id, black, 3);
  check("black plays cell 3, turn→white", m2.status === 200 && m2.json.turn === "w", JSON.stringify(m2.json));
  const m3 = await move(g.id, white, 1);
  check("white plays cell 1, turn→black", m3.status === 200 && m3.json.turn === "b", JSON.stringify(m3.json));
  const m4 = await move(g.id, black, 4);
  check("black plays cell 4, turn→white", m4.status === 200 && m4.json.turn === "w", JSON.stringify(m4.json));
  const m5 = await move(g.id, white, 2);
  check("white plays cell 2 → white_win (top row)", m5.status === 200 && m5.json.status === "white_win", JSON.stringify(m5.json));

  const board2 = await fetchJson(`/api/tournament/${id}`);
  const gAfter = board2.json.games?.find((x) => x.id === g.id);
  check("game persisted as white_win", gAfter?.status === "white_win", JSON.stringify(gAfter));

  const winnerRow = board2.json.standings?.find((s) => s.playerId === white.playerId);
  check("standings show the winner's point", winnerRow?.score === 1, JSON.stringify(board2.json.standings));

  done();
}

function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
