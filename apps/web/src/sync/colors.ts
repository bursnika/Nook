export const PARTICIPANT_COLORS = [
  '#b8326f', // pink-700
  '#2f5aa6', // blue-700
  '#654390', // lavender-700
  '#1d6b5c', // teal
  '#8a4b08', // amber
  '#8f2253', // deep pink
] as const;

export function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return PARTICIPANT_COLORS[Math.abs(hash) % PARTICIPANT_COLORS.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters =
    parts.length === 1
      ? [...parts[0]!].slice(0, 2)
      : [[...parts[0]!][0], [...parts[parts.length - 1]!][0]];
  return letters.join('').toUpperCase();
}
