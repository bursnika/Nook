export const POSITION_STEP = 1024;

// smaller gaps can't be split reliably in a double
export const MIN_GAP = 1e-6;

export function between(prev: number | null | undefined, next: number | null | undefined): number {
  const hasPrev = typeof prev === 'number';
  const hasNext = typeof next === 'number';
  if (hasPrev && hasNext) return (prev + next) / 2;
  if (hasPrev) return prev + POSITION_STEP;
  if (hasNext) return next - POSITION_STEP;
  return POSITION_STEP;
}

export function gapCollapsed(
  prev: number | null | undefined,
  next: number | null | undefined,
): boolean {
  if (typeof prev !== 'number' || typeof next !== 'number') return false;
  const mid = (prev + next) / 2;
  return next - prev < MIN_GAP || mid <= prev || mid >= next;
}

export function renormalise<T extends { id: string }>(
  items: readonly T[],
): { id: string; position: number }[] {
  return items.map((item, index) => ({ id: item.id, position: (index + 1) * POSITION_STEP }));
}

// targetIndex is the slot among the other blocks (without this one)
export function positionAt(
  others: readonly { position: number }[],
  targetIndex: number,
): number | null {
  const prev = others[targetIndex - 1]?.position;
  const next = others[targetIndex]?.position;
  return gapCollapsed(prev, next) ? null : between(prev, next);
}
