"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { report } from "@/lib/client/telemetry";

// Route-level error boundary — a transient render/runtime error shows a
// friendly recovery screen instead of a blank, unrecoverable page.
//
// React error boundaries (this file) bypass the window.onerror /
// unhandledrejection hooks installed in instrumentation-client.ts — those only
// see errors that escape React's own catch. So the loudest client failure of
// all (a render crash) would otherwise never reach telemetry. Report it here,
// once, on mount.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    report("js_error", {
      boundary: "error",
      message: String(error?.message ?? "").slice(0, 200),
      digest: error?.digest,
    });
    // Mount-only: this boundary renders once per error, and we want exactly
    // one report per occurrence, not one per re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center" style={{ alignItems: "center" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>
        <div style={{ fontSize: 40 }}>✕◯</div>
        <h2 style={{ fontSize: 24 }}>Noe gikk galt</h2>
        <p className="muted">Prøv på nytt – framgangen din er trygt lagret på serveren.</p>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn btn-primary btn-lg" onClick={() => reset()}>
            Prøv igjen
          </button>
          <button
            className="btn btn-lg"
            onClick={() => {
              // Redirect ONLY — never identity.clearPlayer(): a render crash is
              // not evidence the session is invalid, and /play resumes it.
              router.push("/play");
            }}
          >
            Til innlogging
          </button>
        </div>
      </div>
    </main>
  );
}
