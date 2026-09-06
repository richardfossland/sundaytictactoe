"use client";

import { useEffect } from "react";
import { report } from "@/lib/client/telemetry";

// Catches errors in the root layout itself. Must render its own <html>/<body>
// and cannot rely on the app stylesheet, so it is fully inline-styled.
//
// Same telemetry gap as app/error.tsx (see the comment there): React error
// boundaries bypass instrumentation-client.ts's window.onerror hooks, and this
// is the boundary for the worst case — the root layout itself failed to
// render. Report it once, on mount.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    report("js_error", {
      boundary: "global",
      message: String(error?.message ?? "").slice(0, 200),
      digest: error?.digest,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <html lang="no">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#14171e",
          color: "#f3efe6",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 40, color: "#ebb84b" }}>✕◯</div>
          <h2 style={{ fontWeight: 700 }}>Noe gikk galt</h2>
          <p style={{ color: "#9aa0ad" }}>Last inn siden på nytt.</p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 12,
              padding: "12px 22px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg,#f2d58a,#ebb84b)",
              color: "#1a1305",
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Prøv igjen
          </button>
        </div>
      </body>
    </html>
  );
}
