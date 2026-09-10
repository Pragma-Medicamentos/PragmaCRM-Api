import { z } from 'zod';

export const createSellerSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es requerido').max(255),
  email: z.string().trim().toLowerCase().email('Email inválido'),
});

export type CreateSellerInput = z.infer<typeof createSellerSchema>;

export const updateSellerSchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre es requerido').max(255).optional(),
    email: z.string().trim().toLowerCase().email('Email inválido').optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'Debe enviar al menos un campo para actualizar',
  });

  export type UpdateSellerInput = z.infer<typeof updateSellerSchema>;

export const updateSellerStatusSchema = z.object({
  active: z.boolean(),
});

export type UpdateSellerStatusInput = z.infer<typeof updateSellerStatusSchema>;

export const sellerParamsSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type SellerParams = z.infer<typeof sellerParamsSchema>;

export const listSellersQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListSellersQuery = z.infer<typeof listSellersQuerySchema>;