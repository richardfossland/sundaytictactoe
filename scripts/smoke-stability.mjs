// Live verification of the stability-hardening pass: concurrent joins,
// double start/advance, double extend, out-of-order cup bracket integrity.
// node scripts/smoke-stability.mjs
import { execFile, execFileSync } from "node:child_process";

const HOST = "chess.sundaysuite.app";
const IP = process.env.IP || "104.21.48.174";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

function curlArgs(method, path, body) {
  const args = ["-s", "--resolve", `${HOST}:443:${IP}`, "-X", method, `https://${HOST}${path}`];
  if (body) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  return args;
}
function api(method, path, body) {
  try { return JSON.parse(execFileSync("curl", curlArgs(method, path, body), { encoding: "utf8" })); } catch { return {}; }
}
function apiAsync(method, path, body) {
  return new Promise((resolve) => {
    execFile("curl", curlArgs(method, path, body), { encoding: "utf8" }, (_e, stdout) => {
      try { resolve(JSON.parse(stdout)); } catch { resolve({}); }
    });
  });
}
const board = (id) => api("GET", `/api/tournament/${id}`);

console.log("SundayChess LIVE stability smoke\n");

// ---- 1. ten truly concurrent joins (same NAT IP) all succeed ----
{
  const t = api("POST", "/api/tournament", { title: "StressJoin" });
  const names = Array.from({ length: 10 }, (_, i) => `Spiller${i + 1}`);
  const results = await Promise.all(
    names.map((n) => apiAsync("POST", "/api/join", { pin: t.joinPin, displayName: n })),
  );
  const okJoins = results.filter((r) => r.playerId).length;
  ok(`10 concurrent joins all succeed (${okJoins}/10)`, okJoins === 10,
    JSON.stringify(results.filter((r) => !r.playerId)));
}

// ---- 2. double round/start: one starts, the other answers gracefully ----
{
  const t = api("POST", "/api/tournament", { title: "DoubleStart" });
  ["A", "B", "C", "D"].forEach((n) => api("POST", "/api/join", { pin: t.joinPin, displayName: n }));
  const [r1, r2] = await Promise.all([
    apiAsync("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode }),
    apiAsync("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode }),
  ]);
  const statuses = [r1, r2].map((r) => r.status ?? r.error).sort();
  const graceful =
    statuses.includes("league") &&
    (statuses.includes("already_started") || statuses.filter((s) => s === "league").length === 2);
  ok("double start → one league + one graceful answer", graceful, JSON.stringify(statuses));
  const b = board(t.id);
  const r1games = b.games.filter((g) => b.rounds.find((r) => r.id === g.roundId)?.number === 1);
  ok("exactly one round-1 pairing (no duplicates)", r1games.length === 2, JSON.stringify(r1games.length));
}

// ---- 3. extend ×2 → +2 minutes accumulated ----
{
  const t = api("POST", "/api/tournament", { title: "ExtendTwice", config: { roundTimerSec: 300 } });
  ["A", "B"].forEach((n) => api("POST", "/api/join", { pin: t.joinPin, displayName: n }));
  api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });
  const e1 = api("POST", "/api/round/extend", { tournamentId: t.id, hostCode: t.hostCode });
  const e2 = api("POST", "/api/round/extend", { tournamentId: t.id, hostCode: t.hostCode });
  const b = board(t.id);
  const round = b.rounds.find((r) => r.number === 1);
  if (e1.extendedMs === null) {
    console.log("  ⚠ extend running in pre-0007 fallback (started_at shift) — paste 0007 to enable atomic extensions");
    ok("extend fallback responded", e2.extendedMs === null);
  } else {
    ok("two extends accumulate to 120000 ms", e2.extendedMs === 120_000, JSON.stringify({ e1, e2 }));
    ok("board carries extendedMs", round?.extendedMs === 120_000, JSON.stringify(round));
  }
}

// ---- 4. cup: resolve games OUT OF ORDER → bracket stays slot-true ----
{
  const t = api("POST", "/api/tournament", { title: "OrderCup", config: { format: "cup" } });
  const names = ["A", "B", "C", "D", "E", "F", "G", "H"];
  names.forEach((n) => api("POST", "/api/join", { pin: t.joinPin, displayName: n }));
  api("POST", "/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });

  let b = board(t.id);
  const r1 = b.rounds.find((r) => r.phase === "playoff" && r.number === 1);
  const r1games = b.games
    .filter((g) => g.roundId === r1.id)
    .sort((a, c) => (a.slot ?? 0) - (c.slot ?? 0));
  ok("cup of 8 → 4 round-1 games", r1games.length === 4, String(r1games.length));

  const slotsMigrated = r1games.some((g) => (g.slot ?? 0) > 0);
  if (!slotsMigrated) {
    console.log("  ⚠ games.slot all 0 (0007 not migrated) — resolving in fetch order; re-run after pasting 0007 for the full out-of-order assertion");
  }

  // resolve out of order when slots exist; in fetch order pre-migration
  const order = slotsMigrated ? [2, 0, 3, 1] : [0, 1, 2, 3];
  for (const idx of order) {
    const g = slotsMigrated ? r1games.find((x) => x.slot === idx) : r1games[idx];
    api("POST", "/api/game/override", { gameId: g.id, hostCode: t.hostCode, result: "white_win" });
  }
  const adv = api("POST", "/api/round/advance", { tournamentId: t.id, hostCode: t.hostCode });
  ok("cup advances to semifinals", adv.status === "playoff", JSON.stringify(adv));

  b = board(t.id);
  const r2 = b.rounds.find((r) => r.phase === "playoff" && r.number === 2);
  const r2games = b.games
    .filter((g) => g.roundId === r2.id)
    .sort((a, c) => (a.slot ?? 0) - (c.slot ?? 0));
  if (slotsMigrated) {
    const w = (slot) => r1games.find((x) => x.slot === slot).whitePlayerId;
    ok("semifinal 1 = winners of slots 0+1 (despite scrambled resolution)",
      r2games[0].whitePlayerId === w(0) && r2games[0].blackPlayerId === w(1));
    ok("semifinal 2 = winners of slots 2+3",
      r2games[1].whitePlayerId === w(2) && r2games[1].blackPlayerId === w(3));
  } else {
    ok("semifinals created (2 games)", r2games.length === 2, String(r2games.length));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
