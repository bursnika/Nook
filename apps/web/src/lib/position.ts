/** Distance between neighbours when a column is numbered from scratch; the API uses the same step. */
export const STEP = 1024;

/**
 * A position strictly between two neighbours (fractional indexing). `null` means "no neighbour on that
 * side", so the card goes to the very top or bottom. When there is no room left between two floats the
 * result is not strictly between them: see `fits`.
 */
export function between(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return STEP;
  if (prev === null) return (next as number) - STEP;
  if (next === null) return prev + STEP;
  return prev + (next - prev) / 2;
}

/** Whether a position really sorts between its neighbours (false once float precision runs out). */
export function fits(position: number, prev: number | null, next: number | null): boolean {
  return (prev === null || position > prev) && (next === null || position < next);
}
