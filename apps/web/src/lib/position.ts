export const STEP = 1024;

// null = no neighbour on that side
export function between(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return STEP;
  if (prev === null) return (next as number) - STEP;
  if (next === null) return prev + STEP;
  return prev + (next - prev) / 2;
}

export function fits(position: number, prev: number | null, next: number | null): boolean {
  return (prev === null || position > prev) && (next === null || position < next);
}
