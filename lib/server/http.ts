// Web-standard responses (no next/server dependency) so Route Handlers stay
// unit-testable in a plain Node environment.

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

export function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}

/** Parse a JSON body, returning null on malformed input. */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ---------- naive in-memory rate limiter ----------
// Per-process, best-effort. Good enough for a single-classroom deployment; the
// real backstop for abuse is server-side validation + the unique constraints.
// Documented in docs/RIG-TEST.md for a hardening pass (Upstash/edge KV) later.
//
// SELF-BOUNDING (critical on Cloudflare Workers): keys are high-cardinality
// (move:${ip}:${playerId} etc.) and the casual 1v1 feature mints endless new
// player ids, so without eviction this Map would grow for the whole isolate
// lifetime → memory pressure → Error 1102. Background timers don't run between
// Worker requests, so eviction must happen ON ACCESS: when the map gets large we
// sweep expired entries (and, as a last resort, evict the soonest-expiring) so
// it can never approach the 128 MB cliff.
const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 10_000;

function sweep(now: number): void {
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  if (buckets.size > MAX_BUCKETS) {
    // Still over cap with all entries live → drop the soonest-to-expire.
    const live = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const drop = buckets.size - MAX_BUCKETS;
    for (let i = 0; i < drop; i++) buckets.delete(live[i][0]);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) sweep(now);
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Test-only: reset limiter state between tests. */
export function __resetRateLimiter(): void {
  buckets.clear();
}

/** Test-only: current number of tracked buckets. */
export function __bucketCount(): number {
  return buckets.size;
}

/** Per-IP rate-limit guard for host-code-authenticated routes. The host code is
 * the only secret protecting a tournament's resume codes (≈270M-code space), and
 * those routes had NO throttle — a student who knows their tournament id could
 * brute-force it to harvest classmates' bearer tokens. 90/min per IP is far more
 * than any real teacher clicks, but caps brute-forcing at ~90/min (millennia for
 * the full space). Returns a 429 Response when over the cap, else null. */
export function hostRateLimit(req: Request): Response | null {
  if (!rateLimit(`host:${clientIp(req)}`, 90, 60_000)) {
    return fail(429, "rate_limited");
  }
  return null;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}
