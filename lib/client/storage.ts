"use client";

// Every localStorage read/write in the app should go through here instead of
// touching `window.localStorage` directly.
//
// Why: Safari's "Block All Cookies" setting, some MDM-managed browsers, and a
// page embedded in a cross-site iframe under storage partitioning can make
// `window.localStorage` throw a SecurityError on ANY property access — not
// just when the quota is exceeded. That is not a hypothetical: an unguarded
// `localStorage.getItem(...)` sitting outside a try/catch on a hot path (a
// mount effect, a `useState` initializer) becomes an uncaught exception on
// the main render path, which can take down an entire screen instead of just
// losing a preference. See PR R2 for the incident this module fixes.
//
// Each helper degrades to a safe default (null / false) rather than
// throwing, and warns at most once per key per page load so a broken
// profile doesn't spam the console on every render.

const warnedKeys = new Set<string>();

function warnOnce(key: string) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn("[storage] unavailable", key);
}

/** Read a key from localStorage. Returns null on the server, when storage is
 *  unavailable (blocked/throwing), or when the key is absent. */
export function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    warnOnce(key);
    return null;
  }
}

/** Write a key to localStorage. Returns whether the write actually landed —
 *  false on the server or when storage is unavailable (quota, private mode,
 *  blocked cookies). Callers that only need best-effort persistence can
 *  ignore the return value; the app's state stays in-memory either way. */
export function safeSet(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    warnOnce(key);
    return false;
  }
}

/** Remove a key from localStorage. Returns whether the removal actually ran. */
export function safeRemove(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    warnOnce(key);
    return false;
  }
}
