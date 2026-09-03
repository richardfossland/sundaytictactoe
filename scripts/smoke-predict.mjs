// Live verification of tipping mode (predictions) against the deployed site.
// node scripts/smoke-predict.mjs
import { fetchJson } from "./lib/live.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

async function api(method, path, body) {
  const { json } = await fetchJson(path, body ? { method, body: JSON.stringify(body) } : { method });
  return json;
}
const board = (id) => api("GET", `/api/tournament/${id}`);

async function main() {
  console.log("SundayTicTacToe LIVE tipping smoke\n");

  // 3 players → one gets a bye and can tip the live game
  const t = await api("POST", "/api/tournament", { title: "TippeTest" });
  const ps = [];
  for (const n of ["Ada", "Bo", "Cleo"]) {
    ps.push(await api("POST", "/api/join", { pin: t.joinPin, displayName: n }));
  }
  await api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });

  const b1 = await board(t.id);
  const g = b1.games.find((x) => x.status === "live" && x.blackPlayerId);
  const playing = new Set([g.whitePlayerId, g.blackPlayerId]);
  const tipper = ps.find((p) => !playing.has(p.playerId));
  const white = ps.find((p) => p.playerId === g.whitePlayerId);
  ok("setup: live game + bye tipper", Boolean(g && tipper), JSON.stringify(b1.games));

  // a participant cannot tip their own game
  const own = await api("POST", "/api/predict", { playerId: white.playerId, resumeCode: white.resumeCode, gameId: g.id, predicted: "white", action: "tip" });
  ok("tipping own game rejected", own.error === "own_game", JSON.stringify(own));

  // the bye player tips white — then changes their mind to black (upsert)
  const tip1 = await api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, gameId: g.id, predicted: "white", action: "tip" });
  ok("tip accepted", tip1.predicted === "white", JSON.stringify(tip1));
  const tip2 = await api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, gameId: g.id, predicted: "black", action: "tip" });
  ok("re-tip overwrites", tip2.predicted === "black", JSON.stringify(tip2));

  // list returns the stored pick
  const mine = await api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, action: "list" });
  ok("list shows my pick", mine.predictions?.[g.id] === "black", JSON.stringify(mine));

  // resolve the game as black win → tipper earned a point
  await api("POST", "/api/game/override", { gameId: g.id, hostCode: t.hostCode, result: "black_win" });
  const b2 = await board(t.id);
  const row = (b2.tipping ?? []).find((x) => x.playerId === tipper.playerId);
  ok("correct tip scored on the board", row?.points === 1, JSON.stringify(b2.tipping));

  // tipping a finished game is rejected
  const late = await api("POST", "/api/predict", { playerId: tipper.playerId, resumeCode: tipper.resumeCode, gameId: g.id, predicted: "white", action: "tip" });
  ok("tipping a finished game rejected", late.error === "not_live", JSON.stringify(late));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
