"use client";

import { useEffect } from "react";

const CLASS = "hide-cursor";

/** Skjuler musepekeren etter `ms` uten bevegelse (projektor/TV). Pekeren
 * kommer tilbake ved første bevegelse, og klassen fjernes ved opprydding. */
export function useHideCursor(enabled: boolean, ms = 3000) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      root.classList.remove(CLASS);
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.add(CLASS), ms);
    };
    arm();
    window.addEventListener("mousemove", arm);
    window.addEventListener("mousedown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", arm);
      window.removeEventListener("mousedown", arm);
      window.removeEventListener("keydown", arm);
      root.classList.remove(CLASS);
    };
  }, [enabled, ms]);
}
