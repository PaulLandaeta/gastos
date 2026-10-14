import { z } from 'zod';

const Name = z.string().trim().min(1).max(40);
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color #RRGGBB');

export const CreateCategoryBody = z.object({ name: Name, color: Color.default('#64748b') });
export type CreateCategoryBody = z.input<typeof CreateCategoryBody>;

export const UpdateCategoryBody = z
  .object({ expectedVersion: z.number().int().min(1), name: Name.optional(), color: Color.optional(), active: z.boolean().optional() })
  .refine((b) => b.name !== undefined || b.color !== undefined || b.active !== undefined, { message: 'Nothing to update' });
export type UpdateCategoryBody = z.input<typeof UpdateCategoryBody>;

export const CategoryDto = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  isDefault: z.boolean(),
  active: z.boolean(),
  version: z.number().int(),
});
export type CategoryDto = z.infer<typeof CategoryDto>;
