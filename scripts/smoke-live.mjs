// Production smoke test against the live Worker + cloud Supabase.
// HTTP goes through curl with --resolve (local DNS may still cache NXDOMAIN);
// realtime subscribes to the cloud Supabase project directly.
//
//   node scripts/smoke-live.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const HOST = "chess.sundaysuite.app";
const IP = process.env.IP || "104.21.48.174";
const env = Object.fromEntries(
  readFileSync("/tmp/sjakk.env", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

let pass = 0,
  fail = 0;
const check = (n, c, x = "") => (c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + " " + x)));

function curl(method, path, body) {
  const args = ["-s", "--resolve", `${HOST}:443:${IP}`, "-X", method, `https://${HOST}${path}`];
  if (body) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  const out = execFileSync("curl", args, { encoding: "utf8" });
  try {
    return JSON.parse(out);
  } catch {
    return { _raw: out };
  }
}
const move = (g, p, from, to) =>
  curl("POST", "/api/move", { gameId: g, from, to, playerId: p.playerId, resumeCode: p.resumeCode });

async function main() {
  console.log(`SundaySjakk LIVE smoke — https://${HOST}\n`);

  const qm = curl("POST", "/api/dev/quickmatch", { white: "Ada", black: "Bo" });
  check("quickmatch on cloud DB", !!qm.gameId, JSON.stringify(qm));
  if (!qm.gameId) return done();
  const { gameId, white, black } = qm;

  // Realtime subscription to the cloud project.
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const events = [];
  const ch = sb.channel(`game:${gameId}`, { config: { broadcast: { self: false } } });
  ch.on("broadcast", { event: "*" }, (m) => events.push(m.event));
  await new Promise((r) => ch.subscribe((s) => s === "SUBSCRIBED" && r()));

  check("illegal move rejected", move(gameId, white, "e2", "e6").error === "illegal");
  check("out-of-turn rejected", move(gameId, black, "e7", "e5").error === "not_your_turn");

  check("white f3", move(gameId, white, "f2", "f3").turn === "b");
  check("black e5", move(gameId, black, "e7", "e5").turn === "w");
  check("white g4", move(gameId, white, "g2", "g4").turn === "b");
  check("black Qh4# → black_win", move(gameId, black, "d8", "h4").status === "black_win");

  const detail = curl("GET", `/api/game/${gameId}`);
  check("reconnect read shows black_win", detail.status === "black_win");

  await new Promise((r) => setTimeout(r, 800));
  check("cloud realtime delivered position broadcasts", events.filter((e) => e === "position").length >= 1, JSON.stringify(events));

  await sb.removeChannel(ch);
  done();
}
function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
