// Live verification of the draw + absent flows against the deployed site.
//   node scripts/smoke-features.mjs
import { fetchJson } from "./lib/live.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

async function api(method, path, body) {
  const { json } = await fetchJson(path, body ? { method, body: JSON.stringify(body) } : { method });
  return json;
}
const board = (id) => api("GET", `/api/tournament/${id}`);

async function setup() {
  const t = await api("POST", "/api/tournament", { title: "FeatureTest" });
  const p1 = await api("POST", "/api/join", { pin: t.joinPin, displayName: "Ada" });
  const p2 = await api("POST", "/api/join", { pin: t.joinPin, displayName: "Bo" });
  await api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });
  const b = await board(t.id);
  const g = b.games.find((x) => x.status === "live" && x.blackPlayerId);
  const byId = { [p1.playerId]: p1, [p2.playerId]: p2 };
  return { t, g, white: byId[g.whitePlayerId], black: byId[g.blackPlayerId] };
}

async function main() {
  console.log("SundayTicTacToe LIVE feature smoke\n");

  // ---- draw flow ----
  let { t, g, white, black } = await setup();
  const offer = await api("POST", "/api/game/draw", { gameId: g.id, playerId: white.playerId, resumeCode: white.resumeCode, action: "offer" });
  ok("draw offer accepted", offer.offered === true, JSON.stringify(offer));

  const own = await api("POST", "/api/game/draw", { gameId: g.id, playerId: white.playerId, resumeCode: white.resumeCode, action: "accept" });
  ok("accepting your OWN offer is rejected", own.error === "no_offer", JSON.stringify(own));

  const acc = await api("POST", "/api/game/draw", { gameId: g.id, playerId: black.playerId, resumeCode: black.resumeCode, action: "accept" });
  ok("opponent accept → draw", acc.status === "draw", JSON.stringify(acc));
  const gd = (await board(t.id)).games.find((x) => x.id === g.id);
  ok("game persisted as draw", gd.status === "draw");

  // ---- absent → walkover ----
  ({ t, g, white, black } = await setup());
  const ab = await api("POST", "/api/game/absent", { gameId: g.id, hostCode: t.hostCode, absentPlayerId: white.playerId, scope: "round" });
  ok("absent (white) → opponent walkover win", ab.status === "black_win", JSON.stringify(ab));
  const ga = (await board(t.id)).games.find((x) => x.id === g.id);
  ok("walkover persisted", ga.status === "black_win");

  // ---- absent tournament scope removes the player ----
  ({ t, g, white, black } = await setup());
  await api("POST", "/api/game/absent", { gameId: g.id, hostCode: t.hostCode, absentPlayerId: black.playerId, scope: "tournament" });
  const standings = (await board(t.id)).standings;
  ok("out-of-tournament player removed from standings", !standings.some((s) => s.playerId === black.playerId), JSON.stringify(standings.map((s) => s.playerId)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
