"use client";

import { useEffect, useState } from "react";

/** Compact join hint (URL + PIN) for the teacher board — kept visible during
 * play so students can find their way back to chess.sundaysuite.app/play. */
export function JoinChip({ pin }: { pin: string }) {
  const [host, setHost] = useState("");
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHost(base.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  }, []);

  return (
    <span
      className="badge"
      style={{ fontSize: 14, padding: "7px 14px", gap: 10 }}
      aria-label={`Bli med på ${host}/play med PIN ${pin}`}
    >
      <span className="muted">{host}/play</span>
      <b
        className="mono"
        style={{ color: "var(--gold)", fontSize: 17, letterSpacing: "0.1em" }}
      >
        {pin}
      </b>
    </span>
  );
}
