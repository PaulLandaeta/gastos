const PALETTE = ['#0f766e', '#4f46e5', '#c2410c', '#be185d', '#0369a1', '#7c3aed', '#15803d', '#b45309'];

/** Stable accent color for a person or a trip. */
export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

const SIZE = { sm: 'h-7 w-7 text-xs', md: 'h-9 w-9 text-sm', lg: 'h-12 w-12 text-base' } as const;

/** Initial on a stable per-person color (decorative: the name is always shown next to it). */
export function Avatar({ name, seed, size = 'md' }: { name: string; seed: string; size?: keyof typeof SIZE }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white ${SIZE[size]}`}
      style={{ backgroundColor: colorFor(seed) }}
    >
      {initial}
    </span>
  );
}
