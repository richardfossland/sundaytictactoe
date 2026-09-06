"use client";

import { useEffect, useState } from "react";
import { no } from "@/lib/locale/no";
import { notifyOptedIn, setNotifyOptIn } from "@/lib/client/turnCue";

/** Small fixed-corner opt-in button, stacked with SoundToggle/FullscreenToggle
 * (see .notify-toggle in globals.css) — never changes layout above the board.
 * Requests Notification permission on tap (the tap IS the required user
 * gesture; this is the ONLY place in the app that ever calls
 * Notification.requestPermission()) and remembers the opt-in via
 * lib/client/storage.ts. Renders nothing once the Notification API is
 * unsupported or the player has already opted in — there is nothing left to
 * offer. */
export function NotifyToggle() {
  // Undecided on the server / before mount → render nothing rather than a
  // wrong guess that then pops in or out.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(
      typeof Notification !== "undefined" &&
        Notification.permission !== "granted" &&
        !notifyOptedIn(),
    );
  }, []);

  if (!visible) return null;

  const requestOptIn = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        setNotifyOptIn(true);
        setVisible(false);
      }
    } catch {
      // Unsupported / blocked — fail quietly, same posture as sound/fullscreen.
    }
  };

  return (
    <button
      className="notify-toggle"
      aria-label={no.player.notifyOptIn}
      title={no.player.notifyOptIn}
      onClick={() => void requestOptIn()}
    >
      🔔
    </button>
  );
}
