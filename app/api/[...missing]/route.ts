import { fail } from "@/lib/server/http";

// Blanket JSON 404 for any /api/* path that no real route matches.
//
// WHY THIS EXISTS (two separate problems, one fix):
//
// 1. CPU. Without it, an unknown `/api/...` fell through to the App Router's
//    not-found page — a full React SSR render of `app/not-found.tsx` (brandmark,
//    fonts, layout). Measured on the deployed Worker: 269–375 ms CPU per hit,
//    for a request whose only correct answer is "no such endpoint". Scanners and
//    stale clients hit these paths constantly. This handler answers in ~0 ms.
//
// 2. Client error classification. `lib/client/api.ts` reads the failure code
//    from the JSON body (`{ error }`); an HTML body makes `res.json()` throw, the
//    helper falls back to `{}` and the code degrades to a generic "error" — so a
//    typo'd endpoint looked exactly like a real API failure and could be
//    mistaken for an expired session. A JSON 404 keeps the contract intact.
//
// Static and dynamic segments always win over a catch-all, so every existing
// `/api/*` route still resolves; only genuinely unmatched paths land here.
// (`/api` itself has no segment to catch and is not matched — a non-catch-all
// optional segment would be needed for that, and no client ever calls it.)
function notFound(): Response {
  return fail(404, "not_found");
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
