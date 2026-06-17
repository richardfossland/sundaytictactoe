// Live verification of tipping mode (predictions) against the deployed site.
// node scripts/smoke-predict.mjs
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

console.log("SundayChess LIVE tipping smoke\n");

// 3 players → one gets a bye and can tip the live game
const t = api("POST", "/api/tournament", { title: "TippeTest" });
const ps = ["Ada", "Bo", "Cleo"].map((n) => api("POST", "/api/join", { pin: t.joinPin, displayName: n }));
api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });

const b1 = board(t.id);
const g = b1.games.find((x) => x.status === "live" && x.blackPlayerId);
const playing = new Set([g.whitePlayerId, g.blackPlayerId]);
const tipper = ps.find((p) => !playing.has(p.playerId));
const white = ps.find((p) => p.playerId === g.whitePlayerId);
ok("setup: live game + bye tipper", Boolean(g && tipper), JSON.stringify(b1.games));

// a participant cannot tip their own game
const own = api("POST", "/api/predict", { playerId: white.playerId, resumeCode: white.resumeCode, gameId: g.id, predicted: "white", action: "tip" });
ok("tipping own game rejected", own.error === "own_game", JSON.stringify(own));

// the bye player tips white — then changes their mind to black (upsert)
const tip1 = api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, gameId: g.id, predicted: "white", action: "tip" });
ok("tip accepted", tip1.predicted === "white", JSON.stringify(tip1));
const tip2 = api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, gameId: g.id, predicted: "black", action: "tip" });
ok("re-tip overwrites", tip2.predicted === "black", JSON.stringify(tip2));

// list returns the stored pick
const mine = api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, action: "list" });
ok("list shows my pick", mine.predictions?.[g.id] === "black", JSON.stringify(mine));

// resolve the game as black win → tipper earned a point
api("POST", "/api/game/override", { gameId: g.id, hostCode: t.hostCode, result: "black_win" });
const b2 = board(t.id);
const row = (b2.tipping ?? []).find((x) => x.playerId === tipper.playerId);
ok("correct tip scored on the board", row?.points === 1, JSON.stringify(b2.tipping));

// tipping a finished game is rejected
const late = api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, gameId: g.id, predicted: "white", action: "tip" });
ok("tipping a finished game rejected", late.error === "not_live", JSON.stringify(late));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
