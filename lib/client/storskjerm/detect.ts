// Enhetsdeteksjon for storskjerm-veiviseren. Rene funksjoner (UA-streng +
// valgfrie navigator-hint) så de kan testes uten nettleser. Veiviseren bruker
// dem bare til å sortere/utheve alternativer — aldri til å skjule dem.

export interface NavHints {
  /** `navigator.maxTouchPoints` — skiller iPadOS (som later som Mac) fra ekte Mac. */
  maxTouchPoints?: number;
}

/** iPhone/iPad/iPod, inkl. iPadOS i «skrivebordsmodus» (UA sier Macintosh, men
 * enheten har berøringsskjerm — en ekte Mac har aldri det). */
export function isIOSLike(ua: string, hints: NavHints = {}): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (hints.maxTouchPoints ?? 0) > 1;
}

/** Apple-enhet: Mac, iPad eller iPhone — de som har AirPlay/Skjermspeiling. */
export function isApple(ua: string, hints: NavHints = {}): boolean {
  return isIOSLike(ua, hints) || /Macintosh|Mac OS X/.test(ua);
}

/** Chrome/Edge/Brave/Chromebook-nettleser som har «Cast …» i menyen. iOS-
 * nettlesere (CriOS, EdgiOS …) er WebKit under panseret og kan ikke caste
 * faner, og Firefox har ikke Cast. */
export function isChromium(ua: string, hints: NavHints = {}): boolean {
  if (isIOSLike(ua, hints)) return false;
  if (/CriOS|FxiOS|EdgiOS|Firefox/.test(ua)) return false;
  return /Chrome\/|Chromium\/|Edg\/|CrOS/.test(ua);
}

/** Window Management API (flerskjerm-plassering av popup). */
export function supportsWindowPlacement(
  win: object | undefined = typeof window === "undefined" ? undefined : window,
): boolean {
  return !!win && "getScreenDetails" in win;
}
