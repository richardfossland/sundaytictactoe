// Live verification of chess clocks (3.2) + team-join degradation (3.3)
// against the deployed site. node scripts/smoke-clock.mjs
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

console.log("SundayChess LIVE clock + teams smoke\n");

// ---- clock tournament (3 min per player) ----
const t = api("POST", "/api/tournament", { title: "KlokkeTest", config: { clockSec: 180 } });
const a = api("POST", "/api/join", { pin: t.joinPin, displayName: "Ada" });
const b = api("POST", "/api/join", { pin: t.joinPin, displayName: "Bo" });
api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });
const g = board(t.id).games.find((x) => x.status === "live" && x.blackPlayerId);
const byId = { [a.playerId]: a, [b.playerId]: b };
const white = byId[g.whitePlayerId];
const black = byId[g.blackPlayerId];

const detail = api("GET", `/api/game/${g.id}`);
ok("game detail carries a clock", detail.clock && detail.clock.turn === "w", JSON.stringify(detail.clock));
ok("both sides start near 3:00", detail.clock.whiteMs > 170_000 && detail.clock.blackMs === 180_000, JSON.stringify(detail.clock));

const mv = api("POST", "/api/move", { gameId: g.id, from: "e2", to: "e4", playerId: white.playerId, resumeCode: white.resumeCode });
ok("move response carries clock, turn flipped", mv.clock && mv.clock.turn === "b" && mv.clock.running === true, JSON.stringify(mv.clock));
ok("white was charged thinking time", mv.clock.whiteMs < 180_000, String(mv.clock?.whiteMs));

const claimEarly = api("POST", "/api/game/claim", { gameId: g.id, playerId: white.playerId, resumeCode: white.resumeCode });
ok("claim with time on the clock rejected", claimEarly.error === "not_flagged", JSON.stringify(claimEarly));

const claimNoClock = (() => {
  const t2 = api("POST", "/api/tournament", { title: "UtenKlokke" });
  const p1 = api("POST", "/api/join", { pin: t2.joinPin, displayName: "X" });
  api("POST", "/api/join", { pin: t2.joinPin, displayName: "Y" });
  api("POST", "/api/round/start", { tournamentId: t2.id, hostCode: t2.hostCode });
  const g2 = board(t2.id).games.find((x) => x.status === "live" && x.blackPlayerId);
  return api("POST", "/api/game/claim", { gameId: g2.id, playerId: g2.whitePlayerId === p1.playerId ? p1.playerId : p1.playerId, resumeCode: p1.resumeCode });
})();
ok("claim without a clock configured rejected", claimNoClock.error === "no_clock" || claimNoClock.error === "not_a_player", JSON.stringify(claimNoClock));

// black can still move (not flagged)
const mv2 = api("POST", "/api/move", { gameId: g.id, from: "e7", to: "e5", playerId: black.playerId, resumeCode: black.resumeCode });
ok("opponent moves normally under clock", mv2.turn === "w" && mv2.clock?.blackMs < 180_000, JSON.stringify(mv2.clock));

// ---- teams config accepted + join still works pre-migration ----
const tt = api("POST", "/api/tournament", { title: "LagTest", config: { teams: ["Rød", "Blå"] } });
const j1 = api("POST", "/api/join", { pin: tt.joinPin, displayName: "Per" });
const j2 = api("POST", "/api/join", { pin: tt.joinPin, displayName: "Pål" });
ok("join works in a team tournament", Boolean(j1.playerId && j2.playerId), JSON.stringify({ j1, j2 }));
const teamsAssigned = j1.team && j2.team && j1.team !== j2.team;
console.log(
  teamsAssigned
    ? "  ✓ team auto-assignment ACTIVE (0006 migrated): " + j1.team + " / " + j2.team
    : "  ⚠ teams not yet assigned (migration 0006 pending) — joins degrade gracefully",
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
