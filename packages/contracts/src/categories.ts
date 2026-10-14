/** Initial categories of every trip (FR-014); ids are deterministic for lazy seeding. */
export const DEFAULT_CATEGORIES = [
  { id: 'default-lodging', name: 'Alojamiento', color: '#6366f1' },
  { id: 'default-transport', name: 'Transporte', color: '#0ea5e9' },
  { id: 'default-food', name: 'Comida', color: '#f59e0b' },
  { id: 'default-activities', name: 'Actividades', color: '#10b981' },
  { id: 'default-shopping', name: 'Compras', color: '#ec4899' },
  { id: 'default-other', name: 'Otros', color: '#64748b' },
] as const;

export const DEFAULT_CATEGORY_ID = 'default-other';
export const isDefaultCategoryId = (id: string) => DEFAULT_CATEGORIES.some((c) => c.id === id);
