// Headless end-to-end smoke test against a RUNNING dev server + local Supabase.
// Exercises the real §4 path: quickmatch → moves → k-in-a-row win, turn
// enforcement, illegal rejection, reconnect read, and realtime broadcast
// receipt.
//
//   node scripts/smoke.mjs
//
// Requires: `supabase start` + `.env.local` + `npm run dev` (port 3000).
// Uses /api/dev/quickmatch, a dev-only test seam that 404s in a production
// build — see scripts/smoke-live.mjs for the equivalent against production.

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE || "http://localhost:3000";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

let pass = 0;
let fail = 0;
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
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function move(game, p, cell) {
  return post("/api/move", {
    gameId: game,
    cell,
    playerId: p.playerId,
    resumeCode: p.resumeCode,
  });
}

async function main() {
  console.log("SundayTicTacToe headless smoke test\n");

  // 1. Quickmatch
  const qm = await post("/api/dev/quickmatch", { white: "Ada", black: "Bo" });
  check("quickmatch creates a game", qm.status === 200 && qm.json.gameId, JSON.stringify(qm.json));
  const { gameId, white, black } = qm.json;
  if (!gameId) {
    console.log("\nAborting: no game created. Is the dev server + supabase up?");
    process.exit(1);
  }

  // 2. Subscribe to the game channel BEFORE moving, to catch broadcasts.
  const sb = createClient(URL, ANON);
  const events = [];
  const channel = sb.channel(`game:${gameId}`, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "*" }, (m) => events.push(m.event));
  await new Promise((resolve) => {
    channel.subscribe((status) => status === "SUBSCRIBED" && resolve());
  });

  // 3. Illegal move rejected server-side (cell index out of range).
  const illegal = await move(gameId, white, 99);
  check("illegal move rejected (400)", illegal.status === 400, `got ${illegal.status}`);

  // 4. Out-of-turn move rejected (black tries to move first).
  const oot = await move(gameId, black, 0);
  check("out-of-turn rejected (403)", oot.status === 403, `got ${oot.status} ${JSON.stringify(oot.json)}`);

  // 5. Play out the top row: white 0, black 3, white 1, black 4, white 2 → x wins.
  const m1 = await move(gameId, white, 0);
  check("white plays cell 0, turn→b", m1.status === 200 && m1.json.turn === "b", JSON.stringify(m1.json));
  const m2 = await move(gameId, black, 3);
  check("black plays cell 3, turn→w", m2.status === 200 && m2.json.turn === "w", JSON.stringify(m2.json));
  const m3 = await move(gameId, white, 1);
  check("white plays cell 1, turn→b", m3.status === 200 && m3.json.turn === "b", JSON.stringify(m3.json));
  const m4 = await move(gameId, black, 4);
  check("black plays cell 4, turn→w", m4.status === 200 && m4.json.turn === "w", JSON.stringify(m4.json));
  const m5 = await move(gameId, white, 2);
  check("white plays cell 2 → white_win", m5.status === 200 && m5.json.status === "white_win", JSON.stringify(m5.json));

  // 6. No moves allowed after game over.
  const after = await move(gameId, black, 5);
  check("move after game over rejected", after.status === 409, `got ${after.status}`);

  // 7. Reconnect read: authoritative state reflects the finished game.
  const detail = await fetch(`${BASE}/api/game/${gameId}`).then((r) => r.json());
  check("GET game shows white_win + last move cell 2", detail.status === "white_win" && detail.lastMove?.cell === 2, JSON.stringify(detail.lastMove));

  // 8. Realtime: the subscriber received position broadcasts.
  await new Promise((r) => setTimeout(r, 600));
  const positions = events.filter((e) => e === "position").length;
  check("realtime delivered position broadcasts", positions >= 1, `received events: ${JSON.stringify(events)}`);

  await sb.removeChannel(channel);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
