import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sharedCookieOptions } from "@/lib/supabase/cookies";

// SCOPE: the matcher (bottom) limits this proxy (Next 16's renamed middleware)
// to /host/* and /auth/* ONLY. Anonymous join/play/board/projector/display and
// every /api/* route are NEVER touched, so anonymous play is completely
// unaffected by the host login.
//
// /host/login and /auth/callback are reachable WITHOUT a session (you log in
// there). Every other /host/* route requires a signed-in Sunday Account host;
// the allow-list check happens server-side in requireHost() (lib/server/auth.ts).
const PUBLIC_HOST_PREFIXES = ["/host/login", "/auth/"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url =
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon =
    process.env.NEXT_PUBLIC_SUNDAY_AUTH_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createServerClient(url, anon, {
    cookieOptions: sharedCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
      },
    },
  });

  // Refresh the host session cookie if present (no-op for anonymous visitors).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_HOST_PREFIXES.some((p) => path.startsWith(p));

  // Gate /host/* (except /host/login): unauthenticated → login page.
  if (!isPublic && path.startsWith("/host") && !user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/host/login";
    return NextResponse.redirect(redirect);
  }

  // Already signed in but sitting on the login page → straight to the dashboard.
  if (path === "/host/login" && user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/host";
    return NextResponse.redirect(redirect);
  }

  return response;
}

// Limit to the host SSO surface only. Anonymous routes are intentionally absent.
export const config = {
  matcher: ["/host/:path*", "/auth/:path*"],
};
