/** Fractional positions: a block moves by getting a number between its new neighbours; nobody else changes. */

/** The API hands out positions in steps of 1024. */
export const POSITION_STEP = 1024;

/** Below this gap two positions are too close to split reliably in a double. */
export const MIN_GAP = 1e-6;

/** A position strictly between `prev` and `next` (either may be missing at the ends of the list). */
export function between(prev: number | null | undefined, next: number | null | undefined): number {
  const hasPrev = typeof prev === 'number';
  const hasNext = typeof next === 'number';
  if (hasPrev && hasNext) return (prev + next) / 2;
  if (hasPrev) return prev + POSITION_STEP;
  if (hasNext) return next - POSITION_STEP;
  return POSITION_STEP;
}

/** True when there is no room left between the two neighbours, so positions must be renumbered. */
export function gapCollapsed(
  prev: number | null | undefined,
  next: number | null | undefined,
): boolean {
  if (typeof prev !== 'number' || typeof next !== 'number') return false;
  const mid = (prev + next) / 2;
  return next - prev < MIN_GAP || mid <= prev || mid >= next;
}

/** Fresh evenly spaced positions for a list, in its current order. */
export function renormalise<T extends { id: string }>(
  items: readonly T[],
): { id: string; position: number }[] {
  return items.map((item, index) => ({ id: item.id, position: (index + 1) * POSITION_STEP }));
}

/**
 * Where a block goes when it is dropped at `targetIndex` of the list *without* itself (so the index is the
 * slot among the other blocks). Returns the new position, or null when the neighbours are too close.
 */
export function positionAt(
  others: readonly { position: number }[],
  targetIndex: number,
): number | null {
  const prev = others[targetIndex - 1]?.position;
  const next = others[targetIndex]?.position;
  return gapCollapsed(prev, next) ? null : between(prev, next);
}
