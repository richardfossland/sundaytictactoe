"use client";

import { supportsWindowPlacement } from "./detect";
import { tavleUrl } from "./usePresentasjon";

export interface TavleVinduResultat {
  /** false = nettleseren blokkerte popup-vinduet. */
  ok: boolean;
  /** true = vinduet ble flyttet til en annen skjerm enn den du står på. */
  placedOnOtherScreen: boolean;
}

export const TAVLE_VINDU = "sunday-tavle";

// Subsett av Window Management API (ikke i lib.dom ennå).
interface ScreenLike {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}
interface ScreenDetailsLike {
  screens: ScreenLike[];
  currentScreen: ScreenLike;
}

/** Åpner tavla i et eget, navngitt vindu (`sunday-tavle`) så kontrollene blir
 * i dette vinduet. Vinduet åpnes SYNKRONT (innenfor brukerbevegelsen — ellers
 * blokkerer popup-blokkere det); først etterpå prøver vi å flytte det til en
 * annen skjerm via Window Management API, og feiler stille hvis tillatelsen
 * nektes. Samme navn gjenbruker vinduet i stedet for å stable kopier. */
export async function openTavleVindu(): Promise<TavleVinduResultat> {
  const w = window.open(
    tavleUrl(window.location.href),
    TAVLE_VINDU,
    "popup,width=1280,height=720",
  );
  if (!w) return { ok: false, placedOnOtherScreen: false };
  try {
    w.focus();
  } catch {}

  if (!supportsWindowPlacement()) return { ok: true, placedOnOtherScreen: false };
  try {
    const details = await (
      window as unknown as { getScreenDetails: () => Promise<ScreenDetailsLike> }
    ).getScreenDetails();
    const other = details.screens.find((s) => s !== details.currentScreen);
    if (!other) return { ok: true, placedOnOtherScreen: false };
    w.moveTo(other.availLeft, other.availTop);
    w.resizeTo(other.availWidth, other.availHeight);
    return { ok: true, placedOnOtherScreen: true };
  } catch {
    // Tillatelse nektet / API feilet — vinduet er åpent, bare ikke flyttet.
    return { ok: true, placedOnOtherScreen: false };
  }
}
