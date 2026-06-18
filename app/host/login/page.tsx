"use client";

import { useState } from "react";
import Link from "next/link";

import { no } from "@/lib/locale/no";
import { createAuthClient } from "@/lib/supabase/auth-browser";

// OPTIONAL host login (Sunday Account). Anonymous arrangører never reach here —
// they use the code-based flow at /arranger. Magic-link + Google both land on
// /auth/callback, which exchanges the code and redirects to /host.
export default function HostLoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = createAuthClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setError(no.hostAuth.loginError);
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    const supabase = createAuthClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack scale-in">
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>

        <p className="eyebrow text-center">{no.hostAuth.loginTitle}</p>
        <p className="muted text-center" style={{ fontSize: 14 }}>
          {no.hostAuth.loginLede}
        </p>

        {sent ? (
          <div className="banner" style={{ textAlign: "center" }}>
            {no.hostAuth.magicLinkSent} <b>{email}</b>.
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="stack" style={{ gap: 12 }}>
            <div className="field">
              <label htmlFor="email">{no.hostAuth.emailLabel}</label>
              <input
                id="email"
                className="input"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder={no.hostAuth.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && <div className="banner banner-error">{error}</div>}
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || !email.trim()}>
              {busy ? <span className="spin" /> : no.hostAuth.sendMagicLink}
            </button>
          </form>
        )}

        <button className="btn btn-block" onClick={signInWithGoogle} disabled={busy}>
          {no.hostAuth.google}
        </button>

        <Link href="/arranger" className="btn btn-ghost btn-block">
          {no.hostAuth.backToAnon}
        </Link>
      </div>
    </main>
  );
}
