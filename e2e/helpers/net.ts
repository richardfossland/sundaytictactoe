import type { Page, Request as PlaywrightRequest, Route } from "@playwright/test";

// Two things a network-behaviour spec needs and Playwright does not hand you
// directly: a running COUNT of requests matching a pattern (to assert that
// something did NOT happen), and a stubbed route you can take back off again
// (to assert that the app HEALS once the server returns).

export interface RequestCounter {
  /** How many matching requests the page has made since this counter started. */
  count(): number;
  /** The matching URLs, in order — for a failure message worth reading. */
  urls(): readonly string[];
  /** Stop listening. Always in a `finally`: the listener outlives the assertion. */
  stop(): void;
}

/**
 * Count requests whose URL contains `pattern` (string) or matches it (RegExp).
 *
 * Deliberately counts REQUESTS, not responses: a passive tab that fires a fetch
 * and has it fail still made the call, and that is exactly the bug ("the passive
 * tab keeps polling") the count is there to catch.
 */
export function countRequests(page: Page, pattern: string | RegExp): RequestCounter {
  const seen: string[] = [];
  const matches = (url: string) =>
    typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);
  const onRequest = (req: PlaywrightRequest) => {
    if (matches(req.url())) seen.push(req.url());
  };
  page.on("request", onRequest);
  return {
    count: () => seen.length,
    urls: () => seen,
    stop: () => page.off("request", onRequest),
  };
}

export interface StubResponse {
  status: number;
  body: string;
  /** Defaults to HTML — the shape of an edge error page, which is the point. */
  contentType?: string;
}

/**
 * Answer every matching request with a canned response. Returns the undo, so a
 * spec can prove the app recovers rather than only that it survives.
 *
 * The default content type is `text/html`: an HTML body with a 4xx/5xx status is
 * what a Cloudflare error page, a WAF challenge or a proxy actually sends, and
 * telling that apart from our own JSON envelope is the whole R3 rule.
 */
export async function blockRoute(
  page: Page,
  pattern: string,
  response: StubResponse,
): Promise<() => Promise<void>> {
  const handler = (route: Route) =>
    route.fulfill({
      status: response.status,
      contentType: response.contentType ?? "text/html; charset=utf-8",
      body: response.body,
    });
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

/**
 * Swallow every matching request and never answer it — the stalled-response
 * case the 8 s `timedJson` deadline in lib/client/api.ts exists for.
 *
 * The undo releases everything still parked, so the page is not left with
 * hanging requests while Playwright tears the context down.
 */
export async function hangRoute(
  page: Page,
  pattern: string,
): Promise<() => Promise<void>> {
  const parked: Route[] = [];
  const handler = (route: Route) => {
    parked.push(route);
  };
  await page.route(pattern, handler);
  return async () => {
    await page.unroute(pattern, handler);
    for (const route of parked.splice(0)) {
      // The client has usually aborted already; that makes abort() throw.
      await route.abort().catch(() => {});
    }
  };
}
