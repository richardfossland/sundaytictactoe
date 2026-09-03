// Live verification of cup mode (straight to knockout, byes for non-pow2
// fields) against the deployed site. node scripts/smoke-cup.mjs
import { fetchJson } from "./lib/live.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

async function api(method, path, body) {
  const { json } = await fetchJson(path, body ? { method, body: JSON.stringify(body) } : { method });
  return json;
}
const board = (id) => api("GET", `/api/tournament/${id}`);

async function main() {
  console.log("SundayTicTacToe LIVE cup smoke (5 players → bracket of 8 with 3 byes)\n");

  const t = await api("POST", "/api/tournament", { title: "CupTest", config: { format: "cup" } });
  for (const n of ["Ada", "Bo", "Cleo", "Dag", "Eli"]) {
    await api("POST", "/api/join", { pin: t.joinPin, displayName: n });
  }
  const started = await api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });
  ok("start goes straight to playoff", started.status === "playoff", JSON.stringify(started));

  let b = await board(t.id);
  ok("tournament status is playoff", b.tournament.status === "playoff");
  const r1 = b.rounds.find((r) => r.phase === "playoff" && r.number === 1);
  const r1games = b.games.filter((g) => g.roundId === r1?.id);
  const liveR1 = r1games.filter((g) => g.status === "live");
  const byesR1 = r1games.filter((g) => g.status === "bye");
  ok("round 1 = 1 real game + 3 byes", liveR1.length === 1 && byesR1.length === 3,
    JSON.stringify(r1games.map((g) => g.status)));

  // decide the real game, then the bracket must advance byes automatically
  await api("POST", "/api/game/override", { gameId: liveR1[0].id, hostCode: t.hostCode, result: "white_win" });
  const adv1 = await api("POST", "/api/round/advance", { tournamentId: t.id, hostCode: t.hostCode });
  ok("advance to semifinals", adv1.status === "playoff", JSON.stringify(adv1));

  b = await board(t.id);
  const r2 = b.rounds.find((r) => r.phase === "playoff" && r.number === 2);
  const r2games = b.games.filter((g) => g.roundId === r2?.id);
  ok("semifinals: 2 full games (bye players advanced)",
    r2games.length === 2 && r2games.every((g) => g.status === "live" && g.blackPlayerId),
    JSON.stringify(r2games.map((g) => g.status)));

  for (const g of r2games) {
    await api("POST", "/api/game/override", { gameId: g.id, hostCode: t.hostCode, result: "white_win" });
  }
  await api("POST", "/api/round/advance", { tournamentId: t.id, hostCode: t.hostCode });

  b = await board(t.id);
  const r3 = b.rounds.find((r) => r.phase === "playoff" && r.number === 3);
  const final = b.games.filter((g) => g.roundId === r3?.id);
  ok("final created", final.length === 1 && final[0].status === "live", JSON.stringify(final));

  await api("POST", "/api/game/override", { gameId: final[0].id, hostCode: t.hostCode, result: "black_win" });
  const advEnd = await api("POST", "/api/round/advance", { tournamentId: t.id, hostCode: t.hostCode });
  ok("champion crowned, tournament finished", advEnd.status === "finished", JSON.stringify(advEnd));
  b = await board(t.id);
  ok("status persisted as finished", b.tournament.status === "finished");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
