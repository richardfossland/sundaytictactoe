// Shared config + HTTP helper for smoke scripts that hit the DEPLOYED
// TicTacToe Worker + cloud Supabase project (as opposed to a local dev server
// — those scripts talk to `process.env.BASE || "http://localhost:3000"` and
// don't need any of this).

import { readFileSync } from "node:fs";

export const HOST = process.env.SMOKE_HOST ?? "tictactoe.sundaysuite.app";
export const BASE = `https://${HOST}`;

const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Optional env file — only for values a script actually needs (e.g. Supabase
// realtime keys for a script that subscribes to a channel directly; most
// scripts only call the public HTTP API and never touch this).
// ---------------------------------------------------------------------------
let cachedEnvFile;

function envFilePath() {
  return process.env.SMOKE_ENV_FILE ?? ".env.production.local";
}

function readEnvFile() {
  if (cachedEnvFile) return cachedEnvFile;
  try {
    const text = readFileSync(envFilePath(), "utf8");
    cachedEnvFile = Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  } catch {
    cachedEnvFile = {};
  }
  return cachedEnvFile;
}

/** Read one env value a script needs: `process.env` first, then the env file
 * (`SMOKE_ENV_FILE`, default `.env.production.local`). Throws with a clear
 * message if neither has it — fail loudly rather than silently falling back
 * to a wrong/local value. */
export function requireEnv(key) {
  const value = process.env[key] ?? readEnvFile()[key];
  if (!value) {
    throw new Error(`Missing ${key} — set it in the environment or in ${envFilePath()}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// --resolve-style DNS pinning, opt-in only via `process.env.IP`. Mirrors curl's
// `--resolve HOST:443:IP`: the raw TCP connection targets IP directly, while
// the TLS SNI and Host header stay on HOST — so it still reaches the right
// Cloudflare edge + Worker route, just bypassing local DNS (useful right after
// attaching/repointing a custom domain, before it has propagated everywhere).
// Without IP set, fetch resolves HOST normally — this is the common case.
// ---------------------------------------------------------------------------
let pinnedDispatcherFor;

async function dispatcherPinnedTo(ip) {
  if (pinnedDispatcherFor?.ip !== ip) {
    const { Agent, fetch: undiciFetch } = await import("undici");
    const lookup = (_hostname, options, callback) => {
      if (options?.all) callback(null, [{ address: ip, family: 4 }]);
      else callback(null, ip, 4);
    };
    // Node's built-in fetch bundles its OWN undici; a dispatcher from the npm
    // package (a different major) is rejected with "invalid onRequestStart
    // method". So when pinning, use the npm package's fetch as well.
    pinnedDispatcherFor = { ip, agent: new Agent({ connect: { lookup } }), fetch: undiciFetch };
  }
  return pinnedDispatcherFor;
}

/**
 * fetch() against the live host, JSON in and out, with a hard 15s timeout.
 * GETs retry up to 3 times by default — the TTT edge currently drops ~30% of
 * requests under load (see docs/RIG-TEST.md) — while mutating calls never
 * retry automatically, since retrying a POST could double-apply it. Pass
 * `{ retries }` to override either default.
 */
export async function fetchJson(path, init = {}, { retries } = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = 1 + (retries ?? (method === "GET" ? 3 : 0));

  const opts = {
    ...init,
    method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  };
  let doFetch = fetch;
  if (process.env.IP) {
    const pinned = await dispatcherPinnedTo(process.env.IP);
    opts.dispatcher = pinned.agent;
    doFetch = pinned.fetch;
  }

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch(`${BASE}${path}`, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { _raw: text };
      }
      return { status: res.status, json };
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) continue;
    }
  }
  throw lastErr;
}
