"use client";

import { useEffect, useState } from "react";
import { sound } from "@/lib/client/sound";
import { no } from "@/lib/locale/no";

/** Small fixed-corner speaker toggle. Reads/writes the persisted mute flag. */
export function SoundToggle() {
  // Render unmuted on the server, then sync to the stored value on mount.
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(sound.muted());
  }, []);

  return (
    <button
      className="sound-toggle"
      aria-label={muted ? no.common.soundOn : no.common.soundOff}
      title={muted ? no.common.soundOn : no.common.soundOff}
      onClick={() => {
        const next = sound.toggle();
        setMuted(next);
        if (!next) sound.play("move"); // quick audible confirmation
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
