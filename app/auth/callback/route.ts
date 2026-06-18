import { NextResponse } from "next/server";

import { createAuthClient } from "@/lib/supabase/auth-server";

// OAuth / magic-link landing for the OPTIONAL Sunday Account host. Exchanges the
// code for a session cookie on the issuer project, then sends the host to the
// dashboard. Whitelisted in middleware (no session cookie exists yet here).
//
// Hardened: on any error (missing/invalid code, exchange failure) fall back to
// the login page rather than 500-ing, and never reflect attacker-controlled
// redirect targets — the destination is always our own /host or /host/login.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/host/login`);
  }

  try {
    const supabase = await createAuthClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return NextResponse.redirect(`${origin}/host/login`);
    }
  } catch {
    return NextResponse.redirect(`${origin}/host/login`);
  }

  return NextResponse.redirect(`${origin}/host`);
}
