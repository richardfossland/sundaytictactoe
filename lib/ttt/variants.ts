// m,n,k game variants: an m×n board where k marks in a row wins. Classic
// tic-tac-toe is 3×3 with k=3. Larger boards (k=4) make draws far rarer, which
// keeps a tournament interesting between evenly matched players. The variant is
// stored in tournaments.config.variant (jsonb) — no DB column needed.

export interface MnkVariant {
  id: string;
  /** rows */
  m: number;
  /** columns */
  n: number;
  /** marks in a row to win */
  k: number;
  label: string;
}

export const VARIANTS: MnkVariant[] = [
  { id: "3x3", m: 3, n: 3, k: 3, label: "3 på rad (3×3)" },
  { id: "4x4", m: 4, n: 4, k: 4, label: "4 på rad (4×4)" },
  { id: "5x5", m: 5, n: 5, k: 4, label: "4 på rad (5×5)" },
];

export const DEFAULT_VARIANT = VARIANTS[0];

export function isVariant(id: unknown): boolean {
  return typeof id === "string" && VARIANTS.some((v) => v.id === id);
}

/** Resolve a (possibly missing/unknown/legacy) variant id to a variant.
 * Unknown ⇒ the classic 3×3. */
export function variantById(id: unknown): MnkVariant {
  return VARIANTS.find((v) => v.id === id) ?? DEFAULT_VARIANT;
}

/** Empty start board for a variant: m*n dots. */
export function variantStartState(v: MnkVariant): string {
  return ".".repeat(v.m * v.n);
}
