// Headless tournament-flow test: create → join → league → byes/scoring →
// override → advance → finish, against a running dev server + local Supabase.
//
//   node scripts/smoke-league.mjs

const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0,
  fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}
async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
const board = (id) => fetch(`${BASE}/api/tournament/${id}`).then((r) => r.json());

async function main() {
  console.log("SundaySjakk league-flow smoke test\n");

  // 1. Create a tournament (min 3 rounds — the server clamps to 3..7).
  const created = await post("/api/tournament", {
    title: "Smoke",
    config: { leagueRounds: 3, playoff: false, playoffSize: 0, roundTimerSec: null },
  });
  check("tournament created", created.status === 200 && created.json.id);
  const { id, joinPin, hostCode } = created.json;

  // 2. Join 5 players (odd → forces a bye).
  const players = [];
  for (const name of ["Ada", "Bo", "Cy", "Di", "Ed"]) {
    const r = await post("/api/join", { pin: joinPin, displayName: name });
    if (r.json.playerId) players.push({ name, ...r.json });
  }
  check("5 players joined", players.length === 5, `joined ${players.length}`);

  let b = await board(id);
  check("board lists 5 active players in lobby", b.players.length === 5 && b.tournament.status === "lobby");

  // 3. Start the league.
  const start = await post("/api/round/start", { tournamentId: id, hostCode });
  check("league started", start.status === 200 && start.json.status === "league", JSON.stringify(start.json));

  b = await board(id);
  const r1Games = b.games.filter((g) => b.rounds.find((r) => r.id === g.roundId)?.number === 1);
  const r1Byes = r1Games.filter((g) => g.status === "bye");
  check("round 1 has 2 games + 1 bye", r1Games.length === 3 && r1Byes.length === 1, `games=${r1Games.length} byes=${r1Byes.length}`);
  check("bye awards 1 point", b.standings.some((s) => s.score === 1), JSON.stringify(b.standings.map((s) => s.score)));

  // 4. Override the two live games (white wins both).
  const live = r1Games.filter((g) => g.status === "live");
  for (const g of live) {
    const o = await post("/api/game/override", { gameId: g.id, hostCode, result: "white_win" });
    check(`override game ${g.id.slice(0, 6)} → white_win`, o.status === 200, JSON.stringify(o.json));
  }

  // 5. Advance to round 2.
  b = await board(id);
  const allResolved = r1Games.every((g) => b.games.find((x) => x.id === g.id)?.status !== "live");
  check("all round-1 games resolved", allResolved);
  const adv = await post("/api/round/advance", { tournamentId: id, hostCode });
  check("advanced to round 2", adv.status === 200 && adv.json.status === "league", JSON.stringify(adv.json));

  b = await board(id);
  check("now on round 2", b.tournament.currentRound === 2);
  const r2Games = b.games.filter((g) => b.rounds.find((r) => r.id === g.roundId)?.number === 2);
  check("round 2 paired (3 games incl bye)", r2Games.length === 3, `games=${r2Games.length}`);

  // No rematch: round-2 non-bye pairings differ from round-1's.
  const key = (g) => [g.whitePlayerId, g.blackPlayerId].sort().join("|");
  const r1pairs = new Set(r1Games.filter((g) => g.blackPlayerId).map(key));
  const r2pairs = r2Games.filter((g) => g.blackPlayerId).map(key);
  check("no rematches in round 2", r2pairs.every((k) => !r1pairs.has(k)), `${r2pairs}`);

  // 6. Force-resolve + advance through the remaining rounds until finished.
  let status = "league";
  for (let guard = 0; guard < 6 && status === "league"; guard++) {
    await post("/api/round/force", { tournamentId: id, hostCode });
    const adv2 = await post("/api/round/advance", { tournamentId: id, hostCode });
    status = adv2.json.status;
  }
  check("tournament finishes after the last round", status === "finished", `ended ${status}`);

  const final = await board(id);
  check("podium has a ranked winner", final.standings[0]?.rank === 1 && final.tournament.status === "finished");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
