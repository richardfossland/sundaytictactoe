// Live verification of the draw + absent fixes against the deployed site.
// HTTP via curl --resolve (local DNS may be stale). node scripts/smoke-features.mjs
import { execFileSync } from "node:child_process";

const HOST = "chess.sundaysuite.app";
const IP = process.env.IP || "104.21.48.174";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

function api(method, path, body) {
  const args = ["-s", "--resolve", `${HOST}:443:${IP}`, "-X", method, `https://${HOST}${path}`];
  if (body) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  try { return JSON.parse(execFileSync("curl", args, { encoding: "utf8" })); } catch { return {}; }
}
const board = (id) => api("GET", `/api/tournament/${id}`);

function setup() {
  const t = api("POST", "/api/tournament", { title: "FeatureTest" });
  const p1 = api("POST", "/api/join", { pin: t.joinPin, displayName: "Ada" });
  const p2 = api("POST", "/api/join", { pin: t.joinPin, displayName: "Bo" });
  api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });
  const b = board(t.id);
  const g = b.games.find((x) => x.status === "live" && x.blackPlayerId);
  const byId = { [p1.playerId]: p1, [p2.playerId]: p2 };
  return { t, g, white: byId[g.whitePlayerId], black: byId[g.blackPlayerId] };
}

function main() {
  console.log("SundayChess LIVE feature smoke\n");

  // ---- draw flow ----
  let { t, g, white, black } = setup();
  const offer = api("POST", "/api/game/draw", { gameId: g.id, playerId: white.playerId, resumeCode: white.resumeCode, action: "offer" });
  ok("draw offer accepted", offer.offered === true, JSON.stringify(offer));

  const own = api("POST", "/api/game/draw", { gameId: g.id, playerId: white.playerId, resumeCode: white.resumeCode, action: "accept" });
  ok("accepting your OWN offer is rejected", own.error === "no_offer", JSON.stringify(own));

  const acc = api("POST", "/api/game/draw", { gameId: g.id, playerId: black.playerId, resumeCode: black.resumeCode, action: "accept" });
  ok("opponent accept → draw", acc.status === "draw", JSON.stringify(acc));
  const gd = board(t.id).games.find((x) => x.id === g.id);
  ok("game persisted as draw", gd.status === "draw");

  // ---- absent → walkover ----
  ({ t, g, white, black } = setup());
  const ab = api("POST", "/api/game/absent", { gameId: g.id, hostCode: t.hostCode, absentPlayerId: white.playerId, scope: "round" });
  ok("absent (white) → opponent walkover win", ab.status === "black_win", JSON.stringify(ab));
  const ga = board(t.id).games.find((x) => x.id === g.id);
  ok("walkover persisted", ga.status === "black_win");

  // ---- absent tournament scope removes the player ----
  ({ t, g, white, black } = setup());
  api("POST", "/api/game/absent", { gameId: g.id, hostCode: t.hostCode, absentPlayerId: black.playerId, scope: "tournament" });
  const standings = board(t.id).standings;
  ok("out-of-tournament player removed from standings", !standings.some((s) => s.playerId === black.playerId), JSON.stringify(standings.map((s) => s.playerId)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main();
