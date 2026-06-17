// Headless end-to-end smoke test against a RUNNING dev server + local Supabase.
// Exercises the real §4 path: quickmatch → moves → checkmate, turn enforcement,
// illegal rejection, reconnect read, and realtime broadcast receipt.
//
//   node scripts/smoke.mjs
//
// Requires: `supabase start` + `.env.local` + `npm run dev` (port 3000).

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

async function move(game, p, from, to) {
  return post("/api/move", {
    gameId: game,
    from,
    to,
    playerId: p.playerId,
    resumeCode: p.resumeCode,
  });
}

async function main() {
  console.log("SundaySjakk headless smoke test\n");

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

  // 3. Illegal move rejected server-side.
  const illegal = await move(gameId, white, "e2", "e6");
  check("illegal move rejected (400)", illegal.status === 400, `got ${illegal.status}`);

  // 4. Out-of-turn move rejected (black tries to move first).
  const oot = await move(gameId, black, "e7", "e5");
  check("out-of-turn rejected (403)", oot.status === 403, `got ${oot.status} ${JSON.stringify(oot.json)}`);

  // 5. Play Fool's mate: 1. f3 e5 2. g4 Qh4#
  const m1 = await move(gameId, white, "f2", "f3");
  check("white f3 ok, turn→b", m1.status === 200 && m1.json.turn === "b", JSON.stringify(m1.json));
  const m2 = await move(gameId, black, "e7", "e5");
  check("black e5 ok, turn→w", m2.status === 200 && m2.json.turn === "w", JSON.stringify(m2.json));
  const m3 = await move(gameId, white, "g2", "g4");
  check("white g4 ok, turn→b", m3.status === 200 && m3.json.turn === "b", JSON.stringify(m3.json));
  const m4 = await move(gameId, black, "d8", "h4");
  check("black Qh4# → black_win", m4.status === 200 && m4.json.status === "black_win", JSON.stringify(m4.json));

  // 6. No moves allowed after game over.
  const after = await move(gameId, white, "a2", "a3");
  check("move after game over rejected", after.status === 409 || after.status === 403, `got ${after.status}`);

  // 7. Reconnect read: authoritative state reflects the finished game.
  const detail = await fetch(`${BASE}/api/game/${gameId}`).then((r) => r.json());
  check("GET game shows black_win + last move Qh4#", detail.status === "black_win" && detail.lastMove?.san?.includes("Qh4"), JSON.stringify(detail.lastMove));

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
