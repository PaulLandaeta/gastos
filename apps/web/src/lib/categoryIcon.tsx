import { BedIcon, BusIcon, ForkKnifeIcon, ShoppingBagIcon, TagIcon, TicketIcon, type Icon } from '@phosphor-icons/react';
import { IconCircle } from '../components/ui/IconCircle';

/** Default categories have fixed ids (contracts DEFAULT_CATEGORIES); custom ones share a generic tag. */
const ICONS: Record<string, Icon> = {
  'default-lodging': BedIcon,
  'default-transport': BusIcon,
  'default-food': ForkKnifeIcon,
  'default-activities': TicketIcon,
  'default-shopping': ShoppingBagIcon,
  'default-other': TagIcon,
};

export function categoryIcon(id: string | undefined): Icon {
  return (id && ICONS[id]) || TagIcon;
}

const GLYPH = { sm: 16, md: 20, lg: 28 } as const;

export function CategoryIcon({
  category,
  size = 'md',
}: {
  category: { id: string; color: string } | undefined;
  size?: keyof typeof GLYPH;
}) {
  const Glyph = categoryIcon(category?.id);
  return (
    <IconCircle color={category?.color ?? '#64748b'} size={size}>
      <Glyph weight="fill" size={GLYPH[size]} />
    </IconCircle>
  );
}
