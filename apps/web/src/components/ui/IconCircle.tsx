import type { ReactNode } from 'react';

const SIZE = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-14 w-14' } as const;

/** A white glyph on a solid colored circle (TravelSpend-style category badge). */
export function IconCircle({ color, size = 'md', children }: { color: string; size?: keyof typeof SIZE; children: ReactNode }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full text-white ${SIZE[size]}`} style={{ backgroundColor: color }}>
      {children}
    </span>
  );
}
